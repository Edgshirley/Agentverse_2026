import { afterEach, describe, it, expect, vi } from 'vitest';
import { app } from '../src/worker/index';

async function call(path: string, body: Record<string, unknown> = {}) {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function post(path: string, body: Record<string, unknown> = {}) {
  const { status, json } = await call(path, body);
  expect(status, JSON.stringify(json)).toBeLessThan(400);
  return json;
}

/** Window market quoted at [3, 5] by `you`, open for friends to take. */
async function openWindowMarket() {
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
  vi.stubEnv('DEV_TOOLS', '1'); // skip the auction timer
  await post(`/api/markets/${market.id}/auction/bid`, { playerId: 'you', width: 2 });
  await post(`/api/markets/${market.id}/auction/finalize`);
  await post(`/api/markets/${market.id}/auction/quote`, { playerId: 'you', L: 3 });
  return market.id as string;
}

describe('Stops and targets on window (spread) bets', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('bot strategy places the bet plus its stop-loss and take-profit (side said as ABOVE)', async () => {
    const id = await openWindowMarket();
    const bundle = await post(`/api/markets/${id}/strategy/activate`, {
      player_id: 'friend_b',
      raw_transcript: 'Bet 50 on ABOVE, sell at 6, stop me out at 2',
      parsed_strategy_summary: 'Bet 50 CHIP on ABOVE, sell at 6, stop at 2',
      side: 'ABOVE',
      stake_toks: 50,
      take_profit_level: 6,
      min_balance_floor: 2,
      confirmed_at: Date.now(),
    });

    const mine = bundle.positions.filter((p: any) => p.player_id === 'friend_b');
    expect(mine.some((p: any) => p.side === 'OVER' && p.lots > 0)).toBe(true);
    const orders = bundle.orders.filter((o: any) => o.player_id === 'friend_b');
    expect(orders.map((o: any) => o.type).sort()).toEqual(['stop_loss', 'take_profit']);
    expect(orders.every((o: any) => o.side === 'OVER')).toBe(true);
  });

  it('manual stop-loss works after taking a window bet, and is still refused without one', async () => {
    const id = await openWindowMarket();
    await post(`/api/markets/${id}/take`, { playerId: 'friend_c', side: 'UNDER', amount: 1 });

    const ok = await call(`/api/markets/${id}/orders`, {
      playerId: 'friend_c',
      side: 'BELOW',
      type: 'stop_loss',
      triggerLevel: 1,
      sizeToks: 25,
    });
    expect(ok.status, JSON.stringify(ok.json)).toBeLessThan(400);

    const refused = await call(`/api/markets/${id}/orders`, {
      playerId: 'friend_d',
      side: 'OVER',
      type: 'stop_loss',
      triggerLevel: 1,
      sizeToks: 25,
    });
    expect(refused.status).toBe(400);
  });
});
