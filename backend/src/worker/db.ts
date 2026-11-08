// ============================================================================
// Cloudflare D1 Persistence & Seeded Edge State Store (SPEC §5.1 & §5.2)
// ============================================================================

import { DeterministicClock } from '../engine/clock';
import { SpreadEngine } from '../engine/state_machine';
import { Group, LiveEvent, Market } from '../shared/types';

export interface Env {
  DB?: D1Database;
  AI?: any;
  ASSETS?: Fetcher;
  GEMINI_API_KEY?: string;
}

export class EdgeStateStore {
  public clock: DeterministicClock;
  public engine: SpreadEngine;
  public group: Group;
  public stateVersion: number = 1;
  public replayIndexByMarket: Map<string, number> = new Map();
  private d1Initialized: boolean = false;
  private seedDemoFixtures: boolean;

  constructor(seedDemoFixtures: boolean = true) {
    this.seedDemoFixtures = seedDemoFixtures;
    this.clock = new DeterministicClock(1762542000000);
    this.engine = new SpreadEngine(this.clock);
    this.group = {
      id: 'grp_citadel',
      name: seedDemoFixtures ? 'CITADEL // NORTH LONDON SYNDICATE' : 'FRIENDS BETTING CLUB',
      invite_code: 'SPREAD-2026',
      created_at: this.clock.now(),
    };
    if (this.seedDemoFixtures) {
      this.seedInitialState();
    } else {
      this.seedCleanFirstPersonState();
    }
  }

  public reset(): void {
    this.clock = new DeterministicClock(1762542000000);
    this.engine = new SpreadEngine(this.clock);
    this.replayIndexByMarket.clear();
    this.stateVersion += 1;
    if (this.seedDemoFixtures) {
      this.seedInitialState();
    } else {
      this.seedCleanFirstPersonState();
    }
  }

  public bumpVersion(): number {
    this.stateVersion += 1;
    return this.stateVersion;
  }

  private seedCleanFirstPersonState(): void {
    this.engine.ledger.registerPlayer({
      id: 'you',
      group_id: this.group.id,
      nickname: 'YOU',
      is_admin: true,
      wallet_balance_toks: 1000,
      escrow_balance_toks: 0,
    });
  }

  private seedInitialState(): void {
    const basePlayers = [
      { id: 'ana', nickname: 'ANA', is_admin: true, wallet: 1000 },
      { id: 'ben', nickname: 'BEN', is_admin: false, wallet: 1000 },
      { id: 'cat', nickname: 'CAT', is_admin: false, wallet: 1000 },
      { id: 'dan', nickname: 'DAN', is_admin: false, wallet: 1000 },
      { id: 'eli', nickname: 'ELI (ARBITER)', is_admin: false, wallet: 1000 },
    ];

    for (const p of basePlayers) {
      this.engine.ledger.registerPlayer({
        id: p.id,
        group_id: this.group.id,
        nickname: p.nickname,
        is_admin: p.is_admin,
        wallet_balance_toks: p.wallet,
        escrow_balance_toks: 0,
      });
    }

    // ========================================================================
    // Market 1: Flagship Spread / MM Market (SPEC §2.3 Golden Example)
    // "When will Arsenal score first?" (0..95 min, k = 10 TOKS, Ana MM @ [35, 43])
    // ========================================================================
    let m1: Market = {
      id: 'mkt_arsenal',
      group_id: this.group.id,
      proposer_id: 'ana',
      archetype: 'spread',
      question: 'When will Arsenal score first vs Chelsea?',
      unit: 'min',
      bounds: [0, 95],
      no_event_value: 95,
      criteria: 'Official Premier League match clock minute of Arsenal 1st goal; 95 if 0-0 / no goal.',
      resolution_source: 'Opta Live Match Feed (Replay Ready)',
      payoff_mode: 'pot',
      lot_stake_k: 10,
      cap_widths_c: 3,
      state: 'draft',
      verifiability: 'public_verifiable',
      route: 'auto',
      live_implied_value: 39,
      live_fair_value_toks: 18,
      fair_value_source: 'POISSON_MODEL',
      feed_status: 'REPLAY',
      toggles: {
        max_lots: 3,
        forced_trading: false,
        hidden_takes: false,
        single_mm_requote: true,
        live_reopen_halftime: true,
      },
      version: 1,
      created_at: this.clock.now(),
    };

    m1 = this.engine.auction.startAuction(m1);
    m1 = this.engine.auction.placeWidthBid(m1, 'dan', 20).market;
    this.clock.advance(2000);
    m1 = this.engine.auction.placeWidthBid(m1, 'cat', 15).market;
    this.clock.advance(2000);
    m1 = this.engine.auction.placeWidthBid(m1, 'ben', 10).market;
    this.clock.advance(2000);
    m1 = this.engine.auction.placeWidthBid(m1, 'ana', 8).market;
    this.clock.advance(30000);
    m1 = this.engine.auction.finalizeAuction(m1);
    m1 = this.engine.auction.submitQuote(m1, 'ana', 35); // [35, 43]
    this.engine.createMarket(m1);

    // Takers enter: Ben (1 Over), Cat (1 Over), Dan (1 Under)
    this.engine.executeOneTapTake('mkt_arsenal', 'ben', 'OVER', 1, 'seed_m1_ben');
    this.engine.executeOneTapTake('mkt_arsenal', 'cat', 'OVER', 1, 'seed_m1_cat');
    this.engine.executeOneTapTake('mkt_arsenal', 'dan', 'UNDER', 1, 'seed_m1_dan');

    const lockedM1 = this.engine.spreadBook.lockTakesAndGoLive(
      this.engine.getMarket('mkt_arsenal'),
      'seed_m1_lock'
    );
    this.engine.createMarket(lockedM1);

    // Post standing P2P bid from Cat for 20 TOKS on 1 OVER lot (ready for 1-tap Cash Out or P2P match!)
    this.engine.p2p.postStandingBid(
      this.engine.getMarket('mkt_arsenal'),
      'cat',
      'OVER',
      20,
      'seed_cat_standing_bid_20'
    );
    this.engine.recordSwimlane('mkt_arsenal', 'cat', 'MID', 'L', 'Standing Bid 20 TOKS (1x OVER)', -20);
    this.engine.emitWireTrace(
      'mkt_arsenal',
      'PLAYER',
      'MARKET_ENGINE',
      'P2P_STANDING_BID',
      'CAT posted balance-backed standing bid: 20 TOKS for 1 OVER lot',
      -20
    );

    // ========================================================================
    // Market 2: Simple Continuous Pool Market with Public Swing Map Orders
    // "Will tomorrow's London peak temp hit 24°C?"
    // ========================================================================
    const m2: Market = {
      id: 'mkt_weather',
      group_id: this.group.id,
      proposer_id: 'ben',
      archetype: 'simple',
      question: "Will tomorrow's London peak temp hit 24°C?",
      unit: '°C',
      bounds: [0, 100],
      no_event_value: 0,
      criteria: 'Met Office St James Park daily maximum >= 24.0°C.',
      resolution_source: 'Met Office Feed',
      payoff_mode: 'pot',
      lot_stake_k: 50,
      cap_widths_c: 3,
      state: 'live',
      verifiability: 'public_verifiable',
      route: 'auto',
      live_implied_value: 54,
      live_fair_value_toks: 54,
      fair_value_source: 'POOL_IMPLIED',
      feed_status: 'LIVE',
      toggles: {
        max_lots: 5,
        forced_trading: false,
        hidden_takes: false,
        single_mm_requote: false,
        live_reopen_halftime: false,
      },
      version: 1,
      created_at: this.clock.now(),
    };
    this.engine.createMarket(m2);

    this.engine.executeOneTapTake('mkt_weather', 'ana', 'YES', 150, 'seed_m2_ana');
    this.engine.executeOneTapTake('mkt_weather', 'ben', 'YES', 100, 'seed_m2_ben');
    this.engine.executeOneTapTake('mkt_weather', 'cat', 'NO', 120, 'seed_m2_cat');
    this.engine.executeOneTapTake('mkt_weather', 'dan', 'NO', 100, 'seed_m2_dan');

    // Add confirmed StrategyMandate + Public Limit/Stop orders on the Swing Map
    this.engine.activateConversationalStrategy(
      'mkt_weather',
      {
        id: 'mandate_ana_weather',
        market_id: 'mkt_weather',
        player_id: 'ana',
        input_modality: 'voice',
        raw_transcript:
          'Put 100 TOKS on YES, take profit if odds hit 72%, cut me at 44% stop floor',
        parsed_strategy_summary: 'LONG YES 100 TOKS | TP @ 72% | HARD STOP @ 44%',
        side: 'YES',
        stake_toks: 100,
        entry_trigger_level: null,
        take_profit_level: 72,
        min_balance_floor: 44,
        confirmed_at: this.clock.now(),
        created_at: this.clock.now(),
      },
      'seed_m2_mandate_ana'
    );

    const m2Current = this.engine.getMarket('mkt_weather');
    this.engine.poolBook.placeOrder(
      m2Current,
      'ben',
      'YES',
      'stop_loss',
      48,
      80,
      'seed_m2_ben_stop'
    );
    this.engine.recordSwimlane('mkt_weather', 'ben', 'MID', 'L', 'Stop-Loss @ 48% (80 TOKS)');

    this.engine.poolBook.placeOrder(
      m2Current,
      'dan',
      'YES',
      'limit_buy',
      46,
      60,
      'seed_m2_dan_limbuy'
    );
    this.engine.recordSwimlane('mkt_weather', 'dan', 'MID', 'L', 'Limit Buy YES @ 46% (60 TOKS)', -60);

    // ========================================================================
    // Market 3: Stacked (Meta / Derivative) Market referencing Market 1
    // "Will Ana finish the Arsenal Spread Market with positive P&L?"
    // ========================================================================
    const m3: Market = {
      id: 'mkt_stacked_ana',
      group_id: this.group.id,
      proposer_id: 'cat',
      archetype: 'stacked',
      question: 'STACKED // Will ANA finish Arsenal Market M1 with positive P&L?',
      unit: 'TOKS P&L',
      bounds: [0, 100],
      no_event_value: 0,
      criteria: 'Settles YES (100) if ANA net P&L on mkt_arsenal > 0 TOKS at settlement.',
      resolution_source: 'Parent Market mkt_arsenal Ledger',
      payoff_mode: 'pot',
      lot_stake_k: 40,
      cap_widths_c: 3,
      state: 'live',
      verifiability: 'public_verifiable',
      route: 'auto',
      parent_market_id: 'mkt_arsenal',
      parent_metric: 'player_pnl',
      parent_target_player_id: 'ana',
      parent_trigger_target: 0,
      live_implied_value: 52,
      live_fair_value_toks: 52,
      fair_value_source: 'POOL_IMPLIED',
      feed_status: 'LIVE',
      toggles: {
        max_lots: 3,
        forced_trading: false,
        hidden_takes: false,
        single_mm_requote: false,
        live_reopen_halftime: false,
      },
      version: 1,
      created_at: this.clock.now(),
    };
    this.engine.createMarket(m3);
    this.engine.executeOneTapTake('mkt_stacked_ana', 'cat', 'YES', 80, 'seed_m3_cat');
    this.engine.executeOneTapTake('mkt_stacked_ana', 'dan', 'NO', 80, 'seed_m3_dan');

    // ========================================================================
    // Market 4: Custom Unverifiable Market with 3rd-Party Arbiter & Countdown
    // ========================================================================
    const m4: Market = {
      id: 'mkt_arbiter_kpi',
      group_id: this.group.id,
      proposer_id: 'dan',
      archetype: 'simple',
      question: 'ARBITER // Will Team Atlas ship v2.4 before Friday 18:00?',
      unit: 'binary',
      bounds: [0, 100],
      no_event_value: 0,
      criteria: 'Verified by designated 3rd-party arbiter ELI after countdown lock.',
      resolution_source: '3rd-Party Arbiter (ELI)',
      payoff_mode: 'pot',
      lot_stake_k: 50,
      cap_widths_c: 3,
      state: 'live',
      verifiability: 'custom_unverifiable',
      route: 'arbiter',
      arbiter_id: 'eli',
      countdown_ends_at: this.clock.now() + 15 * 60 * 1000, // 15m countdown
      live_implied_value: 50,
      live_fair_value_toks: 50,
      fair_value_source: 'AI_ADVISORY',
      feed_status: 'LIVE',
      toggles: {
        max_lots: 3,
        forced_trading: false,
        hidden_takes: false,
        single_mm_requote: false,
        live_reopen_halftime: false,
      },
      version: 1,
      created_at: this.clock.now(),
    };
    this.engine.createMarket(m4);
    this.engine.executeOneTapTake('mkt_arbiter_kpi', 'ana', 'YES', 100, 'seed_m4_ana');
    this.engine.executeOneTapTake('mkt_arbiter_kpi', 'ben', 'NO', 100, 'seed_m4_ben');
  }

  /**
   * Synchronizes the current deterministic state snapshot to Cloudflare D1 (`env.DB`)
   * using atomic `env.DB.batch([...])` when a D1 binding is available.
   */
  public async persistToD1(env?: Env): Promise<void> {
    if (!env?.DB) return;
    try {
      if (!this.d1Initialized) {
        await env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS engine_snapshots (
            id TEXT PRIMARY KEY,
            version INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )`
        ).run();
        this.d1Initialized = true;
      }

      const snapshotPayload = JSON.stringify({
        group: this.group,
        players: this.engine.ledger.getAllPlayers(),
        markets: this.engine.getAllMarkets(),
        stateVersion: this.stateVersion,
      });

      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO engine_snapshots (id, version, payload_json, updated_at)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(id) DO UPDATE SET
             version = excluded.version,
             payload_json = excluded.payload_json,
             updated_at = excluded.updated_at`
        ).bind('singleton', this.stateVersion, snapshotPayload, this.clock.now()),
      ]);
    } catch {
      // Non-fatal in local preview if D1 migrations haven't been run yet
    }
  }

  public getFullMarketBundle(marketId: string) {
    const market = this.engine.getMarket(marketId);
    const positions = this.engine.getMarketPositions(marketId);
    const orders = this.engine.getMarketOrders(marketId);
    const p2pBids = this.engine.getStandingP2PBids(marketId);
    const widthBids = this.engine.auction.getBids(marketId);
    const swimlanes = this.engine.getSwimlanes(marketId);
    const wireTrace = this.engine.getWireTrace(marketId);
    const swingTree = this.engine.getSwingTree(marketId);
    const swingRiskLabel = this.engine.getSwingRiskLabel(marketId);
    const proposal = this.engine.resolution.getProposal(marketId);
    const mandates = this.engine.getMandates(marketId);
    const liveEvents = this.engine.getLiveEvents(marketId);
    const mmEscrowToks = this.engine.spreadBook.getMmEscrow(marketId);

    return {
      market,
      positions,
      orders,
      p2pBids,
      widthBids,
      swimlanes,
      wireTrace,
      swingTree,
      swingRiskLabel,
      proposal,
      mandates,
      liveEvents,
      mmEscrowToks,
    };
  }
}

export const globalStore = new EdgeStateStore(false);
