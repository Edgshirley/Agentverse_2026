import { afterEach, describe, it, expect, vi } from 'vitest';
import { app } from '../src/worker/index';

async function post(path: string, body: Record<string, unknown> = {}) {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json: any = await res.json();
  expect(res.status, JSON.stringify(json)).toBeLessThan(400);
  return json;
}

describe('Window market lifecycle through the API', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('stays open after the quote so friends can take, then goes live on lock', async () => {
    const { market } = await post('/api/markets', {
      proposer_id: 'you',
      archetype: 'spread',
      question: 'How many pit stops will the winner make?',
      unit: 'pit stops',
      bounds: [0, 12],
      no_event_value: 0,
      criteria: 'Official race classification',
      resolution_source: 'FIA',
      payoff_mode: 'linear',
      lot_stake_k: 25,
      cap_widths_c: 3,
      verifiability: 'public_verifiable',
      route: 'auto',
      arbiter_id: null,
      countdown_ends_at: null,
      parent_market_id: null,
      parent_metric: null,
      parent_trigger_target: null,
      live_implied_value: 4,
      toggles: {
        max_lots: 3,
        forced_trading: false,
        hidden_takes: false,
        single_mm_requote: true,
        live_reopen_halftime: false,
        public_positions_and_stops: true,
      },
    });

    const id = market.id;
    vi.stubEnv('DEV_TOOLS', '1'); // skip the auction timer
    await post(`/api/markets/${id}/auction/bid`, { playerId: 'you', width: 2 });
    await post(`/api/markets/${id}/auction/finalize`);

    const quoted = await post(`/api/markets/${id}/auction/quote`, { playerId: 'you', L: 3 });
    expect(quoted.market.state).toBe('open');
    expect([quoted.market.L, quoted.market.H]).toEqual([3, 5]);

    const taken = await post(`/api/markets/${id}/take`, {
      playerId: 'friend_a',
      side: 'OVER',
      amount: 1,
    });
    expect(taken.positions.some((p: any) => p.player_id === 'friend_a' && p.lots > 0)).toBe(true);

    const live = await post(`/api/markets/${id}/lock-takes`, { playerId: 'you' });
    expect(live.market.state).toBe('live');
  });
});
