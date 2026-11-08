import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useMarketSync } from './hooks/useMarketSync';
import { useActivePlayerId } from './hooks/useActivePlayerId';
import { PlayerSwitcher } from './dev/PlayerSwitcher';
import { HeaderBar } from './components/HeaderBar';
import { ProfileModal, generateThemedGamerName } from './components/ProfileModal';
import { AskBotPanel } from './components/askbot/AskBotPanel';
import { ChatFeed } from './components/chat/ChatFeed';
import { LiveBetsList } from './components/chat/LiveBetsList';
import { BetDrawer } from './components/market/BetDrawer';
import { MarketDetail } from './components/market/MarketDetail';
import { OutsideOddsPanel } from './components/market/OutsideOddsPanel';
import {
  CAT_AVATAR_OPTIONS,
  CatAvatarId,
  PixelJokerCard,
  PixelMascot,
  PixelPokerChip,
} from './components/PixelMascot';
import { Icon, IconName } from './components/Icon';
import { sfx } from './utils/soundEffects';

// The dev-only simulator; Vite strips this import from production builds.
const SimConsole = import.meta.env.DEV ? React.lazy(() => import('./dev/SimConsole')) : null;
const isSimRoute = import.meta.env.DEV && window.location.pathname === '/sim';

export type AppPanel = 'askbot' | 'bet' | 'chat';
type MobilePane = 'chat' | 'bets' | 'bot';

const MOBILE_TABS: { pane: MobilePane; label: string; icon: IconName }[] = [
  { pane: 'chat', label: 'Chat', icon: 'message' },
  { pane: 'bets', label: 'Live bets', icon: 'chart' },
  { pane: 'bot', label: 'Ask bot', icon: 'mic' },
];

interface StoredProfile {
  avatar: CatAvatarId;
  customName: string;
  defaultName: string;
  onboarded: boolean;
}

const PROFILE_STORAGE_KEY = 'spread.profile.v1';

function loadStoredProfile(): StoredProfile {
  const fallback: StoredProfile = {
    avatar: 'bowtie',
    customName: '',
    defaultName: generateThemedGamerName(),
    onboarded: false,
  };
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredProfile>;
    return {
      avatar: CAT_AVATAR_OPTIONS.some((c) => c.id === parsed.avatar)
        ? (parsed.avatar as CatAvatarId)
        : fallback.avatar,
      customName: typeof parsed.customName === 'string' ? parsed.customName : '',
      defaultName: parsed.defaultName || fallback.defaultName,
      onboarded: parsed.onboarded === true,
    };
  } catch {
    return fallback;
  }
}

function saveStoredProfile(profile: StoredProfile): void {
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Private mode / blocked storage: profile just won't persist across reloads.
  }
}

export const App: React.FC = () => {
  const {
    data,
    loading,
    errorBanner,
    setErrorBanner,
    setSelectedMarketId,
    refresh,
    dispatchAction,
    authStatus,
    authUser,
    refreshAuth,
    login,
    logout,
  } = useMarketSync();
  const [activePlayerId, setActivePlayerId] = useActivePlayerId(authUser?.player_id);

  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [showUnitLadder, setShowUnitLadder] = useState<boolean>(true);
  const [mobilePane, setMobilePane] = useState<MobilePane>('chat');
  const [betDrawerOpen, setBetDrawerOpen] = useState<boolean>(false);
  const [newBetRequest, setNewBetRequest] = useState<number>(0);

  // Player Profile State: 6 Cat Avatars + Custom or Auto-Generated Themed Gamer Name.
  // Saved in this browser's localStorage for now (see TEAM_TASKS.md: move to the server profile later).
  const [savedProfile] = useState<StoredProfile>(() => loadStoredProfile());
  const [selectedAvatar, setSelectedAvatar] = useState<CatAvatarId>(savedProfile.avatar);
  const [customName, setCustomName] = useState<string>(savedProfile.customName);
  const [defaultGeneratedName, setDefaultGeneratedName] = useState<string>(
    savedProfile.defaultName
  );
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);

  // First-time startup onboarding exclamation mark (appears on Profile button & How the Game Works button;
  // both disappear once the user clicks out of / closes the Profile modal, and stay gone on later visits)
  const [showProfileOnboardingBadge, setShowProfileOnboardingBadge] = useState<boolean>(
    !savedProfile.onboarded
  );

  useEffect(() => {
    saveStoredProfile({
      avatar: selectedAvatar,
      customName,
      defaultName: defaultGeneratedName,
      onboarded: !showProfileOnboardingBadge,
    });
  }, [selectedAvatar, customName, defaultGeneratedName, showProfileOnboardingBadge]);

  const [forwardedChatPrompt, setForwardedChatPrompt] = useState<string | null>(null);

  // Behind the gateway every action is bound to the signed-in user, so personas
  // and the simulator only make sense without it.
  const devPlayerTools = import.meta.env.DEV && authStatus === 'disabled';

  // Dev only: keep the personas registered, including after a reset
  const personasMissing =
    devPlayerTools && data != null && !data.players.some((p) => p.id === 'edouard');
  useEffect(() => {
    if (personasMissing) void dispatchAction('/api/dev/personas', {});
  }, [personasMissing, dispatchAction]);

  const closeBetDrawer = useCallback(() => setBetDrawerOpen(false), []);
  const openBetDrawer = useCallback(() => setBetDrawerOpen(true), []);

  const openPanel = useCallback((panel: AppPanel) => {
    if (panel === 'bet') {
      setBetDrawerOpen(true);
      return;
    }
    setBetDrawerOpen(false);
    setMobilePane(panel === 'askbot' ? 'bot' : 'chat');
  }, []);

  const startNewBet = useCallback(() => {
    openPanel('askbot');
    setNewBetRequest((n) => n + 1);
  }, [openPanel]);

  if (authStatus === 'anonymous') {
    return (
      <div className="app-root login-screen" data-theme={theme}>
        <div className="pastel-card login-card">
          <span className="brand-lockup">
            <PixelMascot size={40} />
            <span className="pixel-font brand-wordmark">MarketMate</span>
          </span>
          <p>Log in to take a seat at your group&apos;s table.</p>
          <button className="btn-brand pixel-font" onClick={login}>
            <Icon name="login" size={16} />
            LOG IN
          </button>
        </div>
      </div>
    );
  }

  if (authStatus === 'checking' || loading || !data) {
    return (
      <div className="app-root" data-theme={theme} style={{ padding: 40, textAlign: 'center' }}>
        <span className="pixel-font">LOADING MARKETMATE...</span>
      </div>
    );
  }

  const effectiveDisplayName = customName.trim() || defaultGeneratedName;

  const { group, players, markets, activeBundle, chatMessages, serverClockMs, wallClockMs } = data;
  const rawActivePlayer =
    players.find((p) => p.id === activePlayerId) ??
    players[0] ?? {
      id: 'you',
      group_id: group.id,
      nickname: effectiveDisplayName,
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

  // Personas keep their own names; the profile name is for a real player.
  const activePlayer = devPlayerTools
    ? rawActivePlayer
    : { ...rawActivePlayer, nickname: effectiveDisplayName };

  const playersWithProfileName = devPlayerTools
    ? players
    : players.map((p) =>
        p.id === activePlayer.id ? { ...p, nickname: effectiveDisplayName } : p
      );

  const handleCloseProfile = () => {
    setIsProfileOpen(false);
    setShowProfileOnboardingBadge(false);
  };

  return (
    <div
      className="app-root app-shell"
      data-theme={theme}
      onClickCapture={(e) => {
        const target = e.target as HTMLElement | null;
        if (target && target.closest('button, .depth-center-pill')) {
          sfx.playUiClick();
        }
      }}
    >
      {/* Subtle Gently-Floating 8-Bit Playing Cards, Joker Card & Centered CHIP Poker Chips */}
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
            color: 'var(--accent-neg)',
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

        {/* Centered 8-Bit CHIP Poker Chips */}
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
        activePlayer={activePlayer}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        username={authUser?.username}
        onLogout={authStatus === 'authenticated' ? logout : undefined}
        playerSwitcher={
          devPlayerTools ? (
            <>
              <a
                className="dev-sim-link"
                href={isSimRoute ? '/' : '/sim'}
                title={isSimRoute ? 'Leave simulator' : 'Open simulator (dev only)'}
                aria-label={isSimRoute ? 'Leave simulator' : 'Open simulator'}
              >
                <Icon name={isSimRoute ? 'close' : 'play'} />
              </a>
              <PlayerSwitcher
                players={players}
                activePlayerId={activePlayer.id}
                onChange={setActivePlayerId}
              />
            </>
          ) : null
        }
        selectedAvatar={selectedAvatar}
        displayName={effectiveDisplayName}
        showProfileExclamation={showProfileOnboardingBadge}
        onOpenProfile={() => setIsProfileOpen(true)}
      />

      <ProfileModal
        isOpen={isProfileOpen}
        onClose={handleCloseProfile}
        selectedAvatar={selectedAvatar}
        onSelectAvatar={setSelectedAvatar}
        customName={customName}
        defaultGeneratedName={defaultGeneratedName}
        onChangeCustomName={setCustomName}
        onRollNewDefaultName={() =>
          setDefaultGeneratedName((prev) => generateThemedGamerName(prev))
        }
        showRulesExclamation={showProfileOnboardingBadge}
        onResetDemo={!import.meta.env.DEV ? undefined : async () => {
          await dispatchAction('/api/demo/reset', {});
          // The reset empties the ring: re-seat the logged-in player
          if (authStatus === 'authenticated') await refreshAuth();
          setForwardedChatPrompt(null);
          setBetDrawerOpen(false);
          setMobilePane('chat');
        }}
      />

      {errorBanner && (
        <div
          className="pastel-card coral"
          style={{
            position: 'fixed',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: 820,
            width: '92%',
            padding: '10px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            zIndex: 60,
          }}
        >
          <span>
            <strong>HOLD ON:</strong> {errorBanner.replace(/TOKS/g, 'CHIP')}
          </span>
          <button onClick={() => setErrorBanner(null)} title="Dismiss" aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <main className="app-layout" data-mobile-pane={mobilePane}>
        <section className="app-chat-pane" aria-label="Group chat">
          <ChatFeed
            activePlayer={activePlayer}
            chatMessages={chatMessages}
            players={playersWithProfileName}
            markets={markets}
            onForwardChatPrompt={setForwardedChatPrompt}
            onDispatch={handleDispatchWithSound}
            onOpenPanel={openPanel}
            onOpenMarket={(marketId) => {
              setSelectedMarketId(marketId);
              openPanel('bet');
            }}
          />
        </section>

        <aside className="app-rail">
          <section className="rail-bets" aria-label="Live bets">
            <LiveBetsList
              activeBundle={activeBundle}
              allMarkets={markets}
              onSelectMarket={setSelectedMarketId}
              onOpenPanel={openPanel}
              onNewBet={startNewBet}
            />
            {activeBundle && !['settled', 'void'].includes(activeBundle.market.state) && (
              <OutsideOddsPanel market={activeBundle.market} />
            )}
          </section>
          <section className="rail-bot" aria-label="Ask bot">
            <AskBotPanel
              activeMarket={activeBundle?.market ?? null}
              allMarkets={markets}
              activePlayer={activePlayer}
              forwardedChatPrompt={forwardedChatPrompt}
              onClearForwardedChatPrompt={() => setForwardedChatPrompt(null)}
              showUnitLadder={showUnitLadder}
              onToggleUnitLadder={setShowUnitLadder}
              onSelectMarket={setSelectedMarketId}
              onDispatch={handleDispatchWithSound}
              onOpenPanel={openPanel}
              newBetRequest={newBetRequest}
            />
          </section>
        </aside>
      </main>

      <nav className="mobile-pane-tabs" aria-label="Sections">
        {MOBILE_TABS.map((t) => (
          <button
            key={t.pane}
            className={`nav-pill-btn ${mobilePane === t.pane ? 'active' : ''}`}
            onClick={() => setMobilePane(t.pane)}
            title={t.label}
            aria-label={t.label}
          >
            <Icon name={t.icon} size={20} />
          </button>
        ))}
      </nav>

      {isSimRoute && devPlayerTools && SimConsole && (
        <Suspense fallback={null}>
          <SimConsole
            refresh={refresh}
            onSelectMarket={setSelectedMarketId}
            onOpenBet={openBetDrawer}
            onCloseBet={closeBetDrawer}
            onChoosePlayer={setActivePlayerId}
          />
        </Suspense>
      )}

      {betDrawerOpen && activeBundle && (
        <BetDrawer onClose={closeBetDrawer}>
          <MarketDetail
            activeBundle={activeBundle}
            allMarkets={markets}
            players={playersWithProfileName}
            activePlayer={activePlayer}
            serverClockMs={serverClockMs}
            wallClockMs={wallClockMs}
            showUnitLadder={showUnitLadder}
            onToggleUnitLadder={setShowUnitLadder}
            onSelectMarket={setSelectedMarketId}
            onDispatch={handleDispatchWithSound}
          />
        </BetDrawer>
      )}
    </div>
  );
};
