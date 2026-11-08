import React, { useState } from 'react';
import { Icon } from '../Icon';
import { Market } from '../../shared/types';
import { ActiveMarketBundle } from '../../hooks/useMarketSync';
import { PixelMascot } from '../PixelMascot';
import { AppPanel } from '../../App';
import { isAwaitingResult, isFinished, marketStatusLine, useNow } from '../../utils/marketTime';

interface LiveBetsListProps {
  activeBundle: ActiveMarketBundle | null;
  allMarkets: Market[];
  onSelectMarket: (marketId: string) => void;
  onOpenPanel: (panel: AppPanel) => void;
}

// Hiding is per person (this browser): it never removes a bet for anyone else.
const HIDDEN_KEY = 'marketmate.hiddenMarkets.v1';
function loadHidden(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(HIDDEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
function saveHidden(ids: Set<string>) {
  try {
    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...ids]));
  } catch {
    // storage blocked: hiding lasts until reload
  }
}

export const LiveBetsList: React.FC<LiveBetsListProps> = ({
  activeBundle,
  allMarkets,
  onSelectMarket,
  onOpenPanel,
}) => {
  const now = useNow(30_000);
  const [hidden, setHidden] = useState<Set<string>>(() => loadHidden());
  const [showFinished, setShowFinished] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const toggleHidden = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveHidden(next);
      return next;
    });

  const visible = allMarkets.filter((m) => !hidden.has(m.id));
  // Waiting for a result first, then soonest to close, then no close time
  const open = visible
    .filter((m) => !isFinished(m))
    .sort((a, b) => {
      const due = Number(isAwaitingResult(b, now)) - Number(isAwaitingResult(a, now));
      if (due) return due;
      return (a.closes_at_wall_ms ?? Infinity) - (b.closes_at_wall_ms ?? Infinity);
    });
  const finished = visible
    .filter(isFinished)
    .sort((a, b) => (b.settled_at_wall_ms ?? 0) - (a.settled_at_wall_ms ?? 0));
  const hiddenMarkets = allMarkets.filter((m) => hidden.has(m.id));

  const row = (m: Market, isHiddenRow = false) => {
    const due = isAwaitingResult(m, now);
    return (
      <div
        key={m.id}
        className={`pastel-card bet-row ${m.id === activeBundle?.market.id ? 'mint' : ''} ${
          due ? 'bet-row--due' : ''
        } ${isFinished(m) ? 'bet-row--done' : ''}`}
        onClick={() => {
          onSelectMarket(m.id);
          onOpenPanel('bet');
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="pixel-font" style={{ fontSize: 10, opacity: 0.75 }}>
            {m.archetype === 'spread' ? 'WINDOW' : 'YES / NO'} · {marketStatusLine(m, now).toUpperCase()}
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>
            {m.question.replace(/TOKS/gi, 'CHIP')}
          </div>
        </div>
        <button
          className="bet-row__hide"
          title={isHiddenRow ? 'Show this bet again' : 'Hide this bet (just for you)'}
          aria-label={isHiddenRow ? 'Show this bet again' : 'Hide this bet'}
          onClick={(e) => {
            e.stopPropagation();
            toggleHidden(m.id);
          }}
        >
          <Icon name={isHiddenRow ? 'undo' : 'close'} size={12} />
        </button>
        <button className="btn-inverted" title="Open bet" aria-label="Open bet">
          <Icon name="arrow-right" size={14} />
        </button>
      </div>
    );
  };

  return (
    <div className="live-bets-list">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="pixel-font icon-label" style={{ fontSize: 12 }} title="Open bets">
          <Icon name="chart" />
          {open.length}
        </span>
      </div>

      {open.length === 0 && (
        <div className="pastel-card rail-empty">
          <PixelMascot size={36} />
          <span className="pixel-font">NO OPEN BETS</span>
        </div>
      )}
      {open.map((m) => row(m))}

      {finished.length > 0 && (
        <button className="bets-section-toggle pixel-font" onClick={() => setShowFinished((v) => !v)}>
          <Icon name={showFinished ? 'chevron-up' : 'chevron-down'} size={12} />
          FINISHED ({finished.length})
        </button>
      )}
      {showFinished && finished.map((m) => row(m))}

      {hiddenMarkets.length > 0 && (
        <button className="bets-section-toggle pixel-font" onClick={() => setShowHidden((v) => !v)}>
          <Icon name={showHidden ? 'chevron-up' : 'chevron-down'} size={12} />
          HIDDEN ({hiddenMarkets.length})
        </button>
      )}
      {showHidden && hiddenMarkets.map((m) => row(m, true))}
    </div>
  );
};
