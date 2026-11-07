// ============================================================================
// Production Docker HTTP Server (Serves Hono /api/* + Built Static Assets)
// ============================================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../dist-server/worker.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../dist');
const PORT = Number(process.env.PORT || 3000);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = req.url || '/';

    if (urlPath.startsWith('/api/')) {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const bodyBuffer = Buffer.concat(chunks);
      const fullUrl = `http://${req.headers.host || `localhost:${PORT}`}${urlPath}`;

      const webReq = new Request(fullUrl, {
        method: req.method,
        headers: req.headers,
        body:
          req.method !== 'GET' && req.method !== 'HEAD' && bodyBuffer.length > 0
            ? bodyBuffer
            : undefined,
      });

      const webRes = await app.fetch(webReq, process.env);
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      const arrayBuf = await webRes.arrayBuffer();
      res.end(Buffer.from(arrayBuf));
      return;
    }

    // Serve static files from dist/ with SPA fallback to index.html
    const cleanPath = urlPath.split('?')[0];
    let filePath = path.join(DIST_DIR, cleanPath === '/' ? 'index.html' : cleanPath);
    if (!filePath.startsWith(DIST_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err?.message || 'Internal Server Error' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SPREAD // CITADEL POKER TERMINAL (PROD) listening on http://0.0.0.0:${PORT}`);
});
