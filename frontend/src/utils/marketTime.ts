import { useEffect, useState } from 'react';
import { Market } from '../shared/types';

export const isFinished = (m: Market) => m.state === 'settled' || m.state === 'void';

/** Past its close time but no result yet: the creator needs to enter it. */
export const isAwaitingResult = (m: Market, now = Date.now()) =>
  !isFinished(m) && m.closes_at_wall_ms != null && now >= m.closes_at_wall_ms;

export function formatTimeLeft(ms: number): string {
  if (ms <= 0) return "time's up";
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** Short status for cards: "closes in 3h 20m", "time's up", "NO won". */
export function marketStatusLine(m: Market, now = Date.now()): string {
  if (m.state === 'void') return 'cancelled · refunded';
  if (m.state === 'settled') return `result: ${describeOutcome(m)}`;
  if (m.closes_at_wall_ms == null) return m.state.replace(/_/g, ' ');
  return isAwaitingResult(m, now)
    ? "time's up · waiting for result"
    : `closes in ${formatTimeLeft(m.closes_at_wall_ms - now)}`;
}

export function describeOutcome(m: Market): string {
  const x = m.settled_outcome;
  if (x == null) return '—';
  if (m.archetype !== 'spread') return x >= 50 ? 'YES' : 'NO';
  return `${x} ${m.unit && m.unit !== 'binary' && m.unit !== '%' ? m.unit : ''}`.trim();
}

/** Re-render every `ms` so countdowns tick. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
