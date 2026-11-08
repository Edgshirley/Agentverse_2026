import { afterEach, describe, it, expect, vi } from 'vitest';
import { app, closeExpiredAuctions } from '../src/worker/index';
import { AUCTION_QUIET_PERIOD_MS } from '../src/engine/auction';
import { globalStore } from '../src/worker/db';

const send = (path: string, body: Record<string, unknown> = {}) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

let counter = 0;
async function openAuction(): Promise<string> {
  const id = `auction_${++counter}`;
  const res = await send('/api/markets', {
    id,
    proposer_id: 'proposer',
    archetype: 'spread',
    question: 'How many pit stops?',
    unit: 'pit stops',
    bounds: [0, 12],
    payoff_mode: 'linear',
    lot_stake_k: 25,
    cap_widths_c: 3,
    route: 'auto',
    toggles: { max_lots: 3, public_positions_and_stops: true },
  });
  expect(res.status).toBe(200);
  return id;
}

const stateOf = (id: string) => globalStore.engine.getMarket(id);

describe('Bid-down auction', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('only accepts narrower bids and restarts a shared clock on each one', async () => {
    const id = await openAuction();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

    expect((await send(`/api/markets/${id}/auction/bid`, { playerId: 'a', width: 5 })).status).toBe(200);
    expect(stateOf(id).auction_closes_at_wall_ms).toBe(1_000_000 + AUCTION_QUIET_PERIOD_MS);

    expect((await send(`/api/markets/${id}/auction/bid`, { playerId: 'b', width: 5 })).status).toBe(400);

    now.mockReturnValue(1_010_000);
    expect((await send(`/api/markets/${id}/auction/bid`, { playerId: 'b', width: 3 })).status).toBe(200);
    expect(stateOf(id).auction_closes_at_wall_ms).toBe(1_010_000 + AUCTION_QUIET_PERIOD_MS);
  });

  it('closes on the server at the deadline and seats the tightest bidder', async () => {
    const id = await openAuction();
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    await send(`/api/markets/${id}/auction/bid`, { playerId: 'wide', width: 6 });
    await send(`/api/markets/${id}/auction/bid`, { playerId: 'tight', width: 2 });

    now.mockReturnValue(2_000_000 + AUCTION_QUIET_PERIOD_MS - 1);
    await closeExpiredAuctions();
    expect(stateOf(id).state).toBe('width_auction');

    now.mockReturnValue(2_000_000 + AUCTION_QUIET_PERIOD_MS);
    await closeExpiredAuctions();
    expect(stateOf(id).state).toBe('quoting');
    expect(stateOf(id).mm_player_id).toBe('tight');
    expect(stateOf(id).active_width_w).toBe(2);
  });

  it('does not let anyone end the auction early outside dev', async () => {
    const id = await openAuction();
    await send(`/api/markets/${id}/auction/bid`, { playerId: 'a', width: 5 });
    vi.stubEnv('DEV_TOOLS', '');
    expect((await send(`/api/markets/${id}/auction/finalize`)).status).toBe(409);
    expect(stateOf(id).state).toBe('width_auction');
  });

  it('lets only the market maker set the window and open the book', async () => {
    const id = await openAuction();
    vi.stubEnv('DEV_TOOLS', '1');
    await send(`/api/markets/${id}/auction/bid`, { playerId: 'winner', width: 2 });
    await send(`/api/markets/${id}/auction/finalize`);

    expect((await send(`/api/markets/${id}/auction/quote`, { playerId: 'someone', L: 3 })).status).toBe(400);
    expect((await send(`/api/markets/${id}/auction/quote`, { playerId: 'winner', L: 3 })).status).toBe(200);

    await send(`/api/markets/${id}/take`, { playerId: 'bettor', side: 'OVER', amount: 1 });
    expect((await send(`/api/markets/${id}/lock-takes`, { playerId: 'bettor' })).status).toBe(403);
    expect(stateOf(id).state).toBe('open');
    expect((await send(`/api/markets/${id}/lock-takes`, { playerId: 'winner' })).status).toBe(200);
    expect(stateOf(id).state).toBe('live');
  });
});
