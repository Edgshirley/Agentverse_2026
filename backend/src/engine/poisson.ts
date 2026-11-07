// ============================================================================
// Analytical Poisson Fair-Value Model for Time-of-First-Goal Spread Markets
// (SPEC §2.4.A.4 & §5.1)
// ============================================================================

export interface PoissonSpreadValuation {
  currentMinute: number;
  expectedGoalMinute: number;
  probUnder: number; // P(X < L)
  probInside: number; // P(L <= X <= H)
  probOver: number; // P(X > H)
  overLotFairValueToks: number;
  underLotFairValueToks: number;
  commentary: string;
}

/**
 * Computes analytical probabilities and per-lot fair values (in integer TOKS)
 * for a "Time of First Goal" spread market `[L, H]` conditioned on no goal scored up to `currentMinute`.
 * Uses an exponential arrival time distribution (Poisson process with intensity `lambdaPer95Min`).
 */
export function computePoissonSpreadFairValue(params: {
  currentMinute: number;
  L: number;
  H: number;
  maxMinute?: number;
  totalPotToks: number;
  overLots: number;
  underLots: number;
  lambdaPerMatch?: number;
}): PoissonSpreadValuation {
  const {
    currentMinute,
    L,
    H,
    maxMinute = 95,
    totalPotToks,
    overLots,
    underLots,
    lambdaPerMatch = 1.65,
  } = params;

  const t = Math.max(0, Math.min(maxMinute, currentMinute));
  const ratePerMin = lambdaPerMatch / maxMinute;

  // Conditional probability of first arrival in (a, b] given T > t:
  // P(T > x | T > t) = exp(-ratePerMin * max(0, x - t))
  const survivalAfter = (x: number): number => {
    if (x <= t) return 1.0;
    return Math.exp(-ratePerMin * (x - t));
  };

  let probUnder = 0;
  let probInside = 0;
  let probOver = 0;

  if (t >= H) {
    // Match clock has already passed H with no goal -> Over is 100% certain to win!
    probUnder = 0;
    probInside = 0;
    probOver = 1.0;
  } else if (t >= L) {
    // Match clock is currently inside [L, H] with no goal yet -> Under is 0%
    probUnder = 0;
    probOver = survivalAfter(H);
    probInside = 1.0 - probOver;
  } else {
    // Match clock is before L (t < L):
    // Strict boundary rule (SPEC §2.2): Under wins strictly if X < L -> P(T <= L - 1)
    const pSurviveToL = survivalAfter(Math.max(t, L - 0.5));
    const pSurviveToH = survivalAfter(H);
    probUnder = Math.max(0, 1.0 - pSurviveToL);
    probOver = Math.max(0, pSurviveToH);
    probInside = Math.max(0, 1.0 - probUnder - probOver);
  }

  // Conditional expected goal minute E[min(T, maxMinute) | T > t]
  const remainingMean = (1 - Math.exp(-ratePerMin * (maxMinute - t))) / ratePerMin;
  const expectedGoalMinute = Math.min(maxMinute, Math.round((t + remainingMean) * 10) / 10);

  const safeOverLots = Math.max(1, overLots);
  const safeUnderLots = Math.max(1, underLots);

  const overLotFairValueToks = Math.round((probOver * totalPotToks) / safeOverLots);
  const underLotFairValueToks = Math.round((probUnder * totalPotToks) / safeUnderLots);

  const commentary =
    t >= H
      ? `MIN ${t}' (0-0): Clock passed H=${H}' — OVER [${L}..${H}] locked at 100% win probability.`
      : `MIN ${t}' (0-0): Poisson model projects E[X]=${expectedGoalMinute}', P(OVER)=${Math.round(
          probOver * 100
        )}%, P(INSIDE)=${Math.round(probInside * 100)}%, P(UNDER)=${Math.round(
          probUnder * 100
        )}% -> Fair Value ${overLotFairValueToks} TOKS/Over lot.`;

  return {
    currentMinute: t,
    expectedGoalMinute,
    probUnder,
    probInside,
    probOver,
    overLotFairValueToks,
    underLotFairValueToks,
    commentary,
  };
}
