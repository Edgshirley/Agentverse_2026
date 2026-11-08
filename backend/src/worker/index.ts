// ============================================================================
// Cloudflare Worker Entrypoint & Hono REST / WebSocket / SSE Sync Hub (SPEC §5.1)
// ============================================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { Env, globalStore } from './db';
import { Market, OrderType, PositionSide, StrategyMandate } from '../shared/types';
import {
  estimateAdvisoryFairValue,
  generateMarketRecapAsync,
  parseStrategyRuleWithRiskGate,
  runAgent1Intake,
  runAgent2Classifier,
} from './agents';
import { stepDeterministicReplay, toggleFeedDelayedStatus } from './replay';
import { config } from '../config';
import { PostgresConnectionSingleton } from '../backend/postgres';
import { REDIS } from '../backend/redis';
import { MESSAGE_BUS } from '../backend/bus';

export { globalStore, EdgeStateStore } from './db';
export { config, PostgresConnectionSingleton, REDIS, MESSAGE_BUS };

export const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors());

// Root status endpoint when visiting http://localhost:4000/ directly in a browser
app.get('/', async (c) => {
  return c.json({
    service: 'Friend Spreader (Spread) — Citadel Poker Terminal Backend API',
    status: 'ONLINE',
    stateVersion: globalStore.stateVersion,
    frontendUrl: 'http://localhost:5173',
    endpoints: {
      state: 'http://localhost:4000/api/state',
      health: 'http://localhost:4000/api/health',
      dbInspect: 'http://localhost:4000/api/db/inspect',
      sseStream: 'http://localhost:4000/api/stream',
      webSocket: 'ws://localhost:4000/ws',
    },
  });
});

function ensurePlayerRegistered(rawIdOrNick: string): string {
  const cleanId = (rawIdOrNick || 'you').trim().toLowerCase().replace(/[^a-z0-9]/g, '_') || 'you';
  const existing = globalStore.engine.ledger.getAllPlayers().find((p) => p.id === cleanId);
  if (!existing) {
    globalStore.engine.ledger.registerPlayer({
      id: cleanId,
      group_id: globalStore.group.id,
      nickname: cleanId.toUpperCase(),
      is_admin: false,
      wallet_balance_toks: 1000,
      escrow_balance_toks: 0,
    });
  }
  return cleanId;
}

// 0. Healthcheck, Dependency Status (Postgres / Redis / Bus) & Database Inspector
// Authentication, sessions and client WebSockets are handled by the FastAPI
// gateway (../api); this engine is only reachable on the internal network.
app.get('/api/system/status', async (c) => {
  const [pgConnected, redisConnected] = await Promise.all([
    PostgresConnectionSingleton.ping(),
    REDIS.ping(),
  ]);
  return c.json({
    ok: true,
    service: config.TITLE,
    version: config.VERSION,
    env: config.ENV,
    stateVersion: globalStore.stateVersion,
    serverClockMs: globalStore.clock.now(),
    postgres: { connected: pgConnected, host: config.POSTGRES_HOST, database: config.POSTGRES_DB },
    redis: { connected: redisConnected, host: config.REDIS_HOST, db: 2 },
    messageBus: { driver: config.MESSAGE_BUS, channel: config.BUS_CHANNEL },
  });
});

app.get('/api/health', async (c) => {
  const db = globalStore.getDatabase(c.env);
  return c.json({
    ok: true,
    service: 'friend-spreader-engine',
    stateVersion: globalStore.stateVersion,
    serverClockMs: globalStore.clock.now(),
    databaseConnected: Boolean(db) || PostgresConnectionSingleton.getStatus() === 'connected',
  });
});

app.get('/api/db/inspect', async (c) => {
  try {
    await globalStore.persistToD1(c.env);
    const report = await globalStore.inspectDatabase(c.env);
    return c.json(report);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 0b. Real-Time Server-Sent Events (SSE) Stream (/api/stream & /api/events)
const handleSseStream = (c: any) => {
  const requestedMarketId = c.req.query('marketId');
  return streamSSE(c, async (stream) => {
    let closed = false;
    stream.onAbort(() => {
      closed = true;
    });

    // Send initial snapshot immediately upon connection
    await stream.writeSSE({
      event: 'INITIAL_STATE',
      data: JSON.stringify(globalStore.getTerminalStatePayload(requestedMarketId)),
    });

    let pendingResolve: (() => void) | null = null;
    const queue: Array<{ type: string; marketId?: string }> = [];

    const unsubscribe = globalStore.subscribe((evt) => {
      queue.push({ type: evt.type, marketId: evt.marketId });
      if (pendingResolve) {
        const r = pendingResolve;
        pendingResolve = null;
        r();
      }
    });

    try {
      while (!closed) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            pendingResolve = resolve;
            setTimeout(resolve, 15000);
          });
        }
        if (closed) break;
        if (queue.length > 0) {
          const latest = queue.pop()!;
          queue.length = 0;
          const targetId = requestedMarketId || latest.marketId;
          await stream.writeSSE({
            event: latest.type,
            data: JSON.stringify(globalStore.getTerminalStatePayload(targetId)),
          });
        } else {
          await stream.writeSSE({
            event: 'HEARTBEAT',
            data: JSON.stringify({
              stateVersion: globalStore.stateVersion,
              serverClockMs: globalStore.clock.now(),
            }),
          });
        }
      }
    } finally {
      unsubscribe();
    }
  });
};

app.get('/api/stream', handleSseStream);
app.get('/api/events', handleSseStream);

// 1. Get complete group & active market terminal state
app.get('/api/state', async (c) => {
  const requestedMarketId = c.req.query('marketId');
  return c.json(globalStore.getTerminalStatePayload(requestedMarketId));
});

// 2. Onboarding: Join group by invite code + nickname
app.post('/api/groups/join', async (c) => {
  try {
    const body = await c.req.json<{ inviteCode?: string; nickname: string }>();
    const nickname = (body.nickname || '').trim().toUpperCase();
    if (!nickname) {
      return c.json({ error: 'Nickname is required' }, 400);
    }
    const id = nickname.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const existing = globalStore.engine.ledger
      .getAllPlayers()
      .find((p) => p.id === id);

    if (!existing) {
      globalStore.engine.ledger.registerPlayer({
        id,
        group_id: globalStore.group.id,
        nickname,
        is_admin: false,
        wallet_balance_toks: 1000,
        escrow_balance_toks: 0,
      });
      globalStore.bumpVersion();
      await globalStore.persistToD1(c.env);
    }

    return c.json({
      player: globalStore.engine.ledger.getPlayer(id),
      stateVersion: globalStore.stateVersion,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 3. Create new market (from confirmed Agent 1 + Agent 2 Draft Card)
app.post('/api/markets', async (c) => {
  try {
    const body = await c.req.json<Partial<Market> & { proposer_id: string; question: string }>();
    const now = globalStore.clock.now();
    const id = body.id || `mkt_${now}_${Math.floor(Math.random() * 1000)}`;
    const archetype = body.archetype || 'simple';
    const route = body.route || 'auto';

    const proposerId = ensurePlayerRegistered(body.proposer_id || 'you');
    const arbiterId =
      route === 'arbiter' ? ensurePlayerRegistered(body.arbiter_id || 'boss') : null;

    let market: Market = {
      id,
      group_id: globalStore.group.id,
      proposer_id: proposerId,
      archetype,
      question: body.question,
      unit: body.unit || (archetype === 'spread' ? 'units' : '%'),
      bounds: body.bounds || [0, 100],
      no_event_value: body.no_event_value ?? 0,
      criteria: body.criteria || 'Standard verifiable outcome resolution.',
      resolution_source: body.resolution_source || 'Group / Feed Oracle',
      payoff_mode: body.payoff_mode || 'pot',
      lot_stake_k: Number(body.lot_stake_k) || 25,
      cap_widths_c: Number(body.cap_widths_c) || 3,
      state: archetype === 'spread' ? 'width_auction' : 'live',
      verifiability: body.verifiability || 'public_verifiable',
      route,
      arbiter_id: arbiterId,
      countdown_ends_at:
        route === 'arbiter'
          ? body.countdown_ends_at || now + 15 * 60 * 1000
          : null,
      parent_market_id: body.parent_market_id || null,
      parent_metric: body.parent_metric || null,
      parent_trigger_target: body.parent_trigger_target ?? null,
      parent_target_player_id: body.parent_target_player_id || null,
      live_implied_value: body.live_implied_value ?? 50,
      live_fair_value_toks: body.live_fair_value_toks ?? Number(body.lot_stake_k || 25),
      fair_value_source: body.fair_value_source || 'AI_ADVISORY',
      feed_status: 'LIVE',
      toggles: {
        max_lots: body.toggles?.max_lots ?? 3,
        forced_trading: body.toggles?.forced_trading ?? false,
        hidden_takes: body.toggles?.hidden_takes ?? false,
        single_mm_requote: body.toggles?.single_mm_requote ?? true,
        live_reopen_halftime: body.toggles?.live_reopen_halftime ?? false,
        public_positions_and_stops: body.toggles?.public_positions_and_stops ?? false,
      },
      version: 1,
      created_at: now,
    };

    if (archetype === 'spread') {
      market = globalStore.engine.auction.startAuction(market);
    }

    const created = globalStore.engine.createMarket(market);
    globalStore.bumpVersion(created.id);
    await globalStore.persistToD1(c.env);

    return c.json({
      market: created,
      bundle: globalStore.getFullMarketBundle(created.id),
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 3b. Market Creator Option: Update Market Toggles (e.g. show everyone's positions & stops to all participants)
app.post('/api/markets/:id/toggles', async (c) => {
  try {
    const marketId = c.req.param('id');
    const { playerId, public_positions_and_stops } = await c.req.json<{
      playerId: string;
      public_positions_and_stops: boolean;
    }>();
    const validPlayerId = ensurePlayerRegistered(playerId);
    const market = globalStore.engine.getMarket(marketId);
    if (market.proposer_id !== validPlayerId) {
      return c.json(
        { error: 'Only the person who created this market can change visibility of positions & stops for the group.' },
        403
      );
    }
    const updated: Market = {
      ...market,
      toggles: {
        ...market.toggles,
        public_positions_and_stops: Boolean(public_positions_and_stops),
      },
      version: market.version + 1,
    };
    globalStore.engine.createMarket(updated);
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 4. Width Auction: Place width bid, finalize auction, submit [L, H] quote, or trigger timeout
app.post('/api/markets/:id/auction/bid', async (c) => {
  try {
    const marketId = c.req.param('id');
    const { playerId, width } = await c.req.json<{ playerId: string; width: number }>();
    const validPlayerId = ensurePlayerRegistered(playerId);
    const market = globalStore.engine.getMarket(marketId);
    const res = globalStore.engine.auction.placeWidthBid(market, validPlayerId, Number(width));
    globalStore.engine.createMarket(res.market);
    globalStore.engine.emitWireTrace(
      marketId,
      'PLAYER',
      'MARKET_ENGINE',
      'WIDTH_BID',
      `${playerId.toUpperCase()} bid spread width w=${width} (quiet timer reset to 30s)`
    );
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/markets/:id/auction/finalize', async (c) => {
  try {
    const marketId = c.req.param('id');
    const market = globalStore.engine.getMarket(marketId);
    const updated = globalStore.engine.auction.finalizeAuction(market);
    globalStore.engine.createMarket(updated);
    globalStore.engine.emitWireTrace(
      marketId,
      'MARKET_ENGINE',
      'BROADCAST',
      'AUCTION_WON',
      `Width auction closed -> ${updated.mm_player_id?.toUpperCase()} wins MM at w=${updated.active_width_w}`
    );
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/markets/:id/auction/quote', async (c) => {
  try {
    const marketId = c.req.param('id');
    const { playerId, L } = await c.req.json<{ playerId: string; L: number }>();
    const market = globalStore.engine.getMarket(marketId);
    const effectiveMm = market.mm_player_id || ensurePlayerRegistered(playerId);
    const quoted = globalStore.engine.auction.submitQuote(market, effectiveMm, Number(L));
    const liveMarket = globalStore.engine.spreadBook.lockTakesAndGoLive(
      quoted,
      `go_live_${marketId}_${globalStore.clock.now()}`
    );
    globalStore.engine.createMarket(liveMarket);
    globalStore.engine.emitWireTrace(
      marketId,
      'PLAYER',
      'MARKET_ENGINE',
      'MM_QUOTE_SUBMITTED',
      `MM ${effectiveMm.toUpperCase()} quoted [${liveMarket.L}, ${liveMarket.H}]`
    );
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/markets/:id/auction/timeout', async (c) => {
  try {
    const marketId = c.req.param('id');
    const market = globalStore.engine.getMarket(marketId);
    const idemp = `timeout_${marketId}_${globalStore.clock.now()}`;
    const updated = globalStore.engine.auction.handleQuoteTimeout(market, idemp);
    globalStore.engine.createMarket(updated);
    globalStore.engine.emitWireTrace(
      marketId,
      'MARKET_ENGINE',
      'BROADCAST',
      'MM_QUOTE_TIMEOUT_FORFEIT',
      `MM missed 3m deadline -> forfeited ${market.lot_stake_k} TOKS ante to ${updated.mm_player_id ?? 'VOID'}`
    );
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 5. 1-Tap Manual Take (Over/Under for Spread, YES/NO for Simple/Stacked)
app.post('/api/markets/:id/take', async (c) => {
  try {
    const marketId = c.req.param('id');
    const { playerId, side, amount, idempotencyKey } = await c.req.json<{
      playerId: string;
      side: 'OVER' | 'UNDER' | 'YES' | 'NO';
      amount: number;
      idempotencyKey?: string;
    }>();
    const validPlayerId = ensurePlayerRegistered(playerId);
    const mkt = globalStore.engine.getMarket(marketId);
    if (
      mkt.archetype === 'spread' &&
      mkt.mm_player_id === validPlayerId &&
      globalStore.engine.spreadBook.getMmEscrow(marketId) === 0
    ) {
      // Allow single-player testing to take OVER/UNDER even after setting the window by delegating MM escrow cover to house_mm
      const fallbackMm = ensurePlayerRegistered('house_mm');
      globalStore.engine.createMarket({ ...mkt, mm_player_id: fallbackMm });
    }
    globalStore.clock.advance(250);
    const key = idempotencyKey || `take_${marketId}_${validPlayerId}_${globalStore.clock.now()}`;
    globalStore.engine.executeOneTapTake(marketId, validPlayerId, side, Number(amount), key);
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 6. Lock initial take window & reveal hidden takes
app.post('/api/markets/:id/lock-takes', async (c) => {
  try {
    const marketId = c.req.param('id');
    const market = globalStore.engine.getMarket(marketId);
    const updated = globalStore.engine.spreadBook.lockTakesAndGoLive(
      market,
      `lock_${marketId}_${globalStore.clock.now()}`
    );
    globalStore.engine.createMarket(updated);
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 7. Anytime Partial or Full Pool Withdrawal (p in (0, 1])
app.post('/api/markets/:id/withdraw', async (c) => {
  try {
    const marketId = c.req.param('id');
    const { playerId, side, fractionP, idempotencyKey } = await c.req.json<{
      playerId: string;
      side: PositionSide;
      fractionP: number;
      idempotencyKey?: string;
    }>();
    globalStore.clock.advance(250);
    const key = idempotencyKey || `withdraw_${marketId}_${playerId}_${globalStore.clock.now()}`;
    const mkt = globalStore.engine.getMarket(marketId);
    if (mkt.archetype === 'spread') {
      const positions = globalStore.engine.spreadBook.getPositions(marketId);
      const posIdx = positions.findIndex(
        (p) => p.player_id === playerId && p.live_equity_toks > 0
      );
      if (posIdx >= 0) {
        const pos = positions[posIdx];
        const pClamp = Math.min(1, Math.max(0.01, Number(fractionP)));
        const refund =
          pClamp >= 0.999
            ? pos.staked_toks
            : Math.max(1, Math.round(pos.staked_toks * pClamp));
        globalStore.engine.ledger.releaseEscrow(
          playerId,
          marketId,
          refund,
          'PARTIAL_WITHDRAWAL',
          key,
          `${playerId} withdrew ${refund} SPRD from window market`
        );
        const remaining = Math.max(0, pos.staked_toks - refund);
        positions[posIdx] = {
          ...pos,
          staked_toks: remaining,
          entry_cost_toks: remaining,
          live_equity_toks: remaining,
          lots: remaining === 0 ? 0 : pos.lots,
          withdrawn_toks: pos.withdrawn_toks + refund,
        };
        globalStore.engine.spreadBook.setPositions(marketId, positions);
      }
    } else {
      globalStore.engine.withdrawFromPool(marketId, playerId, side, Number(fractionP), key);
    }
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 8. Public Limit & Stop Order Book ("Swing Map") + Order Cancellation
app.post('/api/markets/:id/orders', async (c) => {
  try {
    const marketId = c.req.param('id');
    const { playerId, side, type, triggerLevel, sizeToks, idempotencyKey } = await c.req.json<{
      playerId: string;
      side: PositionSide;
      type: OrderType;
      triggerLevel: number;
      sizeToks: number;
      idempotencyKey?: string;
    }>();
    const validPlayerId = ensurePlayerRegistered(playerId);
    globalStore.clock.advance(250);
    const key = idempotencyKey || `ord_${marketId}_${validPlayerId}_${globalStore.clock.now()}`;
    const mkt = globalStore.engine.getMarket(marketId);
    const res = globalStore.engine.poolBook.placeOrder(
      mkt,
      validPlayerId,
      side,
      type,
      Number(triggerLevel),
      Number(sizeToks),
      key
    );
    globalStore.engine.createMarket(res.market);
    globalStore.engine.recordSwimlane(
      marketId,
      playerId,
      'LIVE',
      'L',
      `${type.toUpperCase()} @ ${triggerLevel}% (${sizeToks} TOKS)`
    );
    globalStore.engine.emitWireTrace(
      marketId,
      'PLAYER',
      'MARKET_ENGINE',
      `PLACE_${type.toUpperCase()}`,
      `${playerId.toUpperCase()} placed public ${type.toUpperCase()} on ${side} @ ${triggerLevel}% for ${sizeToks} TOKS`
    );
    globalStore.engine.logCascadesToWireAndSwimlanes(marketId, res.cascades);
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/markets/:id/orders/:orderId/cancel', async (c) => {
  try {
    const marketId = c.req.param('id');
    const orderId = c.req.param('orderId');
    const { playerId } = await c.req.json<{ playerId: string }>();
    globalStore.clock.advance(250);
    const mkt = globalStore.engine.getMarket(marketId);
    const cancelled = globalStore.engine.poolBook.cancelOrder(
      mkt,
      orderId,
      playerId,
      `cancel_ord_${orderId}_${globalStore.clock.now()}`
    );
    globalStore.engine.emitWireTrace(
      marketId,
      'PLAYER',
      'MARKET_ENGINE',
      'CANCEL_ORDER',
      `${playerId.toUpperCase()} cancelled order ${cancelled.id} (${cancelled.type.toUpperCase()})`
    );
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 9. P2P Position Transfer (Standing Bids, Asks, Auto-Sell, 1-Tap Cash-Out & Cancel)
app.post('/api/markets/:id/p2p/bid', async (c) => {
  try {
    const marketId = c.req.param('id');
    const { buyerId, side, priceToks } = await c.req.json<{
      buyerId: string;
      side: 'OVER' | 'UNDER';
      priceToks: number;
    }>();
    globalStore.clock.advance(250);
    const mkt = globalStore.engine.getMarket(marketId);
    const key = `p2p_bid_${marketId}_${buyerId}_${globalStore.clock.now()}`;
    const res = globalStore.engine.p2p.postStandingBid(mkt, buyerId, side, Number(priceToks), key);
    globalStore.engine.recordSwimlane(
      marketId,
      buyerId,
      'LIVE',
      'L',
      `P2P Bid ${priceToks} TOKS (1x ${side})`,
      -Number(priceToks)
    );
    globalStore.engine.emitWireTrace(
      marketId,
      'PLAYER',
      'MARKET_ENGINE',
      'P2P_STANDING_BID',
      `${buyerId.toUpperCase()} posted standing bid: ${priceToks} TOKS for 1x ${side}`,
      -Number(priceToks)
    );
    if (res.autoMatchedSale) {
      globalStore.engine.recordSwimlane(
        marketId,
        res.autoMatchedSale.sellerId,
        'LIVE',
        'W',
        `Auto-Sold 1x ${side} @ ${res.autoMatchedSale.priceToks} TOKS`,
        res.autoMatchedSale.priceToks
      );
    }
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/markets/:id/p2p/ask', async (c) => {
  try {
    const marketId = c.req.param('id');
    const { sellerId, side, minPriceToks, kind } = await c.req.json<{
      sellerId: string;
      side: 'OVER' | 'UNDER';
      minPriceToks: number;
      kind?: 'ASK' | 'AUTO_SELL';
    }>();
    globalStore.clock.advance(250);
    const mkt = globalStore.engine.getMarket(marketId);
    const orderKind = kind === 'AUTO_SELL' ? 'AUTO_SELL' : 'ASK';
    const key = `p2p_ask_${marketId}_${sellerId}_${globalStore.clock.now()}`;
    const res = globalStore.engine.p2p.postAskOrAutoSell(
      mkt,
      sellerId,
      side,
      Number(minPriceToks),
      orderKind,
      key
    );
    globalStore.engine.recordSwimlane(
      marketId,
      sellerId,
      'LIVE',
      res.autoMatchedSale ? 'W' : 'L',
      res.autoMatchedSale
        ? `Matched ${orderKind} 1x ${side} @ ${res.autoMatchedSale.priceToks} TOKS`
        : `${orderKind} 1x ${side} @ ${minPriceToks} TOKS`,
      res.autoMatchedSale ? res.autoMatchedSale.priceToks : undefined
    );
    globalStore.engine.emitWireTrace(
      marketId,
      'PLAYER',
      'MARKET_ENGINE',
      `P2P_${orderKind}`,
      `${sellerId.toUpperCase()} posted ${orderKind} for 1x ${side} @ ${minPriceToks} TOKS`
    );
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/markets/:id/p2p/cashout', async (c) => {
  try {
    const marketId = c.req.param('id');
    const { sellerId, side, bidId } = await c.req.json<{
      sellerId: string;
      side: 'OVER' | 'UNDER';
      bidId?: string;
    }>();
    globalStore.clock.advance(250);
    const mkt = globalStore.engine.getMarket(marketId);
    const key = `p2p_cashout_${marketId}_${sellerId}_${globalStore.clock.now()}`;
    const res = globalStore.engine.p2p.acceptStandingBid(mkt, sellerId, side, key, bidId);
    globalStore.engine.recordSwimlane(
      marketId,
      sellerId,
      'LIVE',
      'W',
      `P2P Cash-Out 1x ${side} to ${res.matchedBid.buyer_id.toUpperCase()} (+${res.matchedBid.price_toks} TOKS)`,
      res.matchedBid.price_toks
    );
    globalStore.engine.emitWireTrace(
      marketId,
      'PLAYER',
      'MARKET_ENGINE',
      'P2P_INSTANT_CASHOUT',
      `${sellerId.toUpperCase()} cashed out 1x ${side} lot to ${res.matchedBid.buyer_id.toUpperCase()} @ ${res.matchedBid.price_toks} TOKS`,
      res.matchedBid.price_toks
    );
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/markets/:id/p2p/:orderId/cancel', async (c) => {
  try {
    const marketId = c.req.param('id');
    const orderId = c.req.param('orderId');
    const { playerId } = await c.req.json<{ playerId: string }>();
    globalStore.clock.advance(250);
    const mkt = globalStore.engine.getMarket(marketId);
    globalStore.engine.p2p.cancelStandingOrder(
      mkt,
      orderId,
      playerId,
      `cancel_p2p_${orderId}_${globalStore.clock.now()}`
    );
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 10. Activate Conversational/Voice Strategy after 3-Part Risk Gate Confirmation
app.post('/api/markets/:id/strategy/activate', async (c) => {
  try {
    const marketId = c.req.param('id');
    const body = await c.req.json<Partial<StrategyMandate>>();
    globalStore.clock.advance(250);
    const now = globalStore.clock.now();
    const validPlayerId = ensurePlayerRegistered(body.player_id || 'you');
    const mkt = globalStore.engine.getMarket(marketId);
    if (
      mkt.archetype === 'spread' &&
      mkt.mm_player_id === validPlayerId &&
      globalStore.engine.spreadBook.getMmEscrow(marketId) === 0
    ) {
      const fallbackMm = ensurePlayerRegistered('house_mm');
      globalStore.engine.createMarket({ ...mkt, mm_player_id: fallbackMm });
    }
    const mandate: StrategyMandate = {
      id: body.id || `mandate_${now}`,
      market_id: marketId,
      player_id: validPlayerId,
      input_modality: body.input_modality || 'voice',
      raw_transcript: body.raw_transcript || '',
      parsed_strategy_summary: body.parsed_strategy_summary || '',
      side: body.side || 'YES',
      stake_toks: Number(body.stake_toks) || 100,
      entry_trigger_level:
        body.entry_trigger_level != null ? Number(body.entry_trigger_level) : null,
      take_profit_level:
        body.take_profit_level != null ? Number(body.take_profit_level) : null,
      min_balance_floor:
        body.min_balance_floor != null ? Number(body.min_balance_floor) : null,
      confirmed_at: body.confirmed_at ?? now,
      created_at: now,
    };

    globalStore.engine.activateConversationalStrategy(
      marketId,
      mandate,
      `strat_${marketId}_${now}`
    );
    // If spread market, also place the TP and SL on poolBook so they show on the vertical unit ladder graph
    const updatedMkt = globalStore.engine.getMarket(marketId);
    if (updatedMkt.archetype === 'spread') {
      if (mandate.take_profit_level != null) {
        globalStore.engine.poolBook.placeOrder(
          updatedMkt,
          validPlayerId,
          mandate.side,
          'take_profit',
          mandate.take_profit_level,
          mandate.stake_toks,
          `strat_tp_${marketId}_${now}`,
          mandate.id
        );
      }
      if (mandate.min_balance_floor != null) {
        globalStore.engine.poolBook.placeOrder(
          updatedMkt,
          validPlayerId,
          mandate.side,
          'stop_loss',
          mandate.min_balance_floor,
          mandate.stake_toks,
          `strat_sl_${marketId}_${now}`,
          mandate.id
        );
      }
    }
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json(
      { error: err.message, missingFields: err.missingFields || [] },
      400
    );
  }
});

// 11. Resolution & Arbiter Controls (Countdown Lock, Outcome Proposal, Challenge/Vote, Finalize, Reassign, Settle, Void)
app.post('/api/markets/:id/resolve/lock-countdown', async (c) => {
  try {
    const marketId = c.req.param('id');
    const mkt = globalStore.engine.getMarket(marketId);
    if (mkt.countdown_ends_at) {
      globalStore.clock.set(Math.max(globalStore.clock.now(), mkt.countdown_ends_at + 1000));
    }
    globalStore.engine.getMarket(marketId); // triggers countdown_locked check
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/markets/:id/resolve/propose', async (c) => {
  try {
    const marketId = c.req.param('id');
    const { proposerId, outcomeX, sourceUrl, settleImmediately } = await c.req.json<{
      proposerId: string;
      outcomeX: number;
      sourceUrl?: string;
      settleImmediately?: boolean;
    }>();
    globalStore.clock.advance(250);
    const mkt = globalStore.engine.getMarket(marketId);
    const propRes = globalStore.engine.resolution.proposeOutcome(
      mkt,
      proposerId,
      Number(outcomeX),
      sourceUrl || 'manual://terminal'
    );
    globalStore.engine.createMarket(propRes.market);
    globalStore.engine.emitWireTrace(
      marketId,
      proposerId === mkt.arbiter_id ? 'ORACLE_AGENT' : 'PLAYER',
      'MARKET_ENGINE',
      'OUTCOME_PROPOSED',
      `${proposerId.toUpperCase()} proposed outcome X=${outcomeX} (route=${mkt.route.toUpperCase()})`
    );

    if (propRes.readyToSettleImmediately || settleImmediately) {
      globalStore.engine.settleMarket(
        marketId,
        Number(outcomeX),
        `settle_${marketId}_${globalStore.clock.now()}`
      );
    }

    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/markets/:id/resolve/challenge', async (c) => {
  try {
    const marketId = c.req.param('id');
    const { playerId, votedX } = await c.req.json<{ playerId: string; votedX: number }>();
    globalStore.clock.advance(250);
    const mkt = globalStore.engine.getMarket(marketId);
    globalStore.engine.resolution.challengeAndVote(mkt, playerId, Number(votedX));
    globalStore.engine.emitWireTrace(
      marketId,
      'PLAYER',
      'MARKET_ENGINE',
      'OUTCOME_CHALLENGED_VOTE',
      `${playerId.toUpperCase()} challenged outcome proposal and voted X=${votedX}`
    );
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/markets/:id/resolve/finalize', async (c) => {
  try {
    const marketId = c.req.param('id');
    globalStore.clock.advance(250);
    const mkt = globalStore.engine.getMarket(marketId);
    const res = globalStore.engine.resolution.finalizeProposal(mkt);
    if (res.status === 'settle' && res.outcomeX != null) {
      globalStore.engine.settleMarket(
        marketId,
        res.outcomeX,
        `finalize_settle_${marketId}_${globalStore.clock.now()}`
      );
    } else {
      globalStore.engine.voidMarket(
        marketId,
        `finalize_void_${marketId}_${globalStore.clock.now()}`
      );
    }
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/markets/:id/resolve/reassign-arbiter', async (c) => {
  try {
    const marketId = c.req.param('id');
    const { adminId, newArbiterId } = await c.req.json<{ adminId: string; newArbiterId: string }>();
    const adminPlayer = globalStore.engine.ledger.getPlayer(adminId);
    const mkt = globalStore.engine.getMarket(marketId);
    const updated = globalStore.engine.resolution.reassignArbiter(
      mkt,
      adminPlayer.is_admin,
      newArbiterId
    );
    globalStore.engine.createMarket(updated);
    globalStore.engine.emitWireTrace(
      marketId,
      'PLAYER',
      'MARKET_ENGINE',
      'ARBITER_REASSIGNED',
      `Admin ${adminId.toUpperCase()} reassigned 3rd-party arbiter to ${newArbiterId.toUpperCase()}`
    );
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/markets/:id/resolve/settle', async (c) => {
  try {
    const marketId = c.req.param('id');
    const { outcomeX } = await c.req.json<{ outcomeX: number }>();
    globalStore.clock.advance(250);
    globalStore.engine.settleMarket(
      marketId,
      Number(outcomeX),
      `settle_${marketId}_${globalStore.clock.now()}`
    );
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/markets/:id/void', async (c) => {
  try {
    const marketId = c.req.param('id');
    globalStore.clock.advance(250);
    globalStore.engine.voidMarket(marketId, `void_${marketId}_${globalStore.clock.now()}`);
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 11b. Multi-Agent Pipeline Endpoints (Agent 1 Intake -> Agent 2 Classifier, 3-Part Risk Gate, Recap)
app.post('/api/agents/intake', async (c) => {
  try {
    const { prompt, playerId } = await c.req.json<{ prompt: string; playerId?: string }>();
    if (!prompt || !prompt.trim()) {
      return c.json({ error: 'Prompt is required for Agent 1 Intake' }, 400);
    }
    const { draft, lint, widthSuggestion } = await runAgent1Intake(prompt, c.env);
    const classification = await runAgent2Classifier(prompt, draft, c.env);

    const activeMarkets = globalStore.engine.getAllMarkets();
    const targetMarketId = activeMarkets[0]?.id || 'mkt_draft';
    globalStore.engine.recordClassificationLog({
      id: `clog_${globalStore.clock.now()}_${Math.floor(Math.random() * 1000)}`,
      market_id: targetMarketId,
      agent1_parsed_payload: draft,
      agent2_archetype: classification.archetype,
      agent2_verifiability: classification.verifiability,
      agent2_route: classification.route,
      confidence: classification.confidence,
      created_at: globalStore.clock.now(),
    });

    if (activeMarkets[0]) {
      globalStore.engine.emitWireTrace(
        activeMarkets[0].id,
        'PLAYER',
        'ORACLE_AGENT',
        'AGENT1_2_INTAKE_PIPELINE',
        `${(playerId || 'ana').toUpperCase()} prompt -> Agent 1 drafted "${draft.question}" | Agent 2 classified [${classification.archetype.toUpperCase()} / ${classification.route.toUpperCase()}] (conf=${Math.round(classification.confidence * 100)}%)`
      );
      globalStore.bumpVersion(activeMarkets[0].id);
      await globalStore.persistToD1(c.env);
    }

    return c.json({
      draft,
      lint,
      widthSuggestion,
      classification,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/agents/parse-strategy', async (c) => {
  try {
    const { marketId, transcript, modality, playerId } = await c.req.json<{
      marketId: string;
      transcript: string;
      modality?: 'voice' | 'text';
      playerId?: string;
    }>();
    const market = globalStore.engine.getMarket(marketId);
    const proposal = await parseStrategyRuleWithRiskGate(
      transcript,
      modality || 'voice',
      market,
      c.env
    );

    globalStore.engine.emitWireTrace(
      marketId,
      'PLAYER',
      'RISK_AGENT',
      `PARSE_RULE_${(modality || 'voice').toUpperCase()}`,
      `Transcript: "${transcript}" -> Gate=${proposal.gate_passed ? 'PASSED' : `BLOCKED (missing: ${proposal.missing_risk_gate_fields.join(', ')})`}`
    );
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);

    return c.json({
      proposal,
      advisoryFairValue: estimateAdvisoryFairValue(market),
      playerId: playerId || 'ana',
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.get('/api/agents/recap/:id', async (c) => {
  try {
    const marketId = c.req.param('id');
    const market = globalStore.engine.getMarket(marketId);
    const entries = globalStore.engine.ledger.getEntries(marketId);
    const netPnlByPlayer: Record<string, number> = {};
    for (const e of entries) {
      if (e.account === 'wallet') {
        netPnlByPlayer[e.player_id] = (netPnlByPlayer[e.player_id] ?? 0) + e.delta_toks;
      }
    }
    const recap = await generateMarketRecapAsync(market, netPnlByPlayer, c.env);
    return c.json({
      recap,
      netPnlByPlayer,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 11c. Deterministic Replay Mode & Feed Delay Endpoints
app.post('/api/markets/:id/replay/step', async (c) => {
  try {
    const marketId = c.req.param('id');
    const tick = stepDeterministicReplay(globalStore, marketId);
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json({
      ...globalStore.getFullMarketBundle(marketId),
      replayTick: tick,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/markets/:id/replay/feed-delayed', async (c) => {
  try {
    const marketId = c.req.param('id');
    toggleFeedDelayedStatus(globalStore, marketId);
    globalStore.bumpVersion(marketId);
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 12. Reset Demo State
app.post('/api/demo/reset', async (c) => {
  await globalStore.resetAndPersist(c.env);
  return c.json({ ok: true, stateVersion: globalStore.stateVersion });
});

// Default export for Cloudflare Workers runtime (serves API, WebSocket Upgrade, & Static Assets)
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle Cloudflare Workers WebSocket upgrade on /ws or /api/ws
    if (
      (url.pathname === '/ws' || url.pathname === '/api/ws') &&
      request.headers.get('Upgrade')?.toLowerCase() === 'websocket' &&
      typeof (globalThis as any).WebSocketPair !== 'undefined'
    ) {
      const pair = new (globalThis as any).WebSocketPair();
      const [client, server] = Object.values(pair) as [any, any];
      server.accept();
      let selectedMarketId = url.searchParams.get('marketId') || undefined;

      server.send(
        JSON.stringify({
          type: 'INITIAL_STATE',
          payload: globalStore.getTerminalStatePayload(selectedMarketId),
        })
      );

      const unsubscribe = globalStore.subscribe((evt) => {
        try {
          server.send(
            JSON.stringify({
              type: evt.type,
              payload: globalStore.getTerminalStatePayload(selectedMarketId || evt.marketId),
            })
          );
        } catch {
          unsubscribe();
        }
      });

      server.addEventListener('message', (msgEvent: any) => {
        try {
          const data = JSON.parse(String(msgEvent.data));
          if (data?.type === 'SELECT_MARKET' && typeof data.marketId === 'string') {
            selectedMarketId = data.marketId;
            server.send(
              JSON.stringify({
                type: 'STATE_UPDATED',
                payload: globalStore.getTerminalStatePayload(selectedMarketId),
              })
            );
          } else if (data?.type === 'PING') {
            server.send(
              JSON.stringify({
                type: 'PONG',
                stateVersion: globalStore.stateVersion,
                serverClockMs: globalStore.clock.now(),
              })
            );
          }
        } catch {
          // Ignore malformed WS message
        }
      });

      server.addEventListener('close', () => {
        unsubscribe();
      });

      return new Response(null, { status: 101, webSocket: client } as any);
    }

    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx);
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return app.fetch(request, env, ctx);
  },
};
