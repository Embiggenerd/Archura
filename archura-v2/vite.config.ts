import { defineConfig } from 'vite';

export default defineConfig({
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
  ],
});
