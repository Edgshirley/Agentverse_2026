import React from 'react';
import { Icon } from '../Icon';
import { AskBot } from '../../hooks/useAskBot';
import { PixelMascot } from '../PixelMascot';

export const AskBotOrb: React.FC<{ bot: AskBot }> = ({ bot }) => {
  const { orbClass, ptt, intentMode, proposeInput, strategyInput, isProcessing } = bot;

  return (
    <div
      className={orbClass}
      onClick={() =>
        ptt.toggleRecording(intentMode === 'propose' ? proposeInput : strategyInput)
      }
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
