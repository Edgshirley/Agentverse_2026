import React from 'react';
import { Group, Player } from '../shared/types';
import { AppScreen } from '../App';

interface HeaderBarProps {
  group: Group;
  activePlayer: Player;
  marketCount: number;
  activeScreen: AppScreen;
  onNavigateScreen: (screen: AppScreen) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onResetDemo: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  group,
  activePlayer,
  marketCount,
  activeScreen,
  onNavigateScreen,
  theme,
  onToggleTheme,
  onResetDemo,
}) => {
  return (
    <header className="terminal-header">
      {/* Brand + Group Name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="btn-coral pixel-font" style={{ padding: '5px 12px', fontSize: 13 }}>
          ♠ SPREAD
        </span>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{group.name}</span>
      </div>

      {/* Clean 3-Tab Navigation: ASK BOT · LIVE BETS · CHAT */}
      <nav className="nav-pills-group">
        <button
          className={`nav-pill-btn ${activeScreen === 'voice' ? 'active' : ''}`}
          onClick={() => onNavigateScreen('voice')}
        >
          ASK BOT
        </button>
        <button
          className={`nav-pill-btn ${activeScreen === 'table' ? 'active' : ''}`}
          onClick={() => onNavigateScreen('table')}
        >
          LIVE BETS {marketCount > 0 ? `(${marketCount})` : ''}
        </button>
        <button
          className={`nav-pill-btn ${activeScreen === 'chat' ? 'active' : ''}`}
          onClick={() => onNavigateScreen('chat')}
        >
          CHAT
        </button>
      </nav>

      {/* Your SPRD Balance & Theme */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="chip-wallet-badge">
          <span className="pixel-font">{activePlayer.wallet_balance_toks.toLocaleString()}</span>
          <span className="pixel-font" style={{ fontSize: 11, opacity: 0.9 }}>
            SPRD
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
