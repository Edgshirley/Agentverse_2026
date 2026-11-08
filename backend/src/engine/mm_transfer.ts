// ============================================================================
// Peer-to-Peer Position Transfer for MM Spread Markets (SPEC §2.4.A & §6.2)
// ============================================================================

import { Clock } from './clock';
import { ToksLedger } from './ledger';
import { SpreadMarketBook } from './payoffs';
import { Market, Position, PositionBid, PositionSide } from '../shared/types';

export class P2PTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'P2PTransferError';
  }
}

export class P2PTransferEngine {
  private bidsByMarket: Map<string, PositionBid[]> = new Map();
  private bidSeq: number = 0;

  constructor(
    private readonly clock: Clock,
    private readonly ledger: ToksLedger,
    private readonly spreadBook: SpreadMarketBook
  ) {}

  private nextId(): string {
    this.bidSeq += 1;
    return `p2p_${this.clock.now()}_${this.bidSeq}`;
  }

  public getStandingOrders(marketId: string): PositionBid[] {
    return (this.bidsByMarket.get(marketId) ?? []).map((b) => ({ ...b }));
  }

  public getAllStandingOrders(): PositionBid[] {
    const all: PositionBid[] = [];
    for (const list of this.bidsByMarket.values()) {
      for (const b of list) all.push({ ...b });
    }
    return all;
  }

  public cancelStandingOrder(
    market: Market,
    orderId: string,
    actorId: string,
    idempotencyKey: string
  ): PositionBid {
    const list = this.bidsByMarket.get(market.id) ?? [];
    const item = list.find((b) => b.id === orderId);
    if (!item || item.status !== 'open') {
      throw new P2PTransferError(`Standing P2P order ${orderId} is not open`);
    }
    const ownerId = item.kind === 'BID' ? item.buyer_id : item.seller_id;
    if (ownerId !== actorId) {
      throw new P2PTransferError(`Only the order creator (${ownerId}) can cancel ${orderId}`);
    }
    if (item.escrowed_toks > 0) {
      this.ledger.releaseEscrow(
        item.buyer_id,
        market.id,
        item.escrowed_toks,
        'ESCROW_RELEASE',
        `${idempotencyKey}:cancel_p2p`,
        `Cancelled standing P2P bid ${item.id}`
      );
      item.escrowed_toks = 0;
    }
    item.status = 'cancelled';
    return { ...item };
  }

  public exportState() {
    const bidsByMarket: Record<string, PositionBid[]> = {};
    for (const [k, v] of this.bidsByMarket.entries()) {
      bidsByMarket[k] = v.map((b) => ({ ...b }));
    }
    return {
      bidsByMarket,
      bidSeq: this.bidSeq,
    };
  }

  public importState(data: {
    bidsByMarket?: Record<string, PositionBid[]>;
    bidSeq?: number;
  }): void {
    this.bidsByMarket.clear();
    this.bidSeq = data.bidSeq ?? 0;
    for (const [k, list] of Object.entries(data.bidsByMarket ?? {})) {
      this.bidsByMarket.set(
        k,
        list.map((b) => ({ ...b }))
      );
    }
  }

  private assertMarketTradable(market: Market, actorId: string): void {
    if (market.state !== 'live' && market.state !== 'open') {
      throw new P2PTransferError(
        `P2P transfers are frozen in market state '${market.state}' (SPEC §6.2)`
      );
    }
    if (market.arbiter_id && market.arbiter_id === actorId) {
      throw new P2PTransferError('Designated 3rd-party arbiter cannot trade in this market');
    }
  }

  /**
   * Posts a balance-backed standing BID to buy 1 lot of `side` (`OVER` or `UNDER`) for `priceToks`.
   * If an AUTO_SELL or ASK exists at `<= priceToks`, matches immediately!
   */
  public postStandingBid(
    market: Market,
    buyerId: string,
    side: 'OVER' | 'UNDER',
    priceToks: number,
    idempotencyKey: string
  ): { bid: PositionBid; autoMatchedSale?: { sellerId: string; buyerId: string; priceToks: number } } {
    this.assertMarketTradable(market, buyerId);
    ToksLedger.assertIntegerToks(priceToks, 'priceToks');
    if (priceToks <= 0) {
      throw new P2PTransferError('Standing bid price must be > 0 TOKS');
    }

    // Lock the buyer's bid price in escrow so the standing bid is balance-backed
    this.ledger.lockEscrow(
      buyerId,
      market.id,
      priceToks,
      'ESCROW_LOCK',
      `${idempotencyKey}:bid_lock`,
      `Standing bid: ${priceToks} TOKS for 1 ${side} lot`
    );

    const now = this.clock.now();
    const bid: PositionBid = {
      id: this.nextId(),
      market_id: market.id,
      side,
      buyer_id: buyerId,
      price_toks: priceToks,
      kind: 'BID',
      status: 'open',
      escrowed_toks: priceToks,
      created_at: now,
    };

    const list = this.bidsByMarket.get(market.id) ?? [];
    list.push(bid);
    this.bidsByMarket.set(market.id, list);

    // Check if any open ASK or AUTO_SELL rule on the same side can match immediately
    const matchingAsk = list
      .filter(
        (o) =>
          o.status === 'open' &&
          (o.kind === 'ASK' || o.kind === 'AUTO_SELL') &&
          o.side === side &&
          o.seller_id &&
          o.seller_id !== buyerId &&
          o.price_toks <= priceToks
      )
      .sort((a, b) => (a.price_toks !== b.price_toks ? a.price_toks - b.price_toks : a.created_at - b.created_at))[0];

    if (matchingAsk && matchingAsk.seller_id) {
      const sellerId = matchingAsk.seller_id;
      this.executeLotTransfer(
        market,
        bid,
        sellerId,
        matchingAsk.position_id ?? undefined,
        `${idempotencyKey}:automatch`
      );
      matchingAsk.status = 'matched';
      matchingAsk.buyer_id = buyerId;
      return {
        bid: { ...bid },
        autoMatchedSale: { sellerId, buyerId, priceToks: bid.price_toks },
      };
    }

    return { bid: { ...bid } };
  }

  /**
   * Posts an ASK listing or AUTO_SELL conditional rule for 1 lot of `side` held by `sellerId`.
   * Note: MM cannot sell the MM side in v1 (SPEC §2.4.A.1).
   */
  public postAskOrAutoSell(
    market: Market,
    sellerId: string,
    side: 'OVER' | 'UNDER',
    minPriceToks: number,
    kind: 'ASK' | 'AUTO_SELL',
    idempotencyKey: string
  ): { order: PositionBid; autoMatchedSale?: { sellerId: string; buyerId: string; priceToks: number } } {
    this.assertMarketTradable(market, sellerId);
    ToksLedger.assertIntegerToks(minPriceToks, 'minPriceToks');
    if (minPriceToks <= 0) {
      throw new P2PTransferError('Ask / Auto-Sell price must be > 0 TOKS');
    }

    const positions = this.spreadBook.getPositions(market.id);
    const sellerPos = positions.find(
      (p) => p.player_id === sellerId && p.side === side && p.lots >= 1
    );
    if (!sellerPos) {
      throw new P2PTransferError(`Player ${sellerId} does not hold an active ${side} lot to sell`);
    }

    const list = this.bidsByMarket.get(market.id) ?? [];

    // Check if there is already a standing BID >= minPriceToks
    const bestBid = list
      .filter(
        (b) =>
          b.status === 'open' &&
          b.kind === 'BID' &&
          b.side === side &&
          b.buyer_id !== sellerId &&
          b.price_toks >= minPriceToks
      )
      .sort((a, b) => (b.price_toks !== a.price_toks ? b.price_toks - a.price_toks : a.created_at - b.created_at))[0];

    const now = this.clock.now();
    const askOrder: PositionBid = {
      id: this.nextId(),
      market_id: market.id,
      position_id: sellerPos.id,
      side,
      buyer_id: bestBid ? bestBid.buyer_id : '',
      seller_id: sellerId,
      price_toks: minPriceToks,
      kind,
      status: bestBid ? 'matched' : 'open',
      escrowed_toks: 0,
      created_at: now,
    };

    list.push(askOrder);
    this.bidsByMarket.set(market.id, list);

    if (bestBid) {
      this.executeLotTransfer(market, bestBid, sellerId, sellerPos.id, idempotencyKey);
      return {
        order: { ...askOrder },
        autoMatchedSale: {
          sellerId,
          buyerId: bestBid.buyer_id,
          priceToks: bestBid.price_toks,
        },
      };
    }

    return { order: { ...askOrder } };
  }

  /**
   * Instant Cash-Out (SPEC §2.4.A.2): Holder taps Cash Out to match the best standing bid immediately,
   * or accepts a specific `bidId`.
   */
  public acceptStandingBid(
    market: Market,
    sellerId: string,
    side: 'OVER' | 'UNDER',
    idempotencyKey: string,
    bidId?: string
  ): { matchedBid: PositionBid; positions: Position[] } {
    this.assertMarketTradable(market, sellerId);
    const list = this.bidsByMarket.get(market.id) ?? [];

    let targetBid: PositionBid | undefined;
    if (bidId) {
      targetBid = list.find((b) => b.id === bidId);
      if (!targetBid || targetBid.status !== 'open' || targetBid.kind !== 'BID') {
        throw new P2PTransferError(`Standing bid ${bidId} is no longer open`);
      }
    } else {
      targetBid = list
        .filter(
          (b) =>
            b.status === 'open' &&
            b.kind === 'BID' &&
            b.side === side &&
            b.buyer_id !== sellerId
        )
        .sort((a, b) => (b.price_toks !== a.price_toks ? b.price_toks - a.price_toks : a.created_at - b.created_at))[0];
    }

    if (!targetBid) {
      throw new P2PTransferError(`No open standing bid found for ${side}`);
    }

    this.executeLotTransfer(market, targetBid, sellerId, undefined, idempotencyKey);

    return {
      matchedBid: { ...targetBid },
      positions: this.spreadBook.getPositions(market.id),
    };
  }

  /**
   * Core atomic P2P lot transfer:
   * - Transfers 1 lot of `bid.side` (and its per-lot `staked_toks` in the market pot) from `sellerId` to `bid.buyer_id`.
   * - Buyer already has `bid.price_toks` locked in escrow from posting the standing bid.
   * - Seller's escrow releases `perLotStake` (`S`), buyer's escrow releases `P` and locks `S` (net escrow change for buyer: `S - P`),
   *   and seller's wallet is credited with `P` TOKS!
   * - Total market escrow (`sum of all positions staked_toks + MM escrow`) remains 100% unchanged!
   */
  private executeLotTransfer(
    market: Market,
    bid: PositionBid,
    sellerId: string,
    preferredPositionId: string | undefined,
    idempotencyKey: string
  ): void {
    if (bid.status !== 'open') {
      throw new P2PTransferError(`Bid ${bid.id} was already matched or cancelled`);
    }

    const positions = this.spreadBook.getPositions(market.id);
    const sellerPos = preferredPositionId
      ? positions.find(
          (p) => p.id === preferredPositionId && p.player_id === sellerId && p.lots >= 1
        )
      : positions.find(
          (p) => p.player_id === sellerId && p.side === bid.side && p.lots >= 1
        );

    if (!sellerPos) {
      throw new P2PTransferError(
        `Seller ${sellerId} has no active ${bid.side} lot available to transfer`
      );
    }

    const perLotStake = Math.floor(sellerPos.staked_toks / sellerPos.lots);
    const priceToks = bid.price_toks;
    const buyerId = bid.buyer_id;

    // Step 1: Unlock the buyer's escrowed standing bid back to buyer's wallet
    this.ledger.releaseEscrow(
      buyerId,
      market.id,
      bid.escrowed_toks,
      'ESCROW_RELEASE',
      `${idempotencyKey}:unlock_bid`,
      `Release standing bid escrow for match on ${bid.id}`
    );

    // Step 2: Unlock the seller's per-lot market stake (`perLotStake`) back to seller's wallet
    this.ledger.releaseEscrow(
      sellerId,
      market.id,
      perLotStake,
      'ESCROW_RELEASE',
      `${idempotencyKey}:unlock_seller_stake`,
      `Release seller lot stake (${perLotStake} TOKS) on P2P sale`
    );

    // Step 3: Transfer `priceToks` from buyer's wallet to seller's wallet,
    // and transfer `perLotStake` from seller's wallet to buyer's wallet so buyer locks `perLotStake` into market escrow!
    // Net wallet effect before buyer re-locks `perLotStake`:
    //   Seller wallet delta after step 2 (+perLotStake) & step 3: +priceToks
    //   Buyer wallet delta after step 1 (+priceToks) & step 3: +perLotStake (which is immediately locked in Step 4 -> 0!)
    if (priceToks >= perLotStake) {
      const netCashFromBuyerToSeller = priceToks - perLotStake;
      if (netCashFromBuyerToSeller > 0) {
        this.ledger.transferWallet(
          buyerId,
          sellerId,
          market.id,
          netCashFromBuyerToSeller,
          'P2P_LOT_SALE',
          `${idempotencyKey}:p2p_net_cash`,
          `P2P lot sale payment (${priceToks} TOKS price vs ${perLotStake} TOKS lot stake)`
        );
      }
    } else {
      const netDiscountFromSellerToBuyer = perLotStake - priceToks;
      this.ledger.transferWallet(
        sellerId,
        buyerId,
        market.id,
        netDiscountFromSellerToBuyer,
        'P2P_LOT_SALE',
        `${idempotencyKey}:p2p_net_discount`,
        `P2P discount lot transfer (${priceToks} TOKS price vs ${perLotStake} TOKS lot stake)`
      );
    }

    // Step 4: Lock `perLotStake` from buyer's wallet into buyer's market escrow
    this.ledger.lockEscrow(
      buyerId,
      market.id,
      perLotStake,
      'ESCROW_LOCK',
      `${idempotencyKey}:lock_buyer_stake`,
      `Lock buyer market stake (${perLotStake} TOKS) for acquired ${bid.side} lot`
    );

    // Update positions in SpreadMarketBook
    const now = this.clock.now();
    const perLotEntryCost = Math.floor(sellerPos.entry_cost_toks / sellerPos.lots);
    sellerPos.lots -= 1;
    sellerPos.staked_toks -= perLotStake;
    sellerPos.entry_cost_toks -= perLotEntryCost;
    sellerPos.realized_pnl_toks += priceToks - perLotEntryCost;
    sellerPos.current_shares = sellerPos.lots;
    sellerPos.live_equity_toks = sellerPos.lots * priceToks;
    sellerPos.updated_at = now;

    // Add or merge buyer position on `bid.side`
    const existingBuyerPos = positions.find(
      (p) => p.player_id === buyerId && p.side === bid.side && p.lots > 0
    );
    if (existingBuyerPos) {
      existingBuyerPos.lots += 1;
      existingBuyerPos.staked_toks += perLotStake;
      existingBuyerPos.entry_cost_toks += priceToks;
      existingBuyerPos.current_shares = existingBuyerPos.lots;
      existingBuyerPos.live_equity_toks = existingBuyerPos.lots * priceToks;
      existingBuyerPos.updated_at = now;
    } else {
      positions.push({
        id: `pos_${now}_${positions.length + 1}`,
        market_id: market.id,
        player_id: buyerId,
        side: bid.side,
        lots: 1,
        staked_toks: perLotStake,
        entry_cost_toks: priceToks,
        realized_pnl_toks: 0,
        current_shares: 1,
        live_equity_toks: priceToks,
        withdrawn_toks: 0,
        is_hidden: false,
        updated_at: now,
      });
    }

    // Update mark-to-market live_equity_toks for all holders on that side to reflect latest trade price
    for (const p of positions) {
      if (p.side === bid.side && p.lots > 0) {
        p.live_equity_toks = p.lots * priceToks;
      }
    }

    this.spreadBook.setPositions(market.id, positions);

    bid.status = 'matched';
    bid.seller_id = sellerId;
    bid.escrowed_toks = 0;

    this.ledger.assertInvariants();
  }
}
