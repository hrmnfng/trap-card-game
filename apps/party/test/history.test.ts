import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import {
  addPlayer,
  createRoomState,
  type GameRoomState,
  type RuleDeps,
} from '@trap/shared';
import type { Env } from '../src/env.js';
import { recordLobbyHistory, listLobbyHistory } from '../src/history.js';

const testEnv = env as unknown as Env;

let seq = 0;
const deps: RuleDeps = {
  newId: () => `id-${seq++}`,
  now: () => new Date().toISOString(),
};

function newRoom(code: string): GameRoomState {
  return createRoomState({
    lobbyId: code,
    lobbyCode: code,
    now: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
}

/** Add two players; first (p1) becomes owner. */
function roomWithTwo(code: string): GameRoomState {
  let room = newRoom(code);
  room = addPlayer(room, 'p1', 'Alice', deps).state;
  room = addPlayer(room, 'p2', 'Bob', deps).state;
  return room;
}

describe('lobby history persistence', () => {
  it('records a waiting row for every member', async () => {
    const room = roomWithTwo('AAA111');
    await recordLobbyHistory(testEnv, room);

    const alice = await listLobbyHistory(testEnv, 'p1');
    expect(alice).toHaveLength(1);
    expect(alice[0]).toMatchObject({
      code: 'AAA111',
      status: 'waiting',
      ownerId: 'p1',
      ownerUsername: 'Alice',
      playerCount: 2,
    });
    const bob = await listLobbyHistory(testEnv, 'p2');
    expect(bob[0]?.code).toBe('AAA111');
  });

  it('does not duplicate a row when recorded twice', async () => {
    const room = roomWithTwo('AAA222');
    await recordLobbyHistory(testEnv, room);
    await recordLobbyHistory(testEnv, { ...room, status: 'in-progress' });

    const alice = await listLobbyHistory(testEnv, 'p1');
    expect(alice).toHaveLength(1);
    expect(alice[0]?.status).toBe('in-progress');
  });

  it('updates status to concluded for all permanent members', async () => {
    let room = roomWithTwo('BBB222');
    await recordLobbyHistory(testEnv, room); // waiting
    // Membership is permanent — no removePlayer. Conclude the room directly.
    room = { ...room, status: 'concluded' };
    await recordLobbyHistory(testEnv, room);

    const bob = await listLobbyHistory(testEnv, 'p2');
    expect(bob).toHaveLength(1);
    expect(bob[0]?.status).toBe('concluded');
    // Both players are permanent members, so the count reflects both.
    expect(bob[0]?.playerCount).toBe(2);
  });

  it('preserves joined_at across updates', async () => {
    const room = roomWithTwo('CCC333');
    await recordLobbyHistory(testEnv, room);
    const first = (await listLobbyHistory(testEnv, 'p1'))[0]!;
    await recordLobbyHistory(testEnv, { ...room, status: 'in-progress' });
    const second = (await listLobbyHistory(testEnv, 'p1'))[0]!;
    expect(second.status).toBe('in-progress');
    expect(second.joinedAt).toBe(first.joinedAt);
    expect(second.id).toBe(first.id);
  });

  it('lists multiple lobbies for a user, newest first, camelCase mapped', async () => {
    await recordLobbyHistory(testEnv, roomWithTwo('DDD444'));
    await new Promise((r) => setTimeout(r, 5));
    await recordLobbyHistory(testEnv, roomWithTwo('EEE555'));

    const list = await listLobbyHistory(testEnv, 'p1');
    expect(list.map((l) => l.code)).toEqual(['EEE555', 'DDD444']);
    expect(list[0]).toHaveProperty('ownerUsername', 'Alice');
    expect(list[0]).toHaveProperty('createdAt');
    expect(list[0]).toHaveProperty('joinedAt');
  });
});
