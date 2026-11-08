// ============================================================================
// Backend HTTP + WebSocket Server Entrypoint (Hono /api/* + WS /ws on :4000)
// Internal rules engine: in the docker stack only the FastAPI gateway (../api)
// reaches it; it publishes state changes on the Redis bus for the API's
// WebSocket fan-out. `/ws` here is only for running the engine standalone.
// Also serves built static UI from ../frontend/dist if present (like env.ASSETS)
// ============================================================================

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { app, geminiStatus, globalStore, runMarketTimers } from '../dist/worker.mjs';
import { createSqliteD1Database } from '../dist/sqlite_d1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Local (non-docker) runs: load LLM keys from the git-ignored repo-root
// secrets.env. Already-set env vars win. See INSTRUCTIONS.md.
const SECRETS_ENV = path.resolve(__dirname, '../../secrets.env');
if (fs.existsSync(SECRETS_ENV) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(SECRETS_ENV);
}
const PORT = Number(process.env.PORT || 4000);
const SQLITE_DB_PATH =
  process.env.SQLITE_DB_PATH || path.resolve(__dirname, '../data/spread.sqlite');
const FRONTEND_DIST_DIR = path.resolve(__dirname, '../../frontend/dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Initialize persistent SQLite database (D1-compatible) and hydrate/seed state
const sqliteDb = createSqliteD1Database(SQLITE_DB_PATH);
globalStore.attachDatabase(sqliteDb);
// Postgres / Redis snapshot first (docker stack), then the local SQLite file
const hydrated =
  (await globalStore.hydrateFromPostgresOrRedis()) ||
  (await globalStore.hydrateFromD1({ ...process.env, DB: sqliteDb }));

// Says whether the AI is connected, without ever printing the key
const gemini = geminiStatus(process.env);
console.log(
  gemini.configured
    ? `Gemini: key found, using model ${gemini.model}`
    : 'Gemini: GEMINI_API_KEY is NOT set. Put it in prod.env or secrets.env, then recreate the engine.'
);

// Auctions, challenge windows and bot checks run on real time, even when nobody is polling
globalStore.enableWallClock();
setInterval(() => {
  runMarketTimers({ ...process.env, DB: sqliteDb }).catch(() => undefined);
}, 1000);

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = req.url || '/';
    const parsedUrl = new URL(urlPath, `http://${req.headers.host || `localhost:${PORT}`}`);

    // Serve static frontend assets when visiting http://localhost:4000 in a browser
    if (
      !parsedUrl.pathname.startsWith('/api/') &&
      (req.method === 'GET' || req.method === 'HEAD') &&
      fs.existsSync(FRONTEND_DIST_DIR)
    ) {
      const relPath = parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname.slice(1);
      const candidatePath = path.resolve(FRONTEND_DIST_DIR, relPath);
      const targetFile =
        candidatePath.startsWith(FRONTEND_DIST_DIR) &&
        fs.existsSync(candidatePath) &&
        fs.statSync(candidatePath).isFile()
          ? candidatePath
          : path.resolve(FRONTEND_DIST_DIR, 'index.html');

      if (fs.existsSync(targetFile)) {
        const ext = path.extname(targetFile).toLowerCase();
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
        res.end(fs.readFileSync(targetFile));
        return;
      }
    }

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

    const envBinding = { ...process.env, DB: sqliteDb };
    const webRes = await app.fetch(webReq, envBinding);
    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const contentType = webRes.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream') && webRes.body) {
      res.flushHeaders?.();
      const reader = webRes.body.getReader();
      req.on('close', () => {
        reader.cancel().catch(() => {});
      });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
      return;
    }

    const arrayBuf = await webRes.arrayBuffer();
    res.end(Buffer.from(arrayBuf));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err?.message || 'Internal Backend Error' }));
  }
});

// Real-Time WebSocket Server on `/ws` and `/api/ws`
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  try {
    const fullUrl = new URL(
      request.url || '/',
      `http://${request.headers.host || `localhost:${PORT}`}`
    );
    if (fullUrl.pathname !== '/ws' && fullUrl.pathname !== '/api/ws') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, fullUrl);
    });
  } catch {
    socket.destroy();
  }
});

wss.on('connection', (ws, _request, fullUrl) => {
  let selectedMarketId = fullUrl?.searchParams?.get('marketId') || undefined;

  // Immediately push initial terminal state to newly connected client
  ws.send(
    JSON.stringify({
      type: 'INITIAL_STATE',
      payload: globalStore.getTerminalStatePayload(selectedMarketId),
    })
  );

  // Subscribe to real-time engine mutations
  const unsubscribe = globalStore.subscribe((evt) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({
          type: evt.type,
          payload: globalStore.getTerminalStatePayload(selectedMarketId || evt.marketId),
        })
      );
    }
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg?.type === 'SELECT_MARKET' && typeof msg.marketId === 'string') {
        selectedMarketId = msg.marketId;
        ws.send(
          JSON.stringify({
            type: 'STATE_UPDATED',
            payload: globalStore.getTerminalStatePayload(selectedMarketId),
          })
        );
      } else if (msg?.type === 'PING') {
        ws.send(
          JSON.stringify({
            type: 'PONG',
            stateVersion: globalStore.stateVersion,
            serverClockMs: globalStore.clock.now(),
          })
        );
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    unsubscribe();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `MARKETMATE // BACKEND ENGINE API + WEBSOCKETS listening on http://0.0.0.0:${PORT} (SQLite: ${SQLITE_DB_PATH}, hydrated=${hydrated})`
  );
});
