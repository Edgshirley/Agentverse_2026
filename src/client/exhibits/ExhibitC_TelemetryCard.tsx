import React from 'react';
import { Market, Order, Player, Position, StrategyMandate } from '../../shared/types';

interface ExhibitCTelemetryProps {
  market: Market;
  selectedPlayer: Player;
  positions: Position[];
  orders: Order[];
  mandates: StrategyMandate[];
  mmEscrowToks: number;
  swingRiskLabel: string;
}

export const ExhibitC_TelemetryCard: React.FC<ExhibitCTelemetryProps> = ({
  market,
  selectedPlayer,
  positions,
  orders,
  mandates,
  mmEscrowToks,
  swingRiskLabel,
}) => {
  const isMm = market.mm_player_id === selectedPlayer.id;
  const playerPositions = positions.filter((p) => p.player_id === selectedPlayer.id);
  const liveEquity = isMm
    ? mmEscrowToks
    : playerPositions.reduce((acc, p) => acc + p.live_equity_toks, 0);
  const entryCost = isMm
    ? mmEscrowToks
    : playerPositions.reduce((acc, p) => acc + p.entry_cost_toks, 0);
  const realized = playerPositions.reduce((acc, p) => acc + p.realized_pnl_toks, 0);
  const unrealized = liveEquity - entryCost + realized;

  const latestMandate = mandates
    .filter((m) => m.player_id === selectedPlayer.id)
    .slice(-1)[0];

  const playerTpOrder = orders.find(
    (o) =>
      o.player_id === selectedPlayer.id &&
      o.status === 'open' &&
      (o.type === 'take_profit' || o.type === 'limit_sell')
  );
  const playerSlOrder = orders.find(
    (o) => o.player_id === selectedPlayer.id && o.status === 'open' && o.type === 'stop_loss'
  );

  const tpText =
    latestMandate?.take_profit_level != null
      ? `@ ${latestMandate.take_profit_level}${latestMandate.take_profit_level <= 100 ? '%' : ' TOKS'}`
      : playerTpOrder
        ? `@ ${playerTpOrder.trigger_level}%`
        : 'NONE SET (MANUAL)';

  const stopFloorText =
    latestMandate?.min_balance_floor != null
      ? `@ ${latestMandate.min_balance_floor}${latestMandate.min_balance_floor <= 100 ? '%' : ' TOKS'} (HARD)`
      : playerSlOrder
        ? `@ ${playerSlOrder.trigger_level}% (HARD)`
        : 'ESCROW CAP ONLY';

  const impliedStr = `.${String(Math.min(99, Math.max(1, Math.round(market.live_implied_value)))).padStart(2, '0')}`;
  const rangeStr =
    market.archetype === 'spread'
      ? `[${market.L ?? '--'} .. ${market.H ?? '--'}] ${market.unit}`
      : `[${market.bounds[0]} .. ${market.bounds[1]}] ${market.unit}`;

  return (
    <section className="exhibit-box strong-border">
      <div className="gutter-row" style={{ fontWeight: 700, borderBottom: '1px solid var(--border-color)', paddingBottom: 4 }}>
        <span className="gutter-num">51</span>
        <span>
          === POSITION TELEMETRY :: {selectedPlayer.nickname} ========================
        </span>
      </div>

      <div className="gutter-row">
        <span className="gutter-num">52</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <span>
            &gt; IMPLIED ODDS &nbsp;&nbsp;<strong>{impliedStr}</strong>
          </span>
          <span>
            &gt; RANGE &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<strong>{rangeStr}</strong>
          </span>
        </div>
      </div>

      <div className="gutter-row">
        <span className="gutter-num">53</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <span>
            &gt; LIVE EQUITY &nbsp;&nbsp;&nbsp;<strong>{liveEquity.toLocaleString()} TOKS</strong>
          </span>
          <span>
            &gt; UNREALIZED &nbsp;&nbsp;
            <strong>
              {unrealized >= 0 ? `+${unrealized}` : unrealized} TOKS
            </strong>
          </span>
        </div>
      </div>

      <div className="gutter-row">
        <span className="gutter-num">54</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <span>
            &gt; TAKE PROFIT &nbsp;&nbsp;&nbsp;<strong>{tpText}</strong>
          </span>
          <span>
            &gt; STOP FLOOR &nbsp;&nbsp;<strong>{stopFloorText}</strong>
          </span>
        </div>
      </div>

      <div className="gutter-row">
        <span className="gutter-num">55</span>
        <span>
          &gt; SWING RISK &nbsp;&nbsp;&nbsp;&nbsp;<strong>{swingRiskLabel}</strong>
        </span>
      </div>
    </section>
  );
};
