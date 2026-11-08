// ============================================================================
// MarketMate — Unified Data Model & AI Tool Contract Types
// ============================================================================

export type MarketArchetype = 'simple' | 'spread' | 'stacked' | 'ranking';
export type PayoffMode = 'pot' | 'binary' | 'linear' | 'log';
export type Verifiability = 'public_verifiable' | 'custom_unverifiable' | 'social_group';
export type ResolutionRoute = 'auto' | 'arbiter' | 'group';

export type MarketState =
  | 'draft'
  | 'width_auction'
  | 'quoting'
  | 'open'
  | 'live'
  | 'countdown_locked'
  | 'outcome_proposed'
  | 'settled'
  | 'void';

export type PositionSide = 'OVER' | 'UNDER' | 'YES' | 'NO' | 'MM' | string;

export type OrderType = 'limit_buy' | 'limit_sell' | 'stop_loss' | 'take_profit';
export type OrderStatus = 'open' | 'filled' | 'cancelled';

export type ParentMetric = 'outcome' | 'odds' | 'player_pnl' | 'volume';

export type SwimlaneNodeCode = 'B' | 'L' | 'F' | 'W' | 'S' | 'X';
export type LifecyclePhase = 'OPEN' | 'MID' | 'LIVE' | 'SETTLE';

export interface Group {
  id: string;
  name: string;
  invite_code: string;
  created_at: number;
}

export interface Player {
  id: string;
  group_id: string;
  nickname: string;
  is_admin: boolean;
  wallet_balance_toks: number; // Strictly integer CHIP
  escrow_balance_toks: number; // Strictly integer CHIP locked in active markets
}

export interface MarketToggles {
  max_lots: number; // 1..5 (default 3)
  forced_trading: boolean;
  hidden_takes: boolean; // default true
  single_mm_requote: boolean;
  live_reopen_halftime: boolean;
  public_positions_and_stops?: boolean; // Creator-only option: show everyone's positions & stops graph to all market participants
}

export interface Market {
  id: string;
  group_id: string;
  proposer_id: string;
  archetype: MarketArchetype;
  question: string;
  unit: string;
  bounds: [number, number]; // [min, max]
  no_event_value: number;
  criteria: string;
  resolution_source: string;
  payoff_mode: PayoffMode;
  lot_stake_k: number; // Integer CHIP per lot
  cap_widths_c: number; // Default 3
  state: MarketState;
  verifiability: Verifiability;
  route: ResolutionRoute;
  arbiter_id?: string | null;
  countdown_ends_at?: number | null; // Epoch ms
  parent_market_id?: string | null;
  parent_metric?: ParentMetric | null;
  parent_trigger_target?: number | null;
  parent_target_player_id?: string | null;
  parent_trigger_crossed?: boolean;
  mm_player_id?: string | null;
  active_width_w?: number | null;
  L?: number | null;
  H?: number | null;
  live_implied_value: number; // Implied probability (0..100%) or expected scalar value
  live_fair_value_toks?: number | null; // Analytical (Poisson) or AI advisory fair value per lot
  fair_value_source?: 'POISSON_MODEL' | 'AI_ADVISORY' | 'POOL_IMPLIED';
  feed_status?: 'LIVE' | 'FEED_DELAYED' | 'REPLAY';
  outcome_x?: number | null;
  toggles: MarketToggles;
  auction_quiet_Ends_at?: number | null;
  quote_deadline_at?: number | null;
  version: number; // Optimistic concurrency version
  created_at: number;
}

export interface AgentClassificationLog {
  id: string;
  market_id: string;
  agent1_parsed_payload: DraftMarketProposal;
  agent2_archetype: MarketArchetype;
  agent2_verifiability: Verifiability;
  agent2_route: ResolutionRoute;
  confidence: number;
  created_at: number;
}

export interface WidthBid {
  id: string;
  market_id: string;
  player_id: string;
  width: number;
  created_at: number;
}

export interface Position {
  id: string;
  market_id: string;
  player_id: string;
  side: PositionSide;
  lots: number;
  staked_toks: number; // Escrowed worst-case liability in integer CHIP
  entry_cost_toks: number; // Actual acquisition cost (stake or P2P purchase price)
  realized_pnl_toks: number; // Realized gains/losses from P2P sales or partial withdrawals
  current_shares: number; // Fraction remaining in continuous pool (0..1, scaled or exact)
  live_equity_toks: number; // Continuous mark-to-market value in integer CHIP (>= 0)
  withdrawn_toks: number;
  is_hidden: boolean;
  updated_at: number;
}

export interface PositionBid {
  id: string;
  market_id: string;
  position_id?: string | null; // Optional specific lot or standing bid for any lot on `side`
  side: PositionSide;
  buyer_id: string;
  seller_id?: string | null;
  price_toks: number; // Offer/Ask price in integer CHIP for 1 lot
  kind: 'BID' | 'ASK' | 'AUTO_SELL';
  status: 'open' | 'matched' | 'cancelled';
  escrowed_toks: number;
  created_at: number;
}

export interface Order {
  id: string;
  market_id: string;
  player_id: string;
  side: PositionSide;
  type: OrderType;
  trigger_level: number; // Implied odds/value threshold or equity floor
  size_toks: number; // Integer CHIP size
  escrowed_toks: number; // Backed by wallet escrow for limit_buy
  status: OrderStatus;
  visible_to_group: boolean; // Always true per SPEC §1.3 & §2.4.B.3
  mandate_id?: string | null;
  created_at: number;
}

export interface StrategyMandate {
  id: string;
  market_id: string;
  player_id: string;
  input_modality: 'voice' | 'text';
  raw_transcript: string;
  parsed_strategy_summary: string; // Field 1 of Hard Risk Gate
  side: PositionSide;
  stake_toks: number;
  entry_trigger_level?: number | null;
  take_profit_level: number | null; // Field 2 of Hard Risk Gate
  min_balance_floor: number | null; // Field 3 of Hard Risk Gate
  confirmed_at?: number | null;
  created_at: number;
}

export interface OutcomeProposal {
  id: string;
  market_id: string;
  proposer_id: string; // Player ID, Arbiter ID, or 'AGENT_FEED'
  proposed_x: number;
  source_url: string;
  challenge_deadline: number;
  status: 'pending' | 'accepted' | 'challenged' | 'withdrawn_by_correction' | 'rejected';
  votes: Record<string, number>; // player_id -> voted outcome X
  created_at: number;
}

export interface ChatMessage {
  id: string;
  player_id: string;
  text: string;
  created_at: number;
}

export interface LiveEvent {
  id: string;
  market_id: string;
  event_type: 'kickoff' | 'goal' | 'var_correction' | 'halftime' | 'fulltime' | 'weather_tick' | 'custom_tick';
  minute: number;
  score_home?: number;
  score_away?: number;
  description: string;
  implied_value_after?: number;
  created_at: number;
}

export type LedgerAccount = 'wallet' | 'escrow';
export type LedgerTxType =
  | 'GENESIS_MINT'
  | 'ESCROW_LOCK'
  | 'ESCROW_RELEASE'
  | 'ANTE_FORFEIT'
  | 'P2P_LOT_SALE'
  | 'PARTIAL_WITHDRAWAL'
  | 'LIMIT_ORDER_FILL'
  | 'STOP_CASCADE_FILL'
  | 'SETTLEMENT_PAYOUT'
  | 'VOID_REFUND';

export interface LedgerEntry {
  id: string;
  player_id: string;
  market_id: string;
  account: LedgerAccount;
  delta_toks: number; // Strictly integer
  tx_type: LedgerTxType;
  idempotency_key: string;
  note: string;
  created_at: number;
}

export interface SwimlaneEvent {
  id: string;
  market_id: string;
  player_id: string;
  phase: LifecyclePhase;
  code: SwimlaneNodeCode; // B | L | F | W | S | X
  label: string;
  delta_toks?: number;
  timestamp: number;
}

export interface WireTraceEntry {
  id: string;
  market_id: string;
  seq: number;
  timestamp_ms: number;
  source: 'PLAYER' | 'RISK_AGENT' | 'ORACLE_AGENT' | 'MARKET_ENGINE' | 'REPLAY_FEED';
  target: 'PLAYER' | 'RISK_AGENT' | 'ORACLE_AGENT' | 'MARKET_ENGINE' | 'BROADCAST';
  action: string;
  detail: string;
  toks_delta?: number;
}

export interface SwingBranchNode {
  id: string;
  trigger_level: number;
  direction: 'UP' | 'DOWN';
  label: string;
  orders_triggered: number;
  total_volume_toks: number;
  implied_value_after: number;
  player_swings: Record<string, number>; // player_id -> delta live_equity_toks
}

export interface SwingTreeProjection {
  market_id: string;
  current_implied_value: number;
  main_line_history: Array<{ step: string; implied_value: number; minute?: number }>;
  counterfactual_branches: SwingBranchNode[];
}

// ============================================================================
// Section 3.4 AI Tool Contract Schemas
// ============================================================================

export interface DraftMarketProposal {
  question: string;
  unit: string;
  bounds: [number, number];
  resolution_source: string;
  criteria: string;
  deadline_hours: number;
  payoff_mode: PayoffMode;
  lot_stake_k: number;
  no_event_value: number;
  parent_market_id?: string | null;
  parent_metric?: ParentMetric | null;
  parent_trigger_target?: number | null;
}

export interface ClassifyMarketProposal {
  archetype: MarketArchetype;
  verifiability: Verifiability;
  route: ResolutionRoute;
  requires_arbiter: boolean;
  rationale: string;
  confidence: number;
}

export interface LintCriteriaProposal {
  is_ambiguous: boolean;
  clarifying_questions: string[];
  suggested_tightened_criteria: string;
}

export interface SuggestWidthProposal {
  suggested_width_w: number;
  suggested_L: number;
  suggested_H: number;
  rationale: string;
}

export interface EstimateFairValueProposal {
  fair_value_toks_per_lot: number;
  implied_probability_pct: number;
  rationale: string;
}

export interface ParseRuleProposal {
  input_modality: 'voice' | 'text';
  raw_transcript: string;
  parsed_strategy_summary: string | null;
  side: PositionSide;
  stake_toks: number;
  entry_trigger_level: number | null;
  take_profit_level: number | null;
  min_balance_floor: number | null;
  missing_risk_gate_fields: Array<'parsed_strategy_summary' | 'take_profit_level' | 'min_balance_floor'>;
  gate_passed: boolean;
  prompt_for_user?: string;
}

export interface RecapProposal {
  headline: string;
  winner_summary: string;
  calibration_note: string;
}
