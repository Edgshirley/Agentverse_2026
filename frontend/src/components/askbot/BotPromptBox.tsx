import React from 'react';
import { Icon } from '../Icon';
import { AskBot } from '../../hooks/useAskBot';

const PRESET_BETS = [
  { label: 'F1 pit stops', icon: 'car', text: 'How many pit stops will the F1 race winner make, 25 chips' },
  { label: 'Temperature', icon: 'thermometer', text: 'I bet it will be 24°C tomorrow, 50 chips' },
  { label: 'Company', icon: 'building', text: 'Internal company bet: Q4 team ranking, boss decides, 40 chips' },
] as const;

export const BotPromptBox: React.FC<{ bot: AskBot }> = ({ bot }) => {
  const {
    intentMode,
    proposeInput,
    setProposeInput,
    strategyInput,
    setStrategyInput,
    handleSendToBot,
    isProcessing,
  } = bot;

  return (
    <div className="pastel-card" style={{ width: '100%' }}>
      {import.meta.env.DEV && intentMode === 'propose' && (
        <div className="preset-row">
          <span className="preset-label-badge" title="Dev only. Keyword rules, no AI call.">
            PRESET
          </span>
          {PRESET_BETS.map((preset) => (
            <button
              key={preset.label}
              className="preset-pill-btn"
              disabled={isProcessing}
              onClick={() => {
                setProposeInput(preset.text);
                handleSendToBot('propose', preset.text, true);
              }}
            >
              <Icon name={preset.icon} size={13} /> {preset.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <textarea
          id="ask-bot-input"
          rows={2}
          value={intentMode === 'propose' ? proposeInput : strategyInput}
          onChange={(e) =>
            intentMode === 'propose'
              ? setProposeInput(e.target.value)
              : setStrategyInput(e.target.value)
          }
          placeholder={
            intentMode === 'propose'
              ? 'Describe a bet, e.g. minutes to the first pit stop today, spread 10'
              : 'Strategy, sell level, stop level...'
          }
          style={{ flex: 1, padding: '10px 12px', fontSize: 13.5 }}
        />
        <button
          className={intentMode === 'propose' ? 'btn-brand pixel-font' : 'btn-mint pixel-font'}
          onClick={() => handleSendToBot()}
          title="Ask the bot"
          aria-label="Ask the bot"
          disabled={isProcessing}
          style={{ padding: '0 14px', fontSize: 12 }}
        >
          {isProcessing ? '...' : <Icon name="arrow-right" size={18} />}
        </button>
      </div>
    </div>
  );
};
