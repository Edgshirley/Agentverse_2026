import { describe, it, expect } from 'vitest';
import { DeterministicClock } from '../src/engine/clock';
import { ToksLedger } from '../src/engine/ledger';
import { WidthAuctionEngine, AUCTION_QUIET_PERIOD_MS } from '../src/engine/auction';
import { SpreadMarketBook, evaluatePerLotPayoff } from '../src/engine/payoffs';
import { P2PTransferEngine } from '../src/engine/mm_transfer';
import { Market } from '../src/shared/types';

function createGoldenScenario() {
  const clock = new DeterministicClock(1762542000000);
  const ledger = new ToksLedger(clock);

  // Register Ana, Ben, Cat, Dan with 1,000 TOKS each
  const initialBalance = 1000;
  for (const [id, nickname] of [
    ['ana', 'Ana'],
    ['ben', 'Ben'],
    ['cat', 'Cat'],
    ['dan', 'Dan'],
  ]) {
    ledger.registerPlayer({
      id,
      group_id: 'grp_1',
      nickname,
      is_admin: id === 'ana',
      wallet_balance_toks: initialBalance,
      escrow_balance_toks: 0,
    });
  }

  const auction = new WidthAuctionEngine(clock, ledger);
  const spreadBook = new SpreadMarketBook(clock, ledger);
  const p2p = new P2PTransferEngine(clock, ledger, spreadBook);

  let market: Market = {
    id: 'mkt_golden',
    group_id: 'grp_1',
    proposer_id: 'ana',
    archetype: 'spread',
    question: 'When will Team A score first?',
    unit: 'minutes',
    bounds: [0, 95],
    no_event_value: 95,
    criteria: 'Official league match clock minute of Team A first goal; 95 if no goal.',
    resolution_source: 'Official Match Feed',
    payoff_mode: 'pot',
    lot_stake_k: 10,
    cap_widths_c: 3,
    state: 'draft',
    verifiability: 'public_verifiable',
    route: 'auto',
    live_implied_value: 47.5,
    toggles: {
      max_lots: 3,
      forced_trading: false,
      hidden_takes: true,
      single_mm_requote: false,
      live_reopen_halftime: false,
    },
    version: 1,
    created_at: clock.now(),
  };

  // 1. Start Width Auction & place bids: 20, 15, 10, 8 -> Ana wins (w = 8)
  market = auction.startAuction(market);
  market = auction.placeWidthBid(market, 'dan', 20).market;
  clock.advance(5000);
  market = auction.placeWidthBid(market, 'cat', 15).market;
  clock.advance(5000);
  market = auction.placeWidthBid(market, 'ben', 10).market;
  clock.advance(5000);
  market = auction.placeWidthBid(market, 'ana', 8).market;

  // Quiet period of 30s passes
  clock.advance(AUCTION_QUIET_PERIOD_MS);
  market = auction.finalizeAuction(market);
  expect(market.state).toBe('quoting');
  expect(market.mm_player_id).toBe('ana');
  expect(market.active_width_w).toBe(8);

  // 2. Ana quotes [35, 43]
  market = auction.submitQuote(market, 'ana', 35);
  expect(market.state).toBe('open');
  expect(market.L).toBe(35);
  expect(market.H).toBe(43);

  // 3. Takers enter: Ben (1 Over), Cat (1 Over), Dan (1 Under)
  market = spreadBook.takeSpreadPosition(market, 'ben', 'OVER', 1, 'take_ben').market;
  market = spreadBook.takeSpreadPosition(market, 'cat', 'OVER', 1, 'take_cat').market;
  market = spreadBook.takeSpreadPosition(market, 'dan', 'UNDER', 1, 'take_dan').market;

  // Verify total pot = 50 TOKS (30 from takers + 20 from Ana MM)
  expect(spreadBook.getMmEscrow(market.id)).toBe(20);
  const totalEscrowBeforeSale = ledger
    .getAllPlayers()
    .reduce((acc, p) => acc + p.escrow_balance_toks, 0);
  expect(totalEscrowBeforeSale).toBe(50);

  // Lock takes and go live
  market = spreadBook.lockTakesAndGoLive(market, 'lock_takes');
  expect(market.state).toBe('live');

  // 4. At minute 30 (0-0), Cat bids 20 TOKS for Ben's Over lot; Ben sells. Cat now holds 2 Over lots.
  clock.advance(30 * 60 * 1000);
  const { bid } = p2p.postStandingBid(market, 'cat', 'OVER', 20, 'cat_bid_20');
  p2p.acceptStandingBid(market, 'ben', 'OVER', 'ben_accept_20', bid.id);

  // Verify Cat now holds 2 Over lots and Ben holds 0 Over lots
  const positionsAfterSale = spreadBook.getPositions(market.id);
  const catOver = positionsAfterSale.find((p) => p.player_id === 'cat' && p.side === 'OVER');
  const benOver = positionsAfterSale.find((p) => p.player_id === 'ben' && p.side === 'OVER');
  expect(catOver?.lots).toBe(2);
  expect(benOver?.lots).toBe(0);

  return { clock, ledger, auction, spreadBook, p2p, market, initialBalance };
}

describe('Section 2.3 Worked Golden Example (Engine Golden Test)', () => {
  it('reproduces exact zero-sum payoffs when X = 50 (Over wins)', () => {
    const { ledger, spreadBook, market, initialBalance } = createGoldenScenario();

    const result = spreadBook.settleSpreadMarket(market, 50, 'settle_x_50');

    expect(result.netPnlByPlayer['ben']).toBe(10);
    expect(result.netPnlByPlayer['cat']).toBe(20);
    expect(result.netPnlByPlayer['dan']).toBe(-10);
    expect(result.netPnlByPlayer['ana']).toBe(-20);

    const rowSum =
      result.netPnlByPlayer['ben'] +
      result.netPnlByPlayer['cat'] +
      result.netPnlByPlayer['dan'] +
      result.netPnlByPlayer['ana'];
    expect(rowSum).toBe(0);

    // Also verify final wallet balances match initialBalance + netPnl
    expect(ledger.getPlayer('ben').wallet_balance_toks).toBe(initialBalance + 10);
    expect(ledger.getPlayer('cat').wallet_balance_toks).toBe(initialBalance + 20);
    expect(ledger.getPlayer('dan').wallet_balance_toks).toBe(initialBalance - 10);
    expect(ledger.getPlayer('ana').wallet_balance_toks).toBe(initialBalance - 20);

    ledger.assertInvariants();
  });

  it('reproduces exact zero-sum payoffs when X = 39 (Inside range [35, 43])', () => {
    const { ledger, spreadBook, market, initialBalance } = createGoldenScenario();

    const result = spreadBook.settleSpreadMarket(market, 39, 'settle_x_39');

    expect(result.netPnlByPlayer['ben']).toBe(10);
    expect(result.netPnlByPlayer['cat']).toBe(-30);
    expect(result.netPnlByPlayer['dan']).toBe(-10);
    expect(result.netPnlByPlayer['ana']).toBe(30);

    const rowSum =
      result.netPnlByPlayer['ben'] +
      result.netPnlByPlayer['cat'] +
      result.netPnlByPlayer['dan'] +
      result.netPnlByPlayer['ana'];
    expect(rowSum).toBe(0);

    expect(ledger.getPlayer('ben').wallet_balance_toks).toBe(initialBalance + 10);
    expect(ledger.getPlayer('cat').wallet_balance_toks).toBe(initialBalance - 30);
    expect(ledger.getPlayer('dan').wallet_balance_toks).toBe(initialBalance - 10);
    expect(ledger.getPlayer('ana').wallet_balance_toks).toBe(initialBalance + 30);

    ledger.assertInvariants();
  });

  it('enforces the strict boundary rule: X = L (35) and X = H (43) count as inside the range', () => {
    const scenarioAtL = createGoldenScenario();
    const resL = scenarioAtL.spreadBook.settleSpreadMarket(scenarioAtL.market, 35, 'settle_35');
    expect(resL.netPnlByPlayer['ana']).toBe(30);

    const scenarioAtH = createGoldenScenario();
    const resH = scenarioAtH.spreadBook.settleSpreadMarket(scenarioAtH.market, 43, 'settle_43');
    expect(resH.netPnlByPlayer['ana']).toBe(30);
  });

  it('handles MM quote deadline forfeiture (k TOKS ante to next-narrowest bidder) and integer remainder routing', () => {
    const clock = new DeterministicClock();
    const ledger = new ToksLedger(clock);
    for (const id of ['ana', 'ben', 'cat']) {
      ledger.registerPlayer({
        id,
        group_id: 'g1',
        nickname: id,
        is_admin: false,
        wallet_balance_toks: 500,
        escrow_balance_toks: 0,
      });
    }
    const auction = new WidthAuctionEngine(clock, ledger);
    let mkt: Market = {
      id: 'm_timeout',
      group_id: 'g1',
      proposer_id: 'ana',
      archetype: 'spread',
      question: 'Test timeout',
      unit: 'pts',
      bounds: [0, 100],
      no_event_value: 0,
      criteria: 'test',
      resolution_source: 'test',
      payoff_mode: 'pot',
      lot_stake_k: 15,
      cap_widths_c: 3,
      state: 'draft',
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
    };

    mkt = auction.startAuction(mkt);
    mkt = auction.placeWidthBid(mkt, 'ben', 12).market;
    mkt = auction.placeWidthBid(mkt, 'ana', 8).market;
    mkt = auction.finalizeAuction(mkt);
    expect(mkt.mm_player_id).toBe('ana');

    // Ana misses 3-min quote deadline -> forfeits k=15 TOKS to Ben, who becomes MM at w=12
    mkt = auction.handleQuoteTimeout(mkt, 'timeout_1');
    expect(mkt.mm_player_id).toBe('ben');
    expect(mkt.active_width_w).toBe(12);
    expect(ledger.getPlayer('ana').wallet_balance_toks).toBe(485);
    expect(ledger.getPlayer('ben').wallet_balance_toks).toBe(515);

    // Check Linear and Log payoff helpers
    expect(evaluatePerLotPayoff('linear', 'OVER', 53, 35, 43, 10, 3)).toBe(12); // (53-43)/8 * 10 = 12.5 -> 12
    expect(evaluatePerLotPayoff('linear', 'OVER', 100, 35, 43, 10, 3)).toBe(30); // clamped at +3*k = 30
    expect(evaluatePerLotPayoff('log', 'OVER', 80, 20, 40, 10, 3)).toBe(10); // ln(80/40)/ln(40/20) = 1 -> +10
  });
});
