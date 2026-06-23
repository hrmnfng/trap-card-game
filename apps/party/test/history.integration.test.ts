import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { addPlayer, createRoomState } from '@trap/shared';
import type { Env } from '../src/env.js';
import { recordLobbyHistory } from '../src/history.js';

const testEnv = env as unknown as Env;

// These tests exercise only the Worker REST surface + D1 (no Durable Object is
// instantiated), so they avoid the Windows vitest-pool-workers DO isolated-
// storage flake that affects lobby.integration's DO round-trip test.
describe('GET /api/lobbies/history', () => {
  it("returns the authenticated user's lobbies", async () => {
    const reg = await SELF.fetch('https://do/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'historian', password: 'password1' }),
    });
    expect(reg.status).toBe(200);
    const { userId, token } = (await reg.json()) as {
      userId: string;
      token: string;
    };

    // Seed a history row for this user via the recorder (D1 only).
    const room = addPlayer(
      createRoomState({
        lobbyId: 'HIST01',
        lobbyCode: 'HIST01',
        now: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
      userId,
      'historian',
      {
        newId: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
      }
    ).state;
    await recordLobbyHistory(testEnv, room);

    const res = await SELF.fetch('https://do/api/lobbies/history', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      lobbies: Array<{ code: string; status: string }>;
    };
    expect(body.lobbies).toHaveLength(1);
    expect(body.lobbies[0]).toMatchObject({ code: 'HIST01', status: 'waiting' });
  });

  it('rejects an unauthenticated request', async () => {
    const res = await SELF.fetch('https://do/api/lobbies/history');
    expect(res.status).toBe(401);
  });
});
