// ============================================================================
// Live bet pipeline, as streamed by the API over /api/v1/ws:
//   BET_RECEIVED -> BET_AI_REVIEWING -> BET_AI_REVIEWED -> BET_CREATED | BET_FAILED
// Every player sees every bet go through it.
// ============================================================================

export type BetStage = 'received' | 'reviewing' | 'reviewed' | 'created' | 'failed';

export interface BetReview {
  summary: string;
  fair_value: number | null;
  criteria: string;
  resolution_source: string;
  verdict: 'ok' | 'needs_clarity' | 'unresolvable';
  flags: string[];
}

export interface BetActivity {
  betId: string;
  username: string;
  playerId: string;
  question: string;
  stage: BetStage;
  /** live = real Gemini call, simulated = dev, fallback = live call failed */
  mode?: 'live' | 'simulated' | 'fallback';
  model?: string;
  review?: BetReview;
  marketId?: string;
  error?: string;
  updatedAt: number;
}

export interface BetFrame {
  event: string;
  data?: Record<string, any>;
}

const STAGE_BY_EVENT: Record<string, BetStage> = {
  BET_RECEIVED: 'received',
  BET_AI_REVIEWING: 'reviewing',
  BET_AI_REVIEWED: 'reviewed',
  BET_CREATED: 'created',
  BET_FAILED: 'failed',
};

const STAGE_ORDER: BetStage[] = ['received', 'reviewing', 'reviewed', 'created'];

const MAX_BETS = 4;

export function isBetFrame(frame: BetFrame): boolean {
  return typeof frame.event === 'string' && frame.event in STAGE_BY_EVENT;
}

/** Folds one frame into the list (newest bet first). Out-of-order frames never move a bet backwards. */
export function applyBetFrame(prev: BetActivity[], frame: BetFrame, now = Date.now()): BetActivity[] {
  const stage = STAGE_BY_EVENT[frame.event];
  const data = frame.data ?? {};
  const betId = typeof data.bet_id === 'string' ? data.bet_id : null;
  if (!stage || !betId) return prev;

  const existing = prev.find((b) => b.betId === betId);
  const base: BetActivity = existing ?? {
    betId,
    username: String(data.username ?? data.player_id ?? 'someone'),
    playerId: String(data.player_id ?? ''),
    question: String(data.question ?? ''),
    stage,
    updatedAt: now,
  };

  const finished = base.stage === 'created' || base.stage === 'failed';
  const movesForward =
    stage === 'failed' || STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(base.stage);
  const next: BetActivity = {
    ...base,
    stage: !existing || (!finished && movesForward) ? stage : base.stage,
    mode: data.mode ?? base.mode,
    model: data.model ?? base.model,
    review: data.review ?? base.review,
    marketId: data.market_id ?? base.marketId,
    error: data.error ?? base.error,
    updatedAt: now,
  };

  return [next, ...prev.filter((b) => b.betId !== betId)].slice(0, MAX_BETS);
}
