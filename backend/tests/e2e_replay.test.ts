import { describe, it, expect } from 'vitest';
import { EdgeStateStore } from '../src/worker/db';
import { stepDeterministicReplay, toggleFeedDelayedStatus } from '../src/worker/replay';
import { generateMarketRecap } from '../src/worker/agents';

describe('End-to-End Integration: Recorded Match Replay Mode & Stacked Settlement (SPEC §7.1)', () => {
  it('drives mkt_arsenal through P2P sale, VAR disallowed goal correction, confirmed goal at 50m, and Stacked market resolution', () => {
    const store = new EdgeStateStore();

    // 1. Verify initial seeded mkt_arsenal state ([35, 43] quoted by Ana, Cat has open 20 CHIP standing bid)
    const initialBundle = store.getFullMarketBundle('mkt_arsenal');
    expect(initialBundle.market.state).toBe('live');
    expect(initialBundle.market.L).toBe(35);
    expect(initialBundle.market.H).toBe(43);

    // 2. Ben accepts Cat's 20 CHIP standing P2P bid for 1 Over lot
    const openBid = initialBundle.p2pBids.find((b) => b.status === 'open' && b.buyer_id === 'cat');
    expect(openBid).toBeDefined();
    store.engine.p2p.acceptStandingBid(
      initialBundle.market,
      'ben',
      'OVER',
      'e2e_ben_sell',
      openBid!.id
    );

    // 3. Step Replay Mode through ticks 1..3 (kickoff, 18', 30')
    stepDeterministicReplay(store, 'mkt_arsenal'); // 1'
    stepDeterministicReplay(store, 'mkt_arsenal'); // 18'
    const tick30 = stepDeterministicReplay(store, 'mkt_arsenal'); // 30'
    expect(tick30.liveEvent.minute).toBe(30);
    expect(tick30.market.state).toBe('live');

    // 4. Tick 4 (min 38'): Provisional goal inside [35, 43] -> state becomes outcome_proposed (X=38)
    const tick38 = stepDeterministicReplay(store, 'mkt_arsenal');
    expect(tick38.liveEvent.minute).toBe(38);
    expect(tick38.market.state).toBe('outcome_proposed');

    // Early exits are frozen while outcome proposal is pending (SPEC §6.2)
    expect(() =>
      store.engine.p2p.postStandingBid(tick38.market, 'dan', 'UNDER', 12, 'frozen_bid')
    ).toThrow(/frozen/);

    // 5. Tick 5 (min 40'): VAR disallows goal! Pending auto-outcome proposal withdrawn; market re-opens to live!
    const tick40 = stepDeterministicReplay(store, 'mkt_arsenal');
    expect(tick40.liveEvent.event_type).toBe('var_correction');
    expect(tick40.market.state).toBe('live');

    // Test mid-event feed drop fallback to AI_ADVISORY and recovery (SPEC §6.2)
    const delayed = toggleFeedDelayedStatus(store, 'mkt_arsenal');
    expect(delayed.feed_status).toBe('FEED_DELAYED');
    expect(delayed.fair_value_source).toBe('AI_ADVISORY');
    const restored = toggleFeedDelayedStatus(store, 'mkt_arsenal');
    expect(restored.feed_status).toBe('LIVE');

    // 6. Tick 6 (min 45' Halftime) & Tick 7 (min 50' Confirmed Goal -> settles at X=50!)
    stepDeterministicReplay(store, 'mkt_arsenal'); // 45'
    const tick50 = stepDeterministicReplay(store, 'mkt_arsenal'); // 50'
    expect(tick50.market.state).toBe('settled');
    expect(tick50.market.outcome_x).toBe(50);

    // 7. Verify child Stacked market (`mkt_stacked_ana`: "Will ANA finish Arsenal Market M1 with positive P&L?")
    // Since X=50 (Over wins), Ana (MM) finished with -20 CHIP P&L (not > 0), so mkt_stacked_ana automatically settled at X=0 (NO wins)!
    const childStacked = store.engine.getMarket('mkt_stacked_ana');
    expect(childStacked.state).toBe('settled');
    expect(childStacked.outcome_x).toBe(0);

    // 8. Verify post-settlement recap & zero-sum invariant
    store.engine.ledger.assertInvariants();
    const recap = generateMarketRecap(tick50.market, {
      ben: 10,
      cat: 20,
      dan: -10,
      ana: -20,
    });
    expect(recap.headline).toContain('X = 50');
    expect(recap.calibration_note).toContain('OVER WON');
  });
});
