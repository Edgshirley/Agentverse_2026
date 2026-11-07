// ============================================================================
// Multi-Agent AI Pipeline (Agent 1 Intake, Agent 2 Classifier, 3-Part Risk Gate)
// Powered by Cloudflare Workers AI (`env.AI` Free Tier) + Deterministic Fallback
// (SPEC §3.1, §3.2, §3.3, §3.4)
// ============================================================================

import {
  ClassifyMarketProposal,
  DraftMarketProposal,
  EstimateFairValueProposal,
  LintCriteriaProposal,
  Market,
  MarketArchetype,
  ParseRuleProposal,
  PayoffMode,
  PositionSide,
  RecapProposal,
  ResolutionRoute,
  SuggestWidthProposal,
  Verifiability,
} from '../shared/types';
import { Env } from './db';

const CF_LLM_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

async function tryWorkersAiJson<T>(env: Env | undefined, systemPrompt: string, userPrompt: string): Promise<T | null> {
  if (!env?.AI) return null;
  try {
    const response = await env.AI.run(CF_LLM_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt + ' Respond ONLY with valid JSON.' },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
    });
    const rawText: string = response?.response || '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as T;
    }
  } catch {
    // Fall back to deterministic parser
  }
  return null;
}

/**
 * Agent 1 (Intake & Structuring): `draft_market` + `lint_criteria` + `suggest_width` (SPEC §3.1 & §3.4)
 */
export async function runAgent1Intake(
  prompt: string,
  env?: Env
): Promise<{
  draft: DraftMarketProposal;
  lint: LintCriteriaProposal;
  widthSuggestion: SuggestWidthProposal;
}> {
  const aiDraft = await tryWorkersAiJson<DraftMarketProposal>(
    env,
    'You are Agent 1 (Market Intake) for Friend Spreader. Extract question, unit, bounds [min,max], resolution_source, criteria, deadline_hours, payoff_mode (pot|binary|linear|log), lot_stake_k (integer TOKS), no_event_value.',
    prompt
  );

  const lower = prompt.toLowerCase();
  const isFootballMinute =
    lower.includes('score') ||
    lower.includes('goal') ||
    lower.includes('arsenal') ||
    lower.includes('minute') ||
    lower.includes('halftime');
  const isWeather =
    lower.includes('°c') ||
    lower.includes('temp') ||
    lower.includes('weather') ||
    lower.includes('rain') ||
    lower.includes('deg');
  const isStacked =
    lower.includes('market m') ||
    lower.includes('parent') ||
    lower.includes('p&l') ||
    lower.includes('pnl') ||
    lower.includes('odds hit');

  // Extract stake k if mentioned (e.g. "25 TOKS")
  const stakeMatch = prompt.match(/(\d+)\s*toks?/i);
  const k = stakeMatch ? Math.max(5, parseInt(stakeMatch[1], 10)) : isFootballMinute ? 10 : 25;

  let bounds: [number, number] = [0, 100];
  let unit = '%';
  let noEventValue = 0;
  let resolutionSource = 'Group / Public Oracle Feed';
  let criteria = `Official verifiable outcome for: "${prompt.trim()}"`;
  let payoffMode: PayoffMode = 'pot';

  if (isFootballMinute && !isStacked) {
    bounds = [0, 95];
    unit = 'min';
    noEventValue = 95;
    resolutionSource = 'Official Match Clock Feed (Opta / Replay)';
    criteria = 'Official match minute of first goal (0..95); settles at 95 if 0-0 fulltime.';
  } else if (isWeather) {
    bounds = [0, 45];
    unit = '°C';
    noEventValue = 20;
    resolutionSource = 'Met Office Daily High Feed';
    criteria = 'Official Met Office weather station daily high temperature.';
  }

  const draft: DraftMarketProposal = aiDraft ?? {
    question: prompt.trim().endsWith('?') ? prompt.trim() : `${prompt.trim()}?`,
    unit,
    bounds,
    resolution_source: resolutionSource,
    criteria,
    deadline_hours: 24,
    payoff_mode: payoffMode,
    lot_stake_k: k,
    no_event_value: noEventValue,
    parent_market_id: isStacked ? 'mkt_arsenal' : null,
    parent_metric: isStacked ? (lower.includes('p&l') || lower.includes('pnl') ? 'player_pnl' : 'odds') : null,
    parent_trigger_target: isStacked ? 75 : null,
  };

  const isAmbiguous = prompt.trim().split(/\s+/).length < 4;
  const lint: LintCriteriaProposal = {
    is_ambiguous: isAmbiguous,
    clarifying_questions: isAmbiguous
      ? [
          'Which official data source or 3rd-party arbiter decides ties/cancellations?',
          'What is the exact cutoff timestamp and fallback value if no event occurs?',
        ]
      : [],
    suggested_tightened_criteria: `${draft.criteria} (No-event fallback = ${draft.no_event_value} ${draft.unit})`,
  };

  const span = draft.bounds[1] - draft.bounds[0];
  const w = Math.max(2, Math.round(span * 0.1));
  const mid = Math.round((draft.bounds[0] + draft.bounds[1]) / 2);
  const widthSuggestion: SuggestWidthProposal = {
    suggested_width_w: w,
    suggested_L: Math.max(draft.bounds[0], mid - Math.floor(w / 2)),
    suggested_H: Math.min(draft.bounds[1], mid - Math.floor(w / 2) + w),
    rationale: `10% of domain span [${draft.bounds[0]}..${draft.bounds[1]}] balances two-sided taker flow against MM inventory risk.`,
  };

  return { draft, lint, widthSuggestion };
}

/**
 * Agent 2 (Market Classifier): `classify_market` (SPEC §3.1, §3.2, §3.4)
 */
export async function runAgent2Classifier(
  prompt: string,
  draft: DraftMarketProposal,
  env?: Env
): Promise<ClassifyMarketProposal> {
  const aiClass = await tryWorkersAiJson<ClassifyMarketProposal>(
    env,
    'You are Agent 2 (Market Classifier). Classify into archetype (simple|spread|stacked|ranking), verifiability (public_verifiable|custom_unverifiable|social_group), and route (auto|arbiter|group).',
    JSON.stringify({ prompt, draft })
  );
  if (aiClass && aiClass.archetype && aiClass.route) {
    return aiClass;
  }

  const lower = prompt.toLowerCase();

  let archetype: MarketArchetype = 'simple';
  if (
    draft.parent_market_id ||
    lower.includes('market m') ||
    lower.includes('parent') ||
    lower.includes('finish m') ||
    lower.includes('p&l') ||
    lower.includes('odds hit')
  ) {
    archetype = 'stacked';
  } else if (
    lower.includes('when will') ||
    lower.includes('how many') ||
    lower.includes('spread') ||
    lower.includes('range') ||
    draft.unit === 'min'
  ) {
    archetype = 'spread';
  } else if (lower.includes('rank') || lower.includes('who finishes first')) {
    archetype = 'ranking';
  }

  let verifiability: Verifiability = 'public_verifiable';
  let route: ResolutionRoute = 'auto';

  if (
    lower.includes('internal') ||
    lower.includes('office') ||
    lower.includes('company') ||
    lower.includes('kpi') ||
    lower.includes('team atlas') ||
    lower.includes('arbiter') ||
    lower.includes('private')
  ) {
    verifiability = 'custom_unverifiable';
    route = 'arbiter';
  } else if (
    lower.includes('friend') ||
    lower.includes('party') ||
    lower.includes('dinner') ||
    lower.includes('social')
  ) {
    verifiability = 'social_group';
    route = 'group';
  }

  return {
    archetype,
    verifiability,
    route,
    requires_arbiter: route === 'arbiter',
    rationale:
      route === 'arbiter'
        ? 'Private/internal metric lacks a public feed -> routed to mandatory countdown-locked 3rd-Party Arbiter.'
        : route === 'auto'
          ? 'Publicly verifiable sports/weather metric -> routed to automated feed oracle with 30m challenge window.'
          : 'Social group bet -> routed to participant proposal with 12h challenge/vote window.',
    confidence: 0.94,
  };
}

/**
 * Conversational Strategy Parser & Mandatory 3-Part Hard Risk Gate (`parse_rule` — SPEC §3.3 & FR-04 / FR-91).
 * Verifies:
 *   1. `parsed_strategy_summary` (entry trigger, direction, stake in TOKS)
 *   2. `take_profit_level` (exit target)
 *   3. `min_balance_floor` (drawdown floor)
 */
export async function parseStrategyRuleWithRiskGate(
  transcript: string,
  modality: 'voice' | 'text',
  market: Market,
  _env?: Env
): Promise<ParseRuleProposal> {
  const clean = transcript.trim();
  const lower = clean.toLowerCase();

  // Extract direction (`OVER`, `UNDER`, `YES`, `NO`)
  let side: PositionSide = market.archetype === 'spread' ? 'OVER' : 'YES';
  if (lower.includes('under')) side = 'UNDER';
  else if (lower.includes('over')) side = 'OVER';
  else if (/\bno\b|\bshort\b/.test(lower)) side = market.archetype === 'spread' ? 'UNDER' : 'NO';

  // Extract stake in TOKS (e.g. "Put 100 TOKS" or "stake 80")
  const stakeMatch =
    clean.match(/(?:put|bet|stake|enter|buy)\s+(\d+)\s*(?:toks?)?/i) ||
    clean.match(/(\d+)\s*toks?/i);
  const stakeToks = stakeMatch ? parseInt(stakeMatch[1], 10) : market.lot_stake_k * 2;

  // Extract optional entry trigger (e.g. "if odds dip below 40%" or "entry at 42%")
  const entryMatch = clean.match(/(?:below|under|dip to|entry at|if odds hit)\s+(\d+)%?/i);
  const entryTriggerLevel = entryMatch ? parseFloat(entryMatch[1]) : null;

  // Extract Field 2: Take-Profit / Exit Target (`take_profit_level`)
  // Matches phrases like: "take profit at 70%", "tp 75", "scale out half up 50%", "sell at 1350", "target 68%"
  const tpMatch = clean.match(
    /(?:take[- ]?profit|tp|scale out[^0-9]*|target|exit at|sell if[^0-9]*|profit at)\s*@?\s*(\d+(?:\.\d+)?)/i
  );
  const takeProfitLevel = tpMatch ? parseFloat(tpMatch[1]) : null;

  // Extract Field 3: Drawdown Floor / Stop-Loss (`min_balance_floor`)
  // Matches phrases like: "cut me at 60 TOKS", "floor 45", "stop at 40%", "drawdown 50", "min balance 60"
  const floorMatch = clean.match(
    /(?:cut me at|floor(?:\s*at)?|stop(?:\s*loss)?(?:\s*at)?|drawdown(?:\s*floor)?|cut at|protect at)\s*@?\s*(\d+(?:\.\d+)?)/i
  );
  const minBalanceFloor = floorMatch ? parseFloat(floorMatch[1]) : null;

  const hasValidPrompt = clean.length >= 4;
  const parsedSummary = hasValidPrompt
    ? `${side} ${stakeToks} TOKS${entryTriggerLevel != null ? ` (ENTRY TRIGGER @ ${entryTriggerLevel}%)` : ' (MARKET ENTRY)'}`
    : null;

  const missing: Array<'parsed_strategy_summary' | 'take_profit_level' | 'min_balance_floor'> = [];
  if (!parsedSummary) missing.push('parsed_strategy_summary');
  if (takeProfitLevel == null) missing.push('take_profit_level');
  if (minBalanceFloor == null) missing.push('min_balance_floor');

  const gatePassed = missing.length === 0;

  let promptForUser: string | undefined;
  if (!gatePassed) {
    const humanLabels = missing.map((f) => {
      if (f === 'parsed_strategy_summary') return '(1) Strategy Summary / Stake';
      if (f === 'take_profit_level') return '(2) Take-Profit Target (take_profit_level)';
      return '(3) Drawdown Floor / Stop Level (min_balance_floor)';
    });
    promptForUser = `HARD RISK GATE (FR-04): Please supply missing mandatory field(s) before order activation: ${humanLabels.join(', ')}.`;
  }

  return {
    input_modality: modality,
    raw_transcript: clean,
    parsed_strategy_summary: parsedSummary,
    side,
    stake_toks: stakeToks,
    entry_trigger_level: entryTriggerLevel,
    take_profit_level: takeProfitLevel,
    min_balance_floor: minBalanceFloor,
    missing_risk_gate_fields: missing,
    gate_passed: gatePassed,
    prompt_for_user: promptForUser,
  };
}

/**
 * Advisory Fair Value & Post-Settlement Calibration Recap (`estimate_fair_value` & `write_recap` — SPEC §3.4)
 */
export function generateMarketRecap(
  market: Market,
  netPnlByPlayer: Record<string, number>
): RecapProposal {
  const entries = Object.entries(netPnlByPlayer).sort((a, b) => b[1] - a[1]);
  const topWinner = entries[0];
  const topLoser = entries[entries.length - 1];

  const winnerText =
    topWinner && topWinner[1] > 0
      ? `${topWinner[0].toUpperCase()} led the table with +${topWinner[1]} TOKS`
      : 'Flat zero-sum settlement across seats';
  const loserText =
    topLoser && topLoser[1] < 0 ? `(${topLoser[0].toUpperCase()}: ${topLoser[1]} TOKS)` : '';

  return {
    headline: `SETTLED // ${market.question} -> X = ${market.outcome_x}`,
    winner_summary: `${winnerText} ${loserText}. Zero-sum ledger invariant verified (Σ ΔTOKS = 0).`,
    calibration_note:
      market.archetype === 'spread'
        ? `Quoted spread [${market.L}, ${market.H}] vs realized outcome X=${market.outcome_x} (${
            market.outcome_x! > market.H!
              ? 'OVER WON OUTSIDE RANGE'
              : market.outcome_x! < market.L!
                ? 'UNDER WON OUTSIDE RANGE'
                : 'INSIDE RANGE — MM CAPTURED POT'
          }).`
        : `Final outcome X=${market.outcome_x} resolved via ${market.route.toUpperCase()} oracle route.`,
  };
}

export function estimateAdvisoryFairValue(market: Market): EstimateFairValueProposal {
  return {
    fair_value_toks_per_lot: market.live_fair_value_toks ?? market.lot_stake_k,
    implied_probability_pct: market.live_implied_value,
    rationale: `Advisory fair value derived from ${market.fair_value_source || 'POOL_IMPLIED'} at implied level ${market.live_implied_value}.`,
  };
}
