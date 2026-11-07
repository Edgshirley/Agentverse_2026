import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function cloudflareWorkerApiDevPlugin() {
  return {
    name: 'cloudflare-worker-api-dev',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (!req.url || !req.url.startsWith('/api/')) {
          return next();
        }
        try {
          const mod = await server.ssrLoadModule('/src/worker/index.ts');
          const workerApp = mod.app;
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const bodyBuffer = Buffer.concat(chunks);
          const fullUrl = `http://${req.headers.host || 'localhost:5173'}${req.url}`;
          const fetchReq = new Request(fullUrl, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body:
              req.method !== 'GET' && req.method !== 'HEAD' && bodyBuffer.length > 0
                ? bodyBuffer
                : undefined,
          });
          const fetchRes: Response = await workerApp.fetch(fetchReq, {});
          res.statusCode = fetchRes.status;
          fetchRes.headers.forEach((v, k) => res.setHeader(k, v));
          const text = await fetchRes.text();
          res.end(text);
        } catch (err: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err?.message || 'Internal Worker Dev Error' }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), cloudflareWorkerApiDevPlugin()],
  server: {
    port: 5173,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
