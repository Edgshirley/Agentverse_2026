import React from 'react';
import { Icon } from './Icon';
import { Player } from '../shared/types';
import { PixelMascot } from './PixelMascot';

interface HeaderBarProps {
  activePlayer: Player;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  playerSwitcher?: React.ReactNode;
  onResetDemo?: () => void;
  username?: string;
  onLogout?: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  activePlayer,
  theme,
  onToggleTheme,
  playerSwitcher,
  onResetDemo,
  username,
  onLogout,
}) => {
  return (
    <header className="terminal-header">
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="brand-lockup">
          <PixelMascot size={32} />
          <span className="pixel-font brand-wordmark">MarketMate</span>
        </span>
      </div>

      {/* Your CHIP Balance & Theme */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {playerSwitcher}

        <div className="chip-wallet-badge">
          <Icon name="coins" size={15} />
          <span className="pixel-font">{activePlayer.wallet_balance_toks.toLocaleString()}</span>
          <span className="pixel-font" style={{ fontSize: 11, opacity: 0.9 }}>
            CHIP
          </span>
          {activePlayer.escrow_balance_toks > 0 && (
            <span className="icon-label" style={{ fontSize: 11, opacity: 0.75 }} title="Chips in play">
              <Icon name="lock" size={12} />
              {activePlayer.escrow_balance_toks}
            </span>
          )}
        </div>

        <button
          onClick={onToggleTheme}
          style={{ padding: '6px 8px' }}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        {onResetDemo && (
        <button
          onClick={onResetDemo}
          style={{ padding: '6px 8px', color: 'var(--fg-muted)' }}
          title="Start fresh: clears all bets and chat"
          aria-label="Start fresh"
        >
          <Icon name="reload" />
        </button>
        )}
        {onLogout && (
          <button
            onClick={onLogout}
            style={{ padding: '5px 8px', fontSize: 11 }}
            title={username ? `Log out ${username}` : 'Log out'}
            aria-label={username ? `Log out ${username}` : 'Log out'}
          >
            <Icon name="logout" size={15} />
            {username}
          </button>
        )}
      </div>
    </header>
  );
};
