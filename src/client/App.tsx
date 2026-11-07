import React, { useState } from 'react';
import { useMarketSync } from './hooks/useMarketSync';
import { HeaderBar } from './components/HeaderBar';
import { TradingControls } from './components/TradingControls';
import { StrategySheetModal } from './components/StrategySheetModal';
import { ArbiterPanel } from './components/ArbiterPanel';
import { ExhibitA_PlayerRing } from './exhibits/ExhibitA_PlayerRing';
import { ExhibitB_Swimlanes } from './exhibits/ExhibitB_Swimlanes';
import { ExhibitB_SwingTree } from './exhibits/ExhibitB_SwingTree';
import { ExhibitC_TelemetryCard } from './exhibits/ExhibitC_TelemetryCard';
import { ExhibitD_WireTrace } from './exhibits/ExhibitD_WireTrace';

export const App: React.FC = () => {
  const {
    data,
    loading,
    errorBanner,
    setErrorBanner,
    selectedMarketId,
    setSelectedMarketId,
    activePlayerId,
    setActivePlayerId,
    dispatchAction,
  } = useMarketSync();

  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [strategyModalTab, setStrategyModalTab] = useState<'create' | 'strategy' | null>(null);

  if (loading || !data || !data.activeBundle) {
    return (
      <div className="citadel-shell" data-theme={theme} style={{ padding: 24 }}>
        00 │ INITIALIZING CITADEL POKER TERMINAL // CONNECTING TO EDGE ENGINE...
      </div>
    );
  }

  const { group, players, markets, activeBundle, serverClockMs } = data;
  const {
    market,
    positions,
    orders,
    p2pBids,
    widthBids,
    swimlanes,
    wireTrace,
    swingTree,
    swingRiskLabel,
    mandates,
    liveEvents,
    mmEscrowToks,
  } = activeBundle;

  const activePlayer = players.find((p) => p.id === activePlayerId) ?? players[0];

  return (
    <div className="citadel-shell" data-theme={theme}>
      <HeaderBar
        group={group}
        players={players}
        activePlayerId={activePlayerId}
        onSelectPlayer={setActivePlayerId}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onOpenStrategySheet={(mode) => setStrategyModalTab(mode)}
        onStepReplay={() => dispatchAction(`/api/markets/${market.id}/replay/step`, {})}
        onResetDemo={() => dispatchAction('/api/demo/reset', {})}
        onJoinPlayer={async (nickname) => {
          const res = await dispatchAction('/api/groups/join', { nickname });
          if (res?.player?.id) {
            setActivePlayerId(res.player.id);
          }
        }}
      />

      {/* Market Selector Tabs */}
      <nav className="market-tabs-bar">
        <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>ACTIVE MARKETS:</span>
        {markets.map((m, idx) => (
          <div
            key={m.id}
            className={`market-tab ${m.id === selectedMarketId ? 'active' : ''}`}
            onClick={() => setSelectedMarketId(m.id)}
          >
            M{idx + 1} [{m.archetype.toUpperCase()} / {m.state.toUpperCase()}] ::{' '}
            {m.question.slice(0, 48)}
            {m.question.length > 48 ? '...' : ''}
          </div>
        ))}
      </nav>

      {errorBanner && (
        <div
          style={{
            margin: '8px 14px 0',
            padding: '6px 12px',
            border: '1px solid var(--border-strong)',
            backgroundColor: 'var(--bg-elevated)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>ENGINE GUARDRAIL // {errorBanner}</span>
          <button onClick={() => setErrorBanner(null)}>DISMISS</button>
        </div>
      )}

      <main className="terminal-grid">
        {/* Left Column: Exhibit A (Radial Ring), Arbiter/Stacked Panel, 1-Tap Controls, Exhibit B (Swimlanes) */}
        <div className="terminal-col">
          <ExhibitA_PlayerRing
            market={market}
            players={players}
            positions={positions}
            mmEscrowToks={mmEscrowToks}
            liveEvents={liveEvents}
            selectedPlayerId={activePlayerId}
            onSelectPlayer={setActivePlayerId}
          />

          <ArbiterPanel
            market={market}
            allMarkets={markets}
            activePlayerId={activePlayerId}
            players={players}
            serverClockMs={serverClockMs}
            onDispatch={dispatchAction}
            onSelectMarket={setSelectedMarketId}
          />

          <TradingControls
            market={market}
            activePlayerId={activePlayerId}
            positions={positions}
            p2pBids={p2pBids}
            orders={orders}
            widthBids={widthBids}
            onDispatch={dispatchAction}
          />

          <ExhibitB_Swimlanes players={players} swimlanes={swimlanes} />
        </div>

        {/* Right Column: Exhibit C (Telemetry Card), Exhibit B Bottom (Swing Tree), Exhibit D (Wire Trace) */}
        <div className="terminal-col">
          <ExhibitC_TelemetryCard
            market={market}
            selectedPlayer={activePlayer}
            positions={positions}
            orders={orders}
            mandates={mandates}
            mmEscrowToks={mmEscrowToks}
            swingRiskLabel={swingRiskLabel}
          />

          <ExhibitB_SwingTree
            swingTree={swingTree}
            orders={orders}
            p2pBids={p2pBids}
            players={players}
          />

          <ExhibitD_WireTrace
            wireTrace={wireTrace}
            onToggleFeedDelay={() =>
              dispatchAction(`/api/markets/${market.id}/replay/feed-delayed`, {})
            }
          />
        </div>
      </main>

      {strategyModalTab && (
        <StrategySheetModal
          initialTab={strategyModalTab}
          activeMarket={market}
          allMarkets={markets}
          activePlayer={activePlayer}
          players={players}
          onClose={() => setStrategyModalTab(null)}
          onDispatch={dispatchAction}
          onSelectMarket={setSelectedMarketId}
        />
      )}
    </div>
  );
};
