import { afterEach, describe, it, expect, vi } from 'vitest';
import { app } from '../src/worker/index';

const post = (path: string) => app.request(path, { method: 'POST' });

describe('Dev tools guard', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('hides dev and demo routes unless DEV_TOOLS is on', async () => {
    vi.stubEnv('DEV_TOOLS', '');
    expect((await post('/api/dev/personas')).status).toBe(404);
    expect((await post('/api/demo/reset')).status).toBe(404);
  });

  it('registers the five French personas once', async () => {
    vi.stubEnv('DEV_TOOLS', '1');
    expect((await post('/api/dev/personas')).status).toBe(200);
    const res = await post('/api/dev/personas');
    const { players } = (await res.json()) as { players: { id: string; nickname: string }[] };

    const personas = players.filter((p) =>
      ['edouard', 'jules', 'andre', 'michel', 'nathalie'].includes(p.id)
    );
    expect(personas.map((p) => p.nickname).sort()).toEqual([
      'ANDRÉ',
      'JULES',
      'MICHEL',
      'NATHALIE',
      'ÉDOUARD',
    ]);
  });
});
