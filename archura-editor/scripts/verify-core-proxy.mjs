// The blanket /api/core/* forward is DEV-ONLY. Doctrine
// (docs/AUTH_ARCHITECTURE.md): browsers reach core exclusively through
// purpose-built BFF routes; a blanket forward would hand the Worker's
// transport credential (service key) to any caller for any /v1 path.
// 1. Production shape (no ALLOW_CORE_DEV_PROXY): every /api/core/* request —
//    including the once-vulnerable machine-endpoint DELETE — dies at the
//    Worker with 404 and never reaches core.
// 2. Dev shape: the forward works, overwrites attacker-supplied trusted
//    headers, and preserves tenant auth.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import worker from '../workers/site-worker.js';

let captured;
let rateLimitKey;
const upstream = createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    captured = {
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      service: req.headers['x-archura-service-authorization'],
      clientIP: req.headers['x-archura-client-ip'],
      body: Buffer.concat(chunks).toString(),
    };
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});

await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
try {
  const { port } = upstream.address();
  const baseEnv = {
    CORE_URL: `http://127.0.0.1:${port}`,
    CORE_SERVICE_KEY: 'svc_test_worker-owned',
    CORE_RATE_LIMITER: {
      async limit({ key }) {
        rateLimitKey = key;
        return { success: true };
      },
    },
    ROOT_DOMAIN: '',
  };

  // --- 1. Production shape: the forward does not exist ---
  captured = undefined;
  const prodAttack = await worker.fetch(
    new Request('https://archura.test/api/core/v1/organizations/some-org-uuid/sites/victim-site', {
      method: 'DELETE',
    }),
    baseEnv
  );
  assert.equal(prodAttack.status, 404);
  assert.equal(captured, undefined, 'machine-endpoint DELETE must never reach core in prod shape');

  const prodPost = await worker.fetch(
    new Request('https://archura.test/api/core/v1/components', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"mode":"payment"}',
    }),
    baseEnv
  );
  assert.equal(prodPost.status, 404);
  assert.equal(captured, undefined, 'no /api/core/* path may reach core in prod shape');
  console.log('PASS prod shape: blanket core forward absent; machine endpoints unreachable');

  // --- 2. Dev shape: forward works, trusted headers are Worker-owned ---
  const devEnv = { ...baseEnv, ALLOW_CORE_DEV_PROXY: 'true' };
  const request = new Request('https://archura.test/api/core/v1/components?source=test', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer sk_test_tenant',
      'CF-Connecting-IP': '203.0.113.10',
      'Content-Type': 'application/json',
      'X-Archura-Service-Authorization': 'Bearer attacker-service-key',
      'X-Archura-Client-IP': '198.51.100.9',
    },
    body: '{"mode":"payment"}',
  });
  const response = await worker.fetch(request, devEnv);

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(captured.method, 'POST');
  assert.equal(captured.url, '/v1/components?source=test');
  assert.equal(captured.authorization, 'Bearer sk_test_tenant');
  assert.equal(captured.service, 'Bearer svc_test_worker-owned');
  assert.equal(captured.clientIP, '203.0.113.10');
  assert.equal(captured.body, '{"mode":"payment"}');
  assert.equal(rateLimitKey, 'components:203.0.113.10');
  assert.ok(!rateLimitKey.includes('sk_test_tenant'));
  console.log('PASS dev shape: forward overwrites trusted headers and preserves tenant auth');
} finally {
  await new Promise((resolve, reject) => upstream.close((err) => (err ? reject(err) : resolve())));
}
