/**
 * Archura site Worker: editor hosting, claim/publish API, and published-site
 * serving in one deployment.
 *
 * Routing by hostname:
 * - `<name>.<ROOT_DOMAIN>`  → the published site for `name` (wildcard DNS route)
 * - anything else           → the editor app (static assets) + /api/*
 * - `/s/<name>/` also serves a published site on any host — the fallback used
 *   on workers.dev and under `wrangler dev`, where wildcard hosts don't exist.
 *
 * Storage (R2 binding ARTIFACTS):
 * - sites/<name>/meta.json               → { site, tokenHash, createdAt }
 * - sites/<name>/pages/Landing.json      → published CanonicalComponentData
 * - sites/<name>/embed/<Component>.js    → generated per-client embed module
 */

const RESERVED = new Set(['www', 'api', 'app', 'editor', 'assets', 'components', 'embed', 's']);
const SITE_NAME = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const SITE_ID = /^site_[a-f0-9]{32}$/;
const PUBLISHABLE_KEY = /^pk_(?:test|live)_[A-Za-z0-9_-]{20,}$/;
const CUSTOM_ELEMENT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const HOME_ARTIFACT = 'pages/Landing';

const BASE_RESET_CSS = `*, *::before, *::after { box-sizing: border-box; } body { margin: 0; }`;

const ASSET_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const CORE_SERVICE_HEADER = 'X-Archura-Service-Authorization';
const CORE_CLIENT_IP_HEADER = 'X-Archura-Client-IP';

// Keep in sync with GOOGLE_FONTS in src/editor/ArchuraEditorController.ts
const GOOGLE_FONTS = ['Inter', 'Poppins', 'Roboto', 'Montserrat', 'Playfair Display', 'Lora', 'Merriweather', 'DM Sans'];

function escapeHtml(text) {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
}

async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function tokenMatchesHash(token, expectedHex) {
  const provided = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const expected = new Uint8Array(32);
  if (!/^[a-f0-9]{64}$/.test(expectedHex ?? '')) return false;
  for (let index = 0; index < expected.length; index += 1) {
    expected[index] = Number.parseInt(expectedHex.slice(index * 2, index * 2 + 2), 16);
  }
  return crypto.subtle.timingSafeEqual(provided, expected);
}

// API responses are session/state-dependent and must never be heuristically
// cached (a stale /api/me once produced /undefined/dashboard/ links)
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const root = env.ROOT_DOMAIN;

    // Stable cross-origin embed route. The site id is required because one
    // organization may own any number of sites under the same publishable key.
    const embedHost = root && url.hostname === `embed.${root}`;
    const embedPath = embedHost ? url.pathname : url.pathname.startsWith('/embed/') ? url.pathname.slice('/embed'.length) : '';
    const publicEmbed = embedPath.match(/^\/(pk_(?:test|live)_[A-Za-z0-9_-]{20,})\/(site_[a-f0-9]{32})\/([^/]+)$/);
    if (publicEmbed) {
      const [, publishableKey, siteId, name] = publicEmbed;
      if (!PUBLISHABLE_KEY.test(publishableKey) || !SITE_ID.test(siteId) || !EMBED_NAME.test(name)) {
        return json({ error: 'Not found' }, 404);
      }
      return servePublicEmbed(env, publishableKey, siteId, name);
    }
    if (embedHost || url.pathname.startsWith('/embed/')) {
      return json({ error: 'Not found' }, 404);
    }

    // Published site via wildcard subdomain
    if (root && url.hostname !== root && url.hostname.endsWith(`.${root}`)) {
      const sub = url.hostname.slice(0, -(root.length + 1));
      if (SITE_NAME.test(sub) && !RESERVED.has(sub)) {
        return serveSite(request, env, sub, url.pathname, '/');
      }
    }

    // Published site via path fallback (workers.dev, wrangler dev)
    if (url.pathname.startsWith('/s/')) {
      const [, , site, ...rest] = url.pathname.split('/');
      if (SITE_NAME.test(site ?? '')) {
        return serveSite(request, env, site, `/${rest.join('/')}`, `/s/${site}/`);
      }
      return new Response('Not found', { status: 404 });
    }

    if (url.pathname === '/confirm') {
      return handleConfirm(request, env, url);
    }

    // Legacy /<accountId>/dashboard/ links still serve the dashboard app;
    // the canonical URL is plain /dashboard/ (identity lives in the session —
    // an id in the path adds nothing while sessions hold exactly one account)
    const dashboardMatch = url.pathname.match(/^\/([0-9a-fA-F][0-9a-fA-F-]{7,})\/dashboard\/?$/);
    if (dashboardMatch) {
      return env.ASSETS.fetch(new Request(new URL('/dashboard/', request.url), request));
    }

    if (url.pathname.startsWith('/api/')) {
      return serveApi(request, env, url);
    }

    // Editor app + built component modules
    const assetResponse = await env.ASSETS.fetch(request);
    if (url.pathname.startsWith('/components/')) {
      return withCors(assetResponse);
    }
    return assetResponse;
  },
};

// Environment-correct site link. PUBLIC_ORIGIN (set in .dev.vars by
// dev-up.sh) wins — wrangler dev simulates the configured route, so the
// Worker sees request.url as the production host even for localhost requests
// and cannot tell the environments apart from the request alone. Without the
// override: canonical subdomain when the request came through the root
// domain, current-origin path fallback elsewhere (workers.dev).
function siteUrlFor(request, env, site) {
  if (env.PUBLIC_ORIGIN) {
    return `${env.PUBLIC_ORIGIN.replace(/\/+$/, '')}/s/${site}/`;
  }
  const url = new URL(request.url);
  const root = env.ROOT_DOMAIN;
  if (root && (url.hostname === root || url.hostname.endsWith(`.${root}`))) {
    return `https://${site}.${root}/`;
  }
  return `${url.origin}/s/${site}/`;
}

function embedBaseFor(request, env, publishableKey, siteId) {
  if (env.PUBLIC_ORIGIN) {
    return `${env.PUBLIC_ORIGIN.replace(/\/+$/, '')}/embed/${publishableKey}/${siteId}`;
  }
  const url = new URL(request.url);
  const root = env.ROOT_DOMAIN;
  if (root && (url.hostname === root || url.hostname.endsWith(`.${root}`))) {
    return `https://embed.${root}/${publishableKey}/${siteId}`;
  }
  return `${url.origin}/embed/${publishableKey}/${siteId}`;
}

// White-label embeds load component modules from foreign origins, and module
// scripts require CORS
function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(response.body, { status: response.status, headers });
}

/**
 * Claim gating: when CLAIM_IP_ALLOWLIST is set (comma-separated; entries may
 * end in `*` for prefix match, e.g. an IPv6 /64), only those IPs may claim
 * sites. Loopback is exempt so `wrangler dev` keeps working — in production
 * Cloudflare sets CF-Connecting-IP itself, so it can never be loopback.
 */
function claimAllowed(request, env) {
  const allowlist = (env.CLAIM_IP_ALLOWLIST ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (allowlist.length === 0) return true;

  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  if (ip === '127.0.0.1' || ip === '::1') return true;
  return allowlist.some((entry) =>
    entry.endsWith('*') ? ip.startsWith(entry.slice(0, -1)) : ip === entry
  );
}

// --- Core (Go) plumbing: service-authed requests + account sessions ---

function coreConfigured(env) {
  return !!(env.CORE_URL && env.CORE_SERVICE_KEY);
}

function coreRequest(env, path, { method, body, bearer } = {}) {
  return fetch(new URL(path, env.CORE_URL), {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      [CORE_SERVICE_HEADER]: `Bearer ${env.CORE_SERVICE_KEY}`,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const SESSION_COOKIE = 'archura_session';

function sessionTokenFromRequest(request) {
  const cookies = request.headers.get('Cookie') ?? '';
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : '';
}

// Resolves the request's session cookie to { account, organizations } or null.
async function sessionAccount(request, env) {
  const token = sessionTokenFromRequest(request);
  if (!token || !coreConfigured(env)) return null;
  const response = await coreRequest(env, '/v1/sessions/me', { bearer: token });
  if (!response.ok) return null;
  return response.json();
}

// Publish auth: the bearer token must hash to the claimed site's tokenHash,
// OR the request carries a session whose account owns the site.
// Returns null when authorized, or the error Response to return.
async function requireClaimToken(request, env, site) {
  const meta = await env.ARTIFACTS.get(`sites/${site}/meta.json`);
  if (!meta) return json({ error: 'Unknown site' }, 404);
  const { tokenHash } = await meta.json();
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token && tokenHash && (await tokenMatchesHash(token, tokenHash))) return null;
  const session = await sessionAccount(request, env);
  if (session?.organizations?.some((organization) => organization.sites?.includes(site))) return null;
  return json({ error: 'Unauthorized' }, 401);
}

const EMBED_NAME = /^[A-Za-z0-9_-]+\.js$/;

async function serveApi(request, env, url) {
  if (url.pathname.startsWith('/api/core/')) {
    return proxyCore(request, env, url);
  }

  if (url.pathname === '/api/sites' && request.method === 'POST') {
    if (!claimAllowed(request, env)) {
      return json({ error: 'Claiming is restricted' }, 403);
    }
    let site;
    let organizationId;
    try {
      ({ site, organizationId } = await request.json());
    } catch {
      return json({ error: 'Invalid body' }, 400);
    }
    if (typeof site !== 'string' || !SITE_NAME.test(site) || RESERVED.has(site)) {
      return json({ error: 'Invalid site name' }, 400);
    }
    if (await env.ARTIFACTS.head(`sites/${site}/meta.json`)) {
      return json({ error: 'Site already claimed' }, 409);
    }

    const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    const siteId = `site_${crypto.randomUUID().replaceAll('-', '')}`;
    const metaKey = `sites/${site}/meta.json`;
    await env.ARTIFACTS.put(
      metaKey,
      JSON.stringify({
        site,
        // Permanent identity, independent of the (renamable, releasable) slug —
        // the future namespace key once custom domains land
        siteId,
        tokenHash: await sha256Hex(token),
        createdAt: new Date().toISOString(),
      })
    );

    // Claimed with a signed-in session: also record ownership in the core so
    // the site shows up on the account's dashboard.
    const sessionToken = sessionTokenFromRequest(request);
    let boundOrganization = null;
    if (sessionToken && coreConfigured(env)) {
      const session = await sessionAccount(request, env);
      const organization = organizationId
        ? session?.organizations?.find((candidate) => candidate.id === organizationId)
        : session?.organizations?.find((candidate) => candidate.is_default);
      if (!organization) {
        await env.ARTIFACTS.delete(metaKey);
        return json({ error: 'Organization not found' }, 404);
      }
      const bind = await coreRequest(env, '/v1/site-ownership', {
        body: { subdomain: site, organization_id: organization.id },
        bearer: sessionToken,
      });
      if (bind.status === 409) {
        await env.ARTIFACTS.delete(metaKey);
        return json({ error: 'Site owned' }, 409);
      }
      if (!bind.ok) {
        await env.ARTIFACTS.delete(metaKey);
        return json({ error: 'Organization binding failed' }, bind.status >= 400 && bind.status < 500 ? bind.status : 502);
      }
      await bindEmbedIdentity(env, site, organization);
      boundOrganization = organization;
    }

    return json({
      site, siteId, token, url: siteUrlFor(request, env, site),
      organizationId: boundOrganization?.id ?? null,
      publishableKey: boundOrganization?.publishable_key ?? null,
      embedBase: boundOrganization
        ? embedBaseFor(request, env, boundOrganization.publishable_key, siteId)
        : null,
    }, 201);
  }

  // Anonymous deploy (funnel flow 2): stage drafts + reserve the namespace.
  // Confirmation publishes both the hosted preview and stable embed module.
  if (url.pathname === '/api/deploys' && request.method === 'POST') {
    if (!claimAllowed(request, env)) {
      return json({ error: 'Deploys are restricted' }, 403);
    }
    if (!coreConfigured(env)) {
      return json({ error: 'Core unavailable' }, 503);
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid body' }, 400);
    }
    const { site, email, artifact, embeds, targetEmbed } = body ?? {};
    const componentPath = artifact?.config?.componentPath;
    if (
      typeof site !== 'string' || !SITE_NAME.test(site) || RESERVED.has(site) ||
      typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      (targetEmbed != null && (
        typeof targetEmbed !== 'object' || !EMBED_NAME.test(targetEmbed.name ?? '') ||
        !CUSTOM_ELEMENT_NAME.test(targetEmbed.tag ?? '') ||
        typeof embeds?.[targetEmbed.name] !== 'string'
      )) ||
      !Array.isArray(componentPath) || componentPath.length === 0 ||
      !componentPath.every((p) => typeof p === 'string' && /^[A-Za-z0-9_-]+$/.test(p))
    ) {
      return json({ error: 'Invalid deploy' }, 400);
    }
    if (await env.ARTIFACTS.head(`sites/${site}/meta.json`)) {
      return json({ error: 'Site already claimed' }, 409);
    }

    const metaKey = `sites/${site}/meta.json`;
    await env.ARTIFACTS.put(`sites/${site}/draft/${componentPath.join('/')}.json`, JSON.stringify(artifact));
    for (const [name, source] of Object.entries(embeds ?? {})) {
      if (!EMBED_NAME.test(name) || typeof source !== 'string') continue;
      await env.ARTIFACTS.put(`sites/${site}/draft/embed/${name}`, source, {
        httpMetadata: { contentType: 'text/javascript; charset=utf-8' },
      });
    }
    await env.ARTIFACTS.put(
      metaKey,
      JSON.stringify({
        site,
        siteId: `site_${crypto.randomUUID().replaceAll('-', '')}`,
        componentPath,
        embedName: targetEmbed?.name ?? null,
        embedTag: targetEmbed?.tag ?? null,
        status: 'drafted',
        createdAt: new Date().toISOString(),
      })
    );

    const confirmation = await coreRequest(env, '/v1/confirmations', {
      body: { email: email.trim().toLowerCase(), subdomain: site },
    });
    if (!confirmation.ok) {
      await env.ARTIFACTS.delete(metaKey);
      const drafts = await listAllObjects(env.ARTIFACTS, `sites/${site}/draft/`);
      for (const object of drafts) await env.ARTIFACTS.delete(object.key);
      const code = await confirmation
        .clone()
        .json()
        .then((body) => body?.error?.code ?? '')
        .catch(() => '');
      if (confirmation.status === 429) return json({ error: 'Too many requests' }, 429);
      return json({ error: 'Confirmation failed' }, 502);
    }
    return json({ site }, 201);
  }

  // Register-first (funnel flow 1): email-only confirmation, no subdomain.
  if (url.pathname === '/api/register' && request.method === 'POST') {
    if (!claimAllowed(request, env)) {
      return json({ error: 'Registration is restricted' }, 403);
    }
    if (!coreConfigured(env)) {
      return json({ error: 'Core unavailable' }, 503);
    }
    let email;
    try {
      ({ email } = await request.json());
    } catch {
      return json({ error: 'Invalid body' }, 400);
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Invalid email' }, 400);
    }
    const confirmation = await coreRequest(env, '/v1/confirmations', {
      body: { email: email.trim().toLowerCase() },
    });
    if (!confirmation.ok) {
      if (confirmation.status === 429) return json({ error: 'Too many requests' }, 429);
      return json({ error: 'Confirmation failed' }, 502);
    }
    return json({ ok: true }, 201);
  }

  if (url.pathname === '/api/organizations' && request.method === 'POST') {
    const sessionToken = sessionTokenFromRequest(request);
    if (!sessionToken || !coreConfigured(env)) return json({ error: 'Unauthorized' }, 401);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid body' }, 400);
    }
    const response = await coreRequest(env, '/v1/organizations', { body, bearer: sessionToken });
    return new Response(response.body, {
      status: response.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  if (url.pathname === '/api/me' && request.method === 'GET') {
    const session = await sessionAccount(request, env);
    if (!session) return json({ error: 'Unauthorized' }, 401);
    const organizations = session.organizations ?? [];
    const sites = organizations.flatMap((organization) => organization.sites ?? []);
    const siteUrls = Object.fromEntries(sites.map((s) => [s, siteUrlFor(request, env, s)]));
    const organizationViews = organizations.map((organization) => ({
      ...organization,
      siteUrls: Object.fromEntries((organization.sites ?? []).map((site) => [site, siteUrlFor(request, env, site)])),
    }));
    await Promise.all(
      organizationViews.flatMap((organization) =>
        (organization.sites ?? []).map((site) => bindEmbedIdentity(env, site, organization))
      )
    );
    return json({
      id: session.account.id, email: session.account.email,
      organizations: organizationViews, sites, siteUrls,
    });
  }

  // Logout: revoke the session in core (best-effort) and clear the cookie.
  // Must never fail — a user who wants out gets out.
  if (url.pathname === '/api/logout' && request.method === 'POST') {
    const sessionToken = sessionTokenFromRequest(request);
    if (sessionToken) {
      if (coreConfigured(env)) {
        await coreRequest(env, '/v1/sessions/logout', { method: 'POST', bearer: sessionToken }).catch(() => {});
      }
    }
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    return new Response(null, {
      status: 204,
      headers: {
        'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
      },
    });
  }

  // Local-testing mailbox: proxies the core's dev-only confirmations list
  // (404s in prod, where the core refuses the endpoint).
  if (url.pathname === '/api/dev/mailbox' && request.method === 'GET') {
    if (!coreConfigured(env)) return json({ error: 'Core unavailable' }, 503);
    const mailbox = await coreRequest(env, '/v1/dev/confirmations');
    return new Response(mailbox.body, {
      status: mailbox.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const assetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/(.+)$/);
  if (assetMatch) {
    const [, site, name] = assetMatch;
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (!SITE_NAME.test(site) || name.includes('..') || !ASSET_TYPES[ext]) {
      return json({ error: 'Bad request' }, 400);
    }

    if (request.method === 'GET') {
      const object = await env.ARTIFACTS.get(`sites/${site}/assets/${name}`);
      if (!object) return json({ error: 'Not found' }, 404);
      return new Response(object.body, {
        headers: {
          'Content-Type': ASSET_TYPES[ext],
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    if (request.method === 'PUT') {
      const denied = await requireClaimToken(request, env, site);
      if (denied) return denied;
      const body = await request.arrayBuffer();
      const hash = (await sha256Hex(body)).slice(0, 12);
      const finalName = `${hash}.${ext}`;
      await env.ARTIFACTS.put(`sites/${site}/assets/${finalName}`, body, {
        httpMetadata: { contentType: ASSET_TYPES[ext] },
      });
      return json({ url: `${url.origin}/api/assets/${site}/${finalName}` }, 201);
    }
  }

  const artifactMatch = url.pathname.match(/^\/api\/artifacts\/([^/]+)\/(.+)$/);
  if (artifactMatch) {
    const [, site, artifactPath] = artifactMatch;
    if (!SITE_NAME.test(site) || artifactPath.includes('..')) {
      return json({ error: 'Bad request' }, 400);
    }
    const key = `sites/${site}/${decodeURIComponent(artifactPath)}.json`;

    if (request.method === 'GET') {
      const object = await env.ARTIFACTS.get(key);
      if (!object) return json({ error: 'Not found' }, 404);
      return new Response(object.body, { headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method === 'PUT') {
      const denied = await requireClaimToken(request, env, site);
      if (denied) return denied;
      await env.ARTIFACTS.put(key, request.body);
      return new Response(null, { status: 204 });
    }
  }

  // Per-client embed modules: published by the editor, fetched cross-origin
  // by embedding pages (also served on site hosts as /embed/<name>.js)
  const embedMatch = url.pathname.match(/^\/api\/embeds\/([^/]+)\/([^/]+)$/);
  if (embedMatch) {
    const [, site, rawName] = embedMatch;
    const name = decodeURIComponent(rawName);
    if (!SITE_NAME.test(site) || !EMBED_NAME.test(name)) {
      return json({ error: 'Bad request' }, 400);
    }
    if (request.method === 'GET') {
      return serveEmbed(env, site, name);
    }
    if (request.method === 'PUT') {
      const denied = await requireClaimToken(request, env, site);
      if (denied) return denied;
      await env.ARTIFACTS.put(`sites/${site}/embed/${name}`, request.body, {
        httpMetadata: { contentType: 'text/javascript; charset=utf-8' },
      });
      return new Response(null, { status: 204 });
    }
  }

  // Namespace listing: everything published under a site, for the dashboard
  // and agents. Same shape as the Vite dev store's listing, so adapters
  // cannot tell the backends apart.
  const listMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/list$/);
  if (listMatch && request.method === 'GET') {
    const site = listMatch[1];
    if (!SITE_NAME.test(site)) return json({ error: 'Bad request' }, 400);
    const denied = await requireClaimToken(request, env, site);
    if (denied) return denied;

    const prefix = `sites/${site}/`;
    const listed = await listAllObjects(env.ARTIFACTS, prefix);
    const entries = [];
    for (const object of listed) {
      const key = object.key.slice(prefix.length);
      if (key === 'meta.json' || key.startsWith('assets/')) continue;
      const updatedAt = object.uploaded?.toISOString?.() ?? null;
      if (key.startsWith('embed/') && key.endsWith('.js')) {
        entries.push({ path: key.split('/'), kind: 'embed', updatedAt });
      } else if (key.endsWith('.json')) {
        entries.push({ path: key.slice(0, -'.json'.length).split('/'), kind: 'artifact', updatedAt });
      }
    }
    const metaObject = await env.ARTIFACTS.get(`sites/${site}/meta.json`);
    const meta = metaObject ? await metaObject.json() : null;
    const embedBase = meta?.publishableKey && meta?.siteId
      ? embedBaseFor(request, env, meta.publishableKey, meta.siteId)
      : null;
    return json({
      site, siteId: meta?.siteId ?? null, organizationId: meta?.organizationId ?? null,
      publishableKey: meta?.publishableKey ?? null, embedBase,
      componentPath: meta?.componentPath ?? ['pages', 'Landing'],
      entries,
    });
  }

  return json({ error: 'Not found' }, 404);
}

// --- Email-confirmation landing (the magic link points here) ---

function messagePage(title, message, links = [], status = 200, snippet = '') {
  const linkHtml = links
    .map(([href, label]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`)
    .join(' · ');
  const snippetHtml = snippet
    ? `<section><label for="embed-code">Copy and paste this embed code</label>
       <textarea id="embed-code" readonly rows="4">${escapeHtml(snippet)}</textarea>
       <button type="button" data-copy>Copy embed code</button></section>`
    : '';
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f3f4f6}
    main{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:40px;width:min(620px,calc(100vw - 32px));text-align:center}
    h1{font-size:1.3rem;margin:0 0 8px}p{color:#6b7280;margin:0 0 16px}a{color:#4f46e5}
    section{margin-top:24px;text-align:left}label{display:block;font-weight:600;margin-bottom:8px}
    textarea{box-sizing:border-box;width:100%;resize:vertical;padding:12px;border:1px solid #d1d5db;border-radius:8px;font:12px/1.5 ui-monospace,monospace}
    button{margin-top:8px;padding:9px 14px;border:0;border-radius:8px;background:#111827;color:#fff;font-weight:600;cursor:pointer}</style></head>
    <body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${linkHtml}${snippetHtml}</main>
    <script>document.querySelector('[data-copy]')?.addEventListener('click',async(event)=>{
      const field=document.getElementById('embed-code');field.select();
      try{await navigator.clipboard.writeText(field.value);event.currentTarget.textContent='Copied';}
      catch{document.execCommand('copy');event.currentTarget.textContent='Copied';}
    });</script></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}

async function handleConfirm(request, env, url) {
  const token = url.searchParams.get('token') ?? '';
  if (!token) return messagePage('Invalid link', 'This confirmation link is missing its token.', [], 400);
  if (!coreConfigured(env)) return messagePage('Unavailable', 'Confirmation is not available right now.', [], 503);

  const response = await coreRequest(env, '/v1/confirmations/verify', { body: { token } });
  if (!response.ok) {
    if (response.status === 409) {
      return messagePage(
        'That name was taken in the meantime',
        'Someone else claimed this subdomain before you confirmed. Head back to the editor and pick another name.',
        [['/edit/', 'Back to the editor']],
        409
      );
    }
    // A used link is the only thing in the user's inbox — it must stay a way
    // back in. With a live session, send them straight to their dashboard.
    const session = await sessionAccount(request, env);
    if (session) {
      return Response.redirect(new URL('/dashboard/', url.origin), 302);
    }
    return messagePage(
      'Link already used or expired',
      'If you confirmed on this device before, your dashboard is still yours — open it and enter your email to get a fresh sign-in link.',
      [['/dashboard/', 'Go to your dashboard']],
      401
    );
  }

  const { account, organization, subdomain, session } = await response.json();
  let embedSnippet = '';
  if (subdomain) {
    const metaKey = `sites/${subdomain}/meta.json`;
    const metaObj = await env.ARTIFACTS.get(metaKey);
    if (metaObj) {
      const meta = await metaObj.json();
      if (meta.status === 'drafted') {
        await promoteSite(env, subdomain);
        await env.ARTIFACTS.put(
          metaKey,
          JSON.stringify({
            ...meta,
            status: 'published',
            ownerAccountId: account.id,
            organizationId: organization.id,
            publishableKey: organization.publishable_key,
            confirmedAt: new Date().toISOString(),
            publishedAt: new Date().toISOString(),
          })
        );
      }
      await bindEmbedIdentity(env, subdomain, organization);
      if (meta.embedName && meta.embedTag) {
        const artifactPath = Array.isArray(meta.componentPath) && meta.componentPath.length > 0
          ? meta.componentPath.join('/')
          : HOME_ARTIFACT;
        const artifactObject = await env.ARTIFACTS.get(`sites/${subdomain}/${artifactPath}.json`);
        const artifact = artifactObject ? await artifactObject.json() : null;
        const attributes = embedAttributesForArtifact(artifact, meta.embedName);
        const embedBase = embedBaseFor(request, env, organization.publishable_key, meta.siteId);
        embedSnippet = `<script type="module" src="${embedBase}/${meta.embedName}"></script>\n` +
          `<${meta.embedTag}${attributes ? ` ${attributes}` : ''}></${meta.embedTag}>`;
      }
    }
  }

  const siteUrl = subdomain ? siteUrlFor(request, env, subdomain) : null;
  const page = messagePage(
    'Email confirmed',
    subdomain
      ? 'Your component is published. Preview it or copy its embed code below.'
      : 'You are signed in.',
    [...(siteUrl ? [[siteUrl, 'Open preview']] : []), ['/dashboard/', 'Go to your dashboard']],
    200,
    embedSnippet
  );
  const headers = new Headers(page.headers);
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`
  );
  return new Response(page.body, { status: 200, headers });
}

async function serveEmbed(env, site, name) {
  const object = await env.ARTIFACTS.get(`sites/${site}/embed/${name}`);
  if (!object) return json({ error: 'Not found' }, 404);
  return withCors(
    new Response(object.body, {
      headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        // Mutable by design: re-publishing must reach every embed on next load
        'Cache-Control': 'no-store',
      },
    })
  );
}

function embedAttributesForArtifact(artifact, embedName) {
  const instance = [...(artifact?.content?.components ?? [])]
    .reverse()
    .find((component) => `${component.componentPath?.at(-1)}.js` === embedName);
  if (!instance) return '';
  return Object.entries(instance.attributes ?? {})
    .filter(([name, value]) =>
      /^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(name) &&
      !['id', 'class', 'style'].includes(name) &&
      !name.startsWith('data-gjs') && value !== false && value != null
    )
    .map(([name, value]) => value === true
      ? name
      : `${name}="${String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('"', '&quot;')
          .replaceAll('<', '&lt;')}"`)
    .join(' ');
}

async function bindEmbedIdentity(env, site, organization) {
  if (!organization?.id || !PUBLISHABLE_KEY.test(organization.publishable_key ?? '')) return;
  const metaKey = `sites/${site}/meta.json`;
  const metaObject = await env.ARTIFACTS.get(metaKey);
  if (!metaObject) return;
  const meta = await metaObject.json();
  if (!SITE_ID.test(meta.siteId ?? '')) return;
  const nextMeta = {
    ...meta,
    organizationId: organization.id,
    publishableKey: organization.publishable_key,
  };
  if (meta.organizationId !== nextMeta.organizationId || meta.publishableKey !== nextMeta.publishableKey) {
    await env.ARTIFACTS.put(metaKey, JSON.stringify(nextMeta));
  }
  await env.ARTIFACTS.put(
    `embed-identities/${organization.publishable_key}/${meta.siteId}.json`,
    JSON.stringify({
      site,
      siteId: meta.siteId,
      organizationId: organization.id,
      publishableKey: organization.publishable_key,
    })
  );
}

async function servePublicEmbed(env, publishableKey, siteId, name) {
  const identityObject = await env.ARTIFACTS.get(`embed-identities/${publishableKey}/${siteId}.json`);
  if (!identityObject) return json({ error: 'Not found' }, 404);
  const identity = await identityObject.json();
  if (identity.publishableKey !== publishableKey || identity.siteId !== siteId || !SITE_NAME.test(identity.site ?? '')) {
    return json({ error: 'Not found' }, 404);
  }
  const metaObject = await env.ARTIFACTS.get(`sites/${identity.site}/meta.json`);
  if (!metaObject) return json({ error: 'Not found' }, 404);
  const meta = await metaObject.json();
  if (
    meta.siteId !== siteId || meta.publishableKey !== publishableKey ||
    meta.organizationId !== identity.organizationId || meta.status === 'drafted'
  ) {
    return json({ error: 'Not found' }, 404);
  }
  return serveEmbed(env, identity.site, name);
}

async function listAllObjects(bucket, prefix) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

async function proxyCore(request, env, url) {
  if (!env.CORE_URL || !env.CORE_SERVICE_KEY) {
    return json({ error: 'Core unavailable' }, 503);
  }

  const corePath = url.pathname.slice('/api/core'.length);
  if (!corePath.startsWith('/v1/')) {
    return json({ error: 'Not found' }, 404);
  }

  // Coarse edge abuse protection. The authoritative per-organization limit lives in
  // Postgres in the core; this IP bucket also covers callers with invalid or
  // deliberately changing Authorization headers. The binding is optional in
  // the Node verification and local setups that do not configure it.
  if (env.CORE_RATE_LIMITER) {
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const operation = coreRateLimitOperation(corePath);
    const { success } = await env.CORE_RATE_LIMITER.limit({ key: `${operation}:${clientIP}` });
    if (!success) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      });
    }
  }

  const target = new URL(corePath + url.search, env.CORE_URL);
  const headers = new Headers(request.headers);
  headers.delete(CORE_SERVICE_HEADER);
  headers.delete(CORE_CLIENT_IP_HEADER);
  headers.set(CORE_SERVICE_HEADER, `Bearer ${env.CORE_SERVICE_KEY}`);
  const clientIP = request.headers.get('CF-Connecting-IP');
  if (clientIP) headers.set(CORE_CLIENT_IP_HEADER, clientIP);

  return fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    // Required by Node's fetch in the proxy verification; ignored by Workers.
    duplex: 'half',
    redirect: 'manual',
  });
}

function coreRateLimitOperation(path) {
  if (path === '/v1/clients') return 'clients';
  if (path === '/v1/component-sessions') return 'component-sessions';
  if (path === '/v1/components' || path.startsWith('/v1/components/')) return 'components';
  return 'other';
}

// Copies everything under sites/<site>/draft/ to the live keys and removes
// the drafts. Runs at most a handful of objects; re-runs are no-ops.
async function promoteSite(env, site) {
  const prefix = `sites/${site}/draft/`;
  const listed = await listAllObjects(env.ARTIFACTS, prefix);
  for (const object of listed) {
    const rest = object.key.slice(prefix.length);
    const source = await env.ARTIFACTS.get(object.key);
    if (!source) continue;
    const contentType = rest.startsWith('embed/')
      ? 'text/javascript; charset=utf-8'
      : 'application/json';
    await env.ARTIFACTS.put(`sites/${site}/${rest}`, source.body, {
      httpMetadata: { contentType },
    });
    await env.ARTIFACTS.delete(object.key);
  }
}

// Loader served while a subdomain is drafted/armed. Polls the artifact and
// reloads when email confirmation publishes it. The armed branch remains for
// deployments created by earlier Worker versions.
function renderLoader(site, base) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Deploying ${escapeHtml(site)}…</title>
    <style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f3f4f6}
    main{text-align:center;color:#6b7280}
    .spin{width:36px;height:36px;margin:0 auto 16px;border:3px solid #e5e7eb;border-top-color:#4f46e5;border-radius:50%;animation:r 0.8s linear infinite}
    @keyframes r{to{transform:rotate(360deg)}}</style></head>
    <body><main><div class="spin"></div>
    <p><strong>${escapeHtml(site)}</strong> is deploying…</p>
    <p>If you haven't yet, confirm the email we sent you — the site goes live right after.</p></main>
    <script>
      setInterval(async () => {
        try {
          const res = await fetch(${JSON.stringify(base + 'artifact.json')}, { cache: 'no-store' });
          if (res.ok) location.reload();
        } catch {}
      }, 2000);
    </script></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}

async function serveSite(request, env, site, path, base) {
  // Component modules resolve on the site host too (shared assets)
  if (path.startsWith('/components/')) {
    return withCors(await env.ASSETS.fetch(new Request(new URL(path, request.url), request)));
  }

  // Funnel state machine. Missing status = published (legacy sites).
  const metaKey = `sites/${site}/meta.json`;
  const metaObj = await env.ARTIFACTS.get(metaKey);
  const meta = metaObj ? await metaObj.json() : null;
  if (meta?.status === 'drafted') {
    // Not armed yet: nothing serves — loader for humans, 404 for data paths
    if (path === '/artifact.json' || path.startsWith('/embed/')) {
      return json({ error: 'Not published' }, 404);
    }
    return renderLoader(site, base);
  }
  if (meta?.status === 'armed') {
    // Lazy publish: ANY visit to an armed subdomain promotes it
    await promoteSite(env, site);
    await env.ARTIFACTS.put(
      metaKey,
      JSON.stringify({ ...meta, status: 'published', publishedAt: new Date().toISOString() })
    );
  }

  // Per-client embed modules on the site host: /embed/<Component>.js
  const embedMatch = path.match(/^\/embed\/([^/]+)$/);
  if (embedMatch && EMBED_NAME.test(embedMatch[1])) {
    return serveEmbed(env, site, embedMatch[1]);
  }

  const artifactPath = Array.isArray(meta?.componentPath) && meta.componentPath.length > 0
    ? meta.componentPath.join('/')
    : HOME_ARTIFACT;
  const object = await env.ARTIFACTS.get(`sites/${site}/${artifactPath}.json`);

  if (path === '/artifact.json') {
    if (!object) return json({ error: 'Not published' }, 404);
    return new Response(object.body, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const artifact = object ? await object.json() : null;
  return new Response(renderSiteShell(site, artifact, base), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function renderSiteShell(site, artifact, base) {
  const modulePaths = [
    ...new Set((artifact?.content?.components ?? []).map((c) => c.componentPath.join('/'))),
  ];
  const moduleScripts = modulePaths
    .map((p) => `<script type="module" src="${base}components/${p}.js"></script>`)
    .join('\n    ');

  const body = artifact
    ? artifact.snapshot.html
    : `<p style="font-family: sans-serif; color: #6b7280; padding: 48px;">
         Nothing published to <strong>${site}</strong> yet — it will appear here the moment it is.
       </p>`;

  const page = artifact?.content?.page ?? {};
  const title = escapeHtml(page.title || site);
  const description = page.description
    ? `<meta name="description" content="${escapeHtml(page.description)}" />
    <meta property="og:description" content="${escapeHtml(page.description)}" />`
    : '';

  const snapshotText = `${artifact?.snapshot.css ?? ''}\n${artifact?.snapshot.html ?? ''}`;
  const usedFonts = GOOGLE_FONTS.filter((f) => snapshotText.includes(f));
  const fontLinks = usedFonts.length
    ? `<link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${usedFonts
      .map((f) => `family=${f.replaceAll(' ', '+')}:wght@400;700`)
      .join('&')}&display=swap" />`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta property="og:title" content="${title}" />
    ${description}
    ${fontLinks}
    <style>${BASE_RESET_CSS}</style>
    <style id="archura-css">${artifact?.snapshot.css ?? ''}</style>
  </head>
  <body>
    <div id="archura-root">${body}</div>
    ${moduleScripts}
    <script type="module">
      // Live updates: poll the artifact and re-render in place on re-publish
      let lastUpdated = ${JSON.stringify(artifact?.meta.updatedAt ?? null)};
      setInterval(async () => {
        try {
          const response = await fetch('${base}artifact.json', { cache: 'no-store' });
          if (!response.ok) return;
          const artifact = await response.json();
          if (artifact.meta.updatedAt === lastUpdated) return;
          lastUpdated = artifact.meta.updatedAt;
          document.getElementById('archura-css').textContent = artifact.snapshot.css;
          document.getElementById('archura-root').innerHTML = artifact.snapshot.html;
          const paths = [...new Set((artifact.content?.components ?? []).map((c) => c.componentPath.join('/')))];
          await Promise.all(paths.map((p) => import(\`${base}components/\${p}.js\`)));
        } catch {
          // transient network failure: try again next tick
        }
      }, 3000);
    </script>
  </body>
</html>`;
}
