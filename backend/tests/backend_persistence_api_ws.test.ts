import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createSqliteD1Database } from '../src/worker/sqlite_d1';
import { EdgeStateStore, globalStore } from '../src/worker/db';
import { app } from '../src/worker/index';
import { stepDeterministicReplay } from '../src/worker/replay';

describe('SQLite / D1 Relational Persistence, Full API Routes & Real-Time Pub/Sub', () => {
  it('persists all 13 relational tables to SQLite and hydrates a fresh store with 100% state fidelity', async () => {
    const db = createSqliteD1Database(':memory:');
    const store1 = new EdgeStateStore(db);

    // Step replay on mkt_arsenal so live_events are populated
    stepDeterministicReplay(store1, 'mkt_arsenal');
    store1.engine.recordClassificationLog({
      id: 'clog_test_1',
      market_id: 'mkt_arsenal',
      agent1_parsed_payload: {
        question: 'When will Arsenal score first vs Chelsea?',
        unit: 'min',
        bounds: [0, 95],
        resolution_source: 'Opta',
        criteria: 'First goal minute',
        deadline_hours: 24,
        payoff_mode: 'pot',
        lot_stake_k: 10,
        no_event_value: 95,
      },
      agent2_archetype: 'spread',
      agent2_verifiability: 'public_verifiable',
      agent2_route: 'auto',
      confidence: 0.96,
      created_at: store1.clock.now(),
    });
    store1.bumpVersion('mkt_arsenal');
    await store1.persistToD1({ DB: db });

    const inspection = await store1.inspectDatabase({ DB: db });
    expect(inspection.connected).toBe(true);
    expect(inspection.tableCounts.groups).toBe(1);
    expect(inspection.tableCounts.players).toBe(5);
    expect(inspection.tableCounts.markets).toBe(4);
    expect(inspection.tableCounts.width_bids).toBe(4);
    expect(inspection.tableCounts.positions).toBeGreaterThanOrEqual(9);
    expect(inspection.tableCounts.position_bids).toBe(1);
    expect(inspection.tableCounts.orders).toBeGreaterThanOrEqual(4);
    expect(inspection.tableCounts.strategy_mandates).toBe(1);
    expect(inspection.tableCounts.live_events).toBe(1);
    expect(inspection.tableCounts.agent_classification_logs).toBe(1);
    expect(inspection.tableCounts.ledger_entries).toBeGreaterThan(10);
    expect(inspection.tableCounts.engine_snapshots).toBe(1);

    // Hydrate into a second store and verify identical state
    const store2 = new EdgeStateStore();
    // Mutate store2 before hydration to prove hydration overwrites with DB state
    store2.engine.ledger.registerPlayer({
      id: 'temp_user',
      group_id: 'grp_main',
      nickname: 'TEMP',
      is_admin: false,
      wallet_balance_toks: 999,
      escrow_balance_toks: 0,
    });

    const restored = await store2.hydrateFromD1({ DB: db });
    expect(restored).toBe(true);
    expect(store2.stateVersion).toBe(store1.stateVersion);
    expect(store2.engine.ledger.getAllPlayers()).toEqual(store1.engine.ledger.getAllPlayers());
    expect(store2.getFullMarketBundle('mkt_arsenal')).toEqual(
      store1.getFullMarketBundle('mkt_arsenal')
    );
    expect(store2.getFullMarketBundle('mkt_weather')).toEqual(
      store1.getFullMarketBundle('mkt_weather')
    );
  });

  it('serves new REST endpoints (health, db/inspect, p2p/ask, order cancel, group challenge/vote) and emits real-time pub/sub notifications', async () => {
    const db = createSqliteD1Database(':memory:');
    globalStore.attachDatabase(db);
    globalStore.setSeedDemoFixtures(true);
    await globalStore.resetAndPersist({ DB: db });

    const notifications: Array<{ type: string; marketId?: string; stateVersion: number }> = [];
    const unsubscribe = globalStore.subscribe((evt) => {
      notifications.push(evt);
    });

    try {
      // 1. Health & DB inspect
      const healthRes = await app.fetch(new Request('http://localhost:4000/api/health'), { DB: db });
      expect(healthRes.status).toBe(200);
      const healthJson: any = await healthRes.json();
      expect(healthJson.ok).toBe(true);
      expect(healthJson.databaseConnected).toBe(true);

      const inspectRes = await app.fetch(new Request('http://localhost:4000/api/db/inspect'), {
        DB: db,
      });
      expect(inspectRes.status).toBe(200);
      const inspectJson: any = await inspectRes.json();
      expect(inspectJson.tableCounts.markets).toBe(4);

      // 2. P2P Ask auto-matching Cat's standing 20 CHIP bid on mkt_arsenal
      const askRes = await app.fetch(
        new Request('http://localhost:4000/api/markets/mkt_arsenal/p2p/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sellerId: 'ben',
            side: 'OVER',
            minPriceToks: 18,
            kind: 'ASK',
          }),
        }),
        { DB: db }
      );
      expect(askRes.status).toBe(200);
      const askBundle: any = await askRes.json();
      const catPos = askBundle.positions.find((p: any) => p.player_id === 'cat' && p.side === 'OVER');
      expect(catPos.lots).toBe(2);

      // 3. Cancel Dan's open limit_buy order on mkt_weather and verify 60 CHIP escrow is refunded
      const weatherBundleBefore = globalStore.getFullMarketBundle('mkt_weather');
      const danLimOrder = weatherBundleBefore.orders.find(
        (o) => o.player_id === 'dan' && o.type === 'limit_buy' && o.status === 'open'
      );
      expect(danLimOrder).toBeDefined();
      const danWalletBefore = globalStore.engine.ledger.getPlayer('dan').wallet_balance_toks;

      const cancelRes = await app.fetch(
        new Request(
          `http://localhost:4000/api/markets/mkt_weather/orders/${danLimOrder!.id}/cancel`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId: 'dan' }),
          }
        ),
        { DB: db }
      );
      expect(cancelRes.status).toBe(200);
      const danWalletAfter = globalStore.engine.ledger.getPlayer('dan').wallet_balance_toks;
      expect(danWalletAfter).toBe(danWalletBefore + 60);

      // 4. Verify real-time notifications were emitted for every state mutation
      expect(notifications.length).toBeGreaterThanOrEqual(2);
      expect(notifications.some((n) => n.marketId === 'mkt_arsenal')).toBe(true);
      expect(notifications.some((n) => n.marketId === 'mkt_weather')).toBe(true);

      // 5. Verify zero-sum ledger invariant
      globalStore.engine.ledger.assertInvariants();
    } finally {
      unsubscribe();
    }
  });

  it('streams real-time INITIAL_STATE, PONG, and STATE_UPDATED over WebSocket (/ws)', async () => {
    const db = createSqliteD1Database(':memory:');
    globalStore.attachDatabase(db);
    globalStore.setSeedDemoFixtures(true);
    await globalStore.resetAndPersist({ DB: db });

    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const bodyBuffer = Buffer.concat(chunks);
      const webReq = new Request(`http://localhost${req.url || '/'}`, {
        method: req.method,
        headers: req.headers as any,
        body:
          req.method !== 'GET' && req.method !== 'HEAD' && bodyBuffer.length > 0
            ? bodyBuffer
            : undefined,
      });
      const webRes = await app.fetch(webReq, { DB: db });
      res.statusCode = webRes.status;
      const buf = await webRes.arrayBuffer();
      res.end(Buffer.from(buf));
    });

    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        const fullUrl = new URL(request.url || '/', 'http://localhost');
        let selectedMarketId = fullUrl.searchParams.get('marketId') || undefined;
        ws.send(
          JSON.stringify({
            type: 'INITIAL_STATE',
            payload: globalStore.getTerminalStatePayload(selectedMarketId),
          })
        );
        const unsub = globalStore.subscribe((evt) => {
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
          const msg = JSON.parse(String(raw));
          if (msg.type === 'PING') {
            ws.send(JSON.stringify({ type: 'PONG', stateVersion: globalStore.stateVersion }));
          }
        });
        ws.on('close', () => unsub());
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as { port: number };
    const port = address.port;

    try {
      const receivedMessages: any[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?marketId=mkt_arsenal`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'PING' }));
        });
        ws.on('message', async (data) => {
          const parsed = JSON.parse(String(data));
          receivedMessages.push(parsed);

          if (parsed.type === 'INITIAL_STATE') {
            // Trigger an HTTP mutation to verify STATE_UPDATED push over WebSocket
            await fetch(`http://127.0.0.1:${port}/api/markets/mkt_arsenal/p2p/cashout`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sellerId: 'ben', side: 'OVER' }),
            });
          }

          if (
            receivedMessages.some((m) => m.type === 'INITIAL_STATE') &&
            receivedMessages.some((m) => m.type === 'PONG') &&
            receivedMessages.some((m) => m.type === 'STATE_UPDATED')
          ) {
            resolve();
          }
        });
        ws.on('error', reject);
      });

      ws.close();
      expect(receivedMessages.some((m) => m.type === 'INITIAL_STATE')).toBe(true);
      expect(receivedMessages.some((m) => m.type === 'PONG')).toBe(true);
      const updatedMsg = receivedMessages.find((m) => m.type === 'STATE_UPDATED');
      expect(updatedMsg).toBeDefined();
      expect(updatedMsg.payload.activeBundle.market.id).toBe('mkt_arsenal');
    } finally {
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
