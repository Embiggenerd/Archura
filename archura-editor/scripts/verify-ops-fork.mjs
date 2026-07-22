// Unit test for the platform-ops BFF + fork orchestration (in-memory bucket +
// stubbed core). The Worker owns R2; a fork only reads the source blob and
// writes a copy into the workspace — the source is never touched.
// Run: node scripts/verify-ops-fork.mjs
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import worker, { reconcileDeletedOrganizations } from '../workers/site-worker.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class MemoryBucket {
  objects = new Map();
  failPut = null; // key substring whose put() should throw (copy-failure test)
  failDelete = null; // key substring whose delete() should throw (partial-purge test)
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
  async delete(key) {
    if (this.failDelete && key.includes(this.failDelete)) throw new Error('delete failed');
    this.objects.delete(key);
  }
  async head(key) {
    return this.objects.has(key) ? { key } : null;
  }
  async list({ prefix }) {
    const objects = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key }));
    return { objects, truncated: false };
  }
}

const CORE = 'https://core.archura.test';
const SESSION = 'staff-session';
const NON_STAFF = 'customer-session';
const INTERNAL_KEY = 'int-key';
const SOURCE_ORG = 'aaaaaaaa-1111-2222-3333-444444444444';
const WORKSPACE_ORG = 'bbbbbbbb-1111-2222-3333-444444444444';
const DEL_ORG = 'cccccccc-1111-2222-3333-444444444444';
const BLOCKED_ORG = 'dddddddd-1111-2222-3333-444444444444';
const ACCT_ORG = 'eeeeeeee-1111-2222-3333-444444444444';
const ACCOUNT = 'ffffffff-1111-2222-3333-444444444444';
const SOURCE_DESIGN = `dsn_${'a'.repeat(32)}`;
const FORK_DESIGN = `dsn_${'f'.repeat(32)}`;

// Reconciliation-state stubs the sweep consults: which orgs core still has,
// and what a subdomain's binding resolves to.
const deletedOrgs = new Set();
const siteBindings = new Map();

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
  if (p === `/v1/admin/organizations/${DEL_ORG}` && method === 'DELETE') {
    if (!staff) return new Response('forbidden', { status: 403 });
    deletedOrgs.add(DEL_ORG);
    return Response.json({ released_sites: ['acme-site'] });
  }
  if (p === `/v1/admin/organizations/${BLOCKED_ORG}` && method === 'DELETE') {
    if (!staff) return new Response('forbidden', { status: 403 });
    return Response.json(
      { error: { code: 'subscription_active', message: 'Organization blocked-org has an active Stripe subscription; cancel it first.' } },
      { status: 409 }
    );
  }
  if (p === `/v1/admin/accounts/${ACCOUNT}` && method === 'DELETE') {
    if (!staff) return new Response('forbidden', { status: 403 });
    deletedOrgs.add(ACCT_ORG);
    return Response.json({ deleted_organization_ids: [ACCT_ORG], released_sites: ['acct-site'] });
  }
  const existsMatch = p.match(/^\/v1\/organizations\/([^/]+)\/exists$/);
  if (existsMatch && method === 'GET') {
    if ((init?.headers?.Authorization ?? '') !== `Bearer ${INTERNAL_KEY}`) return new Response('unauthorized', { status: 401 });
    return Response.json({ exists: !deletedOrgs.has(existsMatch[1]) });
  }
  const bindingMatch = p.match(/^\/v1\/sites\/([^/]+)\/binding$/);
  if (bindingMatch && method === 'GET') {
    if ((init?.headers?.Authorization ?? '') !== `Bearer ${INTERNAL_KEY}`) return new Response('unauthorized', { status: 401 });
    const bound = siteBindings.get(bindingMatch[1]);
    return Response.json(bound ? { bound: true, organization_id: bound } : { bound: false });
  }
  throw new Error(`Unexpected core request: ${method} ${p}`);
};

const bucket = new MemoryBucket();
const env = { ARTIFACTS: bucket, CORE_URL: CORE, CORE_SERVICE_KEY: 'svc-key', CORE_INTERNAL_KEY: INTERNAL_KEY, ROOT_DOMAIN: '' };
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

  // --- deletes: core response drives the purge; reconciliation converges ---
  const seedSite = (site, meta, { published = true } = {}) => {
    bucket.objects.set(`sites/${site}/meta.json`, new TextEncoder().encode(JSON.stringify(meta)));
    if (published) bucket.objects.set(`sites/${site}/pages/Landing.json`, new TextEncoder().encode('{}'));
    if (meta.publishableKey && meta.siteId) {
      bucket.objects.set(`embed-identities/${meta.publishableKey}/${meta.siteId}.json`, new TextEncoder().encode('{}'));
    }
    bucket.objects.set(`moderation/flags/${site}.json`, new TextEncoder().encode('{}'));
  };
  const siteKeys = (site) => [...bucket.objects.keys()].filter((key) => key.startsWith(`sites/${site}/`));

  // Org delete: purge follows the response (acme-site + orgs/DEL_ORG/), and a
  // site core did NOT release is untouched even though its blobs sit in R2.
  seedSite('acme-site', { site: 'acme-site', siteId: 'site_a1', publishableKey: 'pk_a', organizationId: DEL_ORG });
  seedSite('other-site', { site: 'other-site', siteId: 'site_o1', publishableKey: 'pk_o', organizationId: SOURCE_ORG });
  bucket.objects.set(`orgs/${DEL_ORG}/designs/${SOURCE_DESIGN}/artifact.json`, new TextEncoder().encode('{}'));
  const orgDeleted = await worker.fetch(signed(`/api/ops/organizations/${DEL_ORG}`, { method: 'DELETE' }), env);
  assert.equal(orgDeleted.status, 200, 'org delete succeeded');
  assert.equal((await orgDeleted.json()).purge, 'complete', 'org delete purge complete');
  assert.equal(siteKeys('acme-site').length, 0, 'released site fully purged');
  assert.equal(bucket.objects.has('embed-identities/pk_a/site_a1.json'), false, 'embed-identity sidecar purged');
  assert.equal(bucket.objects.has('moderation/flags/acme-site.json'), false, 'moderation sidecar purged');
  assert.equal([...bucket.objects.keys()].some((key) => key.startsWith(`orgs/${DEL_ORG}/`)), false, 'org prefix purged');
  assert.ok(siteKeys('other-site').length > 0, 'unreleased site untouched — purge acts only on the response');

  // Blocked delete passes core's 409 through verbatim; non-staff cannot delete.
  const blocked = await worker.fetch(signed(`/api/ops/organizations/${BLOCKED_ORG}`, { method: 'DELETE' }), env);
  assert.equal(blocked.status, 409, 'blocked delete → 409');
  assert.equal((await blocked.json()).error.code, 'subscription_active', '409 code passes through verbatim');
  const forbiddenDelete = await worker.fetch(signed(`/api/ops/organizations/${DEL_ORG}`, { method: 'DELETE' }, NON_STAFF), env);
  assert.equal(forbiddenDelete.status, 403, 'non-staff delete forbidden');
  assert.ok(siteKeys('other-site').length > 0, 'non-staff delete touches nothing');

  // Account delete: purges every org id and site the response names, with a
  // partial purge (artifact delete fails) reported as pending and meta.json
  // surviving — the orphan stays discoverable and nothing servable remains
  // once the artifacts are gone.
  seedSite('acct-site', { site: 'acct-site', siteId: 'site_c1', publishableKey: 'pk_c', organizationId: ACCT_ORG });
  bucket.objects.set(`orgs/${ACCT_ORG}/designs/${FORK_DESIGN}/artifact.json`, new TextEncoder().encode('{}'));
  bucket.failDelete = 'sites/acct-site/pages/Landing.json';
  const acctDeleted = await worker.fetch(signed(`/api/ops/accounts/${ACCOUNT}`, { method: 'DELETE' }), env);
  assert.equal(acctDeleted.status, 200, 'account delete succeeded');
  assert.equal((await acctDeleted.json()).purge, 'pending', 'partial purge reported pending');
  assert.ok(bucket.objects.has('sites/acct-site/meta.json'), 'meta.json survives a partial purge (deleted last)');
  bucket.failDelete = null;

  // Reconciliation finishes the pending purge (core says the org is gone) and
  // leaves live orgs' blobs alone.
  await reconcileDeletedOrganizations(env);
  assert.equal(siteKeys('acct-site').length, 0, 'sweep completed the pending site purge');
  assert.equal([...bucket.objects.keys()].some((key) => key.startsWith(`orgs/${ACCT_ORG}/`)), false, 'sweep purged the org prefix');
  assert.ok(siteKeys('other-site').length > 0, 'sweep leaves live-org sites untouched');

  // Unassociated metas (no organizationId): bound → backfilled; a modern claim
  // that is old and never published → released; young → kept; legacy published
  // sites (no createdAt, or published content) → preserved forever.
  const oldStamp = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  seedSite('stranded-site', { site: 'stranded-site', siteId: 'site_s1', tokenHash: 'x', createdAt: oldStamp }, { published: false });
  siteBindings.set('stranded-site', SOURCE_ORG);
  seedSite('abandoned-claim', { site: 'abandoned-claim', siteId: 'site_s2', tokenHash: 'x', createdAt: oldStamp }, { published: false });
  seedSite('young-claim', { site: 'young-claim', siteId: 'site_s3', tokenHash: 'x', createdAt: new Date().toISOString() }, { published: false });
  seedSite('legacy-site', { site: 'legacy-site' });
  seedSite('legacy-stamped', { site: 'legacy-stamped', createdAt: oldStamp });
  await reconcileDeletedOrganizations(env);
  const stranded = JSON.parse(new TextDecoder().decode(bucket.objects.get('sites/stranded-site/meta.json')));
  assert.equal(stranded.organizationId, SOURCE_ORG, 'bound stranded meta backfilled with its org');
  assert.equal(siteKeys('abandoned-claim').length, 0, 'old unbound unpublished claim released');
  assert.ok(bucket.objects.has('sites/young-claim/meta.json'), 'young unbound claim preserved');
  assert.ok(bucket.objects.has('sites/legacy-site/meta.json'), 'legacy published site preserved (no createdAt)');
  assert.ok(bucket.objects.has('sites/legacy-site/pages/Landing.json'), 'legacy artifacts untouched');
  assert.ok(bucket.objects.has('sites/legacy-stamped/meta.json'), 'published content alone vetoes release');

  console.log(
    'worker: /api/ops staff-gated; fork create→copy→finalize leaves source intact (correct dest+etag+kind), template + copy-failure paths, R2 enrichment; org/account deletes purge from the response with 409 passthrough; reconciliation completes partial purges, backfills stranded metas, preserves legacy sites'
  );
} finally {
  globalThis.fetch = originalFetch;
}
