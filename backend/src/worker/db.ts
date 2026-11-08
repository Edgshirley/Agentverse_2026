// ============================================================================
// Cloudflare D1 / Local SQLite Persistence & Seeded Edge State Store (SPEC §5.1 & §5.2)
// ============================================================================

import { DeterministicClock } from '../engine/clock';
import { SpreadEngine } from '../engine/state_machine';
import { ChatMessage, Group, Market } from '../shared/types';

export interface Env {
  DB?: D1Database;
  AI?: any;
  ASSETS?: Fetcher;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  DEV_TOOLS?: string;
}

export interface StateUpdateNotification {
  type: 'STATE_UPDATED' | 'DEMO_RESET';
  marketId?: string;
  stateVersion: number;
  serverClockMs: number;
}

export type StateChangeListener = (event: StateUpdateNotification) => void;

const INITIAL_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    wallet_balance_toks INTEGER NOT NULL DEFAULT 1000,
    escrow_balance_toks INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS markets (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    proposer_id TEXT NOT NULL,
    archetype TEXT NOT NULL,
    question TEXT NOT NULL,
    unit TEXT NOT NULL,
    bounds_json TEXT NOT NULL,
    no_event_value REAL NOT NULL,
    criteria TEXT NOT NULL,
    resolution_source TEXT NOT NULL,
    payoff_mode TEXT NOT NULL,
    lot_stake_k INTEGER NOT NULL,
    cap_widths_c INTEGER NOT NULL DEFAULT 3,
    state TEXT NOT NULL,
    verifiability TEXT NOT NULL,
    route TEXT NOT NULL,
    arbiter_id TEXT,
    countdown_ends_at INTEGER,
    parent_market_id TEXT,
    parent_metric TEXT,
    parent_trigger_target REAL,
    parent_target_player_id TEXT,
    parent_trigger_crossed INTEGER DEFAULT 0,
    mm_player_id TEXT,
    active_width_w REAL,
    L REAL,
    H REAL,
    live_implied_value REAL NOT NULL,
    live_fair_value_toks INTEGER,
    fair_value_source TEXT,
    feed_status TEXT DEFAULT 'LIVE',
    outcome_x REAL,
    toggles_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agent_classification_logs (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL,
    agent1_parsed_payload TEXT NOT NULL,
    agent2_archetype TEXT NOT NULL,
    agent2_verifiability TEXT NOT NULL,
    agent2_route TEXT NOT NULL,
    confidence REAL NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS width_bids (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    width REAL NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    side TEXT NOT NULL,
    lots INTEGER NOT NULL,
    staked_toks INTEGER NOT NULL,
    entry_cost_toks INTEGER NOT NULL,
    realized_pnl_toks INTEGER NOT NULL DEFAULT 0,
    current_shares REAL NOT NULL,
    live_equity_toks INTEGER NOT NULL,
    withdrawn_toks INTEGER NOT NULL DEFAULT 0,
    is_hidden INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS position_bids (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL,
    position_id TEXT,
    side TEXT NOT NULL,
    buyer_id TEXT NOT NULL,
    seller_id TEXT,
    price_toks INTEGER NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    escrowed_toks INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    side TEXT NOT NULL,
    type TEXT NOT NULL,
    trigger_level REAL NOT NULL,
    size_toks INTEGER NOT NULL,
    escrowed_toks INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    visible_to_group INTEGER NOT NULL DEFAULT 1,
    mandate_id TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS strategy_mandates (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    input_modality TEXT NOT NULL,
    raw_transcript TEXT NOT NULL,
    parsed_strategy_summary TEXT NOT NULL,
    side TEXT NOT NULL,
    stake_toks INTEGER NOT NULL,
    entry_trigger_level REAL,
    take_profit_level REAL NOT NULL,
    min_balance_floor REAL NOT NULL,
    confirmed_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS outcome_proposals (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL,
    proposer_id TEXT NOT NULL,
    proposed_x REAL NOT NULL,
    source_url TEXT NOT NULL,
    challenge_deadline INTEGER NOT NULL,
    status TEXT NOT NULL,
    votes_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS live_events (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    minute INTEGER NOT NULL,
    score_home INTEGER,
    score_away INTEGER,
    description TEXT NOT NULL,
    implied_value_after REAL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    account TEXT NOT NULL,
    delta_toks INTEGER NOT NULL,
    tx_type TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    note TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS engine_snapshots (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
];

export const MAX_CHAT_MESSAGES = 200;

export class EdgeStateStore {
  public clock: DeterministicClock;
  public engine: SpreadEngine;
  public group: Group;
  public stateVersion: number = 1;
  public replayIndexByMarket: Map<string, number> = new Map();
  public chatMessages: ChatMessage[] = [];
  private d1Initialized: boolean = false;
  private defaultDb?: D1Database;
  private listeners: Set<StateChangeListener> = new Set();
  private seedDemoFixtures: boolean;

  constructor(defaultDb?: D1Database, seedDemoFixtures: boolean = true) {
    this.defaultDb = defaultDb;
    this.seedDemoFixtures = seedDemoFixtures;
    this.clock = new DeterministicClock(1762542000000);
    this.engine = new SpreadEngine(this.clock);
    this.group = {
      id: 'grp_main',
      name: seedDemoFixtures ? 'NORTH LONDON SYNDICATE' : 'FRIENDS BETTING CLUB',
      invite_code: 'MARKETMATE-2026',
      created_at: this.clock.now(),
    };
    if (this.seedDemoFixtures) {
      this.seedInitialState();
    } else {
      this.seedCleanFirstPersonState();
    }
  }

  /** Toggle whether reset() seeds the demo syndicate fixtures or a clean single-player start. */
  public setSeedDemoFixtures(enabled: boolean): void {
    this.seedDemoFixtures = enabled;
  }

  public attachDatabase(db: D1Database): void {
    this.defaultDb = db;
    this.d1Initialized = false;
  }

  public getDatabase(env?: Env): D1Database | undefined {
    return env?.DB ?? this.defaultDb;
  }

  public subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public notifyListeners(
    type: StateUpdateNotification['type'] = 'STATE_UPDATED',
    marketId?: string
  ): void {
    const payload: StateUpdateNotification = {
      type,
      marketId,
      stateVersion: this.stateVersion,
      serverClockMs: this.clock.now(),
    };
    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch {
        // Ignore individual listener errors
      }
    }
  }

  public reset(): void {
    this.clock = new DeterministicClock(1762542000000);
    this.engine = new SpreadEngine(this.clock);
    this.replayIndexByMarket.clear();
    this.chatMessages = [];
    this.stateVersion += 1;
    this.group = {
      ...this.group,
      name: this.seedDemoFixtures ? 'NORTH LONDON SYNDICATE' : 'FRIENDS BETTING CLUB',
    };
    if (this.seedDemoFixtures) {
      this.seedInitialState();
    } else {
      this.seedCleanFirstPersonState();
    }
    this.notifyListeners('DEMO_RESET');
  }

  public addChatMessage(playerId: string, text: string): ChatMessage {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      player_id: playerId,
      text,
      created_at: Date.now(),
    };
    this.chatMessages = [...this.chatMessages, message].slice(-MAX_CHAT_MESSAGES);
    return message;
  }

  public bumpVersion(marketId?: string): number {
    this.stateVersion += 1;
    this.notifyListeners('STATE_UPDATED', marketId);
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
    // "When will Arsenal score first?" (0..95 min, k = 10 CHIP, Ana MM @ [35, 43])
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

    // Post standing P2P bid from Cat for 20 CHIP on 1 OVER lot (ready for 1-tap Cash Out or P2P match!)
    this.engine.p2p.postStandingBid(
      this.engine.getMarket('mkt_arsenal'),
      'cat',
      'OVER',
      20,
      'seed_cat_standing_bid_20'
    );
    this.engine.recordSwimlane('mkt_arsenal', 'cat', 'MID', 'L', 'Standing Bid 20 CHIP (1x OVER)', -20);
    this.engine.emitWireTrace(
      'mkt_arsenal',
      'PLAYER',
      'MARKET_ENGINE',
      'P2P_STANDING_BID',
      'CAT posted balance-backed standing bid: 20 CHIP for 1 OVER lot',
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
          'Put 100 CHIP on YES, take profit if odds hit 72%, cut me at 44% stop floor',
        parsed_strategy_summary: 'LONG YES 100 CHIP | TP @ 72% | HARD STOP @ 44%',
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
    this.engine.recordSwimlane('mkt_weather', 'ben', 'MID', 'L', 'Stop-Loss @ 48% (80 CHIP)');

    this.engine.poolBook.placeOrder(
      m2Current,
      'dan',
      'YES',
      'limit_buy',
      46,
      60,
      'seed_m2_dan_limbuy'
    );
    this.engine.recordSwimlane('mkt_weather', 'dan', 'MID', 'L', 'Limit Buy YES @ 46% (60 CHIP)', -60);

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
      unit: 'CHIP P&L',
      bounds: [0, 100],
      no_event_value: 0,
      criteria: 'Settles YES (100) if ANA net P&L on mkt_arsenal > 0 CHIP at settlement.',
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

  private async ensureSchemaInitialized(db: D1Database): Promise<void> {
    if (this.d1Initialized) return;
    await db.batch(INITIAL_SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
    this.d1Initialized = true;
  }

  /**
   * Synchronizes the full relational data model (`migrations/0001_initial_schema.sql`)
   * AND the deterministic engine snapshot to SQLite / Cloudflare D1 (`env.DB`)
   * inside an atomic `db.batch([...])` transaction.
   */
  public async persistToD1(env?: Env): Promise<void> {
    const db = this.getDatabase(env);
    if (!db) return;
    try {
      await this.ensureSchemaInitialized(db);

      const statements: any[] = [];

      // 1. Groups
      statements.push(
        db
          .prepare(
            `INSERT INTO groups (id, name, invite_code, created_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               invite_code = excluded.invite_code`
          )
          .bind(this.group.id, this.group.name, this.group.invite_code, this.group.created_at)
      );

      // 2. Players
      for (const p of this.engine.ledger.getAllPlayers()) {
        statements.push(
          db
            .prepare(
              `INSERT INTO players (id, group_id, nickname, is_admin, wallet_balance_toks, escrow_balance_toks)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6)
               ON CONFLICT(id) DO UPDATE SET
                 nickname = excluded.nickname,
                 is_admin = excluded.is_admin,
                 wallet_balance_toks = excluded.wallet_balance_toks,
                 escrow_balance_toks = excluded.escrow_balance_toks`
            )
            .bind(
              p.id,
              p.group_id,
              p.nickname,
              p.is_admin ? 1 : 0,
              p.wallet_balance_toks,
              p.escrow_balance_toks
            )
        );
      }

      // 3. Markets & per-market child entities
      const allMarkets = this.engine.getAllMarkets();
      for (const m of allMarkets) {
        statements.push(
          db
            .prepare(
              `INSERT INTO markets (
                 id, group_id, proposer_id, archetype, question, unit, bounds_json,
                 no_event_value, criteria, resolution_source, payoff_mode, lot_stake_k,
                 cap_widths_c, state, verifiability, route, arbiter_id, countdown_ends_at,
                 parent_market_id, parent_metric, parent_trigger_target, parent_target_player_id,
                 parent_trigger_crossed, mm_player_id, active_width_w, L, H,
                 live_implied_value, live_fair_value_toks, fair_value_source, feed_status,
                 outcome_x, toggles_json, version, created_at
               ) VALUES (
                 ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                 ?8, ?9, ?10, ?11, ?12,
                 ?13, ?14, ?15, ?16, ?17, ?18,
                 ?19, ?20, ?21, ?22,
                 ?23, ?24, ?25, ?26, ?27,
                 ?28, ?29, ?30, ?31,
                 ?32, ?33, ?34, ?35
               )
               ON CONFLICT(id) DO UPDATE SET
                 state = excluded.state,
                 arbiter_id = excluded.arbiter_id,
                 countdown_ends_at = excluded.countdown_ends_at,
                 parent_trigger_crossed = excluded.parent_trigger_crossed,
                 mm_player_id = excluded.mm_player_id,
                 active_width_w = excluded.active_width_w,
                 L = excluded.L,
                 H = excluded.H,
                 live_implied_value = excluded.live_implied_value,
                 live_fair_value_toks = excluded.live_fair_value_toks,
                 fair_value_source = excluded.fair_value_source,
                 feed_status = excluded.feed_status,
                 outcome_x = excluded.outcome_x,
                 toggles_json = excluded.toggles_json,
                 version = excluded.version`
            )
            .bind(
              m.id,
              m.group_id,
              m.proposer_id,
              m.archetype,
              m.question,
              m.unit,
              JSON.stringify(m.bounds),
              m.no_event_value,
              m.criteria,
              m.resolution_source,
              m.payoff_mode,
              m.lot_stake_k,
              m.cap_widths_c,
              m.state,
              m.verifiability,
              m.route,
              m.arbiter_id ?? null,
              m.countdown_ends_at ?? null,
              m.parent_market_id ?? null,
              m.parent_metric ?? null,
              m.parent_trigger_target ?? null,
              m.parent_target_player_id ?? null,
              m.parent_trigger_crossed ? 1 : 0,
              m.mm_player_id ?? null,
              m.active_width_w ?? null,
              m.L ?? null,
              m.H ?? null,
              m.live_implied_value,
              m.live_fair_value_toks ?? null,
              m.fair_value_source ?? null,
              m.feed_status ?? 'LIVE',
              m.outcome_x ?? null,
              JSON.stringify(m.toggles),
              m.version,
              m.created_at
            )
        );

        // 4. Width Bids
        for (const wb of this.engine.auction.getBids(m.id)) {
          statements.push(
            db
              .prepare(
                `INSERT INTO width_bids (id, market_id, player_id, width, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO NOTHING`
              )
              .bind(wb.id, wb.market_id, wb.player_id, wb.width, wb.created_at)
          );
        }

        // 5. Positions
        for (const pos of this.engine.getMarketPositions(m.id)) {
          statements.push(
            db
              .prepare(
                `INSERT INTO positions (
                   id, market_id, player_id, side, lots, staked_toks, entry_cost_toks,
                   realized_pnl_toks, current_shares, live_equity_toks, withdrawn_toks,
                   is_hidden, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                 ON CONFLICT(id) DO UPDATE SET
                   lots = excluded.lots,
                   staked_toks = excluded.staked_toks,
                   entry_cost_toks = excluded.entry_cost_toks,
                   realized_pnl_toks = excluded.realized_pnl_toks,
                   current_shares = excluded.current_shares,
                   live_equity_toks = excluded.live_equity_toks,
                   withdrawn_toks = excluded.withdrawn_toks,
                   is_hidden = excluded.is_hidden,
                   updated_at = excluded.updated_at`
              )
              .bind(
                pos.id,
                pos.market_id,
                pos.player_id,
                pos.side,
                pos.lots,
                pos.staked_toks,
                pos.entry_cost_toks,
                pos.realized_pnl_toks,
                pos.current_shares,
                pos.live_equity_toks,
                pos.withdrawn_toks,
                pos.is_hidden ? 1 : 0,
                pos.updated_at
              )
          );
        }

        // 6. Position Bids (P2P Standing Bids, Asks, Auto-Sells)
        for (const pb of this.engine.getStandingP2PBids(m.id)) {
          statements.push(
            db
              .prepare(
                `INSERT INTO position_bids (
                   id, market_id, position_id, side, buyer_id, seller_id,
                   price_toks, kind, status, escrowed_toks, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(id) DO UPDATE SET
                   buyer_id = excluded.buyer_id,
                   seller_id = excluded.seller_id,
                   status = excluded.status,
                   escrowed_toks = excluded.escrowed_toks`
              )
              .bind(
                pb.id,
                pb.market_id,
                pb.position_id ?? null,
                pb.side,
                pb.buyer_id,
                pb.seller_id ?? null,
                pb.price_toks,
                pb.kind,
                pb.status,
                pb.escrowed_toks,
                pb.created_at
              )
          );
        }

        // 7. Public Swing Map Orders
        for (const ord of this.engine.getMarketOrders(m.id)) {
          statements.push(
            db
              .prepare(
                `INSERT INTO orders (
                   id, market_id, player_id, side, type, trigger_level,
                   size_toks, escrowed_toks, status, visible_to_group, mandate_id, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(id) DO UPDATE SET
                   escrowed_toks = excluded.escrowed_toks,
                   status = excluded.status`
              )
              .bind(
                ord.id,
                ord.market_id,
                ord.player_id,
                ord.side,
                ord.type,
                ord.trigger_level,
                ord.size_toks,
                ord.escrowed_toks,
                ord.status,
                ord.visible_to_group ? 1 : 0,
                ord.mandate_id ?? null,
                ord.created_at
              )
          );
        }

        // 8. Strategy Mandates
        for (const sm of this.engine.getMandates(m.id)) {
          statements.push(
            db
              .prepare(
                `INSERT INTO strategy_mandates (
                   id, market_id, player_id, input_modality, raw_transcript,
                   parsed_strategy_summary, side, stake_toks, entry_trigger_level,
                   take_profit_level, min_balance_floor, confirmed_at, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                 ON CONFLICT(id) DO UPDATE SET
                   confirmed_at = excluded.confirmed_at`
              )
              .bind(
                sm.id,
                sm.market_id,
                sm.player_id,
                sm.input_modality,
                sm.raw_transcript,
                sm.parsed_strategy_summary,
                sm.side,
                sm.stake_toks,
                sm.entry_trigger_level ?? null,
                sm.take_profit_level ?? 0,
                sm.min_balance_floor ?? 0,
                sm.confirmed_at ?? null,
                sm.created_at
              )
          );
        }

        // 9. Outcome Proposals
        const prop = this.engine.resolution.getProposal(m.id);
        if (prop) {
          statements.push(
            db
              .prepare(
                `INSERT INTO outcome_proposals (
                   id, market_id, proposer_id, proposed_x, source_url,
                   challenge_deadline, status, votes_json, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                   status = excluded.status,
                   votes_json = excluded.votes_json`
              )
              .bind(
                prop.id,
                prop.market_id,
                prop.proposer_id,
                prop.proposed_x,
                prop.source_url,
                prop.challenge_deadline,
                prop.status,
                JSON.stringify(prop.votes),
                prop.created_at
              )
          );
        }

        // 10. Live Events
        for (const evt of this.engine.getLiveEvents(m.id)) {
          statements.push(
            db
              .prepare(
                `INSERT INTO live_events (
                   id, market_id, event_type, minute, score_home, score_away,
                   description, implied_value_after, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO NOTHING`
              )
              .bind(
                evt.id,
                evt.market_id,
                evt.event_type,
                evt.minute,
                evt.score_home ?? null,
                evt.score_away ?? null,
                evt.description,
                evt.implied_value_after ?? null,
                evt.created_at
              )
          );
        }
      }

      // 11. Agent Classification Logs
      for (const clog of this.engine.getClassificationLogs()) {
        statements.push(
          db
            .prepare(
              `INSERT INTO agent_classification_logs (
                 id, market_id, agent1_parsed_payload, agent2_archetype,
                 agent2_verifiability, agent2_route, confidence, created_at
               ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
               ON CONFLICT(id) DO NOTHING`
            )
            .bind(
              clog.id,
              clog.market_id,
              JSON.stringify(clog.agent1_parsed_payload),
              clog.agent2_archetype,
              clog.agent2_verifiability,
              clog.agent2_route,
              clog.confidence,
              clog.created_at
            )
        );
      }

      // 12. Ledger Entries
      for (const le of this.engine.ledger.getEntries()) {
        statements.push(
          db
            .prepare(
              `INSERT INTO ledger_entries (
                 id, player_id, market_id, account, delta_toks,
                 tx_type, idempotency_key, note, created_at
               ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
               ON CONFLICT(id) DO NOTHING`
            )
            .bind(
              le.id,
              le.player_id,
              le.market_id,
              le.account,
              le.delta_toks,
              le.tx_type,
              le.idempotency_key,
              le.note,
              le.created_at
            )
        );
      }

      // 13. Full Deterministic Engine Snapshot
      const replayIndices: Record<string, number> = {};
      for (const [k, v] of this.replayIndexByMarket.entries()) {
        replayIndices[k] = v;
      }

      const snapshotPayload = JSON.stringify({
        group: this.group,
        stateVersion: this.stateVersion,
        replayIndices,
        chatMessages: this.chatMessages,
        engineSnapshot: this.engine.exportSnapshot(),
      });

      statements.push(
        db
          .prepare(
            `INSERT INTO engine_snapshots (id, version, payload_json, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET
               version = excluded.version,
               payload_json = excluded.payload_json,
               updated_at = excluded.updated_at`
          )
          .bind('singleton', this.stateVersion, snapshotPayload, this.clock.now())
      );

      await db.batch(statements);
    } catch {
      // Non-fatal in environments without D1 binding
    }
  }

  /**
   * Restores state from SQLite / Cloudflare D1 (`engine_snapshots`) if available;
   * otherwise persists the freshly seeded state into the database.
   */
  public async hydrateFromD1(env?: Env): Promise<boolean> {
    const db = this.getDatabase(env);
    if (!db) return false;
    try {
      await this.ensureSchemaInitialized(db);
      const row = await db
        .prepare(`SELECT version, payload_json FROM engine_snapshots WHERE id = ?1`)
        .bind('singleton')
        .first<{ version: number; payload_json: string }>();

      if (row && row.payload_json) {
        const parsed = JSON.parse(row.payload_json);
        if (parsed.engineSnapshot) {
          this.group = parsed.group ?? this.group;
          this.stateVersion = parsed.stateVersion ?? row.version ?? 1;
          if (typeof parsed.engineSnapshot.clockNow === 'number') {
            this.clock.set(parsed.engineSnapshot.clockNow);
          }
          this.replayIndexByMarket.clear();
          for (const [k, v] of Object.entries(parsed.replayIndices ?? {})) {
            this.replayIndexByMarket.set(k, Number(v));
          }
          this.chatMessages = parsed.chatMessages ?? [];
          this.engine.importSnapshot(parsed.engineSnapshot);
          return true;
        }
      }

      // No snapshot yet -> persist initial seeded state
      await this.persistToD1(env);
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Clears and re-seeds all relational tables in SQLite / D1 on demo reset.
   */
  public async resetAndPersist(env?: Env): Promise<void> {
    this.reset();
    const db = this.getDatabase(env);
    if (!db) return;
    try {
      await this.ensureSchemaInitialized(db);
      const tables = [
        'agent_classification_logs',
        'width_bids',
        'positions',
        'position_bids',
        'orders',
        'strategy_mandates',
        'outcome_proposals',
        'live_events',
        'ledger_entries',
        'markets',
        'players',
        'groups',
        'engine_snapshots',
      ];
      await db.batch(tables.map((t) => db.prepare(`DELETE FROM ${t}`)));
      await this.persistToD1(env);
    } catch {
      // Ignore if DB not bound
    }
  }

  /**
   * Queries the relational SQLite / D1 tables directly for diagnostics & verification.
   */
  public async inspectDatabase(env?: Env): Promise<{
    connected: boolean;
    tableCounts: Record<string, number>;
    samplePlayers: any[];
    sampleMarkets: any[];
  }> {
    const db = this.getDatabase(env);
    if (!db) {
      return {
        connected: false,
        tableCounts: {},
        samplePlayers: [],
        sampleMarkets: [],
      };
    }

    await this.ensureSchemaInitialized(db);
    const tables = [
      'groups',
      'players',
      'markets',
      'agent_classification_logs',
      'width_bids',
      'positions',
      'position_bids',
      'orders',
      'strategy_mandates',
      'outcome_proposals',
      'live_events',
      'ledger_entries',
      'engine_snapshots',
    ];

    const tableCounts: Record<string, number> = {};
    for (const t of tables) {
      const res = await db.prepare(`SELECT COUNT(*) AS cnt FROM ${t}`).first<{ cnt: number }>();
      tableCounts[t] = Number(res?.cnt ?? 0);
    }

    const playersRes = await db
      .prepare(`SELECT id, nickname, wallet_balance_toks, escrow_balance_toks FROM players ORDER BY id`)
      .all();
    const marketsRes = await db
      .prepare(`SELECT id, archetype, state, question, live_implied_value, version FROM markets ORDER BY created_at`)
      .all();

    return {
      connected: true,
      tableCounts,
      samplePlayers: playersRes.results ?? [],
      sampleMarkets: marketsRes.results ?? [],
    };
  }

  public getTerminalStatePayload(requestedMarketId?: string) {
    const markets = this.engine.getAllMarkets();
    const activeMarketId =
      requestedMarketId && markets.some((m) => m.id === requestedMarketId)
        ? requestedMarketId
        : markets[0]?.id;

    const activeBundle = activeMarketId
      ? this.getFullMarketBundle(activeMarketId)
      : null;

    return {
      stateVersion: this.stateVersion,
      serverClockMs: this.clock.now(),
      group: this.group,
      players: this.engine.ledger.getAllPlayers(),
      markets,
      activeBundle,
      chatMessages: this.chatMessages,
      ledgerEntries: activeMarketId
        ? this.engine.ledger.getEntries(activeMarketId)
        : [],
    };
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

export const globalStore = new EdgeStateStore(undefined, false);
