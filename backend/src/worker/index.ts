// ============================================================================
// Cloudflare Worker Entrypoint & Hono REST / Sync Hub (SPEC §5.1)
// ============================================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, globalStore } from './db';
import { Market, OrderType, PositionSide, StrategyMandate } from '../shared/types';
import {
  estimateAdvisoryFairValue,
  generateMarketRecap,
  parseStrategyRuleWithRiskGate,
  runAgent1Intake,
  runAgent2Classifier,
} from './agents';
import { stepDeterministicReplay, toggleFeedDelayedStatus } from './replay';

export const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors());

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

// 1. Get complete group & active market terminal state
app.get('/api/state', async (c) => {
  const requestedMarketId = c.req.query('marketId');
  const markets = globalStore.engine.getAllMarkets();
  const activeMarketId =
    requestedMarketId && markets.some((m) => m.id === requestedMarketId)
      ? requestedMarketId
      : markets[0]?.id;

  const activeBundle = activeMarketId
    ? globalStore.getFullMarketBundle(activeMarketId)
    : null;

  return c.json({
    stateVersion: globalStore.stateVersion,
    serverClockMs: globalStore.clock.now(),
    group: globalStore.group,
    players: globalStore.engine.ledger.getAllPlayers(),
    markets,
    activeBundle,
    ledgerEntries: activeMarketId
      ? globalStore.engine.ledger.getEntries(activeMarketId)
      : [],
  });
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
      toggles: body.toggles || {
        max_lots: 3,
        forced_trading: false,
        hidden_takes: false,
        single_mm_requote: true,
        live_reopen_halftime: false,
      },
      version: 1,
      created_at: now,
    };

    if (archetype === 'spread') {
      market = globalStore.engine.auction.startAuction(market);
    }

    const created = globalStore.engine.createMarket(market);
    globalStore.bumpVersion();
    await globalStore.persistToD1(c.env);

    return c.json({
      market: created,
      bundle: globalStore.getFullMarketBundle(created.id),
    });
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
    globalStore.bumpVersion();
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
    globalStore.bumpVersion();
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
    const updated = globalStore.engine.auction.submitQuote(market, playerId, Number(L));
    globalStore.engine.createMarket(updated);
    globalStore.engine.emitWireTrace(
      marketId,
      'PLAYER',
      'MARKET_ENGINE',
      'MM_QUOTE_SUBMITTED',
      `MM ${playerId.toUpperCase()} quoted [${updated.L}, ${updated.H}]`
    );
    globalStore.bumpVersion();
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
    globalStore.bumpVersion();
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
    globalStore.clock.advance(250);
    const key = idempotencyKey || `take_${marketId}_${validPlayerId}_${globalStore.clock.now()}`;
    globalStore.engine.executeOneTapTake(marketId, validPlayerId, side, Number(amount), key);
    globalStore.bumpVersion();
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
    globalStore.bumpVersion();
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
    globalStore.engine.withdrawFromPool(marketId, playerId, side, Number(fractionP), key);
    globalStore.bumpVersion();
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 8. Public Limit & Stop Order Book ("Swing Map")
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
    globalStore.bumpVersion();
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 9. P2P Position Transfer (Standing Bids, Asks, Auto-Sell, & 1-Tap Cash-Out)
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
    globalStore.bumpVersion();
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
    globalStore.bumpVersion();
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
    globalStore.bumpVersion();
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json(
      { error: err.message, missingFields: err.missingFields || [] },
      400
    );
  }
});

// 11. Resolution & Arbiter Controls (Countdown Lock, Outcome Proposal, Settle)
app.post('/api/markets/:id/resolve/lock-countdown', async (c) => {
  try {
    const marketId = c.req.param('id');
    const mkt = globalStore.engine.getMarket(marketId);
    if (mkt.countdown_ends_at) {
      globalStore.clock.set(Math.max(globalStore.clock.now(), mkt.countdown_ends_at + 1000));
    }
    globalStore.engine.getMarket(marketId); // triggers countdown_locked check
    globalStore.bumpVersion();
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

    globalStore.bumpVersion();
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
    globalStore.bumpVersion();
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
    if (activeMarkets[0]) {
      globalStore.engine.emitWireTrace(
        activeMarkets[0].id,
        'PLAYER',
        'ORACLE_AGENT',
        'AGENT1_2_INTAKE_PIPELINE',
        `${(playerId || 'ana').toUpperCase()} prompt -> Agent 1 drafted "${draft.question}" | Agent 2 classified [${classification.archetype.toUpperCase()} / ${classification.route.toUpperCase()}] (conf=${Math.round(classification.confidence * 100)}%)`
      );
      globalStore.bumpVersion();
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
    globalStore.bumpVersion();

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
    return c.json({
      recap: generateMarketRecap(market, netPnlByPlayer),
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
    globalStore.bumpVersion();
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
    globalStore.bumpVersion();
    await globalStore.persistToD1(c.env);
    return c.json(globalStore.getFullMarketBundle(marketId));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 12. Reset Demo State
app.post('/api/demo/reset', async (c) => {
  globalStore.reset();
  await globalStore.persistToD1(c.env);
  return c.json({ ok: true, stateVersion: globalStore.stateVersion });
});

// Default export for Cloudflare Workers runtime (serves API + falls back to Static Assets)
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx);
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return app.fetch(request, env, ctx);
  },
};
