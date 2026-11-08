import { ActiveMarketBundle } from '../../hooks/useMarketSync';
import { Player } from '../../shared/types';

/** Values derived from the active bundle that every market panel needs. */
export function deriveMarketView(bundle: ActiveMarketBundle, activePlayer: Player) {
  const { market, positions, orders, mmEscrowToks, widthBids } = bundle;
  const isSpread = market.archetype === 'spread';
  const openOrders = orders.filter((o) => o.status === 'open');
  // Yes/no bets are priced as the chance of YES in %; window bets use their own unit
  const unitLabel = !isSpread
    ? '%'
    : market.unit && market.unit !== 'binary' && market.unit !== '%'
      ? market.unit
      : 'units';

  const myPositions = positions.filter((p) => p.player_id === activePlayer.id);
  const myActivePos = myPositions.find((p) => p.lots > 0 || p.live_equity_toks > 0);
  const myLiveBalance = myPositions.reduce((acc, p) => acc + p.live_equity_toks, 0);
  const totalPotChip =
    positions.reduce((acc, p) => acc + p.staked_toks, 0) + mmEscrowToks;

  const currentUnitCenter = isSpread
    ? Math.round(((market.L ?? 3) + (market.H ?? 5)) / 2)
    : Math.round(market.live_implied_value);

  return {
    market,
    positions,
    widthBids,
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
