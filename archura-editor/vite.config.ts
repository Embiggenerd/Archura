import { createHash } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Connect } from 'vite';

const ASSET_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const here = path.dirname(fileURLToPath(import.meta.url));

// The DEMO page (Archura's own showcase) shows a real, test-mode Stripe form
// rather than the mock placeholders, so it needs a Stripe *publishable* test
// key. Read it from the repo-root .env and expose it ONLY if it's a pk_test_
// (a publishable test key is safe on the client; a secret must never leak, and
// a live key must never be defaulted). Embedded components still never default
// a key — this is demo-only.
function demoStripePk(): string {
  try {
    const env = readFileSync(path.join(here, '..', '.env'), 'utf8');
    const key = env.match(/^\s*STRIPE_TEST_PUBLISHABLE_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
    return /^pk_test_/.test(key) ? key : '';
  } catch {
    return '';
  }
}

const buildInputs = {
  main: path.join(here, 'index.html'),
  edit: path.join(here, 'edit/index.html'),
  demo: path.join(here, 'demo/index.html'),
};


// Dev-only JSON artifact store: GET/PUT /<key> ↔ <rootDir>/<key>.json.
// Mirrors the contract of workers/r2-artifact-worker.js.
function artifactStore(rootDir: string, options: { bearerToken?: string } = {}): Connect.NextHandleFunction {
  return (req, res, next) => {
    void (async () => {
      const key = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
      if (!key || key.includes('..')) {
        res.statusCode = 400;
        return res.end('Bad key');
      }
      if (options.bearerToken && req.headers.authorization !== `Bearer ${options.bearerToken}`) {
        res.statusCode = 401;
        return res.end('Unauthorized');
      }

      const file = path.join(rootDir, `${key}.json`);
      if (req.method === 'GET') {
        try {
          const data = await fs.readFile(file, 'utf8');
          res.setHeader('Content-Type', 'application/json');
          return res.end(data);
        } catch {
          res.statusCode = 404;
          return res.end('Not found');
        }
      }
      if (req.method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, Buffer.concat(chunks));
        res.statusCode = 204;
        return res.end();
      }
      next();
    })().catch(() => {
      res.statusCode = 500;
      res.end('Store error');
    });
  };
}

// Dev-only binary asset store: PUT /<site>/<name>.<ext> hashes the body and
// stores <rootDir>/<site>/<hash>.<ext>; GET serves it back
function assetStore(rootDir: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    void (async () => {
      const key = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
      const [site, name] = key.split('/');
      const ext = (name ?? '').split('.').pop()?.toLowerCase() ?? '';
      if (!site || !name || key.includes('..') || !ASSET_TYPES[ext]) {
        res.statusCode = 400;
        return res.end('Bad asset key');
      }

      if (req.method === 'GET') {
        try {
          const data = await fs.readFile(path.join(rootDir, site, name));
          res.setHeader('Content-Type', ASSET_TYPES[ext]);
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return res.end(data);
        } catch {
          res.statusCode = 404;
          return res.end('Not found');
        }
      }
      if (req.method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const hash = createHash('sha256').update(body).digest('hex').slice(0, 12);
        const finalName = `${hash}.${ext}`;
        await fs.mkdir(path.join(rootDir, site), { recursive: true });
        await fs.writeFile(path.join(rootDir, site, finalName), body);
        res.statusCode = 201;
        res.setHeader('Content-Type', 'application/json');
        return res.end(
          JSON.stringify({ url: `http://${req.headers.host}/api/assets/${site}/${finalName}` })
        );
      }
      next();
    })().catch(() => {
      res.statusCode = 500;
      res.end('Asset store error');
    });
  };
}

export default defineConfig({
  define: {
    __DEMO_STRIPE_PK__: JSON.stringify(demoStripePk()),
  },
  build: {
    rollupOptions: { input: buildInputs },
  },
  plugins: [
    {
      // Redirect /demo and /edit (no trailing slash) to their directory index,
      // otherwise the SPA fallback serves the wrong page.
      name: 'dir-trailing-slash-redirect',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          for (const dir of ['/demo', '/edit']) {
            if (req.url === dir || req.url?.startsWith(`${dir}?`)) {
              res.statusCode = 302;
              res.setHeader('Location', req.url.replace(dir, `${dir}/`));
              return res.end();
            }
          }
          next();
        });
      },
    },
    {
      name: 'artifact-store',
      configureServer(server) {
        server.middlewares.use('/api/artifacts', artifactStore(path.join(here, 'artifacts')));
        server.middlewares.use('/api/assets', assetStore(path.join(here, 'artifacts', 'assets')));
        // Local stand-in for the R2 Worker so createR2Adapter is testable offline
        server.middlewares.use('/mock-r2', artifactStore(path.join(here, '.mock-r2'), { bearerToken: 'dev-token' }));
      },
    },
  ],
});
