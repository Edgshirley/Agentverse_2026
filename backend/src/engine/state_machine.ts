// ============================================================================
// Deterministic Market State Machine, Risk Gate Enforcer & Wire Trace Emitter
// (SPEC §1.8, §2.2, §3.3, §4.2, §6.1, §6.2)
// ============================================================================

import { Clock, SystemClock } from './clock';
import { ToksLedger } from './ledger';
import { WidthAuctionEngine } from './auction';
import { SpreadMarketBook } from './payoffs';
import { P2PTransferEngine } from './mm_transfer';
import { ContinuousPoolOrderBook, CascadeStepLog } from './pool_orderbook';
import { ResolutionEngine } from './resolution';
import { evaluateStackedMarket } from './stacked';
import { computeSwingTree, formatSwingRiskTelemetry } from './swing_tree';
import {
  AgentClassificationLog,
  LifecyclePhase,
  LiveEvent,
  Market,
  Order,
  OrderType,
  OutcomeProposal,
  Player,
  Position,
  PositionBid,
  PositionSide,
  StrategyMandate,
  SwimlaneEvent,
  SwimlaneNodeCode,
  SwingTreeProjection,
  WireTraceEntry,
} from '../shared/types';


/** Spread/window bets are OVER or UNDER; the bot and UI sometimes say ABOVE/BELOW/YES/NO. */
export function normalizeSpreadSide(side: string): 'OVER' | 'UNDER' {
  const s = String(side).toUpperCase();
  return s === 'UNDER' || s === 'BELOW' || s === 'NO' ? 'UNDER' : 'OVER';
}

export class RiskGateError extends Error {
  constructor(
    message: string,
    public readonly missingFields: Array<
      'parsed_strategy_summary' | 'take_profit_level' | 'min_balance_floor'
    >
  ) {
    super(message);
    this.name = 'RiskGateError';
  }
}

export class SpreadEngine {
  public readonly ledger: ToksLedger;
  public readonly auction: WidthAuctionEngine;
  public readonly spreadBook: SpreadMarketBook;
  public readonly p2p: P2PTransferEngine;
  public readonly poolBook: ContinuousPoolOrderBook;
  public readonly resolution: ResolutionEngine;

  private markets: Map<string, Market> = new Map();
  private mandatesByMarket: Map<string, StrategyMandate[]> = new Map();
  private swimlanesByMarket: Map<string, SwimlaneEvent[]> = new Map();
  private wireTracesByMarket: Map<string, WireTraceEntry[]> = new Map();
  private liveEventsByMarket: Map<string, LiveEvent[]> = new Map();
  private classificationLogs: AgentClassificationLog[] = [];
  private historyByMarket: Map<string, Array<{ step: string; implied_value: number; minute?: number }>> =
    new Map();
  private lastSettlementNetPnlByMarket: Map<string, Record<string, number>> = new Map();
  private wireSeq: number = 0;

  constructor(public readonly clock: Clock = new SystemClock()) {
    this.ledger = new ToksLedger(this.clock);
    this.auction = new WidthAuctionEngine(this.clock, this.ledger);
    this.spreadBook = new SpreadMarketBook(this.clock, this.ledger);
    this.p2p = new P2PTransferEngine(this.clock, this.ledger, this.spreadBook);
    this.poolBook = new ContinuousPoolOrderBook(this.clock, this.ledger);
    // Window/spread bets live in the spread book: count them when placing stops & targets
    this.poolBook.hasExternalLivePosition = (marketId, playerId, side) =>
      this.spreadBook
        .getPositions(marketId)
        .some(
          (p) =>
            p.player_id === playerId &&
            p.side === normalizeSpreadSide(side) &&
            (p.lots > 0 || p.staked_toks > 0)
        );
    this.resolution = new ResolutionEngine(this.clock);
  }

  public emitWireTrace(
    marketId: string,
    source: WireTraceEntry['source'],
    target: WireTraceEntry['target'],
    action: string,
    detail: string,
    toksDelta?: number
  ): WireTraceEntry {
    this.wireSeq += 1;
    const entry: WireTraceEntry = {
      id: `wire_${this.clock.now()}_${this.wireSeq}`,
      market_id: marketId,
      seq: this.wireSeq,
      timestamp_ms: this.clock.now(),
      source,
      target,
      action,
      detail,
      toks_delta: toksDelta,
    };
    const list = this.wireTracesByMarket.get(marketId) ?? [];
    list.push(entry);
    this.wireTracesByMarket.set(marketId, list);
    return entry;
  }

  public recordSwimlane(
    marketId: string,
    playerId: string,
    phase: LifecyclePhase,
    code: SwimlaneNodeCode,
    label: string,
    deltaToks?: number
  ): SwimlaneEvent {
    const evt: SwimlaneEvent = {
      id: `swim_${this.clock.now()}_${this.wireSeq + 1}`,
      market_id: marketId,
      player_id: playerId,
      phase,
      code,
      label,
      delta_toks: deltaToks,
      timestamp: this.clock.now(),
    };
    const list = this.swimlanesByMarket.get(marketId) ?? [];
    list.push(evt);
    this.swimlanesByMarket.set(marketId, list);
    return evt;
  }

  private recordMainLinePoint(marketId: string, step: string, impliedValue: number, minute?: number): void {
    const list = this.historyByMarket.get(marketId) ?? [];
    list.push({ step, implied_value: impliedValue, minute });
    this.historyByMarket.set(marketId, list);
  }

  public createMarket(market: Market): Market {
    if (market.route === 'arbiter' && (!market.arbiter_id || !market.countdown_ends_at)) {
      throw new Error('Arbiter route requires both arbiter_id and countdown_ends_at (SPEC §3.4 & FR-08)');
    }
    const isNew = !this.markets.has(market.id);
    const copy: Market = { ...market };
    this.markets.set(copy.id, copy);
    if (isNew) {
      this.recordMainLinePoint(copy.id, 'OPEN', copy.live_implied_value, 0);
      this.emitWireTrace(
        copy.id,
        'PLAYER',
        'MARKET_ENGINE',
        'CREATE_MARKET',
        `[${copy.archetype.toUpperCase()} / ${copy.route.toUpperCase()}] "${copy.question}" (k=${copy.lot_stake_k} CHIP)`
      );
    }
    return { ...copy };
  }

  public recordLiveEvent(marketId: string, event: LiveEvent): LiveEvent {
    const list = this.liveEventsByMarket.get(marketId) ?? [];
    list.push({ ...event });
    this.liveEventsByMarket.set(marketId, list);
    if (event.implied_value_after != null) {
      this.recordMainLinePoint(
        marketId,
        `${event.event_type.toUpperCase()}_${event.minute}M`,
        event.implied_value_after,
        event.minute
      );
    }
    return { ...event };
  }

  public recordClassificationLog(log: AgentClassificationLog): AgentClassificationLog {
    this.classificationLogs.push({ ...log });
    return { ...log };
  }

  public getClassificationLogs(marketId?: string): AgentClassificationLog[] {
    if (!marketId) return [...this.classificationLogs];
    return this.classificationLogs.filter((l) => l.market_id === marketId);
  }

  public getMarket(marketId: string): Market {
    const m = this.markets.get(marketId);
    if (!m) throw new Error(`Unknown market: ${marketId}`);
    // Automatically check Arbiter countdown lock
    const checked = this.resolution.checkCountdownLock(m);
    if (checked.state !== m.state) {
      this.markets.set(marketId, checked);
      this.emitWireTrace(
        marketId,
        'MARKET_ENGINE',
        'BROADCAST',
        'COUNTDOWN_LOCK_00:00:00',
        `Mandatory countdown expired — all bets & withdrawals frozen; awaiting Arbiter (${checked.arbiter_id})`
      );
    }
    return { ...checked };
  }

  public getAllMarkets(): Market[] {
    return Array.from(this.markets.keys()).map((id) => this.getMarket(id));
  }

  public getMarketPositions(marketId: string): Position[] {
    const m = this.getMarket(marketId);
    if (m.archetype === 'spread') {
      return this.spreadBook.getPositions(marketId);
    }
    return this.poolBook.getPositions(marketId);
  }

  public getMarketOrders(marketId: string): Order[] {
    return this.poolBook.getOrders(marketId);
  }

  public getStandingP2PBids(marketId: string): PositionBid[] {
    return this.p2p.getStandingOrders(marketId);
  }

  public getSwimlanes(marketId: string): SwimlaneEvent[] {
    return [...(this.swimlanesByMarket.get(marketId) ?? [])];
  }

  public getWireTrace(marketId: string): WireTraceEntry[] {
    return [...(this.wireTracesByMarket.get(marketId) ?? [])];
  }

  public getLiveEvents(marketId: string): LiveEvent[] {
    return [...(this.liveEventsByMarket.get(marketId) ?? [])];
  }

  public getMandates(marketId: string): StrategyMandate[] {
    return [...(this.mandatesByMarket.get(marketId) ?? [])];
  }

  public getSwingTree(marketId: string): SwingTreeProjection {
    const m = this.getMarket(marketId);
    const positions = this.getMarketPositions(marketId);
    const orders = this.getMarketOrders(marketId);
    const history = this.historyByMarket.get(marketId) ?? [];
    return computeSwingTree(m, positions, orders, history);
  }

  public getSwingRiskLabel(marketId: string): string {
    const m = this.getMarket(marketId);
    const orders = this.getMarketOrders(marketId);
    return formatSwingRiskTelemetry(m, orders);
  }

  /**
   * Validates and activates a Conversational/Voice Strategy Mandate (SPEC §3.3 & FR-04 / FR-91).
   * Enforces the Mandatory 3-Part Hard Risk Gate:
   *   1. Interpreted Strategy Summary (`parsed_strategy_summary`)
   *   2. Take-Profit / Exit Target (`take_profit_level`)
   *   3. Risk Tolerance / Drawdown Floor (`min_balance_floor`)
   */
  public activateConversationalStrategy(
    marketId: string,
    mandate: StrategyMandate,
    idempotencyKey: string
  ): { market: Market; mandate: StrategyMandate; createdOrders: Order[]; position?: Position } {
    const missing: Array<'parsed_strategy_summary' | 'take_profit_level' | 'min_balance_floor'> = [];
    if (!mandate.parsed_strategy_summary || mandate.parsed_strategy_summary.trim() === '') {
      missing.push('parsed_strategy_summary');
    }
    if (mandate.take_profit_level == null || !Number.isFinite(mandate.take_profit_level)) {
      missing.push('take_profit_level');
    }
    if (mandate.min_balance_floor == null || !Number.isFinite(mandate.min_balance_floor)) {
      missing.push('min_balance_floor');
    }

    if (missing.length > 0 || !mandate.confirmed_at) {
      this.emitWireTrace(
        marketId,
        'RISK_AGENT',
        'PLAYER',
        'RISK_GATE_BLOCKED',
        `Blocked strategy entry — missing mandatory Risk Gate fields: [${missing.join(', ') || 'confirmation'}]`
      );
      throw new RiskGateError(
        `Hard Risk Gate (FR-04) blocked execution: missing [${missing.join(', ') || 'explicit confirmation'}]`,
        missing
      );
    }

    const m = this.getMarket(marketId);
    this.emitWireTrace(
      marketId,
      'PLAYER',
      'RISK_AGENT',
      `CONFIRM_RISK_GATE_${mandate.input_modality.toUpperCase()}`,
      `Confirmed 3-part Risk Gate: Summary="${mandate.parsed_strategy_summary}", TP=@${mandate.take_profit_level}, Floor=@${mandate.min_balance_floor} CHIP`
    );

    const list = this.mandatesByMarket.get(marketId) ?? [];
    list.push({ ...mandate });
    this.mandatesByMarket.set(marketId, list);

    const createdOrders: Order[] = [];
    let updatedMarket = m;
    let position: Position | undefined;

    if (m.archetype === 'spread') {
      const side = normalizeSpreadSide(mandate.side);
      const lots = Math.max(1, Math.min(m.toggles.max_lots, Math.round(mandate.stake_toks / m.lot_stake_k)));
      const res = this.spreadBook.takeSpreadPosition(
        updatedMarket,
        mandate.player_id,
        side,
        lots,
        `${idempotencyKey}:spread_take`
      );
      updatedMarket = res.market;
      position = res.position;
      this.recordSwimlane(marketId, mandate.player_id, 'OPEN', 'B', `Voice/AI Take ${lots}x ${side}`, -position.staked_toks);

      // Also register an AUTO_SELL rule at take_profit_level
      this.p2p.postAskOrAutoSell(
        updatedMarket,
        mandate.player_id,
        side,
        mandate.take_profit_level!,
        'AUTO_SELL',
        `${idempotencyKey}:autosell`
      );
    } else {
      const side =
        mandate.side === 'NO' || mandate.side === 'UNDER' ? mandate.side : ('YES' as const);

      if (mandate.entry_trigger_level != null) {
        // Place limit_buy at entry_trigger_level
        const limRes = this.poolBook.placeOrder(
          updatedMarket,
          mandate.player_id,
          side,
          'limit_buy',
          mandate.entry_trigger_level,
          mandate.stake_toks,
          `${idempotencyKey}:lim_entry`,
          mandate.id
        );
        updatedMarket = limRes.market;
        createdOrders.push(limRes.order);
        this.recordSwimlane(
          marketId,
          mandate.player_id,
          'OPEN',
          'L',
          `Limit Buy @ ${mandate.entry_trigger_level}%`,
          -mandate.stake_toks
        );
      } else {
        // Immediate pool entry + attach public Take-Profit and Stop-Loss Floor orders
        const enterRes = this.poolBook.enterPoolPosition(
          updatedMarket,
          mandate.player_id,
          side,
          mandate.stake_toks,
          `${idempotencyKey}:pool_entry`
        );
        updatedMarket = enterRes.market;
        position = enterRes.position;
        this.recordSwimlane(
          marketId,
          mandate.player_id,
          'OPEN',
          'B',
          `AI Strategy Entry (${mandate.stake_toks} CHIP)`,
          -mandate.stake_toks
        );

        const tpOrder = this.poolBook.placeOrder(
          updatedMarket,
          mandate.player_id,
          side,
          'take_profit',
          mandate.take_profit_level!,
          mandate.stake_toks,
          `${idempotencyKey}:tp`,
          mandate.id
        );
        updatedMarket = tpOrder.market;
        createdOrders.push(tpOrder.order);

        const slOrder = this.poolBook.placeOrder(
          updatedMarket,
          mandate.player_id,
          side,
          'stop_loss',
          mandate.min_balance_floor!,
          mandate.stake_toks,
          `${idempotencyKey}:sl`,
          mandate.id
        );
        updatedMarket = slOrder.market;
        createdOrders.push(slOrder.order);

        this.recordSwimlane(
          marketId,
          mandate.player_id,
          'MID',
          'L',
          `TP @ ${mandate.take_profit_level} / Floor @ ${mandate.min_balance_floor} CHIP`
        );
      }
    }

    this.markets.set(marketId, updatedMarket);
    this.emitWireTrace(
      marketId,
      'RISK_AGENT',
      'MARKET_ENGINE',
      'STRATEGY_ACTIVATED',
      `Activated mandate ${mandate.id} for ${mandate.player_id}`,
      -mandate.stake_toks
    );
    this.syncChildStackedMarkets(marketId, `${idempotencyKey}:stacked`);

    return { market: { ...updatedMarket }, mandate, createdOrders, position };
  }

  /**
   * Executes a 1-tap manual take or pool entry (bypasses conversational Risk Gate per SPEC §3.3).
   */
  public executeOneTapTake(
    marketId: string,
    playerId: string,
    side: 'OVER' | 'UNDER' | 'YES' | 'NO',
    lotsOrToks: number,
    idempotencyKey: string
  ): { market: Market; position: Position } {
    const m = this.getMarket(marketId);
    if (m.archetype === 'spread') {
      const spreadSide = side === 'UNDER' || side === 'NO' ? 'UNDER' : 'OVER';
      const res = this.spreadBook.takeSpreadPosition(m, playerId, spreadSide, lotsOrToks, idempotencyKey);
      this.markets.set(marketId, res.market);
      this.recordSwimlane(
        marketId,
        playerId,
        m.state === 'live' ? 'LIVE' : 'OPEN',
        'B',
        `1-Tap ${lotsOrToks}x ${spreadSide}`,
        -res.position.staked_toks
      );
      this.emitWireTrace(
        marketId,
        'PLAYER',
        'MARKET_ENGINE',
        'ONE_TAP_TAKE',
        `${playerId} took ${lotsOrToks}x ${spreadSide} (${res.position.staked_toks} CHIP escrowed)`,
        -res.position.staked_toks
      );
      this.syncChildStackedMarkets(marketId, `${idempotencyKey}:stacked`);
      return res;
    } else {
      const stakeToks = lotsOrToks <= 5 ? lotsOrToks * m.lot_stake_k : lotsOrToks;
      const res = this.poolBook.enterPoolPosition(m, playerId, side, stakeToks, idempotencyKey);
      this.markets.set(marketId, res.market);
      this.recordMainLinePoint(marketId, `TAKE_${playerId.toUpperCase()}`, res.market.live_implied_value);
      this.recordSwimlane(
        marketId,
        playerId,
        'OPEN',
        'B',
        `1-Tap ${side} (${stakeToks} CHIP)`,
        -stakeToks
      );
      this.emitWireTrace(
        marketId,
        'PLAYER',
        'MARKET_ENGINE',
        'ONE_TAP_POOL_ENTRY',
        `${playerId} entered ${side} for ${stakeToks} CHIP -> odds now ${res.market.live_implied_value}%`,
        -stakeToks
      );
      this.logCascadesToWireAndSwimlanes(marketId, res.cascades);
      this.syncChildStackedMarkets(marketId, `${idempotencyKey}:stacked`);
      return { market: res.market, position: res.position };
    }
  }

  /**
   * Partial or Full Pool Withdrawal (`p in (0, 1]`) with automatic stop/limit cascade processing.
   */
  public withdrawFromPool(
    marketId: string,
    playerId: string,
    side: PositionSide,
    fractionP: number,
    idempotencyKey: string
  ): { market: Market; withdrawnToks: number; cascades: CascadeStepLog[] } {
    const m = this.getMarket(marketId);
    const res = this.poolBook.withdrawPoolPosition(m, playerId, side, fractionP, idempotencyKey);
    this.markets.set(marketId, res.market);
    this.recordMainLinePoint(marketId, `WITHDRAW_${playerId.toUpperCase()}`, res.market.live_implied_value);

    const code: SwimlaneNodeCode = fractionP >= 1 ? 'X' : 'W';
    this.recordSwimlane(
      marketId,
      playerId,
      'LIVE',
      code,
      `${fractionP >= 1 ? 'Exit All' : `Withdraw ${Math.round(fractionP * 100)}%`} (+${res.withdrawnToks} CHIP)`,
      res.withdrawnToks
    );
    this.emitWireTrace(
      marketId,
      'PLAYER',
      'MARKET_ENGINE',
      fractionP >= 1 ? 'FULL_POOL_EXIT' : 'PARTIAL_POOL_WITHDRAW',
      `${playerId} withdrew ${Math.round(fractionP * 100)}% (${res.withdrawnToks} CHIP) -> odds shifted to ${res.market.live_implied_value}%`,
      res.withdrawnToks
    );
    this.logCascadesToWireAndSwimlanes(marketId, res.cascades);
    this.syncChildStackedMarkets(marketId, `${idempotencyKey}:stacked`);

    return { market: res.market, withdrawnToks: res.withdrawnToks, cascades: res.cascades };
  }

  /**
   * Settles a market at `outcomeX` and triggers evaluation of any Stacked child markets.
   */
  public settleMarket(
    marketId: string,
    outcomeX: number,
    idempotencyKey: string
  ): { market: Market; netPnlByPlayer: Record<string, number> } {
    const m = this.getMarket(marketId);
    let settled: Market;
    let netPnlByPlayer: Record<string, number>;

    if (m.archetype === 'spread') {
      const res = this.spreadBook.settleSpreadMarket(m, outcomeX, idempotencyKey);
      settled = res.market;
      netPnlByPlayer = res.netPnlByPlayer;
    } else {
      const res = this.poolBook.settlePoolMarket(m, outcomeX, idempotencyKey);
      settled = res.market;
      netPnlByPlayer = res.netPnlByPlayer;
    }

    this.markets.set(marketId, settled);
    this.lastSettlementNetPnlByMarket.set(marketId, netPnlByPlayer);
    this.recordMainLinePoint(marketId, 'SETTLE', outcomeX);

    for (const [pid, pnl] of Object.entries(netPnlByPlayer)) {
      this.recordSwimlane(
        marketId,
        pid,
        'SETTLE',
        'X',
        `Settled @ X=${outcomeX} (${pnl >= 0 ? '+' : ''}${pnl} CHIP)`,
        pnl
      );
    }

    this.emitWireTrace(
      marketId,
      'MARKET_ENGINE',
      'BROADCAST',
      'MARKET_SETTLED',
      `Market settled at X=${outcomeX}. Zero-sum ledger verified.`
    );

    this.syncChildStackedMarkets(marketId, `${idempotencyKey}:stacked`);
    return { market: settled, netPnlByPlayer };
  }

  /**
   * Voids a market and refunds all escrowed stakes, propagating to child Stacked markets per SPEC §6.2.
   */
  public voidMarket(marketId: string, idempotencyKey: string): Market {
    const m = this.getMarket(marketId);
    let voided: Market;
    if (m.archetype === 'spread') {
      const positions = this.spreadBook.getPositions(marketId);
      positions.forEach((p, idx) => {
        if (p.staked_toks > 0) {
          this.ledger.releaseEscrow(
            p.player_id,
            marketId,
            p.staked_toks,
            'VOID_REFUND',
            `${idempotencyKey}:vpos_${idx}`,
            'Void market refund'
          );
          p.staked_toks = 0;
          p.lots = 0;
        }
      });
      this.spreadBook.setPositions(marketId, positions);
      const mmEsc = this.spreadBook.getMmEscrow(marketId);
      if (mmEsc > 0 && m.mm_player_id) {
        this.ledger.releaseEscrow(
          m.mm_player_id,
          marketId,
          mmEsc,
          'VOID_REFUND',
          `${idempotencyKey}:vmm`,
          'Void MM refund'
        );
      }
      voided = { ...m, state: 'void', version: m.version + 1 };
    } else {
      voided = this.poolBook.voidPoolMarket(m, idempotencyKey);
    }

    this.markets.set(marketId, voided);
    this.emitWireTrace(
      marketId,
      'MARKET_ENGINE',
      'BROADCAST',
      'MARKET_VOIDED',
      `Market ${marketId} voided — all escrowed CHIP refunded.`
    );
    this.syncChildStackedMarkets(marketId, `${idempotencyKey}:stacked`);
    return voided;
  }

  public syncChildStackedMarkets(parentMarketId: string, idempotencyKey: string): void {
    const parent = this.markets.get(parentMarketId);
    if (!parent) return;

    const parentPositions = this.getMarketPositions(parentMarketId);
    const currentVolumeToks = parentPositions.reduce((acc, p) => acc + p.entry_cost_toks, 0);
    const netPnlByPlayer = this.lastSettlementNetPnlByMarket.get(parentMarketId);

    for (const m of this.markets.values()) {
      if (m.parent_market_id === parentMarketId && m.state !== 'settled' && m.state !== 'void') {
        const evalRes = evaluateStackedMarket(m, {
          parentMarket: parent,
          currentVolumeToks,
          netPnlByPlayer,
        });
        this.markets.set(m.id, evalRes.updatedChildMarket);
        if (evalRes.action === 'SETTLE' && evalRes.outcomeX != null) {
          this.emitWireTrace(
            m.id,
            'MARKET_ENGINE',
            'BROADCAST',
            'STACKED_TRIGGER_SETTLE',
            evalRes.reason ?? 'Stacked market condition met'
          );
          this.settleMarket(m.id, evalRes.outcomeX, `${idempotencyKey}:child_${m.id}`);
        } else if (evalRes.action === 'VOID') {
          this.emitWireTrace(
            m.id,
            'MARKET_ENGINE',
            'BROADCAST',
            'STACKED_PARENT_VOID',
            evalRes.reason ?? 'Parent market voided'
          );
          this.voidMarket(m.id, `${idempotencyKey}:child_void_${m.id}`);
        }
      }
    }
  }

  public logCascadesToWireAndSwimlanes(marketId: string, cascades: CascadeStepLog[]): void {
    for (const c of cascades) {
      const code: SwimlaneNodeCode =
        c.type === 'limit_buy' || c.type === 'limit_sell' ? 'F' : 'S';
      this.recordSwimlane(
        marketId,
        c.playerId,
        'LIVE',
        code,
        `${c.type.toUpperCase()} @ ${c.triggerLevel} (${c.sizeToks} CHIP)`
      );
      this.emitWireTrace(
        marketId,
        'MARKET_ENGINE',
        'BROADCAST',
        `CASCADE_${c.type.toUpperCase()}`,
        `Order ${c.orderId} (${c.playerId}) triggered @ ${c.triggerLevel} -> odds ${c.impliedValueBefore}% => ${c.impliedValueAfter}%`,
        c.sizeToks
      );
      this.recordMainLinePoint(marketId, `CASCADE_${c.type.toUpperCase()}`, c.impliedValueAfter);
    }
  }

  public exportSnapshot() {
    const mapToObj = <T>(m: Map<string, T>): Record<string, T> => {
      const out: Record<string, T> = {};
      for (const [k, v] of m.entries()) {
        out[k] = v;
      }
      return out;
    };

    return {
      clockNow: this.clock.now(),
      wireSeq: this.wireSeq,
      markets: Array.from(this.markets.values()).map((m) => ({ ...m, toggles: { ...m.toggles } })),
      ledger: this.ledger.exportState(),
      auction: this.auction.exportState(),
      spreadBook: this.spreadBook.exportState(),
      p2p: this.p2p.exportState(),
      poolBook: this.poolBook.exportState(),
      resolution: this.resolution.exportState(),
      mandatesByMarket: mapToObj(this.mandatesByMarket),
      swimlanesByMarket: mapToObj(this.swimlanesByMarket),
      wireTracesByMarket: mapToObj(this.wireTracesByMarket),
      liveEventsByMarket: mapToObj(this.liveEventsByMarket),
      historyByMarket: mapToObj(this.historyByMarket),
      lastSettlementNetPnlByMarket: mapToObj(this.lastSettlementNetPnlByMarket),
      classificationLogs: [...this.classificationLogs],
    };
  }

  public importSnapshot(snapshot: any): void {
    if (!snapshot) return;
    this.wireSeq = snapshot.wireSeq ?? 0;
    this.markets.clear();
    for (const m of snapshot.markets ?? []) {
      this.markets.set(m.id, { ...m, toggles: { ...m.toggles } });
    }
    if (snapshot.ledger) this.ledger.importState(snapshot.ledger);
    if (snapshot.auction) this.auction.importState(snapshot.auction);
    if (snapshot.spreadBook) this.spreadBook.importState(snapshot.spreadBook);
    if (snapshot.p2p) this.p2p.importState(snapshot.p2p);
    if (snapshot.poolBook) this.poolBook.importState(snapshot.poolBook);
    if (snapshot.resolution) this.resolution.importState(snapshot.resolution);

    const loadMap = <T>(target: Map<string, T>, obj?: Record<string, T>) => {
      target.clear();
      for (const [k, v] of Object.entries(obj ?? {})) {
        target.set(k, v);
      }
    };

    loadMap(this.mandatesByMarket, snapshot.mandatesByMarket);
    loadMap(this.swimlanesByMarket, snapshot.swimlanesByMarket);
    loadMap(this.wireTracesByMarket, snapshot.wireTracesByMarket);
    loadMap(this.liveEventsByMarket, snapshot.liveEventsByMarket);
    loadMap(this.historyByMarket, snapshot.historyByMarket);
    loadMap(this.lastSettlementNetPnlByMarket, snapshot.lastSettlementNetPnlByMarket);
    this.classificationLogs = Array.isArray(snapshot.classificationLogs)
      ? [...snapshot.classificationLogs]
      : [];
  }
}
