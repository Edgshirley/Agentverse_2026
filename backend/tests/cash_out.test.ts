import { afterEach, describe, it, expect, vi } from 'vitest';
import { app } from '../src/worker/index';

async function call(path: string, body?: Record<string, unknown>) {
  const res = await app.request(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as any };
}
async function post(path: string, body: Record<string, unknown> = {}) {
  const r = await call(path, body);
  expect(r.status, JSON.stringify(r.json)).toBeLessThan(400);
  return r.json;
}
async function money() {
  const { json } = await call('/api/state');
  const by: Record<string, { wallet: number; escrow: number }> = {};
  let total = 0;
  for (const p of json.players) {
    by[p.id] = { wallet: p.wallet_balance_toks, escrow: p.escrow_balance_toks };
    total += p.wallet_balance_toks + p.escrow_balance_toks;
  }
  return { by, total };
}

let n = 0;
/** Window market [3, 5] pit stops, market maker = mm_<n>, open for bets. */
async function windowMarket(closesAt: number | null = null) {
  n += 1;
  const mm = `mm_${n}`;
  const { market } = await post('/api/markets', {
    proposer_id: mm,
    archetype: 'spread',
    question: `Pit stops #${n}`,
    unit: 'pit stops',
    bounds: [0, 12],
    payoff_mode: 'binary',
    lot_stake_k: 25,
    cap_widths_c: 3,
    live_implied_value: 4,
    closes_at_wall_ms: closesAt,
    toggles: { max_lots: 3, single_mm_requote: true },
  });
  vi.stubEnv('DEV_TOOLS', '1');
  await post(`/api/markets/${market.id}/auction/bid`, { playerId: mm, width: 2 });
  await post(`/api/markets/${market.id}/auction/finalize`);
  await post(`/api/markets/${market.id}/auction/quote`, { playerId: mm, L: 3 });
  return { id: market.id as string, mm };
}
const take = (id: string, playerId: string, side: string) =>
  post(`/api/markets/${id}/take`, { playerId, side, amount: 1 });
const cashOut = (id: string, playerId: string, side: string, fractionP = 1) =>
  call(`/api/markets/${id}/withdraw`, { playerId, side, fractionP });
const worth = (bundle: any, pid: string) =>
  bundle.positions.filter((p: any) => p.player_id === pid && p.lots > 0).reduce((a: number, p: any) => a + p.live_equity_toks, 0);

describe('Window bets cash out at a live price', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('cashing out straight away returns the stake', async () => {
    const { id } = await windowMarket();
    const b = await take(id, 'p_a', 'OVER');
    expect(worth(b, 'p_a')).toBe(25);
    const before = await money();
    expect((await cashOut(id, 'p_a', 'OVER')).status).toBe(200);
    const after = await money();
    expect(after.by.p_a.wallet - before.by.p_a.wallet).toBe(25);
    expect(after.by.p_a.escrow).toBe(before.by.p_a.escrow - 25);
    expect(after.total).toBe(before.total);
  });

  it('more money on your side after you makes your bet worth more (paid by the market maker)', async () => {
    const { id, mm } = await windowMarket();
    await take(id, 'p_b', 'OVER');
    await take(id, 'p_c', 'OVER');
    await take(id, 'p_d', 'OVER');
    const b = await take(id, 'p_e', 'OVER');
    const value = worth(b, 'p_b');
    expect(value).toBeGreaterThan(25);
    const before = await money();
    expect((await cashOut(id, 'p_b', 'OVER')).status).toBe(200);
    const after = await money();
    expect(after.by.p_b.wallet - before.by.p_b.wallet).toBe(value);
    expect(after.by[mm].wallet + after.by[mm].escrow).toBe(
      before.by[mm].wallet + before.by[mm].escrow - (value - 25)
    );
    expect(after.total).toBe(before.total);
  });

  it('money piling onto the other side makes it worth less, and the market maker keeps the difference', async () => {
    const { id, mm } = await windowMarket();
    await take(id, 'p_f', 'OVER');
    await take(id, 'p_g', 'UNDER');
    await take(id, 'p_h', 'UNDER');
    const b = await take(id, 'p_i', 'UNDER');
    const value = worth(b, 'p_f');
    expect(value).toBeLessThan(25);
    const before = await money();
    expect((await cashOut(id, 'p_f', 'OVER')).status).toBe(200);
    const after = await money();
    expect(after.by.p_f.wallet - before.by.p_f.wallet).toBe(value);
    expect(after.by[mm].wallet + after.by[mm].escrow).toBe(
      before.by[mm].wallet + before.by[mm].escrow + (25 - value)
    );
    expect(after.total).toBe(before.total);
  });

  it('still settles zero-sum after some bets were cashed out', async () => {
    const { id } = await windowMarket();
    await take(id, 'p_j', 'OVER');
    await take(id, 'p_k', 'OVER');
    await take(id, 'p_l', 'UNDER');
    await cashOut(id, 'p_j', 'OVER');
    const before = await money();
    const settled = await post(`/api/markets/${id}/resolve/settle`, { outcomeX: 9 });
    expect(settled.market.state).toBe('settled');
    const after = await money();
    expect(after.total).toBe(before.total);
    expect(after.by.p_k.wallet).toBeGreaterThan(before.by.p_k.wallet); // above won
  });
});

describe('No cashing out once betting closes', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('refuses window and yes/no cash-outs after the close time', async () => {
    const soon = Date.now() + 400;
    const { id } = await windowMarket(soon);
    await take(id, 'p_m', 'OVER');
    const { market } = await post('/api/markets', {
      proposer_id: 'you', archetype: 'simple', question: 'Closed yes/no', unit: 'binary',
      bounds: [0, 100], live_implied_value: 50, lot_stake_k: 25, closes_at_wall_ms: soon,
    });
    await take(market.id, 'p_n', 'NO');
    await new Promise((r) => setTimeout(r, 500));
    for (const [mid, pid, side] of [[id, 'p_m', 'OVER'], [market.id, 'p_n', 'NO']]) {
      const r = await cashOut(mid, pid, side);
      expect(r.status).toBe(400);
      expect(r.json.error).toMatch(/closed/i);
    }
  });
});

describe('Window stops and targets fire on the bet value', () => {
  afterEach(() => vi.unstubAllEnvs());

  const strategy = (id: string, player_id: string, side: string, tp: number | null, sl: number | null) =>
    call(`/api/markets/${id}/strategy/activate`, {
      player_id,
      parsed_strategy_summary: `${side} 25 CHIP`,
      side,
      stake_toks: 25,
      take_profit_level: tp,
      min_balance_floor: sl,
      confirmed_at: Date.now(),
    });
  const myOrders = (b: any, pid: string) =>
    b.orders.filter((o: any) => o.player_id === pid).map((o: any) => `${o.type}:${o.status}`).sort();

  it('take-profit sells the bet once friends push its value up to the target', async () => {
    const { id } = await windowMarket();
    const r = await strategy(id, 's_a', 'ABOVE', 30, 10);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(myOrders(r.json, 's_a')).toEqual(['stop_loss:open', 'take_profit:open']);
    let b: any;
    for (const f of ['s_b', 's_c', 's_d']) b = await take(id, f, 'OVER');
    expect(b.positions.filter((p: any) => p.player_id === 's_a' && p.lots > 0)).toHaveLength(0);
    expect(myOrders(b, 's_a')).toEqual(['stop_loss:cancelled', 'take_profit:filled']);
  });

  it('stop-loss sells the bet once money on the other side drags it down', async () => {
    const { id } = await windowMarket();
    const r = await strategy(id, 's_e', 'ABOVE', 60, 20);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    let b: any;
    for (const f of ['s_f', 's_g', 's_h']) b = await take(id, f, 'UNDER');
    expect(b.positions.filter((p: any) => p.player_id === 's_e' && p.lots > 0)).toHaveLength(0);
    expect(myOrders(b, 's_e')).toEqual(['stop_loss:filled', 'take_profit:cancelled']);
  });

  it('refuses levels that would fire straight away, without placing the bet', async () => {
    const { id } = await windowMarket();
    const r = await strategy(id, 's_i', 'ABOVE', 6, 2); // "sell at 6 pit stops" read as CHIP
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/above what the bet is worth/);
    const { json } = await call(`/api/state?marketId=${id}`);
    expect(json.activeBundle.positions.some((p: any) => p.player_id === 's_i')).toBe(false);
  });
});

describe('Window bets placed before live pricing', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('start from the current price (worth = stake) and move from there', async () => {
    const { globalStore } = await import('../src/worker/db');
    const { id } = await windowMarket();
    await take(id, 'old_a', 'OVER');
    await take(id, 'old_b', 'UNDER');
    // Simulate bets saved before live pricing: no entry_chance
    const book = globalStore.engine.spreadBook;
    book.setPositions(id, book.getPositions(id).map(({ entry_chance, ...p }) => p as any));
    const { json } = await call(`/api/state?marketId=${id}`);
    const old = json.activeBundle.positions.find((p: any) => p.player_id === 'old_a');
    expect(old.entry_chance).toBeGreaterThan(0);
    expect(old.live_equity_toks).toBe(old.staked_toks);
    const after = await take(id, 'old_c', 'OVER');
    expect(worth(after, 'old_a')).toBeGreaterThan(old.staked_toks);
  });
});
