// Unit test for the design routes (in-memory bucket + stubbed core). Core is
// the authority for the design row (identity + cap); the Worker proxies
// create/list to core and stores only the artifact/embed BLOBS in R2.
// Run: node scripts/verify-worker-designs.mjs
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
    return { body: bytes, async json() { return JSON.parse(new TextDecoder().decode(bytes)); } };
  }
  async put(key, value) {
    if (value instanceof ReadableStream) value = new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, typeof value === 'string' ? value : new Uint8Array(value));
  }
  async delete(key) { this.objects.delete(key); }
  async list({ prefix }) {
    return {
      objects: [...this.objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key, uploaded: new Date() })),
      truncated: false,
    };
  }
}

const ORG = 'aaaaaaaa-1111-2222-3333-444444444444';
const OTHER_ORG = 'bbbbbbbb-1111-2222-3333-444444444444';
const SESSION = 'designs-test-session';
const DESIGN_ID = `dsn_${'a'.repeat(32)}`;

// Stub core: /sessions/me (membership) + the org designs collection (create/
// list). Simulates the plan cap so we can prove the Worker passes 409 through.
let designCount = 0;
const CAP = 3;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  const auth = init?.headers?.Authorization ?? init?.headers?.get?.('Authorization') ?? '';
  const authed = auth === `Bearer ${SESSION}`;
  if (url.pathname === '/v1/sessions/me') {
    if (!authed) return new Response('unauthorized', { status: 401 });
    return Response.json({
      account: { id: 'acct-1', email: 'owner@example.test' },
      organizations: [{ id: ORG, name: 'Test Org', role: 'owner', sites: [] }],
    });
  }
  if (url.pathname === `/v1/organizations/${ORG}/designs`) {
    if (!authed) return new Response('unauthorized', { status: 401 });
    if ((init?.method ?? 'GET') === 'POST') {
      if (designCount >= CAP) {
        return Response.json({ error: { code: 'design_limit_reached', message: 'cap' } }, { status: 409 });
      }
      designCount++;
      return Response.json({ id: DESIGN_ID, organization_id: ORG, name: 'Splash', component_path: 'pages/Landing' }, { status: 201 });
    }
    return Response.json({ organization_id: ORG, designs: [{ id: DESIGN_ID, name: 'Splash' }] });
  }
  if (url.pathname === `/v1/organizations/${OTHER_ORG}/designs`) {
    return Response.json({ error: { code: 'organization_not_found' } }, { status: 404 });
  }
  throw new Error(`Unexpected core request: ${url.pathname}`);
};

const env = {
  ARTIFACTS: new MemoryBucket(),
  ASSETS: { fetch: () => new Response('asset') },
  CORE_URL: 'https://core.archura.test',
  CORE_SERVICE_KEY: 'worker-service-key',
  ROOT_DOMAIN: '',
};

const signed = (path, options = {}) =>
  new Request(`https://archura.test${path}`, {
    ...options,
    headers: { Cookie: `archura_session=${SESSION}`, 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });

try {
  // --- create proxies to core and returns the authoritative id ---
  const created = await worker.fetch(
    signed(`/api/orgs/${ORG}/designs`, { method: 'POST', body: JSON.stringify({ name: 'Splash', componentPath: ['pages', 'Landing'] }) }),
    env
  );
  assert.equal(created.status, 201, 'create proxied');
  assert.equal((await created.json()).id, DESIGN_ID, 'authoritative id returned');

  // --- the plan cap (core's) passes through as 409 ---
  designCount = CAP;
  const capped = await worker.fetch(
    signed(`/api/orgs/${ORG}/designs`, { method: 'POST', body: JSON.stringify({ name: 'x' }) }),
    env
  );
  assert.equal(capped.status, 409, 'cap 409 passes through');
  assert.match(await capped.text(), /design_limit_reached/, 'cap code passes through');

  // --- list proxies to core ---
  const listRes = await worker.fetch(signed(`/api/orgs/${ORG}/designs`), env);
  assert.equal(listRes.status, 200, 'list proxied');
  assert.equal((await listRes.json()).designs[0].id, DESIGN_ID);

  // --- artifact BLOB round-trips through R2 (no core meta) ---
  const artifact = { config: { componentPath: ['pages', 'Landing'] }, content: { components: [] }, snapshot: { html: '<main>hi</main>', css: '' }, meta: {} };
  const saved = await worker.fetch(
    signed(`/api/orgs/${ORG}/designs/${DESIGN_ID}/artifact`, { method: 'PUT', body: JSON.stringify(artifact) }),
    env
  );
  assert.equal(saved.status, 204, 'autosave artifact blob');
  const loaded = await worker.fetch(signed(`/api/orgs/${ORG}/designs/${DESIGN_ID}/artifact`), env);
  assert.deepEqual(await loaded.json(), artifact, 'artifact blob round-trips');

  const embed = await worker.fetch(
    signed(`/api/orgs/${ORG}/designs/${DESIGN_ID}/embed/Landing.js`, { method: 'PUT', body: 'export {};' }),
    env
  );
  assert.equal(embed.status, 204, 'store embed blob');

  // --- R2 holds only blobs, never a design meta row ---
  const keys = [...env.ARTIFACTS.objects.keys()];
  assert.ok(keys.every((k) => k.startsWith(`orgs/${ORG}/designs/${DESIGN_ID}/`)), 'blobs under the design namespace');
  assert.ok(keys.every((k) => !k.endsWith('/meta.json')), 'no R2 meta — core owns the design row');

  // --- auth: no session → 401; non-member org → core 404 passthrough ---
  const anon = await worker.fetch(new Request(`https://archura.test/api/orgs/${ORG}/designs`, { method: 'GET' }), env);
  assert.equal(anon.status, 401, 'anonymous rejected');
  const crossOrg = await worker.fetch(signed(`/api/orgs/${OTHER_ORG}/designs`), env);
  assert.equal(crossOrg.status, 404, 'non-member org rejected by core');

  console.log('worker: designs proxy create/list+cap to core; R2 holds only artifact/embed blobs, no meta row');
} finally {
  globalThis.fetch = originalFetch;
}
