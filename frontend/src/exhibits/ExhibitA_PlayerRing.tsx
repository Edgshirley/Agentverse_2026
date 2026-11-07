import React from 'react';
import { LiveEvent, Market, Player, Position } from '../shared/types';

interface ExhibitAProps {
  market: Market;
  players: Player[];
  positions: Position[];
  mmEscrowToks: number;
  liveEvents: LiveEvent[];
  selectedPlayerId: string;
  onSelectPlayer: (playerId: string) => void;
}

export const ExhibitA_PlayerRing: React.FC<ExhibitAProps> = ({
  market,
  players,
  positions,
  mmEscrowToks,
  liveEvents,
  selectedPlayerId,
  onSelectPlayer,
}) => {
  const totalTakerEscrow = positions.reduce((acc, p) => acc + p.staked_toks, 0);
  const totalPotToks = totalTakerEscrow + mmEscrowToks;
  const latestEvent = liveEvents.length > 0 ? liveEvents[liveEvents.length - 1] : null;

  const topSeats = players.slice(0, Math.ceil(players.length / 2));
  const bottomSeats = players.slice(Math.ceil(players.length / 2));

  const renderSeat = (player: Player, index: number) => {
    const playerPositions = positions.filter(
      (p) => p.player_id === player.id && (p.lots > 0 || p.live_equity_toks > 0 || p.realized_pnl_toks !== 0)
    );
    const isMm = market.mm_player_id === player.id;
    const isArbiter = market.arbiter_id === player.id;

    const activePos = playerPositions.find((p) => p.lots > 0 || p.live_equity_toks > 0);
    const liveEquity = isMm
      ? mmEscrowToks
      : playerPositions.reduce((acc, p) => acc + p.live_equity_toks, 0);
    const entryCost = isMm
      ? mmEscrowToks
      : playerPositions.reduce((acc, p) => acc + p.entry_cost_toks, 0);
    const realized = playerPositions.reduce((acc, p) => acc + p.realized_pnl_toks, 0);
    const netDelta = liveEquity - entryCost + realized;

    let directionBadge = 'PASS / IDLE';
    if (isArbiter) {
      directionBadge = '3RD-PARTY ARBITER';
    } else if (isMm) {
      directionBadge = `MM [${market.L ?? '?'}..${market.H ?? '?'}]`;
    } else if (activePos) {
      directionBadge = `${activePos.lots}x ${activePos.side}`;
    } else if (realized !== 0) {
      directionBadge = 'CASHED OUT';
    }

    return (
      <div
        key={player.id}
        className={`player-seat-card ${selectedPlayerId === player.id ? 'selected' : ''}`}
        onClick={() => onSelectPlayer(player.id)}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700 }}>
            0{index + 1} // {player.nickname}
          </span>
          <span
            className={
              isMm || activePos ? 'badge-inverted' : 'badge-outline'
            }
            style={{ fontSize: 10 }}
          >
            [{directionBadge}]
          </span>
        </div>
        <div
          style={{
            marginTop: 6,
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: 'var(--fg-muted)',
          }}
        >
          <span>
            LIVE EQ: <strong style={{ color: 'var(--fg-primary)' }}>{liveEquity} TOKS</strong>
          </span>
          <span>
            P&L:{' '}
            <strong style={{ color: 'var(--fg-primary)' }}>
              {netDelta >= 0 ? `+${netDelta}` : netDelta} TOKS
            </strong>
          </span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--fg-dim)', marginTop: 2 }}>
          WALLET: {player.wallet_balance_toks} TOKS | ESCROW: {player.escrow_balance_toks} TOKS
        </div>
      </div>
    );
  };

  return (
    <section className="exhibit-box strong-border">
      <div className="exhibit-title">
        <span>01 │ === EXHIBIT A :: MARKET TABLE & RADIAL PLAYER RING ====</span>
        <span className="badge-outline">
          ARCHETYPE: {market.archetype.toUpperCase()} | MODE: {market.payoff_mode.toUpperCase()} | ROUTE:{' '}
          {market.route.toUpperCase()}
        </span>
      </div>

      <div className="radial-arena">
        {/* Top Radial Arc of Friends */}
        <div className="radial-ring-seats">
          {topSeats.map((p, idx) => renderSeat(p, idx))}
        </div>

        {/* Center Citadel Poker Board */}
        <div className="center-poker-board">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              color: 'var(--fg-muted)',
              marginBottom: 6,
            }}
          >
            <span>MARKET ID: {market.id.toUpperCase()}</span>
            <span>
              STATUS: <strong className="badge-inverted">[{market.state.toUpperCase()}]</strong>
            </span>
            <span>FEED: [{market.feed_status || 'LIVE'}]</span>
          </div>

          <div style={{ fontSize: 15, fontWeight: 700, margin: '8px 0' }}>
            "{market.question}"
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              flexWrap: 'wrap',
              gap: 16,
              margin: '10px 0',
              padding: '8px 10px',
              borderTop: '1px solid var(--border-color)',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            {market.archetype === 'spread' ? (
              <>
                <div>
                  <div style={{ color: 'var(--fg-muted)', fontSize: 10 }}>MM QUOTED SPREAD [L, H]</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>
                    [{market.L ?? '--'} .. {market.H ?? '--'}] {market.unit}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--fg-muted)', fontSize: 10 }}>WIDTH (w)</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>
                    [{market.active_width_w ?? '--'}x]
                  </div>
                </div>
              </>
            ) : (
              <div>
                <div style={{ color: 'var(--fg-muted)', fontSize: 10 }}>LIVE IMPLIED ODDS / VALUE</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  .{String(Math.round(market.live_implied_value)).padStart(2, '0')} ({market.live_implied_value}%)
                </div>
              </div>
            )}

            <div>
              <div style={{ color: 'var(--fg-muted)', fontSize: 10 }}>ACTIVE POT / LIQUIDITY</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{totalPotToks} TOKS</div>
            </div>

            <div>
              <div style={{ color: 'var(--fg-muted)', fontSize: 10 }}>
                FAIR VALUE ({market.fair_value_source || 'POISSON'})
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {market.live_fair_value_toks ?? market.lot_stake_k} TOKS / LOT
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
            {latestEvent ? (
              <span>
                LIVE TICKER [MIN {latestEvent.minute}&apos;]:{' '}
                <strong style={{ color: 'var(--fg-primary)' }}>{latestEvent.description}</strong>
              </span>
            ) : (
              <span>
                CRITERIA: {market.criteria} (STAKE k = {market.lot_stake_k} TOKS)
              </span>
            )}
          </div>
        </div>

        {/* Bottom Radial Arc of Friends */}
        <div className="radial-ring-seats">
          {bottomSeats.map((p, idx) => renderSeat(p, idx + topSeats.length))}
        </div>
      </div>
    </section>
  );
};
