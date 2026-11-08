import { describe, it, expect } from 'vitest';
import {
  parseStrategyRuleWithRiskGate,
  runAgent1Intake,
  runAgent2Classifier,
} from '../src/worker/agents';
import { DeterministicClock } from '../src/engine/clock';
import { SpreadEngine, RiskGateError } from '../src/engine/state_machine';
import { Market } from '../src/shared/types';

function createTestMarket(): Market {
  return {
    id: 'mkt_risk',
    group_id: 'grp_1',
    proposer_id: 'ana',
    archetype: 'simple',
    question: 'Will tomorrow temperature hit 24°C?',
    unit: '°C',
    bounds: [0, 100],
    no_event_value: 0,
    criteria: 'Met Office high >= 24°C',
    resolution_source: 'Met Office',
    payoff_mode: 'pot',
    lot_stake_k: 50,
    cap_widths_c: 3,
    state: 'live',
    verifiability: 'public_verifiable',
    route: 'auto',
    live_implied_value: 50,
    toggles: {
      max_lots: 3,
      forced_trading: false,
      hidden_takes: false,
      single_mm_requote: false,
      live_reopen_halftime: false,
    },
    version: 1,
    created_at: 1762542000000,
  };
}

describe('Two-Stage AI Classification & Mandatory 3-Part Strategy Risk Gate (SPEC §3.1 & §3.3)', () => {
  it('classifies Spread, Stacked, and Private/Arbiter prompts accurately via Agent 1 -> Agent 2', async () => {
    const spreadPrompt = 'When will Arsenal score first vs Chelsea? 10 CHIP';
    const a1Spread = await runAgent1Intake(spreadPrompt);
    const a2Spread = await runAgent2Classifier(spreadPrompt, a1Spread.draft);
    expect(a2Spread.archetype).toBe('spread');
    expect(a2Spread.route).toBe('auto');

    const arbiterPrompt = 'Internal office KPI: Will Team Atlas ship v3 before Friday?';
    const a1Arb = await runAgent1Intake(arbiterPrompt);
    const a2Arb = await runAgent2Classifier(arbiterPrompt, a1Arb.draft);
    expect(a2Arb.verifiability).toBe('custom_unverifiable');
    expect(a2Arb.route).toBe('arbiter');
    expect(a2Arb.requires_arbiter).toBe(true);

    const stackedPrompt = 'Will Market M7 Over odds hit 75% before halftime?';
    const a1Stacked = await runAgent1Intake(stackedPrompt);
    const a2Stacked = await runAgent2Classifier(stackedPrompt, a1Stacked.draft);
    expect(a2Stacked.archetype).toBe('stacked');
  });

  it('reads stakes with or without the chip unit', async () => {
    const mkt = createTestMarket();
    const stakeOf = async (text: string) =>
      (await parseStrategyRuleWithRiskGate(text, 'text', mkt)).stake_toks;
    expect(await stakeOf('Put 100 CHIP on YES')).toBe(100);
    expect(await stakeOf('bet 25 chips on YES')).toBe(25);
    expect(await stakeOf('stake 80 on YES')).toBe(80);
  });

  it('blocks conversational strategy entry missing take_profit_level or min_balance_floor (FR-04 / FR-91)', async () => {
    const mkt = createTestMarket();
    const incompleteProposal = await parseStrategyRuleWithRiskGate(
      'Put 100 CHIP on YES right now',
      'voice',
      mkt
    );
    expect(incompleteProposal.gate_passed).toBe(false);
    expect(incompleteProposal.missing_risk_gate_fields).toContain('take_profit_level');
    expect(incompleteProposal.missing_risk_gate_fields).toContain('min_balance_floor');
    expect(incompleteProposal.prompt_for_user).toMatch(/HARD RISK GATE/);

    const clock = new DeterministicClock();
    const engine = new SpreadEngine(clock);
    engine.ledger.registerPlayer({
      id: 'ana',
      group_id: 'grp_1',
      nickname: 'ANA',
      is_admin: true,
      wallet_balance_toks: 1000,
      escrow_balance_toks: 0,
    });
    engine.createMarket(mkt);

    expect(() =>
      engine.activateConversationalStrategy(
        mkt.id,
        {
          id: 'mandate_bad',
          market_id: mkt.id,
          player_id: 'ana',
          input_modality: 'voice',
          raw_transcript: 'Put 100 CHIP on YES right now',
          parsed_strategy_summary: 'YES 100 CHIP',
          side: 'YES',
          stake_toks: 100,
          take_profit_level: null,
          min_balance_floor: null,
          confirmed_at: clock.now(),
          created_at: clock.now(),
        },
        'idemp_bad'
      )
    ).toThrow(RiskGateError);
  });

  it('activates conversational strategy once all 3 Risk Gate fields are supplied and confirmed', async () => {
    const mkt = createTestMarket();
    const completeProposal = await parseStrategyRuleWithRiskGate(
      'Put 100 CHIP on YES, take profit at 72%, cut me at 44% floor',
      'voice',
      mkt
    );
    expect(completeProposal.gate_passed).toBe(true);
    expect(completeProposal.take_profit_level).toBe(72);
    expect(completeProposal.min_balance_floor).toBe(44);
    expect(completeProposal.missing_risk_gate_fields).toHaveLength(0);

    const clock = new DeterministicClock();
    const engine = new SpreadEngine(clock);
    engine.ledger.registerPlayer({
      id: 'ana',
      group_id: 'grp_1',
      nickname: 'ANA',
      is_admin: true,
      wallet_balance_toks: 1000,
      escrow_balance_toks: 0,
    });
    engine.createMarket(mkt);

    const res = engine.activateConversationalStrategy(
      mkt.id,
      {
        id: 'mandate_good',
        market_id: mkt.id,
        player_id: 'ana',
        input_modality: 'voice',
        raw_transcript: completeProposal.raw_transcript,
        parsed_strategy_summary: completeProposal.parsed_strategy_summary!,
        side: completeProposal.side,
        stake_toks: completeProposal.stake_toks,
        take_profit_level: completeProposal.take_profit_level,
        min_balance_floor: completeProposal.min_balance_floor,
        confirmed_at: clock.now(),
        created_at: clock.now(),
      },
      'idemp_good'
    );

    expect(res.createdOrders).toHaveLength(2); // take_profit + stop_loss on public Swing Map
    expect(engine.ledger.getPlayer('ana').escrow_balance_toks).toBe(100);
    engine.ledger.assertInvariants();
  });
});
