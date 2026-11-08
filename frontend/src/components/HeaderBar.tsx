import React from 'react';
import { Group, Player } from '../shared/types';
import { PixelMascot } from './PixelMascot';

interface HeaderBarProps {
  group: Group;
  activePlayer: Player;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onResetDemo: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  group,
  activePlayer,
  theme,
  onToggleTheme,
  onResetDemo,
}) => {
  return (
    <header className="terminal-header">
      {/* Brand + Group Name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="brand-lockup">
          <PixelMascot size={32} />
          <span className="pixel-font brand-wordmark">MarketMate</span>
        </span>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{group.name}</span>
      </div>

      {/* Your CHIP Balance & Theme */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="chip-wallet-badge">
          <span className="pixel-font">{activePlayer.wallet_balance_toks.toLocaleString()}</span>
          <span className="pixel-font" style={{ fontSize: 11, opacity: 0.9 }}>
            CHIP
          </span>
          {activePlayer.escrow_balance_toks > 0 && (
            <span style={{ fontSize: 11, opacity: 0.75 }}>
              ({activePlayer.escrow_balance_toks} IN PLAY)
            </span>
          )}
        </div>

        <button onClick={onToggleTheme} style={{ padding: '5px 10px', fontSize: 11 }}>
          {theme === 'dark' ? '☀ LIGHT' : '☾ DARK'}
        </button>
        <button
          onClick={onResetDemo}
          style={{ padding: '5px 10px', fontSize: 11, color: 'var(--fg-muted)' }}
          title="Clear all markets and start fresh as the first person in your group"
        >
          START FRESH
        </button>
      </div>
    </header>
  );
};
