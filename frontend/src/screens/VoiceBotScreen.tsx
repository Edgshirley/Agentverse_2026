import React, { useState, useEffect } from 'react';
import {
  ClassifyMarketProposal,
  DraftMarketProposal,
  Market,
  ParseRuleProposal,
  PayoffMode,
  Player,
} from '../shared/types';
import { usePushToTalk } from '../hooks/usePushToTalk';
import { PixelMascot } from '../components/PixelMascot';
import { AppScreen } from '../App';

interface VoiceBotScreenProps {
  activeMarket: Market | null;
  allMarkets: Market[];
  activePlayer: Player;
  forwardedChatPrompt: string | null;
  onClearForwardedChatPrompt: () => void;
  showUnitLadder: boolean;
  onToggleUnitLadder: (show: boolean) => void;
  onSelectMarket: (marketId: string) => void;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
  onNavigateScreen: (screen: AppScreen) => void;
}

export const VoiceBotScreen: React.FC<VoiceBotScreenProps> = ({
  activeMarket,
  allMarkets,
  activePlayer,
  forwardedChatPrompt,
  onClearForwardedChatPrompt,
  showUnitLadder,
  onToggleUnitLadder,
  onSelectMarket,
  onDispatch,
  onNavigateScreen,
}) => {
  const [intentMode, setIntentMode] = useState<'propose' | 'strategy'>(
    allMarkets.length === 0 || forwardedChatPrompt ? 'propose' : 'strategy'
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [chatHandoffBanner, setChatHandoffBanner] = useState<string | null>(null);

  // Market Creation (Agent 1 Intake -> Agent 2 Classifier)
  const [proposeInput, setProposeInput] = useState<string>(
    'I want to make a market for pit stops in the f1 race tomorrow'
  );
  const [draft, setDraft] = useState<DraftMarketProposal | null>(null);
  const [classification, setClassification] = useState<ClassifyMarketProposal | null>(null);

  // In-House Rules for Linear / Window (Spread) Markets & Creator Visibility Option
  const [inHousePayoffMode, setInHousePayoffMode] = useState<PayoffMode>('linear');
  const [inHouseCapC, setInHouseCapC] = useState<string>('3');
  const [inHouseLotStake, setInHouseLotStake] = useState<string>('25');
  const [inHouseUnit, setInHouseUnit] = useState<string>('pit stops');
  const [creatorShowPositionsToAll, setCreatorShowPositionsToAll] = useState<boolean>(true);

  // Custom Arbiter & Stacked Options
  const [arbiterName, setArbiterName] = useState<string>('BOSS');
  const [countdownMins, setCountdownMins] = useState<string>('15');
  const [parentMarketId, setParentMarketId] = useState<string>(activeMarket?.id ?? '');

  // Strategy & Mandatory Risk Gate (in terms of the unit being bet)
  const [strategyInput, setStrategyInput] = useState<string>(
    'Bet 50 SPRD on ABOVE, sell at 6 pit stops, stop me out if it drops to 2 pit stops'
  );
  const [parsedRule, setParsedRule] = useState<ParseRuleProposal | null>(null);
  const [showRiskGateCard, setShowRiskGateCard] = useState<boolean>(false);
  const [summaryField, setSummaryField] = useState<string>('');
  const [stakeField, setStakeField] = useState<string>('50');
  const [sideField, setSideField] = useState<string>('OVER');
  const [tpField, setTpField] = useState<string>('');
  const [floorField, setFloorField] = useState<string>('');

  const betUnitLabel =
    activeMarket?.unit && activeMarket.unit !== 'binary' && activeMarket.unit !== '%'
      ? activeMarket.unit
      : 'units';

  // When a bet message is forwarded from the CHAT tab, show the Tuxedo Cat banner and auto-classify it!
  useEffect(() => {
    if (forwardedChatPrompt) {
      setIntentMode('propose');
      setProposeInput(forwardedChatPrompt);
      setChatHandoffBanner(forwardedChatPrompt);
      onClearForwardedChatPrompt();
      handleSendToBot('propose', forwardedChatPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forwardedChatPrompt]);

  useEffect(() => {
    if (allMarkets.length === 0 && !forwardedChatPrompt) {
      setIntentMode('propose');
    }
  }, [allMarkets.length, forwardedChatPrompt]);

  useEffect(() => {
    if (activeMarket) {
      setSideField(activeMarket.archetype === 'spread' ? 'OVER' : 'YES');
      if (!parentMarketId) {
        setParentMarketId(activeMarket.id);
      }
    }
  }, [activeMarket, parentMarketId]);

  const ptt = usePushToTalk((transcript) => {
    if (intentMode === 'propose') {
      setProposeInput(transcript);
      handleSendToBot('propose', transcript);
    } else {
      setStrategyInput(transcript);
      handleSendToBot('strategy', transcript);
    }
  });

  const handleSendToBot = async (
    modeOverride?: 'propose' | 'strategy',
    textOverride?: string
  ) => {
    const mode = modeOverride ?? intentMode;
    setGateError(null);
    setIsProcessing(true);

    try {
      const rawText = textOverride ?? (mode === 'propose' ? proposeInput : strategyInput);

      if (mode === 'propose') {
        const res = await onDispatch('/api/agents/intake', {
          prompt: rawText,
          playerId: activePlayer.id,
        });
        const d: DraftMarketProposal = res.draft;
        const c: ClassifyMarketProposal = res.classification;
        setDraft(d);
        setClassification(c);
        setInHousePayoffMode(c.archetype === 'spread' ? 'linear' : d.payoff_mode || 'pot');
        setInHouseLotStake(String(d.lot_stake_k || 25));
        setInHouseUnit(
          d.unit && d.unit !== '%'
            ? d.unit
            : /pit|f1|race/i.test(rawText)
              ? 'pit stops'
              : /°c|deg|temp/i.test(rawText)
                ? '°C'
                : /min|goal|score/i.test(rawText)
                  ? 'min'
                  : 'units'
        );
      } else {
        if (!activeMarket) {
          setIntentMode('propose');
          return;
        }
        // Only the creator of the market can enable/disable everyone's positions & stops
        if (
          activeMarket.proposer_id === activePlayer.id &&
          /show.*(position|stop|everyone|ladder|graph)/i.test(rawText)
        ) {
          onToggleUnitLadder(true);
        }

        const res = await onDispatch('/api/agents/parse-strategy', {
          marketId: activeMarket.id,
          transcript: rawText,
          modality: 'voice',
          playerId: activePlayer.id,
        });
        const prop: ParseRuleProposal = res.proposal;
        setParsedRule(prop);
        setSummaryField((prop.parsed_strategy_summary || '').replace(/TOKS/g, 'SPRD'));
        setStakeField(String(prop.stake_toks || 50));
        setSideField(prop.side);
        setTpField(prop.take_profit_level != null ? String(prop.take_profit_level) : '');
        setFloorField(prop.min_balance_floor != null ? String(prop.min_balance_floor) : '');
        setShowRiskGateCard(true);
      }
    } catch (err: any) {
      setGateError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmLaunchMarket = async () => {
    if (!draft || !classification) return;
    setGateError(null);
    setIsProcessing(true);
    try {
      const q = draft.question;
      const finalUnit =
        inHouseUnit.trim() ||
        (/pit|f1/i.test(q)
          ? 'pit stops'
          : /°c|deg/i.test(q)
            ? '°C'
            : /min|goal/i.test(q)
              ? 'min'
              : draft.unit);

      const finalBounds: [number, number] =
        finalUnit === 'pit stops'
          ? [0, 12]
          : finalUnit === '°C'
            ? [15, 32]
            : finalUnit === 'min'
              ? [0, 95]
              : draft.bounds;

      // Apply the Market Creator's visibility choice globally & on the market object
      onToggleUnitLadder(creatorShowPositionsToAll);

      const res = await onDispatch('/api/markets', {
        proposer_id: activePlayer.id,
        archetype: classification.archetype,
        question: draft.question.replace(/TOKS/gi, 'SPRD'),
        unit: finalUnit,
        bounds: finalBounds,
        no_event_value: draft.no_event_value,
        criteria: draft.criteria,
        resolution_source: draft.resolution_source,
        payoff_mode: classification.archetype === 'spread' ? inHousePayoffMode : draft.payoff_mode,
        lot_stake_k: Number(inHouseLotStake) || draft.lot_stake_k || 25,
        cap_widths_c: Number(inHouseCapC) || 3,
        verifiability: classification.verifiability,
        route: classification.route,
        arbiter_id: classification.route === 'arbiter' ? arbiterName.trim() || 'boss' : null,
        countdown_ends_at:
          classification.route === 'arbiter'
            ? Date.now() + Number(countdownMins || 15) * 60 * 1000
            : null,
        parent_market_id:
          classification.archetype === 'stacked'
            ? draft.parent_market_id || parentMarketId || allMarkets[0]?.id || null
            : null,
        parent_metric:
          classification.archetype === 'stacked' ? draft.parent_metric || 'odds' : null,
        parent_trigger_target:
          classification.archetype === 'stacked' ? draft.parent_trigger_target ?? 75 : null,
        live_implied_value:
          finalUnit === 'pit stops' ? 4 : finalUnit === '°C' ? 24 : 50,
        toggles: {
          max_lots: 3,
          forced_trading: false,
          hidden_takes: false,
          single_mm_requote: true,
          live_reopen_halftime: false,
          public_positions_and_stops: creatorShowPositionsToAll,
        },
      });

      const createdMarket: Market | undefined = res?.market;
      if (createdMarket?.id) {
        onSelectMarket(createdMarket.id);
      }
      setDraft(null);
      setClassification(null);
      setChatHandoffBanner(null);

      // If this is a Linear Window (Spread) market, go straight to LIVE BETS so friends can bid
      // on the Window Width [L, H], the Window Winner selects the window, and players bet Above & Below!
      if (createdMarket?.archetype === 'spread') {
        onNavigateScreen('table');
        return;
      }

      // Otherwise for a Simple/Stacked market, flow into the 3-Part Strategy & Risk Tolerance Confirmation Card
      setIntentMode('strategy');
      const isDeg = createdMarket?.unit === '°C';
      setSummaryField(`YES ${createdMarket?.lot_stake_k ?? 50} SPRD`);
      setStakeField(String(createdMarket?.lot_stake_k ?? 50));
      setSideField('YES');
      setTpField(isDeg ? '27' : '70');
      setFloorField(isDeg ? '21' : '35');
      setShowRiskGateCard(true);
    } catch (err: any) {
      setGateError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmStrategyAndRisk = async () => {
    if (!activeMarket) return;
    setGateError(null);
    if (
      summaryField.trim() === '' ||
      tpField.trim() === '' ||
      Number.isNaN(Number(tpField)) ||
      floorField.trim() === '' ||
      Number.isNaN(Number(floorField))
    ) {
      setGateError(
        'Hard condition: please confirm (1) Strategy, (2) When to Sell level, and (3) Risk Tolerance (Stop level).'
      );
      return;
    }

    setIsProcessing(true);
    try {
      if (activeMarket.archetype === 'spread' && activeMarket.state === 'width_auction') {
        const defaultW = activeMarket.unit === 'pit stops' ? 2 : 8;
        const defaultL = activeMarket.unit === 'pit stops' ? 3 : 35;
        await onDispatch(`/api/markets/${activeMarket.id}/auction/bid`, {
          playerId: 'house_mm',
          width: defaultW,
        });
        await onDispatch(`/api/markets/${activeMarket.id}/auction/finalize`, {});
        await onDispatch(`/api/markets/${activeMarket.id}/auction/quote`, {
          playerId: 'house_mm',
          L: defaultL,
        });
      }

      await onDispatch(`/api/markets/${activeMarket.id}/strategy/activate`, {
        player_id: activePlayer.id,
        input_modality: 'voice',
        raw_transcript: strategyInput,
        parsed_strategy_summary: summaryField.trim(),
        side: sideField,
        stake_toks: Number(stakeField),
        entry_trigger_level: parsedRule?.entry_trigger_level ?? null,
        take_profit_level: Number(tpField),
        min_balance_floor: Number(floorField),
        confirmed_at: Date.now(),
      });
      setShowRiskGateCard(false);
      onNavigateScreen('table');
    } catch (err: any) {
      setGateError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const orbClass = ptt.isRecording
    ? 'orb-stage listening'
    : isProcessing
      ? 'orb-stage processing'
      : 'orb-stage';

  return (
    <div className="voice-home-layout">
      {/* Center Pulsing Orb with 8-Bit Tuxedo Cat Mascot */}
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
            {ptt.isRecording ? 'LISTENING' : isProcessing ? '...' : 'SPEAK'}
          </span>
        </div>
      </div>

      {/* Tuxedo Cat Handoff Banner when a message was brought over from CHAT */}
      {chatHandoffBanner && (
        <div
          className="pastel-card gold"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '12px 16px',
          }}
        >
          <PixelMascot size={42} showExclamation={true} />
          <div style={{ flex: 1 }}>
            <div className="pixel-font" style={{ fontSize: 11, marginBottom: 2 }}>
              TUXEDO CAT DEALER · BROUGHT FROM GROUP CHAT
            </div>
            <div style={{ fontSize: 12.5 }}>
              &ldquo;Hey! I&apos;ve put your message from the chat (
              <strong>{chatHandoffBanner}</strong>) right here on the main page so we can make the
              bet!&rdquo;
            </div>
          </div>
          <button
            onClick={() => setChatHandoffBanner(null)}
            style={{ padding: '2px 8px', fontSize: 11 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Mode Switcher Pills */}
      {allMarkets.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            className={intentMode === 'propose' ? 'btn-coral' : ''}
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

      {/* Clean Prompt Box with High-Visibility Presets */}
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
                onClick={() => setProposeInput('I bet it will be 24°C tomorrow, 50 SPRD')}
              >
                🌡️ 24°C Tomorrow
              </button>
              <button
                className="preset-pill-btn"
                onClick={() =>
                  setProposeInput(
                    'Internal company bet: Q4 team performance ranking, boss inputs answer after countdown, 40 SPRD'
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
                      `Stacked bet: Will "${allMarkets[0].question}" hit 26? 30 SPRD`
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
                    `Bet 50 SPRD on ${
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
                onClick={() => setStrategyInput('Put 100 SPRD in right now with no stops')}
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
            className={intentMode === 'propose' ? 'btn-coral pixel-font' : 'btn-mint pixel-font'}
            onClick={() => handleSendToBot()}
            disabled={isProcessing}
            style={{ padding: '0 22px', fontSize: 12 }}
          >
            {isProcessing ? '...' : 'GO ->'}
          </button>
        </div>
      </div>

      {gateError && (
        <div className="pastel-card coral" style={{ width: '100%', fontWeight: 700 }}>
          {gateError}
        </div>
      )}

      {/* STEP 1 CARD: Agent 1 (Intake) -> Agent 2 (Classifier) + In-House Rules & Creator Visibility */}
      {intentMode === 'propose' && draft && classification && (
        <div className="pastel-card coral" style={{ width: '100%' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <PixelMascot size={36} />
              <span className="pixel-font" style={{ fontSize: 12 }}>
                {classification.archetype === 'spread'
                  ? 'AHA! LINEAR WINDOW MARKET [L, H] IDENTIFIED'
                  : 'AGENT 1 & 2 CLASSIFIED YOUR BET'}
              </span>
            </div>
            <span className="badge-outline">
              {classification.archetype === 'spread'
                ? 'LINEAR WINDOW [L, H]'
                : classification.archetype.toUpperCase()}{' '}
              ·{' '}
              {classification.route === 'arbiter' ? 'CUSTOM (3RD-PARTY ARBITER)' : 'AUTO-VERIFIABLE'}
            </span>
          </div>

          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
            &ldquo;{draft.question.replace(/TOKS/gi, 'SPRD')}&rdquo;
          </div>

          {/* If Linear / Window Spread Market: Ask In-House Rules (What happens when MM wins, Cap, Unit) */}
          {classification.archetype === 'spread' && (
            <div
              className="pastel-card"
              style={{ marginBottom: 14, padding: '14px 16px', color: 'var(--fg-primary)' }}
            >
              <div className="pixel-font" style={{ fontSize: 11, marginBottom: 6, color: 'var(--pastel-gold-text)' }}>
                IN-HOUSE WINDOW RULES (HOW THIS LINEAR WINDOW MARKET WORKS)
              </div>
              <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 12 }}>
                1) Friends bid for how narrow of a window width <strong>W ({inHouseUnit})</strong>{' '}
                they can quote. 2) The window winner (Market Maker) picks the exact window{' '}
                <strong>[L, H]</strong>. 3) Everyone else bets <strong>ABOVE (&gt; H)</strong> or{' '}
                <strong>BELOW (&lt; L)</strong>!
              </p>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                  gap: 12,
                }}
              >
                <div>
                  <label style={{ fontSize: 11.5, display: 'block', marginBottom: 4 }}>
                    <strong>What happens when Market Maker wins (inside [L, H])?</strong>
                  </label>
                  <select
                    value={inHousePayoffMode}
                    onChange={(e) => setInHousePayoffMode(e.target.value as PayoffMode)}
                    style={{ width: '100%', padding: '6px 8px', fontWeight: 700 }}
                  >
                    <option value="linear">
                      Linear Window: MM wins stakes inside [L, H]; pays per {inHouseUnit} outside
                    </option>
                    <option value="pot">
                      Pot Sweep: MM wins the entire pot if outcome lands inside [L, H]
                    </option>
                    <option value="binary">
                      Fixed 1:1: MM wins 1x stake inside [L, H]; pays 1x outside
                    </option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 11.5, display: 'block', marginBottom: 4 }}>
                    <strong>Max Payout Cap Outside Window (C widths):</strong>
                  </label>
                  <select
                    value={inHouseCapC}
                    onChange={(e) => setInHouseCapC(e.target.value)}
                    style={{ width: '100%', padding: '6px 8px', fontWeight: 700 }}
                  >
                    <option value="2">2x Window Widths Cap</option>
                    <option value="3">3x Window Widths Cap (Standard)</option>
                    <option value="5">5x Window Widths Cap (High Volatility)</option>
                  </select>
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11.5, display: 'block', marginBottom: 4 }}>
                      <strong>Stake / Lot (SPRD):</strong>
                    </label>
                    <input
                      type="number"
                      value={inHouseLotStake}
                      onChange={(e) => setInHouseLotStake(e.target.value)}
                      style={{ width: '100%', padding: '5px 8px', fontWeight: 700 }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11.5, display: 'block', marginBottom: 4 }}>
                      <strong>Window Unit:</strong>
                    </label>
                    <input
                      type="text"
                      value={inHouseUnit}
                      onChange={(e) => setInHouseUnit(e.target.value)}
                      style={{ width: '100%', padding: '5px 8px', fontWeight: 700 }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* If Custom Unverifiable: 3rd-Party Arbiter (e.g. Boss) + Countdown */}
          {classification.route === 'arbiter' && (
            <div
              className="pastel-card"
              style={{ marginBottom: 14, padding: '12px 14px', color: 'var(--fg-primary)' }}
            >
              <div className="pixel-font" style={{ fontSize: 11, marginBottom: 8 }}>
                CUSTOM BET: ASSIGN 3RD-PARTY ARBITER &amp; COUNTDOWN
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ fontSize: 12 }}>
                  3rd-Party Arbiter (e.g. Boss):{' '}
                  <input
                    type="text"
                    value={arbiterName}
                    onChange={(e) => setArbiterName(e.target.value)}
                    style={{ width: 120, padding: '4px 8px', fontWeight: 700 }}
                  />
                </label>
                <label style={{ fontSize: 12 }}>
                  Countdown to Close All Bets (mins):{' '}
                  <input
                    type="number"
                    value={countdownMins}
                    onChange={(e) => setCountdownMins(e.target.value)}
                    style={{ width: 75, padding: '4px 8px', fontWeight: 700 }}
                  />
                </label>
              </div>
            </div>
          )}

          {/* If Stacked Market: Choose Parent Market */}
          {classification.archetype === 'stacked' && allMarkets.length > 0 && (
            <div className="pastel-card" style={{ marginBottom: 14, padding: '12px 14px' }}>
              <div className="pixel-font" style={{ fontSize: 11, marginBottom: 6 }}>
                STACKED ON PARENT MARKET:
              </div>
              <select
                value={parentMarketId}
                onChange={(e) => setParentMarketId(e.target.value)}
                style={{ padding: '6px 10px', width: '100%' }}
              >
                {allMarkets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.question}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* MARKET CREATOR ONLY SETTING: Whether everyone in the market can see everyone's positions & stop losses */}
          <div
            className="pastel-card sky"
            style={{
              marginBottom: 14,
              padding: '10px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div>
              <div className="pixel-font" style={{ fontSize: 10.5 }}>
                MARKET CREATOR RULE ({activePlayer.nickname} ONLY)
              </div>
              <div style={{ fontSize: 12 }}>
                Should everyone who joins this market be able to see all players&apos; positions &amp;
                stop-losses on the vertical unit graph?
              </div>
            </div>
            <button
              type="button"
              className={creatorShowPositionsToAll ? 'btn-mint pixel-font' : 'btn-coral pixel-font'}
              style={{ fontSize: 10.5 }}
              onClick={() => setCreatorShowPositionsToAll((v) => !v)}
            >
              {creatorShowPositionsToAll
                ? '✓ EVERYONE CAN SEE POSITIONS & STOPS'
                : '✗ HIDDEN FOR EVERYONE'}
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              onClick={() => {
                setDraft(null);
                setClassification(null);
              }}
            >
              CANCEL
            </button>
            <button className="btn-inverted pixel-font" onClick={handleConfirmLaunchMarket}>
              {classification.archetype === 'spread'
                ? 'START WINDOW BIDDING WITH FRIENDS ->'
                : 'CREATE BET & SET MY RISK LIMITS ->'}
            </button>
          </div>
        </div>
      )}

      {/* STEP 2 CARD: Mandatory Strategy & Risk-Tolerance Confirmation (Measured in Bet Units) */}
      {intentMode === 'strategy' && showRiskGateCard && activeMarket && (
        <div className="pastel-card" style={{ width: '100%' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <span className="pixel-font" style={{ fontSize: 12 }}>
              CONFIRM STRATEGY &amp; RISK TOLERANCE
            </span>
            <span className="badge-outline">HARD CONDITION</span>
          </div>

          <div style={{ fontSize: 13, marginBottom: 14 }}>
            Bet: <strong>{activeMarket.question}</strong> (Unit: <strong>{betUnitLabel}</strong>)
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            {/* 1. Strategy & Stake */}
            <div className="pastel-card mint" style={{ padding: 12 }}>
              <div className="pixel-font" style={{ fontSize: 10, marginBottom: 6 }}>
                1. YOUR STRATEGY
              </div>
              <input
                type="text"
                value={summaryField}
                onChange={(e) => setSummaryField(e.target.value)}
                placeholder="e.g. OVER 50 SPRD"
                style={{ width: '100%', padding: '5px 8px', marginBottom: 8, fontWeight: 700 }}
              />
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                <select
                  value={sideField}
                  onChange={(e) => setSideField(e.target.value)}
                  style={{ padding: '4px 6px', fontWeight: 700 }}
                >
                  {activeMarket.archetype === 'spread' ? (
                    <>
                      <option value="OVER">ABOVE (OVER)</option>
                      <option value="UNDER">BELOW (UNDER)</option>
                    </>
                  ) : (
                    <>
                      <option value="YES">YES</option>
                      <option value="NO">NO</option>
                    </>
                  )}
                </select>
                <input
                  type="number"
                  value={stakeField}
                  onChange={(e) => setStakeField(e.target.value)}
                  style={{ width: 75, padding: '4px 6px', fontWeight: 700 }}
                />
                <span>SPRD</span>
              </div>
            </div>

            {/* 2. When to Sell (in Bet Units) */}
            <div className="pastel-card sky" style={{ padding: 12 }}>
              <div className="pixel-font" style={{ fontSize: 10, marginBottom: 6 }}>
                2. SELL / TAKE-PROFIT LEVEL ({betUnitLabel}) *
              </div>
              <input
                type="number"
                value={tpField}
                onChange={(e) => setTpField(e.target.value)}
                placeholder={`Required (${betUnitLabel})`}
                style={{ width: '100%', padding: '6px 8px', fontWeight: 700 }}
              />
              <div style={{ fontSize: 11, marginTop: 6 }}>
                {tpField.trim() === ''
                  ? `Required: at what ${betUnitLabel} level do you sell?`
                  : `Auto-sells when ${betUnitLabel} hits ${tpField}`}
              </div>
            </div>

            {/* 3. Risk Tolerance / Stop-Loss Level (in Bet Units) */}
            <div className="pastel-card coral" style={{ padding: 12 }}>
              <div className="pixel-font" style={{ fontSize: 10, marginBottom: 6 }}>
                3. STOP-LOSS / RISK LEVEL ({betUnitLabel}) *
              </div>
              <input
                type="number"
                value={floorField}
                onChange={(e) => setFloorField(e.target.value)}
                placeholder={`Required (${betUnitLabel})`}
                style={{ width: '100%', padding: '6px 8px', fontWeight: 700 }}
              />
              <div style={{ fontSize: 11, marginTop: 6 }}>
                {floorField.trim() === ''
                  ? `Required: at what ${betUnitLabel} level does stop hit?`
                  : `Stop-loss hits if ${betUnitLabel} reaches ${floorField}`}
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <button onClick={() => setShowRiskGateCard(false)}>CANCEL</button>
            <button className="btn-inverted pixel-font" onClick={handleConfirmStrategyAndRisk}>
              ✓ CONFIRM &amp; OPEN LIVE BET -&gt;
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
