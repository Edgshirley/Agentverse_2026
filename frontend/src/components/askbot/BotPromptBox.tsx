import React from 'react';
import { Icon } from '../Icon';
import { AskBot } from '../../hooks/useAskBot';

export const BotPromptBox: React.FC<{ bot: AskBot }> = ({ bot }) => {
  const {
    intentMode,
    proposeInput,
    setProposeInput,
    strategyInput,
    setStrategyInput,
    allMarkets,
    activeMarket,
    betUnitLabel,
    handleSendToBot,
    isProcessing,
  } = bot;

  return (
    <div className="pastel-card" style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 14,
          alignItems: 'center',
        }}
      >
        <span className="preset-label-badge">
          <Icon name="star" size={12} />
        </span>
        {intentMode === 'propose' ? (
          <>
            <button
              className="preset-pill-btn"
              onClick={() =>
                setProposeInput(
                  'I want to make a market for pit stops in the f1 race tomorrow'
                )
              }
            >
              <Icon name="car" size={13} /> F1 pit stops
            </button>
            <button
              className="preset-pill-btn"
              onClick={() => setProposeInput('I bet it will be 24°C tomorrow, 50 CHIP')}
            >
              <Icon name="thermometer" size={13} /> 24°C
            </button>
            <button
              className="preset-pill-btn"
              onClick={() =>
                setProposeInput(
                  'Internal company bet: Q4 team performance ranking, boss inputs answer after countdown, 40 CHIP'
                )
              }
            >
              <Icon name="building" size={13} /> Company
            </button>
            {allMarkets.length > 0 && (
              <button
                className="preset-pill-btn"
                onClick={() =>
                  setProposeInput(
                    `Stacked bet: Will "${allMarkets[0].question}" hit 26? 30 CHIP`
                  )
                }
              >
                <Icon name="link" size={13} /> Stack
              </button>
            )}
          </>
        ) : (
          <>
            <button
              className="preset-pill-btn"
              onClick={() =>
                setStrategyInput(
                  `Bet 50 CHIP on ${
                    activeMarket?.archetype === 'spread' ? 'ABOVE' : 'YES'
                  }, sell at ${
                    betUnitLabel === 'pit stops' ? '6' : '27'
                  } ${betUnitLabel}, stop me out if it drops to ${
                    betUnitLabel === 'pit stops' ? '2' : '21'
                  } ${betUnitLabel}`
                )
              }
            >
              <Icon name="zap" size={13} /> Full plan
            </button>
            <button
              className="preset-pill-btn"
              onClick={() => setStrategyInput('Put 100 CHIP in right now with no stops')}
            >
              <Icon name="shield" size={13} /> No stops
            </button>
          </>
        )}
      </div>

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
              ? 'Describe your bet...'
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
