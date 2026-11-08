import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from '../Icon';
import { Market, Player } from '../../shared/types';
import { ActiveMarketBundle } from '../../hooks/useMarketSync';
import { AuctionStepCard } from './AuctionStepCard';
import { DepthGraph } from './DepthGraph';
import { MarketActions } from './MarketActions';
import { RaceTrack } from './RaceTrack';
import { deriveMarketView } from './marketView';
import { OutcomePanel } from './OutcomePanel';

interface MarketDetailProps {
  activeBundle: ActiveMarketBundle;
  allMarkets: Market[];
  players: Player[];
  activePlayer: Player;
  serverClockMs: number;
  wallClockMs: number;
  showUnitLadder: boolean;
  onToggleUnitLadder: (show: boolean) => void;
  onSelectMarket: (marketId: string) => void;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
}

export const MarketDetail: React.FC<MarketDetailProps> = ({
  activeBundle,
  allMarkets,
  players,
  activePlayer,
  serverClockMs,
  wallClockMs,
  showUnitLadder,
  onToggleUnitLadder,
  onSelectMarket,
  onDispatch,
}) => {
  const [showAdminDrawer, setShowAdminDrawer] = useState<boolean>(false);
  const [outcomeInput, setOutcomeInput] = useState<string>('');

  const view = useMemo(
    () => deriveMarketView(activeBundle, activePlayer),
    [activeBundle, activePlayer]
  );
  const { market, isSpread, unitLabel, totalPotChip } = view;

  useEffect(() => {
    setOutcomeInput('');
  }, [market.id]);

  // Only the market creator can toggle whether everyone sees the depth graph
  const isMarketCreator = market.proposer_id === activePlayer.id;
  const isGraphVisibleToGroup =
    market.toggles?.public_positions_and_stops !== undefined
      ? Boolean(market.toggles.public_positions_and_stops)
      : showUnitLadder;

  const handleCreatorToggleVisibility = async () => {
    if (!isMarketCreator) return;
    const nextVal = !isGraphVisibleToGroup;
    onToggleUnitLadder(nextVal);
    await onDispatch(`/api/markets/${market.id}/toggles`, {
      playerId: activePlayer.id,
      public_positions_and_stops: nextVal,
    });
  };

  if (isSpread && (market.state === 'width_auction' || market.state === 'quoting')) {
    return (
      <AuctionStepCard
        view={view}
        activePlayer={activePlayer}
        players={players}
        wallClockMs={wallClockMs}
        onDispatch={onDispatch}
      />
    );
  }

  // Countdown for Arbiter markets
  const remainingMs = market.countdown_ends_at
    ? Math.max(0, market.countdown_ends_at - serverClockMs)
    : 0;
  const mins = String(Math.floor(remainingMs / 60000)).padStart(2, '0');
  const secs = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820, margin: '0 auto' }}>
      {/* Clean Header Strip */}
      <div
        className="poker-felt-arena"
        style={{
          padding: '16px 20px',
          gap: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div>
            <div className="pixel-font" style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
              {isSpread
                ? `WINDOW MARKET [${market.L} .. ${market.H}] ${unitLabel.toUpperCase()}`
                : `${market.archetype.toUpperCase()} MARKET`}{' '}
              · POT: {totalPotChip} CHIP
              {market.origin === 'preset' && <span className="source-badge preset">PRESET</span>}
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>
              {market.question.replace(/TOKS/gi, 'CHIP')}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {allMarkets.length > 1 && (
              <select
                value={market.id}
                onChange={(e) => onSelectMarket(e.target.value)}
                style={{ padding: '5px 10px', fontSize: 11.5 }}
              >
                {allMarkets.map((m, i) => (
                  <option key={m.id} value={m.id}>
                    Bet #{i + 1}: {m.question.slice(0, 24)}...
                  </option>
                ))}
              </select>
            )}
            {(isMarketCreator || import.meta.env.DEV) && (
            <button
              style={{ padding: '5px 8px' }}
              onClick={() => setShowAdminDrawer((v) => !v)}
              title="Options"
              aria-label="Options"
              aria-expanded={showAdminDrawer}
            >
              <Icon name="sliders" size={14} />
              <Icon name={showAdminDrawer ? 'chevron-up' : 'chevron-down'} size={14} />
            </button>
            )}
          </div>
        </div>

        {/* Collapsible Agent / Creator Options Drawer (Hidden unless clicked so UI stays uncluttered!) */}
        {showAdminDrawer && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderRadius: 8,
              backgroundColor: 'var(--bg-canvas)',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {isMarketCreator && (
                <button style={{ fontSize: 11 }} onClick={handleCreatorToggleVisibility}>
                  {isGraphVisibleToGroup ? 'HIDE DEPTH GRAPH FOR ALL' : 'SHOW DEPTH GRAPH FOR ALL'}
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {market.route === 'arbiter' && (
                <span className="pixel-font" style={{ fontSize: 10, marginRight: 6 }}>
                  TIMER 00:{mins}:{secs}
                </span>
              )}
              {import.meta.env.DEV && (
                <>
                  <span className="source-badge preset">DEV</span>
                  <input
                    type="number"
                    value={outcomeInput}
                    onChange={(e) => setOutcomeInput(e.target.value)}
                    placeholder="result"
                    style={{ width: 70, padding: '4px 6px', fontSize: 11 }}
                  />
                  <button
                    className="btn-inverted pixel-font"
                    style={{ fontSize: 10, padding: '5px 10px' }}
                    disabled={outcomeInput.trim() === ''}
                    title="Settle by hand (dev only)"
                    onClick={() =>
                      onDispatch(`/api/markets/${market.id}/resolve/settle`, {
                        outcomeX: Number(outcomeInput),
                      })
                    }
                  >
                    <Icon name="flag" size={12} /> SETTLE
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <RaceTrack view={view} players={players} activePlayer={activePlayer} />

        {isGraphVisibleToGroup && (
          <DepthGraph
            view={view}
            players={players}
            activePlayer={activePlayer}
            onDispatch={onDispatch}
          />
        )}

        {(market.state === 'live' || market.state === 'open') && (
          <MarketActions
            view={view}
            activePlayer={activePlayer}
            players={players}
            onDispatch={onDispatch}
          />
        )}

        <OutcomePanel
          market={market}
          proposal={activeBundle.proposal}
          activePlayer={activePlayer}
          serverClockMs={serverClockMs}
          onDispatch={onDispatch}
        />
      </div>
    </div>
  );
};
