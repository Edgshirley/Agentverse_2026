-- ============================================================================
-- Friend Spreader (Spread) — Cloudflare D1 Serverless SQLite Schema (SPEC §5.2)
-- ============================================================================

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  wallet_balance_toks INTEGER NOT NULL DEFAULT 1000,
  escrow_balance_toks INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS markets (
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
);

CREATE TABLE IF NOT EXISTS agent_classification_logs (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  agent1_parsed_payload TEXT NOT NULL,
  agent2_archetype TEXT NOT NULL,
  agent2_verifiability TEXT NOT NULL,
  agent2_route TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS width_bids (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  width REAL NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
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
);

CREATE TABLE IF NOT EXISTS position_bids (
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
);

CREATE TABLE IF NOT EXISTS orders (
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
);

CREATE TABLE IF NOT EXISTS strategy_mandates (
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
);

CREATE TABLE IF NOT EXISTS outcome_proposals (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  proposer_id TEXT NOT NULL,
  proposed_x REAL NOT NULL,
  source_url TEXT NOT NULL,
  challenge_deadline INTEGER NOT NULL,
  status TEXT NOT NULL,
  votes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS live_events (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  minute INTEGER NOT NULL,
  score_home INTEGER,
  score_away INTEGER,
  description TEXT NOT NULL,
  implied_value_after REAL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  account TEXT NOT NULL,
  delta_toks INTEGER NOT NULL,
  tx_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS engine_snapshots (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
