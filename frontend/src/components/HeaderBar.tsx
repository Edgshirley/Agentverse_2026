import React from 'react';
import { Icon } from './Icon';
import { Player } from '../shared/types';
import { CatAvatarId, PixelCatAvatar, PixelMascot } from './PixelMascot';

interface HeaderBarProps {
  activePlayer: Player;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  playerSwitcher?: React.ReactNode;
  username?: string;
  onLogout?: () => void;
  selectedAvatar: CatAvatarId;
  displayName: string;
  showProfileExclamation: boolean;
  onOpenProfile: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  activePlayer,
  theme,
  onToggleTheme,
  playerSwitcher,
  username,
  onLogout,
  selectedAvatar,
  displayName,
  showProfileExclamation,
  onOpenProfile,
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

      {/* Your CHIP Balance, Theme & Cat Profile Button */}
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

        {/* Cat Profile Button (replaces START FRESH) with First-Startup [!] Badge */}
        <button
          type="button"
          onClick={onOpenProfile}
          className="profile-header-btn"
          title="Profile and how the game works"
          aria-label="Profile and how the game works"
        >
          {showProfileExclamation && (
            <span
              className="pixel-exclamation-badge pixel-font"
              title="Set up your profile & check how the game works!"
            >
              !
            </span>
          )}
          <PixelCatAvatar variant={selectedAvatar} size={22} />
          <span
            className="pixel-font"
            style={{
              fontSize: 10.5,
              maxWidth: 135,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName}
          </span>
        </button>
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
