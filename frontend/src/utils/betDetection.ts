// ============================================================================
// Rule-based "is this chat message a bet idea?" check (no AI).
// Drives the tuxedo cat "BET IDEA?" widget + chime in the group chat.
// ============================================================================

const GREETING = /^(hi|hey|hello|yo|sup|ok|okay|k|thanks|thx|ty|lol|lmao|haha+|nice|gg|yes|no|yeah|nah)[!?.\s]*$/i;

/** Explicit betting language: always a bet idea. */
const BET_WORDS =
  /\b(bets?|betting|wager|market|odds|over\/under|over or under|spread|stake|loser buys|i'?ll put|put \d+|i'?m down|you'?re on)\b/i;

/** A stake in the game's currency ("25 chips", "50 CHIP"). */
const CHIP_AMOUNT = /\b\d+\s*chips?\b/i;

/** Something with a measurable or winnable outcome. */
const EVENT_WORDS =
  /\b(f1|formula ?1|race|pit ?stops?|grand prix|gp|laps?|qualifying|pole|match|game|goals?|score|wins?|winner|beat|final|league|cup|temp|temperature|°c|degrees|rain|snow|weather|ranking|rank|q[1-4]|price|btc|bitcoin|eth|stock|election|minutes?|hours?|seconds?|time)\b/i;

/** Asking about a future outcome. */
const OUTCOME_QUESTION =
  /^(will|who|who'?s|whos|how many|how much|how long|what time|when|which|is|are|does|do|can)\b/i;

export function looksLikeBetProposal(text: string): boolean {
  const t = text.trim();
  if (t.length < 5 || GREETING.test(t)) return false;
  if (BET_WORDS.test(t) || CHIP_AMOUNT.test(t)) return true;
  const asksOutcome = OUTCOME_QUESTION.test(t) || t.endsWith('?');
  return asksOutcome && EVENT_WORDS.test(t);
}

// ---------------------------------------------------------------------------
// Single bot type box: decide whether a request makes a NEW bet or sets a
// STRATEGY (stake / side / sell / stop) on the open market. Rules only.
// ---------------------------------------------------------------------------

const NEW_MARKET =
  /\b(make a (market|bet)|new (market|bet)|create|start a (bet|market)|let'?s bet on|i want to (bet on|make)|market (for|on)|who wins|will it|how many|internal company bet|stacked bet)\b/i;

const STRATEGY =
  /\b(sell (at|if|when)|take[- ]?profit|cash out|stop(-| )?loss|stop me( out)?|stops?\b|floor|put \d+|bet \d+|\d+\s*chips? on|on (above|below|over|under|yes|no)\b|go (above|below|over|under|long|short)|right now)\b/i;

export function classifyBotRequest(
  text: string,
  hasActiveMarket: boolean
): 'propose' | 'strategy' {
  if (!hasActiveMarket || NEW_MARKET.test(text)) return 'propose';
  return STRATEGY.test(text) ? 'strategy' : 'propose';
}
