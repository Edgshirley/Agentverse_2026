// ============================================================================
// Backend HTTP Server Entrypoint (Hono /api/* on port 4000)
// ============================================================================

import http from 'node:http';
import { app } from '../dist/worker.mjs';

const PORT = Number(process.env.PORT || 4000);

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = req.url || '/';
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
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err?.message || 'Internal Backend Error' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SPREAD // BACKEND ENGINE API listening on http://0.0.0.0:${PORT}`);
});
