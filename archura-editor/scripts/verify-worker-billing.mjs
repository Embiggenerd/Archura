import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import worker from '../workers/site-worker.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class MemoryBucket {
  objects = new Map();

  async get(key) {
    const value = this.objects.get(key);
    if (value == null) return null;
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    return {
      body: bytes,
      async json() { return JSON.parse(new TextDecoder().decode(bytes)); },
    };
  }

  async head(key) {
    return this.objects.has(key) ? { key } : null;
  }

  async put(key, value) {
    if (value instanceof ReadableStream) {
      value = new Uint8Array(await new Response(value).arrayBuffer());
    }
    this.objects.set(key, typeof value === 'string' ? value : new Uint8Array(value));
  }

  async delete(key) {
    this.objects.delete(key);
  }

  async list({ prefix }) {
    return {
      objects: [...this.objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
      truncated: false,
    };
  }
}

const digest = async (value) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
  .map((byte) => byte.toString(16).padStart(2, '0')).join('');

const bucket = new MemoryBucket();
const token = 'worker-billing-test-token';
const site = 'billing-test';
const metaKey = `sites/${site}/meta.json`;
bucket.objects.set(metaKey, JSON.stringify({
  site,
  siteId: `site_${'1'.repeat(32)}`,
  tokenHash: await digest(token),
  organizationId: 'organization-billing',
  status: 'published',
  trialStartedAt: '2026-07-20T00:00:00Z',
  componentPath: ['pages', 'Landing'],
}));
bucket.objects.set(`sites/${site}/pages/Landing.json`, JSON.stringify({
  config: { componentPath: ['pages', 'Landing'] },
  content: { components: [] },
  snapshot: { html: '<main>Published</main>', css: '' },
  meta: { updatedAt: '2026-07-20T00:00:00Z' },
}));

let entitlement = { status: 'grace', can_edit: false, can_serve: true };
let coreAvailable = true;
let releasedSite = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  if (!coreAvailable) throw new Error('core unavailable');
  if (url.pathname.endsWith('/entitlement')) return Response.json(entitlement);
  if (url.pathname.endsWith(`/sites/${site}`)) {
    releasedSite = true;
    return new Response(null, { status: 204 });
  }
  throw new Error(`Unexpected core request: ${url.pathname}`);
};

const env = {
  ARTIFACTS: bucket,
  ASSETS: { fetch: () => new Response('asset') },
  CORE_URL: 'https://core.archura.test',
  CORE_SERVICE_KEY: 'worker-service-key',
  MODERATION_ADMIN_KEY: 'moderation-admin-key',
  ROOT_DOMAIN: '',
};

try {
  const claimBucket = new MemoryBucket();
  const claimEnv = { ...env, ARTIFACTS: claimBucket, PUBLIC_ORIGIN: 'http://localhost:8787' };
  const claimRequest = () => new Request('https://archura.test/api/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site: 'anonymous-local' }),
  });
  const publicOriginOnlyClaim = await worker.fetch(claimRequest(), claimEnv);
  assert.equal(publicOriginOnlyClaim.status, 401);

  const explicitLocalClaim = await worker.fetch(claimRequest(), {
    ...claimEnv,
    ALLOW_ANONYMOUS_SITE_CLAIMS: 'true',
  });
  assert.equal(explicitLocalClaim.status, 201);

  const unboundSite = 'unbound-local';
  const unboundToken = 'unbound-local-token';
  claimBucket.objects.set(`sites/${unboundSite}/meta.json`, JSON.stringify({
    site: unboundSite,
    siteId: `site_${'2'.repeat(32)}`,
    tokenHash: await digest(unboundToken),
  }));
  const unboundPublishRequest = () => new Request(`https://archura.test/api/artifacts/${unboundSite}/pages/Landing`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${unboundToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { components: [] }, snapshot: { html: '<main>Local</main>', css: '' }, meta: {},
    }),
  });
  const publicOriginOnlyPublish = await worker.fetch(unboundPublishRequest(), claimEnv);
  assert.equal(publicOriginOnlyPublish.status, 409);
  const explicitLocalPublish = await worker.fetch(unboundPublishRequest(), {
    ...claimEnv,
    ALLOW_ANONYMOUS_SITE_CLAIMS: 'true',
  });
  assert.equal(explicitLocalPublish.status, 204);

  const artifact = {
    config: { componentPath: ['pages', 'Landing'] },
    content: { components: [] },
    snapshot: { html: '<form action="https://outside.example"><input type="password"></form>', css: '' },
    meta: { updatedAt: '2026-07-20T01:00:00Z' },
  };
  const publish = () => worker.fetch(new Request(`https://archura.test/api/artifacts/${site}/pages/Landing`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(artifact),
  }), env);

  const blockedPublish = await publish();
  assert.equal(blockedPublish.status, 402);

  const graceServing = await worker.fetch(new Request(`https://archura.test/s/${site}/`), env);
  assert.equal(graceServing.status, 200);

  entitlement = { status: 'expired', can_edit: false, can_serve: false };
  const blockedServing = await worker.fetch(new Request(`https://archura.test/s/${site}/`), env);
  assert.equal(blockedServing.status, 402);

  entitlement = { status: 'active', can_edit: true, can_serve: true };
  const published = await publish();
  assert.equal(published.status, 204);
  const storedFlag = bucket.objects.get(`moderation/flags/${site}.json`);
  const flag = JSON.parse(typeof storedFlag === 'string' ? storedFlag : new TextDecoder().decode(storedFlag));
  assert.deepEqual(flag.reasons, ['password_collection', 'external_form_action']);

  const suspended = await worker.fetch(new Request(`https://archura.test/api/moderation/sites/${site}/suspend`, {
    method: 'POST', headers: { Authorization: 'Bearer moderation-admin-key' },
  }), env);
  assert.equal(suspended.status, 200);
  const suspendedServing = await worker.fetch(new Request(`https://archura.test/s/${site}/`), env);
  assert.equal(suspendedServing.status, 451);

  await worker.fetch(new Request(`https://archura.test/api/moderation/sites/${site}/restore`, {
    method: 'POST', headers: { Authorization: 'Bearer moderation-admin-key' },
  }), env);
  coreAvailable = false;
  const outageServing = await worker.fetch(new Request(`https://archura.test/s/${site}/`), env);
  assert.equal(outageServing.status, 200);

  const oversized = await worker.fetch(new Request(`https://archura.test/api/artifacts/${site}/pages/Landing`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Length': String(1024 * 1024 + 1) },
    body: '{}',
  }), { ...env, CORE_URL: '' });
  assert.equal(oversized.status, 413);

  coreAvailable = true;
  entitlement = {
    status: 'expired', can_edit: false, can_serve: false,
    serve_grace_ends_at: '2020-01-01T00:00:00Z',
  };
  let cleanup;
  await worker.scheduled({}, env, { waitUntil(promise) { cleanup = promise; } });
  await cleanup;
  assert.equal(releasedSite, true);
  assert.equal(await bucket.head(metaKey), null);

  console.log('worker enforces explicit local claim bypass, billing, recovery cleanup, bounded writes, and moderation');
} finally {
  globalThis.fetch = originalFetch;
}
