// ============================================================================
// Oracle & 3rd-Party Arbiter Resolution State Machine (SPEC §3.2 & §6.2)
// ============================================================================

import { Clock } from './clock';
import { Market, OutcomeProposal } from '../shared/types';

export const AUTO_CHALLENGE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
export const GROUP_CHALLENGE_WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours

export class ResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolutionError';
  }
}

export class ResolutionEngine {
  private proposalsByMarket: Map<string, OutcomeProposal> = new Map();
  private seq: number = 0;

  constructor(private readonly clock: Clock) {}

  private nextId(): string {
    this.seq += 1;
    return `prop_${this.clock.now()}_${this.seq}`;
  }

  public getProposal(marketId: string): OutcomeProposal | null {
    const p = this.proposalsByMarket.get(marketId);
    return p ? { ...p, votes: { ...p.votes } } : null;
  }

  public getAllProposals(): OutcomeProposal[] {
    return Array.from(this.proposalsByMarket.values()).map((p) => ({
      ...p,
      votes: { ...p.votes },
    }));
  }

  public exportState() {
    const proposalsByMarket: Record<string, OutcomeProposal> = {};
    for (const [k, v] of this.proposalsByMarket.entries()) {
      proposalsByMarket[k] = { ...v, votes: { ...v.votes } };
    }
    return {
      proposalsByMarket,
      seq: this.seq,
    };
  }

  public importState(data: {
    proposalsByMarket?: Record<string, OutcomeProposal>;
    seq?: number;
  }): void {
    this.proposalsByMarket.clear();
    this.seq = data.seq ?? 0;
    for (const [k, p] of Object.entries(data.proposalsByMarket ?? {})) {
      this.proposalsByMarket.set(k, { ...p, votes: { ...p.votes } });
    }
  }

  /**
   * Checks and enforces the mandatory countdown lock (`00:00:00`) for `arbiter` route markets (SPEC §3.1 & FR-08).
   */
  public checkCountdownLock(market: Market): Market {
    if (
      market.route === 'arbiter' &&
      market.countdown_ends_at != null &&
      this.clock.now() >= market.countdown_ends_at &&
      (market.state === 'live' || market.state === 'open')
    ) {
      return {
        ...market,
        state: 'countdown_locked',
        version: market.version + 1,
      };
    }
    return market;
  }

  /**
   * Proposes an outcome X according to the market's resolution route (`auto`, `arbiter`, `group`).
   * For `arbiter`, only `market.arbiter_id` can submit X, and it settles immediately!
   * For `auto` and `group`, transitions market to `outcome_proposed` (freezing early exits per SPEC §6.2).
   */
  public proposeOutcome(
    market: Market,
    proposerId: string,
    proposedX: number,
    sourceUrl: string = 'internal://oracle',
    details: Pick<OutcomeProposal, 'explanation' | 'sources'> = {}
  ): { market: Market; proposal: OutcomeProposal; readyToSettleImmediately: boolean } {
    if (market.state === 'settled' || market.state === 'void') {
      throw new ResolutionError(`Market ${market.id} is already ${market.state}`);
    }

    const now = this.clock.now();

    if (market.route === 'arbiter') {
      if (!market.arbiter_id) {
        throw new ResolutionError('Arbiter market has no designated arbiter_id');
      }
      if (proposerId !== market.arbiter_id) {
        throw new ResolutionError(
          `Only designated 3rd-party arbiter (${market.arbiter_id}) can submit the official outcome`
        );
      }
      const proposal: OutcomeProposal = {
        id: this.nextId(),
        market_id: market.id,
        proposer_id: proposerId,
        proposed_x: proposedX,
        source_url: sourceUrl,
        challenge_deadline: now,
        status: 'accepted',
        votes: { [proposerId]: proposedX },
        created_at: now,
      };
      this.proposalsByMarket.set(market.id, proposal);
      return {
        market: {
          ...market,
          outcome_x: proposedX,
          version: market.version + 1,
        },
        proposal: { ...proposal },
        readyToSettleImmediately: true,
      };
    }

    const windowMs =
      market.route === 'auto' ? AUTO_CHALLENGE_WINDOW_MS : GROUP_CHALLENGE_WINDOW_MS;

    const proposal: OutcomeProposal = {
      id: this.nextId(),
      market_id: market.id,
      proposer_id: proposerId,
      proposed_x: proposedX,
      source_url: sourceUrl,
      challenge_deadline: now + windowMs,
      status: 'pending',
      votes: { [proposerId]: proposedX },
      created_at: now,
      ...details,
    };

    this.proposalsByMarket.set(market.id, proposal);

    return {
      market: {
        ...market,
        state: 'outcome_proposed',
        version: market.version + 1,
      },
      proposal: { ...proposal },
      readyToSettleImmediately: false,
    };
  }

  /**
   * Handles a feed correction (e.g., VAR disallowed goal — SPEC §6.2):
   * Pending auto-outcome proposal is withdrawn automatically; market re-opens to `'live'`.
   */
  public applyFeedCorrection(
    market: Market,
    revertedImpliedValue: number
  ): { market: Market; withdrawnProposal: OutcomeProposal | null } {
    const existing = this.proposalsByMarket.get(market.id);
    if (existing && existing.status === 'pending') {
      existing.status = 'withdrawn_by_correction';
    }
    return {
      market: {
        ...market,
        state: 'live',
        live_implied_value: revertedImpliedValue,
        outcome_x: null,
        version: market.version + 1,
      },
      withdrawnProposal: existing ? { ...existing } : null,
    };
  }

  /**
   * Challenges a pending outcome proposal and casts a vote for an alternative outcome.
   */
  public challengeAndVote(
    market: Market,
    playerId: string,
    votedX: number
  ): OutcomeProposal {
    const proposal = this.proposalsByMarket.get(market.id);
    if (!proposal || (proposal.status !== 'pending' && proposal.status !== 'challenged')) {
      throw new ResolutionError('No active outcome proposal to challenge or vote on');
    }
    if (this.clock.now() > proposal.challenge_deadline && proposal.status === 'pending') {
      throw new ResolutionError('Challenge window has already expired');
    }
    proposal.status = 'challenged';
    proposal.votes[playerId] = votedX;
    return { ...proposal, votes: { ...proposal.votes } };
  }

  /**
   * Resolves a participant vote or expired challenge window (SPEC §3.2):
   * - If unchallenged past deadline -> returns `proposed_x`.
   * - If challenged -> tallies votes; strict plurality wins; tie voids the market!
   */
  public finalizeProposal(
    market: Market
  ): { status: 'settle' | 'void'; outcomeX?: number } {
    const proposal = this.proposalsByMarket.get(market.id);
    if (!proposal) {
      throw new ResolutionError(`No outcome proposal found for market ${market.id}`);
    }

    if (proposal.status === 'pending') {
      proposal.status = 'accepted';
      return { status: 'settle', outcomeX: proposal.proposed_x };
    }

    if (proposal.status === 'challenged') {
      const counts: Map<number, number> = new Map();
      for (const val of Object.values(proposal.votes)) {
        counts.set(val, (counts.get(val) ?? 0) + 1);
      }
      const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
      if (sorted.length >= 2 && sorted[0][1] === sorted[1][1]) {
        // Tie voids per SPEC §3.2
        proposal.status = 'rejected';
        return { status: 'void' };
      }
      proposal.status = 'accepted';
      return { status: 'settle', outcomeX: sorted[0][0] };
    }

    throw new ResolutionError(`Cannot finalize proposal in status ${proposal.status}`);
  }

  /**
   * Admin reassignment if Arbiter misses post-countdown reminders (SPEC §6.2).
   */
  public reassignArbiter(market: Market, adminIsConfirmed: boolean, newArbiterId: string): Market {
    if (!adminIsConfirmed) {
      throw new ResolutionError('Only group admins can reassign the 3rd-party arbiter');
    }
    return {
      ...market,
      arbiter_id: newArbiterId,
      version: market.version + 1,
    };
  }
}
