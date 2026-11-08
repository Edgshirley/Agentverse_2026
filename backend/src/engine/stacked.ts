// ============================================================================
// Stacked (Meta / Derivative) Market Evaluator (SPEC §2.1, §5.2, §6.2)
// ============================================================================

import { Market } from '../shared/types';

export interface ParentMarketSnapshot {
  parentMarket: Market;
  currentVolumeToks: number;
  netPnlByPlayer?: Record<string, number>;
}

export interface StackedEvaluationResult {
  updatedChildMarket: Market;
  action: 'NONE' | 'SETTLE' | 'VOID';
  outcomeX?: number;
  reason?: string;
}

/**
 * Evaluates a Stacked (derivative) market against the latest state of its parent market.
 * Enforces SPEC §6.2:
 * - Stacked markets tied to parent's `outcome` or `player_pnl` void and refund stakes if parent voids.
 * - Stacked markets on `volume` or `odds` settle if their trigger was already crossed prior to parent voiding!
 */
export function evaluateStackedMarket(
  childMarket: Market,
  parentSnapshot: ParentMarketSnapshot
): StackedEvaluationResult {
  if (
    childMarket.archetype !== 'stacked' ||
    !childMarket.parent_market_id ||
    childMarket.state === 'settled' ||
    childMarket.state === 'void'
  ) {
    return { updatedChildMarket: childMarket, action: 'NONE' };
  }

  const { parentMarket, currentVolumeToks, netPnlByPlayer } = parentSnapshot;
  const metric = childMarket.parent_metric ?? 'outcome';
  const target = childMarket.parent_trigger_target ?? 50;

  let triggerCrossed = Boolean(childMarket.parent_trigger_crossed);

  // Check if live `odds` or `volume` trigger is crossed right now
  if (metric === 'odds' && parentMarket.live_implied_value >= target) {
    triggerCrossed = true;
  } else if (metric === 'volume' && currentVolumeToks >= target) {
    triggerCrossed = true;
  }

  const updatedChild: Market = {
    ...childMarket,
    parent_trigger_crossed: triggerCrossed,
  };

  // Case 1: Parent market voided while Stacked Market is open (SPEC §6.2)
  if (parentMarket.state === 'void') {
    if ((metric === 'odds' || metric === 'volume') && triggerCrossed) {
      return {
        updatedChildMarket: updatedChild,
        action: 'SETTLE',
        outcomeX: 100, // YES wins because trigger was already crossed prior to voiding
        reason: `Parent market voided after ${metric} trigger (${target}) was already crossed`,
      };
    }
    return {
      updatedChildMarket: updatedChild,
      action: 'VOID',
      reason: `Parent market ${parentMarket.id} voided before ${metric} resolution`,
    };
  }

  // Case 2: Live continuous trigger crossed on `odds` or `volume`
  if ((metric === 'odds' || metric === 'volume') && triggerCrossed) {
    return {
      updatedChildMarket: updatedChild,
      action: 'SETTLE',
      outcomeX: 100, // YES wins immediately upon crossing threshold
      reason: `Parent ${metric} crossed target threshold ${target}`,
    };
  }

  // Case 3: Parent market settled
  if (parentMarket.state === 'settled') {
    if (metric === 'odds' || metric === 'volume') {
      return {
        updatedChildMarket: updatedChild,
        action: 'SETTLE',
        outcomeX: triggerCrossed ? 100 : 0,
        reason: `Parent market settled; ${metric} trigger ${triggerCrossed ? 'WAS' : 'WAS NOT'} crossed`,
      };
    }

    if (metric === 'player_pnl') {
      const targetPlayer = childMarket.parent_target_player_id ?? parentMarket.proposer_id;
      const pnl = netPnlByPlayer?.[targetPlayer] ?? 0;
      const won = pnl > target;
      return {
        updatedChildMarket: updatedChild,
        action: 'SETTLE',
        outcomeX: won ? 100 : 0,
        reason: `Player ${targetPlayer} finished parent market with P&L ${pnl} CHIP (target > ${target})`,
      };
    }

    // Default metric === 'outcome'
    const parentX = parentMarket.outcome_x ?? 0;
    const won = parentX >= target;
    return {
      updatedChildMarket: updatedChild,
      action: 'SETTLE',
      outcomeX: won ? 100 : 0,
      reason: `Parent market settled at X=${parentX} (target >= ${target})`,
    };
  }

  return { updatedChildMarket: updatedChild, action: 'NONE' };
}
