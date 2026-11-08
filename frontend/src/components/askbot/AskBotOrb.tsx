import React from 'react';
import { Icon } from '../Icon';
import { AskBot } from '../../hooks/useAskBot';
import { PixelMascot } from '../PixelMascot';

export const AskBotOrb: React.FC<{
  bot: AskBot;
  /** First-run "CLICK TO TALK" step: gold accent until the first tap. */
  needsFirstTap?: boolean;
  onFirstTap?: () => void;
}> = ({ bot, needsFirstTap = false, onFirstTap }) => {
  const { orbClass, ptt, intentMode, proposeInput, strategyInput, isProcessing } = bot;

  return (
    <div
      className={`${orbClass} ${needsFirstTap ? 'needs-first-tap' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={ptt.isRecording ? 'Stop and send' : 'Click to talk to the bot'}
      onClick={() => {
        if (needsFirstTap) onFirstTap?.();
        ptt.toggleRecording(intentMode === 'propose' ? proposeInput : strategyInput);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          (e.currentTarget as HTMLElement).click();
        }
      }}
      title={ptt.isRecording ? 'Tap to finish and send' : 'Tap to speak'}
    >
      <div className="orb-ring orb-ring-1" />
      <div className="orb-ring orb-ring-2" />
      <div className="orb-ring orb-ring-3" />
      <div className="orb-core">
        <PixelMascot
          size={48}
          isListening={ptt.isRecording}
          isProcessing={isProcessing}
        />
        <span className="pixel-font" style={{ fontSize: 10 }}>
          {isProcessing && !ptt.isRecording ? (
            '...'
          ) : (
            <Icon name={ptt.isRecording ? 'send' : 'mic'} size={16} />
          )}
        </span>
      </div>
    </div>
  );
};
