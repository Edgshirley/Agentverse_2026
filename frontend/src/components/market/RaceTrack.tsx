import React from 'react';
import { Icon } from '../Icon';
import { Player } from '../../shared/types';
import { PixelRacerAvatar } from '../PixelMascot';
import { MarketView } from './marketView';

interface RaceTrackProps {
  view: MarketView;
  players: Player[];
  activePlayer: Player;
}

export const RaceTrack: React.FC<RaceTrackProps> = ({ view, players, activePlayer }) => {
  const { market, positions, isSpread, unitLabel, currentUnitCenter } = view;

  // Each bar is that player's real share of the money in play
  const totalEquity = positions.reduce((sum, p) => sum + Math.max(0, p.live_equity_toks), 0);
  const sideLabel = (side: string) => (side === 'OVER' ? 'ABOVE' : side === 'UNDER' ? 'BELOW' : side);
  const raceItems = positions
    .filter((p) => p.live_equity_toks > 0 || p.lots > 0)
    .sort((a, b) => Number(b.player_id === activePlayer.id) - Number(a.player_id === activePlayer.id))
    .slice(0, 5)
    .map((pos, idx) => {
      const isMine = pos.player_id === activePlayer.id;
      const tone = isMine ? 'mint' : idx % 2 === 0 ? 'coral' : 'sky';
      return {
        id: pos.id,
        name:
          players.find((pl) => pl.id === pos.player_id)?.nickname ?? pos.player_id.toUpperCase(),
        subtitle: `${sideLabel(pos.side)} · ${pos.live_equity_toks} CHIP`,
        pct: totalEquity > 0 ? (pos.live_equity_toks / totalEquity) * 100 : 0,
        colorClass: `filled-${tone}`,
        accent: `var(--pastel-${tone}-border)`,
        rightLabel: `${pos.live_equity_toks} CHIP`,
      };
    });

  return (
    <div className="race-track-wrap">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 10,
          color: 'var(--fg-muted)',
        }}
      >
        <span className="pixel-font icon-label" title="Live standings">
          <Icon name="trophy" size={13} />
        </span>
        <span className="pixel-font">
          {isSpread
            ? `[${market.L}..${market.H}] ${unitLabel.toUpperCase()}`
            : `${currentUnitCenter} ${unitLabel.toUpperCase()}`}
        </span>
      </div>

      {raceItems.length === 0 && <p className="auction-hint">No bets yet.</p>}

      {raceItems.map((item) => {
        const filledCount = Math.max(1, Math.min(16, Math.round((item.pct / 100) * 16)));
        const avatarLeftPct = Math.min(94, Math.max(6, (filledCount / 16) * 100));

        return (
          <div key={item.id} className="race-row">
            <div>
              <div className="pixel-font" style={{ fontSize: 12, fontWeight: 700 }}>
                {item.name}
              </div>
              <div style={{ fontSize: 9.5, color: 'var(--fg-muted)' }}>{item.subtitle}</div>
            </div>

            <div className="race-bar-lane">
              {/* 8-Bit Pixel Racer Sprite sitting on top of the active block */}
              <div className="race-avatar-pin" style={{ left: `${avatarLeftPct}%` }}>
                <PixelRacerAvatar accent={item.accent} size={22} />
              </div>

              {/* 16 Segmented Blocks */}
              {Array.from({ length: 16 }).map((_, segIdx) => (
                <div
                  key={segIdx}
                  className={`race-seg ${segIdx < filledCount ? item.colorClass : ''}`}
                />
              ))}
            </div>

            <div
              className="pixel-font"
              style={{
                fontSize: 13,
                textAlign: 'right',
                color: item.accent,
              }}
            >
              {item.rightLabel}
            </div>
          </div>
        );
      })}
    </div>
  );
};
