import { describe, it, expect, vi } from 'vitest';
import { createGameStore } from './game';
import { LobbyConnection, type RealtimeSocket } from '../lib/realtime';
import type { GameState } from '@trap/shared';

function makeFakeSocket() {
  const listeners: Record<string, Array<(ev?: unknown) => void>> = {
    open: [],
    close: [],
    error: [],
    message: [],
  };
  const sent: string[] = [];
  const close = vi.fn();
  const socket = {
    send: (data: string) => sent.push(data),
    close,
    addEventListener(type: string, handler: (ev?: unknown) => void) {
      (listeners[type] ??= []).push(handler);
    },
  } as unknown as RealtimeSocket;

  return {
    socket,
    sent,
    close,
    emitOpen: () => listeners['open']!.forEach((h) => h()),
    emitMessage: (msg: unknown) =>
      listeners['message']!.forEach((h) => h({ data: JSON.stringify(msg) })),
  };
}

function setup() {
  const fake = makeFakeSocket();
  const store = createGameStore({
    connectionFactory: (options) =>
      new LobbyConnection({ ...options, socketFactory: () => fake.socket }),
  });
  return { fake, store };
}

const sampleState: GameState = {
  lobbyId: 'ROOM1',
  lobbyCode: 'ROOM1',
  status: 'in-progress',
  ownerId: 'p1',
  cardsPerPlayer: 3,
  players: [{ id: 'p1', username: 'Alice', cardsRemaining: 3, isReady: true, hasSubmitted: true, isOnline: true }],
  myCards: [{ id: 'c1', statement: null, status: 'hidden', ownerId: 'p1' }],
  gameHistory: [],
  winnerId: null,
  winnerUsername: null,
};

describe('game store', () => {
  it('connect sets lobby/player and tracks status', () => {
    const { store, fake } = setup();
    store.getState().connect({ code: 'ROOM1', playerId: 'p1', username: 'Alice' });

    expect(store.getState().lobbyCode).toBe('ROOM1');
    expect(store.getState().playerId).toBe('p1');
    expect(store.getState().connectionStatus).toBe('connecting');

    fake.emitOpen();
    expect(store.getState().connectionStatus).toBe('open');
  });

  it('applies state_update into gameState', () => {
    const { store, fake } = setup();
    store.getState().connect({ code: 'ROOM1', playerId: 'p1', username: 'Alice' });

    fake.emitMessage({ type: 'state_update', state: sampleState });
    expect(store.getState().gameState).toEqual(sampleState);
  });

  it('updates player/lobby from connected', () => {
    const { store, fake } = setup();
    store.getState().connect({ code: 'ROOM1', playerId: 'p1', username: 'Alice' });

    fake.emitMessage({ type: 'connected', playerId: 'p1', lobbyCode: 'ROOM1' });
    expect(store.getState().playerId).toBe('p1');
    expect(store.getState().lobbyCode).toBe('ROOM1');
  });

  it('records the last card_played event', () => {
    const { store, fake } = setup();
    store.getState().connect({ code: 'ROOM1', playerId: 'p1', username: 'Alice' });

    const event = {
      type: 'card_played' as const,
      playerId: 'p2',
      playerUsername: 'Bob',
      targetPlayerId: 'p1',
      targetUsername: 'Alice',
      statement: 'spills drink',
    };
    fake.emitMessage(event);
    expect(store.getState().lastCardPlayed).toEqual(event);
  });

  it('captures game_ended and error messages', () => {
    const { store, fake } = setup();
    store.getState().connect({ code: 'ROOM1', playerId: 'p1', username: 'Alice' });

    fake.emitMessage({ type: 'game_ended', finishedPlayerIds: ['p1'], winnerId: 'p1', winnerUsername: 'Alice' });
    expect(store.getState().gameEnded).toEqual({ finishedPlayerIds: ['p1'], winnerId: 'p1', winnerUsername: 'Alice' });

    fake.emitMessage({ type: 'error', message: 'not_owner', code: 'not_owner' });
    expect(store.getState().error).toBe('not_owner');
  });

  it('startGame and playCard send client messages', () => {
    const { store, fake } = setup();
    store.getState().connect({ code: 'ROOM1', playerId: 'p1', username: 'Alice' });

    store.getState().startGame();
    store.getState().playCard('c1', 'p2');

    expect(fake.sent.map((s) => JSON.parse(s))).toEqual([
      { type: 'start_game' },
      { type: 'play_card', cardId: 'c1', targetPlayerId: 'p2' },
    ]);
  });

  it('exit closes the connection and resets state', () => {
    const { store, fake } = setup();
    store.getState().connect({ code: 'ROOM1', playerId: 'p1', username: 'Alice' });
    fake.emitMessage({ type: 'state_update', state: sampleState });

    store.getState().exit();

    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(store.getState().connectionStatus).toBe('idle');
    expect(store.getState().lobbyCode).toBeNull();
    expect(store.getState().gameState).toBeNull();
  });

  it('exposes exit() that disconnects and resets local state', () => {
    const { store } = setup();
    store.getState().connect({ code: 'ABC1', playerId: 'p1', username: 'A' });
    store.getState().exit();
    expect(store.getState().lobbyCode).toBeNull();
    expect(store.getState().connectionStatus).toBe('idle');
  });

  it('stores the winner from game_ended', () => {
    const { store, fake } = setup();
    store.getState().connect({ code: 'ABC1', playerId: 'p1', username: 'A' });
    fake.emitMessage({ type: 'game_ended', finishedPlayerIds: ['p1'], winnerId: 'p1', winnerUsername: 'A' });
    expect(store.getState().gameEnded).toEqual({
      finishedPlayerIds: ['p1'],
      winnerId: 'p1',
      winnerUsername: 'A',
    });
  });

  // I6: a transient error (e.g. a rejected action) must not stick around once
  // the next valid state arrives, or the user sees a stale error forever.
  it('clears a stale error once a valid state_update arrives', () => {
    const { store, fake } = setup();
    store.getState().connect({ code: 'ROOM1', playerId: 'p1', username: 'Alice' });

    fake.emitMessage({ type: 'error', message: 'not_all_ready', code: 'not_all_ready' });
    expect(store.getState().error).toBe('not_all_ready');

    fake.emitMessage({ type: 'state_update', state: sampleState });
    expect(store.getState().error).toBeNull();
  });
});
