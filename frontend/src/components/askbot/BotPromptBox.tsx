import React from 'react';
import { Icon } from '../Icon';
import { AskBot } from '../../hooks/useAskBot';

/** One type box: describe a new bet or a strategy; the bot works out which. */
export const BotPromptBox: React.FC<{ bot: AskBot }> = ({ bot }) => {
  const { proposeInput, setProposeInput, askBot, isProcessing, activeMarket } = bot;

  const placeholder = !activeMarket
    ? 'Describe your bet: "pit stops in the F1 race tomorrow"'
    : activeMarket.archetype === 'spread'
      ? 'New bet, or a strategy: "bet 50 on above, sell at 6, stop at 2"'
      : 'New bet, or a strategy: "bet 50 on yes, sell at 70%, stop at 35%"';

  return (
    <form
      className="pastel-card"
      style={{ width: '100%', display: 'flex', gap: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        askBot(proposeInput);
      }}
    >
      <textarea
        id="ask-bot-input"
        rows={2}
        value={proposeInput}
        onChange={(e) => setProposeInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            askBot(proposeInput);
          }
        }}
        placeholder={placeholder}
        aria-label="Ask the bot"
        style={{ flex: 1, padding: '10px 12px', fontSize: 13.5 }}
      />
      <button
        type="submit"
        className="btn-brand pixel-font"
        title="Ask the bot"
        aria-label="Ask the bot"
        disabled={isProcessing || !proposeInput.trim()}
        style={{ padding: '0 14px', fontSize: 12 }}
      >
        {isProcessing ? '...' : <Icon name="arrow-right" size={18} />}
      </button>
    </form>
  );
};
