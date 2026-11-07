import { describe, it, expect } from 'vitest';
import { DeterministicClock } from '../src/engine/clock';
import { SpreadEngine } from '../src/engine/state_machine';
import { Market } from '../src/shared/types';

function setupEngineWithPlayers() {
  const clock = new DeterministicClock(1762542000000);
  const engine = new SpreadEngine(clock);
  for (const id of ['ana', 'ben', 'cat', 'dan', 'arb']) {
    engine.ledger.registerPlayer({
      id,
      group_id: 'grp_1',
      nickname: id.toUpperCase(),
      is_admin: id === 'ana',
      wallet_balance_toks: 1000,
      escrow_balance_toks: 0,
    });
  }
  return { clock, engine };
}

function makeSimpleMarket(id: string, overrides: Partial<Market> = {}): Market {
  return {
    id,
    group_id: 'grp_1',
    proposer_id: 'ana',
    archetype: 'simple',
    question: 'Will it be 24°C tomorrow?',
    unit: '°C',
    bounds: [0, 100],
    no_event_value: 0,
    criteria: 'Official Met Office high temp >= 24°C',
    resolution_source: 'Met Office',
    payoff_mode: 'pot',
    lot_stake_k: 50,
    cap_widths_c: 3,
    state: 'live',
    verifiability: 'public_verifiable',
    route: 'auto',
    live_implied_value: 50,
    toggles: {
      max_lots: 3,
      forced_trading: false,
      hidden_takes: false,
      single_mm_requote: false,
      live_reopen_halftime: false,
    },
    version: 1,
    created_at: 1762542000000,
    ...overrides,
  };
}

describe('Continuous Pool, Partial Withdrawals, Limit/Stop Cascades & Edge Cases (SPEC §2.4.B & §6.2)', () => {
  it('supports anytime partial withdrawal (p in (0, 1]) and rejects withdrawal when live_equity_toks == 0', () => {
    const { engine } = setupEngineWithPlayers();
    engine.createMarket(makeSimpleMarket('m_pool'));

    engine.executeOneTapTake('m_pool', 'ana', 'YES', 100, 't_ana');
    engine.executeOneTapTake('m_pool', 'ben', 'NO', 100, 't_ben');

    // Ana withdraws 50% of her live equity
    const halfRes = engine.withdrawFromPool('m_pool', 'ana', 'YES', 0.5, 'w_ana_half');
    expect(halfRes.withdrawnToks).toBeGreaterThan(0);

    // Ana withdraws the remaining 100% of her position
    const fullRes = engine.withdrawFromPool('m_pool', 'ana', 'YES', 1.0, 'w_ana_full');
    expect(fullRes.withdrawnToks).toBeGreaterThan(0);

    // Attempting to withdraw again when live_equity_toks == 0 is rejected immediately (SPEC §6.2)
    expect(() =>
      engine.withdrawFromPool('m_pool', 'ana', 'YES', 0.5, 'w_ana_depleted')
    ).toThrow(/live_equity_toks == 0/);

    engine.ledger.assertInvariants();
  });

  it('triggers cascading stop_loss orders atomically in price-time priority and computes the Swing Tree', () => {
    const { engine } = setupEngineWithPlayers();
    const mkt = engine.createMarket(makeSimpleMarket('m_cascade'));

    engine.executeOneTapTake('m_cascade', 'ana', 'YES', 200, 'e_ana');
    engine.executeOneTapTake('m_cascade', 'ben', 'YES', 150, 'e_ben');
    engine.executeOneTapTake('m_cascade', 'cat', 'NO', 200, 'e_cat');

    // Ana and Ben place public stop_loss orders on the Swing Map
    const currentMarket = engine.getMarket('m_cascade');
    engine.poolBook.placeOrder(currentMarket, 'ana', 'YES', 'stop_loss', 46, 100, 'ord_ana_stop');
    engine.poolBook.placeOrder(currentMarket, 'ben', 'YES', 'stop_loss', 42, 100, 'ord_ben_stop');

    // Verify Swing Tree projects the counterfactual stop branches before they are hit
    const treeBefore = engine.getSwingTree('m_cascade');
    expect(treeBefore.counterfactual_branches.length).toBeGreaterThanOrEqual(2);
    expect(treeBefore.counterfactual_branches.every((b) => b.orders_triggered >= 1)).toBe(true);

    // External feed shifts odds down to 45% -> triggers Ana's stop at 46%, which shifts odds down by -5% to 40%,
    // which in turn cascades and triggers Ben's stop at 42% within the exact same transaction!
    const { cascades } = engine.poolBook.applyExternalOddsShift(
      engine.getMarket('m_cascade'),
      45,
      'feed_drop_45'
    );
    expect(cascades.length).toBe(2);
    expect(cascades[0].playerId).toBe('ana');
    expect(cascades[1].playerId).toBe('ben');

    engine.ledger.assertInvariants();
  });

  it('enforces Arbiter countdown lock (00:00:00) and bars arbiter_id from trading (SPEC §6.2 & FR-08)', () => {
    const { clock, engine } = setupEngineWithPlayers();
    const countdownEndsAt = clock.now() + 60_000;
    engine.createMarket(
      makeSimpleMarket('m_arb', {
        verifiability: 'custom_unverifiable',
        route: 'arbiter',
        arbiter_id: 'arb',
        countdown_ends_at: countdownEndsAt,
      })
    );

    // Arbiter attempting to trade is rejected
    expect(() =>
      engine.executeOneTapTake('m_arb', 'arb', 'YES', 50, 'arb_illegal_trade')
    ).toThrow(/arbiter/i);

    engine.executeOneTapTake('m_arb', 'ana', 'YES', 100, 'ana_valid_trade');
    engine.executeOneTapTake('m_arb', 'ben', 'NO', 100, 'ben_valid_trade');

    // Advance clock past countdown_ends_at (00:00:00)
    clock.advance(61_000);
    const lockedMkt = engine.getMarket('m_arb');
    expect(lockedMkt.state).toBe('countdown_locked');

    // Bets and withdrawals are frozen after 00:00:00
    expect(() =>
      engine.withdrawFromPool('m_arb', 'ana', 'YES', 0.5, 'ana_late_withdraw')
    ).toThrow(/frozen/);

    // Non-arbiter cannot submit outcome
    expect(() =>
      engine.resolution.proposeOutcome(lockedMkt, 'ana', 100)
    ).toThrow(/Only designated 3rd-party arbiter/);

    // Designated arbiter submits outcome X -> immediate settlement
    const propRes = engine.resolution.proposeOutcome(lockedMkt, 'arb', 100);
    expect(propRes.readyToSettleImmediately).toBe(true);
    const settled = engine.settleMarket('m_arb', 100, 'arb_settle');
    expect(settled.market.state).toBe('settled');
    expect(settled.netPnlByPlayer['ana']).toBe(100);
    expect(settled.netPnlByPlayer['ben']).toBe(-100);
  });

  it('enforces Stacked market parent-void rules (outcome/player_pnl void vs crossed odds/volume settle)', () => {
    const { engine } = setupEngineWithPlayers();
    engine.createMarket(makeSimpleMarket('m_parent', { live_implied_value: 60 }));

    // Child 1: Stacked on parent's `odds` hitting 75%
    engine.createMarket(
      makeSimpleMarket('m_child_odds', {
        archetype: 'stacked',
        question: 'Will m_parent odds hit 75%?',
        parent_market_id: 'm_parent',
        parent_metric: 'odds',
        parent_trigger_target: 75,
      })
    );

    // Child 2: Stacked on Ana finishing m_parent with positive P&L (`player_pnl > 0`)
    engine.createMarket(
      makeSimpleMarket('m_child_pnl', {
        archetype: 'stacked',
        question: 'Will Ana finish m_parent with positive P&L?',
        parent_market_id: 'm_parent',
        parent_metric: 'player_pnl',
        parent_target_player_id: 'ana',
        parent_trigger_target: 0,
      })
    );

    engine.executeOneTapTake('m_child_odds', 'ben', 'YES', 100, 'c1_ben');
    engine.executeOneTapTake('m_child_odds', 'cat', 'NO', 100, 'c1_cat');
    engine.executeOneTapTake('m_child_pnl', 'ben', 'YES', 100, 'c2_ben');
    engine.executeOneTapTake('m_child_pnl', 'cat', 'NO', 100, 'c2_cat');

    // Parent voids BEFORE odds hit 75% -> both child markets void and refund stakes
    engine.voidMarket('m_parent', 'void_parent_1');
    expect(engine.getMarket('m_child_odds').state).toBe('void');
    expect(engine.getMarket('m_child_pnl').state).toBe('void');
    engine.ledger.assertInvariants();
  });
});
