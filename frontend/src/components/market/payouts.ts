import { Market, PayoffMode } from '../../shared/types';

export const PAYOUT_MODES: { mode: PayoffMode; label: string; blurb: string }[] = [
  { mode: 'binary', label: 'Binary', blurb: 'A flat stake: right or wrong.' },
  { mode: 'linear', label: 'Linear', blurb: 'Pays more the further past the window it lands.' },
  { mode: 'log', label: 'Log', blurb: 'Like linear, by ratio. The window must start above 0.' },
  { mode: 'pot', label: 'Pot', blurb: 'The winning side splits the whole pot.' },
];

/** One line telling a bettor what a winning bet is worth on this market. */
export function describePayout(market: Market, unit: string): string {
  const stake = market.lot_stake_k;
  const cap = market.cap_widths_c ?? 3;
  const width = market.active_width_w ?? (market.H ?? 0) - (market.L ?? 0);

  switch (market.payoff_mode) {
    case 'binary':
      return `Binary: ${stake} CHIP a lot, win or lose.`;
    case 'linear':
      return `Linear: ${stake} CHIP per ${width} ${unit} past the edge, up to ${cap}x.`;
    case 'log':
      return `Log: scales by ratio past the edge, up to ${cap}x.`;
    default:
      return 'Pot: the winning side splits the whole pot.';
  }
}
