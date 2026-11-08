import React from 'react';
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
    intentMode,
    gateError,
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
