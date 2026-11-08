import React from 'react';
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
          {intentMode === 'propose' ? '★ QUICK BET PRESETS:' : '★ STRATEGY PRESETS:'}
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
              🏎️ F1 Pit Stops Window Market
            </button>
            <button
              className="preset-pill-btn"
              onClick={() => setProposeInput('I bet it will be 24°C tomorrow, 50 CHIP')}
            >
              🌡️ 24°C Tomorrow
            </button>
            <button
              className="preset-pill-btn"
              onClick={() =>
                setProposeInput(
                  'Internal company bet: Q4 team performance ranking, boss inputs answer after countdown, 40 CHIP'
                )
              }
            >
              🏢 Custom Company Bet (Boss Arbiter)
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
                🔗 Stack on Current Bet
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
              ⚡ Full Strategy + Sell &amp; Stop ({betUnitLabel})
            </button>
            <button
              className="preset-pill-btn"
              onClick={() => setStrategyInput('Put 100 CHIP in right now with no stops')}
            >
              🛡️ Test Missing Risk Tolerance Gate
            </button>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <textarea
          rows={2}
          value={intentMode === 'propose' ? proposeInput : strategyInput}
          onChange={(e) =>
            intentMode === 'propose'
              ? setProposeInput(e.target.value)
              : setStrategyInput(e.target.value)
          }
          placeholder={
            intentMode === 'propose'
              ? 'Tell the Tuxedo Cat Bot your bet (e.g. "I want to make a market for pit stops in the f1 race tomorrow")...'
              : 'Tell the bot your strategy, when to sell, and your stop level in bet units...'
          }
          style={{ flex: 1, padding: '10px 12px', fontSize: 13.5 }}
        />
        <button
          className={intentMode === 'propose' ? 'btn-brand pixel-font' : 'btn-mint pixel-font'}
          onClick={() => handleSendToBot()}
          disabled={isProcessing}
          style={{ padding: '0 22px', fontSize: 12 }}
        >
          {isProcessing ? '...' : 'GO ->'}
        </button>
      </div>
    </div>
  );
};
