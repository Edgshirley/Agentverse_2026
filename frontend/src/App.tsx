import React, { useState } from 'react';
import { useMarketSync } from './hooks/useMarketSync';
import { HeaderBar } from './components/HeaderBar';
import { VoiceBotScreen } from './screens/VoiceBotScreen';
import {
  GroupChatScreen,
  LocalChatMessage,
  MascotWidgetAlert,
} from './screens/GroupChatScreen';
import { MarketTableScreen } from './screens/MarketTableScreen';
import { PixelJokerCard, PixelPokerChip } from './components/PixelMascot';
import { sfx } from './utils/soundEffects';

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
    authStatus,
    authUser,
    refreshAuth,
    login,
    logout,
  } = useMarketSync();

  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [activeScreen, setActiveScreen] = useState<AppScreen>('voice');
  const [showUnitLadder, setShowUnitLadder] = useState<boolean>(true);

  // Persistent Chat State across tabs + Chat-to-Main-Page Mascot Handoff
  const [chatMessages, setChatMessages] = useState<LocalChatMessage[]>([]);
  const [chatMascotAlert, setChatMascotAlert] = useState<MascotWidgetAlert | null>(null);
  const [forwardedChatPrompt, setForwardedChatPrompt] = useState<string | null>(null);

  if (authStatus === 'anonymous') {
    return (
      <div className="citadel-shell" data-theme={theme} style={{ padding: 40, textAlign: 'center' }}>
        <div className="pastel-card" style={{ maxWidth: 420, margin: '80px auto', padding: 28 }}>
          <div className="pixel-font" style={{ fontSize: 18, marginBottom: 12 }}>
            ♠ SPREAD
          </div>
          <p style={{ marginBottom: 20 }}>Log in to take a seat at your group's table.</p>
          <button className="btn-coral pixel-font" onClick={login} style={{ padding: '10px 18px' }}>
            LOG IN
          </button>
        </div>
      </div>
    );
  }

  if (authStatus === 'checking' || loading || !data) {
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

  const handleDispatchWithSound = async (path: string, body?: Record<string, any>) => {
    const res = await dispatchAction(path, body);
    if (
      path.includes('/take') ||
      path.includes('/orders') ||
      path.includes('/auction') ||
      path.includes('/settle') ||
      path.includes('/withdraw') ||
      path.includes('/strategy/activate')
    ) {
      sfx.playBetConfirm();
    }
    return res;
  };

  return (
    <div
      className="citadel-shell"
      data-theme={theme}
      onClickCapture={(e) => {
        const target = e.target as HTMLElement | null;
        if (target && target.closest('button, .depth-center-pill')) {
          sfx.playUiClick();
        }
      }}
    >
      {/* Subtle Gently-Floating 8-Bit Playing Cards, Joker Card & Centered SPRD Poker Chips */}
      <div className="bg-betting-decor" aria-hidden="true">
        <div
          className="floating-card-bg"
          style={{ top: '12%', left: '4%', transform: 'rotate(-8deg)', animationDelay: '0s' }}
        >
          <span>A</span>
          <span style={{ alignSelf: 'center', fontSize: 18 }}>♠</span>
          <span style={{ alignSelf: 'flex-end' }}>A</span>
        </div>

        {/* 8-Bit Pixel Joker Card */}
        <PixelJokerCard
          style={{ top: '16%', right: '5%', transform: 'rotate(9deg)', animationDelay: '1.2s' }}
        />

        <div
          className="floating-card-bg"
          style={{
            bottom: '14%',
            left: '6%',
            transform: 'rotate(6deg)',
            color: '#e58585',
            animationDelay: '2.4s',
          }}
        >
          <span>Q</span>
          <span style={{ alignSelf: 'center', fontSize: 18 }}>♦</span>
          <span style={{ alignSelf: 'flex-end' }}>Q</span>
        </div>

        <PixelJokerCard
          style={{
            bottom: '18%',
            right: '6%',
            transform: 'rotate(-10deg)',
            animationDelay: '3.1s',
          }}
        />

        {/* Centered 8-Bit SPRD Poker Chips */}
        <PixelPokerChip
          amount="100"
          style={{ top: '48%', left: '3%', animationDelay: '0.7s' }}
        />
        <PixelPokerChip
          amount="25"
          style={{ top: '62%', right: '4%', animationDelay: '1.9s' }}
        />
      </div>

      <HeaderBar
        group={group}
        activePlayer={activePlayer}
        marketCount={markets.length}
        activeScreen={activeScreen}
        onNavigateScreen={setActiveScreen}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        username={authUser?.username}
        onLogout={authStatus === 'authenticated' ? logout : undefined}
        onResetDemo={async () => {
          await dispatchAction('/api/demo/reset', {});
          // The reset empties the ring: re-seat the logged-in player
          if (authStatus === 'authenticated') await refreshAuth();
          setChatMessages([]);
          setChatMascotAlert(null);
          setForwardedChatPrompt(null);
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
            forwardedChatPrompt={forwardedChatPrompt}
            onClearForwardedChatPrompt={() => setForwardedChatPrompt(null)}
            showUnitLadder={showUnitLadder}
            onToggleUnitLadder={setShowUnitLadder}
            onSelectMarket={setSelectedMarketId}
            onDispatch={handleDispatchWithSound}
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
            onDispatch={handleDispatchWithSound}
            onNavigateScreen={setActiveScreen}
          />
        )}

        {activeScreen === 'chat' && (
          <GroupChatScreen
            activeBundle={activeBundle}
            allMarkets={markets}
            activePlayer={activePlayer}
            chatMessages={chatMessages}
            setChatMessages={setChatMessages}
            mascotAlert={chatMascotAlert}
            setMascotAlert={setChatMascotAlert}
            onForwardChatPromptToMainPage={setForwardedChatPrompt}
            onSelectMarket={setSelectedMarketId}
            onDispatch={handleDispatchWithSound}
            onNavigateScreen={setActiveScreen}
          />
        )}
      </main>
    </div>
  );
};
