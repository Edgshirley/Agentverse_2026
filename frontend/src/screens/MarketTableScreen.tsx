import React from 'react';
import { Market, Player } from '../shared/types';
import { ActiveMarketBundle } from '../hooks/useMarketSync';
import { PixelMascot } from '../components/PixelMascot';
import { MarketDetail } from '../components/market/MarketDetail';
import { AppScreen } from '../App';

interface MarketTableScreenProps {
  activeBundle: ActiveMarketBundle | null;
  allMarkets: Market[];
  players: Player[];
  activePlayer: Player;
  serverClockMs: number;
  showUnitLadder: boolean;
  onToggleUnitLadder: (show: boolean) => void;
  onSelectMarket: (marketId: string) => void;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
  onNavigateScreen: (screen: AppScreen) => void;
}

export const MarketTableScreen: React.FC<MarketTableScreenProps> = ({
  activeBundle,
  allMarkets,
  players,
  activePlayer,
  serverClockMs,
  showUnitLadder,
  onToggleUnitLadder,
  onSelectMarket,
  onDispatch,
  onNavigateScreen,
}) => {
  if (!activeBundle) {
    return (
      <div
        className="poker-felt-arena"
        style={{ textAlign: 'center', padding: '56px 24px', alignItems: 'center' }}
      >
        <PixelMascot size={54} />
        <div className="pixel-font" style={{ fontSize: 16 }}>
          NO LIVE BETS YET
        </div>
        <p style={{ maxWidth: 440, color: 'var(--fg-muted)' }}>
          Ask the Tuxedo Cat Bot to create your first bet (e.g. F1 pit stops window market or
          tomorrow&apos;s temperature).
        </p>
        <button className="btn-brand pixel-font" onClick={() => onNavigateScreen('voice')}>
          ASK BOT TO START A BET -&gt;
        </button>
      </div>
    );
  }

  return (
    <MarketDetail
      activeBundle={activeBundle}
      allMarkets={allMarkets}
      players={players}
      activePlayer={activePlayer}
      serverClockMs={serverClockMs}
      showUnitLadder={showUnitLadder}
      onToggleUnitLadder={onToggleUnitLadder}
      onSelectMarket={onSelectMarket}
      onDispatch={onDispatch}
    />
  );
};
