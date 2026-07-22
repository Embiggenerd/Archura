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

// Includes infrastructure hostnames (core, staging-core, staging) — a customer
// claiming one of those subdomains would shadow proxied infrastructure under
// the *.archura.ai wildcard.
const RESERVED = new Set(['www', 'api', 'app', 'editor', 'assets', 'components', 'embed', 's', 'core', 'staging', 'staging-core']);
const SITE_NAME = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
// A design: a top-level embeddable artifact owned by an organization, stored
// under orgs/<orgId>/designs/<designId>/ independent of any subdomain.
const DESIGN_ID = /^dsn_[a-f0-9]{24,}$/;
const ORG_ID = /^[0-9a-fA-F][0-9a-fA-F-]{7,}$/;
const SITE_ID = /^site_[a-f0-9]{32}$/;
const PUBLISHABLE_KEY = /^pk_(?:test|live)_[A-Za-z0-9_-]{20,}$/;
const CUSTOM_ELEMENT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const HOME_ARTIFACT = 'pages/Landing';

const BASE_RESET_CSS = `*, *::before, *::after { box-sizing: border-box; } body { margin: 0; }`;

const ASSET_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const CORE_SERVICE_HEADER = 'X-Archura-Service-Authorization';
const CORE_CLIENT_IP_HEADER = 'X-Archura-Client-IP';
const JSON_BODY_LIMIT = 1 * 1024 * 1024;
const EMBED_BODY_LIMIT = 512 * 1024;
const ASSET_BODY_LIMIT = 5 * 1024 * 1024;
const BILLING_RECOVERY_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

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
  return constantTimeEqual(new Uint8Array(provided), expected);
}

function constantTimeEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
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

    if (url.pathname === '/account') {
      return Response.redirect(new URL('/account/', request.url), 302);
    }

    // Legacy /<accountId>/dashboard/ links still serve the dashboard app;
    // the canonical URL is plain /dashboard/ (identity lives in the session —
    // an id in the path adds nothing while sessions hold exactly one account)
    const dashboardMatch = url.pathname.match(/^\/([0-9a-fA-F][0-9a-fA-F-]{7,})\/dashboard\/?$/);
    if (dashboardMatch) {
      return env.ASSETS.fetch(new Request(new URL('/dashboard/', request.url), request));
    }

    // The ops console is a small SPA with real paths (/ops/orgs/<id>,
    // /ops/accounts, /ops/plan) — serve the /ops/ index for all of them so
    // deep links and reloads work. Its script assets live under /assets/.
    if (url.pathname === '/ops') {
      return Response.redirect(new URL('/ops/', url.origin), 302);
    }
    if (url.pathname.startsWith('/ops/') && url.pathname !== '/ops/' && request.method === 'GET') {
      return env.ASSETS.fetch(new Request(new URL('/ops/', request.url), request));
    }

    if (url.pathname.startsWith('/api/')) {
      return serveApi(request, env, url);
    }

    // Signed-in visitors to the marketing homepage go straight to their
    // dashboard. Cookie-presence only (no core round-trip on an anonymous
    // marketing page); a stale cookie just lands on the dashboard's own
    // sign-in. Bare "/" only — legacy /?site= /?component= deep links are
    // left for index.html to route into the editor.
    if (url.pathname === '/' && url.search === '' && sessionTokenFromRequest(request)) {
      return Response.redirect(new URL('/dashboard/', url.origin), 302);
    }

    // Editor app + built component modules
    const assetResponse = await env.ASSETS.fetch(request);
    if (url.pathname.startsWith('/components/')) {
      return withCors(assetResponse);
    }
    return assetResponse;
  },

  async scheduled(_controller, env, ctx) {
    // Sequential: reconciliation walks the same sites/ prefix the expiry pass
    // lists, so running it after avoids racing deletes against entitlement reads.
    ctx.waitUntil(cleanupExpiredSites(env).then(() => reconcileDeletedOrganizations(env)));
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

async function readBoundedBody(request, limit) {
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(declared) && declared > limit) throw new RangeError('body_too_large');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new RangeError('body_too_large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function readBoundedJSON(request, limit = JSON_BODY_LIMIT) {
  const body = await readBoundedBody(request, limit);
  return JSON.parse(new TextDecoder().decode(body));
}

async function rateLimitRequest(request, env, operation) {
  if (!env.CORE_RATE_LIMITER) return null;
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.CORE_RATE_LIMITER.limit({ key: `${operation}:${clientIP}` });
  if (success) return null;
  return new Response(JSON.stringify({ error: 'Too many requests' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '60' },
  });
}

// --- Core (Go) plumbing: service-authed requests + account sessions ---

function coreConfigured(env) {
  return !!(env.CORE_URL && env.CORE_SERVICE_KEY);
}

function anonymousSiteClaimsAllowed(env) {
  return env.ALLOW_ANONYMOUS_SITE_CLAIMS === 'true';
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

// Resolve the request's session to the given organization IF the account is a
// member. Returns the org view (from /api/me) or null. Design storage is
// org-scoped, so every design route gates on membership.
async function sessionOrganization(request, env, organizationId) {
  const session = await sessionAccount(request, env);
  return session?.organizations?.find((org) => org.id === organizationId) ?? null;
}

async function organizationEntitlement(env, organizationId, { fresh = false } = {}) {
  if (!coreConfigured(env) || !organizationId) throw new Error('billing_unavailable');
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(`https://entitlement.archura.internal/${encodeURIComponent(organizationId)}`);
  if (!fresh && cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached.json();
  }
  // Machine-invoked (serve time, no user session): authenticated by the
  // internal key — the core no longer serves entitlement to bare callers.
  const response = await coreRequest(env, `/v1/organizations/${encodeURIComponent(organizationId)}/entitlement`, {
    bearer: env.CORE_INTERNAL_KEY,
  });
  if (!response.ok) {
    const error = new Error(`billing_${response.status}`);
    error.status = response.status;
    throw error;
  }
  const entitlement = await response.json();
  if (cache) {
    await cache.put(cacheKey, new Response(JSON.stringify(entitlement), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' },
    }));
  }
  return entitlement;
}

// Ask core whether `organizationId` may deploy the components an artifact
// declares (its top-level componentPath + each nested instance's componentPath).
// Returns null when allowed (or when core isn't configured — local dev), or a
// Response (e.g. 402 component_requires_paid) to pass straight back to the client.
async function deployCheck(env, organizationId, artifact) {
  if (!coreConfigured(env) || !organizationId) return null;
  const asPath = (value) => (Array.isArray(value) ? value.join('/') : typeof value === 'string' ? value : '');
  const topLevel = asPath(artifact?.config?.componentPath);
  const uses = [
    ...new Set(
      (artifact?.content?.components ?? [])
        .map((component) => asPath(component?.componentPath))
        .filter((path) => path !== '')
    ),
  ];
  const response = await coreRequest(env, `/v1/organizations/${encodeURIComponent(organizationId)}/deploy-check`, {
    method: 'POST',
    body: { top_level: topLevel, uses },
    bearer: env.CORE_INTERNAL_KEY,
  });
  if (response.ok) return null;
  // Pass core's error (e.g. 402 component_requires_paid) through verbatim so the
  // client can show the upgrade/register modal.
  return new Response(response.body, {
    status: response.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function startOrganizationTrial(env, organizationId, bearer) {
  if (!coreConfigured(env) || !organizationId || !bearer) throw new Error('billing_unavailable');
  const response = await coreRequest(
    env,
    `/v1/organizations/${encodeURIComponent(organizationId)}/billing/start-trial`,
    { method: 'POST', bearer }
  );
  if (!response.ok) throw new Error(`billing_${response.status}`);
  return response.json();
}

async function requireSiteEditEntitlement(request, env, site, { startTrial = false } = {}) {
  if (!coreConfigured(env)) return null;
  const metaObject = await env.ARTIFACTS.get(`sites/${site}/meta.json`);
  const meta = metaObject ? await metaObject.json() : null;
  if (!meta?.organizationId) {
    if (anonymousSiteClaimsAllowed(env)) return null;
    return json({ error: 'This site must belong to an organization before it can be published.' }, 409);
  }
  let entitlement;
  try {
    entitlement = startTrial && !meta.trialStartedAt
      ? await startOrganizationTrial(env, meta.organizationId, sessionTokenFromRequest(request))
      : await organizationEntitlement(env, meta.organizationId, { fresh: true });
  } catch {
    return json({ error: 'Billing is temporarily unavailable.' }, 503);
  }
  if (!entitlement.can_edit) {
    return json({ error: 'This organization needs an active subscription to publish changes.', billing: entitlement }, 402);
  }
  if (startTrial && !meta.trialStartedAt) {
    await env.ARTIFACTS.put(`sites/${site}/meta.json`, JSON.stringify({
      ...meta,
      trialStartedAt: new Date().toISOString(),
    }));
  }
  return null;
}

function billingRecoveryDeadline(entitlement) {
  const servingEndedAt = Date.parse(entitlement.serve_grace_ends_at ?? '');
  const start = Number.isFinite(servingEndedAt) ? servingEndedAt : Date.now();
  return new Date(start + BILLING_RECOVERY_WINDOW_MS).toISOString();
}

async function updateBillingRecoveryMetadata(env, site, meta, entitlement) {
  if (!site || !meta) return;
  const metaKey = `sites/${site}/meta.json`;
  if (entitlement.status === 'expired') {
    const billingRecoveryDeleteAfter = billingRecoveryDeadline(entitlement);
    if (meta.billingRecoveryDeleteAfter !== billingRecoveryDeleteAfter) {
      await env.ARTIFACTS.put(metaKey, JSON.stringify({ ...meta, billingRecoveryDeleteAfter }));
    }
    return;
  }
  if (entitlement.can_serve && meta.billingRecoveryDeleteAfter) {
    const { billingRecoveryDeleteAfter: _removed, ...restoredMeta } = meta;
    await env.ARTIFACTS.put(metaKey, JSON.stringify(restoredMeta));
  }
}

async function siteServingDenied(env, meta, site) {
  if (meta?.moderation?.status === 'suspended') {
    return new Response('This site is unavailable.', {
      status: 451,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  if (!meta?.organizationId || !coreConfigured(env)) return null;
  try {
    const entitlement = await organizationEntitlement(env, meta.organizationId);
    await updateBillingRecoveryMetadata(env, site, meta, entitlement);
    if (entitlement.can_serve || entitlement.status === 'unstarted') return null;
    return new Response('This site is unavailable until its subscription is active.', {
      status: 402,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error?.status && error.status < 500) {
      return new Response('This site is unavailable.', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    console.log(JSON.stringify({ event: 'billing_entitlement_unavailable', organization_id: meta.organizationId }));
    return null;
  }
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

function moderationReasons(artifact) {
  const html = String(artifact?.snapshot?.html ?? '');
  const reasons = [];
  if (/<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(html)) reasons.push('password_collection');
  if (/<form\b[^>]*\baction\s*=\s*["']?https?:\/\//i.test(html)) reasons.push('external_form_action');
  if (/<(?:script|iframe|object|embed)\b/i.test(html)) reasons.push('active_embedded_content');
  if (/\son[a-z]+\s*=/i.test(html)) reasons.push('inline_event_handler');
  if (/\b(?:href|src|action)\s*=\s*["']?\s*javascript:/i.test(html)) reasons.push('javascript_url');
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?refresh\b/i.test(html)) reasons.push('meta_refresh');
  const links = html.match(/<a\b[^>]*\bhref\s*=/gi)?.length ?? 0;
  const externalLinks = html.match(/<a\b[^>]*\bhref\s*=\s*["']?https?:\/\//gi)?.length ?? 0;
  if (externalLinks >= 20 && externalLinks / Math.max(links, 1) >= 0.8) reasons.push('excessive_external_links');
  return [...new Set(reasons)];
}

async function recordModerationResult(env, site, artifact) {
  const metaKey = `sites/${site}/meta.json`;
  const metaObject = await env.ARTIFACTS.get(metaKey);
  if (!metaObject) return;
  const meta = await metaObject.json();
  const reasons = moderationReasons(artifact);
  const suspended = meta.moderation?.status === 'suspended';
  const now = new Date().toISOString();
  const moderation = {
    status: suspended ? 'suspended' : reasons.length ? 'flagged' : 'active',
    reasons,
    updatedAt: now,
    ...(reasons.length ? { flaggedAt: meta.moderation?.flaggedAt ?? now } : {}),
    ...(suspended ? { suspendedAt: meta.moderation?.suspendedAt ?? now } : {}),
  };
  await env.ARTIFACTS.put(metaKey, JSON.stringify({ ...meta, moderation }));
  const flagKey = `moderation/flags/${site}.json`;
  if (reasons.length || suspended) {
    await env.ARTIFACTS.put(flagKey, JSON.stringify({
      site,
      organizationId: meta.organizationId ?? null,
      status: moderation.status,
      reasons,
      updatedAt: now,
    }));
    console.log(JSON.stringify({
      event: 'content_moderation_flagged', site, organization_id: meta.organizationId ?? null,
      reasons, status: moderation.status,
    }));
  } else {
    await env.ARTIFACTS.delete(flagKey);
  }
}

async function moderationAdminAuthorized(request, env) {
  const configured = env.MODERATION_ADMIN_KEY ?? '';
  const provided = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/, '');
  if (!configured || !provided) return false;
  const configuredDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(configured));
  const providedDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(provided));
  return constantTimeEqual(new Uint8Array(configuredDigest), new Uint8Array(providedDigest));
}

async function handleModerationApi(request, env, url) {
  if (!(await moderationAdminAuthorized(request, env))) return json({ error: 'Unauthorized' }, 401);
  if (url.pathname === '/api/moderation/flags' && request.method === 'GET') {
    const objects = await listAllObjects(env.ARTIFACTS, 'moderation/flags/');
    const flags = [];
    for (const object of objects) {
      const stored = await env.ARTIFACTS.get(object.key);
      if (stored) flags.push(await stored.json());
    }
    return json({ flags });
  }
  const actionMatch = url.pathname.match(/^\/api\/moderation\/sites\/([^/]+)\/(suspend|restore)$/);
  if (!actionMatch || request.method !== 'POST' || !SITE_NAME.test(actionMatch[1])) {
    return json({ error: 'Not found' }, 404);
  }
  const [, site, action] = actionMatch;
  const metaKey = `sites/${site}/meta.json`;
  const metaObject = await env.ARTIFACTS.get(metaKey);
  if (!metaObject) return json({ error: 'Not found' }, 404);
  const meta = await metaObject.json();
  const now = new Date().toISOString();
  const reasons = meta.moderation?.reasons ?? [];
  const moderation = action === 'suspend'
    ? { ...meta.moderation, status: 'suspended', reasons, suspendedAt: now, updatedAt: now }
    : { ...meta.moderation, status: reasons.length ? 'flagged' : 'active', reasons, restoredAt: now, updatedAt: now };
  await env.ARTIFACTS.put(metaKey, JSON.stringify({ ...meta, moderation }));
  const flagKey = `moderation/flags/${site}.json`;
  if (moderation.status === 'active') {
    await env.ARTIFACTS.delete(flagKey);
  } else {
    await env.ARTIFACTS.put(flagKey, JSON.stringify({
      site, organizationId: meta.organizationId ?? null, status: moderation.status, reasons, updatedAt: now,
    }));
  }
  console.log(JSON.stringify({
    event: `content_moderation_${action}`, site, organization_id: meta.organizationId ?? null,
  }));
  return json({ site, moderation });
}

// --- Platform operations console (staff-gated BFF → core /v1/admin/*) ---
// The browser talks only to /api/ops/*; the Worker forwards to core's admin API
// with the session bearer and lets core enforce the platform_owner check (401/
// 403). Reads and free-plan PATCHes are pass-through; fork is orchestrated here
// because the Worker owns R2 (Core owns rows). Never mutates customer content —
// a fork only reads the source blob and writes a copy into the workspace.

const opsPassthrough = (response) =>
  new Response(response.body, {
    status: response.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// Which /api/ops/<rest> paths forward verbatim to /v1/admin/<rest>.
function opsForwardAllowed(method, rest) {
  if (method === 'GET') {
    return (
      rest === 'organizations' ||
      /^organizations\/[^/]+$/.test(rest) ||
      /^organizations\/[^/]+\/(designs|members)$/.test(rest) ||
      rest === 'accounts' ||
      /^accounts\/[^/]+$/.test(rest) ||
      rest === 'forks' ||
      rest === 'default-plan' ||
      rest === 'context'
    );
  }
  if (method === 'PATCH') {
    return rest === 'default-plan' || /^organizations\/[^/]+\/free-plan$/.test(rest);
  }
  return false;
}

async function handleOpsApi(request, env, url) {
  const sessionToken = sessionTokenFromRequest(request);
  if (!sessionToken || !coreConfigured(env)) return json({ error: 'Unauthorized' }, 401);
  const rest = url.pathname.slice('/api/ops/'.length);

  // POST /api/ops/forks — the one orchestrated flow (create row → copy blob → finalize).
  if (rest === 'forks' && request.method === 'POST') {
    return handleOpsFork(request, env, sessionToken);
  }

  // DELETE org/account — orchestrated: core deletes rows (auth + guards) and its
  // response names what to purge; the Worker then removes the R2 blobs. A failed
  // purge is reported as pending, not fatal — the nightly reconciliation sweep
  // converges leftovers, so rows stay authoritative.
  if (request.method === 'DELETE') {
    const orgMatch = rest.match(/^organizations\/([^/]+)$/);
    if (orgMatch) {
      return handleOpsDelete(env, `/v1/admin/organizations/${encodeURIComponent(orgMatch[1])}`, sessionToken, [orgMatch[1]]);
    }
    const accountMatch = rest.match(/^accounts\/([^/]+)$/);
    if (accountMatch) {
      return handleOpsDelete(env, `/v1/admin/accounts/${encodeURIComponent(accountMatch[1])}`, sessionToken, []);
    }
  }

  // GET /api/ops/designs/:id — core record enriched with R2 artifact presence.
  const designMatch = rest.match(/^designs\/([^/]+)$/);
  if (designMatch && request.method === 'GET') {
    const response = await coreRequest(env, `/v1/admin/designs/${encodeURIComponent(designMatch[1])}`, {
      bearer: sessionToken,
    });
    if (!response.ok) return opsPassthrough(response);
    const record = await response.json();
    return json({ ...record, artifacts: await designArtifactPresence(env, record) });
  }

  // Everything else on the allowlist: gate-then-forward verbatim (core enforces staff).
  if (!opsForwardAllowed(request.method, rest)) return json({ error: 'Not found' }, 404);
  let body;
  if (request.method === 'PATCH') {
    try {
      body = await readBoundedJSON(request);
    } catch {
      return json({ error: 'Invalid body' }, 400);
    }
  }
  return opsPassthrough(
    await coreRequest(env, `/v1/admin/${rest}${url.search}`, { method: request.method, bearer: sessionToken, body })
  );
}

// Orchestrate a fork: core mints the row + gates staff; the Worker copies the
// source design's artifact into the workspace namespace, then finalizes. Core's
// fork create returns the fork's design record: id (the fork), organization_id
// (the workspace), forked_from (source design), source_org_id, and component_path
// (copied from the source, used as template_ref when there is no stored artifact).
async function handleOpsFork(request, env, sessionToken) {
  let input;
  try {
    input = await readBoundedJSON(request);
  } catch {
    return json({ error: 'Invalid body' }, 400);
  }
  const sourceDesignId = input.source_design_id;
  if (!DESIGN_ID.test(sourceDesignId ?? '')) return json({ error: 'Bad request' }, 400);

  // 1. Core creates the pending fork row (and 403s if the caller isn't staff, so
  //    the source blob below is only ever read for a platform owner).
  const created = await coreRequest(env, '/v1/admin/forks', {
    method: 'POST',
    bearer: sessionToken,
    body: { source_design_id: sourceDesignId, idempotency_key: crypto.randomUUID() },
  });
  if (!created.ok) return opsPassthrough(created);
  const fork = await created.json();
  const forkId = fork.id;
  const workspaceOrgId = fork.organization_id;
  const sourceOrgId = fork.source_org_id;
  const forkedFrom = fork.forked_from;

  const finalize = (finBody) =>
    coreRequest(env, `/v1/admin/forks/${encodeURIComponent(forkId)}/finalize`, {
      method: 'POST',
      bearer: sessionToken,
      body: finBody,
    }).then((r) => (r.ok ? r : Promise.reject(r)));

  try {
    // 2. Read the source design's canonical artifact.
    const source = await env.ARTIFACTS.get(`orgs/${sourceOrgId}/designs/${forkedFrom}/artifact.json`);
    let finBody;
    if (source) {
      // 3. Copy it into the workspace namespace (never touch the source).
      const bytes = await source.arrayBuffer();
      await env.ARTIFACTS.put(`orgs/${workspaceOrgId}/designs/${forkId}/artifact.json`, bytes, {
        httpMetadata: { contentType: 'application/json' },
      });
      finBody = { status: 'ready', source_artifact_kind: 'published', source_etag: source.etag ?? source.httpEtag ?? null };
    } else {
      // No stored artifact → the fork starts from the component template.
      finBody = { status: 'ready', source_artifact_kind: 'template', template_ref: fork.component_path ?? null };
    }
    // 4. Finalize ready.
    await finalize(finBody);
    return json(
      { fork_design_id: forkId, workspace_org_id: workspaceOrgId, component_path: fork.component_path ?? null },
      201
    );
  } catch (error) {
    // A core finalize rejection (Response) passes through; a copy error → 502.
    if (error instanceof Response) return opsPassthrough(error);
    await coreRequest(env, `/v1/admin/forks/${encodeURIComponent(forkId)}/finalize`, {
      method: 'POST',
      bearer: sessionToken,
      body: { status: 'failed' },
    }).catch(() => {});
    return json({ error: 'Fork copy failed' }, 502);
  }
}

// Delete an org or account through core, then purge the R2 blobs its response
// names (released_sites + deleted_organization_ids; org deletes pass their own
// id via extraOrgIds). Purges act only on the response — computed under core's
// transaction locks — never on preview data, which can be stale.
async function handleOpsDelete(env, corePath, sessionToken, extraOrgIds) {
  const response = await coreRequest(env, corePath, { method: 'DELETE', bearer: sessionToken });
  if (!response.ok) return opsPassthrough(response);
  const body = await response.json().catch(() => ({}));
  const orgIds = [...new Set([...extraOrgIds, ...(body.deleted_organization_ids ?? [])])];
  let purged = true;
  for (const site of body.released_sites ?? []) {
    purged = (await releaseSiteObjects(env, site).catch(() => false)) && purged;
  }
  for (const orgId of orgIds) {
    purged = (await purgePrefix(env, `orgs/${orgId}/`).catch(() => false)) && purged;
  }
  return json({ ...body, purge: purged ? 'complete' : 'pending' }, 200);
}

// Report which R2 artifact blobs a design has, so the read can show live/draft.
async function designArtifactPresence(env, record) {
  const orgId = record.organization_id ?? record.source_org_id;
  const designId = record.id ?? record.design_id;
  if (!orgId || !designId) return { published: false, draft: false };
  const base = `orgs/${orgId}/designs/${designId}`;
  const [published, draft] = await Promise.all([
    env.ARTIFACTS.get(`${base}/artifact.json`),
    env.ARTIFACTS.get(`${base}/artifact.draft.json`),
  ]);
  return { published: published != null, draft: draft != null };
}

async function serveApi(request, env, url) {
  // Deployed-version probe, mirroring core's /healthz: answers "which build is
  // live?" in one curl. Values are injected by the deploy script (--var);
  // absent in dev, where the question doesn't arise.
  if (url.pathname === '/api/version' && request.method === 'GET') {
    return json({
      commit: env.GIT_COMMIT ?? 'unknown',
      deployed_at: env.DEPLOYED_AT ?? 'unknown',
    });
  }
  if (url.pathname.startsWith('/api/core/')) {
    return proxyCore(request, env, url);
  }
  if (url.pathname.startsWith('/api/ops/')) {
    return handleOpsApi(request, env, url);
  }
  if (url.pathname.startsWith('/api/moderation/')) {
    return handleModerationApi(request, env, url);
  }

  if (url.pathname === '/api/sites' && request.method === 'POST') {
    const limited = await rateLimitRequest(request, env, 'claim-site');
    if (limited) return limited;
    let site;
    let organizationId;
    try {
      ({ site, organizationId } = await readBoundedJSON(request));
    } catch (error) {
      if (error instanceof RangeError) return json({ error: 'Body too large' }, 413);
      return json({ error: 'Invalid body' }, 400);
    }
    const session = await sessionAccount(request, env);
    if (coreConfigured(env) && !session && !anonymousSiteClaimsAllowed(env)) {
      return json({ error: 'Sign in before claiming a site' }, 401);
    }
    if (typeof site !== 'string' || !SITE_NAME.test(site) || RESERVED.has(site)) {
      return json({ error: 'Invalid site name' }, 400);
    }
    if (await env.ARTIFACTS.head(`sites/${site}/meta.json`)) {
      return json({ error: 'Site already claimed' }, 409);
    }

    const organization = organizationId
      ? session?.organizations?.find((candidate) => candidate.id === organizationId)
      : session?.organizations?.find((candidate) => candidate.is_default);
    if (coreConfigured(env) && !organization && !anonymousSiteClaimsAllowed(env)) {
      return json({ error: 'Organization not found' }, 404);
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

    // Signed-in claims are recorded in core so the organization owns every
    // artifact and its one billing entitlement covers all of its sites.
    let boundOrganization = null;
    if (organization) {
      const sessionToken = sessionTokenFromRequest(request);
      const bind = await coreRequest(env, '/v1/site-ownership', {
        body: { subdomain: site, organization_id: organization.id },
        bearer: sessionToken,
      });
      if (bind.status === 409) {
        await env.ARTIFACTS.delete(metaKey);
        // Preserve the plan-limit signal so the client can prompt an upgrade
        // rather than showing a generic "name taken" conflict.
        const detail = await bind.json().catch(() => null);
        if (detail?.error?.code === 'site_limit_reached') {
          return json({ error: { code: 'site_limit_reached', message: detail.error.message ?? 'Site limit reached.' } }, 409);
        }
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
    const limited = await rateLimitRequest(request, env, 'anonymous-deploy');
    if (limited) return limited;
    if (!coreConfigured(env)) {
      return json({ error: 'Core unavailable' }, 503);
    }
    let body;
    try {
      body = await readBoundedJSON(request);
    } catch (error) {
      if (error instanceof RangeError) return json({ error: 'Body too large' }, 413);
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
    const limited = await rateLimitRequest(request, env, 'email-registration');
    if (limited) return limited;
    if (!coreConfigured(env)) {
      return json({ error: 'Core unavailable' }, 503);
    }
    let email;
    try {
      ({ email } = await readBoundedJSON(request));
    } catch (error) {
      if (error instanceof RangeError) return json({ error: 'Body too large' }, 413);
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
      body = await readBoundedJSON(request);
    } catch (error) {
      if (error instanceof RangeError) return json({ error: 'Body too large' }, 413);
      return json({ error: 'Invalid body' }, 400);
    }
    const response = await coreRequest(env, '/v1/organizations', { body, bearer: sessionToken });
    return new Response(response.body, {
      status: response.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const createInvitationMatch = url.pathname.match(/^\/api\/organizations\/([^/]+)\/invitations$/);
  if (createInvitationMatch && request.method === 'POST') {
    const sessionToken = sessionTokenFromRequest(request);
    if (!sessionToken || !coreConfigured(env)) return json({ error: 'Unauthorized' }, 401);
    let body;
    try {
      body = await readBoundedJSON(request);
    } catch (error) {
      if (error instanceof RangeError) return json({ error: 'Body too large' }, 413);
      return json({ error: 'Invalid body' }, 400);
    }
    const organizationID = encodeURIComponent(createInvitationMatch[1]);
    const response = await coreRequest(env, `/v1/organizations/${organizationID}/invitations`, {
      body,
      bearer: sessionToken,
    });
    return new Response(response.body, {
      status: response.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const billingActionMatch = url.pathname.match(/^\/api\/organizations\/([^/]+)\/billing\/(checkout|portal)$/);
  if (billingActionMatch && request.method === 'POST') {
    const sessionToken = sessionTokenFromRequest(request);
    if (!sessionToken || !coreConfigured(env)) return json({ error: 'Unauthorized' }, 401);
    const organizationID = encodeURIComponent(billingActionMatch[1]);
    const action = billingActionMatch[2];
    const response = await coreRequest(env, `/v1/organizations/${organizationID}/billing/${action}`, {
      method: 'POST',
      bearer: sessionToken,
    });
    return new Response(response.body, {
      status: response.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const invitationResponseMatch = url.pathname.match(/^\/api\/invitations\/([^/]+)\/(accept|decline)$/);
  if (invitationResponseMatch && request.method === 'POST') {
    const sessionToken = sessionTokenFromRequest(request);
    if (!sessionToken || !coreConfigured(env)) return json({ error: 'Unauthorized' }, 401);
    const invitationID = encodeURIComponent(invitationResponseMatch[1]);
    const action = invitationResponseMatch[2];
    const response = await coreRequest(env, `/v1/invitations/${invitationID}/${action}`, {
      method: 'POST',
      bearer: sessionToken,
    });
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
    const organizationViews = await Promise.all(organizations.map(async (organization) => {
      const organizationSites = organization.sites ?? [];
      const componentCount = await publishedComponentCount(env, organizationSites).catch(() => null);
      await Promise.all(organizationSites.map((site) => bindEmbedIdentity(env, site, organization)));
      return {
        ...organization,
        siteUrls: Object.fromEntries(organizationSites.map((site) => [site, siteUrlFor(request, env, site)])),
        component_count: componentCount,
      };
    }));
    return json({
      id: session.account.id, email: session.account.email,
      email_verified_at: session.account.email_verified_at ?? null,
      organizations: organizationViews, invitations: session.invitations ?? [], sites, siteUrls,
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
      const authDenied = await requireClaimToken(request, env, site);
      if (authDenied) {
        const metaObject = await env.ARTIFACTS.get(`sites/${site}/meta.json`);
        const servingDenied = await siteServingDenied(env, metaObject ? await metaObject.json() : null, site);
        if (servingDenied) return servingDenied;
      }
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
      const limited = await rateLimitRequest(request, env, 'asset-upload');
      if (limited) return limited;
      const denied = await requireClaimToken(request, env, site);
      if (denied) return denied;
      const billingDenied = await requireSiteEditEntitlement(request, env, site);
      if (billingDenied) return billingDenied;
      let body;
      try {
        body = await readBoundedBody(request, ASSET_BODY_LIMIT);
      } catch (error) {
        if (error instanceof RangeError) return json({ error: 'Asset too large' }, 413);
        return json({ error: 'Invalid body' }, 400);
      }
      const hash = (await sha256Hex(body)).slice(0, 12);
      const finalName = `${hash}.${ext}`;
      await env.ARTIFACTS.put(`sites/${site}/assets/${finalName}`, body, {
        httpMetadata: { contentType: ASSET_TYPES[ext] },
      });
      return json({ url: `${url.origin}/api/assets/${site}/${finalName}` }, 201);
    }
  }

  // --- Designs (Phase 3a): org-scoped, session-authed, subdomain-independent.
  // Additive — the site routes below are unchanged. Storage:
  // orgs/<orgId>/designs/<designId>/{meta.json,artifact.json,embed/<name>}.

  // Create + list are core-authoritative: core owns the design row (identity +
  // metadata) and enforces the plan cap; R2 holds only the artifact/embed
  // blobs (below). The Worker proxies these with the session bearer.
  const designCollectionMatch = url.pathname.match(/^\/api\/orgs\/([^/]+)\/designs$/);
  if (designCollectionMatch) {
    const orgId = designCollectionMatch[1];
    if (!ORG_ID.test(orgId)) return json({ error: 'Bad request' }, 400);
    const sessionToken = sessionTokenFromRequest(request);
    if (!sessionToken || !coreConfigured(env)) return json({ error: 'Unauthorized' }, 401);
    const passthrough = (response) =>
      new Response(response.body, {
        status: response.status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });

    if (request.method === 'GET') {
      return passthrough(await coreRequest(env, `/v1/organizations/${encodeURIComponent(orgId)}/designs`, { bearer: sessionToken }));
    }
    if (request.method === 'POST') {
      let input = {};
      try {
        input = await readBoundedJSON(request);
      } catch {
        return json({ error: 'Invalid body' }, 400);
      }
      const componentPath = Array.isArray(input.componentPath) ? input.componentPath.join('/') : input.componentPath;
      return passthrough(await coreRequest(env, `/v1/organizations/${encodeURIComponent(orgId)}/designs`, {
        method: 'POST', bearer: sessionToken,
        body: { name: input.name, component_path: componentPath },
      }));
    }
  }

  // A design's draft/published artifacts and its published embeds. Save writes the
  // draft; publish promotes the draft to the served artifact.json, writes the
  // generated embed modules, and clears the draft — a distinct operation from
  // autosave. Editing/publishing a design (including a fork) is a normal
  // org-scoped, membership-gated operation.
  const designResourceMatch = url.pathname.match(
    /^\/api\/orgs\/([^/]+)\/designs\/([^/]+)\/(artifact\/draft|artifact|publish|embed\/[^/]+)$/
  );
  if (designResourceMatch) {
    const [, orgId, designId, resource] = designResourceMatch;
    if (!ORG_ID.test(orgId) || !DESIGN_ID.test(designId)) return json({ error: 'Bad request' }, 400);
    const org = await sessionOrganization(request, env, orgId);
    if (!org) return json({ error: 'Unauthorized' }, 401);
    const base = `orgs/${orgId}/designs/${designId}`;
    const publishedKey = `${base}/artifact.json`;
    const draftKey = `${base}/artifact.draft.json`;

    if (resource === 'artifact' && request.method === 'GET') {
      const object = await env.ARTIFACTS.get(publishedKey);
      if (!object) return json({ error: 'Not found' }, 404);
      return new Response(object.body, { headers: { 'Content-Type': 'application/json' } });
    }

    if (resource === 'artifact/draft') {
      if (request.method === 'GET') {
        const object = await env.ARTIFACTS.get(draftKey);
        if (!object) return json({ error: 'Not found' }, 404);
        return new Response(object.body, { headers: { 'Content-Type': 'application/json' } });
      }
      if (request.method === 'PUT') {
        const limited = await rateLimitRequest(request, env, 'design-autosave');
        if (limited) return limited;
        let body;
        try {
          body = await readBoundedBody(request, JSON_BODY_LIMIT);
        } catch (error) {
          if (error instanceof RangeError) return json({ error: 'Artifact too large' }, 413);
          return json({ error: 'Invalid artifact' }, 400);
        }
        await env.ARTIFACTS.put(draftKey, body, { httpMetadata: { contentType: 'application/json' } });
        return new Response(null, { status: 204 });
      }
      if (request.method === 'DELETE') {
        await env.ARTIFACTS.delete(draftKey);
        return new Response(null, { status: 204 });
      }
    }

    if (resource === 'publish' && request.method === 'POST') {
      const limited = await rateLimitRequest(request, env, 'design-autosave');
      if (limited) return limited;
      const draft = await env.ARTIFACTS.get(draftKey);
      if (!draft) return json({ error: 'Nothing to publish' }, 409);
      const draftBytes = await draft.arrayBuffer();
      let input;
      try {
        input = await readBoundedJSON(request);
      } catch {
        return json({ error: 'Invalid body' }, 400);
      }
      // Tier gate: the org may only publish components it's entitled to. Deny (e.g.
      // a free org publishing a payment component) leaves the draft untouched.
      let draftArtifact = null;
      try {
        draftArtifact = JSON.parse(new TextDecoder().decode(draftBytes));
      } catch {
        return json({ error: 'Invalid artifact' }, 400);
      }
      const denied = await deployCheck(env, orgId, draftArtifact);
      if (denied) return denied;
      await env.ARTIFACTS.put(publishedKey, draftBytes, { httpMetadata: { contentType: 'application/json' } });
      const embeds = input && typeof input.embeds === 'object' && input.embeds ? input.embeds : {};
      for (const [name, source] of Object.entries(embeds)) {
        if (!EMBED_NAME.test(name) || typeof source !== 'string') continue;
        await env.ARTIFACTS.put(`${base}/embed/${name}`, source, {
          httpMetadata: { contentType: 'text/javascript; charset=utf-8' },
        });
      }
      await env.ARTIFACTS.delete(draftKey);
      return new Response(null, { status: 204 });
    }

    if (resource.startsWith('embed/') && request.method === 'PUT') {
      const name = decodeURIComponent(resource.slice('embed/'.length));
      if (!EMBED_NAME.test(name)) return json({ error: 'Bad request' }, 400);
      const limited = await rateLimitRequest(request, env, 'design-autosave');
      if (limited) return limited;
      let body;
      try {
        body = await readBoundedBody(request, EMBED_BODY_LIMIT);
      } catch (error) {
        if (error instanceof RangeError) return json({ error: 'Embed too large' }, 413);
        return json({ error: 'Invalid body' }, 400);
      }
      await env.ARTIFACTS.put(`${base}/embed/${name}`, body, {
        httpMetadata: { contentType: 'text/javascript; charset=utf-8' },
      });
      return new Response(null, { status: 204 });
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
      const authDenied = await requireClaimToken(request, env, site);
      if (authDenied) {
        const metaObject = await env.ARTIFACTS.get(`sites/${site}/meta.json`);
        const servingDenied = await siteServingDenied(env, metaObject ? await metaObject.json() : null, site);
        if (servingDenied) return servingDenied;
      }
      const object = await env.ARTIFACTS.get(key);
      if (!object) return json({ error: 'Not found' }, 404);
      return new Response(object.body, { headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method === 'PUT') {
      const limited = await rateLimitRequest(request, env, 'artifact-publish');
      if (limited) return limited;
      const denied = await requireClaimToken(request, env, site);
      if (denied) return denied;
      const billingDenied = await requireSiteEditEntitlement(request, env, site, { startTrial: true });
      if (billingDenied) return billingDenied;
      let body;
      let artifact;
      try {
        body = await readBoundedBody(request, JSON_BODY_LIMIT);
        artifact = JSON.parse(new TextDecoder().decode(body));
      } catch (error) {
        if (error instanceof RangeError) return json({ error: 'Artifact too large' }, 413);
        return json({ error: 'Invalid artifact' }, 400);
      }
      // Tier gate: the owning org may only publish components it's entitled to.
      const publishMeta = await env.ARTIFACTS.get(`sites/${site}/meta.json`);
      const publishOrg = publishMeta ? (await publishMeta.json())?.organizationId : null;
      const tierDenied = await deployCheck(env, publishOrg, artifact);
      if (tierDenied) return tierDenied;
      await env.ARTIFACTS.put(key, body, { httpMetadata: { contentType: 'application/json' } });
      await recordModerationResult(env, site, artifact);
      return new Response(null, { status: 204 });
    }

    if (request.method === 'DELETE') {
      const denied = await requireClaimToken(request, env, site);
      if (denied) return denied;
      await env.ARTIFACTS.delete(key);
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
      const authDenied = await requireClaimToken(request, env, site);
      if (authDenied) {
        const metaObject = await env.ARTIFACTS.get(`sites/${site}/meta.json`);
        const servingDenied = await siteServingDenied(env, metaObject ? await metaObject.json() : null, site);
        if (servingDenied) return withCors(servingDenied);
      }
      return serveEmbed(env, site, name);
    }
    if (request.method === 'PUT') {
      const limited = await rateLimitRequest(request, env, 'embed-publish');
      if (limited) return limited;
      const denied = await requireClaimToken(request, env, site);
      if (denied) return denied;
      const billingDenied = await requireSiteEditEntitlement(request, env, site);
      if (billingDenied) return billingDenied;
      let body;
      try {
        body = await readBoundedBody(request, EMBED_BODY_LIMIT);
      } catch (error) {
        if (error instanceof RangeError) return json({ error: 'Embed too large' }, 413);
        return json({ error: 'Invalid body' }, 400);
      }
      await env.ARTIFACTS.put(`sites/${site}/embed/${name}`, body, {
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

export async function publishedComponentCount(env, sites) {
  const counts = await Promise.all(sites.map(async (site) => {
    const prefix = `sites/${site}/`;
    const objects = await listAllObjects(env.ARTIFACTS, prefix);
    return objects.filter((object) => {
      const relative = object.key.slice(prefix.length);
      return relative.endsWith('.json') && relative !== 'meta.json' &&
        !relative.startsWith('assets/') && !relative.startsWith('draft/');
    }).length;
  }));
  return counts.reduce((total, count) => total + count, 0);
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
      return Response.redirect(new URL('/account/', url.origin), 302);
    }
    return messagePage(
      'Link already used or expired',
      'If you confirmed on this device before, your account is still yours — open it and enter your email to get a fresh sign-in link.',
      [['/account/', 'Go to your account']],
      401
    );
  }

  const { account, organization, subdomain, session } = await response.json();
  let publishingDelayed = false;
  if (subdomain) {
    const metaKey = `sites/${subdomain}/meta.json`;
    const metaObj = await env.ARTIFACTS.get(metaKey);
    if (metaObj) {
      const meta = await metaObj.json();
      if (meta.status === 'drafted') {
        // Tier gate: the staged draft can't go live if it declares a component
        // the org's plan doesn't cover. Core is the authority; a denial leaves
        // the draft parked so they can upgrade and re-confirm from the dashboard.
        const stagedPath = Array.isArray(meta.componentPath) && meta.componentPath.length > 0
          ? meta.componentPath.join('/')
          : HOME_ARTIFACT;
        const stagedObj = await env.ARTIFACTS.get(`sites/${subdomain}/draft/${stagedPath}.json`);
        if (stagedObj) {
          const denied = await deployCheck(env, organization.id, await stagedObj.json());
          if (denied) {
            return messagePage(
              'This site needs a paid plan',
              'Your account is ready, but this design uses a component that needs Basic. Open your dashboard to upgrade, then publish from there.',
              [['/dashboard/', 'Go to your dashboard']],
              402
            );
          }
        }
        try {
          await startOrganizationTrial(env, organization.id, session.token);
          await promoteSite(env, subdomain);
          await env.ARTIFACTS.put(
            metaKey,
            JSON.stringify({
              ...meta,
              status: 'published',
              ownerAccountId: account.id,
              organizationId: organization.id,
              publishableKey: organization.publishable_key,
              trialStartedAt: new Date().toISOString(),
              confirmedAt: new Date().toISOString(),
              publishedAt: new Date().toISOString(),
            })
          );
          const artifactPath = Array.isArray(meta.componentPath) && meta.componentPath.length > 0
            ? meta.componentPath.join('/')
            : HOME_ARTIFACT;
          const publishedArtifact = await env.ARTIFACTS.get(`sites/${subdomain}/${artifactPath}.json`);
          if (publishedArtifact) await recordModerationResult(env, subdomain, await publishedArtifact.json());
        } catch {
          publishingDelayed = true;
        }
      }
      // Bind the pk → site embed projection; the user finds the embed code
      // itself in their dashboard now, not on this page.
      if (!publishingDelayed) await bindEmbedIdentity(env, subdomain, organization);
    }
  }

  const siteUrl = subdomain ? siteUrlFor(request, env, subdomain) : null;
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  const sessionCookie = `${SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`;

  // Success with a published site: drop the user straight onto their page —
  // they'll find the dashboard (and its embed code) themselves. The message
  // page is kept only for email-only sign-in and the delayed-publish case.
  if (siteUrl && !publishingDelayed) {
    return new Response(null, {
      status: 302,
      headers: { Location: siteUrl, 'Set-Cookie': sessionCookie, 'Cache-Control': 'no-store' },
    });
  }

  const page = messagePage(
    'Email confirmed',
    publishingDelayed
      ? 'Your account is ready, but publishing is temporarily delayed. Open your account and try publishing again.'
      : 'You are signed in.',
    [['/account/', 'Go to your account']],
    publishingDelayed ? 503 : 200
  );
  const headers = new Headers(page.headers);
  headers.append('Set-Cookie', sessionCookie);
  return new Response(page.body, { status: page.status, headers });
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
  const servingDenied = await siteServingDenied(env, meta, identity.site);
  if (servingDenied) return withCors(servingDenied);
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

async function cleanupExpiredSites(env) {
  if (!coreConfigured(env)) return;
  const listed = await listAllObjects(env.ARTIFACTS, 'sites/');
  const metaObjects = listed.filter((object) => /^sites\/[^/]+\/meta\.json$/.test(object.key));
  const entitlements = new Map();
  for (const object of metaObjects) {
    const site = object.key.split('/')[1];
    const stored = await env.ARTIFACTS.get(object.key);
    if (!stored) continue;
    const meta = await stored.json();
    if (!meta.organizationId) continue;
    if (!entitlements.has(meta.organizationId)) {
      entitlements.set(
        meta.organizationId,
        organizationEntitlement(env, meta.organizationId, { fresh: true }).catch(() => null)
      );
    }
    const entitlement = await entitlements.get(meta.organizationId);
    if (!entitlement) continue;
    await updateBillingRecoveryMetadata(env, site, meta, entitlement);
    if (entitlement.status !== 'expired') continue;
    const deleteAfter = billingRecoveryDeadline(entitlement);
    if (Date.now() < Date.parse(deleteAfter)) continue;
    const released = await coreRequest(
      env,
      `/v1/organizations/${encodeURIComponent(meta.organizationId)}/sites/${encodeURIComponent(site)}`,
      { method: 'DELETE', bearer: env.CORE_INTERNAL_KEY }
    ).catch(() => null);
    if (!released?.ok) continue;
    await releaseSiteObjects(env, site, meta).catch(() => {});
    console.log(JSON.stringify({
      event: 'billing_recovery_expired', site, organization_id: meta.organizationId,
    }));
  }
}

// Ordered site purge: meta.json strictly last. Two invariants depend on this —
// serveSite treats a site with missing meta as a legacy *published* site and
// would serve leftover artifacts, and the reconciliation sweep discovers
// orphans through meta, so a partial purge must stay discoverable. A crash at
// any step leaves the site un-servable but findable.
export async function releaseSiteObjects(env, site, meta = null) {
  const metaKey = `sites/${site}/meta.json`;
  if (!meta) {
    const stored = await env.ARTIFACTS.get(metaKey);
    meta = stored ? await stored.json().catch(() => null) : null;
  }
  const objects = await listAllObjects(env.ARTIFACTS, `sites/${site}/`);
  for (const object of objects) {
    if (object.key === metaKey) continue;
    await env.ARTIFACTS.delete(object.key);
  }
  if (meta?.publishableKey && meta?.siteId) {
    await env.ARTIFACTS.delete(`embed-identities/${meta.publishableKey}/${meta.siteId}.json`);
  }
  await env.ARTIFACTS.delete(`moderation/flags/${site}.json`);
  await env.ARTIFACTS.delete(metaKey);
  return true;
}

async function purgePrefix(env, prefix) {
  const objects = await listAllObjects(env.ARTIFACTS, prefix);
  for (const object of objects) await env.ARTIFACTS.delete(object.key);
  return true;
}

// An unbound claim is only released once it is unambiguously abandoned: older
// than the email-confirmation TTL (1h in core) plus a day of slack.
const ABANDONED_CLAIM_GRACE_MS = 25 * 60 * 60 * 1000;

// Nightly R2↔core reconciliation. Purges blobs whose core rows are gone (an
// admin deletion whose purge failed or whose response was lost), backfills
// site metas stranded by a crash between the claim's meta write and its core
// bind, and releases positively abandoned claims. Fails safe throughout: only
// an explicit exists:false / bound:false from core is destructive; any error
// or unknown answer means "leave it".
export async function reconcileDeletedOrganizations(env) {
  if (!coreConfigured(env) || !env.CORE_INTERNAL_KEY) return;

  const existence = new Map();
  const organizationGone = async (orgId) => {
    if (!existence.has(orgId)) {
      existence.set(
        orgId,
        coreRequest(env, `/v1/organizations/${encodeURIComponent(orgId)}/exists`, { bearer: env.CORE_INTERNAL_KEY })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      );
    }
    const answer = await existence.get(orgId);
    return answer?.exists === false;
  };

  const listed = await listAllObjects(env.ARTIFACTS, 'sites/');
  const metaObjects = listed.filter((object) => /^sites\/[^/]+\/meta\.json$/.test(object.key));
  for (const object of metaObjects) {
    const site = object.key.split('/')[1];
    const stored = await env.ARTIFACTS.get(object.key);
    if (!stored) continue;
    const meta = await stored.json().catch(() => null);
    if (!meta) continue;

    if (meta.organizationId) {
      if (await organizationGone(meta.organizationId)) {
        await releaseSiteObjects(env, site, meta).catch(() => {});
        console.log(JSON.stringify({ event: 'reconcile_site_released', site, organization_id: meta.organizationId }));
      }
      continue;
    }

    // Unassociated meta: the claim flow writes meta before binding core, so a
    // crash in between strands a bound site here. Resolve via core.
    const binding = await coreRequest(env, `/v1/sites/${encodeURIComponent(site)}/binding`, { bearer: env.CORE_INTERNAL_KEY })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!binding) continue;
    if (binding.bound) {
      if (binding.organization_id) {
        await env.ARTIFACTS.put(object.key, JSON.stringify({ ...meta, organizationId: binding.organization_id }));
        console.log(JSON.stringify({ event: 'reconcile_meta_backfilled', site, organization_id: binding.organization_id }));
      }
      continue;
    }
    // Unbound: never touch a legacy published site. Release requires a modern
    // timestamp past the grace AND positive abandonment — a drafted funnel
    // claim (serves nothing) or zero published content (a claim that crashed
    // before any deploy). Legacy metas lack createdAt and have published
    // artifacts, so they fail both tests and are preserved.
    const age = meta.createdAt ? Date.now() - Date.parse(meta.createdAt) : NaN;
    if (!(age > ABANDONED_CLAIM_GRACE_MS)) continue;
    const abandoned = meta.status === 'drafted' || (await publishedComponentCount(env, [site])) === 0;
    if (!abandoned) continue;
    await releaseSiteObjects(env, site, meta).catch(() => {});
    console.log(JSON.stringify({ event: 'reconcile_abandoned_claim_released', site }));
  }

  const orgObjects = await listAllObjects(env.ARTIFACTS, 'orgs/');
  const orgIds = [...new Set(orgObjects.map((object) => object.key.split('/')[1]).filter(Boolean))];
  for (const orgId of orgIds) {
    if (await organizationGone(orgId)) {
      await purgePrefix(env, `orgs/${orgId}/`).catch(() => {});
      console.log(JSON.stringify({ event: 'reconcile_org_purged', organization_id: orgId }));
    }
  }
}

async function proxyCore(request, env, url) {
  // Dev-only. In production this forward does not exist: browsers reach core
  // exclusively through the purpose-built BFF routes above, each of which
  // authenticates the actual principal before the service key is attached.
  // A blanket forward would hand the Worker's transport credential to any
  // caller for any /v1 path — the vulnerability class this gate closes.
  if (env.ALLOW_CORE_DEV_PROXY !== 'true') {
    return json({ error: 'Not found' }, 404);
  }
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

  const servingDenied = await siteServingDenied(env, meta, site);
  if (servingDenied) return servingDenied;

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
