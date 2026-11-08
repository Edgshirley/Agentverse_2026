import React, { useState } from 'react';
import { useMarketSync } from './hooks/useMarketSync';
import { HeaderBar } from './components/HeaderBar';
import { VoiceBotScreen } from './screens/VoiceBotScreen';
import { GroupChatScreen } from './screens/GroupChatScreen';
import { MarketTableScreen } from './screens/MarketTableScreen';
import { PixelJokerCard } from './components/PixelMascot';

export type AppScreen = 'voice' | 'table' | 'chat';

export const App: React.FC = () => {
  const {
    data,
    loading,
    errorBanner,
    setErrorBanner,
    setSelectedMarketId,
    activePlayerId,
    dispatchAction,
  } = useMarketSync();

  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [activeScreen, setActiveScreen] = useState<AppScreen>('voice');
  const [showUnitLadder, setShowUnitLadder] = useState<boolean>(false);

  if (loading || !data) {
    return (
      <div className="citadel-shell" data-theme={theme} style={{ padding: 40, textAlign: 'center' }}>
        <span className="pixel-font">♠ LOADING SPREAD...</span>
      </div>
    );
  }

  const { group, players, markets, activeBundle, serverClockMs } = data;
  const activePlayer =
    players.find((p) => p.id === activePlayerId) ??
    players[0] ?? {
      id: 'you',
      group_id: group.id,
      nickname: 'YOU',
      is_admin: true,
      wallet_balance_toks: 1000,
      escrow_balance_toks: 0,
    };

  return (
    <div className="citadel-shell" data-theme={theme}>
      {/* Subtle 8-Bit Playing Cards, Joker Card & SPRD Poker Chips Background Motif */}
      <div className="bg-betting-decor" aria-hidden="true">
        <div className="floating-card-bg" style={{ top: '12%', left: '4%', transform: 'rotate(-8deg)' }}>
          <span>A</span>
          <span style={{ alignSelf: 'center', fontSize: 18 }}>♠</span>
          <span style={{ alignSelf: 'flex-end' }}>A</span>
        </div>

        {/* 8-Bit Pixel Joker Card */}
        <PixelJokerCard style={{ top: '16%', right: '5%', transform: 'rotate(9deg)' }} />

        <div
          className="floating-card-bg"
          style={{ bottom: '14%', left: '6%', transform: 'rotate(6deg)', color: '#e58585' }}
        >
          <span>Q</span>
          <span style={{ alignSelf: 'center', fontSize: 18 }}>♦</span>
          <span style={{ alignSelf: 'flex-end' }}>Q</span>
        </div>

        <PixelJokerCard style={{ bottom: '18%', right: '6%', transform: 'rotate(-10deg)' }} />

        <div className="floating-chip-bg" style={{ top: '48%', left: '3%' }}>
          100 SPRD
        </div>
        <div className="floating-chip-bg" style={{ top: '62%', right: '4%' }}>
          25 SPRD
        </div>
      </div>

      <HeaderBar
        group={group}
        activePlayer={activePlayer}
        marketCount={markets.length}
        activeScreen={activeScreen}
        onNavigateScreen={setActiveScreen}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onResetDemo={async () => {
          await dispatchAction('/api/demo/reset', {});
          setActiveScreen('voice');
        }}
      />

      {errorBanner && (
        <div
          className="pastel-card coral"
          style={{
            maxWidth: 820,
            width: '92%',
            margin: '16px auto 0',
            padding: '10px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            zIndex: 2,
          }}
        >
          <span>
            <strong>HOLD ON:</strong> {errorBanner.replace(/TOKS/g, 'SPRD')}
          </span>
          <button onClick={() => setErrorBanner(null)}>OK</button>
        </div>
      )}

      <main className="screen-container">
        {activeScreen === 'voice' && (
          <VoiceBotScreen
            activeMarket={activeBundle?.market ?? null}
            allMarkets={markets}
            activePlayer={activePlayer}
            showUnitLadder={showUnitLadder}
            onToggleUnitLadder={setShowUnitLadder}
            onSelectMarket={setSelectedMarketId}
            onDispatch={dispatchAction}
            onNavigateScreen={setActiveScreen}
          />
        )}

        {activeScreen === 'table' && (
          <MarketTableScreen
            activeBundle={activeBundle}
            allMarkets={markets}
            players={players}
            activePlayer={activePlayer}
            serverClockMs={serverClockMs}
            showUnitLadder={showUnitLadder}
            onToggleUnitLadder={setShowUnitLadder}
            onSelectMarket={setSelectedMarketId}
            onDispatch={dispatchAction}
            onNavigateScreen={setActiveScreen}
          />
        )}

        {activeScreen === 'chat' && (
          <GroupChatScreen
            activeBundle={activeBundle}
            allMarkets={markets}
            activePlayer={activePlayer}
            onSelectMarket={setSelectedMarketId}
            onDispatch={dispatchAction}
            onNavigateScreen={setActiveScreen}
          />
        )}
      </main>
    </div>
  );
};
