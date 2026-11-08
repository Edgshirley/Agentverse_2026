import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { clearOutsideOddsCache, getOutsideOdds } from '../src/worker/agents';
import { Market } from '../src/shared/types';

const market = (id = 'm1') =>
  ({
    id,
    question: 'Will Arsenal beat Chelsea?',
    unit: '%',
    bounds: [0, 100],
    archetype: 'simple',
  }) as unknown as Market;

const env = { GEMINI_API_KEY: 'test-key' } as any;

function geminiReply(text: string, chunks: unknown[] = []) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, groundingMetadata: { groundingChunks: chunks } }],
    }),
    { status: 200 }
  );
}

const grounded = '{"summary":"Bookmakers favour Arsenal.","quotes":[{"source":"Polymarket","value":"58%"}]}';
const chunk = { web: { uri: 'https://example.com/odds', title: 'example.com' } };

describe('Outside odds', () => {
  beforeEach(() => clearOutsideOddsCache());
  afterEach(() => vi.unstubAllGlobals());

  it('reports a missing key without calling Gemini', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await getOutsideOdds(market(), {} as any)).status).toBe('unconfigured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks Gemini with search grounding and keeps the key out of the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiReply(grounded, [chunk]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getOutsideOdds(market(), env);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain('test-key');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body);
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(body.generationConfig.responseMimeType).toBeUndefined();

    expect(result.status).toBe('ok');
    expect(result.quotes).toEqual([{ source: 'Polymarket', value: '58%', detail: undefined }]);
    expect(result.sources).toEqual([{ title: 'example.com', url: 'https://example.com/odds' }]);
  });

  it('refuses to show numbers that have no web sources behind them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiReply(grounded, [])));
    const result = await getOutsideOdds(market(), env);
    expect(result.status).toBe('no_data');
    expect(result.quotes).toEqual([]);
  });

  it('drops source links that are not plain https', async () => {
    const bad = { web: { uri: 'javascript:alert(1)', title: 'bad' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiReply(grounded, [bad, chunk])));
    const result = await getOutsideOdds(market(), env);
    expect(result.sources.map((s) => s.url)).toEqual(['https://example.com/odds']);
  });

  it('caches per market so page views do not spend quota', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => geminiReply(grounded, [chunk]));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([getOutsideOdds(market(), env), getOutsideOdds(market(), env)]);
    await getOutsideOdds(market(), env);
    await getOutsideOdds(market(), env, true); // too soon to refresh
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await getOutsideOdds(market('m2'), env);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports Gemini failures as an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })));
    expect((await getOutsideOdds(market(), env)).status).toBe('error');
  });
});
