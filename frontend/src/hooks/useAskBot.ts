import { useEffect, useState } from 'react';
import {
  ClassifyMarketProposal,
  DraftMarketProposal,
  Market,
  ParseRuleProposal,
  PayoffMode,
  Player,
} from '../shared/types';
import { usePushToTalk } from './usePushToTalk';
import { sfx } from '../utils/soundEffects';
import { AppPanel } from '../App';

export interface AskBotOptions {
  activeMarket: Market | null;
  allMarkets: Market[];
  activePlayer: Player;
  forwardedChatPrompt: string | null;
  onClearForwardedChatPrompt: () => void;
  showUnitLadder: boolean;
  onToggleUnitLadder: (show: boolean) => void;
  onSelectMarket: (marketId: string) => void;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
  onOpenPanel: (panel: AppPanel) => void;
  /** Increments each time the rest of the page asks to start a new bet. */
  newBetRequest: number;
}

/** All Ask Bot state and server calls, shared by the panel's sub-components. */
export function useAskBot({
  activeMarket,
  allMarkets,
  activePlayer,
  forwardedChatPrompt,
  onClearForwardedChatPrompt,
  onToggleUnitLadder,
  onSelectMarket,
  onDispatch,
  onOpenPanel,
  newBetRequest,
}: AskBotOptions) {
  const [intentMode, setIntentMode] = useState<'propose' | 'strategy'>(
    allMarkets.length === 0 || forwardedChatPrompt ? 'propose' : 'strategy'
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  // Market Creation (Agent 1 Intake -> Agent 2 Classifier)
  const [proposeInput, setProposeInput] = useState<string>('');
  const [draft, setDraft] = useState<DraftMarketProposal | null>(null);
  const [classification, setClassification] = useState<ClassifyMarketProposal | null>(null);
  const [draftSource, setDraftSource] = useState<'gemini' | 'preset'>('gemini');
  const [draftSources, setDraftSources] = useState<{ title: string; url: string }[]>([]);
  const [openingWidth, setOpeningWidth] = useState<string>('');

  // In-House Rules for Linear / Window (Spread) Markets & Creator Visibility Option
  const [inHousePayoffMode, setInHousePayoffMode] = useState<PayoffMode>('linear');
  const [inHouseCapC, setInHouseCapC] = useState<string>('3');
  const [inHouseLotStake, setInHouseLotStake] = useState<string>('25');
  const [inHouseUnit, setInHouseUnit] = useState<string>('');
  const [creatorShowPositionsToAll, setCreatorShowPositionsToAll] = useState<boolean>(true);
  const [showCustomizeRules, setShowCustomizeRules] = useState<boolean>(false);

  // Custom Arbiter & Stacked Options
  const [arbiterName, setArbiterName] = useState<string>('');
  const [countdownMins, setCountdownMins] = useState<string>('15');
  const [parentMarketId, setParentMarketId] = useState<string>(activeMarket?.id ?? '');

  // Strategy & Mandatory Risk Gate (in terms of the unit being bet)
  const [strategyInput, setStrategyInput] = useState<string>('');
  const [parsedRule, setParsedRule] = useState<ParseRuleProposal | null>(null);
  const [showRiskGateCard, setShowRiskGateCard] = useState<boolean>(false);
  const [summaryField, setSummaryField] = useState<string>('');
  const [stakeField, setStakeField] = useState<string>('');
  const [sideField, setSideField] = useState<string>('OVER');
  const [tpField, setTpField] = useState<string>('');
  const [floorField, setFloorField] = useState<string>('');

  const betUnitLabel =
    activeMarket?.unit && activeMarket.unit !== 'binary' && activeMarket.unit !== '%'
      ? activeMarket.unit
      : 'units';

  // When a chat message is turned into a bet, load it here and classify it straight away
  useEffect(() => {
    if (forwardedChatPrompt) {
      setIntentMode('propose');
      setProposeInput(forwardedChatPrompt);
      onClearForwardedChatPrompt();
      handleSendToBot('propose', forwardedChatPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forwardedChatPrompt]);

  useEffect(() => {
    if (newBetRequest === 0) return;
    setIntentMode('propose');
    document.getElementById('ask-bot-input')?.focus();
  }, [newBetRequest]);

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
    textOverride?: string,
    preset: boolean = false
  ) => {
    const mode = modeOverride ?? intentMode;
    if (!(textOverride ?? (mode === 'propose' ? proposeInput : strategyInput)).trim()) return;
    setGateError(null);
    setIsProcessing(true);

    try {
      const rawText = textOverride ?? (mode === 'propose' ? proposeInput : strategyInput);

      if (mode === 'propose') {
        const res = await onDispatch('/api/agents/intake', {
          prompt: rawText,
          playerId: activePlayer.id,
          preset,
        });
        const d: DraftMarketProposal = res.draft;
        const c: ClassifyMarketProposal = res.classification;
        setDraft(d);
        setClassification(c);
        sfx.playCatAlert();
        setInHousePayoffMode(c.archetype === 'spread' ? 'linear' : d.payoff_mode || 'pot');
        setInHouseLotStake(String(d.lot_stake_k || 25));
        setInHouseUnit(d.unit);
        setOpeningWidth(d.opening_width != null ? String(d.opening_width) : '');
        setDraftSource(res.source === 'preset' ? 'preset' : 'gemini');
        setDraftSources(res.sources ?? []);
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
        setSummaryField((prop.parsed_strategy_summary || '').replace(/TOKS/g, 'CHIP'));
        setStakeField(String(prop.stake_toks));
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
      if (classification.route === 'arbiter' && !arbiterName.trim()) {
        setGateError('Name who decides this bet.');
        return;
      }

      // Apply the Market Creator's visibility choice globally & on the market object
      onToggleUnitLadder(creatorShowPositionsToAll);

      const res = await onDispatch('/api/markets', {
        proposer_id: activePlayer.id,
        archetype: classification.archetype,
        question: draft.question.replace(/TOKS/gi, 'CHIP'),
        unit: inHouseUnit.trim() || draft.unit,
        bounds: draft.bounds,
        origin: draftSource === 'preset' ? 'preset' : 'live',
        resolves_at_ms: draft.resolves_at_ms ?? null,
        opening_width:
          classification.archetype === 'spread' && Number(openingWidth) > 0
            ? Number(openingWidth)
            : undefined,
        no_event_value: draft.no_event_value,
        criteria: draft.criteria,
        resolution_source: draft.resolution_source,
        payoff_mode: classification.archetype === 'spread' ? inHousePayoffMode : draft.payoff_mode,
        lot_stake_k: Number(inHouseLotStake) || draft.lot_stake_k,
        cap_widths_c: Number(inHouseCapC) || 3,
        verifiability: classification.verifiability,
        route: classification.route,
        arbiter_id: classification.route === 'arbiter' ? arbiterName.trim() : null,
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
          classification.archetype === 'spread'
            ? (draft.bounds[0] + draft.bounds[1]) / 2
            : 50,
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
      sfx.playBetConfirm();
      setDraft(null);
      setClassification(null);

      setProposeInput('');
      onOpenPanel('bet');
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

    if (activeMarket.state === 'width_auction' || activeMarket.state === 'quoting') {
      setGateError('Bets open once the market maker sets the window.');
      return;
    }

    setIsProcessing(true);
    try {
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
      onOpenPanel('bet');
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

  return {
    activeMarket,
    allMarkets,
    activePlayer,
    intentMode,
    setIntentMode,
    isProcessing,
    gateError,
    setGateError,
    proposeInput,
    setProposeInput,
    draft,
    setDraft,
    classification,
    setClassification,
    draftSource,
    draftSources,
    openingWidth,
    setOpeningWidth,
    inHousePayoffMode,
    setInHousePayoffMode,
    inHouseCapC,
    setInHouseCapC,
    inHouseLotStake,
    setInHouseLotStake,
    inHouseUnit,
    setInHouseUnit,
    creatorShowPositionsToAll,
    setCreatorShowPositionsToAll,
    showCustomizeRules,
    setShowCustomizeRules,
    arbiterName,
    setArbiterName,
    countdownMins,
    setCountdownMins,
    parentMarketId,
    setParentMarketId,
    strategyInput,
    setStrategyInput,
    showRiskGateCard,
    setShowRiskGateCard,
    stakeField,
    setStakeField,
    sideField,
    setSideField,
    tpField,
    setTpField,
    floorField,
    setFloorField,
    betUnitLabel,
    ptt,
    handleSendToBot,
    handleConfirmLaunchMarket,
    handleConfirmStrategyAndRisk,
    orbClass,
  };
}

export type AskBot = ReturnType<typeof useAskBot>;
