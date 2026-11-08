import React from 'react';
import { Icon } from '../Icon';
import { AskBotOptions, useAskBot } from '../../hooks/useAskBot';
import { AskBotOrb } from './AskBotOrb';
import { BotPromptBox } from './BotPromptBox';
import { DraftCard } from './DraftCard';
import { RiskGateCard } from './RiskGateCard';
import { HintBubble } from '../HintBubble';

interface AskBotPanelProps extends AskBotOptions {
  /** First-run "CLICK TO TALK" bubble (shown after profile setup). */
  showTalkHint?: boolean;
  onTalkHintSeen?: () => void;
}

export const AskBotPanel: React.FC<AskBotPanelProps> = ({
  showTalkHint = false,
  onTalkHintSeen,
  ...props
}) => {
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
      {showTalkHint && !bot.ptt.isRecording && (
        <HintBubble text="CLICK TO TALK" placement="stacked" onClick={onTalkHintSeen} />
      )}
      <AskBotOrb bot={bot} needsFirstTap={showTalkHint} onFirstTap={onTalkHintSeen} />

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
            <Icon name="plus" size={14} />
            NEW
          </button>
          <button
            className={intentMode === 'strategy' ? 'btn-mint' : ''}
            onClick={() => {
              setIntentMode('strategy');
              setGateError(null);
            }}
          >
            <Icon name="target" size={14} />
            STRATEGY
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
