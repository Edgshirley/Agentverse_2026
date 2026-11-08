// ============================================================================
// Deterministic Replay Mode & Live Feed Tick Controller (SPEC §5.1, FR-09, §6.2)
// ============================================================================

import arsenalFixture from '../shared/fixtures/arsenal_match.json';
import { computePoissonSpreadFairValue } from '../engine/poisson';
import { EdgeStateStore } from './db';
import { LiveEvent, Market } from '../shared/types';

export interface ReplayTickResult {
  market: Market;
  liveEvent: LiveEvent;
  commentary: string;
  tickIndex: number;
  totalTicks: number;
}

export function stepDeterministicReplay(
  store: EdgeStateStore,
  marketId: string
): ReplayTickResult {
  let market = store.engine.getMarket(marketId);
  store.clock.advance(15_000); // 15s polling interval per SPEC §2.2.6 & §5.1

  const currentIdx = store.replayIndexByMarket.get(marketId) ?? 0;

  if (market.archetype === 'spread') {
    const fixture = arsenalFixture as Array<any>;
    const stepData = fixture[Math.min(currentIdx, fixture.length - 1)];
    store.replayIndexByMarket.set(marketId, Math.min(currentIdx + 1, fixture.length));

    const positions = store.engine.getMarketPositions(marketId);
    const overLots = positions
      .filter((p) => p.side === 'OVER' && p.lots > 0)
      .reduce((acc, p) => acc + p.lots, 0);
    const underLots = positions
      .filter((p) => p.side === 'UNDER' && p.lots > 0)
      .reduce((acc, p) => acc + p.lots, 0);
    const totalTakerEscrow = positions.reduce((acc, p) => acc + p.staked_toks, 0);
    const totalPot = totalTakerEscrow + store.engine.spreadBook.getMmEscrow(marketId);

    const poisson = computePoissonSpreadFairValue({
      currentMinute: stepData.minute,
      L: market.L ?? 35,
      H: market.H ?? 43,
      totalPotToks: Math.max(50, totalPot),
      overLots: Math.max(1, overLots),
      underLots: Math.max(1, underLots),
    });

    const liveEvent: LiveEvent = {
      id: `evt_${store.clock.now()}_${currentIdx}`,
      market_id: marketId,
      event_type: stepData.event_type,
      minute: stepData.minute,
      score_home: stepData.score_home,
      score_away: stepData.score_away,
      description: stepData.description,
      implied_value_after: stepData.implied_value,
      created_at: store.clock.now(),
    };
    store.engine.recordLiveEvent(marketId, liveEvent);

    // Handle VAR correction (SPEC §6.2: pending auto-outcome proposal withdrawn automatically)
    if (stepData.event_type === 'var_correction') {
      const reverted = store.engine.resolution.applyFeedCorrection(market, stepData.implied_value);
      market = {
        ...reverted.market,
        live_fair_value_toks: poisson.overLotFairValueToks,
        fair_value_source: 'POISSON_MODEL',
        feed_status: 'REPLAY',
      };
      store.engine.createMarket(market);
      store.engine.emitWireTrace(
        marketId,
        'REPLAY_FEED',
        'MARKET_ENGINE',
        'VAR_CORRECTION_REVERT',
        `${stepData.description} -> Pending proposal withdrawn; trading re-opened!`
      );
    } else if (stepData.propose_x != null) {
      market = {
        ...market,
        live_implied_value: stepData.implied_value,
        live_fair_value_toks: poisson.overLotFairValueToks,
        fair_value_source: 'POISSON_MODEL',
        feed_status: 'REPLAY',
      };
      const prop = store.engine.resolution.proposeOutcome(
        market,
        'AGENT_FEED',
        stepData.propose_x,
        'opta://replay/arsenal-chelsea'
      );
      market = prop.market;
      store.engine.createMarket(market);
      store.engine.emitWireTrace(
        marketId,
        'ORACLE_AGENT',
        'MARKET_ENGINE',
        'AUTO_PROPOSE_OUTCOME',
        `Feed proposed X=${stepData.propose_x} (${stepData.description})`
      );

      if (stepData.settle_immediately) {
        const settled = store.engine.settleMarket(
          marketId,
          stepData.propose_x,
          `replay_settle_${marketId}_${stepData.minute}`
        );
        market = settled.market;
      }
    } else {
      market = {
        ...market,
        live_implied_value: stepData.implied_value,
        live_fair_value_toks: poisson.overLotFairValueToks,
        fair_value_source: 'POISSON_MODEL',
        feed_status: 'REPLAY',
        version: market.version + 1,
      };
      store.engine.createMarket(market);
      store.engine.emitWireTrace(
        marketId,
        'REPLAY_FEED',
        'BROADCAST',
        `FEED_TICK_${stepData.minute}M`,
        `${stepData.description} | ${poisson.commentary}`
      );
      store.engine.syncChildStackedMarkets(marketId, `replay_stack_${stepData.minute}`);
    }

    return {
      market,
      liveEvent,
      commentary: poisson.commentary,
      tickIndex: currentIdx + 1,
      totalTicks: fixture.length,
    };
  }

  // Continuous pool / weather market replay tick: shift odds to test stop/limit cascades
  const weatherSteps = [49, 45, 58, 74];
  const targetImplied = weatherSteps[currentIdx % weatherSteps.length];
  store.replayIndexByMarket.set(marketId, currentIdx + 1);

  const shiftRes = store.engine.poolBook.applyExternalOddsShift(
    market,
    targetImplied,
    `replay_pool_${marketId}_${currentIdx}`
  );
  market = {
    ...shiftRes.market,
    live_fair_value_toks: shiftRes.market.live_implied_value,
    fair_value_source: 'POOL_IMPLIED',
    feed_status: 'REPLAY',
  };
  store.engine.createMarket(market);
  store.engine.logCascadesToWireAndSwimlanes(marketId, shiftRes.cascades);
  store.engine.syncChildStackedMarkets(marketId, `replay_pool_stack_${currentIdx}`);

  const liveEvent: LiveEvent = {
    id: `evt_${store.clock.now()}_${currentIdx}`,
    market_id: marketId,
    event_type: 'weather_tick',
    minute: (currentIdx + 1) * 15,
    description: `Live sensor update -> Implied odds shifted to ${market.live_implied_value}% (${shiftRes.cascades.length} cascade order(s) triggered)`,
    implied_value_after: market.live_implied_value,
    created_at: store.clock.now(),
  };
  store.engine.recordLiveEvent(marketId, liveEvent);

  store.engine.emitWireTrace(
    marketId,
    'REPLAY_FEED',
    'MARKET_ENGINE',
    'LIVE_FEED_ODDS_TICK',
    liveEvent.description
  );

  return {
    market,
    liveEvent,
    commentary: liveEvent.description,
    tickIndex: currentIdx + 1,
    totalTicks: weatherSteps.length,
  };
}

/**
 * Simulates a mid-event feed drop (SPEC §6.2):
 * Ticker displays `FEED_DELAYED`; trading/cash-out continues; fair value falls back to labelled `AI_ADVISORY`.
 */
export function toggleFeedDelayedStatus(store: EdgeStateStore, marketId: string): Market {
  const m = store.engine.getMarket(marketId);
  const nextStatus = m.feed_status === 'FEED_DELAYED' ? 'LIVE' : 'FEED_DELAYED';
  const updated: Market = {
    ...m,
    feed_status: nextStatus,
    fair_value_source: nextStatus === 'FEED_DELAYED' ? 'AI_ADVISORY' : 'POISSON_MODEL',
    version: m.version + 1,
  };
  store.engine.createMarket(updated);
  store.engine.emitWireTrace(
    marketId,
    'ORACLE_AGENT',
    'BROADCAST',
    nextStatus === 'FEED_DELAYED' ? 'FEED_DELAYED_FALLBACK' : 'FEED_RESTORED',
    nextStatus === 'FEED_DELAYED'
      ? 'Live feed delayed -> Fair value switched to labelled AI estimate (estimate_fair_value); trading remains open'
      : 'Live feed restored -> Poisson analytical model active'
  );
  return updated;
}
