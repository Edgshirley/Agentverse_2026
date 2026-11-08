// ============================================================================
// Payoff Modes, Worst-Case Escrow & Zero-Sum Settlement (SPEC §2.2, §2.3, §6.2)
// ============================================================================

import { Clock } from './clock';
import { ToksLedger } from './ledger';
import { Market, PayoffMode, Position, PositionSide } from '../shared/types';

export class PayoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoffError';
  }
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Evaluates raw per-lot payoff for a non-Pot mode (`binary`, `linear`, `log`) at a given outcome X.
 * Positive means the taker wins from MM; negative means the taker loses to MM.
 * Strict Boundary Rule (SPEC §2.2): X = L or X = H counts as inside the range.
 * Over wins strictly if X > H; Under wins strictly if X < L.
 */
export function evaluatePerLotPayoff(
  mode: PayoffMode,
  side: 'OVER' | 'UNDER',
  X: number,
  L: number,
  H: number,
  k: number,
  c: number = 3
): number {
  const w = H - L;
  if (w <= 0) {
    throw new PayoffError(`Invalid spread width w = ${w}`);
  }

  if (mode === 'binary' || mode === 'pot') {
    if (side === 'OVER') {
      return X > H ? k : -k;
    } else {
      return X < L ? k : -k;
    }
  }

  if (mode === 'linear') {
    if (side === 'OVER') {
      const ratio = clamp((X - H) / w, -c, c);
      return Math.trunc(k * ratio);
    } else {
      const ratio = clamp((L - X) / w, -c, c);
      return Math.trunc(k * ratio);
    }
  }

  if (mode === 'log') {
    if (L <= 0 || H <= 0) {
      throw new PayoffError('Log payoff mode requires L > 0 and H > 0');
    }
    const safeX = Math.max(X, 1e-9);
    const logW = Math.log(H / L);
    if (side === 'OVER') {
      const ratio = clamp(Math.log(safeX / H) / logW, -c, c);
      return Math.trunc(k * ratio);
    } else {
      const ratio = clamp(Math.log(L / safeX) / logW, -c, c);
      return Math.trunc(k * ratio);
    }
  }

  throw new PayoffError(`Unsupported payoff mode: ${mode}`);
}

/**
 * Computes worst-case loss per taker lot by evaluating at bounds, L, H, and cap points +/- c (SPEC §2.3).
 */
export function computeTakerWorstCasePerLot(market: Market, side: 'OVER' | 'UNDER'): number {
  const k = market.lot_stake_k;
  const c = market.cap_widths_c ?? 3;
  if (market.payoff_mode === 'pot' || market.payoff_mode === 'binary') {
    return k;
  }
  const L = market.L ?? market.bounds[0];
  const H = market.H ?? market.bounds[1];
  const w = Math.max(1, H - L);
  const candidatePoints = [
    market.bounds[0],
    market.bounds[1],
    L,
    H,
    H + c * w,
    Math.max(market.payoff_mode === 'log' ? 1e-6 : -Infinity, L - c * w),
  ];

  let worstLoss = k * c;
  for (const x of candidatePoints) {
    if (!Number.isFinite(x)) continue;
    const p = evaluatePerLotPayoff(market.payoff_mode, side, x, L, H, k, c);
    if (-p > worstLoss) {
      worstLoss = -p;
    }
  }
  return Math.max(k, worstLoss);
}

/**
 * Computes required MM total escrow across all active Over and Under lots.
 * In Pot mode (SPEC §2.3): MM stakes k * max(Over lots, Under lots).
 * Across all modes: evaluates worst-case MM payout at bounds, L, H, and cap points +/- c.
 */
export function computeRequiredMmEscrow(
  market: Market,
  totalOverLots: number,
  totalUnderLots: number
): number {
  const k = market.lot_stake_k;
  const c = market.cap_widths_c ?? 3;
  if (totalOverLots === 0 && totalUnderLots === 0) return 0;

  if (market.payoff_mode === 'pot' || market.payoff_mode === 'binary') {
    return k * Math.max(totalOverLots, totalUnderLots);
  }

  const L = market.L ?? market.bounds[0];
  const H = market.H ?? market.bounds[1];
  const w = Math.max(1, H - L);
  const candidatePoints = [
    market.bounds[0],
    market.bounds[1],
    L,
    H,
    H + c * w,
    Math.max(market.payoff_mode === 'log' ? 1e-6 : market.bounds[0], L - c * w),
  ];

  let maxMmLoss = 0;
  for (const x of candidatePoints) {
    const overPay = evaluatePerLotPayoff(market.payoff_mode, 'OVER', x, L, H, k, c);
    const underPay = evaluatePerLotPayoff(market.payoff_mode, 'UNDER', x, L, H, k, c);
    // MM net delta is -(totalOverLots * overPay + totalUnderLots * underPay)
    const mmLossAtX = Math.max(0, totalOverLots * overPay + totalUnderLots * underPay);
    if (mmLossAtX > maxMmLoss) {
      maxMmLoss = mmLossAtX;
    }
  }
  return Math.max(k * c * Math.max(totalOverLots, totalUnderLots), maxMmLoss);
}

export interface SettlementResult {
  market: Market;
  positions: Position[];
  payoutByPlayer: Record<string, number>; // Total escrow payout credited to wallet at settlement
  netPnlByPlayer: Record<string, number>; // Cumulative net P&L across the entire market lifecycle (including P2P sales)
  mmRemainderToks: number;
}

export class SpreadMarketBook {
  private positionsByMarket: Map<string, Position[]> = new Map();
  private mmEscrowByMarket: Map<string, number> = new Map();
  private posSeq: number = 0;

  constructor(
    private readonly clock: Clock,
    private readonly ledger: ToksLedger
  ) {}

  private nextPosId(): string {
    this.posSeq += 1;
    return `pos_${this.clock.now()}_${this.posSeq}`;
  }

  public getPositions(marketId: string): Position[] {
    return (this.positionsByMarket.get(marketId) ?? []).map((p) => ({ ...p }));
  }

  public setPositions(marketId: string, positions: Position[]): void {
    this.positionsByMarket.set(
      marketId,
      positions.map((p) => ({ ...p }))
    );
  }

  public getMmEscrow(marketId: string): number {
    return this.mmEscrowByMarket.get(marketId) ?? 0;
  }

  public exportState() {
    const positionsByMarket: Record<string, Position[]> = {};
    for (const [k, v] of this.positionsByMarket.entries()) {
      positionsByMarket[k] = v.map((p) => ({ ...p }));
    }
    const mmEscrowByMarket: Record<string, number> = {};
    for (const [k, v] of this.mmEscrowByMarket.entries()) {
      mmEscrowByMarket[k] = v;
    }
    return {
      positionsByMarket,
      mmEscrowByMarket,
      posSeq: this.posSeq,
    };
  }

  public importState(data: {
    positionsByMarket?: Record<string, Position[]>;
    mmEscrowByMarket?: Record<string, number>;
    posSeq?: number;
  }): void {
    this.positionsByMarket.clear();
    this.mmEscrowByMarket.clear();
    this.posSeq = data.posSeq ?? 0;
    for (const [k, list] of Object.entries(data.positionsByMarket ?? {})) {
      this.positionsByMarket.set(
        k,
        list.map((p) => ({ ...p }))
      );
    }
    for (const [k, v] of Object.entries(data.mmEscrowByMarket ?? {})) {
      this.mmEscrowByMarket.set(k, v);
    }
  }

  /**
   * 1-Tap Manual Take (Over or Under) for 1..max_lots lots (SPEC §2.2 & §6.2).
   * Validates taker wallet balance AND MM remaining escrow cover.
   */
  public takeSpreadPosition(
    market: Market,
    playerId: string,
    side: 'OVER' | 'UNDER',
    lots: number,
    idempotencyKey: string
  ): { market: Market; position: Position } {
    if (market.state !== 'open' && market.state !== 'live') {
      throw new PayoffError(`Market ${market.id} is not open for takes (state=${market.state})`);
    }
    if (!market.mm_player_id || market.L == null || market.H == null) {
      throw new PayoffError('Spread market must have an active MM and [L, H] quote before takes');
    }
    if (market.arbiter_id && market.arbiter_id === playerId) {
      throw new PayoffError('Designated 3rd-party arbiter is barred from trading in this market');
    }
    if (playerId === market.mm_player_id) {
      throw new PayoffError('MM cannot take against their own quote during initial take entry');
    }
    if (!Number.isInteger(lots) || lots < 1 || lots > market.toggles.max_lots) {
      throw new PayoffError(`Lots must be an integer between 1 and ${market.toggles.max_lots}`);
    }

    const positions = this.positionsByMarket.get(market.id) ?? [];
    const currentOverLots = positions
      .filter((p) => p.side === 'OVER' && p.lots > 0)
      .reduce((acc, p) => acc + p.lots, 0);
    const currentUnderLots = positions
      .filter((p) => p.side === 'UNDER' && p.lots > 0)
      .reduce((acc, p) => acc + p.lots, 0);

    const newOverLots = side === 'OVER' ? currentOverLots + lots : currentOverLots;
    const newUnderLots = side === 'UNDER' ? currentUnderLots + lots : currentUnderLots;

    const currentMmEscrow = this.mmEscrowByMarket.get(market.id) ?? 0;
    const requiredMmEscrow = computeRequiredMmEscrow(market, newOverLots, newUnderLots);
    const additionalMmEscrowNeeded = Math.max(0, requiredMmEscrow - currentMmEscrow);

    const mmPlayer = this.ledger.getPlayer(market.mm_player_id);
    if (mmPlayer.wallet_balance_toks < additionalMmEscrowNeeded) {
      const perLotRisk = computeTakerWorstCasePerLot(market, side);
      const maxAdditionalLots = Math.floor(mmPlayer.wallet_balance_toks / Math.max(1, perLotRisk));
      throw new PayoffError(
        `Take exceeds remaining MM escrow cover. Max available size on ${side}: ${maxAdditionalLots} lot(s)`
      );
    }

    const takerStake = lots * computeTakerWorstCasePerLot(market, side);

    // Lock taker escrow
    this.ledger.lockEscrow(
      playerId,
      market.id,
      takerStake,
      'ESCROW_LOCK',
      `${idempotencyKey}:taker`,
      `${playerId} takes ${lots} ${side} lot(s)`
    );

    // Lock additional MM escrow if needed
    if (additionalMmEscrowNeeded > 0) {
      this.ledger.lockEscrow(
        market.mm_player_id,
        market.id,
        additionalMmEscrowNeeded,
        'ESCROW_LOCK',
        `${idempotencyKey}:mm`,
        `MM cover lock for ${side} take`
      );
      this.mmEscrowByMarket.set(market.id, currentMmEscrow + additionalMmEscrowNeeded);
    }

    const now = this.clock.now();
    const pos: Position = {
      id: this.nextPosId(),
      market_id: market.id,
      player_id: playerId,
      side,
      lots,
      staked_toks: takerStake,
      entry_cost_toks: takerStake,
      realized_pnl_toks: 0,
      current_shares: lots,
      live_equity_toks: takerStake,
      withdrawn_toks: 0,
      is_hidden: market.toggles.hidden_takes && market.state === 'open',
      updated_at: now,
    };

    positions.push(pos);
    this.positionsByMarket.set(market.id, positions);

    return {
      market: {
        ...market,
        version: market.version + 1,
      },
      position: { ...pos },
    };
  }

  /**
   * Locks the initial take window, revealing hidden takes and transitioning to `live` (SPEC §2.2 step 5).
   * If no takers entered, the market voids and all escrowed TOKS return.
   */
  public lockTakesAndGoLive(market: Market, idempotencyKey: string): Market {
    const positions = this.positionsByMarket.get(market.id) ?? [];
    const activeTakers = positions.filter((p) => p.lots > 0);

    if (activeTakers.length === 0) {
      const mmEscrow = this.mmEscrowByMarket.get(market.id) ?? 0;
      if (mmEscrow > 0 && market.mm_player_id) {
        this.ledger.releaseEscrow(
          market.mm_player_id,
          market.id,
          mmEscrow,
          'VOID_REFUND',
          `${idempotencyKey}:void_mm`,
          'Void market refund (no takers)'
        );
        this.mmEscrowByMarket.set(market.id, 0);
      }
      return {
        ...market,
        state: 'void',
        version: market.version + 1,
      };
    }

    const now = this.clock.now();
    for (const p of positions) {
      p.is_hidden = false;
      p.updated_at = now;
    }

    return {
      ...market,
      state: 'live',
      version: market.version + 1,
    };
  }

  /**
   * Settles a Spread market at outcome X, guaranteeing strict zero-sum integer payouts
   * and routing any integer division remainder to the MM (SPEC §2.2 & §2.3).
   */
  public settleSpreadMarket(
    market: Market,
    outcomeX: number,
    idempotencyKey: string
  ): SettlementResult {
    if (!market.mm_player_id || market.L == null || market.H == null) {
      throw new PayoffError('Cannot settle spread market without MM and [L, H]');
    }

    const positions = this.positionsByMarket.get(market.id) ?? [];
    const activePositions = positions.filter((p) => p.lots > 0 && p.staked_toks > 0);
    const mmId = market.mm_player_id;
    const mmEscrow = this.mmEscrowByMarket.get(market.id) ?? 0;
    const L = market.L;
    const H = market.H;
    const k = market.lot_stake_k;
    const c = market.cap_widths_c ?? 3;

    const totalTakerEscrow = activePositions.reduce((acc, p) => acc + p.staked_toks, 0);
    const totalPot = totalTakerEscrow + mmEscrow;

    const payoutByPositionId: Map<string, number> = new Map();
    let mmPayout = 0;
    let mmRemainderToks = 0;

    if (market.payoff_mode === 'pot') {
      const overPositions = activePositions.filter((p) => p.side === 'OVER');
      const underPositions = activePositions.filter((p) => p.side === 'UNDER');
      const totalOverLots = overPositions.reduce((acc, p) => acc + p.lots, 0);
      const totalUnderLots = underPositions.reduce((acc, p) => acc + p.lots, 0);

      if (outcomeX > H && totalOverLots > 0) {
        // Over wins pot pro-rata by lots; integer division remainder goes to MM
        let distributed = 0;
        for (const p of overPositions) {
          const share = Math.floor((totalPot * p.lots) / totalOverLots);
          payoutByPositionId.set(p.id, share);
          distributed += share;
        }
        for (const p of underPositions) {
          payoutByPositionId.set(p.id, 0);
        }
        mmRemainderToks = totalPot - distributed;
        mmPayout = mmRemainderToks;
      } else if (outcomeX < L && totalUnderLots > 0) {
        // Under wins pot pro-rata by lots; integer division remainder goes to MM
        let distributed = 0;
        for (const p of underPositions) {
          const share = Math.floor((totalPot * p.lots) / totalUnderLots);
          payoutByPositionId.set(p.id, share);
          distributed += share;
        }
        for (const p of overPositions) {
          payoutByPositionId.set(p.id, 0);
        }
        mmRemainderToks = totalPot - distributed;
        mmPayout = mmRemainderToks;
      } else {
        // Inside range (L <= X <= H) or winning side has 0 lots -> MM takes the entire pot
        for (const p of activePositions) {
          payoutByPositionId.set(p.id, 0);
        }
        mmPayout = totalPot;
      }
    } else {
      // Binary, Linear, or Log mode
      let totalTakerPayout = 0;
      for (const p of activePositions) {
        const side = p.side === 'OVER' ? 'OVER' : 'UNDER';
        const perLotNet = evaluatePerLotPayoff(market.payoff_mode, side, outcomeX, L, H, k, c);
        const rawPositionPayout = clamp(p.staked_toks + p.lots * perLotNet, 0, totalPot);
        payoutByPositionId.set(p.id, rawPositionPayout);
        totalTakerPayout += rawPositionPayout;
      }
      mmPayout = totalPot - totalTakerPayout;
    }

    // Aggregate escrow release and wallet credit by playerId
    const legsByPlayer: Map<string, { escrowRelease: number; walletCredit: number }> = new Map();

    const addLeg = (pid: string, escRel: number, walCred: number) => {
      const cur = legsByPlayer.get(pid) ?? { escrowRelease: 0, walletCredit: 0 };
      cur.escrowRelease += escRel;
      cur.walletCredit += walCred;
      legsByPlayer.set(pid, cur);
    };

    for (const p of activePositions) {
      const payout = payoutByPositionId.get(p.id) ?? 0;
      addLeg(p.player_id, p.staked_toks, payout);
      p.live_equity_toks = payout;
    }

    addLeg(mmId, mmEscrow, mmPayout);

    const legs = Array.from(legsByPlayer.entries()).map(([playerId, amounts]) => ({
      playerId,
      escrowRelease: amounts.escrowRelease,
      walletCredit: amounts.walletCredit,
      note: `Settlement at X=${outcomeX}`,
    }));

    this.ledger.settleEscrowBatch(market.id, legs, 'SETTLEMENT_PAYOUT', idempotencyKey);
    this.mmEscrowByMarket.set(market.id, 0);

    // Compute per-player payout and cumulative net P&L on this market
    const payoutByPlayer: Record<string, number> = {};
    for (const [pid, amounts] of legsByPlayer.entries()) {
      payoutByPlayer[pid] = amounts.walletCredit;
    }

    // Net P&L for any player in this market equals sum of all wallet ledger entries for this market
    // (since all escrow locks have now been released/settled back to wallets!).
    const netPnlByPlayer: Record<string, number> = {};
    const marketEntries = this.ledger.getEntries(market.id);
    for (const entry of marketEntries) {
      if (entry.account === 'wallet') {
        netPnlByPlayer[entry.player_id] = (netPnlByPlayer[entry.player_id] ?? 0) + entry.delta_toks;
      }
    }

    const settledMarket: Market = {
      ...market,
      state: 'settled',
      outcome_x: outcomeX,
      live_implied_value: outcomeX,
      version: market.version + 1,
    };

    return {
      market: settledMarket,
      positions: this.getPositions(market.id),
      payoutByPlayer,
      netPnlByPlayer,
      mmRemainderToks,
    };
  }
}
