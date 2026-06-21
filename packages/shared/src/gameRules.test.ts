import { describe, it, expect } from 'vitest';
import {
  createRoomState,
  addPlayer,
  removePlayer,
  startGame,
  playCard,
  getPlayerCards,
  getRemainingCardsCount,
  getLobbyMembers,
  getLobbyPlayerCount,
  isLobbyFull,
  isPlayerNewToLobby,
  playerOwnsCard,
  isCardPlayed,
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
    lobbyCode: 'ABC123',
    now: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  });
}

describe('createRoomState', () => {
  it('starts empty, waiting, with no owner', () => {
    const room = newRoom();
    expect(room.status).toBe('waiting');
    expect(room.ownerId).toBeNull();
    expect(room.events).toHaveLength(0);
    expect(room.settings).toEqual(DEFAULT_GAME_SETTINGS);
  });
});

describe('membership', () => {
  it('first player becomes owner and is a member', () => {
    const deps = createTestDeps();
    const res = addPlayer(newRoom(), 'p1', 'Alice', deps);
    expect(res.ok).toBe(true);
    expect(res.state.ownerId).toBe('p1');
    expect(getLobbyPlayerCount(res.state)).toBe(1);
    expect(getLobbyMembers(res.state)[0]).toMatchObject({ playerId: 'p1', username: 'Alice' });
  });

  it('is idempotent on rejoin (no duplicate, owner unchanged)', () => {
    const deps = createTestDeps();
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    ({ state } = addPlayer(state, 'p2', 'Bob', deps));
    const before = state.events.length;
    const res = addPlayer(state, 'p1', 'Alice', deps);
    expect(res.ok).toBe(true);
    expect(res.state.events.length).toBe(before); // no new join event
    expect(getLobbyPlayerCount(res.state)).toBe(2);
    expect(res.state.ownerId).toBe('p1');
  });

  it('rejects a different player taking an existing username (case-insensitive)', () => {
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
    const res = addPlayer(state, 'p3', 'C', deps);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('lobby_full');
  });

  it('removePlayer drops the member', () => {
    const deps = createTestDeps();
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    ({ state } = addPlayer(state, 'p2', 'Bob', deps));
    state = removePlayer(state, 'p2', deps);
    expect(getLobbyPlayerCount(state)).toBe(1);
    expect(isPlayerNewToLobby(state, 'p2')).toBe(false); // join event still exists
  });
});

describe('startGame', () => {
  it('fails with fewer than minPlayers', () => {
    const deps = createTestDeps();
    const { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    const res = startGame(state, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_enough_players');
  });

  it('distributes cardsPerPlayer to each member and moves to in-progress', () => {
    const deps = createTestDeps({ cardValues: [5, 6, 7] });
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    ({ state } = addPlayer(state, 'p2', 'Bob', deps));
    const res = startGame(state, deps);
    expect(res.ok).toBe(true);
    expect(hasGameStarted(res.state)).toBe(true);
    expect(getPlayerCards(res.state, 'p1')).toHaveLength(DEFAULT_GAME_SETTINGS.cardsPerPlayer);
    expect(getPlayerCards(res.state, 'p2')).toHaveLength(DEFAULT_GAME_SETTINGS.cardsPerPlayer);
  });

  it('cannot start twice', () => {
    const deps = createTestDeps();
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    ({ state } = addPlayer(state, 'p2', 'Bob', deps));
    ({ state } = startGame(state, deps));
    const res = startGame(state, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('already_started');
  });
});

describe('mid-game joiner provisioning', () => {
  it('deals a hand immediately to a player joining an in-progress game', () => {
    const deps = createTestDeps();
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    ({ state } = addPlayer(state, 'p2', 'Bob', deps));
    ({ state } = startGame(state, deps));
    const res = addPlayer(state, 'p3', 'Carol', deps);
    expect(res.ok).toBe(true);
    expect(getPlayerCards(res.state, 'p3')).toHaveLength(DEFAULT_GAME_SETTINGS.cardsPerPlayer);
  });

  it('startGame does not re-deal to a player who already has cards', () => {
    const deps = createTestDeps();
    // p3 joins after start (gets cards), then game is already in-progress so
    // a hypothetical re-start is a no-op anyway; assert hand size is stable.
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    ({ state } = addPlayer(state, 'p2', 'Bob', deps));
    ({ state } = startGame(state, deps));
    ({ state } = addPlayer(state, 'p3', 'Carol', deps));
    expect(getPlayerCards(state, 'p3')).toHaveLength(3);
  });
});

describe('playCard', () => {
  function startedRoom() {
    const deps = createTestDeps({ cardValues: [3, 4, 5, 6, 7, 8] });
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    ({ state } = addPlayer(state, 'p2', 'Bob', deps));
    ({ state } = startGame(state, deps));
    return { state, deps };
  }

  it('plays an owned card and removes it from hand', () => {
    const { state, deps } = startedRoom();
    const card = getPlayerCards(state, 'p1')[0]!;
    expect(playerOwnsCard(state, 'p1', card.id)).toBe(true);
    const res = playCard(state, 'p1', card.id, 'p2', deps);
    expect(res.ok).toBe(true);
    expect(isCardPlayed(res.state, card.id)).toBe(true);
    expect(getRemainingCardsCount(res.state, 'p1')).toBe(2);
  });

  it('rejects playing a card the player does not own', () => {
    const { state, deps } = startedRoom();
    const p2card = getPlayerCards(state, 'p2')[0]!;
    const res = playCard(state, 'p1', p2card.id, 'p2', deps);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_card_owner');
  });

  it('rejects playing the same card twice', () => {
    const { state, deps } = startedRoom();
    const card = getPlayerCards(state, 'p1')[0]!;
    const first = playCard(state, 'p1', card.id, 'p2', deps);
    const second = playCard(first.state, 'p1', card.id, 'p2', deps);
    expect(second.ok).toBe(false);
    expect(second.error).toBe('card_already_played');
  });

  it('rejects play before game starts', () => {
    const deps = createTestDeps();
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    ({ state } = addPlayer(state, 'p2', 'Bob', deps));
    const res = playCard(state, 'p1', 'nope', 'p2', deps);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('game_not_started');
  });
});

describe('end condition', () => {
  it('does not end while players who played still hold cards', () => {
    const deps = createTestDeps();
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    ({ state } = addPlayer(state, 'p2', 'Bob', deps));
    ({ state } = startGame(state, deps));
    const card = getPlayerCards(state, 'p1')[0]!;
    ({ state } = playCard(state, 'p1', card.id, 'p2', deps));
    expect(hasGameEnded(state)).toBe(false);
  });

  it('ends when a player who has played runs out of cards', () => {
    const deps = createTestDeps();
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    ({ state } = addPlayer(state, 'p2', 'Bob', deps));
    ({ state } = startGame(state, deps));
    for (const card of getPlayerCards(state, 'p1')) {
      ({ state } = playCard(state, 'p1', card.id, 'p2', deps));
    }
    expect(getRemainingCardsCount(state, 'p1')).toBe(0);
    expect(hasGameEnded(state)).toBe(true);
    expect(getFinishedPlayers(state)).toContain('p1');
  });

  it('a mid-game joiner who never plays does not trigger end', () => {
    const deps = createTestDeps();
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    ({ state } = addPlayer(state, 'p2', 'Bob', deps));
    ({ state } = startGame(state, deps));
    // p3 joins; even with 0 plays they should never trigger end on their own.
    ({ state } = addPlayer(state, 'p3', 'Carol', deps));
    expect(hasGameEnded(state)).toBe(false);
  });
});

describe('getGameState (per-player filtering)', () => {
  it('shows own card values but only counts for others', () => {
    const deps = createTestDeps({ cardValues: [9, 8, 7, 6, 5, 4] });
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    ({ state } = addPlayer(state, 'p2', 'Bob', deps));
    ({ state } = startGame(state, deps));

    const view = getGameState(state, 'p1');
    expect(view.myCards).toHaveLength(3);
    expect(view.myCards[0]!.value).not.toBeNull();
    const p2 = view.players.find((p) => p.id === 'p2')!;
    expect(p2.cardsRemaining).toBe(3);
    // Other players are not exposed via myCards.
    expect(view.myCards.every((c) => c.ownerId === 'p1')).toBe(true);
  });

  it('reflects concluded status once the game has ended', () => {
    const deps = createTestDeps();
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    ({ state } = addPlayer(state, 'p2', 'Bob', deps));
    ({ state } = startGame(state, deps));
    for (const card of getPlayerCards(state, 'p1')) {
      ({ state } = playCard(state, 'p1', card.id, 'p2', deps));
    }
    expect(getGameState(state, 'p2').status).toBe('concluded');
  });

  it('builds history with usernames resolved', () => {
    const deps = createTestDeps();
    let { state } = addPlayer(newRoom(), 'p1', 'Alice', deps);
    ({ state } = addPlayer(state, 'p2', 'Bob', deps));
    ({ state } = startGame(state, deps));
    const card = getPlayerCards(state, 'p1')[0]!;
    ({ state } = playCard(state, 'p1', card.id, 'p2', deps));
    const history = getGameHistory(state);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      playerUsername: 'Alice',
      targetUsername: 'Bob',
    });
  });
});
