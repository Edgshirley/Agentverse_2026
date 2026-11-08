// ============================================================================
// Branching Swing Tree & Counterfactual Trajectory Calculator
// (SPEC §2.4.B.3, §4.2 Exhibit B Bottom & Exhibit C)
// ============================================================================

import { Market, Order, Position, SwingBranchNode, SwingTreeProjection } from '../shared/types';

export function computeSwingTree(
  market: Market,
  positions: Position[],
  orders: Order[],
  history: Array<{ step: string; implied_value: number; minute?: number }> = []
): SwingTreeProjection {
  const openOrders = orders.filter((o) => o.status === 'open' && o.visible_to_group);
  const currentImplied = market.live_implied_value;

  // Group open orders by trigger bucket (within 2% levels)
  const buckets: Map<number, Order[]> = new Map();
  for (const ord of openOrders) {
    const levelKey = Math.round(ord.trigger_level / 2) * 2;
    const grp = buckets.get(levelKey) ?? [];
    grp.push(ord);
    buckets.set(levelKey, grp);
  }

  const branches: SwingBranchNode[] = [];
  let branchIdx = 0;

  for (const [level, cluster] of Array.from(buckets.entries()).sort((a, b) => b[0] - a[0])) {
    branchIdx += 1;
    const totalVolume = cluster.reduce((acc, o) => acc + o.size_toks, 0);
    const direction: 'UP' | 'DOWN' = level >= currentImplied ? 'UP' : 'DOWN';

    // Estimate post-cascade implied value if this stop/limit cluster triggers
    const netOrderPush = cluster.reduce((acc, o) => {
      const isBuyOrBull =
        o.type === 'limit_buy'
          ? o.side === 'YES' || o.side === 'OVER'
          : !(o.side === 'YES' || o.side === 'OVER');
      return acc + (isBuyOrBull ? 3 : -4);
    }, 0);

    const impliedAfter = Math.max(5, Math.min(95, level + netOrderPush));
    const oddsDeltaFraction = (impliedAfter - currentImplied) / 100;

    const playerSwings: Record<string, number> = {};
    for (const p of positions) {
      if (p.live_equity_toks <= 0 && p.lots <= 0) continue;
      const isBull = p.side === 'YES' || p.side === 'OVER';
      const basePool = Math.max(p.live_equity_toks, p.staked_toks, market.lot_stake_k * p.lots);
      const rawSwing = Math.round(basePool * (isBull ? oddsDeltaFraction : -oddsDeltaFraction));
      playerSwings[p.player_id] = (playerSwings[p.player_id] ?? 0) + rawSwing;
    }

    const typesSummary = Array.from(new Set(cluster.map((c) => c.type.toUpperCase()))).join('/');
    branches.push({
      id: `branch_${branchIdx}_${level}`,
      trigger_level: level,
      direction,
      label: `IF @ ${level}% [${cluster.length}x ${typesSummary} :: ${totalVolume} CHIP]`,
      orders_triggered: cluster.length,
      total_volume_toks: totalVolume,
      implied_value_after: impliedAfter,
      player_swings: playerSwings,
    });
  }

  const mainLine =
    history.length > 0
      ? history
      : [
          { step: 'OPEN', implied_value: 50, minute: 0 },
          { step: 'LIVE', implied_value: currentImplied },
        ];

  return {
    market_id: market.id,
    current_implied_value: currentImplied,
    main_line_history: mainLine,
    counterfactual_branches: branches,
  };
}

/**
 * Computes the Exhibit C Telemetry `> SWING RISK` summary line.
 */
export function formatSwingRiskTelemetry(market: Market, orders: Order[]): string {
  const openStops = orders.filter(
    (o) => o.status === 'open' && (o.type === 'stop_loss' || o.type === 'take_profit' || o.type === 'limit_sell')
  );
  if (openStops.length === 0) {
    return '0 STOPS ACTIVE ON SWING MAP';
  }
  const nearby = openStops.filter(
    (o) => Math.abs(o.trigger_level - market.live_implied_value) <= 8
  );
  if (nearby.length > 0) {
    const maxDist = Math.max(
      1,
      Math.ceil(
        Math.max(...nearby.map((o) => Math.abs(o.trigger_level - market.live_implied_value)))
      )
    );
    return `${nearby.length} STOP${nearby.length > 1 ? 'S' : ''} WITHIN ${maxDist}% OF CURRENT ODDS`;
  }
  return `${openStops.length} PUBLIC ORDER${openStops.length > 1 ? 'S' : ''} ON SWING MAP`;
}
