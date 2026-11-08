import React, { useState } from 'react';
import {
  ClassifyMarketProposal,
  DraftMarketProposal,
  LintCriteriaProposal,
  Market,
  ParseRuleProposal,
  Player,
  SuggestWidthProposal,
} from '../shared/types';
import { usePushToTalk } from '../hooks/usePushToTalk';

interface StrategySheetModalProps {
  initialTab: 'create' | 'strategy';
  activeMarket: Market;
  allMarkets: Market[];
  activePlayer: Player;
  players: Player[];
  onClose: () => void;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
  onSelectMarket: (marketId: string) => void;
}

export const StrategySheetModal: React.FC<StrategySheetModalProps> = ({
  initialTab,
  activeMarket,
  allMarkets,
  activePlayer,
  players,
  onClose,
  onDispatch,
  onSelectMarket,
}) => {
  const [tab, setTab] = useState<'create' | 'strategy'>(initialTab);

  // Tab 1: Market Creation (Agent 1 -> Agent 2)
  const [rawPrompt, setRawPrompt] = useState<string>(
    'When will Arsenal score their second goal vs Chelsea? 15 CHIP per lot'
  );
  const [draft, setDraft] = useState<DraftMarketProposal | null>(null);
  const [lint, setLint] = useState<LintCriteriaProposal | null>(null);
  const [widthSug, setWidthSug] = useState<SuggestWidthProposal | null>(null);
  const [classification, setClassification] = useState<ClassifyMarketProposal | null>(null);
  const [selectedArbiterId, setSelectedArbiterId] = useState<string>('eli');
  const [countdownMins, setCountdownMins] = useState<string>('15');
  const [parentMarketId, setParentMarketId] = useState<string>(activeMarket.id);

  // Tab 2: Conversational Strategy & Mandatory 3-Part Risk Gate (FR-04 / FR-91)
  const [strategyPrompt, setStrategyPrompt] = useState<string>(
    'Put 100 CHIP in if odds dip below 40%, take profit at 72%, cut me at 44% floor'
  );
  const [parsedRule, setParsedRule] = useState<ParseRuleProposal | null>(null);
  const [summaryField, setSummaryField] = useState<string>('');
  const [stakeField, setStakeField] = useState<string>('100');
  const [tpField, setTpField] = useState<string>('');
  const [floorField, setFloorField] = useState<string>('');
  const [sideField, setSideField] = useState<string>(
    activeMarket.archetype === 'spread' ? 'OVER' : 'YES'
  );
  const [sheetError, setSheetError] = useState<string | null>(null);

  const ptt = usePushToTalk((transcript) => {
    if (tab === 'create') {
      setRawPrompt(transcript);
    } else {
      setStrategyPrompt(transcript);
    }
  });

  // Dot-matrix stake visualizer (10 dots representing share of player's wallet)
  const numericStake = Number(stakeField) || 0;
  const walletCap = Math.max(100, activePlayer.wallet_balance_toks);
  const filledDots = Math.min(10, Math.max(1, Math.round((numericStake / walletCap) * 10)));
  const dotMatrix = '●'.repeat(filledDots) + '○'.repeat(10 - filledDots);

  const handleRunAgentPipeline = async () => {
    setSheetError(null);
    try {
      const res = await onDispatch('/api/agents/intake', {
        prompt: rawPrompt,
        playerId: activePlayer.id,
      });
      setDraft(res.draft);
      setLint(res.lint);
      setWidthSug(res.widthSuggestion);
      setClassification(res.classification);
    } catch (err: any) {
      setSheetError(err.message);
    }
  };

  const handleConfirmLaunchMarket = async () => {
    if (!draft || !classification) return;
    setSheetError(null);
    try {
      const res = await onDispatch('/api/markets', {
        proposer_id: activePlayer.id,
        archetype: classification.archetype,
        question: draft.question,
        unit: draft.unit,
        bounds: draft.bounds,
        no_event_value: draft.no_event_value,
        criteria: draft.criteria,
        resolution_source: draft.resolution_source,
        payoff_mode: draft.payoff_mode,
        lot_stake_k: draft.lot_stake_k,
        verifiability: classification.verifiability,
        route: classification.route,
        arbiter_id: classification.route === 'arbiter' ? selectedArbiterId : null,
        countdown_ends_at:
          classification.route === 'arbiter'
            ? Date.now() + Number(countdownMins || 15) * 60 * 1000
            : null,
        parent_market_id:
          classification.archetype === 'stacked' ? draft.parent_market_id || parentMarketId : null,
        parent_metric:
          classification.archetype === 'stacked' ? draft.parent_metric || 'odds' : null,
        parent_trigger_target:
          classification.archetype === 'stacked' ? draft.parent_trigger_target ?? 75 : null,
      });
      if (res?.market?.id) {
        onSelectMarket(res.market.id);
      }
      onClose();
    } catch (err: any) {
      setSheetError(err.message);
    }
  };

  const handleParseStrategy = async () => {
    setSheetError(null);
    try {
      const res = await onDispatch('/api/agents/parse-strategy', {
        marketId: activeMarket.id,
        transcript: strategyPrompt,
        modality: 'voice',
        playerId: activePlayer.id,
      });
      const prop: ParseRuleProposal = res.proposal;
      setParsedRule(prop);
      setSummaryField(prop.parsed_strategy_summary || '');
      setStakeField(String(prop.stake_toks || 100));
      setSideField(prop.side);
      setTpField(prop.take_profit_level != null ? String(prop.take_profit_level) : '');
      setFloorField(prop.min_balance_floor != null ? String(prop.min_balance_floor) : '');
    } catch (err: any) {
      setSheetError(err.message);
    }
  };

  const handleConfirmRiskGate = async () => {
    setSheetError(null);
    try {
      await onDispatch(`/api/markets/${activeMarket.id}/strategy/activate`, {
        player_id: activePlayer.id,
        input_modality: 'voice',
        raw_transcript: strategyPrompt,
        parsed_strategy_summary: summaryField.trim(),
        side: sideField,
        stake_toks: Number(stakeField),
        entry_trigger_level: parsedRule?.entry_trigger_level ?? null,
        take_profit_level: tpField.trim() !== '' ? Number(tpField) : null,
        min_balance_floor: floorField.trim() !== '' ? Number(floorField) : null,
        confirmed_at: Date.now(),
      });
      onClose();
    } catch (err: any) {
      setSheetError(err.message);
    }
  };

  const allThreeRiskFieldsFilled =
    summaryField.trim().length > 0 &&
    tpField.trim().length > 0 &&
    !Number.isNaN(Number(tpField)) &&
    floorField.trim().length > 0 &&
    !Number.isNaN(Number(floorField));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="strategy-sheet-modal strategy-sheet-theme"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '2px solid #000000',
            paddingBottom: 8,
            marginBottom: 12,
          }}
        >
          <div>
            <strong>#FAFAFA STRATEGY & ALLOCATION SHEET</strong> // TRADER: [{activePlayer.nickname}]
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={tab === 'create' ? 'btn-inverted' : ''}
              onClick={() => setTab('create')}
            >
              01 // AGENT 1+2 MARKET INTAKE
            </button>
            <button
              className={tab === 'strategy' ? 'btn-inverted' : ''}
              onClick={() => setTab('strategy')}
            >
              02 // 3-PART AI RISK GATE [FR-04]
            </button>
            <button onClick={onClose}>[ESC / CLOSE]</button>
          </div>
        </div>

        {/* Push-to-Talk Voice Capture Bar */}
        <div
          style={{
            border: '1px solid #000000',
            padding: '8px 10px',
            marginBottom: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            backgroundColor: '#f0f0f0',
          }}
        >
          <span>
            VOICE MODALITY: <strong>{ptt.voiceStatus}</strong>
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={ptt.isRecording ? 'btn-inverted' : ''}
              onMouseDown={ptt.startRecording}
              onMouseUp={() =>
                ptt.stopRecording(
                  tab === 'create'
                    ? 'When will Arsenal score their second goal vs Chelsea? 15 CHIP per lot'
                    : 'Put 100 CHIP on YES, take profit at 75%, cut me at 42% floor'
                )
              }
            >
              {ptt.isRecording ? '● RECORDING (RELEASE TO SEND)' : '🎙 HOLD PUSH-TO-TALK VOICE'}
            </button>
          </div>
        </div>

        {sheetError && (
          <div
            style={{
              border: '2px solid #000000',
              padding: 8,
              marginBottom: 12,
              backgroundColor: '#ffffff',
              fontWeight: 700,
            }}
          >
            HARD GATE BLOCK // {sheetError}
          </div>
        )}

        {tab === 'create' ? (
          <div>
            <div style={{ marginBottom: 8, fontWeight: 700 }}>
              STAGE 1 & 2: VOICE / TEXT PROMPT -&gt; AGENT 1 (INTAKE) -&gt; AGENT 2 (CLASSIFIER)
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <button
                onClick={() =>
                  setRawPrompt('When will Arsenal score next? 15 CHIP spread market')
                }
              >
                PRESET: SPREAD [L, H]
              </button>
              <button
                onClick={() => setRawPrompt('I bet it will be 24°C in London tomorrow, 30 CHIP')}
              >
                PRESET: SIMPLE WEATHER
              </button>
              <button
                onClick={() =>
                  setRawPrompt(
                    'Will Market M1 Over odds hit 75% before halftime? Stacked derivative 25 CHIP'
                  )
                }
              >
                PRESET: STACKED DERIVATIVE
              </button>
              <button
                onClick={() =>
                  setRawPrompt(
                    'Internal office KPI: Will Team Atlas ship v3 before Friday? Private arbiter bet 40 CHIP'
                  )
                }
              >
                PRESET: 3RD-PARTY ARBITER
              </button>
            </div>

            <textarea
              rows={2}
              value={rawPrompt}
              onChange={(e) => setRawPrompt(e.target.value)}
              style={{ width: '100%', padding: 8, border: '1px solid #000000', marginBottom: 8 }}
            />

            <button className="btn-inverted" onClick={handleRunAgentPipeline}>
              RUN AGENT 1 (INTAKE) + AGENT 2 (CLASSIFIER)
            </button>

            {draft && classification && (
              <div style={{ marginTop: 14, borderTop: '2px solid #000000', paddingTop: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  === AGENT 1 + AGENT 2 DRAFT CARD (CONFIRM TO LAUNCH) ====
                </div>
                <div className="gutter-row">
                  <span className="gutter-num">01</span>
                  <span>
                    QUESTION: <strong>{draft.question}</strong>
                  </span>
                </div>
                <div className="gutter-row">
                  <span className="gutter-num">02</span>
                  <span>
                    ARCHETYPE:{' '}
                    <span className="badge-inverted">{classification.archetype.toUpperCase()}</span>{' '}
                    | VERIFIABILITY: <strong>{classification.verifiability}</strong> | ROUTE:{' '}
                    <span className="badge-inverted">{classification.route.toUpperCase()}</span>
                  </span>
                </div>
                <div className="gutter-row">
                  <span className="gutter-num">03</span>
                  <span>
                    BOUNDS: [{draft.bounds[0]} .. {draft.bounds[1]}] {draft.unit} | NO-EVENT
                    FALLBACK: {draft.no_event_value} | STAKE k: {draft.lot_stake_k} CHIP
                  </span>
                </div>
                <div className="gutter-row">
                  <span className="gutter-num">04</span>
                  <span>CRITERIA: {draft.criteria}</span>
                </div>
                {widthSug && classification.archetype === 'spread' && (
                  <div className="gutter-row">
                    <span className="gutter-num">05</span>
                    <span>
                      SUGGESTED WIDTH (suggest_width): w = {widthSug.suggested_width_w} (Ref quote [
                      {widthSug.suggested_L}, {widthSug.suggested_H}])
                    </span>
                  </div>
                )}
                {lint && lint.is_ambiguous && (
                  <div
                    style={{
                      border: '1px solid #000000',
                      padding: 6,
                      marginTop: 6,
                      backgroundColor: '#f0f0f0',
                    }}
                  >
                    <strong>LINT_CRITERIA ADVISORY:</strong> {lint.clarifying_questions.join(' ')}
                  </div>
                )}

                {classification.route === 'arbiter' && (
                  <div
                    style={{
                      border: '1px solid #000000',
                      padding: 8,
                      marginTop: 8,
                      display: 'flex',
                      gap: 12,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <strong>MANDATORY 3RD-PARTY ARBITER & COUNTDOWN (FR-08):</strong>
                    <label>
                      ARBITER:{' '}
                      <select
                        value={selectedArbiterId}
                        onChange={(e) => setSelectedArbiterId(e.target.value)}
                      >
                        {players
                          .filter((p) => p.id !== activePlayer.id)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nickname} (NON-TRADING)
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      COUNTDOWN LOCK (MIN):{' '}
                      <input
                        type="number"
                        className="underline-input"
                        value={countdownMins}
                        onChange={(e) => setCountdownMins(e.target.value)}
                        style={{ width: 60 }}
                      />
                    </label>
                  </div>
                )}

                {classification.archetype === 'stacked' && (
                  <div style={{ border: '1px solid #000000', padding: 8, marginTop: 8 }}>
                    <strong>PARENT MARKET LINK (STACKED META-MARKET): </strong>
                    <select
                      value={parentMarketId}
                      onChange={(e) => setParentMarketId(e.target.value)}
                    >
                      {allMarkets.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.id} :: {m.question}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  <button className="btn-inverted" onClick={handleConfirmLaunchMarket}>
                    ✓ CONFIRM DRAFT CARD & LAUNCH MARKET
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 8, fontWeight: 700 }}>
              CONVERSATIONAL VOICE / TEXT STRATEGY -&gt; MANDATORY 3-PART HARD RISK GATE (FR-04 / FR-91)
            </div>
            <div style={{ fontSize: 11, marginBottom: 8 }}>
              TARGET MARKET: <strong>{activeMarket.question}</strong>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <button
                onClick={() =>
                  setStrategyPrompt(
                    'Put 100 CHIP on YES, take profit at 72%, cut me at 44% floor'
                  )
                }
              >
                PRESET 1: COMPLETE 3-PART STRATEGY
              </button>
              <button
                onClick={() =>
                  setStrategyPrompt('Put 120 CHIP in right now on YES without any stops')
                }
              >
                PRESET 2: MISSING TP & FLOOR (TEST HARD GATE BLOCK)
              </button>
            </div>

            <textarea
              rows={2}
              value={strategyPrompt}
              onChange={(e) => setStrategyPrompt(e.target.value)}
              style={{ width: '100%', padding: 8, border: '1px solid #000000', marginBottom: 8 }}
            />

            <button className="btn-inverted" onClick={handleParseStrategy}>
              PARSE VOICE / TEXT STRATEGY (`parse_rule`)
            </button>

            <div style={{ marginTop: 14, borderTop: '2px solid #000000', paddingTop: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                === MANDATORY 3-PART RISK GATE CONFIRMATION CARD ====
              </div>

              <div style={{ marginBottom: 10 }}>
                <span>
                  ALLOCATION STAKE VISUALIZER: <strong>[{dotMatrix}]</strong>{' '}
                </span>
                <input
                  type="number"
                  className="underline-input"
                  value={stakeField}
                  onChange={(e) => setStakeField(e.target.value)}
                  style={{ width: 70 }}
                />{' '}
                / {activePlayer.wallet_balance_toks} CHIP WALLET
              </div>

              <div className="gutter-row" style={{ marginBottom: 6 }}>
                <span className="gutter-num">01</span>
                <div>
                  <strong>(1) INTERPRETED STRATEGY SUMMARY:</strong>{' '}
                  <input
                    type="text"
                    className="underline-input"
                    value={summaryField}
                    placeholder="REQUIRED: e.g. YES 100 CHIP"
                    onChange={(e) => setSummaryField(e.target.value)}
                    style={{ width: '60%' }}
                  />
                </div>
              </div>

              <div className="gutter-row" style={{ marginBottom: 6 }}>
                <span className="gutter-num">02</span>
                <div>
                  <strong>(2) TAKE-PROFIT / EXIT TARGET (`take_profit_level`):</strong>{' '}
                  <input
                    type="number"
                    className="underline-input"
                    value={tpField}
                    placeholder="REQUIRED (e.g. 72)"
                    onChange={(e) => setTpField(e.target.value)}
                    style={{ width: 120 }}
                  />
                  {tpField.trim() === '' && (
                    <span style={{ marginLeft: 8, fontWeight: 700 }}>[MISSING — REQUIRED]</span>
                  )}
                </div>
              </div>

              <div className="gutter-row" style={{ marginBottom: 10 }}>
                <span className="gutter-num">03</span>
                <div>
                  <strong>(3) RISK TOLERANCE / DRAWDOWN FLOOR (`min_balance_floor`):</strong>{' '}
                  <input
                    type="number"
                    className="underline-input"
                    value={floorField}
                    placeholder="REQUIRED (e.g. 44)"
                    onChange={(e) => setFloorField(e.target.value)}
                    style={{ width: 120 }}
                  />
                  {floorField.trim() === '' && (
                    <span style={{ marginLeft: 8, fontWeight: 700 }}>[MISSING — REQUIRED]</span>
                  )}
                </div>
              </div>

              {parsedRule && !parsedRule.gate_passed && !allThreeRiskFieldsFilled && (
                <div
                  style={{
                    border: '1px solid #000000',
                    padding: 8,
                    marginBottom: 10,
                    backgroundColor: '#f0f0f0',
                  }}
                >
                  {parsedRule.prompt_for_user}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="btn-inverted"
                  onClick={handleConfirmRiskGate}
                >
                  {allThreeRiskFieldsFilled
                    ? '✓ CONFIRM ALL 3 RISK GATE FIELDS & ACTIVATE ORDERS'
                    : 'ATTEMPT ACTIVATION (WILL TEST ENGINE RISK GATE)'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
