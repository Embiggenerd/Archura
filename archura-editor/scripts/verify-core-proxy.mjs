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
  const response = await worker.fetch(request, {
    CORE_URL: `http://127.0.0.1:${port}`,
    CORE_SERVICE_KEY: 'svc_test_worker-owned',
    CORE_RATE_LIMITER: {
      async limit({ key }) {
        rateLimitKey = key;
        return { success: true };
      },
    },
    ROOT_DOMAIN: '',
  });

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
  console.log('PASS core proxy overwrites trusted headers and preserves tenant auth');
} finally {
  await new Promise((resolve, reject) => upstream.close((err) => (err ? reject(err) : resolve())));
}
