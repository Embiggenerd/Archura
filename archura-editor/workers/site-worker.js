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

const RESERVED = new Set(['www', 'api', 'app', 'editor', 'assets', 'components', 's']);
const SITE_NAME = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
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

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const root = env.ROOT_DOMAIN;

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

// Publish auth: the bearer token must hash to the claimed site's tokenHash.
// Returns null when authorized, or the error Response to return.
async function requireClaimToken(request, env, site) {
  const meta = await env.ARTIFACTS.get(`sites/${site}/meta.json`);
  if (!meta) return json({ error: 'Unknown site' }, 404);
  const { tokenHash } = await meta.json();
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || (await sha256Hex(token)) !== tokenHash) {
    return json({ error: 'Unauthorized' }, 401);
  }
  return null;
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
    try {
      ({ site } = await request.json());
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
    await env.ARTIFACTS.put(
      `sites/${site}/meta.json`,
      JSON.stringify({ site, tokenHash: await sha256Hex(token), createdAt: new Date().toISOString() })
    );
    const siteUrl = env.ROOT_DOMAIN ? `https://${site}.${env.ROOT_DOMAIN}/` : `/s/${site}/`;
    return json({ site, token, url: siteUrl }, 201);
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
    const listed = await env.ARTIFACTS.list({ prefix });
    const entries = [];
    for (const object of listed.objects) {
      const key = object.key.slice(prefix.length);
      if (key === 'meta.json' || key.startsWith('assets/')) continue;
      const updatedAt = object.uploaded?.toISOString?.() ?? null;
      if (key.startsWith('embed/') && key.endsWith('.js')) {
        entries.push({ path: key.split('/'), kind: 'embed', updatedAt });
      } else if (key.endsWith('.json')) {
        entries.push({ path: key.slice(0, -'.json'.length).split('/'), kind: 'artifact', updatedAt });
      }
    }
    return json({ site, entries });
  }

  return json({ error: 'Not found' }, 404);
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

async function proxyCore(request, env, url) {
  if (!env.CORE_URL || !env.CORE_SERVICE_KEY) {
    return json({ error: 'Core unavailable' }, 503);
  }

  const corePath = url.pathname.slice('/api/core'.length);
  if (!corePath.startsWith('/v1/')) {
    return json({ error: 'Not found' }, 404);
  }

  // Coarse edge abuse protection. The authoritative per-tenant limit lives in
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

async function serveSite(request, env, site, path, base) {
  // Component modules resolve on the site host too (shared assets)
  if (path.startsWith('/components/')) {
    return withCors(await env.ASSETS.fetch(new Request(new URL(path, request.url), request)));
  }

  // Per-client embed modules on the site host: /embed/<Component>.js
  const embedMatch = path.match(/^\/embed\/([^/]+)$/);
  if (embedMatch && EMBED_NAME.test(embedMatch[1])) {
    return serveEmbed(env, site, embedMatch[1]);
  }

  const object = await env.ARTIFACTS.get(`sites/${site}/${HOME_ARTIFACT}.json`);

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
