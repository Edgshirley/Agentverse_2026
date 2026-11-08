// ============================================================================
// Continuous Mark-to-Market Pool, Partial Withdrawals & Cascading Order Book
// (SPEC §1.2, §1.3, §2.4.B, §6.2)
// ============================================================================

import { Clock } from './clock';
import { ToksLedger } from './ledger';
import { Market, Order, OrderType, Position, PositionSide } from '../shared/types';

export class PoolOrderBookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoolOrderBookError';
  }
}

export interface CascadeStepLog {
  orderId: string;
  playerId: string;
  type: OrderType;
  side: PositionSide;
  triggerLevel: number;
  sizeToks: number;
  impliedValueBefore: number;
  impliedValueAfter: number;
}

export class ContinuousPoolOrderBook {
  private positionsByMarket: Map<string, Position[]> = new Map();
  private ordersByMarket: Map<string, Order[]> = new Map();
  private seq: number = 0;

  /**
   * Positions held outside this pool (spread/window markets keep their bets in the
   * SpreadMarketBook). Lets players attach stop-loss / take-profit orders to those bets.
   * Wired up by the state machine.
   */
  public hasExternalLivePosition: (marketId: string, playerId: string, side: PositionSide) => boolean =
    () => false;

  constructor(
    private readonly clock: Clock,
    private readonly ledger: ToksLedger
  ) {}

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.clock.now()}_${this.seq}`;
  }

  public getPositions(marketId: string): Position[] {
    return (this.positionsByMarket.get(marketId) ?? []).map((p) => ({ ...p }));
  }

  public getOrders(marketId: string): Order[] {
    return (this.ordersByMarket.get(marketId) ?? []).map((o) => ({ ...o }));
  }

  public getAllOrders(): Order[] {
    const all: Order[] = [];
    for (const list of this.ordersByMarket.values()) {
      for (const o of list) all.push({ ...o });
    }
    return all;
  }

  public cancelOrder(
    market: Market,
    orderId: string,
    playerId: string,
    idempotencyKey: string
  ): Order {
    const list = this.ordersByMarket.get(market.id) ?? [];
    const order = list.find((o) => o.id === orderId);
    if (!order || order.status !== 'open') {
      throw new PoolOrderBookError(`Order ${orderId} is not open`);
    }
    if (order.player_id !== playerId) {
      throw new PoolOrderBookError(`Only ${order.player_id} can cancel order ${orderId}`);
    }
    if (order.escrowed_toks > 0) {
      this.ledger.releaseEscrow(
        order.player_id,
        market.id,
        order.escrowed_toks,
        'ESCROW_RELEASE',
        `${idempotencyKey}:cancel_ord`,
        `Cancelled open order ${order.id}`
      );
      order.escrowed_toks = 0;
    }
    order.status = 'cancelled';
    return { ...order };
  }

  public exportState() {
    const positionsByMarket: Record<string, Position[]> = {};
    for (const [k, v] of this.positionsByMarket.entries()) {
      positionsByMarket[k] = v.map((p) => ({ ...p }));
    }
    const ordersByMarket: Record<string, Order[]> = {};
    for (const [k, v] of this.ordersByMarket.entries()) {
      ordersByMarket[k] = v.map((o) => ({ ...o }));
    }
    return {
      positionsByMarket,
      ordersByMarket,
      seq: this.seq,
    };
  }

  public importState(data: {
    positionsByMarket?: Record<string, Position[]>;
    ordersByMarket?: Record<string, Order[]>;
    seq?: number;
  }): void {
    this.positionsByMarket.clear();
    this.ordersByMarket.clear();
    this.seq = data.seq ?? 0;
    for (const [k, list] of Object.entries(data.positionsByMarket ?? {})) {
      this.positionsByMarket.set(
        k,
        list.map((p) => ({ ...p }))
      );
    }
    for (const [k, list] of Object.entries(data.ordersByMarket ?? {})) {
      this.ordersByMarket.set(
        k,
        list.map((o) => ({ ...o }))
      );
    }
  }

  private assertTradable(market: Market, playerId?: string): void {
    if (market.state !== 'open' && market.state !== 'live') {
      throw new PoolOrderBookError(
        `Continuous pool trading & withdrawals are frozen in state '${market.state}'`
      );
    }
    if (playerId && market.arbiter_id && market.arbiter_id === playerId) {
      throw new PoolOrderBookError('Designated 3rd-party arbiter cannot trade in this market');
    }
  }

  /**
   * Enters a continuous pool position (`YES`/`OVER` vs `NO`/`UNDER`) with integer `stakeToks`.
   * Recalculates implied odds and mark-to-market `live_equity_toks` for all participants,
   * and atomically resolves any triggered limit/stop cascades.
   */
  public enterPoolPosition(
    market: Market,
    playerId: string,
    side: 'YES' | 'NO' | 'OVER' | 'UNDER',
    stakeToks: number,
    idempotencyKey: string
  ): { market: Market; position: Position; cascades: CascadeStepLog[] } {
    this.assertTradable(market, playerId);
    ToksLedger.assertIntegerToks(stakeToks, 'stakeToks');
    if (stakeToks <= 0) {
      throw new PoolOrderBookError('Pool entry stakeToks must be > 0');
    }

    this.ledger.lockEscrow(
      playerId,
      market.id,
      stakeToks,
      'ESCROW_LOCK',
      `${idempotencyKey}:pool_enter`,
      `${playerId} enters ${side} pool with ${stakeToks} CHIP`
    );

    const positions = this.positionsByMarket.get(market.id) ?? [];
    const now = this.clock.now();
    let pos = positions.find(
      (p) => p.player_id === playerId && p.side === side && p.current_shares > 0
    );

    // Price per share based on current implied odds on that side (normalized around 50% = 1 share per TOK)
    const sideProb = this.getSideProbability(market.live_implied_value, side);
    const acquiredShares = stakeToks * (0.5 / Math.max(0.15, Math.min(0.85, sideProb)));

    if (pos) {
      pos.lots += 1;
      pos.staked_toks += stakeToks;
      pos.entry_cost_toks += stakeToks;
      pos.current_shares += acquiredShares;
      pos.updated_at = now;
    } else {
      pos = {
        id: this.nextId('ppos'),
        market_id: market.id,
        player_id: playerId,
        side,
        lots: 1,
        staked_toks: stakeToks,
        entry_cost_toks: stakeToks,
        realized_pnl_toks: 0,
        current_shares: acquiredShares,
        live_equity_toks: stakeToks,
        withdrawn_toks: 0,
        is_hidden: false,
        updated_at: now,
      };
      positions.push(pos);
    }

    this.positionsByMarket.set(market.id, positions);

    let updatedMarket = this.recalculatePoolMtm(market);
    const cascades = this.processCascades(updatedMarket, `${idempotencyKey}:cascade`);
    if (cascades.length > 0) {
      updatedMarket = {
        ...updatedMarket,
        live_implied_value: cascades[cascades.length - 1].impliedValueAfter,
        version: updatedMarket.version + 1,
      };
    }

    const latestPos = (this.positionsByMarket.get(market.id) ?? []).find((p) => p.id === pos!.id)!;
    return { market: updatedMarket, position: { ...latestPos }, cascades };
  }

  /**
   * Anytime Partial or Full Pool Withdrawal (SPEC §2.4.B.1 & §6.2):
   * Any participant with `live_equity_toks > 0` can withdraw fraction `fractionP` in (0, 1].
   * Rejects immediately when `live_equity_toks == 0`.
   * Releases the liquidated CHIP back to the player's wallet and shifts implied odds for remaining holders.
   */
  public withdrawPoolPosition(
    market: Market,
    playerId: string,
    side: PositionSide,
    fractionP: number,
    idempotencyKey: string
  ): { market: Market; withdrawnToks: number; position: Position; cascades: CascadeStepLog[] } {
    this.assertTradable(market, playerId);
    if (!Number.isFinite(fractionP) || fractionP <= 0 || fractionP > 1) {
      throw new PoolOrderBookError(`Withdrawal fraction p must be in (0, 1], got ${fractionP}`);
    }

    // Ensure MTM equity is fresh before withdrawal
    let currentMarket = this.recalculatePoolMtm(market);
    const positions = this.positionsByMarket.get(market.id) ?? [];
    const pos = positions.find((p) => p.player_id === playerId && p.side === side);

    if (!pos || pos.live_equity_toks <= 0 || pos.current_shares <= 0) {
      throw new PoolOrderBookError(
        `Withdrawal rejected: ${playerId} has live_equity_toks == 0 on ${side} (SPEC §6.2)`
      );
    }

    const withdrawnToks =
      fractionP === 1
        ? pos.live_equity_toks
        : Math.max(1, Math.floor(pos.live_equity_toks * fractionP));

    // Rebalance escrow across pool participants so `withdrawnToks` can be cleanly released from playerId's escrow
    this.rebalanceEscrowToMatchLiveEquity(market.id, `${idempotencyKey}:rebal`);

    this.ledger.releaseEscrow(
      playerId,
      market.id,
      withdrawnToks,
      'PARTIAL_WITHDRAWAL',
      `${idempotencyKey}:withdraw`,
      `Pool withdrawal (${Math.round(fractionP * 100)}%) of ${withdrawnToks} CHIP from ${side}`
    );

    const costSlice =
      fractionP === 1 ? pos.entry_cost_toks : Math.floor(pos.entry_cost_toks * fractionP);
    pos.staked_toks -= withdrawnToks;
    pos.live_equity_toks -= withdrawnToks;
    pos.entry_cost_toks = Math.max(0, pos.entry_cost_toks - costSlice);
    pos.realized_pnl_toks += withdrawnToks - costSlice;
    pos.withdrawn_toks += withdrawnToks;
    pos.current_shares = fractionP === 1 ? 0 : pos.current_shares * (1 - fractionP);
    if (pos.current_shares <= 1e-6 || pos.live_equity_toks === 0) {
      pos.current_shares = 0;
      pos.lots = 0;
    }
    pos.updated_at = this.clock.now();

    currentMarket = this.recalculatePoolMtm(currentMarket);
    const cascades = this.processCascades(currentMarket, `${idempotencyKey}:cascade`);
    if (cascades.length > 0) {
      currentMarket = {
        ...currentMarket,
        live_implied_value: cascades[cascades.length - 1].impliedValueAfter,
        version: currentMarket.version + 1,
      };
    }

    this.ledger.assertInvariants();
    return {
      market: currentMarket,
      withdrawnToks,
      position: { ...pos },
      cascades,
    };
  }

  /**
   * Places a balance-backed public Limit or Stop order on the Swing Map (SPEC §2.4.B.2 & §2.4.B.3).
   */
  public placeOrder(
    market: Market,
    playerId: string,
    side: PositionSide,
    type: OrderType,
    triggerLevel: number,
    sizeToks: number,
    idempotencyKey: string,
    mandateId?: string
  ): { order: Order; market: Market; cascades: CascadeStepLog[] } {
    this.assertTradable(market, playerId);
    ToksLedger.assertIntegerToks(sizeToks, 'sizeToks');
    if (sizeToks <= 0) {
      throw new PoolOrderBookError('Order sizeToks must be > 0');
    }

    let escrowedToks = 0;
    if (type === 'limit_buy') {
      // Balance-backed limit_buy locks sizeToks in escrow
      this.ledger.lockEscrow(
        playerId,
        market.id,
        sizeToks,
        'ESCROW_LOCK',
        `${idempotencyKey}:limit_lock`,
        `Limit Buy escrow lock (${sizeToks} CHIP @ ${triggerLevel})`
      );
      escrowedToks = sizeToks;
    } else {
      // Verify player holds an active position on `side` for limit_sell / stop_loss / take_profit
      const positions = this.positionsByMarket.get(market.id) ?? [];
      const pos = positions.find(
        (p) => p.player_id === playerId && p.side === side && p.live_equity_toks > 0
      );
      if (!pos && !this.hasExternalLivePosition(market.id, playerId, side)) {
        throw new PoolOrderBookError(
          `Cannot place ${type} without an active position on ${side} with live_equity > 0`
        );
      }
    }

    const order: Order = {
      id: this.nextId('ord'),
      market_id: market.id,
      player_id: playerId,
      side,
      type,
      trigger_level: triggerLevel,
      size_toks: sizeToks,
      escrowed_toks: escrowedToks,
      status: 'open',
      visible_to_group: true, // Public Swing Map invariant
      mandate_id: mandateId ?? null,
      created_at: this.clock.now(),
    };

    const list = this.ordersByMarket.get(market.id) ?? [];
    list.push(order);
    this.ordersByMarket.set(market.id, list);

    // Check if order triggers immediately at current market odds
    let updatedMarket = { ...market, version: market.version + 1 };
    const cascades = this.processCascades(updatedMarket, `${idempotencyKey}:imm_cascade`);
    if (cascades.length > 0) {
      updatedMarket.live_implied_value = cascades[cascades.length - 1].impliedValueAfter;
    }

    return { order: { ...order }, market: updatedMarket, cascades };
  }

  /**
   * Updates market implied value from an external event (e.g., Live Feed goal/weather tick)
   * and atomically resolves all triggered limit/stop orders in price-time priority (SPEC §6.2).
   */
  public applyExternalOddsShift(
    market: Market,
    newImpliedValue: number,
    idempotencyKey: string
  ): { market: Market; cascades: CascadeStepLog[] } {
    let updatedMarket = this.recalculatePoolMtm(market, newImpliedValue);
    const cascades = this.processCascades(updatedMarket, idempotencyKey);
    if (cascades.length > 0) {
      updatedMarket = {
        ...updatedMarket,
        live_implied_value: cascades[cascades.length - 1].impliedValueAfter,
        version: updatedMarket.version + 1,
      };
    }
    return { market: updatedMarket, cascades };
  }

  /**
   * Settles a continuous pool market at outcome X (`100` / `YES` / `OVER` vs `0` / `NO` / `UNDER`).
   */
  public settlePoolMarket(
    market: Market,
    outcomeX: number,
    idempotencyKey: string
  ): { market: Market; netPnlByPlayer: Record<string, number> } {
    // First cancel and refund any unfilled limit_buy escrows
    const orders = this.ordersByMarket.get(market.id) ?? [];
    orders.forEach((o, idx) => {
      if (o.status === 'open') {
        if (o.escrowed_toks > 0) {
          this.ledger.releaseEscrow(
            o.player_id,
            market.id,
            o.escrowed_toks,
            'ESCROW_RELEASE',
            `${idempotencyKey}:cancel_ord_${idx}`,
            `Refund unfilled limit_buy ${o.id} on market settlement`
          );
          o.escrowed_toks = 0;
        }
        o.status = 'cancelled';
      }
    });

    const positions = (this.positionsByMarket.get(market.id) ?? []).filter(
      (p) => p.staked_toks > 0 || p.current_shares > 0
    );
    const totalPoolEscrow = positions.reduce((acc, p) => acc + p.staked_toks, 0);

    if (totalPoolEscrow > 0) {
      const midpoint = (market.bounds[0] + market.bounds[1]) / 2;
      const winningSideIsBull = outcomeX > midpoint || outcomeX === 1;
      const winners = positions.filter((p) => {
        const isBull = p.side === 'YES' || p.side === 'OVER';
        return (winningSideIsBull ? isBull : !isBull) && p.current_shares > 0;
      });

      const totalWinnerShares = winners.reduce((acc, p) => acc + p.current_shares, 0);
      const legsByPlayer: Map<string, { escrowRelease: number; walletCredit: number }> = new Map();

      const addLeg = (pid: string, escRel: number, walCred: number) => {
        const cur = legsByPlayer.get(pid) ?? { escrowRelease: 0, walletCredit: 0 };
        cur.escrowRelease += escRel;
        cur.walletCredit += walCred;
        legsByPlayer.set(pid, cur);
      };

      if (totalWinnerShares > 0) {
        let distributed = 0;
        for (const p of positions) {
          const isWinner = winners.some((w) => w.id === p.id);
          const sharePayout = isWinner
            ? Math.floor((totalPoolEscrow * p.current_shares) / totalWinnerShares)
            : 0;
          p.live_equity_toks = sharePayout;
          distributed += sharePayout;
          addLeg(p.player_id, p.staked_toks, sharePayout);
        }
        // Route any integer division remainder to proposer/first winner
        const remainder = totalPoolEscrow - distributed;
        if (remainder > 0) {
          const recipient = winners[0].player_id;
          addLeg(recipient, 0, remainder);
        }
      } else {
        // No shares on winning side -> refund remaining pool stakes pro-rata
        for (const p of positions) {
          p.live_equity_toks = p.staked_toks;
          addLeg(p.player_id, p.staked_toks, p.staked_toks);
        }
      }

      const legs = Array.from(legsByPlayer.entries()).map(([playerId, amounts]) => ({
        playerId,
        escrowRelease: amounts.escrowRelease,
        walletCredit: amounts.walletCredit,
        note: `Pool settlement at X=${outcomeX}`,
      }));

      this.ledger.settleEscrowBatch(market.id, legs, 'SETTLEMENT_PAYOUT', `${idempotencyKey}:settle`);
      for (const p of positions) {
        p.staked_toks = 0;
        p.current_shares = 0;
      }
    }

    const netPnlByPlayer: Record<string, number> = {};
    for (const entry of this.ledger.getEntries(market.id)) {
      if (entry.account === 'wallet') {
        netPnlByPlayer[entry.player_id] = (netPnlByPlayer[entry.player_id] ?? 0) + entry.delta_toks;
      }
    }

    const settled: Market = {
      ...market,
      state: 'settled',
      outcome_x: outcomeX,
      live_implied_value: outcomeX,
      version: market.version + 1,
    };

    return { market: settled, netPnlByPlayer };
  }

  /**
   * Voids a pool market and refunds all escrowed CHIP (e.g. parent market voided per SPEC §6.2).
   */
  public voidPoolMarket(market: Market, idempotencyKey: string): Market {
    const orders = this.ordersByMarket.get(market.id) ?? [];
    orders.forEach((o, idx) => {
      if (o.status === 'open' && o.escrowed_toks > 0) {
        this.ledger.releaseEscrow(
          o.player_id,
          market.id,
          o.escrowed_toks,
          'VOID_REFUND',
          `${idempotencyKey}:void_ord_${idx}`,
          `Void refund for open order ${o.id}`
        );
        o.escrowed_toks = 0;
        o.status = 'cancelled';
      }
    });

    const positions = this.positionsByMarket.get(market.id) ?? [];
    positions.forEach((p, idx) => {
      if (p.staked_toks > 0) {
        this.ledger.releaseEscrow(
          p.player_id,
          market.id,
          p.staked_toks,
          'VOID_REFUND',
          `${idempotencyKey}:void_pos_${idx}`,
          `Void refund for pool position ${p.id}`
        );
        p.staked_toks = 0;
        p.live_equity_toks = 0;
        p.current_shares = 0;
      }
    });

    return {
      ...market,
      state: 'void',
      version: market.version + 1,
    };
  }

  private getSideProbability(impliedValuePct: number, side: PositionSide): number {
    const clampedPct = Math.max(5, Math.min(95, impliedValuePct));
    const isBull = side === 'YES' || side === 'OVER';
    return isBull ? clampedPct / 100 : (100 - clampedPct) / 100;
  }

  /**
   * Recalculates continuous implied odds (`live_implied_value` in 5..95) and each position's
   * `live_equity_toks` so that `sum(live_equity_toks) === sum(staked_toks)` (strict zero-sum pool!).
   */
  public recalculatePoolMtm(market: Market, forcedImpliedValue?: number): Market {
    const positions = (this.positionsByMarket.get(market.id) ?? []).filter(
      (p) => p.current_shares > 0 && p.staked_toks > 0
    );
    const totalPoolToks = positions.reduce((acc, p) => acc + p.staked_toks, 0);

    if (positions.length === 0 || totalPoolToks === 0) {
      return {
        ...market,
        live_implied_value: forcedImpliedValue ?? market.live_implied_value,
      };
    }

    let bullShares = 0;
    let bearShares = 0;
    for (const p of positions) {
      if (p.side === 'YES' || p.side === 'OVER') {
        bullShares += p.current_shares;
      } else {
        bearShares += p.current_shares;
      }
    }

    // Add virtual liquidity anchor (250 shares each side) so single-sided entry shifts odds smoothly
    const virtualAnchor = 250;
    const rawImplied =
      forcedImpliedValue ??
      Math.round(((bullShares + virtualAnchor) / (bullShares + bearShares + 2 * virtualAnchor)) * 100);
    const impliedValue = Math.max(5, Math.min(95, rawImplied));

    // Compute raw mark-to-market weights for each active position
    const weights = positions.map((p) => {
      const prob = this.getSideProbability(impliedValue, p.side);
      return Math.max(0.01, p.current_shares * prob);
    });
    const totalWeight = weights.reduce((acc, w) => acc + w, 0);

    let distributed = 0;
    positions.forEach((p, idx) => {
      const eq = Math.floor((totalPoolToks * weights[idx]) / totalWeight);
      p.live_equity_toks = eq;
      distributed += eq;
    });

    // Give integer rounding remainder to the largest position so sum(live_equity_toks) === totalPoolToks
    const remainder = totalPoolToks - distributed;
    if (remainder > 0 && positions.length > 0) {
      positions[0].live_equity_toks += remainder;
    }

    return {
      ...market,
      live_implied_value: impliedValue,
      version: market.version + 1,
    };
  }

  /**
   * Synchronizes each position's `staked_toks` (and player escrow balances) to match `live_equity_toks`
   * prior to a withdrawal or stop liquidation, preserving strict zero-sum escrow conservation.
   */
  private rebalanceEscrowToMatchLiveEquity(marketId: string, idempotencyKey: string): void {
    const positions = (this.positionsByMarket.get(marketId) ?? []).filter(
      (p) => p.staked_toks > 0 || p.live_equity_toks > 0
    );
    if (positions.length === 0) return;

    // Release old staked_toks and re-lock live_equity_toks via zero-sum adjustments
    positions.forEach((p, idx) => {
      if (p.staked_toks > 0) {
        this.ledger.releaseEscrow(
          p.player_id,
          marketId,
          p.staked_toks,
          'ESCROW_RELEASE',
          `${idempotencyKey}:rel_${idx}`,
          'MTM escrow rebalance release'
        );
      }
    });

    // Transfer net MTM delta between wallets so each player locks their exact `live_equity_toks`
    const gains: Array<{ playerId: string; amount: number }> = [];
    const losses: Array<{ playerId: string; amount: number }> = [];

    for (const p of positions) {
      const diff = p.live_equity_toks - p.staked_toks;
      if (diff > 0) gains.push({ playerId: p.player_id, amount: diff });
      if (diff < 0) losses.push({ playerId: p.player_id, amount: -diff });
    }

    let gIdx = 0;
    let lIdx = 0;
    let step = 0;
    while (gIdx < gains.length && lIdx < losses.length) {
      const transferAmt = Math.min(gains[gIdx].amount, losses[lIdx].amount);
      if (transferAmt > 0) {
        step += 1;
        this.ledger.transferWallet(
          losses[lIdx].playerId,
          gains[gIdx].playerId,
          marketId,
          transferAmt,
          'PARTIAL_WITHDRAWAL',
          `${idempotencyKey}:xfer_${step}`,
          'MTM pool equity rebalance transfer'
        );
      }
      gains[gIdx].amount -= transferAmt;
      losses[lIdx].amount -= transferAmt;
      if (gains[gIdx].amount === 0) gIdx += 1;
      if (losses[lIdx].amount === 0) lIdx += 1;
    }

    positions.forEach((p, idx) => {
      if (p.live_equity_toks > 0) {
        this.ledger.lockEscrow(
          p.player_id,
          marketId,
          p.live_equity_toks,
          'ESCROW_LOCK',
          `${idempotencyKey}:lock_${idx}`,
          'MTM escrow rebalance lock'
        );
      }
      p.staked_toks = p.live_equity_toks;
    });
  }

  /**
   * Atomically resolves all triggered limit/stop orders in price-time priority (SPEC §6.2).
   * Loops until no remaining open orders are crossed.
   */
  public processCascades(market: Market, idempotencyKey: string): CascadeStepLog[] {
    const logs: CascadeStepLog[] = [];
    let currentMarket = { ...market };
    let iter = 0;

    while (iter < 25) {
      iter += 1;
      const openOrders = (this.ordersByMarket.get(market.id) ?? []).filter(
        (o) => o.status === 'open'
      );
      if (openOrders.length === 0) break;

      const positions = this.positionsByMarket.get(market.id) ?? [];

      // Find all orders currently crossed at `currentMarket.live_implied_value` or position equity floor
      const triggered = openOrders.filter((o) =>
        this.isOrderTriggered(o, currentMarket.live_implied_value, positions)
      );

      if (triggered.length === 0) break;

      // Price-time priority sort: most aggressively crossed trigger level first, then earliest created_at
      triggered.sort((a, b) => {
        const distA = Math.abs(currentMarket.live_implied_value - a.trigger_level);
        const distB = Math.abs(currentMarket.live_implied_value - b.trigger_level);
        if (distB !== distA) return distB - distA;
        return a.created_at - b.created_at;
      });

      const nextOrder = triggered[0];
      const beforeVal = currentMarket.live_implied_value;

      if (nextOrder.type === 'limit_buy') {
        // Release the limit_buy order escrow and convert into an active pool position
        const buyAmount = nextOrder.escrowed_toks;
        nextOrder.status = 'filled';
        nextOrder.escrowed_toks = 0;

        this.ledger.releaseEscrow(
          nextOrder.player_id,
          market.id,
          buyAmount,
          'LIMIT_ORDER_FILL',
          `${idempotencyKey}:c_${iter}_rel`,
          `Release limit_buy escrow to fill order ${nextOrder.id}`
        );

        this.ledger.lockEscrow(
          nextOrder.player_id,
          market.id,
          buyAmount,
          'LIMIT_ORDER_FILL',
          `${idempotencyKey}:c_${iter}_lock`,
          `Fill limit_buy ${nextOrder.id} into ${nextOrder.side} pool`
        );

        const sideProb = this.getSideProbability(currentMarket.live_implied_value, nextOrder.side);
        const acquiredShares = buyAmount / Math.max(0.05, Math.min(0.95, sideProb));
        const existingPos = positions.find(
          (p) => p.player_id === nextOrder.player_id && p.side === nextOrder.side
        );
        if (existingPos) {
          existingPos.lots += 1;
          existingPos.staked_toks += buyAmount;
          existingPos.entry_cost_toks += buyAmount;
          existingPos.current_shares += acquiredShares;
        } else {
          positions.push({
            id: this.nextId('ppos'),
            market_id: market.id,
            player_id: nextOrder.player_id,
            side: nextOrder.side,
            lots: 1,
            staked_toks: buyAmount,
            entry_cost_toks: buyAmount,
            realized_pnl_toks: 0,
            current_shares: acquiredShares,
            live_equity_toks: buyAmount,
            withdrawn_toks: 0,
            is_hidden: false,
            updated_at: this.clock.now(),
          });
        }
        this.positionsByMarket.set(market.id, positions);
        const shift = nextOrder.side === 'YES' || nextOrder.side === 'OVER' ? 4 : -4;
        currentMarket = this.recalculatePoolMtm(
          currentMarket,
          Math.max(5, Math.min(95, beforeVal + shift))
        );
      } else {
        // limit_sell, stop_loss, or take_profit -> liquidate up to size_toks (or full position)
        nextOrder.status = 'filled';
        const pos = positions.find(
          (p) =>
            p.player_id === nextOrder.player_id &&
            p.side === nextOrder.side &&
            p.live_equity_toks > 0
        );
        if (pos && pos.live_equity_toks > 0) {
          const liquidateToks = Math.min(pos.live_equity_toks, nextOrder.size_toks);
          const frac = Math.min(1, liquidateToks / pos.live_equity_toks);
          this.rebalanceEscrowToMatchLiveEquity(market.id, `${idempotencyKey}:c_${iter}_rebal`);

          const releaseAmt = Math.min(pos.staked_toks, liquidateToks);
          if (releaseAmt > 0) {
            this.ledger.releaseEscrow(
              nextOrder.player_id,
              market.id,
              releaseAmt,
              'STOP_CASCADE_FILL',
              `${idempotencyKey}:c_${iter}_stop`,
              `Cascade execution of ${nextOrder.type} (${releaseAmt} CHIP)`
            );
            pos.staked_toks -= releaseAmt;
            pos.live_equity_toks -= releaseAmt;
            pos.withdrawn_toks += releaseAmt;
            pos.current_shares = frac >= 1 ? 0 : pos.current_shares * (1 - frac);
            if (pos.current_shares <= 1e-6 || pos.live_equity_toks === 0) {
              pos.current_shares = 0;
              pos.lots = 0;
            }
          }
          const shift = nextOrder.side === 'YES' || nextOrder.side === 'OVER' ? -5 : 5;
          currentMarket = this.recalculatePoolMtm(
            currentMarket,
            Math.max(5, Math.min(95, beforeVal + shift))
          );
        }
      }

      logs.push({
        orderId: nextOrder.id,
        playerId: nextOrder.player_id,
        type: nextOrder.type,
        side: nextOrder.side,
        triggerLevel: nextOrder.trigger_level,
        sizeToks: nextOrder.size_toks,
        impliedValueBefore: beforeVal,
        impliedValueAfter: currentMarket.live_implied_value,
      });
    }

    return logs;
  }

  private isOrderTriggered(order: Order, currentImplied: number, positions: Position[]): boolean {
    const isBull = order.side === 'YES' || order.side === 'OVER';
    if (order.type === 'limit_buy') {
      return isBull ? currentImplied <= order.trigger_level : currentImplied >= order.trigger_level;
    }
    if (order.type === 'limit_sell' || order.type === 'take_profit') {
      const pos = positions.find((p) => p.player_id === order.player_id && p.side === order.side);
      if (!pos || pos.live_equity_toks <= 0) return false;
      // Trigger either on implied odds threshold OR if live_equity_toks >= trigger_level when trigger_level > 100
      if (order.trigger_level > 100) {
        return pos.live_equity_toks >= order.trigger_level;
      }
      return isBull ? currentImplied >= order.trigger_level : currentImplied <= order.trigger_level;
    }
    if (order.type === 'stop_loss') {
      const pos = positions.find((p) => p.player_id === order.player_id && p.side === order.side);
      if (!pos || pos.live_equity_toks <= 0) return false;
      // When trigger_level > 100, it represents a CHIP balance floor; when <= 100, it is an implied odds % threshold
      if (order.trigger_level > 100) {
        return pos.live_equity_toks <= order.trigger_level;
      }
      return isBull ? currentImplied <= order.trigger_level : currentImplied >= order.trigger_level;
    }
    return false;
  }
}
