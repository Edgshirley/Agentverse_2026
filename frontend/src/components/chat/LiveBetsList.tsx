import React from 'react';
import { Market } from '../../shared/types';
import { ActiveMarketBundle } from '../../hooks/useMarketSync';
import { PixelMascot } from '../PixelMascot';
import { AppPanel } from '../../App';

interface LiveBetsListProps {
  activeBundle: ActiveMarketBundle | null;
  allMarkets: Market[];
  onSelectMarket: (marketId: string) => void;
  onOpenPanel: (panel: AppPanel) => void;
  onNewBet: () => void;
}

export const LiveBetsList: React.FC<LiveBetsListProps> = ({
  activeBundle,
  allMarkets,
  onSelectMarket,
  onOpenPanel,
  onNewBet,
}) => {
  return (
    <div className="live-bets-list">
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
        <button className="btn-mint pixel-font" onClick={onNewBet}>
          + NEW BET
        </button>
      </div>

      {allMarkets.length === 0 ? (
        <div className="pastel-card rail-empty">
          <PixelMascot size={36} />
          <span className="pixel-font">NO BETS YET</span>
        </div>
      ) : (
        allMarkets.map((m, idx) => (
          <div
            key={m.id}
            className={`pastel-card bet-row ${m.id === activeBundle?.market.id ? 'mint' : ''}`}
            style={{
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
            onClick={() => {
              onSelectMarket(m.id);
              onOpenPanel('bet');
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
