import React, { useState, useEffect } from 'react';
import {
  ClassifyMarketProposal,
  DraftMarketProposal,
  Market,
  ParseRuleProposal,
  Player,
} from '../shared/types';
import { usePushToTalk } from '../hooks/usePushToTalk';
import { PixelMascot } from '../components/PixelMascot';
import { AppScreen } from '../App';

interface VoiceBotScreenProps {
  activeMarket: Market | null;
  allMarkets: Market[];
  activePlayer: Player;
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
  showUnitLadder,
  onToggleUnitLadder,
  onSelectMarket,
  onDispatch,
  onNavigateScreen,
}) => {
  const [intentMode, setIntentMode] = useState<'propose' | 'strategy'>(
    allMarkets.length === 0 ? 'propose' : 'strategy'
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  // Market Creation (Agent 1 Intake -> Agent 2 Classifier)
  const [proposeInput, setProposeInput] = useState<string>(
    'I bet it will be 24°C tomorrow, 50 SPRD'
  );
  const [draft, setDraft] = useState<DraftMarketProposal | null>(null);
  const [classification, setClassification] = useState<ClassifyMarketProposal | null>(null);
  const [arbiterName, setArbiterName] = useState<string>('BOSS');
  const [countdownMins, setCountdownMins] = useState<string>('15');
  const [parentMarketId, setParentMarketId] = useState<string>(activeMarket?.id ?? '');

  // Strategy & Mandatory Risk Gate (in terms of the unit being bet)
  const [strategyInput, setStrategyInput] = useState<string>(
    'Bet 100 SPRD on YES, sell at 27°C, stop me out if it drops to 21°C, and show everyone\'s positions and stop losses'
  );
  const [parsedRule, setParsedRule] = useState<ParseRuleProposal | null>(null);
  const [showRiskGateCard, setShowRiskGateCard] = useState<boolean>(false);
  const [summaryField, setSummaryField] = useState<string>('');
  const [stakeField, setStakeField] = useState<string>('100');
  const [sideField, setSideField] = useState<string>('YES');
  const [tpField, setTpField] = useState<string>('');
  const [floorField, setFloorField] = useState<string>('');

  const betUnitLabel = activeMarket?.unit && activeMarket.unit !== 'binary' ? activeMarket.unit : 'units';

  useEffect(() => {
    if (allMarkets.length === 0) {
      setIntentMode('propose');
    }
  }, [allMarkets.length]);

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
      // Check if the user asked the bot to show everyone's positions and stop losses
      if (/show.*(position|stop|everyone|ladder|graph)/i.test(rawText)) {
        onToggleUnitLadder(true);
      }

      if (mode === 'propose') {
        const res = await onDispatch('/api/agents/intake', {
          prompt: rawText,
          playerId: activePlayer.id,
        });
        setDraft(res.draft);
        setClassification(res.classification);
      } else {
        if (!activeMarket) {
          setIntentMode('propose');
          return;
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
        setStakeField(String(prop.stake_toks || 100));
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
      // Detect natural unit from question (e.g. °C, min, rank)
      const q = draft.question;
      const inferredUnit =
        /°c|deg/i.test(q) ? '°C' : /min|goal/i.test(q) ? 'min' : /rank/i.test(q) ? 'rank' : draft.unit;

      const res = await onDispatch('/api/markets', {
        proposer_id: activePlayer.id,
        archetype: classification.archetype,
        question: draft.question.replace(/TOKS/gi, 'SPRD'),
        unit: inferredUnit,
        bounds: inferredUnit === '°C' ? [15, 32] : draft.bounds,
        no_event_value: draft.no_event_value,
        criteria: draft.criteria,
        resolution_source: draft.resolution_source,
        payoff_mode: draft.payoff_mode,
        lot_stake_k: draft.lot_stake_k,
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
        live_implied_value: inferredUnit === '°C' ? 24 : 50,
      });

      const createdMarket: Market | undefined = res?.market;
      if (createdMarket?.id) {
        onSelectMarket(createdMarket.id);
      }
      setDraft(null);
      setClassification(null);

      // Immediately flow into the 3-Part Strategy & Risk Tolerance Confirmation Card
      setIntentMode('strategy');
      const isDeg = createdMarket?.unit === '°C';
      setSummaryField(
        `${createdMarket?.archetype === 'spread' ? 'OVER' : 'YES'} ${createdMarket?.lot_stake_k ?? 50} SPRD`
      );
      setStakeField(String(createdMarket?.lot_stake_k ?? 50));
      setSideField(createdMarket?.archetype === 'spread' ? 'OVER' : 'YES');
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
        await onDispatch(`/api/markets/${activeMarket.id}/auction/bid`, {
          playerId: 'house_mm',
          width: 8,
        });
        await onDispatch(`/api/markets/${activeMarket.id}/auction/finalize`, {});
        await onDispatch(`/api/markets/${activeMarket.id}/auction/quote`, {
          playerId: 'house_mm',
          L: 35,
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
      {/* Center Pulsing Orb with 8-Bit Bull-Dealer Mascot (No Microphone Emoji) */}
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
            size={46}
            isListening={ptt.isRecording}
            isProcessing={isProcessing}
          />
          <span className="pixel-font" style={{ fontSize: 10 }}>
            {ptt.isRecording ? 'LISTENING' : isProcessing ? '...' : 'SPEAK'}
          </span>
        </div>
      </div>

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
            ENTER BET & SET STRATEGY ({activeMarket?.question.slice(0, 28)}...)
          </button>
        </div>
      )}

      {/* Clean Prompt Box */}
      <div className="pastel-card" style={{ width: '100%' }}>
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 12,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="pixel-font" style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
              {intentMode === 'propose' ? 'IDEAS:' : 'PRESETS:'}
            </span>
            {intentMode === 'propose' ? (
              <>
                <button
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() => setProposeInput('I bet it will be 24°C tomorrow, 50 SPRD')}
                >
                  24°C Tomorrow
                </button>
                <button
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() =>
                    setProposeInput(
                      'Internal company bet: Q4 team performance ranking, boss inputs answer after countdown, 40 SPRD'
                    )
                  }
                >
                  Custom Company Bet (Boss Arbiter)
                </button>
                <button
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() =>
                    setProposeInput('When will Arsenal score first vs Chelsea? 20 SPRD spread market')
                  }
                >
                  Spread Market [L, H]
                </button>
                {allMarkets.length > 0 && (
                  <button
                    style={{ fontSize: 11, padding: '4px 10px' }}
                    onClick={() =>
                      setProposeInput(
                        `Stacked bet: Will "${allMarkets[0].question}" hit 26? 30 SPRD`
                      )
                    }
                  >
                    Stack on Current Bet
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() =>
                    setStrategyInput(
                      `Bet 100 SPRD on YES, sell at 27 ${betUnitLabel}, stop me out at 21 ${betUnitLabel}, and show everyone's positions and stop losses`
                    )
                  }
                >
                  Strategy + Show Unit Graph
                </button>
                <button
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() => setStrategyInput('Put 100 SPRD in right now with no stops')}
                >
                  Test Missing Risk Tolerance
                </button>
              </>
            )}
          </div>

          {/* Toggle to Show Everyone's Positions & Stop Losses on the Vertical Unit Graph */}
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              cursor: 'pointer',
              color: 'var(--fg-muted)',
            }}
          >
            <input
              type="checkbox"
              checked={showUnitLadder}
              onChange={(e) => onToggleUnitLadder(e.target.checked)}
            />
            Show everyone&apos;s positions &amp; stops graph
          </label>
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
                ? 'Tell the bot your bet (e.g. "I bet it will be 24°C tomorrow, 50 SPRD")...'
                : 'Tell the bot your strategy, when to sell, and your stop level (or ask to show everyone\'s stops)...'
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

      {/* STEP 1 CARD: Agent 1 (Intake) -> Agent 2 (Classifier) Result in Casino Pastel Red */}
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
            <span className="pixel-font" style={{ fontSize: 12 }}>
              AGENT 1 &amp; 2 CLASSIFIED YOUR BET
            </span>
            <span className="badge-outline">
              {classification.archetype.toUpperCase()} ·{' '}
              {classification.route === 'arbiter' ? 'CUSTOM (3RD-PARTY ARBITER)' : 'AUTO-VERIFIABLE'}
            </span>
          </div>

          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
            &ldquo;{draft.question.replace(/TOKS/gi, 'SPRD')}&rdquo;
          </div>

          {/* If Custom Unverifiable: 3rd-Party Arbiter (e.g. Boss) + Countdown */}
          {classification.route === 'arbiter' && (
            <div
              className="pastel-card"
              style={{ marginBottom: 14, padding: '12px 14px' }}
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
              CREATE BET &amp; SET MY RISK LIMITS -&gt;
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
                placeholder="e.g. YES 100 SPRD"
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
                      <option value="OVER">OVER</option>
                      <option value="UNDER">UNDER</option>
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

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showUnitLadder}
                onChange={(e) => onToggleUnitLadder(e.target.checked)}
              />
              Show everyone&apos;s positions &amp; stop-losses on the vertical unit graph
            </label>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowRiskGateCard(false)}>CANCEL</button>
              <button className="btn-inverted pixel-font" onClick={handleConfirmStrategyAndRisk}>
                ✓ CONFIRM &amp; OPEN LIVE BET -&gt;
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
