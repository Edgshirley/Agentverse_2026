import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { app, runMarketTimers } from '../src/worker/index';
import { globalStore } from '../src/worker/db';
import { Market } from '../src/shared/types';

const send = (path: string, body: Record<string, unknown> = {}) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const chunk = { web: { uri: 'https://example.com/result', title: 'example.com' } };

function geminiSays(payload: unknown, chunks: unknown[] = [chunk]) {
  return vi.fn().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: JSON.stringify(payload) }] },
              groundingMetadata: { groundingChunks: chunks },
            },
          ],
        }),
        { status: 200 }
      )
  );
}

const PIT_STOP_BET = {
  is_bet: true,
  question: 'Minutes to the first pit stop at the Las Vegas GP on 22 Nov?',
  market_type: 'spread',
  unit: 'minutes',
  bounds: [0, 90],
  opening_spread: 10,
  no_event_value: 90,
  stake: null,
  resolution_source: 'Formula 1 official timing',
  criteria: 'Minutes from lights out to the first pit stop.',
  resolves_at: '2026-11-23T08:00:00Z',
  resolvable_publicly: true,
};

let counter = 0;
async function createLiveMarket(extra: Record<string, unknown> = {}): Promise<Market> {
  const res = await send('/api/markets', {
    id: `live_${++counter}`,
    proposer_id: 'proposer',
    archetype: 'simple',
    question: 'Will it rain?',
    unit: '%',
    bounds: [0, 100],
    criteria: 'Official station reports rain.',
    route: 'auto',
    ...extra,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { market: Market }).market;
}

describe('Live bet proposal', () => {
  beforeEach(() => vi.stubEnv('GEMINI_API_KEY', 'test-key'));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('fails clearly with no key rather than inventing a market', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await send('/api/agents/intake', { prompt: 'time to first pit stop today' });
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds the bet from Gemini, including the opening spread', async () => {
    vi.stubGlobal('fetch', geminiSays(PIT_STOP_BET));
    const res = await send('/api/agents/intake', {
      prompt: 'time (minutes) to first pit stop in F1 today, spread 10 minutes',
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.source).toBe('gemini');
    expect(body.draft.unit).toBe('minutes');
    expect(body.draft.bounds).toEqual([0, 90]);
    expect(body.draft.opening_width).toBe(10);
    expect(body.draft.resolves_at_ms).toBe(Date.parse('2026-11-23T08:00:00Z'));
    expect(body.classification.route).toBe('auto');
    expect(body.sources).toHaveLength(1);
  });

  it('widens the range so the no-event result is always a legal outcome', async () => {
    vi.stubGlobal('fetch', geminiSays({ ...PIT_STOP_BET, bounds: [1, 90], no_event_value: 0 }));
    const body: any = await (await send('/api/agents/intake', { prompt: 'pit stops' })).json();
    expect(body.draft.bounds).toEqual([0, 90]);
  });

  it('asks a question instead of guessing when it is not a bet', async () => {
    vi.stubGlobal('fetch', geminiSays({ is_bet: false, clarifying_question: 'Which race?' }));
    const res = await send('/api/agents/intake', { prompt: 'hello' });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toBe('Which race?');
  });

  it('rejects an incomplete answer', async () => {
    vi.stubGlobal('fetch', geminiSays({ ...PIT_STOP_BET, bounds: [50, 10] }));
    expect((await send('/api/agents/intake', { prompt: 'pit stops' })).status).toBe(503);
  });

  it('only runs presets in dev, and marks them as presets', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    vi.stubEnv('DEV_TOOLS', '');
    expect((await send('/api/agents/intake', { prompt: 'f1 pit stops', preset: true })).status).toBe(403);

    vi.stubEnv('DEV_TOOLS', '1');
    const res = await send('/api/agents/intake', { prompt: 'how many f1 pit stops', preset: true });
    expect(((await res.json()) as any).source).toBe('preset');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('makes the opening spread the first bid and announces the bet in chat', async () => {
    const market = await createLiveMarket({
      archetype: 'spread',
      unit: 'minutes',
      bounds: [0, 90],
      opening_width: 10,
    });
    expect(market.active_width_w).toBe(10);
    expect(market.mm_player_id).toBe('proposer');
    expect(market.auction_closes_at_wall_ms).toBeGreaterThan(Date.now());
    const card = globalStore.chatMessages.find((m) => m.market_id === market.id);
    expect(card?.player_id).toBe('proposer');
  });

  it('ignores a preset flag on real deployments', async () => {
    vi.stubEnv('DEV_TOOLS', '');
    expect((await createLiveMarket({ origin: 'preset' })).origin).toBe('live');
  });
});

describe('Bot resolution', () => {
  beforeEach(() => vi.stubEnv('GEMINI_API_KEY', 'test-key'));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const resolve = (id: string) => send(`/api/markets/${id}/resolve/bot`);

  it('proposes the real result with its evidence, then settles after the window', async () => {
    const market = await createLiveMarket();
    await send(`/api/markets/${market.id}/take`, { playerId: 'bettor', side: 'YES', amount: 25 });
    vi.stubGlobal('fetch', geminiSays({ status: 'resolved', outcome: 100, explanation: 'It rained.' }));

    expect((await resolve(market.id)).status).toBe(200);
    const proposed = globalStore.engine.getMarket(market.id);
    expect(proposed.state).toBe('outcome_proposed');

    const proposal = globalStore.engine.resolution.getProposal(market.id)!;
    expect(proposal.proposed_x).toBe(100);
    expect(proposal.explanation).toBe('It rained.');
    expect(proposal.sources).toHaveLength(1);

    await runMarketTimers();
    expect(globalStore.engine.getMarket(market.id).state).toBe('outcome_proposed');

    globalStore.clock.set(proposal.challenge_deadline);
    await runMarketTimers();
    const settled = globalStore.engine.getMarket(market.id);
    expect(settled.state).toBe('settled');
    expect(settled.outcome_x).toBe(100);
  });

  it.each([
    ['no web sources', { status: 'resolved', outcome: 100, explanation: 'Trust me.' }, []],
    ['an out-of-range result', { status: 'resolved', outcome: 900, explanation: 'Odd.' }, [chunk]],
    ['an unfinished event', { status: 'not_yet', outcome: null, explanation: 'Still raining.' }, [chunk]],
  ])('does not settle on %s', async (_name, payload, chunks) => {
    const market = await createLiveMarket();
    vi.stubGlobal('fetch', geminiSays(payload, chunks as unknown[]));
    const body: any = await (await resolve(market.id)).json();
    expect(body.status).toBe('not_yet');
    expect(globalStore.engine.getMarket(market.id).state).toBe('live');
  });

  it('does not spend quota on repeat checks', async () => {
    const market = await createLiveMarket();
    const fetchMock = geminiSays({ status: 'not_yet', outcome: null, explanation: 'Not yet.' });
    vi.stubGlobal('fetch', fetchMock);
    await resolve(market.id);
    await resolve(market.id);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one research call, one formatting call
  });

  it('checks on its own once the result is due', async () => {
    const market = await createLiveMarket({ resolves_at_ms: Date.now() - 1000 });
    const fetchMock = geminiSays({ status: 'not_yet', outcome: null, explanation: 'Not yet.' });
    vi.stubGlobal('fetch', fetchMock);
    await runMarketTimers();
    await runMarketTimers();
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.length).toBe(
        2 *
          globalStore.engine
            .getAllMarkets()
            .filter((m) => m.resolves_at_ms != null && m.state === 'live').length
      )
    );
    expect(globalStore.engine.getMarket(market.id).state).toBe('live');
  });

  it('leaves preset and group bets to people', async () => {
    const group = await createLiveMarket({ route: 'group' });
    expect((await resolve(group.id)).status).toBe(409);

    vi.stubEnv('DEV_TOOLS', '1');
    const preset = await createLiveMarket({ origin: 'preset' });
    expect((await resolve(preset.id)).status).toBe(409);
  });
});

describe('Production guards', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['/api/markets/x/replay/step'],
    ['/api/markets/x/replay/feed-delayed'],
    ['/api/markets/x/resolve/settle'],
    ['/api/markets/x/resolve/finalize'],
    ['/api/markets/x/resolve/lock-countdown'],
    ['/api/markets/x/void'],
  ])('hides %s outside dev', async (path) => {
    vi.stubEnv('DEV_TOOLS', '');
    expect((await send(path)).status).toBe(404);
  });

  it('blocks manual results on bot-settled bets outside dev', async () => {
    vi.stubEnv('DEV_TOOLS', '');
    const market = await createLiveMarket();
    const res = await send(`/api/markets/${market.id}/resolve/propose`, {
      playerId: 'someone',
      outcomeX: 100,
    });
    expect(res.status).toBe(403);
  });
});
