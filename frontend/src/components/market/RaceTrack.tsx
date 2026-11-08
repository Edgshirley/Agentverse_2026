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
  const {
    market,
    positions,
    isSpread,
    unitLabel,
    myActivePos,
    myLiveBalance,
    totalPotChip,
    currentUnitCenter,
  } = view;

  // Build Racers for the 8-Bit Segmented Race Bar (Screenshot 4 Style)
  const activePositions = positions.filter((p) => p.live_equity_toks > 0 || p.lots > 0);
  const raceItems = [
    {
      id: 'you_racer',
      name: activePlayer.nickname,
      subtitle: myActivePos
        ? `${myActivePos.side === 'OVER' ? 'ABOVE' : myActivePos.side === 'UNDER' ? 'BELOW' : myActivePos.side} · ${myLiveBalance} CHIP`
        : 'READY TO BET',
      pct: Math.min(95, Math.max(18, myLiveBalance > 0 ? Math.round((myLiveBalance / Math.max(100, totalPotChip)) * 100) : 32)),
      colorClass: 'filled-mint' as const,
      accent: 'var(--pastel-mint-border)',
      rightLabel: `${myLiveBalance} CHIP`,
    },
    ...activePositions
      .filter((p) => p.player_id !== activePlayer.id)
      .slice(0, 2)
      .map((pos, idx) => {
        const nick =
          players.find((pl) => pl.id === pos.player_id)?.nickname ||
          pos.player_id.toUpperCase();
        const pct = Math.min(
          92,
          Math.max(24, Math.round((pos.live_equity_toks / Math.max(100, totalPotChip)) * 100))
        );
        return {
          id: pos.id,
          name: nick,
          subtitle: `${pos.side === 'OVER' ? 'ABOVE' : pos.side === 'UNDER' ? 'BELOW' : pos.side} · ${pos.live_equity_toks} CHIP`,
          pct,
          colorClass: idx % 2 === 0 ? ('filled-coral' as const) : ('filled-sky' as const),
          accent: idx % 2 === 0 ? 'var(--pastel-coral-border)' : 'var(--pastel-sky-border)',
          rightLabel: `${pos.live_equity_toks} CHIP`,
        };
      }),
  ];

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
            ? `[${market.L ?? 3}..${market.H ?? 5}] ${unitLabel.toUpperCase()}`
            : `${currentUnitCenter} ${unitLabel.toUpperCase()}`}
        </span>
      </div>

      {raceItems.map((item, idx) => {
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
              {/* Dashed Target / Finish Flag Line */}
              <div className="race-target-line" style={{ left: '75%' }}>
                {idx === 0 && (
                  <span className="race-target-flag">
                    <Icon name="flag" size={10} /> {isSpread ? `[${market.L}..${market.H}]` : `${currentUnitCenter}${unitLabel}`}
                  </span>
                )}
              </div>

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
