import React, { useState } from 'react';
import { Group, Player } from '../shared/types';

interface HeaderBarProps {
  group: Group;
  players: Player[];
  activePlayerId: string;
  onSelectPlayer: (id: string) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenStrategySheet: (mode: 'create' | 'strategy') => void;
  onStepReplay?: () => void;
  onResetDemo: () => void;
  onJoinPlayer: (nickname: string) => Promise<void>;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  group,
  players,
  activePlayerId,
  onSelectPlayer,
  theme,
  onToggleTheme,
  onOpenStrategySheet,
  onStepReplay,
  onResetDemo,
  onJoinPlayer,
}) => {
  const [newNick, setNewNick] = useState('');
  const [showInviteInput, setShowInviteInput] = useState(false);

  const activePlayer = players.find((p) => p.id === activePlayerId) ?? players[0];

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNick.trim()) return;
    await onJoinPlayer(newNick.trim());
    setNewNick('');
    setShowInviteInput(false);
  };

  return (
    <header className="terminal-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span className="badge-inverted">SPREAD // v2026.11</span>
        <span style={{ fontWeight: 700 }}>{group.name}</span>
        <span style={{ color: 'var(--fg-muted)' }}>
          INVITE:[<strong style={{ color: 'var(--fg-primary)' }}>{group.invite_code}</strong>]
        </span>
        {showInviteInput ? (
          <form onSubmit={handleJoin} style={{ display: 'inline-flex', gap: 4 }}>
            <input
              type="text"
              placeholder="NICKNAME..."
              value={newNick}
              onChange={(e) => setNewNick(e.target.value)}
              style={{ padding: '2px 6px', width: 110 }}
            />
            <button type="submit">JOIN</button>
          </form>
        ) : (
          <button onClick={() => setShowInviteInput(true)} style={{ padding: '2px 6px' }}>
            + JOIN GROUP
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: 'var(--fg-muted)' }}>TRADER:</span>
          {players.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelectPlayer(p.id)}
              className={p.id === activePlayerId ? 'btn-inverted' : ''}
              style={{ padding: '2px 7px', fontSize: 11 }}
            >
              {p.nickname}
            </button>
          ))}
        </div>

        {activePlayer && (
          <div
            style={{
              border: '1px solid var(--border-strong)',
              padding: '2px 8px',
              display: 'flex',
              gap: 10,
            }}
          >
            <span>
              WALLET: <strong>{activePlayer.wallet_balance_toks.toLocaleString()} TOKS</strong>
            </span>
            <span style={{ color: 'var(--fg-muted)' }}>|</span>
            <span>
              ESCROW: <strong>{activePlayer.escrow_balance_toks.toLocaleString()} TOKS</strong>
            </span>
          </div>
        )}

        <button className="btn-inverted" onClick={() => onOpenStrategySheet('create')}>
          + PROPOSE MARKET [VOICE / AI]
        </button>
        <button onClick={() => onOpenStrategySheet('strategy')}>
          AI STRATEGY SHEET [FR-04 GATE]
        </button>
        {onStepReplay && (
          <button onClick={onStepReplay} title="Advance deterministic match replay">
            ▶ STEP MATCH FEED
          </button>
        )}
        <button onClick={onToggleTheme}>
          THEME: {theme === 'dark' ? '#000000 LIVE' : '#FAFAFA SHEET'}
        </button>
        <button onClick={onResetDemo} style={{ color: 'var(--fg-muted)' }}>
          RESET DEMO
        </button>
      </div>
    </header>
  );
};
