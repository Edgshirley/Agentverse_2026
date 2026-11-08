import { ActiveMarketBundle } from '../../hooks/useMarketSync';
import { Player } from '../../shared/types';

/** Values derived from the active bundle that every market panel needs. */
export function deriveMarketView(bundle: ActiveMarketBundle, activePlayer: Player) {
  const { market, positions, orders, mmEscrowToks } = bundle;
  const isSpread = market.archetype === 'spread';
  const openOrders = orders.filter((o) => o.status === 'open');
  const unitLabel =
    market.unit && market.unit !== 'binary' && market.unit !== '%' ? market.unit : '°C';

  const myPositions = positions.filter((p) => p.player_id === activePlayer.id);
  const myActivePos = myPositions.find((p) => p.lots > 0 || p.live_equity_toks > 0);
  const myLiveBalance = myPositions.reduce((acc, p) => acc + p.live_equity_toks, 0);
  const totalPotChip =
    positions.reduce((acc, p) => acc + p.staked_toks, 0) + mmEscrowToks;

  const currentUnitCenter = isSpread
    ? Math.round(((market.L ?? 3) + (market.H ?? 5)) / 2)
    : market.live_implied_value <= 35
      ? market.live_implied_value
      : 24;

  return {
    market,
    positions,
    isSpread,
    openOrders,
    unitLabel,
    myActivePos,
    myLiveBalance,
    totalPotChip,
    currentUnitCenter,
  };
}

export type MarketView = ReturnType<typeof deriveMarketView>;
