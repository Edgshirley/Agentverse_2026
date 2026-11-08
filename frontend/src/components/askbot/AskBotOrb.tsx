import React from 'react';
import { Icon } from '../Icon';
import { AskBot } from '../../hooks/useAskBot';
import { PixelMascot } from '../PixelMascot';

export const AskBotOrb: React.FC<{ bot: AskBot }> = ({ bot }) => {
  const { orbClass, ptt, intentMode, proposeInput, strategyInput, isProcessing } = bot;

  return (
    <div
      className={orbClass}
      onMouseDown={ptt.startRecording}
      onMouseUp={() =>
        ptt.stopRecording(intentMode === 'propose' ? proposeInput : strategyInput)
      }
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
          {isProcessing && !ptt.isRecording ? '...' : <Icon name="mic" size={16} />}
        </span>
      </div>
    </div>
  );
};
