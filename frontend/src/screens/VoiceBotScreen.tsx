import React from 'react';
import { AskBotOptions, useAskBot } from '../hooks/useAskBot';
import { AskBotOrb } from '../components/askbot/AskBotOrb';
import { BotPromptBox } from '../components/askbot/BotPromptBox';
import { DraftCard } from '../components/askbot/DraftCard';
import { RiskGateCard } from '../components/askbot/RiskGateCard';
import { PixelMascot } from '../components/PixelMascot';

export const VoiceBotScreen: React.FC<AskBotOptions> = (props) => {
  const bot = useAskBot(props);
  const {
    activeMarket,
    allMarkets,
    intentMode,
    setIntentMode,
    gateError,
    setGateError,
    chatHandoffBanner,
    setChatHandoffBanner,
    draft,
    classification,
    showRiskGateCard,
  } = bot;

  return (
    <div className="voice-home-layout">
      <AskBotOrb bot={bot} />

      {/* Tuxedo Cat Handoff Banner when a message was brought over from CHAT */}
      {chatHandoffBanner && (
        <div
          className="pastel-card gold"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '12px 16px',
          }}
        >
          <PixelMascot size={42} showExclamation={true} />
          <div style={{ flex: 1 }}>
            <div className="pixel-font" style={{ fontSize: 11, marginBottom: 2 }}>
              TUXEDO CAT DEALER · BROUGHT FROM GROUP CHAT
            </div>
            <div style={{ fontSize: 12.5 }}>
              &ldquo;Hey! I&apos;ve put your message from the chat (
              <strong>{chatHandoffBanner}</strong>) right here on the main page so we can make the
              bet!&rdquo;
            </div>
          </div>
          <button
            onClick={() => setChatHandoffBanner(null)}
            style={{ padding: '2px 8px', fontSize: 11 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Mode Switcher Pills */}
      {allMarkets.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            className={intentMode === 'propose' ? 'btn-brand' : ''}
            onClick={() => {
              setIntentMode('propose');
              setGateError(null);
            }}
          >
            + CREATE NEW BET
          </button>
          <button
            className={intentMode === 'strategy' ? 'btn-mint' : ''}
            onClick={() => {
              setIntentMode('strategy');
              setGateError(null);
            }}
          >
            ENTER BET &amp; SET STRATEGY ({activeMarket?.question.slice(0, 28)}...)
          </button>
        </div>
      )}

      <BotPromptBox bot={bot} />

      {gateError && (
        <div className="pastel-card coral" style={{ width: '100%', fontWeight: 700 }}>
          {gateError}
        </div>
      )}

      {intentMode === 'propose' && draft && classification && <DraftCard bot={bot} />}

      {intentMode === 'strategy' && showRiskGateCard && activeMarket && <RiskGateCard bot={bot} />}
    </div>
  );
};
