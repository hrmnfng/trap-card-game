import { describe, it, expect } from 'vitest';
import {
  createRoomState,
  addPlayer,
  setReady,
  isPlayerReady,
  getReadyPlayers,
  startPrep,
  submitCards,
  hasPlayerSubmitted,
  getSubmittedPlayers,
  startGame,
  playCard,
  getPlayerCards,
  getRemainingCardsCount,
  getLobbyMembers,
  isLobbyFull,
  hasGameStarted,
  hasGameEnded,
  getFinishedPlayers,
  getGameState,
  getGameHistory,
  type GameRoomState,
} from './gameRules.js';
import { createTestDeps } from './testUtils.js';
import { DEFAULT_GAME_SETTINGS } from './types.js';

function newRoom(overrides?: Partial<Parameters<typeof createRoomState>[0]>): GameRoomState {
  return createRoomState({
    lobbyId: 'lobby-1',
    lobbyCode: 'ABC1',
    now: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  });
}

/** Lobby with two ready players (p1 owner). */
function readyTwo(): GameRoomState {
  const deps = createTestDeps();
  let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
  ({ state } = addPlayer(state, 'p2', 'Bob', deps));
  ({ state } = setReady(state, 'p1', true, deps));
  ({ state } = setReady(state, 'p2', true, deps));
  return state;
}

/** Two players, in prep, both submitted three statements each. */
function submittedTwoInPrep(): GameRoomState {
  // startId offset so these event ids don't collide with readyTwo's (0-3).
  const deps = createTestDeps({ startId: 10 });
  let state = readyTwo();
  ({ state } = startPrep(state));
  ({ state } = submitCards(state, 'p1', ['a1', 'a2', 'a3'], deps));
  ({ state } = submitCards(state, 'p2', ['b1', 'b2', 'b3'], deps));
  return state;
}

describe('createRoomState', () => {
  it('starts empty, waiting, with no owner and value-free settings', () => {
    const room = newRoom();
    expect(room.status).toBe('waiting');
    expect(room.ownerId).toBeNull();
    expect(room.events).toHaveLength(0);
    expect(room.settings).toEqual(DEFAULT_GAME_SETTINGS);
    expect(room.settings).not.toHaveProperty('minCardValue');
  });
});

describe('membership', () => {
  it('mid-game join does NOT auto-deal (must submitCards first)', () => {
    const room = submittedTwoInPrep();
    const deps = createTestDeps({ startId: 100 });
    const started = startGame(room).state;
    const res = addPlayer(started, 'p3', 'Cara', deps);
    expect(res.ok).toBe(true);
    expect(getPlayerCards(res.state, 'p3')).toHaveLength(0); // must submit first
  });

  it('rejects a different player taking an existing username', () => {
    const deps = createTestDeps();
    const { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    const res = addPlayer(state, 'p2', 'alice', deps);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('username_taken');
  });

  it('rejects join when lobby is full', () => {
    const deps = createTestDeps();
    let state = newRoom({ settings: { ...DEFAULT_GAME_SETTINGS, maxPlayers: 2 } });
    ({ state } = addPlayer(state, 'p1', 'A', deps));
    ({ state } = addPlayer(state, 'p2', 'B', deps));
    expect(isLobbyFull(state)).toBe(true);
    expect(addPlayer(state, 'p3', 'C', deps).ok).toBe(false);
  });
});

describe('readiness', () => {
  it('defaults to not-ready and tracks the latest set_ready event', () => {
    const deps = createTestDeps();
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    expect(isPlayerReady(state, 'p1')).toBe(false);
    ({ state } = setReady(state, 'p1', true, deps));
    expect(isPlayerReady(state, 'p1')).toBe(true);
    ({ state } = setReady(state, 'p1', false, deps));
    expect(isPlayerReady(state, 'p1')).toBe(false);
  });

  it('getReadyPlayers returns only current ready members', () => {
    expect(getReadyPlayers(readyTwo()).sort()).toEqual(['p1', 'p2']);
  });

  it('rejects set_ready outside waiting', () => {
    const deps = createTestDeps();
    const state = startPrep(readyTwo()).state;
    const res = setReady(state, 'p1', false, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_waiting');
  });
});

describe('startPrep', () => {
  it('moves waiting -> prep when all ready and enough players', () => {
    const res = startPrep(readyTwo());
    expect(res.ok).toBe(true);
    expect(res.state.status).toBe('prep');
  });

  it('rejects when not all ready', () => {
    const deps = createTestDeps();
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    ({ state } = addPlayer(state, 'p2', 'Bob', deps));
    ({ state } = setReady(state, 'p1', true, deps));
    const res = startPrep(state);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_all_ready');
  });

  it('rejects with too few players', () => {
    const deps = createTestDeps();
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    ({ state } = setReady(state, 'p1', true, deps));
    const res = startPrep(state);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_enough_players');
  });

  it('rejects when not waiting', () => {
    const res = startPrep(startPrep(readyTwo()).state);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_waiting');
  });
});

describe('submitCards', () => {
  it('appends cardsPerPlayer distribute events carrying trimmed statements', () => {
    const deps = createTestDeps();
    const state = startPrep(readyTwo()).state;
    const res = submitCards(state, 'p1', ['  spills drink ', 'checks phone', 'yawns'], deps);
    expect(res.ok).toBe(true);
    const cards = getPlayerCards(res.state, 'p1');
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.statement)).toEqual(['spills drink', 'checks phone', 'yawns']);
    expect(hasPlayerSubmitted(res.state, 'p1')).toBe(true);
  });

  it('getSubmittedPlayers lists members who have submitted', () => {
    expect(getSubmittedPlayers(submittedTwoInPrep()).sort()).toEqual(['p1', 'p2']);
  });

  it('rejects a double submit', () => {
    const deps = createTestDeps();
    let state = startPrep(readyTwo()).state;
    ({ state } = submitCards(state, 'p1', ['a', 'b', 'c'], deps));
    const res = submitCards(state, 'p1', ['d', 'e', 'f'], deps);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('already_submitted');
  });

  it('rejects the wrong number of statements', () => {
    const deps = createTestDeps();
    const state = startPrep(readyTwo()).state;
    const res = submitCards(state, 'p1', ['a', 'b'], deps);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('wrong_card_count');
  });

  it('rejects an empty (after trim) or over-long statement', () => {
    const deps = createTestDeps();
    const state = startPrep(readyTwo()).state;
    expect(submitCards(state, 'p1', ['a', '   ', 'c'], deps).error).toBe('invalid_statement');
    expect(submitCards(state, 'p1', ['a', 'x'.repeat(101), 'c'], deps).error).toBe('invalid_statement');
  });

  it('rejects submission outside prep / in-progress', () => {
    const deps = createTestDeps();
    const waiting = readyTwo();
    expect(submitCards(waiting, 'p1', ['a', 'b', 'c'], deps).error).toBe('wrong_phase');
  });

  it('allows a mid-game joiner to submit while in-progress', () => {
    const deps = createTestDeps({ startId: 200 });
    let state = startGame(submittedTwoInPrep()).state;
    ({ state } = addPlayer(state, 'p3', 'Cara', deps));
    const res = submitCards(state, 'p3', ['x', 'y', 'z'], deps);
    expect(res.ok).toBe(true);
    expect(getPlayerCards(res.state, 'p3')).toHaveLength(3);
  });
});

describe('startGame (prep gate)', () => {
  it('moves prep -> in-progress when all submitted, dealing nothing new', () => {
    const state = submittedTwoInPrep();
    const before = state.events.length;
    const res = startGame(state);
    expect(res.ok).toBe(true);
    expect(res.state.status).toBe('in-progress');
    expect(res.state.events.length).toBe(before); // no deal events
  });

  it('rejects when not in prep', () => {
    expect(startGame(readyTwo()).error).toBe('not_in_prep');
  });

  it('rejects when a member has not submitted', () => {
    const deps = createTestDeps();
    let state = startPrep(readyTwo()).state;
    ({ state } = submitCards(state, 'p1', ['a', 'b', 'c'], deps));
    const res = startGame(state);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_all_submitted');
  });
});

describe('playCard + end condition (with statements)', () => {
  it('records the played statement and shrinks the hand; ends when a player empties', () => {
    const deps = createTestDeps({ startId: 300 });
    let state = startGame(submittedTwoInPrep()).state;
    expect(hasGameStarted(state)).toBe(true);

    for (const card of getPlayerCards(state, 'p1')) {
      ({ state } = playCard(state, 'p1', card.id, 'p2', deps));
    }
    expect(getRemainingCardsCount(state, 'p1')).toBe(0);
    expect(hasGameEnded(state)).toBe(true);
    expect(getFinishedPlayers(state)).toContain('p1');

    const history = getGameHistory(state);
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.statement)).toEqual(['a1', 'a2', 'a3']);
    expect(history[0]?.targetUsername).toBe('Bob');
  });

  it('rejects playing a card you do not own', () => {
    const state = startGame(submittedTwoInPrep()).state;
    const deps = createTestDeps();
    const res = playCard(state, 'p1', 'no-such-card', 'p2', deps);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_card_owner');
  });
});

describe('getGameState (per-viewer)', () => {
  it('exposes own statements, hides others, and surfaces flags + cardsPerPlayer', () => {
    const state = startGame(submittedTwoInPrep()).state;
    const view = getGameState(state, 'p1');
    expect(view.cardsPerPlayer).toBe(3);
    expect(view.myCards.map((c) => c.statement)).toEqual(['a1', 'a2', 'a3']);
    const p2 = view.players.find((p) => p.id === 'p2')!;
    expect(p2).toMatchObject({ cardsRemaining: 3, isReady: true, hasSubmitted: true });
    // Other players' statements never appear in myCards.
    expect(view.myCards.every((c) => c.ownerId === 'p1')).toBe(true);
  });

  it('reflects ready/submit flags during earlier stages', () => {
    const deps = createTestDeps();
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    ({ state } = addPlayer(state, 'p2', 'Bob', deps));
    ({ state } = setReady(state, 'p1', true, deps));
    const view = getGameState(state, 'p2');
    expect(view.players.find((p) => p.id === 'p1')?.isReady).toBe(true);
    expect(view.players.find((p) => p.id === 'p2')?.isReady).toBe(false);
    expect(view.players.every((p) => p.hasSubmitted === false)).toBe(true);
  });
});

describe('membership is permanent', () => {
  it('a player who disconnects and reconnects stays a member with their hand', () => {
    const deps = createTestDeps();
    let state = startGame(submittedTwoInPrep()).state;
    const handBefore = getPlayerCards(state, 'p1').map((c) => c.id);

    // Simulate a reconnect: addPlayer is called again for an existing member.
    const res = addPlayer(state, 'p1', 'Alice', deps);
    expect(res.ok).toBe(true);
    state = res.state;

    expect(getLobbyMembers(state).map((m) => m.playerId)).toEqual(['p1', 'p2']);
    expect(getPlayerCards(state, 'p1').map((c) => c.id)).toEqual(handBefore);
  });

  it('lets an existing member reconnect even when the lobby is at capacity', () => {
    const deps = createTestDeps();
    let state = newRoom({ settings: { ...DEFAULT_GAME_SETTINGS, maxPlayers: 2 } });
    ({ state } = addPlayer(state, 'p1', 'Alice', deps));
    ({ state } = addPlayer(state, 'p2', 'Bob', deps));
    expect(isLobbyFull(state)).toBe(true);
    const res = addPlayer(state, 'p1', 'Alice', deps); // reconnect at capacity
    expect(res.ok).toBe(true);
    expect(getLobbyMembers(res.state).map((m) => m.playerId)).toEqual(['p1', 'p2']);
  });
});
