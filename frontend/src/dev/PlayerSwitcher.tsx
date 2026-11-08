import React from 'react';
import { Icon } from '../components/Icon';
import { Player } from '../shared/types';

interface PlayerSwitcherProps {
  players: Player[];
  activePlayerId: string;
  onChange: (playerId: string) => void;
}

/** Dev-only control for acting as any player in the group. */
export const PlayerSwitcher: React.FC<PlayerSwitcherProps> = ({
  players,
  activePlayerId,
  onChange,
}) => (
  <label className="icon-label dev-player-switcher" title="Playing as (dev only)">
    <Icon name="user" size={14} />
    <select
      value={activePlayerId}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Playing as"
    >
      {players.map((p) => (
        <option key={p.id} value={p.id}>
          {p.nickname}
        </option>
      ))}
    </select>
  </label>
);
