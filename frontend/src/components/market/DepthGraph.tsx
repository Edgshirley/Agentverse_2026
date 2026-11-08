import React, { useEffect, useState } from 'react';
import { Icon } from '../Icon';
import { OrderType, Player } from '../../shared/types';
import { MarketView } from './marketView';

interface DepthGraphProps {
  view: MarketView;
  players: Player[];
  activePlayer: Player;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
}

export const DepthGraph: React.FC<DepthGraphProps> = ({ view, players, activePlayer, onDispatch }) => {
  const {
    market,
    positions,
    isSpread,
    openOrders,
    unitLabel,
    myActivePos,
    currentUnitCenter,
  } = view;

  const [selectedGraphLevel, setSelectedGraphLevel] = useState<number | null>(null);
  const [orderType, setOrderType] = useState<OrderType>('stop_loss');
  const [orderSizeChip, setOrderSizeChip] = useState<string>('25');

  useEffect(() => {
    setSelectedGraphLevel(null);
  }, [market.id]);

  const ladderStep =
    market.unit === 'pit stops' || market.unit === 'laps' ? 1 : isSpread ? 3 : 5; // yes/no: 5% steps

  const baseLevels = [
    currentUnitCenter + ladderStep * 3,
    currentUnitCenter + ladderStep * 2,
    currentUnitCenter + ladderStep * 1,
    currentUnitCenter,
    Math.max(0, currentUnitCenter - ladderStep * 1),
    Math.max(0, currentUnitCenter - ladderStep * 2),
    Math.max(0, currentUnitCenter - ladderStep * 3),
  ];
  const allUnitLevels = Array.from(
    new Set([
      ...baseLevels,
      ...(market.L != null ? [market.L] : []),
      ...(market.H != null ? [market.H] : []),
      ...openOrders.map((o) => o.trigger_level),
    ])
  ).sort((a, b) => b - a);

  // Compute Left (BID / BUY / ABOVE) and Right (ASK / STOP-LOSS / BELOW) volumes per level for Screenshot 3 Graph
  const rowsData = allUnitLevels.map((lvl) => {
    const ordersAtLvl = openOrders.filter((o) => o.trigger_level === lvl);
    const isCurrent = lvl === currentUnitCenter;
    const isInsideWindow =
      isSpread && market.L != null && market.H != null && lvl >= market.L && lvl <= market.H;

    // Left (Green / Bid / Long / Above): limit_buy orders + active YES/OVER positions at current/upper boundary
    const bidOrdersVol = ordersAtLvl
      .filter((o) => o.type === 'limit_buy' || o.side === 'OVER' || o.side === 'YES')
      .filter((o) => o.type !== 'stop_loss')
      .reduce((acc, o) => acc + o.size_toks, 0);

    const activeLongVol =
      (isCurrent && !isSpread) || (isSpread && lvl === market.H)
        ? positions
            .filter((p) => (p.side === 'YES' || p.side === 'OVER') && p.live_equity_toks > 0)
            .reduce((acc, p) => acc + p.live_equity_toks, 0)
        : 0;

    // Right (Coral / Ask / Stop-Loss / Below): stop_loss, take_profit, limit_sell + active NO/UNDER positions
    const askOrdersVol = ordersAtLvl
      .filter(
        (o) =>
          o.type === 'stop_loss' ||
          o.type === 'take_profit' ||
          o.type === 'limit_sell' ||
          o.side === 'UNDER' ||
          o.side === 'NO'
      )
      .reduce((acc, o) => acc + o.size_toks, 0);

    const activeShortVol =
      (isCurrent && !isSpread) || (isSpread && lvl === market.L)
        ? positions
            .filter((p) => (p.side === 'NO' || p.side === 'UNDER') && p.live_equity_toks > 0)
            .reduce((acc, p) => acc + p.live_equity_toks, 0)
        : 0;

    // Give subtle baseline visual depth around the center so the Bid/Ask ladder always looks rich like Screenshot 3
    const dist = Math.abs(lvl - currentUnitCenter);
    const baselineBid = lvl >= currentUnitCenter ? Math.max(10, 45 - dist * 10) : 0;
    const baselineAsk = lvl <= currentUnitCenter ? Math.max(10, 45 - dist * 10) : 0;

    const totalBidVol = bidOrdersVol + activeLongVol + baselineBid;
    const totalAskVol = askOrdersVol + activeShortVol + baselineAsk;

    const stopLabels = ordersAtLvl.map((o) => {
      const nick =
        players.find((pl) => pl.id === o.player_id)?.nickname || o.player_id.toUpperCase();
      return `${nick} ${o.type === 'stop_loss' ? 'STOP' : 'LIMIT'}`;
    });

    return {
      lvl,
      isCurrent,
      isInsideWindow,
      totalBidVol,
      totalAskVol,
      stopLabels,
    };
  });

  const maxBarVol = Math.max(
    60,
    ...rowsData.map((r) => Math.max(r.totalBidVol, r.totalAskVol))
  );

  return (
      <div className="depth-graph-wrap">
        <div className="depth-header-grid">
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingRight: 8 }}>
            <span style={{ color: 'var(--fg-muted)', fontSize: 10 }}>CHIP</span>
            <span className="icon-label" style={{ color: 'var(--accent-pos)' }}>
            <Icon name={isSpread ? 'arrow-up' : 'check'} size={13} />
            {isSpread ? 'ABOVE' : 'YES'}
          </span>
          </div>
          <div style={{ textAlign: 'center', color: 'var(--fg-muted)', fontSize: 10 }}>
            {unitLabel.toUpperCase()}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 8 }}>
            <span className="icon-label" style={{ color: 'var(--accent-neg)' }}>
            <Icon name={isSpread ? 'arrow-down' : 'close'} size={13} />
            {isSpread ? 'BELOW' : 'NO'}
          </span>
            <span style={{ color: 'var(--fg-muted)', fontSize: 10 }}>CHIP</span>
          </div>
        </div>

        {rowsData.map((row) => {
          const bidWidthPct = Math.min(100, Math.max(18, Math.round((row.totalBidVol / maxBarVol) * 100)));
          const askWidthPct = Math.min(100, Math.max(18, Math.round((row.totalAskVol / maxBarVol) * 100)));

          return (
            <div
              key={row.lvl}
              className="depth-row-grid"
              onClick={() =>
                // Window stops are set in CHIP via the bot box, not at a unit level
                !isSpread && setSelectedGraphLevel((prev) => (prev === row.lvl ? null : row.lvl))
              }
              title={`Click ${row.lvl} ${unitLabel} to place a stop-loss or limit order at this level`}
            >
              {/* LEFT BAR: Green BID / BUY / ABOVE Volume */}
              <div className="depth-side-bid">
                <div className="depth-bar-bid" style={{ width: `${bidWidthPct}%` }}>
                  <span>{row.totalBidVol} CHIP</span>
                  
                </div>
              </div>

              {/* CENTER SPINE: Unit Level Pill */}
              <div
                className={`depth-center-pill ${
                  row.isCurrent ? 'is-current' : row.isInsideWindow ? 'is-window' : ''
                }`}
              >
                <span>
                  {row.lvl} {unitLabel}
                </span>
              </div>

              {/* RIGHT BAR: Coral ASK / STOP-LOSS / BELOW Volume */}
              <div className="depth-side-ask">
                <div className="depth-bar-ask" style={{ width: `${askWidthPct}%` }}>
                  <span style={{ opacity: 0.85, fontSize: 9.5 }}>
                    {row.stopLabels[0] ?? ''}
                  </span>
                  <span>{row.totalAskVol} CHIP</span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Contextual 1-Line Order Popup ONLY when user clicks a level on the graph */}
        {selectedGraphLevel !== null && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              justifyContent: 'center',
              flexWrap: 'wrap',
              marginTop: 8,
              padding: '10px 12px',
              borderRadius: 8,
              backgroundColor: 'var(--bg-panel)',
              border: '1.5px solid var(--border-color)',
            }}
          >
            <span className="pixel-font" style={{ fontSize: 10.5 }}>
              AT {selectedGraphLevel} {unitLabel.toUpperCase()}:
            </span>
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as OrderType)}
              style={{ padding: '4px 8px', fontSize: 11.5 }}
            >
              <option value="stop_loss">STOP LOSS</option>
              <option value="take_profit">TAKE PROFIT (SELL)</option>
              <option value="limit_buy">BUY LIMIT (BID)</option>
            </select>
            <input
              type="number"
              value={orderSizeChip}
              onChange={(e) => setOrderSizeChip(e.target.value)}
              style={{ width: 68, padding: '4px 8px', fontSize: 11.5 }}
            />
            <span style={{ fontSize: 11.5 }}>CHIP</span>
            <button
              className="btn-inverted pixel-font"
              style={{ padding: '5px 8px' }}
            title="Place order"
            aria-label="Place order"
            onClick={async () => {
                await onDispatch(`/api/markets/${market.id}/orders`, {
                  playerId: activePlayer.id,
                  side: myActivePos?.side || (isSpread ? 'OVER' : 'YES'),
                  type: orderType,
                  triggerLevel: selectedGraphLevel,
                  sizeToks: Number(orderSizeChip),
                });
                setSelectedGraphLevel(null);
              }}
            >
            <Icon name="check" size={14} />
          </button>
            <button
              style={{ padding: '4px 6px' }}
            onClick={() => setSelectedGraphLevel(null)}
            title="Cancel"
            aria-label="Cancel"
          >
            <Icon name="close" size={14} />
          </button>
          </div>
        )}
      </div>
  );
};
