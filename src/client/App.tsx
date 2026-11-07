import React, { useState } from 'react';
import { useMarketSync } from './hooks/useMarketSync';
import { HeaderBar } from './components/HeaderBar';
import { TradingControls } from './components/TradingControls';
import { ExhibitA_PlayerRing } from './exhibits/ExhibitA_PlayerRing';
import { ExhibitB_Swimlanes } from './exhibits/ExhibitB_Swimlanes';

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

  if (loading || !data || !data.activeBundle) {
    return (
      <div className="citadel-shell" data-theme={theme} style={{ padding: 24 }}>
        00 │ INITIALIZING CITADEL POKER TERMINAL // CONNECTING TO EDGE ENGINE...
      </div>
    );
  }

  const { group, players, markets, activeBundle } = data;
  const { market, positions, orders, p2pBids, widthBids, swimlanes, liveEvents, mmEscrowToks } =
    activeBundle;

  return (
    <div className="citadel-shell" data-theme={theme}>
      <HeaderBar
        group={group}
        players={players}
        activePlayerId={activePlayerId}
        onSelectPlayer={setActivePlayerId}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onOpenStrategySheet={() => {}}
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
            {m.question.slice(0, 46)}
            {m.question.length > 46 ? '...' : ''}
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
          <TradingControls
            market={market}
            activePlayerId={activePlayerId}
            positions={positions}
            p2pBids={p2pBids}
            orders={orders}
            widthBids={widthBids}
            onDispatch={dispatchAction}
          />
        </div>

        <div className="terminal-col">
          <ExhibitB_Swimlanes players={players} swimlanes={swimlanes} />
        </div>
      </main>
    </div>
  );
};
