// ============================================================================
// Width Auction & [L, H] Quote Rules Engine (SPEC §2.2 & §6.2)
// ============================================================================

import { Clock } from './clock';
import { ToksLedger } from './ledger';
import { Market, WidthBid } from '../shared/types';

export const AUCTION_QUIET_PERIOD_MS = 30_000; // 30s quiet period
export const MM_QUOTE_TIMEOUT_MS = 180_000; // 3 min quote deadline

export class AuctionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuctionError';
  }
}

export class WidthAuctionEngine {
  private bidsByMarket: Map<string, WidthBid[]> = new Map();
  private forfeitedBiddersByMarket: Map<string, Set<string>> = new Map();
  private bidSeq: number = 0;

  constructor(
    private readonly clock: Clock,
    private readonly ledger: ToksLedger
  ) {}

  private nextBidId(): string {
    this.bidSeq += 1;
    return `bid_${this.clock.now()}_${this.bidSeq}`;
  }

  public getBids(marketId: string): WidthBid[] {
    return [...(this.bidsByMarket.get(marketId) ?? [])];
  }

  public getAllBids(): WidthBid[] {
    const all: WidthBid[] = [];
    for (const list of this.bidsByMarket.values()) {
      for (const b of list) all.push({ ...b });
    }
    return all;
  }

  public exportState() {
    const bidsByMarket: Record<string, WidthBid[]> = {};
    for (const [k, v] of this.bidsByMarket.entries()) {
      bidsByMarket[k] = v.map((b) => ({ ...b }));
    }
    const forfeitedByMarket: Record<string, string[]> = {};
    for (const [k, v] of this.forfeitedBiddersByMarket.entries()) {
      forfeitedByMarket[k] = Array.from(v);
    }
    return {
      bidsByMarket,
      forfeitedByMarket,
      bidSeq: this.bidSeq,
    };
  }

  public importState(data: {
    bidsByMarket?: Record<string, WidthBid[]>;
    forfeitedByMarket?: Record<string, string[]>;
    bidSeq?: number;
  }): void {
    this.bidsByMarket.clear();
    this.forfeitedBiddersByMarket.clear();
    this.bidSeq = data.bidSeq ?? 0;
    for (const [k, list] of Object.entries(data.bidsByMarket ?? {})) {
      this.bidsByMarket.set(
        k,
        list.map((b) => ({ ...b }))
      );
    }
    for (const [k, arr] of Object.entries(data.forfeitedByMarket ?? {})) {
      this.forfeitedBiddersByMarket.set(k, new Set(arr));
    }
  }

  public getStandingBestBid(marketId: string): WidthBid | null {
    const forfeited = this.forfeitedBiddersByMarket.get(marketId) ?? new Set<string>();
    const bids = (this.bidsByMarket.get(marketId) ?? []).filter(
      (b) => !forfeited.has(b.player_id)
    );
    if (bids.length === 0) return null;
    // Sort by width ascending, then created_at ascending (first to bid that width wins tie)
    const sorted = [...bids].sort((a, b) =>
      a.width !== b.width ? a.width - b.width : a.created_at - b.created_at
    );
    return sorted[0];
  }

  /**
   * Starts the width auction for a spread market.
   */
  public startAuction(market: Market): Market {
    if (market.archetype !== 'spread') {
      throw new AuctionError('Only spread markets run a width auction');
    }
    const now = this.clock.now();
    return {
      ...market,
      state: 'width_auction',
      auction_quiet_Ends_at: now + AUCTION_QUIET_PERIOD_MS,
      version: market.version + 1,
    };
  }

  /**
   * Places a width bid `w`. Must narrow the standing best by at least `minStep` (default 1).
   * Resets the 30s quiet-period timer.
   */
  public placeWidthBid(
    market: Market,
    playerId: string,
    width: number,
    minStep: number = 1
  ): { market: Market; bid: WidthBid } {
    if (market.state !== 'width_auction') {
      throw new AuctionError(`Market ${market.id} is not in width_auction state`);
    }
    if (market.arbiter_id && market.arbiter_id === playerId) {
      throw new AuctionError('Designated 3rd-party arbiter cannot bid or trade in this market');
    }

    const maxSpan = market.bounds[1] - market.bounds[0];
    if (!Number.isFinite(width) || width <= 0 || width > maxSpan) {
      throw new AuctionError(`Bid width ${width} must be in (0, ${maxSpan}]`);
    }

    // Verify bidder has at least k TOKS in wallet to cover the MM quote ante requirement
    const player = this.ledger.getPlayer(playerId);
    if (player.wallet_balance_toks < market.lot_stake_k) {
      throw new AuctionError(
        `Player ${player.nickname} needs at least ${market.lot_stake_k} TOKS in wallet to bid in width auction`
      );
    }

    const best = this.getStandingBestBid(market.id);
    if (best && width > best.width - minStep) {
      throw new AuctionError(
        `Bid width ${width} must narrow standing best (${best.width}) by at least ${minStep}`
      );
    }

    const now = this.clock.now();
    const bid: WidthBid = {
      id: this.nextBidId(),
      market_id: market.id,
      player_id: playerId,
      width,
      created_at: now,
    };

    const list = this.bidsByMarket.get(market.id) ?? [];
    list.push(bid);
    this.bidsByMarket.set(market.id, list);

    const updatedMarket: Market = {
      ...market,
      active_width_w: width,
      mm_player_id: playerId,
      auction_quiet_Ends_at: now + AUCTION_QUIET_PERIOD_MS,
      version: market.version + 1,
    };

    return { market: updatedMarket, bid };
  }

  /**
   * Finalizes the width auction after the 30s quiet period expires.
   * Fallback (SPEC §2.2): If no width bids, proposer becomes MM at preset w_max;
   * if proposer declines, the market voids.
   */
  public finalizeAuction(
    market: Market,
    options?: { proposerAcceptsDefaultWMax?: boolean; presetWMax?: number }
  ): Market {
    if (market.state !== 'width_auction') {
      throw new AuctionError(`Cannot finalize auction from state ${market.state}`);
    }

    const now = this.clock.now();
    const best = this.getStandingBestBid(market.id);

    if (!best) {
      const accepts = options?.proposerAcceptsDefaultWMax ?? true;
      if (!accepts) {
        return {
          ...market,
          state: 'void',
          version: market.version + 1,
        };
      }
      const span = market.bounds[1] - market.bounds[0];
      const defaultW = options?.presetWMax ?? Math.max(1, Math.round(span * 0.2));
      return {
        ...market,
        state: 'quoting',
        mm_player_id: market.proposer_id,
        active_width_w: defaultW,
        quote_deadline_at: now + MM_QUOTE_TIMEOUT_MS,
        version: market.version + 1,
      };
    }

    return {
      ...market,
      state: 'quoting',
      mm_player_id: best.player_id,
      active_width_w: best.width,
      quote_deadline_at: now + MM_QUOTE_TIMEOUT_MS,
      version: market.version + 1,
    };
  }

  /**
   * MM sets lower bound L; engine sets H = L + w within market bounds.
   */
  public submitQuote(market: Market, playerId: string, L: number): Market {
    if (market.state !== 'quoting') {
      throw new AuctionError(`Market ${market.id} is not in quoting state`);
    }
    if (market.mm_player_id !== playerId) {
      throw new AuctionError(`Only winning MM (${market.mm_player_id}) can submit [L, H] quote`);
    }
    const w = market.active_width_w;
    if (w == null || w <= 0) {
      throw new AuctionError('Market has no active_width_w');
    }

    const H = L + w;
    const [minB, maxB] = market.bounds;
    if (L < minB || H > maxB) {
      throw new AuctionError(
        `Quote [${L}, ${H}] must lie within market bounds [${minB}, ${maxB}]`
      );
    }
    if (market.payoff_mode === 'log' && L <= 0) {
      throw new AuctionError('Log payoff mode requires lower bound L > 0');
    }

    const midpoint = Number(((L + H) / 2).toFixed(2));
    return {
      ...market,
      state: 'open',
      L,
      H,
      live_implied_value: midpoint,
      version: market.version + 1,
    };
  }

  /**
   * Handles MM missing the 3-minute quote deadline (SPEC §2.2):
   * MM forfeits an ante of `k` TOKS to the next-narrowest bidder, who quotes at their own bid width.
   * If no bidders remain, the market voids.
   */
  public handleQuoteTimeout(market: Market, idempotencyKey: string): Market {
    if (market.state !== 'quoting' || !market.mm_player_id) {
      throw new AuctionError('Market is not waiting on an MM quote');
    }

    const timedOutMm = market.mm_player_id;
    const forfeited = this.forfeitedBiddersByMarket.get(market.id) ?? new Set<string>();
    forfeited.add(timedOutMm);
    this.forfeitedBiddersByMarket.set(market.id, forfeited);

    // Find next-narrowest distinct bidder
    const remainingBids = (this.bidsByMarket.get(market.id) ?? [])
      .filter((b) => !forfeited.has(b.player_id))
      .sort((a, b) => (a.width !== b.width ? a.width - b.width : a.created_at - b.created_at));

    if (remainingBids.length === 0) {
      return {
        ...market,
        state: 'void',
        mm_player_id: null,
        active_width_w: null,
        version: market.version + 1,
      };
    }

    const nextBest = remainingBids[0];
    // Forfeit k TOKS ante from timedOutMm to nextBest.player_id
    this.ledger.transferWallet(
      timedOutMm,
      nextBest.player_id,
      market.id,
      market.lot_stake_k,
      'ANTE_FORFEIT',
      idempotencyKey,
      `MM quote timeout ante forfeiture (${market.lot_stake_k} TOKS) to next bidder`
    );

    const now = this.clock.now();
    return {
      ...market,
      state: 'quoting',
      mm_player_id: nextBest.player_id,
      active_width_w: nextBest.width,
      quote_deadline_at: now + MM_QUOTE_TIMEOUT_MS,
      version: market.version + 1,
    };
  }
}
