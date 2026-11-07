import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DeterministicClock } from '../src/engine/clock';
import { SpreadEngine } from '../src/engine/state_machine';
import { Market, PayoffMode } from '../src/shared/types';

function createBaseEngine() {
  const clock = new DeterministicClock(1762542000000);
  const engine = new SpreadEngine(clock);
  const playerIds = ['ana', 'ben', 'cat', 'dan'];
  for (const id of playerIds) {
    engine.ledger.registerPlayer({
      id,
      group_id: 'grp_prop',
      nickname: id.toUpperCase(),
      is_admin: id === 'ana',
      wallet_balance_toks: 5000,
      escrow_balance_toks: 0,
    });
  }
  return { clock, engine, playerIds };
}

describe('Section 7.1 Property-Based Invariant Suite (fast-check)', () => {
  it('Invariant 1 & 2: Zero-Sum & Solvency across Pot, Binary, Linear, and Log spread markets', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<PayoffMode>('pot', 'binary', 'linear', 'log'),
        fc.integer({ min: 5, max: 50 }), // k
        fc.integer({ min: 10, max: 60 }), // L (>0 for log mode)
        fc.integer({ min: 4, max: 25 }), // width w
        fc.array(
          fc.record({
            playerIdx: fc.integer({ min: 1, max: 3 }), // ben, cat, dan
            side: fc.constantFrom<'OVER' | 'UNDER'>('OVER', 'UNDER'),
            lots: fc.integer({ min: 1, max: 3 }),
          }),
          { minLength: 1, maxLength: 6 }
        ),
        fc.integer({ min: 1, max: 95 }), // outcome X
        (mode, k, L, w, takes, outcomeX) => {
          const { clock, engine, playerIds } = createBaseEngine();
          const H = L + w;
          let mkt: Market = {
            id: 'mkt_prop_spread',
            group_id: 'grp_prop',
            proposer_id: 'ana',
            archetype: 'spread',
            question: 'Property test spread market',
            unit: 'units',
            bounds: [1, 100],
            no_event_value: 50,
            criteria: 'Property test',
            resolution_source: 'PropFeed',
            payoff_mode: mode,
            lot_stake_k: k,
            cap_widths_c: 3,
            state: 'quoting',
            verifiability: 'public_verifiable',
            route: 'auto',
            mm_player_id: 'ana',
            active_width_w: w,
            live_implied_value: (L + H) / 2,
            toggles: {
              max_lots: 3,
              forced_trading: false,
              hidden_takes: false,
              single_mm_requote: false,
              live_reopen_halftime: false,
            },
            version: 1,
            created_at: clock.now(),
          };

          mkt = engine.auction.submitQuote(mkt, 'ana', L);
          engine.createMarket(mkt);

          takes.forEach((t, idx) => {
            const pid = playerIds[t.playerIdx];
            engine.executeOneTapTake('mkt_prop_spread', pid, t.side, t.lots, `take_${idx}`);
            engine.ledger.assertInvariants();
          });

          const res = engine.settleMarket('mkt_prop_spread', outcomeX, 'settle_prop');

          // Zero-Sum Invariant: sum(delta wallet_balance_toks) === 0
          const netPnlSum = Object.values(res.netPnlByPlayer).reduce((a, b) => a + b, 0);
          expect(netPnlSum).toBe(0);

          // Solvency Invariant: all wallets >= 0, all escrows == 0 after settlement, all live_equity >= 0
          engine.ledger.assertInvariants();
          for (const p of engine.ledger.getAllPlayers()) {
            expect(p.wallet_balance_toks).toBeGreaterThanOrEqual(0);
            expect(p.escrow_balance_toks).toBe(0);
          }
          for (const pos of engine.getMarketPositions('mkt_prop_spread')) {
            expect(pos.live_equity_toks).toBeGreaterThanOrEqual(0);
          }
        }
      ),
      { numRuns: 60 }
    );
  });

  it('Invariant 1, 2 & 3: Zero-Sum, Solvency, and Deterministic Replay across continuous pool withdrawals & stop cascades', () => {
    const commandArb = fc.array(
      fc.oneof(
        fc.record({
          kind: fc.constant<'ENTER'>('ENTER'),
          playerIdx: fc.integer({ min: 0, max: 3 }),
          side: fc.constantFrom<'YES' | 'NO'>('YES', 'NO'),
          stake: fc.integer({ min: 20, max: 120 }),
        }),
        fc.record({
          kind: fc.constant<'WITHDRAW'>('WITHDRAW'),
          playerIdx: fc.integer({ min: 0, max: 3 }),
          side: fc.constantFrom<'YES' | 'NO'>('YES', 'NO'),
          fraction: fc.constantFrom(0.25, 0.5, 1.0),
        }),
        fc.record({
          kind: fc.constant<'STOP'>('STOP'),
          playerIdx: fc.integer({ min: 0, max: 3 }),
          side: fc.constantFrom<'YES' | 'NO'>('YES', 'NO'),
          trigger: fc.integer({ min: 25, max: 75 }),
          size: fc.integer({ min: 20, max: 80 }),
        }),
        fc.record({
          kind: fc.constant<'FEED_SHIFT'>('FEED_SHIFT'),
          implied: fc.integer({ min: 15, max: 85 }),
        })
      ),
      { minLength: 3, maxLength: 12 }
    );

    const runTrajectory = (commands: any[], settleX: number) => {
      const { clock, engine, playerIds } = createBaseEngine();
      engine.createMarket({
        id: 'mkt_replay',
        group_id: 'grp_prop',
        proposer_id: 'ana',
        archetype: 'simple',
        question: 'Replay determinism test',
        unit: '%',
        bounds: [0, 100],
        no_event_value: 0,
        criteria: 'Deterministic',
        resolution_source: 'Replay',
        payoff_mode: 'pot',
        lot_stake_k: 20,
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
        created_at: clock.now(),
      });

      commands.forEach((cmd, idx) => {
        clock.advance(1000);
        const pid = playerIds[cmd.playerIdx ?? 0];
        try {
          if (cmd.kind === 'ENTER') {
            engine.executeOneTapTake('mkt_replay', pid, cmd.side, cmd.stake, `cmd_${idx}`);
          } else if (cmd.kind === 'WITHDRAW') {
            engine.withdrawFromPool('mkt_replay', pid, cmd.side, cmd.fraction, `cmd_${idx}`);
          } else if (cmd.kind === 'STOP') {
            engine.poolBook.placeOrder(
              engine.getMarket('mkt_replay'),
              pid,
              cmd.side,
              'stop_loss',
              cmd.trigger,
              cmd.size,
              `cmd_${idx}`
            );
          } else if (cmd.kind === 'FEED_SHIFT') {
            engine.poolBook.applyExternalOddsShift(
              engine.getMarket('mkt_replay'),
              cmd.implied,
              `cmd_${idx}`
            );
          }
        } catch {
          // Expected rejections (e.g. withdrawing when live_equity == 0) must leave ledger invariants intact
        }
        engine.ledger.assertInvariants();
        for (const pos of engine.getMarketPositions('mkt_replay')) {
          expect(pos.live_equity_toks).toBeGreaterThanOrEqual(0);
        }
      });

      const swingTreeBeforeSettle = engine.getSwingTree('mkt_replay');
      const settled = engine.settleMarket('mkt_replay', settleX, 'settle_final');
      engine.ledger.assertInvariants();

      return {
        wallets: engine.ledger.getAllPlayers().map((p) => p.wallet_balance_toks),
        entries: engine.ledger.getEntries('mkt_replay'),
        swingTree: swingTreeBeforeSettle,
        netPnl: settled.netPnlByPlayer,
      };
    };

    fc.assert(
      fc.property(commandArb, fc.constantFrom(0, 100), (commands, settleX) => {
        const run1 = runTrajectory(commands, settleX);
        const run2 = runTrajectory(commands, settleX);

        // Deterministic Replay Invariant: identical command + LiveEvent log with injected clock
        // yields the exact same ledger and Swing Tree state!
        expect(run1.wallets).toEqual(run2.wallets);
        expect(run1.entries).toEqual(run2.entries);
        expect(run1.swingTree).toEqual(run2.swingTree);
        expect(run1.netPnl).toEqual(run2.netPnl);
      }),
      { numRuns: 40 }
    );
  });
});
