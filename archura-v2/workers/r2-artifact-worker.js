/**
 * Reference Cloudflare Worker for the R2 persistence adapter
 * (src/adapters/index.ts → createR2Adapter).
 *
 * Deploy with wrangler using a config like:
 *
 *   name = "archura-artifacts"
 *   main = "workers/r2-artifact-worker.js"
 *   [[r2_buckets]]
 *   binding = "ARTIFACTS"
 *   bucket_name = "<your-bucket>"
 *   # then: wrangler secret put ARTIFACT_TOKEN
 *
 * The adapter targets it as:
 *   createR2Adapter({ endpoint: 'https://archura-artifacts.<acct>.workers.dev', token: '<ARTIFACT_TOKEN>' })
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const key = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    if (!key || key.includes('..')) {
      return new Response('Bad key', { status: 400, headers: CORS_HEADERS });
    }
    if (request.headers.get('Authorization') !== `Bearer ${env.ARTIFACT_TOKEN}`) {
      return new Response('Unauthorized', { status: 401, headers: CORS_HEADERS });
    }

    if (request.method === 'GET') {
      const object = await env.ARTIFACTS.get(`${key}.json`);
      if (!object) return new Response('Not found', { status: 404, headers: CORS_HEADERS });
      return new Response(object.body, {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'PUT') {
      await env.ARTIFACTS.put(`${key}.json`, request.body);
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  },
};
