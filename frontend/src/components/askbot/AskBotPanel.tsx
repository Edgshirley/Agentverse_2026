import React from 'react';
import { AskBotOptions, useAskBot } from '../../hooks/useAskBot';
import { AskBotOrb } from './AskBotOrb';
import { BotPromptBox } from './BotPromptBox';
import { DraftCard } from './DraftCard';
import { RiskGateCard } from './RiskGateCard';

export const AskBotPanel: React.FC<AskBotOptions> = (props) => {
  const bot = useAskBot(props);
  const {
    activeMarket,
    allMarkets,
    intentMode,
    setIntentMode,
    gateError,
    setGateError,
    draft,
    classification,
    showRiskGateCard,
  } = bot;

  return (
    <div className="ask-bot-panel">
      <AskBotOrb bot={bot} />

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
