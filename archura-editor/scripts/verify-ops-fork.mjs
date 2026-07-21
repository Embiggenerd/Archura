// Unit test for the platform-ops BFF + fork orchestration (in-memory bucket +
// stubbed core). The Worker owns R2; a fork only reads the source blob and
// writes a copy into the workspace — the source is never touched.
// Run: node scripts/verify-ops-fork.mjs
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import worker from '../workers/site-worker.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class MemoryBucket {
  objects = new Map();
  failPut = null; // key substring whose put() should throw (copy-failure test)
  async get(key) {
    const bytes = this.objects.get(key);
    if (bytes == null) return null;
    return {
      body: bytes,
      etag: `etag-${key.length}`,
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
      async json() {
        return JSON.parse(new TextDecoder().decode(bytes));
      },
    };
  }
  async put(key, value) {
    if (this.failPut && key.includes(this.failPut)) throw new Error('put failed');
    if (value instanceof ArrayBuffer) value = new Uint8Array(value);
    this.objects.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value));
  }
}

const CORE = 'https://core.archura.test';
const SESSION = 'staff-session';
const NON_STAFF = 'customer-session';
const SOURCE_ORG = 'aaaaaaaa-1111-2222-3333-444444444444';
const WORKSPACE_ORG = 'bbbbbbbb-1111-2222-3333-444444444444';
const SOURCE_DESIGN = `dsn_${'a'.repeat(32)}`;
const FORK_DESIGN = `dsn_${'f'.repeat(32)}`;

// Stub core: admin fork create/finalize + a design read + an org list. The
// bearer distinguishes a staff session (allowed) from a customer one (403).
let lastFinalize = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  const staff = (init?.headers?.Authorization ?? '') === `Bearer ${SESSION}`;
  const method = init?.method ?? 'GET';
  const p = url.pathname;
  if (p === '/v1/admin/forks' && method === 'POST') {
    if (!staff) return Response.json({ error: { code: 'forbidden' } }, { status: 403 });
    // Core returns the fork's design record (adminDesignResponse shape).
    return Response.json(
      {
        id: FORK_DESIGN,
        organization_id: WORKSPACE_ORG,
        source_org_id: SOURCE_ORG,
        forked_from: SOURCE_DESIGN,
        component_path: 'pages/Landing',
        fork_status: 'pending',
      },
      { status: 201 }
    );
  }
  if (p === `/v1/admin/forks/${FORK_DESIGN}/finalize` && method === 'POST') {
    lastFinalize = JSON.parse(init.body);
    return new Response(null, { status: 204 });
  }
  if (p === `/v1/admin/designs/${SOURCE_DESIGN}`) {
    if (!staff) return new Response('forbidden', { status: 403 });
    return Response.json({ id: SOURCE_DESIGN, organization_id: SOURCE_ORG, name: 'Landing', component_path: 'pages/Landing' });
  }
  if (p === '/v1/admin/organizations') {
    if (!staff) return new Response('forbidden', { status: 403 });
    return Response.json({ items: [{ id: SOURCE_ORG, name: 'Acme' }], next_cursor: '' });
  }
  throw new Error(`Unexpected core request: ${method} ${p}`);
};

const bucket = new MemoryBucket();
const env = { ARTIFACTS: bucket, CORE_URL: CORE, CORE_SERVICE_KEY: 'svc-key', ROOT_DOMAIN: '' };
const signed = (path, opts = {}, token = SESSION) =>
  new Request(`https://archura.test${path}`, {
    ...opts,
    headers: { Cookie: `archura_session=${token}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });

const sourceKey = `orgs/${SOURCE_ORG}/designs/${SOURCE_DESIGN}/artifact.json`;
const destKey = `orgs/${WORKSPACE_ORG}/designs/${FORK_DESIGN}/artifact.json`;
const artifactBytes = new TextEncoder().encode(JSON.stringify({ config: { componentPath: ['pages', 'Landing'] }, snapshot: { html: '<main>hi</main>' } }));

try {
  bucket.objects.set(sourceKey, artifactBytes);
  const before = new Uint8Array(bucket.objects.get(sourceKey));

  // --- access gate ---
  const anon = await worker.fetch(new Request('https://archura.test/api/ops/organizations', { method: 'GET' }), env);
  assert.equal(anon.status, 401, 'no session rejected');
  const forbidden = await worker.fetch(signed('/api/ops/organizations', {}, NON_STAFF), env);
  assert.equal(forbidden.status, 403, 'non-staff forbidden by core');

  // --- reads forward verbatim ---
  const orgs = await worker.fetch(signed('/api/ops/organizations?q=ac&limit=10'), env);
  assert.equal(orgs.status, 200, 'org list forwarded');
  assert.equal((await orgs.json()).items[0].id, SOURCE_ORG);

  // --- fork: create → copy → finalize, source untouched ---
  const forked = await worker.fetch(
    signed('/api/ops/forks', { method: 'POST', body: JSON.stringify({ source_design_id: SOURCE_DESIGN }) }),
    env
  );
  assert.equal(forked.status, 201, 'fork created');
  assert.equal((await forked.json()).fork_design_id, FORK_DESIGN, 'fork id returned');
  assert.deepEqual(new Uint8Array(bucket.objects.get(sourceKey)), before, 'source blob byte-for-byte unchanged');
  assert.deepEqual(new Uint8Array(bucket.objects.get(destKey)), before, 'fork copy matches source, in the workspace namespace');
  assert.equal(lastFinalize.status, 'ready', 'finalized ready');
  assert.equal(lastFinalize.source_artifact_kind, 'published', 'kind published');
  assert.ok(lastFinalize.source_etag, 'source ETag supplied to finalize');

  // --- non-staff fork: 403, no R2 read/write, no finalize ---
  lastFinalize = null;
  const forkForbidden = await worker.fetch(
    signed('/api/ops/forks', { method: 'POST', body: JSON.stringify({ source_design_id: SOURCE_DESIGN }) }, NON_STAFF),
    env
  );
  assert.equal(forkForbidden.status, 403, 'non-staff fork forbidden');
  assert.equal(lastFinalize, null, 'no finalize for a non-staff fork');

  // --- template fork (no stored source artifact) ---
  bucket.objects.delete(sourceKey);
  lastFinalize = null;
  const tmpl = await worker.fetch(
    signed('/api/ops/forks', { method: 'POST', body: JSON.stringify({ source_design_id: SOURCE_DESIGN }) }),
    env
  );
  assert.equal(tmpl.status, 201, 'template fork created');
  assert.equal(lastFinalize.source_artifact_kind, 'template', 'kind template');
  assert.equal(lastFinalize.template_ref, 'pages/Landing', 'template_ref carried');
  bucket.objects.set(sourceKey, artifactBytes);

  // --- copy failure → finalize failed + 502 ---
  bucket.failPut = `designs/${FORK_DESIGN}/artifact.json`;
  lastFinalize = null;
  const failed = await worker.fetch(
    signed('/api/ops/forks', { method: 'POST', body: JSON.stringify({ source_design_id: SOURCE_DESIGN }) }),
    env
  );
  assert.equal(failed.status, 502, 'copy failure → 502');
  assert.equal(lastFinalize.status, 'failed', 'fork finalized failed');
  bucket.failPut = null;

  // --- R2 enrichment on a design read ---
  const design = await worker.fetch(signed(`/api/ops/designs/${SOURCE_DESIGN}`), env);
  assert.equal(design.status, 200, 'design read forwarded');
  const enriched = await design.json();
  assert.equal(enriched.artifacts.published, true, 'published presence reported');
  assert.equal(enriched.artifacts.draft, false, 'no draft reported');

  console.log(
    'worker: /api/ops staff-gated; fork create→copy→finalize leaves source intact (correct dest+etag+kind), template + copy-failure paths, R2 enrichment'
  );
} finally {
  globalThis.fetch = originalFetch;
}
