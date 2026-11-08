import { describe, it, expect } from 'vitest';
import { app } from '../src/worker/index';

async function call(path: string, body?: Record<string, unknown>) {
  const res = await app.request(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function yesNoMarket(question: string, closesAt: number | null) {
  const { json } = await call('/api/markets', {
    proposer_id: 'you',
    archetype: 'simple',
    question,
    unit: 'binary',
    bounds: [0, 100],
    payoff_mode: 'pot',
    lot_stake_k: 25,
    verifiability: 'public_verifiable',
    route: 'auto',
    live_implied_value: 50,
    closes_at_wall_ms: closesAt,
  });
  return json.market;
}

describe('Close time and results', () => {
  it('saves the close time and refuses bets after it', async () => {
    const m = await yesNoMarket('Will it snow tomorrow? (closed)', Date.now() - 1000);
    expect(m.closes_at_wall_ms).toBeLessThan(Date.now());
    const late = await call(`/api/markets/${m.id}/take`, { playerId: 'you', side: 'YES', amount: 1 });
    expect(late.status).toBe(400);
    expect(late.json.error).toMatch(/closed/i);
  });

  it('settling a yes/no bet records the result and who won what', async () => {
    const m = await yesNoMarket('Will it snow tomorrow?', Date.now() + 3_600_000);
    expect((await call(`/api/markets/${m.id}/take`, { playerId: 'you', side: 'YES', amount: 1 })).status).toBe(200);
    expect((await call(`/api/markets/${m.id}/take`, { playerId: 'michel', side: 'NO', amount: 1 })).status).toBe(200);

    const { status, json } = await call(`/api/markets/${m.id}/resolve/settle`, { outcomeX: 0 });
    expect(status).toBe(200);
    expect(json.market.state).toBe('settled');
    expect(json.market.settled_outcome).toBe(0);
    expect(json.market.settled_at_wall_ms).toBeGreaterThan(0);
    expect(json.market.settlement_pnl.michel).toBe(25);
    expect(json.market.settlement_pnl.you).toBe(-25);

    // ...and it's on the market everyone sees in /api/state
    const state = await call('/api/state');
    const seen = state.json.markets.find((x: any) => x.id === m.id);
    expect(seen.settlement_pnl).toEqual(json.market.settlement_pnl);
  });
});
