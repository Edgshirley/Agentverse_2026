import { describe, it, expect } from 'vitest';
import { createSqliteD1Database } from '../src/worker/sqlite_d1';
import { EdgeStateStore, MAX_CHAT_MESSAGES } from '../src/worker/db';
import { app } from '../src/worker/index';

const postChat = (body: Record<string, unknown>) =>
  app.request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('Group chat', () => {
  it('stores a message and returns it in the shared state', async () => {
    const res = await postChat({ playerId: 'you', text: '  bet on the race?  ' });
    expect(res.status).toBe(200);

    const state: any = await (await app.request('/api/state')).json();
    const last = state.chatMessages[state.chatMessages.length - 1];
    expect(last.player_id).toBe('you');
    expect(last.text).toBe('bet on the race?');
  });

  it('rejects empty and oversized messages', async () => {
    expect((await postChat({ playerId: 'you', text: '   ' })).status).toBe(400);
    expect((await postChat({ playerId: 'you', text: 'x'.repeat(1001) })).status).toBe(400);
  });

  it('survives a restart, clears on reset and keeps only recent history', async () => {
    const db = createSqliteD1Database(':memory:');
    const before = new EdgeStateStore(db, false);
    before.addChatMessage('you', 'still here after a restart');
    await before.persistToD1({ DB: db } as any);

    const after = new EdgeStateStore(db, false);
    await after.hydrateFromD1({ DB: db } as any);
    expect(after.chatMessages.map((m) => m.text)).toEqual(['still here after a restart']);

    for (let i = 0; i < MAX_CHAT_MESSAGES + 5; i++) after.addChatMessage('you', `m${i}`);
    expect(after.chatMessages).toHaveLength(MAX_CHAT_MESSAGES);
    expect(after.chatMessages[after.chatMessages.length - 1].text).toBe(`m${MAX_CHAT_MESSAGES + 4}`);

    after.reset();
    expect(after.chatMessages).toHaveLength(0);
  });
});
