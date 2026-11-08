// ============================================================================
// Deterministic Integer CHIP Double-Entry Ledger (SPEC §1.8, §2.3, §5.2, §7.1)
// ============================================================================

import { Clock } from './clock';
import { LedgerEntry, LedgerTxType, Player } from '../shared/types';

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

export class ToksLedger {
  private players: Map<string, Player> = new Map();
  private entries: LedgerEntry[] = [];
  private processedIdempotencyKeys: Set<string> = new Set();
  private totalMintedToks: number = 0;
  private entrySeq: number = 0;

  constructor(private readonly clock: Clock) {}

  private nextEntryId(): string {
    this.entrySeq += 1;
    return `led_${this.clock.now()}_${this.entrySeq}`;
  }

  public static assertIntegerToks(amount: number, label: string = 'amount'): void {
    if (!Number.isInteger(amount) || !Number.isSafeInteger(amount)) {
      throw new LedgerError(`${label} must be an integer number of CHIP, got: ${amount}`);
    }
  }

  public registerPlayer(player: Player): void {
    ToksLedger.assertIntegerToks(player.wallet_balance_toks, 'wallet_balance_toks');
    ToksLedger.assertIntegerToks(player.escrow_balance_toks, 'escrow_balance_toks');
    if (player.wallet_balance_toks < 0 || player.escrow_balance_toks < 0) {
      throw new LedgerError('Initial player balances cannot be negative');
    }
    const existing = this.players.get(player.id);
    if (existing) {
      this.totalMintedToks -= existing.wallet_balance_toks + existing.escrow_balance_toks;
    }
    this.players.set(player.id, { ...player });
    this.totalMintedToks += player.wallet_balance_toks + player.escrow_balance_toks;
  }

  public getPlayer(playerId: string): Player {
    const p = this.players.get(playerId);
    if (!p) {
      throw new LedgerError(`Unknown player_id: ${playerId}`);
    }
    return { ...p };
  }

  public getAllPlayers(): Player[] {
    return Array.from(this.players.values()).map((p) => ({ ...p }));
  }

  public getEntries(marketId?: string): LedgerEntry[] {
    if (!marketId) {
      return [...this.entries];
    }
    return this.entries.filter((e) => e.market_id === marketId);
  }

  public hasIdempotencyKey(key: string): boolean {
    return this.processedIdempotencyKeys.has(key);
  }

  private checkAndRecordIdempotency(key: string): void {
    if (!key) {
      throw new LedgerError('Idempotency key is required for all balance mutations');
    }
    if (this.processedIdempotencyKeys.has(key)) {
      throw new LedgerError(`Duplicate transaction rejected by idempotency_key: ${key}`);
    }
    this.processedIdempotencyKeys.add(key);
  }

  /**
   * Locks integer `amount` CHIP from player's wallet into market escrow.
   */
  public lockEscrow(
    playerId: string,
    marketId: string,
    amount: number,
    txType: LedgerTxType,
    idempotencyKey: string,
    note: string
  ): void {
    ToksLedger.assertIntegerToks(amount, 'lockEscrow amount');
    if (amount < 0) {
      throw new LedgerError('lockEscrow amount must be >= 0');
    }
    this.checkAndRecordIdempotency(idempotencyKey);
    if (amount === 0) return;

    const p = this.players.get(playerId);
    if (!p) throw new LedgerError(`Unknown player: ${playerId}`);
    if (p.wallet_balance_toks < amount) {
      throw new LedgerError(
        `Insufficient wallet balance for ${p.nickname}: needs ${amount} CHIP, has ${p.wallet_balance_toks} CHIP`
      );
    }

    p.wallet_balance_toks -= amount;
    p.escrow_balance_toks += amount;

    const now = this.clock.now();
    this.entries.push(
      {
        id: this.nextEntryId(),
        player_id: playerId,
        market_id: marketId,
        account: 'wallet',
        delta_toks: -amount,
        tx_type: txType,
        idempotency_key: `${idempotencyKey}:wallet`,
        note,
        created_at: now,
      },
      {
        id: this.nextEntryId(),
        player_id: playerId,
        market_id: marketId,
        account: 'escrow',
        delta_toks: amount,
        tx_type: txType,
        idempotency_key: `${idempotencyKey}:escrow`,
        note,
        created_at: now,
      }
    );
  }

  /**
   * Releases integer `amount` CHIP from player's escrow back to their wallet.
   */
  public releaseEscrow(
    playerId: string,
    marketId: string,
    amount: number,
    txType: LedgerTxType,
    idempotencyKey: string,
    note: string
  ): void {
    ToksLedger.assertIntegerToks(amount, 'releaseEscrow amount');
    if (amount < 0) {
      throw new LedgerError('releaseEscrow amount must be >= 0');
    }
    this.checkAndRecordIdempotency(idempotencyKey);
    if (amount === 0) return;

    const p = this.players.get(playerId);
    if (!p) throw new LedgerError(`Unknown player: ${playerId}`);
    if (p.escrow_balance_toks < amount) {
      throw new LedgerError(
        `Insufficient escrow balance for ${p.nickname}: needs ${amount} CHIP, has ${p.escrow_balance_toks} CHIP`
      );
    }

    p.escrow_balance_toks -= amount;
    p.wallet_balance_toks += amount;

    const now = this.clock.now();
    this.entries.push(
      {
        id: this.nextEntryId(),
        player_id: playerId,
        market_id: marketId,
        account: 'escrow',
        delta_toks: -amount,
        tx_type: txType,
        idempotency_key: `${idempotencyKey}:escrow`,
        note,
        created_at: now,
      },
      {
        id: this.nextEntryId(),
        player_id: playerId,
        market_id: marketId,
        account: 'wallet',
        delta_toks: amount,
        tx_type: txType,
        idempotency_key: `${idempotencyKey}:wallet`,
        note,
        created_at: now,
      }
    );
  }

  /**
   * Direct wallet-to-wallet zero-sum transfer (e.g., MM ante forfeiture or P2P cash payment).
   */
  public transferWallet(
    fromPlayerId: string,
    toPlayerId: string,
    marketId: string,
    amount: number,
    txType: LedgerTxType,
    idempotencyKey: string,
    note: string
  ): void {
    ToksLedger.assertIntegerToks(amount, 'transferWallet amount');
    if (amount < 0) {
      throw new LedgerError('transferWallet amount must be >= 0');
    }
    this.checkAndRecordIdempotency(idempotencyKey);
    if (amount === 0 || fromPlayerId === toPlayerId) return;

    const sender = this.players.get(fromPlayerId);
    const receiver = this.players.get(toPlayerId);
    if (!sender) throw new LedgerError(`Unknown sender: ${fromPlayerId}`);
    if (!receiver) throw new LedgerError(`Unknown receiver: ${toPlayerId}`);

    if (sender.wallet_balance_toks < amount) {
      throw new LedgerError(
        `Insufficient wallet balance for ${sender.nickname}: needs ${amount} CHIP, has ${sender.wallet_balance_toks} CHIP`
      );
    }

    sender.wallet_balance_toks -= amount;
    receiver.wallet_balance_toks += amount;

    const now = this.clock.now();
    this.entries.push(
      {
        id: this.nextEntryId(),
        player_id: fromPlayerId,
        market_id: marketId,
        account: 'wallet',
        delta_toks: -amount,
        tx_type: txType,
        idempotency_key: `${idempotencyKey}:from`,
        note,
        created_at: now,
      },
      {
        id: this.nextEntryId(),
        player_id: toPlayerId,
        market_id: marketId,
        account: 'wallet',
        delta_toks: amount,
        tx_type: txType,
        idempotency_key: `${idempotencyKey}:to`,
        note,
        created_at: now,
      }
    );
  }

  /**
   * Settles a batch of escrow-backed payouts atomically.
   * Each item specifies `escrowRelease` (how much of that player's escrow is consumed/unlocked)
   * and `walletCredit` (how much CHIP is credited to their wallet).
   * Enforces strict zero-sum: sum(escrowRelease) === sum(walletCredit).
   */
  public settleEscrowBatch(
    marketId: string,
    legs: Array<{ playerId: string; escrowRelease: number; walletCredit: number; note?: string }>,
    txType: LedgerTxType,
    idempotencyKey: string
  ): void {
    this.checkAndRecordIdempotency(idempotencyKey);

    let totalEscrowReleased = 0;
    let totalWalletCredited = 0;

    for (const leg of legs) {
      ToksLedger.assertIntegerToks(leg.escrowRelease, `escrowRelease for ${leg.playerId}`);
      ToksLedger.assertIntegerToks(leg.walletCredit, `walletCredit for ${leg.playerId}`);
      if (leg.escrowRelease < 0 || leg.walletCredit < 0) {
        throw new LedgerError('Settlement leg amounts cannot be negative');
      }
      const p = this.players.get(leg.playerId);
      if (!p) throw new LedgerError(`Unknown player in settlement: ${leg.playerId}`);
      if (p.escrow_balance_toks < leg.escrowRelease) {
        throw new LedgerError(
          `Escrow underflow for ${p.nickname}: trying to release ${leg.escrowRelease}, has ${p.escrow_balance_toks}`
        );
      }
      totalEscrowReleased += leg.escrowRelease;
      totalWalletCredited += leg.walletCredit;
    }

    if (totalEscrowReleased !== totalWalletCredited) {
      throw new LedgerError(
        `Zero-sum violation in settleEscrowBatch: released ${totalEscrowReleased} CHIP != credited ${totalWalletCredited} CHIP`
      );
    }

    const now = this.clock.now();
    legs.forEach((leg, idx) => {
      const p = this.players.get(leg.playerId)!;
      p.escrow_balance_toks -= leg.escrowRelease;
      p.wallet_balance_toks += leg.walletCredit;

      if (leg.escrowRelease > 0) {
        this.entries.push({
          id: this.nextEntryId(),
          player_id: leg.playerId,
          market_id: marketId,
          account: 'escrow',
          delta_toks: -leg.escrowRelease,
          tx_type: txType,
          idempotency_key: `${idempotencyKey}:${idx}:escrow`,
          note: leg.note ?? 'Escrow settlement release',
          created_at: now,
        });
      }
      if (leg.walletCredit > 0) {
        this.entries.push({
          id: this.nextEntryId(),
          player_id: leg.playerId,
          market_id: marketId,
          account: 'wallet',
          delta_toks: leg.walletCredit,
          tx_type: txType,
          idempotency_key: `${idempotencyKey}:${idx}:wallet`,
          note: leg.note ?? 'Wallet settlement credit',
          created_at: now,
        });
      }
    });

    this.assertInvariants();
  }

  /**
   * Verifies both the Zero-Sum Invariant and the Solvency Invariant (SPEC §7.1).
   */
  public assertInvariants(): void {
    let currentSum = 0;
    for (const p of this.players.values()) {
      ToksLedger.assertIntegerToks(p.wallet_balance_toks, `wallet of ${p.id}`);
      ToksLedger.assertIntegerToks(p.escrow_balance_toks, `escrow of ${p.id}`);
      if (p.wallet_balance_toks < 0) {
        throw new LedgerError(`Solvency violation: ${p.nickname} has negative wallet (${p.wallet_balance_toks})`);
      }
      if (p.escrow_balance_toks < 0) {
        throw new LedgerError(`Solvency violation: ${p.nickname} has negative escrow (${p.escrow_balance_toks})`);
      }
      currentSum += p.wallet_balance_toks + p.escrow_balance_toks;
    }

    if (currentSum !== this.totalMintedToks) {
      throw new LedgerError(
        `Zero-sum violation: current total CHIP (${currentSum}) != minted total CHIP (${this.totalMintedToks})`
      );
    }

    const entryDeltaSum = this.entries.reduce((acc, e) => acc + e.delta_toks, 0);
    if (entryDeltaSum !== 0) {
      throw new LedgerError(`Double-entry ledger sum is non-zero: ${entryDeltaSum}`);
    }
  }

  public exportState() {
    return {
      players: this.getAllPlayers(),
      entries: this.getEntries(),
      processedIdempotencyKeys: Array.from(this.processedIdempotencyKeys),
      totalMintedToks: this.totalMintedToks,
      entrySeq: this.entrySeq,
    };
  }

  public importState(data: {
    players?: Player[];
    entries?: LedgerEntry[];
    processedIdempotencyKeys?: string[];
    totalMintedToks?: number;
    entrySeq?: number;
  }): void {
    this.players.clear();
    this.entries = [];
    this.processedIdempotencyKeys.clear();
    this.totalMintedToks = 0;
    this.entrySeq = data.entrySeq ?? 0;

    for (const p of data.players ?? []) {
      this.players.set(p.id, { ...p });
      this.totalMintedToks += p.wallet_balance_toks + p.escrow_balance_toks;
    }
    if (typeof data.totalMintedToks === 'number') {
      this.totalMintedToks = data.totalMintedToks;
    }
    for (const e of data.entries ?? []) {
      this.entries.push({ ...e });
    }
    for (const k of data.processedIdempotencyKeys ?? []) {
      this.processedIdempotencyKeys.add(k);
    }
  }
}
