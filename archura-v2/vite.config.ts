import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Connect } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

const buildInputs = {
  main: path.join(here, 'index.html'),
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

export default defineConfig({
  build: {
    rollupOptions: { input: buildInputs },
  },
  plugins: [
    {
      // Without this, /demo (no trailing slash) hits the SPA fallback and
      // serves the root editor page instead of demo/index.html
      name: 'demo-trailing-slash-redirect',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/demo' || req.url?.startsWith('/demo?')) {
            res.statusCode = 302;
            res.setHeader('Location', req.url.replace('/demo', '/demo/'));
            return res.end();
          }
          next();
        });
      },
    },
    {
      name: 'artifact-store',
      configureServer(server) {
        server.middlewares.use('/api/artifacts', artifactStore(path.join(here, 'artifacts')));
        // Local stand-in for the R2 Worker so createR2Adapter is testable offline
        server.middlewares.use('/mock-r2', artifactStore(path.join(here, '.mock-r2'), { bearerToken: 'dev-token' }));
      },
    },
  ],
});
