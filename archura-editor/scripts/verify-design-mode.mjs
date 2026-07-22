// Unit test for the design draft/publish Worker routes (in-memory bucket +
// stubbed core session). Save writes a draft; publish promotes it to the served
// artifact.json + embeds and clears the draft — a distinct operation from
// autosave. Editing a design is membership-gated.
// Run: node scripts/verify-design-mode.mjs
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import worker from '../workers/site-worker.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class MemoryBucket {
  objects = new Map();
  async head(key) { return this.objects.has(key) ? {} : null; }
  async get(key) {
    const bytes = this.objects.get(key);
    if (bytes == null) return null;
    return {
      body: bytes,
      async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
      async json() { return JSON.parse(new TextDecoder().decode(bytes)); },
    };
  }
  async put(key, value) {
    if (value instanceof ArrayBuffer) value = new Uint8Array(value);
    this.objects.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value));
  }
  async delete(key) { this.objects.delete(key); }
}

const CORE = 'https://core.archura.test';
const SESSION = 'design-session';
const ORG = 'aaaaaaaa-1111-2222-3333-444444444444';
const DESIGN = `dsn_${'a'.repeat(32)}`;

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  if (url.pathname === '/v1/sessions/me') {
    if ((init?.headers?.Authorization ?? '') !== `Bearer ${SESSION}`) return new Response('unauthorized', { status: 401 });
    return Response.json({ account: { id: 'acct-1', email: 'o@e.test' }, organizations: [{ id: ORG, role: 'owner', sites: [] }] });
  }
  if (url.pathname === `/v1/organizations/${ORG}/deploy-check`) {
    if ((init?.headers?.Authorization ?? '') !== 'Bearer int-key') return new Response('unauthorized', { status: 401 });
    const manifest = JSON.parse(init.body);
    const paid = manifest.top_level === 'payments/StripePayment' || (manifest.uses ?? []).includes('payments/StripePayment');
    if (paid) return Response.json({ error: { code: 'component_requires_paid', message: 'Needs Basic.' } }, { status: 402 });
    return Response.json({ allowed: true });
  }
  throw new Error(`Unexpected core request: ${url.pathname}`);
};

const bucket = new MemoryBucket();
const env = { ARTIFACTS: bucket, CORE_URL: CORE, CORE_SERVICE_KEY: 'svc', CORE_INTERNAL_KEY: 'int-key', ROOT_DOMAIN: '' };
const base = `/api/orgs/${ORG}/designs/${DESIGN}`;
const draftK = `orgs/${ORG}/designs/${DESIGN}/artifact.draft.json`;
const pubK = `orgs/${ORG}/designs/${DESIGN}/artifact.json`;
const embedK = `orgs/${ORG}/designs/${DESIGN}/embed/Landing.js`;
const signed = (path, opts = {}) =>
  new Request(`https://archura.test${path}`, {
    ...opts,
    headers: { Cookie: `archura_session=${SESSION}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });

try {
  const artifact = JSON.stringify({ config: { componentPath: ['pages', 'Landing'] }, snapshot: { html: '<main>hi</main>' }, content: { components: [] } });

  // --- membership gate ---
  const anon = await worker.fetch(new Request(`https://archura.test${base}/artifact/draft`, { method: 'GET' }), env);
  assert.equal(anon.status, 401, 'draft routes need a session');

  // --- Save writes the draft; nothing published yet ---
  assert.equal((await worker.fetch(signed(`${base}/artifact/draft`, { method: 'PUT', body: artifact }), env)).status, 204, 'draft saved');
  assert.ok(bucket.objects.has(draftK), 'draft blob written');
  const draftGet = await worker.fetch(signed(`${base}/artifact/draft`), env);
  assert.equal(draftGet.status, 200);
  assert.equal(await draftGet.text(), artifact, 'draft round-trips');
  assert.equal((await worker.fetch(signed(`${base}/artifact`), env)).status, 404, 'no published artifact before publish');

  // --- Publish promotes the draft + writes embeds + clears the draft ---
  const published = await worker.fetch(
    signed(`${base}/publish`, { method: 'POST', body: JSON.stringify({ embeds: { 'Landing.js': 'export {};' } }) }),
    env
  );
  assert.equal(published.status, 204, 'publish ok');
  assert.equal(new TextDecoder().decode(bucket.objects.get(pubK)), artifact, 'published == promoted draft');
  assert.ok(bucket.objects.has(embedK), 'embed module written on publish');
  assert.ok(!bucket.objects.has(draftK), 'draft removed after publish');

  const pubGet = await worker.fetch(signed(`${base}/artifact`), env);
  assert.equal(pubGet.status, 200, 'published artifact now serves');
  assert.equal((await worker.fetch(signed(`${base}/artifact/draft`), env)).status, 404, 'draft gone after publish');

  // --- publish with no draft → 409 (nothing to publish) ---
  assert.equal(
    (await worker.fetch(signed(`${base}/publish`, { method: 'POST', body: JSON.stringify({ embeds: {} }) }), env)).status,
    409,
    'publish with no draft is rejected'
  );

  // --- publish is tier-gated: a free org can't publish a payment component ---
  const paidArtifact = JSON.stringify({
    config: { componentPath: ['pages', 'Landing'] },
    content: { components: [{ componentPath: ['payments', 'StripePayment'] }] },
    snapshot: { html: '<archura-stripe-payment></archura-stripe-payment>' },
  });
  await worker.fetch(signed(`${base}/artifact/draft`, { method: 'PUT', body: paidArtifact }), env);
  const gated = await worker.fetch(signed(`${base}/publish`, { method: 'POST', body: JSON.stringify({ embeds: {} }) }), env);
  assert.equal(gated.status, 402, 'free org blocked from publishing a payment component');
  assert.match(await gated.text(), /component_requires_paid/, 'tier denial passed through');
  assert.ok(bucket.objects.has(draftK), 'draft retained on tier denial');

  console.log('worker: design Save→draft; Publish promotes to artifact.json + embeds (tier-gated via deploy-check, denial retains the draft); membership-gated');
} finally {
  globalThis.fetch = originalFetch;
}
