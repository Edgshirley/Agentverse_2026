import React from 'react';
import { Market } from '../../shared/types';
import { ActiveMarketBundle } from '../../hooks/useMarketSync';
import { PixelMascot } from '../PixelMascot';
import { AppScreen } from '../../App';

interface LiveBetsListProps {
  activeBundle: ActiveMarketBundle | null;
  allMarkets: Market[];
  onSelectMarket: (marketId: string) => void;
  onNavigateScreen: (screen: AppScreen) => void;
}

export const LiveBetsList: React.FC<LiveBetsListProps> = ({
  activeBundle,
  allMarkets,
  onSelectMarket,
  onNavigateScreen,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span className="pixel-font" style={{ fontSize: 12 }}>
          YOUR GROUP&apos;S BETS ({allMarkets.length})
        </span>
        <button className="btn-mint pixel-font" onClick={() => onNavigateScreen('voice')}>
          + NEW BET
        </button>
      </div>

      {allMarkets.length === 0 ? (
        <div className="pastel-card" style={{ textAlign: 'center', padding: 28 }}>
          <div style={{ marginBottom: 10 }}>
            <PixelMascot size={46} />
          </div>
          <div className="pixel-font" style={{ marginBottom: 8 }}>
            NO BETS CREATED YET
          </div>
          <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14 }}>
            Type a bet idea in Chat or ask the Tuxedo Cat Bot on the Main Page!
          </p>
          <button className="btn-brand pixel-font" onClick={() => onNavigateScreen('voice')}>
            ASK BOT TO CREATE BET
          </button>
        </div>
      ) : (
        allMarkets.map((m, idx) => (
          <div
            key={m.id}
            className={`pastel-card ${m.id === activeBundle?.market.id ? 'mint' : ''}`}
            style={{
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
            onClick={() => {
              onSelectMarket(m.id);
              onNavigateScreen('table');
            }}
          >
            <div>
              <div className="pixel-font" style={{ fontSize: 10, opacity: 0.75 }}>
                BET #{idx + 1} · {m.archetype === 'spread' ? 'LINEAR WINDOW' : m.archetype.toUpperCase()} ·{' '}
                {m.state.toUpperCase()}
              </div>
              <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>
                {m.question.replace(/TOKS/gi, 'CHIP')}
              </div>
            </div>
            <button className="btn-inverted pixel-font" style={{ fontSize: 10 }}>
              OPEN BET -&gt;
            </button>
          </div>
        ))
      )}
    </div>
  );
};
