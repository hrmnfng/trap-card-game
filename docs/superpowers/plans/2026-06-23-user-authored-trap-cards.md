# User-Authored Trap Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace random numeric card values with player-authored condition statements, behind an explicit three-stage lifecycle (lobby ready-up → prep submit-cards → game activate).

**Architecture:** Event-sourced rules in `@trap/shared` stay the single source of truth. A new `prep` lobby status sits between `waiting` and `in-progress`. Two owner-gated transitions (`start_prep`, `start_game`) replace the single start. Cards carry a `statement: string` instead of `value: number`; statements are hidden from other players until activated, exactly as values were. All three workspaces ship together (the WS contract and persisted event shape change; live lobbies are ephemeral DOs so there is no migration).

**Tech Stack:** TypeScript, `@trap/shared` (pure rules), Cloudflare Workers + PartyServer Durable Object (`apps/party`), Expo / React Native + Zustand + expo-router (`apps/mobile`), Vitest, Playwright, Maestro.

**Green-checkpoint policy:** This is a coordinated contract change, so cross-workspace consumers stay red until their own task lands. Each task ends **green for its own workspace** (typecheck + that workspace's tests). Do not try to keep `apps/party` / `apps/mobile` compiling while only `@trap/shared` has been updated — that is expected and resolved by Tasks 3–8.

**Spec:** `docs/superpowers/specs/2026-06-22-user-authored-trap-cards-design.md`

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `packages/shared/src/types.ts` | modify | Data model: statuses, card statement, settings, player flags, `MAX_STATEMENT_LENGTH` |
| `packages/shared/src/gameRules.ts` | modify | Rules: readiness, prep, submit, reworked start, statement-carrying play |
| `packages/shared/src/testUtils.ts` | modify | Drop `randomCardValue` from `createTestDeps` |
| `packages/shared/src/gameRules.test.ts` | rewrite | Unit cover the new engine |
| `packages/shared/src/messages.ts` | modify | WS contract: `set_ready`/`start_prep`/`submit_cards`/`prep_started`; `card_played` statement |
| `packages/shared/src/messages.test.ts` | modify | Parse coverage for new client messages |
| `apps/party/src/LobbyDO.ts` | modify | Route new messages; drop random dep; statement in play/push |
| `apps/party/test/lobby.integration.test.ts` | modify | Update (skipped) realtime flow to three stages |
| `apps/party/test/history.test.ts` | modify | Drop `randomCardValue` from local deps |
| `apps/party/test/history.integration.test.ts` | modify | Drop `randomCardValue` from local deps |
| `apps/mobile/src/lib/realtime.ts` | modify | Client sends `setReady`/`startPrep`/`submitCards` |
| `apps/mobile/src/lib/realtime.test.ts` | modify | Cover new sends |
| `apps/mobile/src/lib/navigation.ts` | create | `screenForState` status→screen mapping |
| `apps/mobile/src/lib/navigation.test.ts` | create | Unit cover mapping |
| `apps/mobile/src/state/game.ts` | modify | Store actions `setReady`/`startPrep`/`submitCards` |
| `apps/mobile/src/state/game.test.ts` | modify | `card_played` statement; new actions |
| `apps/mobile/app/lobby/[code].tsx` | modify | Ready toggle, cards-per-player, Start→`start_prep`, redirect |
| `apps/mobile/app/prep/[code].tsx` | create | Authoring screen: inputs, submit/lock, roster, Begin game |
| `apps/mobile/app/game/[code].tsx` | modify | Render statements; redirect via `screenForState` |
| `apps/mobile/src/ui/PlayingCard.tsx` | modify | Render `statement` text instead of a number |
| `apps/mobile/app/_layout.tsx` | modify | Register `prep/[code]` route |
| `apps/mobile/e2e/multiplayer.spec.ts` | modify | Drive the three-stage flow |
| `apps/mobile/maestro/player2.mjs` | modify | Helper readies, starts prep, submits, begins game |
| `apps/mobile/.maestro/game.yaml` | modify | Device flow authors + submits a card |
| `apps/mobile/e2e/README.md` | modify | Document the new flow |

---

## Task 1: Shared data model (types)

**Files:**
- Modify: `packages/shared/src/types.ts`

This task is type-only; downstream `gameRules.ts` will not compile until Task 2. That is expected — do not run the shared typecheck at the end of this task, only at the end of Task 2. Commit anyway (the file is internally consistent).

- [ ] **Step 1: Update the lifecycle, action, settings, event, card, player, history, and state types**

Replace the corresponding declarations in `packages/shared/src/types.ts` with:

```ts
/** Canonical lobby / game lifecycle status. */
export type LobbyStatus = 'waiting' | 'prep' | 'in-progress' | 'concluded';

/** Card visibility status from a viewer's perspective. */
export type CardStatus = 'hidden' | 'revealed';

/** Game action kinds recorded in the event log. */
export type GameActionType =
  | 'join'
  | 'leave'
  | 'set_ready'
  | 'distribute'
  | 'play_card';

/** Maximum length of an authored trap statement (characters, after trim). */
export const MAX_STATEMENT_LENGTH = 100;

/** Default game configuration. */
export interface GameSettings {
  minPlayers: number;
  maxPlayers: number;
  cardsPerPlayer: number;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  minPlayers: 2,
  maxPlayers: 10,
  cardsPerPlayer: 3,
};
```

Then update `GameEvent` (replace the `cardValue?` line, add `statement?`/`ready?`):

```ts
export interface GameEvent {
  /** Unique event id. */
  id: string;
  /** The action type. */
  type: GameActionType;
  /** The player who performed the action. */
  playerId: string;
  /** Authored statement (for `distribute` / `play_card`). */
  statement?: string;
  /** Ready flag (for `set_ready`). */
  ready?: boolean;
  /** Card id (for `distribute` / `play_card`). */
  cardId?: string;
  /** Target player (for `play_card`). */
  targetId?: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
}
```

Then `Card`, `PlayerView`, `GameHistoryItem`, `GameState`:

```ts
/** A card as seen in a player's own hand. */
export interface Card {
  id: string;
  /** Authored statement; null when hidden from this viewer. */
  statement: string | null;
  status: CardStatus;
  ownerId: string;
}

/** Public, per-player info (other players' statements are hidden). */
export interface PlayerView {
  id: string;
  username: string;
  cardsRemaining: number;
  isReady: boolean;
  hasSubmitted: boolean;
}

/** A play action surfaced in the game history feed. */
export interface GameHistoryItem {
  id: string;
  actionType: GameActionType;
  playerId: string;
  playerUsername: string;
  targetId: string | null;
  targetUsername: string | null;
  /** The activated trap statement (revealed to everyone on play). */
  statement: string | null;
  timestamp: string;
}

/**
 * The full game state, filtered for a specific viewing player.
 * `myCards` shows real statements; other players only expose counts/flags.
 */
export interface GameState {
  lobbyId: string;
  lobbyCode: string;
  status: LobbyStatus;
  ownerId: string | null;
  /** Fixed cards-per-player for this game (drives the prep UI). */
  cardsPerPlayer: number;
  players: PlayerView[];
  myCards: Card[];
  gameHistory: GameHistoryItem[];
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): card statements + prep stage in the data model"
```

---

## Task 2: Shared rules engine

**Files:**
- Modify: `packages/shared/src/gameRules.ts`
- Modify: `packages/shared/src/testUtils.ts`
- Rewrite: `packages/shared/src/gameRules.test.ts`

- [ ] **Step 1: Drop `randomCardValue` from test deps**

Replace `packages/shared/src/testUtils.ts` with:

```ts
import type { RuleDeps } from './gameRules.js';

/**
 * Deterministic RuleDeps for tests: sequential ids and a monotonic clock.
 * Keeps rule tests reproducible.
 */
export function createTestDeps(options?: {
  startId?: number;
  startTimeMs?: number;
}): RuleDeps {
  let idCounter = options?.startId ?? 0;
  let timeMs = options?.startTimeMs ?? Date.parse('2026-01-01T00:00:00.000Z');

  return {
    newId: () => `id-${idCounter++}`,
    now: () => {
      const iso = new Date(timeMs).toISOString();
      timeMs += 1000;
      return iso;
    },
  };
}
```

- [ ] **Step 2: Write the failing rules tests**

Replace `packages/shared/src/gameRules.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import {
  createRoomState,
  addPlayer,
  removePlayer,
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
  getLobbyPlayerCount,
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
  const deps = createTestDeps();
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
  it('first player becomes owner; mid-game join does NOT auto-deal', () => {
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

describe('removePlayer', () => {
  it('drops the member from the roster', () => {
    const deps = createTestDeps();
    let state = readyTwo();
    state = removePlayer(state, 'p2', deps);
    expect(getLobbyPlayerCount(state)).toBe(1);
    expect(getLobbyMembers(state)[0]?.playerId).toBe('p1');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test:shared`
Expected: FAIL — `setReady`, `startPrep`, `submitCards`, etc. are not exported yet.

- [ ] **Step 4: Rewrite the rules implementation**

Replace `packages/shared/src/gameRules.ts` with:

```ts
/**
 * Pure, framework-agnostic game rules for the Trap Card Game.
 *
 * Event-sourced: the authoritative data is `GameRoomState.events`; derived views
 * (hands, counts, history, readiness, submissions) are computed by replaying
 * events. Pure functions only — no I/O, no globals — so the rules are trivially
 * unit-testable and reusable on both the client and the Durable Object.
 * Determinism: ids/time are injected via `RuleDeps`.
 */

import {
  DEFAULT_GAME_SETTINGS,
  MAX_STATEMENT_LENGTH,
  type Card,
  type GameEvent,
  type GameHistoryItem,
  type GameSettings,
  type GameState,
  type LobbyMember,
  type LobbyStatus,
  type PlayerView,
} from './types.js';

/* -------------------------------------------------------------------------- */
/* State shape                                                                */
/* -------------------------------------------------------------------------- */

export interface GameRoomState {
  lobbyId: string;
  lobbyCode: string;
  status: LobbyStatus;
  ownerId: string | null;
  createdAt: string;
  expiresAt: string;
  settings: GameSettings;
  /** Ordered append-only event log. */
  events: GameEvent[];
  /** Username lookup for all players that have ever been in the lobby. */
  usernames: Record<string, string>;
}

/** Injected dependencies for deterministic, side-effect-free rule evaluation. */
export interface RuleDeps {
  /** Returns a unique id (e.g. crypto.randomUUID). */
  newId: () => string;
  /** Returns an ISO-8601 timestamp. */
  now: () => string;
}

/** Result wrapper for rule operations that can fail validation. */
export interface RuleResult {
  ok: boolean;
  state: GameRoomState;
  error?: string;
}

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

export function createRoomState(params: {
  lobbyId: string;
  lobbyCode: string;
  now: string;
  expiresAt: string;
  settings?: GameSettings;
}): GameRoomState {
  return {
    lobbyId: params.lobbyId,
    lobbyCode: params.lobbyCode,
    status: 'waiting',
    ownerId: null,
    createdAt: params.now,
    expiresAt: params.expiresAt,
    settings: params.settings ?? DEFAULT_GAME_SETTINGS,
    events: [],
    usernames: {},
  };
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* -------------------------------------------------------------------------- */

function appendEvent(state: GameRoomState, event: GameEvent): GameRoomState {
  return { ...state, events: [...state.events, event] };
}

function playedCardIds(state: GameRoomState): Set<string> {
  const played = new Set<string>();
  for (const ev of state.events) {
    if (ev.type === 'play_card' && ev.cardId) played.add(ev.cardId);
  }
  return played;
}

export function playerOwnsCard(
  state: GameRoomState,
  playerId: string,
  cardId: string
): boolean {
  return state.events.some(
    (ev) =>
      ev.type === 'distribute' &&
      ev.playerId === playerId &&
      ev.cardId === cardId
  );
}

export function isCardPlayed(state: GameRoomState, cardId: string): boolean {
  return state.events.some(
    (ev) => ev.type === 'play_card' && ev.cardId === cardId
  );
}

/* -------------------------------------------------------------------------- */
/* Membership                                                                 */
/* -------------------------------------------------------------------------- */

export function isPlayerNewToLobby(
  state: GameRoomState,
  playerId: string
): boolean {
  return !state.events.some(
    (ev) => ev.type === 'join' && ev.playerId === playerId
  );
}

export function getLobbyMembers(state: GameRoomState): LobbyMember[] {
  const order: string[] = [];
  const present = new Map<string, string>();
  for (const ev of state.events) {
    if (ev.type === 'join') {
      if (!present.has(ev.playerId)) order.push(ev.playerId);
      present.set(ev.playerId, ev.timestamp);
    } else if (ev.type === 'leave') {
      present.delete(ev.playerId);
    }
  }
  return order
    .filter((id) => present.has(id))
    .map((id) => ({
      playerId: id,
      username: state.usernames[id] ?? 'Unknown',
      joinedAt: present.get(id)!,
    }));
}

export function getLobbyPlayerCount(state: GameRoomState): number {
  return getLobbyMembers(state).length;
}

export function isLobbyFull(state: GameRoomState): boolean {
  return getLobbyPlayerCount(state) >= state.settings.maxPlayers;
}

export function hasGameStarted(state: GameRoomState): boolean {
  return state.status === 'in-progress' || state.status === 'concluded';
}

/**
 * Add a player to the lobby (idempotent join). The first joiner becomes owner.
 * There is no auto-deal: a mid-game joiner authors and submits their hand via
 * `submitCards` before they can activate anything.
 */
export function addPlayer(
  state: GameRoomState,
  playerId: string,
  username: string,
  deps: RuleDeps
): RuleResult {
  if (isLobbyFull(state)) {
    return { ok: false, state, error: 'lobby_full' };
  }

  if (!isPlayerNewToLobby(state, playerId)) {
    return {
      ok: true,
      state: { ...state, usernames: { ...state.usernames, [playerId]: username } },
    };
  }

  const members = getLobbyMembers(state);
  const clash = members.some(
    (m) => m.playerId !== playerId && m.username.toLowerCase() === username.toLowerCase()
  );
  if (clash) {
    return { ok: false, state, error: 'username_taken' };
  }

  let next: GameRoomState = {
    ...state,
    usernames: { ...state.usernames, [playerId]: username },
  };
  if (!next.ownerId) {
    next = { ...next, ownerId: playerId };
  }
  next = appendEvent(next, {
    id: deps.newId(),
    type: 'join',
    playerId,
    timestamp: deps.now(),
  });
  return { ok: true, state: next };
}

export function removePlayer(
  state: GameRoomState,
  playerId: string,
  deps: RuleDeps
): GameRoomState {
  return appendEvent(state, {
    id: deps.newId(),
    type: 'leave',
    playerId,
    timestamp: deps.now(),
  });
}

/* -------------------------------------------------------------------------- */
/* Readiness (stage 1)                                                        */
/* -------------------------------------------------------------------------- */

/** Set a player's ready flag. Allowed only while waiting. */
export function setReady(
  state: GameRoomState,
  playerId: string,
  ready: boolean,
  deps: RuleDeps
): RuleResult {
  if (state.status !== 'waiting') {
    return { ok: false, state, error: 'not_waiting' };
  }
  const next = appendEvent(state, {
    id: deps.newId(),
    type: 'set_ready',
    playerId,
    ready,
    timestamp: deps.now(),
  });
  return { ok: true, state: next };
}

/** A player's readiness, from their latest `set_ready` event (default false). */
export function isPlayerReady(state: GameRoomState, playerId: string): boolean {
  let ready = false;
  for (const ev of state.events) {
    if (ev.type === 'set_ready' && ev.playerId === playerId) {
      ready = ev.ready ?? false;
    }
  }
  return ready;
}

export function getReadyPlayers(state: GameRoomState): string[] {
  return getLobbyMembers(state)
    .map((m) => m.playerId)
    .filter((id) => isPlayerReady(state, id));
}

/* -------------------------------------------------------------------------- */
/* Stage 1 -> 2: start prep                                                   */
/* -------------------------------------------------------------------------- */

/** Move waiting -> prep. Gated on all present ready and >= minPlayers. */
export function startPrep(state: GameRoomState): RuleResult {
  if (state.status !== 'waiting') {
    return { ok: false, state, error: 'not_waiting' };
  }
  const members = getLobbyMembers(state);
  if (members.length < state.settings.minPlayers) {
    return { ok: false, state, error: 'not_enough_players' };
  }
  if (!members.every((m) => isPlayerReady(state, m.playerId))) {
    return { ok: false, state, error: 'not_all_ready' };
  }
  return { ok: true, state: { ...state, status: 'prep' } };
}

/* -------------------------------------------------------------------------- */
/* Authoring (stage 2)                                                        */
/* -------------------------------------------------------------------------- */

export function hasPlayerSubmitted(state: GameRoomState, playerId: string): boolean {
  return state.events.some(
    (ev) => ev.type === 'distribute' && ev.playerId === playerId
  );
}

export function getSubmittedPlayers(state: GameRoomState): string[] {
  return getLobbyMembers(state)
    .map((m) => m.playerId)
    .filter((id) => hasPlayerSubmitted(state, id));
}

/**
 * Submit a full, locked hand of authored statements. Allowed in `prep` (the
 * normal path) or `in-progress` (a mid-game joiner who has not yet submitted).
 * Appends one `distribute` event per trimmed statement.
 */
export function submitCards(
  state: GameRoomState,
  playerId: string,
  statements: string[],
  deps: RuleDeps
): RuleResult {
  if (state.status !== 'prep' && state.status !== 'in-progress') {
    return { ok: false, state, error: 'wrong_phase' };
  }
  if (hasPlayerSubmitted(state, playerId)) {
    return { ok: false, state, error: 'already_submitted' };
  }
  if (statements.length !== state.settings.cardsPerPlayer) {
    return { ok: false, state, error: 'wrong_card_count' };
  }
  const trimmed = statements.map((s) => s.trim());
  if (trimmed.some((s) => s.length === 0 || s.length > MAX_STATEMENT_LENGTH)) {
    return { ok: false, state, error: 'invalid_statement' };
  }
  let next = state;
  for (const statement of trimmed) {
    next = appendEvent(next, {
      id: deps.newId(),
      type: 'distribute',
      playerId,
      statement,
      cardId: deps.newId(),
      timestamp: deps.now(),
    });
  }
  return { ok: true, state: next };
}

/* -------------------------------------------------------------------------- */
/* Stage 2 -> 3: start game                                                   */
/* -------------------------------------------------------------------------- */

/** Move prep -> in-progress. Gated on all present members having submitted. */
export function startGame(state: GameRoomState): RuleResult {
  if (state.status !== 'prep') {
    return { ok: false, state, error: 'not_in_prep' };
  }
  const members = getLobbyMembers(state);
  if (!members.every((m) => hasPlayerSubmitted(state, m.playerId))) {
    return { ok: false, state, error: 'not_all_submitted' };
  }
  return { ok: true, state: { ...state, status: 'in-progress' } };
}

/* -------------------------------------------------------------------------- */
/* Hand / counts derivation                                                   */
/* -------------------------------------------------------------------------- */

export function getPlayerCards(state: GameRoomState, playerId: string): Card[] {
  const played = playedCardIds(state);
  const cards: Card[] = [];
  for (const ev of state.events) {
    if (ev.type !== 'distribute' || ev.playerId !== playerId || !ev.cardId) {
      continue;
    }
    if (!played.has(ev.cardId)) {
      cards.push({
        id: ev.cardId,
        statement: ev.statement ?? null,
        status: 'hidden',
        ownerId: playerId,
      });
    }
  }
  return cards;
}

export function getRemainingCardsCount(
  state: GameRoomState,
  playerId: string
): number {
  return getPlayerCards(state, playerId).length;
}

/* -------------------------------------------------------------------------- */
/* Playing a card                                                             */
/* -------------------------------------------------------------------------- */

export function playCard(
  state: GameRoomState,
  playerId: string,
  cardId: string,
  targetPlayerId: string,
  deps: RuleDeps
): RuleResult {
  if (!hasGameStarted(state)) {
    return { ok: false, state, error: 'game_not_started' };
  }
  if (!playerOwnsCard(state, playerId, cardId)) {
    return { ok: false, state, error: 'not_card_owner' };
  }
  if (isCardPlayed(state, cardId)) {
    return { ok: false, state, error: 'card_already_played' };
  }

  const distributeEv = state.events.find(
    (ev) =>
      ev.type === 'distribute' &&
      ev.playerId === playerId &&
      ev.cardId === cardId
  );
  if (!distributeEv) {
    return { ok: false, state, error: 'card_not_found' };
  }

  const next = appendEvent(state, {
    id: deps.newId(),
    type: 'play_card',
    playerId,
    statement: distributeEv.statement,
    cardId,
    targetId: targetPlayerId,
    timestamp: deps.now(),
  });
  return { ok: true, state: next };
}

/* -------------------------------------------------------------------------- */
/* End condition                                                              */
/* -------------------------------------------------------------------------- */

function playersWhoHavePlayed(state: GameRoomState): Set<string> {
  const set = new Set<string>();
  for (const ev of state.events) {
    if (ev.type === 'play_card') set.add(ev.playerId);
  }
  return set;
}

export function getFinishedPlayers(state: GameRoomState): string[] {
  if (!hasGameStarted(state)) return [];
  const played = playersWhoHavePlayed(state);
  if (played.size === 0) return [];
  const finished: string[] = [];
  for (const playerId of played) {
    if (getRemainingCardsCount(state, playerId) === 0) {
      finished.push(playerId);
    }
  }
  return finished;
}

export function hasGameEnded(state: GameRoomState): boolean {
  return getFinishedPlayers(state).length > 0;
}

/* -------------------------------------------------------------------------- */
/* Full per-player state view                                                 */
/* -------------------------------------------------------------------------- */

export function getGameHistory(state: GameRoomState): GameHistoryItem[] {
  return state.events
    .filter((ev) => ev.type === 'play_card')
    .map((ev) => ({
      id: ev.id,
      actionType: ev.type,
      playerId: ev.playerId,
      playerUsername: state.usernames[ev.playerId] ?? 'Unknown',
      targetId: ev.targetId ?? null,
      targetUsername: ev.targetId ? state.usernames[ev.targetId] ?? null : null,
      statement: ev.statement ?? null,
      timestamp: ev.timestamp,
    }));
}

export function getGameState(state: GameRoomState, viewerId: string): GameState {
  const members = getLobbyMembers(state);
  const players: PlayerView[] = members.map((m) => ({
    id: m.playerId,
    username: m.username,
    cardsRemaining: getRemainingCardsCount(state, m.playerId),
    isReady: isPlayerReady(state, m.playerId),
    hasSubmitted: hasPlayerSubmitted(state, m.playerId),
  }));

  let status: LobbyStatus = state.status;
  if (hasGameEnded(state)) status = 'concluded';

  return {
    lobbyId: state.lobbyId,
    lobbyCode: state.lobbyCode,
    status,
    ownerId: state.ownerId,
    cardsPerPlayer: state.settings.cardsPerPlayer,
    players,
    myCards: getPlayerCards(state, viewerId),
    gameHistory: getGameHistory(state),
  };
}
```

- [ ] **Step 5: Run the tests + typecheck to verify green**

Run: `npm run test:shared`
Expected: PASS (all describe blocks).
Run: `npm run typecheck`
Expected: PASS — the shared package compiles. (`messages.ts` still has the old `card_played` shape; that is fine — it does not reference the changed types and is reworked in Task 3.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/gameRules.ts packages/shared/src/gameRules.test.ts packages/shared/src/testUtils.ts
git commit -m "feat(shared): rules for ready/prep/submit + statement cards"
```

---

## Task 3: Shared WebSocket contract

**Files:**
- Modify: `packages/shared/src/messages.ts`
- Modify: `packages/shared/src/messages.test.ts`

- [ ] **Step 1: Write the failing parse tests**

Append these blocks to `packages/shared/src/messages.test.ts` (keep existing tests):

```ts
describe('parseClientMessage — three-stage messages', () => {
  it('parses set_ready with a boolean', () => {
    expect(parseClientMessage({ type: 'set_ready', ready: true })).toEqual({
      type: 'set_ready',
      ready: true,
    });
    expect(parseClientMessage({ type: 'set_ready', ready: 'yes' })).toBeNull();
  });

  it('parses start_prep', () => {
    expect(parseClientMessage({ type: 'start_prep' })).toEqual({ type: 'start_prep' });
  });

  it('parses submit_cards with a string array', () => {
    expect(
      parseClientMessage({ type: 'submit_cards', statements: ['a', 'b'] })
    ).toEqual({ type: 'submit_cards', statements: ['a', 'b'] });
    expect(parseClientMessage({ type: 'submit_cards', statements: 'a' })).toBeNull();
    expect(parseClientMessage({ type: 'submit_cards', statements: [1, 2] })).toBeNull();
  });
});
```

(If `messages.test.ts` does not already import `parseClientMessage`, add it to the existing import.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:shared`
Expected: FAIL — new message types not handled.

- [ ] **Step 3: Update the contract**

In `packages/shared/src/messages.ts`:

Replace the `ClientMessageType` line and add the new client interfaces:

```ts
export type ClientMessageType =
  | 'get_state'
  | 'set_ready'
  | 'start_prep'
  | 'submit_cards'
  | 'start_game'
  | 'play_card'
  | 'ping';

export interface SetReadyMessage {
  type: 'set_ready';
  ready: boolean;
}

export interface StartPrepMessage {
  type: 'start_prep';
}

export interface SubmitCardsMessage {
  type: 'submit_cards';
  statements: string[];
}
```

Extend the `ClientMessage` union:

```ts
export type ClientMessage =
  | GetStateMessage
  | SetReadyMessage
  | StartPrepMessage
  | SubmitCardsMessage
  | StartGameMessage
  | PlayCardMessage
  | PingMessage;
```

Add `'prep_started'` to `ServerMessageType`, add the `PrepStartedMessage` interface, change `CardPlayedMessage`, and extend the `ServerMessage` union:

```ts
export type ServerMessageType =
  | 'connected'
  | 'state_update'
  | 'player_joined'
  | 'player_left'
  | 'prep_started'
  | 'game_started'
  | 'card_played'
  | 'game_ended'
  | 'error'
  | 'pong';

export interface PrepStartedMessage {
  type: 'prep_started';
}

export interface CardPlayedMessage {
  type: 'card_played';
  playerId: string;
  playerUsername: string;
  targetPlayerId: string;
  targetUsername: string;
  statement: string;
}
```

```ts
export type ServerMessage =
  | ConnectedMessage
  | StateUpdateMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | PrepStartedMessage
  | GameStartedMessage
  | CardPlayedMessage
  | GameEndedMessage
  | ErrorMessage
  | PongMessage;
```

Extend `parseClientMessage`'s switch with the new cases (place before `default`):

```ts
    case 'set_ready':
      if (typeof msg['ready'] === 'boolean') {
        return { type: 'set_ready', ready: msg['ready'] };
      }
      return null;
    case 'start_prep':
      return { type: 'start_prep' };
    case 'submit_cards':
      if (
        Array.isArray(msg['statements']) &&
        msg['statements'].every((s) => typeof s === 'string')
      ) {
        return { type: 'submit_cards', statements: msg['statements'] as string[] };
      }
      return null;
```

- [ ] **Step 4: Verify green**

Run: `npm run test:shared && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/messages.ts packages/shared/src/messages.test.ts
git commit -m "feat(shared): WS contract for ready/prep/submit + statement plays"
```

---

## Task 4: Party Durable Object

**Files:**
- Modify: `apps/party/src/LobbyDO.ts`
- Modify: `apps/party/test/history.test.ts`
- Modify: `apps/party/test/history.integration.test.ts`
- Modify: `apps/party/test/lobby.integration.test.ts`

- [ ] **Step 1: Drop `randomCardValue` from party test deps**

In `apps/party/test/history.test.ts`, remove the `randomCardValue: () => 5,` line from the local `deps` object (lines ~16–20).

In `apps/party/test/history.integration.test.ts`, remove the `randomCardValue: () => 5,` line from its local deps (line ~37).

- [ ] **Step 2: Update `LobbyDO.deps()` and imports**

In `apps/party/src/LobbyDO.ts`, replace the `deps()` method:

```ts
  /** Rule deps backed by the runtime. */
  private deps(): RuleDeps {
    return {
      newId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    };
  }
```

Update the `@trap/shared` import to add the new rule functions:

```ts
import {
  addPlayer,
  createRoomState,
  getGameState,
  getLobbyMembers,
  setReady,
  startPrep,
  submitCards,
  startGame,
  playCard,
  removePlayer,
  hasGameEnded,
  getFinishedPlayers,
  type GameRoomState,
  type RuleDeps,
} from '@trap/shared';
```

- [ ] **Step 3: Add `set_ready` / `start_prep` / `submit_cards` cases and rework `start_game` / `play_card`**

In `onMessage`, replace the existing `start_game` and `play_card` cases and add the three new cases. The full switch body (after `get_state`) becomes:

```ts
      case 'set_ready': {
        const res = setReady(room, state.playerId, message.ready, this.deps());
        if (!res.ok) {
          this.sendTo(connection, { type: 'error', message: res.error ?? 'set_ready_failed', code: res.error });
          return;
        }
        room = res.state;
        await this.saveRoom(room);
        await this.broadcastState(room);
        return;
      }

      case 'start_prep': {
        if (room.ownerId !== state.playerId) {
          this.sendTo(connection, {
            type: 'error',
            message: 'Only the lobby owner can start the game',
            code: 'not_owner',
          });
          return;
        }
        const res = startPrep(room);
        if (!res.ok) {
          this.sendTo(connection, { type: 'error', message: res.error ?? 'start_prep_failed', code: res.error });
          return;
        }
        room = res.state;
        await this.saveRoom(room);
        this.broadcastMessage({ type: 'prep_started' });
        await this.broadcastState(room);
        return;
      }

      case 'submit_cards': {
        const res = submitCards(room, state.playerId, message.statements, this.deps());
        if (!res.ok) {
          this.sendTo(connection, { type: 'error', message: res.error ?? 'submit_failed', code: res.error });
          return;
        }
        room = res.state;
        await this.saveRoom(room);
        await this.broadcastState(room);
        return;
      }

      case 'start_game': {
        if (room.ownerId !== state.playerId) {
          this.sendTo(connection, {
            type: 'error',
            message: 'Only the lobby owner can start the game',
            code: 'not_owner',
          });
          return;
        }
        const res = startGame(room);
        if (!res.ok) {
          this.sendTo(connection, { type: 'error', message: res.error ?? 'start_failed', code: res.error });
          return;
        }
        room = res.state;
        await this.saveRoom(room);
        this.broadcastMessage({ type: 'game_started' });
        await this.broadcastState(room);
        await recordLobbyHistory(this.env, room);
        await this.notifyAll(room, {
          title: 'Game started',
          body: 'The game has begun!',
          data: { kind: 'game_started', lobbyCode: room.lobbyCode },
        });
        return;
      }

      case 'play_card': {
        const res = playCard(
          room,
          state.playerId,
          message.cardId,
          message.targetPlayerId,
          this.deps()
        );
        if (!res.ok) {
          this.sendTo(connection, { type: 'error', message: res.error ?? 'invalid_play', code: res.error });
          return;
        }
        room = res.state;
        await this.saveRoom(room);

        const statement = room.events[room.events.length - 1]?.statement ?? '';
        const playerUsername = room.usernames[state.playerId] ?? 'Unknown';
        const targetUsername = room.usernames[message.targetPlayerId] ?? 'Unknown';

        this.broadcastMessage({
          type: 'card_played',
          playerId: state.playerId,
          playerUsername,
          targetPlayerId: message.targetPlayerId,
          targetUsername,
          statement,
        });
        await this.broadcastState(room);

        await this.notifyUsers(room, [message.targetPlayerId], {
          title: 'A card was played on you',
          body: `${playerUsername} played "${statement}" on you`,
          data: { kind: 'card_played', lobbyCode: room.lobbyCode },
        });

        if (hasGameEnded(room)) {
          const concluded: GameRoomState = { ...room, status: 'concluded' };
          await this.saveRoom(concluded);
          this.broadcastMessage({
            type: 'game_ended',
            finishedPlayerIds: getFinishedPlayers(concluded),
          });
          await this.broadcastState(concluded);
          await recordLobbyHistory(this.env, concluded);
          await this.notifyAll(concluded, {
            title: 'Game over',
            body: 'The game has ended.',
            data: { kind: 'game_ended', lobbyCode: concluded.lobbyCode },
          });
        }
        return;
      }
```

- [ ] **Step 4: Update the skipped realtime integration tests to the three-stage flow**

These tests are `.skip`ped on this toolchain (segfault on in-test WS), but keep them correct. In `apps/party/test/lobby.integration.test.ts`, within `describe.skip('LobbyDO realtime WebSocket flow', ...)`:

Replace the body of `'connects two players, owner starts game, players receive cards'` with a version that drives all three stages:

```ts
  it('connects two players, runs ready -> prep -> game, players have cards', async () => {
    const code = 'ROOM02';
    await createLobby(code);

    const alice = await connect(code, 'p1', 'Alice');
    await waitFor(alice, 'connected');
    const bob = await connect(code, 'p2', 'Bob');
    await waitFor(bob, 'connected');

    alice.ws.send(JSON.stringify({ type: 'set_ready', ready: true }));
    bob.ws.send(JSON.stringify({ type: 'set_ready', ready: true }));

    alice.ws.send(JSON.stringify({ type: 'start_prep' }));
    await waitFor(alice, 'prep_started');

    alice.ws.send(JSON.stringify({ type: 'submit_cards', statements: ['a', 'b', 'c'] }));
    bob.ws.send(JSON.stringify({ type: 'submit_cards', statements: ['d', 'e', 'f'] }));

    alice.ws.send(JSON.stringify({ type: 'start_game' }));
    await waitFor(alice, 'game_started');

    const aliceState = await waitFor(alice, 'state_update');
    expect(aliceState.state.status).toBe('in-progress');
    expect(aliceState.state.myCards.length).toBe(3);
    expect(aliceState.state.myCards[0]?.statement).toBe('a');

    alice.ws.close();
    bob.ws.close();
  });
```

In `'rejects start_game from a non-owner'`, change Bob's send from `start_game` to `start_prep` (the first owner gate) and keep the `not_owner` assertion:

```ts
    bob.ws.send(JSON.stringify({ type: 'start_prep' }));
    const err = await waitFor(bob, 'error');
    expect(err.code).toBe('not_owner');
```

In `'plays a card and broadcasts card_played + updated state'`, drive ready→prep→submit→start before playing, and assert `statement`:

```ts
    alice.ws.send(JSON.stringify({ type: 'set_ready', ready: true }));
    bob.ws.send(JSON.stringify({ type: 'set_ready', ready: true }));
    alice.ws.send(JSON.stringify({ type: 'start_prep' }));
    await waitFor(alice, 'prep_started');
    alice.ws.send(JSON.stringify({ type: 'submit_cards', statements: ['x', 'y', 'z'] }));
    bob.ws.send(JSON.stringify({ type: 'submit_cards', statements: ['d', 'e', 'f'] }));
    alice.ws.send(JSON.stringify({ type: 'start_game' }));
    await waitFor(alice, 'game_started');
    const started = await waitFor(alice, 'state_update');
    const card = started.state.myCards[0]!;

    alice.ws.send(
      JSON.stringify({ type: 'play_card', cardId: card.id, targetPlayerId: 'p2' })
    );

    const played = await waitFor(bob, 'card_played');
    expect(played.playerId).toBe('p1');
    expect(played.statement).toBe('x');
```

- [ ] **Step 5: Verify green**

Run: `npm run typecheck --workspace=@trap/party`
Expected: PASS.
Run: `npm run test:party`
Expected: PASS (the realtime block stays skipped; HTTP create + history + CORS tests pass).

- [ ] **Step 6: Commit**

```bash
git add apps/party/src/LobbyDO.ts apps/party/test/history.test.ts apps/party/test/history.integration.test.ts apps/party/test/lobby.integration.test.ts
git commit -m "feat(party): route ready/prep/submit + statement plays"
```

---

## Task 5: Mobile realtime + store + navigation helper

**Files:**
- Modify: `apps/mobile/src/lib/realtime.ts`
- Modify: `apps/mobile/src/lib/realtime.test.ts`
- Create: `apps/mobile/src/lib/navigation.ts`
- Create: `apps/mobile/src/lib/navigation.test.ts`
- Modify: `apps/mobile/src/state/game.ts`
- Modify: `apps/mobile/src/state/game.test.ts`

- [ ] **Step 1: Write the failing navigation test**

Create `apps/mobile/src/lib/navigation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { screenForState } from './navigation';

describe('screenForState', () => {
  it('maps waiting -> lobby', () => {
    expect(screenForState('waiting', false)).toBe('lobby');
  });
  it('maps prep -> prep', () => {
    expect(screenForState('prep', false)).toBe('prep');
  });
  it('keeps an un-submitted in-progress player in prep', () => {
    expect(screenForState('in-progress', false)).toBe('prep');
  });
  it('sends a submitted in-progress player to the game', () => {
    expect(screenForState('in-progress', true)).toBe('game');
  });
  it('maps concluded -> game', () => {
    expect(screenForState('concluded', true)).toBe('game');
  });
});
```

- [ ] **Step 2: Implement the navigation helper**

Create `apps/mobile/src/lib/navigation.ts`:

```ts
import type { GameState } from '@trap/shared';

export type GameScreen = 'lobby' | 'prep' | 'game';

/**
 * The screen a player should be on for a given lobby status. A player who has
 * not yet submitted their hand stays in prep even after the game starts (the
 * mid-game-join path), mirroring the server's submit gate.
 */
export function screenForState(
  status: GameState['status'],
  hasSubmitted: boolean
): GameScreen {
  switch (status) {
    case 'waiting':
      return 'lobby';
    case 'prep':
      return 'prep';
    case 'in-progress':
      return hasSubmitted ? 'game' : 'prep';
    case 'concluded':
      return 'game';
  }
}
```

- [ ] **Step 3: Add client sends to `realtime.ts`**

In `apps/mobile/src/lib/realtime.ts`, add three methods to `LobbyConnection` (next to `startGame`):

```ts
  setReady(ready: boolean): void {
    this.send({ type: 'set_ready', ready });
  }

  startPrep(): void {
    this.send({ type: 'start_prep' });
  }

  submitCards(statements: string[]): void {
    this.send({ type: 'submit_cards', statements });
  }
```

- [ ] **Step 4: Cover the new sends in `realtime.test.ts`**

The file already has a `setup()` helper returning `{ fake, conn, getArgs }` and a `'serializes client messages onto the socket'` test that asserts `fake.sent.map((s) => JSON.parse(s))`. Add a new test inside the `describe('LobbyConnection', ...)` block, mirroring that pattern:

```ts
  it('serializes ready/prep/submit client messages', () => {
    const { conn, fake } = setup();
    conn.connect();

    conn.setReady(true);
    conn.startPrep();
    conn.submitCards(['a', 'b']);

    expect(fake.sent.map((s) => JSON.parse(s))).toEqual([
      { type: 'set_ready', ready: true },
      { type: 'start_prep' },
      { type: 'submit_cards', statements: ['a', 'b'] },
    ]);
  });
```

- [ ] **Step 5: Add store actions in `game.ts`**

In `apps/mobile/src/state/game.ts`, add to the `GameStoreState` interface (next to `startGame()`):

```ts
  setReady(ready: boolean): void;
  startPrep(): void;
  submitCards(statements: string[]): void;
```

And implement them in `createGameStore` (next to the `startGame()` impl):

```ts
    setReady(ready) {
      connection?.setReady(ready);
    },

    startPrep() {
      connection?.startPrep();
    },

    submitCards(statements) {
      connection?.submitCards(statements);
    },
```

- [ ] **Step 6: Fix the `card_played` store test for the statement shape**

In `apps/mobile/src/state/game.test.ts`, the `'records the last card_played event'` test builds a `card_played` `event` object whose last field is `cardValue: 7`. Replace only that last line with `statement: 'spills drink',`. The surrounding fields (`playerId: 'p2'`, `playerUsername: 'Bob'`, `targetPlayerId: 'p1'`, `targetUsername: 'Alice'`) and the `expect(...).toEqual(event)` assertion are unchanged — the assertion compares against the same `event` object, so swapping the field keeps it green.

- [ ] **Step 7: Verify green**

Run: `npm run test --workspace=@trap/mobile`
Expected: PASS.
Run: `npm run typecheck --workspace=@trap/mobile`
Expected: FAIL only in the screen files not yet updated (`lobby/[code].tsx`, `game/[code].tsx`, `PlayingCard.tsx`). That is expected — fixed in Tasks 6–7. The `src/` library + state typecheck cleanly.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/lib/realtime.ts apps/mobile/src/lib/realtime.test.ts apps/mobile/src/lib/navigation.ts apps/mobile/src/lib/navigation.test.ts apps/mobile/src/state/game.ts apps/mobile/src/state/game.test.ts
git commit -m "feat(mobile): store/realtime sends + screen routing helper"
```

---

## Task 6: Mobile lobby screen (ready-up)

**Files:**
- Modify: `apps/mobile/app/lobby/[code].tsx`

- [ ] **Step 1: Rework the lobby screen**

Replace `apps/mobile/app/lobby/[code].tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import * as Clipboard from 'expo-clipboard';
import { gameStore } from '../../src/state/game';
import { useAuth, useGame } from '../../src/state/hooks';
import { colors } from '../../src/lib/theme';
import { PressableScale } from '../../src/ui/PressableScale';
import { screenForState } from '../../src/lib/navigation';

const MIN_PLAYERS = 2;

export default function LobbyScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const userId = useAuth((s) => s.userId);
  const username = useAuth((s) => s.username);

  const gameState = useGame((s) => s.gameState);
  const connectionStatus = useGame((s) => s.connectionStatus);
  const lobbyCode = useGame((s) => s.lobbyCode);
  const error = useGame((s) => s.error);

  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyCode = async () => {
    if (!code) return;
    const ok = await Clipboard.setStringAsync(code);
    if (!ok) return;
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!code || !userId || !username) return;
    if (lobbyCode !== code) {
      gameStore.getState().connect({ code, playerId: userId, username });
    }
  }, [code, userId, username, lobbyCode]);

  // Advance to prep/game when the status moves on.
  const me = gameState?.players.find((p) => p.id === userId);
  useEffect(() => {
    if (!gameState || !code) return;
    const target = screenForState(gameState.status, me?.hasSubmitted ?? false);
    if (target !== 'lobby') router.replace(`/${target}/${code}`);
  }, [gameState?.status, me?.hasSubmitted, code]);

  if (!userId) return <Redirect href="/login" />;

  const players = gameState?.players ?? [];
  const isOwner = gameState?.ownerId === userId;
  const allReady = players.length > 0 && players.every((p) => p.isReady);
  const canStart = isOwner && players.length >= MIN_PLAYERS && allReady;
  const cardsPerPlayer = gameState?.cardsPerPlayer ?? 3;
  const iAmReady = me?.isReady ?? false;

  const leave = () => {
    gameStore.getState().leave();
    router.replace('/');
  };

  return (
    <MotiView
      style={styles.container}
      from={{ opacity: 0, translateY: 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 260 }}
    >
      <Pressable onPress={copyCode} testID="copy-code">
        <Text style={styles.code}>Lobby {code}</Text>
        <Text style={styles.copyHint}>{copied ? 'Copied!' : 'Tap to copy'}</Text>
      </Pressable>
      <Text style={styles.status}>
        {connectionStatus === 'open'
          ? `${players.length} player${players.length === 1 ? '' : 's'} in lobby`
          : `Connection: ${connectionStatus}`}
      </Text>
      <Text style={styles.subtle}>This game: {cardsPerPlayer} cards each</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        style={styles.list}
        data={players}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <View style={styles.playerRow}>
            <Text style={styles.playerName}>
              {item.username}
              {item.id === gameState?.ownerId ? '  (host)' : ''}
              {item.id === userId ? '  (you)' : ''}
            </Text>
            <Text style={item.isReady ? styles.ready : styles.notReady}>
              {item.isReady ? 'Ready' : 'Not ready'}
            </Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.subtle}>Waiting for players…</Text>}
      />

      <PressableScale
        testID="ready-toggle"
        style={[styles.button, iAmReady && styles.buttonSecondary]}
        onPress={() => gameStore.getState().setReady(!iAmReady)}
      >
        <Text style={styles.buttonText}>{iAmReady ? "I'm not ready" : "I'm ready"}</Text>
      </PressableScale>

      {isOwner ? (
        <PressableScale
          testID="start-game"
          style={[styles.button, !canStart && styles.buttonDisabled]}
          onPress={() => gameStore.getState().startPrep()}
          disabled={!canStart}
        >
          <Text style={styles.buttonText}>
            {canStart
              ? 'Start (author cards)'
              : players.length < MIN_PLAYERS
                ? `Need ${MIN_PLAYERS}+ players`
                : 'Waiting for all to ready'}
          </Text>
        </PressableScale>
      ) : (
        <Text style={styles.subtle}>Waiting for the host to start…</Text>
      )}

      <Pressable style={styles.linkButton} onPress={leave}>
        <Text style={styles.linkText}>Leave lobby</Text>
      </Pressable>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  code: { color: colors.text, fontSize: 26, fontWeight: '700', letterSpacing: 2 },
  copyHint: { color: colors.muted, fontSize: 12, marginTop: 2 },
  status: { color: colors.muted, fontSize: 15 },
  error: { color: colors.danger, fontSize: 14 },
  list: { flexGrow: 0, marginVertical: 8 },
  playerRow: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  playerName: { color: colors.text, fontSize: 16 },
  ready: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  notReady: { color: colors.muted, fontSize: 14 },
  subtle: { color: colors.muted, fontSize: 14 },
  button: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonSecondary: { backgroundColor: colors.surface },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  linkButton: { alignItems: 'center', paddingVertical: 8 },
  linkText: { color: colors.muted, fontSize: 14 },
});
```

- [ ] **Step 2: Verify (typecheck — full green comes after Task 7)**

Run: `npm run typecheck --workspace=@trap/mobile`
Expected: still FAIL only in `app/prep/[code].tsx` (missing), `app/game/[code].tsx`, `PlayingCard.tsx`. The lobby screen itself compiles.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/lobby/[code].tsx
git commit -m "feat(mobile): lobby ready-up + start-prep gate"
```

---

## Task 7: Mobile prep + game screens

**Files:**
- Create: `apps/mobile/app/prep/[code].tsx`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/src/ui/PlayingCard.tsx`
- Modify: `apps/mobile/app/game/[code].tsx`

- [ ] **Step 1: Register the prep route**

In `apps/mobile/app/_layout.tsx`, add a `Stack.Screen` after the `lobby/[code]` one:

```tsx
          <Stack.Screen name="lobby/[code]" options={{ title: 'Lobby' }} />
          <Stack.Screen name="prep/[code]" options={{ title: 'Author cards' }} />
          <Stack.Screen name="game/[code]" options={{ title: 'Game' }} />
```

- [ ] **Step 2: Create the prep screen**

Create `apps/mobile/app/prep/[code].tsx`:

```tsx
import { useEffect, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { MAX_STATEMENT_LENGTH } from '@trap/shared';
import { gameStore } from '../../src/state/game';
import { useAuth, useGame } from '../../src/state/hooks';
import { colors } from '../../src/lib/theme';
import { PressableScale } from '../../src/ui/PressableScale';
import { screenForState } from '../../src/lib/navigation';

export default function PrepScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const userId = useAuth((s) => s.userId);
  const username = useAuth((s) => s.username);

  const gameState = useGame((s) => s.gameState);
  const lobbyCode = useGame((s) => s.lobbyCode);
  const error = useGame((s) => s.error);

  const cardsPerPlayer = gameState?.cardsPerPlayer ?? 3;
  const [statements, setStatements] = useState<string[]>([]);

  // Keep the input array sized to cardsPerPlayer.
  useEffect(() => {
    setStatements((prev) => {
      if (prev.length === cardsPerPlayer) return prev;
      const next = prev.slice(0, cardsPerPlayer);
      while (next.length < cardsPerPlayer) next.push('');
      return next;
    });
  }, [cardsPerPlayer]);

  // Reconnect if opened directly.
  useEffect(() => {
    if (code && userId && username && lobbyCode !== code) {
      gameStore.getState().connect({ code, playerId: userId, username });
    }
  }, [code, userId, username, lobbyCode]);

  const me = gameState?.players.find((p) => p.id === userId);
  const hasSubmitted = me?.hasSubmitted ?? false;

  // Route forward/back when status changes (game start, or owner not yet ready).
  useEffect(() => {
    if (!gameState || !code) return;
    const target = screenForState(gameState.status, hasSubmitted);
    if (target !== 'prep') router.replace(`/${target}/${code}`);
  }, [gameState?.status, hasSubmitted, code]);

  if (!userId) return <Redirect href="/login" />;

  const players = gameState?.players ?? [];
  const isOwner = gameState?.ownerId === userId;
  const allSubmitted = players.length > 0 && players.every((p) => p.hasSubmitted);
  const trimmed = statements.map((s) => s.trim());
  const allValid =
    trimmed.length === cardsPerPlayer &&
    trimmed.every((s) => s.length > 0 && s.length <= MAX_STATEMENT_LENGTH);

  const setAt = (i: number, value: string) =>
    setStatements((prev) => prev.map((s, idx) => (idx === i ? value : s)));

  const submit = () => {
    if (!allValid || hasSubmitted) return;
    gameStore.getState().submitCards(trimmed);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Author your traps</Text>
        <Text style={styles.subtle}>
          Write {cardsPerPlayer} trap statements. They lock once you submit.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {statements.map((value, i) => (
          <View key={i} style={styles.inputBlock}>
            <TextInput
              testID={`statement-${i}`}
              style={[styles.input, hasSubmitted && styles.inputLocked]}
              value={value}
              onChangeText={(t) => setAt(i, t)}
              editable={!hasSubmitted}
              placeholder={`Trap ${i + 1} (e.g. "checks their phone")`}
              placeholderTextColor={colors.muted}
              maxLength={MAX_STATEMENT_LENGTH}
              multiline
            />
            <Text style={styles.counter}>
              {value.trim().length}/{MAX_STATEMENT_LENGTH}
            </Text>
          </View>
        ))}

        {hasSubmitted ? (
          <Text style={styles.submitted}>Submitted ✓</Text>
        ) : (
          <PressableScale
            testID="submit-cards"
            style={[styles.button, !allValid && styles.buttonDisabled]}
            onPress={submit}
            disabled={!allValid}
          >
            <Text style={styles.buttonText}>Submit cards</Text>
          </PressableScale>
        )}

        <Text style={styles.section}>Players</Text>
        <FlatList
          scrollEnabled={false}
          data={players}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <View style={styles.playerRow}>
              <Text style={styles.playerName}>
                {item.username}
                {item.id === userId ? '  (you)' : ''}
              </Text>
              <Text style={item.hasSubmitted ? styles.ready : styles.notReady}>
                {item.hasSubmitted ? 'Submitted' : 'Writing…'}
              </Text>
            </View>
          )}
        />
      </ScrollView>

      {isOwner ? (
        <PressableScale
          testID="begin-game"
          style={[styles.button, styles.beginButton, !allSubmitted && styles.buttonDisabled]}
          onPress={() => gameStore.getState().startGame()}
          disabled={!allSubmitted}
        >
          <Text style={styles.buttonText}>
            {allSubmitted ? 'Begin game' : 'Waiting for all to submit'}
          </Text>
        </PressableScale>
      ) : (
        <Text style={styles.subtleFooter}>Waiting for the host to begin…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 20, gap: 10 },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  subtle: { color: colors.muted, fontSize: 14 },
  subtleFooter: { color: colors.muted, fontSize: 14, textAlign: 'center', padding: 14 },
  error: { color: colors.danger, fontSize: 14 },
  inputBlock: { marginTop: 8 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    padding: 12,
    minHeight: 48,
  },
  inputLocked: { opacity: 0.6 },
  counter: { color: colors.muted, fontSize: 11, textAlign: 'right', marginTop: 2 },
  submitted: { color: colors.accent, fontSize: 16, fontWeight: '700', marginTop: 8 },
  section: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 20 },
  playerRow: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  playerName: { color: colors.text, fontSize: 15 },
  ready: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  notReady: { color: colors.muted, fontSize: 14 },
  button: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  beginButton: { margin: 16, marginTop: 0 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
});
```

- [ ] **Step 3: Render statements in `PlayingCard`**

Replace `apps/mobile/src/ui/PlayingCard.tsx` with:

```tsx
/**
 * A single hand card showing the player's authored trap statement. Deals in with
 * a staggered fade/slide, lifts when selected, and flips/flies out when played
 * (exit, via AnimatePresence in the parent). Keeps testID="hand-card" so the e2e
 * count assertion still works.
 */
import { Pressable, StyleSheet, Text } from 'react-native';
import { MotiView } from 'moti';
import { colors } from '../lib/theme';
import { DEAL_STAGGER, DURATION } from './motion';

export function PlayingCard({
  statement,
  selected,
  index,
  onPress,
}: {
  statement: string | null;
  selected: boolean;
  index: number;
  onPress: () => void;
}) {
  return (
    <MotiView
      from={{ opacity: 0, translateY: 16, scale: 0.96 }}
      animate={{ opacity: 1, translateY: selected ? -10 : 0, scale: selected ? 1.04 : 1 }}
      exit={{ opacity: 0, translateY: -40, scale: 0.8, rotateY: '90deg' }}
      transition={{ type: 'timing', duration: DURATION.base, delay: index * DEAL_STAGGER }}
    >
      <Pressable
        testID="hand-card"
        onPress={onPress}
        style={[styles.card, selected && styles.cardSelected]}
      >
        <Text style={styles.cardText} numberOfLines={4}>
          {statement ?? '?'}
        </Text>
      </Pressable>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 150,
    minHeight: 90,
    borderRadius: 10,
    backgroundColor: colors.surface,
    padding: 12,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
  },
  cardSelected: { borderColor: colors.accent, backgroundColor: '#22543d' },
  cardText: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
```

- [ ] **Step 4: Update the game screen for statements**

In `apps/mobile/app/game/[code].tsx`:

Update the reconnect/redirect effect to use `screenForState` (replace the existing reconnect `useEffect` and add a redirect). Add the import:

```tsx
import { screenForState } from '../../src/lib/navigation';
```

Replace the `<PlayingCard ... value={card.value} ... />` usage with `statement`:

```tsx
              <PlayingCard
                key={card.id}
                statement={card.statement}
                index={i}
                selected={card.id === selectedCardId}
                onPress={() => setSelectedCardId(card.id === selectedCardId ? null : card.id)}
              />
```

Replace the history line render to show the statement:

```tsx
              <Text key={h.id} style={styles.historyItem}>
                {h.playerUsername} played “{h.statement ?? '?'}” on{' '}
                {h.targetUsername ?? 'unknown'}
              </Text>
```

After the existing reconnect effect, add a guard so a not-yet-submitted player is bounced back to prep (covers a deep-link into the game before submitting):

```tsx
  const me = gameState?.players.find((p) => p.id === userId);
  useEffect(() => {
    if (!gameState || !code) return;
    const target = screenForState(gameState.status, me?.hasSubmitted ?? false);
    if (target !== 'game') router.replace(`/${target}/${code}`);
  }, [gameState?.status, me?.hasSubmitted, code]);
```

(Place this after the `if (!userId) return <Redirect .../>` is NOT possible because hooks must run unconditionally — insert it alongside the other `useEffect`s, before the early returns.)

- [ ] **Step 5: Verify green**

Run: `npm run typecheck --workspace=@trap/mobile && npm run test --workspace=@trap/mobile`
Expected: PASS (all workspaces now compile; mobile unit tests pass).
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/app/prep/[code].tsx apps/mobile/app/_layout.tsx apps/mobile/src/ui/PlayingCard.tsx apps/mobile/app/game/[code].tsx
git commit -m "feat(mobile): prep authoring screen + statement cards"
```

---

## Task 8: End-to-end + device gate + docs

**Files:**
- Modify: `apps/mobile/e2e/multiplayer.spec.ts`
- Modify: `apps/mobile/maestro/player2.mjs`
- Modify: `apps/mobile/.maestro/game.yaml`
- Modify: `apps/mobile/e2e/README.md`

- [ ] **Step 1: Update the Playwright multiplayer spec to the three-stage flow**

In `apps/mobile/e2e/multiplayer.spec.ts`, replace the block from the Start click (line ~49) through the end of the play assertions with:

```ts
    // Both players ready up.
    await vis(host.getByTestId('ready-toggle')).click();
    await vis(guest.getByTestId('ready-toggle')).click();

    // Owner starts prep; both land on the prep screen.
    await expect(vis(host.getByTestId('start-game'))).toBeEnabled();
    await vis(host.getByTestId('start-game')).click();
    await host.waitForURL(new RegExp(`/prep/${code}`));
    await guest.waitForURL(new RegExp(`/prep/${code}`));

    // Each authors three statements and submits.
    for (const page of [host, guest]) {
      for (let i = 0; i < 3; i++) {
        await vis(page.getByTestId(`statement-${i}`)).fill(`trap ${i + 1}`);
      }
      await vis(page.getByTestId('submit-cards')).click();
    }

    // Owner begins the game; both land on the game with a 3-card hand.
    await expect(vis(host.getByTestId('begin-game'))).toBeEnabled();
    await vis(host.getByTestId('begin-game')).click();
    await host.waitForURL(new RegExp(`/game/${code}`));
    await guest.waitForURL(new RegExp(`/game/${code}`));
    await expect(vis(host.getByTestId('hand-card'))).toHaveCount(3);
    await expect(vis(guest.getByTestId('hand-card'))).toHaveCount(3);

    // Host plays a card on the opponent.
    await vis(host.getByTestId('hand-card')).first().click();
    await vis(host.getByTestId('opponent')).first().click();

    await expect(vis(host.getByTestId('hand-card'))).toHaveCount(2);
    await expect(vis(host.getByText(new RegExp(`${hostUser} played`)))).toBeVisible();
    await expect(vis(guest.getByText(new RegExp(`${hostUser} played`)))).toBeVisible();
```

Update the test name/JSDoc at the top to describe the ready → prep → game flow.

- [ ] **Step 2: Update the player-2 helper to drive the new gates**

In `apps/mobile/maestro/player2.mjs`, replace the message handler (the `socket.addEventListener('message', ...)` block) so the helper readies, starts prep once both are present, submits its hand, and begins the game once both have submitted:

```js
  let started = false;
  let readied = false;
  let prepStarted = false;
  let submitted = false;
  let begun = false;

  socket.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type !== 'state_update') return;
    const state = msg.state ?? {};
    const players = state.players ?? [];

    // Ready up as soon as we are connected.
    if (!readied) {
      readied = true;
      socket.send(JSON.stringify({ type: 'set_ready', ready: true }));
    }
    // Once both players are present and ready, the owner starts prep.
    if (!prepStarted && players.length >= 2 && players.every((p) => p.isReady)) {
      prepStarted = true;
      socket.send(JSON.stringify({ type: 'start_prep' }));
      console.log('player2: sent start_prep');
    }
    // In prep, submit our hand once.
    if (!submitted && state.status === 'prep') {
      submitted = true;
      const n = state.cardsPerPlayer ?? 3;
      const statements = Array.from({ length: n }, (_, i) => `p2 trap ${i + 1}`);
      socket.send(JSON.stringify({ type: 'submit_cards', statements }));
      console.log('player2: sent submit_cards');
    }
    // Once everyone has submitted, begin the game.
    if (!begun && state.status === 'prep' && players.length >= 2 && players.every((p) => p.hasSubmitted)) {
      begun = true;
      started = true;
      socket.send(JSON.stringify({ type: 'start_game' }));
      console.log('player2: sent start_game');
    }
  });
```

Remove the now-unused `started`-only logic (the old `if (msg.type === 'state_update' && !started)` block) — the new handler above replaces it. Keep the `open`/`error`/timeout handlers as-is.

- [ ] **Step 3: Update the Maestro device flow to author + submit**

In `apps/mobile/.maestro/game.yaml`, after the device joins the lobby and before it plays a card, insert prep steps. After the `tapOn: ready-toggle` (the device must ready up) and once the helper begins the game, the device authors and submits its hand. Add (adjust to match the file's existing structure for input/tap by testID):

```yaml
# Stage 1: ready up in the lobby.
- tapOn:
    id: "ready-toggle"

# Stage 2: prep — author and submit three statements.
- extendedWaitUntil:
    visible:
      id: "statement-0"
    timeout: 30000
- tapOn:
    id: "statement-0"
- inputText: "device trap 1"
- tapOn:
    id: "statement-1"
- inputText: "device trap 2"
- tapOn:
    id: "statement-2"
- inputText: "device trap 3"
- tapOn:
    id: "submit-cards"

# Stage 3: wait for the host (player2) to begin, then play a card.
- extendedWaitUntil:
    visible:
      id: "hand-card"
    timeout: 30000
- tapOn:
    id: "hand-card"
    index: 0
- tapOn:
    id: "opponent"
    index: 0
- assertVisible: "${P1_USER} played.*"
```

NOTE: read the current `game.yaml` first and splice these steps into the existing join/play sequence rather than appending blindly — keep the existing launch/login/join steps, replace only the old "join → tap hand-card → play" tail.

- [ ] **Step 4: Update the e2e README**

In `apps/mobile/e2e/README.md`, update the flow description (around line 38) to: owner readies + starts prep, each player authors and submits 3 statements, owner begins the game, then a played card surfaces its statement on both clients.

- [ ] **Step 5: Verify the e2e locally**

Run (from `apps/mobile`, with a local Worker running per `e2e/README.md`): `npm run test:e2e`
Expected: the multiplayer spec passes end-to-end.

If a live Worker is not available in this environment, run at minimum:
Run: `npm test` (root) and `npm run lint`
Expected: PASS. Note in the commit/PR that the on-device Maestro flow is validated by CI.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/e2e/multiplayer.spec.ts apps/mobile/maestro/player2.mjs apps/mobile/.maestro/game.yaml apps/mobile/e2e/README.md
git commit -m "test: three-stage flow in e2e + device gate"
```

---

## Final verification

- [ ] **Step 1: Full test + lint + typecheck sweep**

Run: `npm test`
Expected: PASS (shared + party + mobile).
Run: `npm run typecheck && npm run typecheck --workspace=@trap/party && npm run typecheck --workspace=@trap/mobile`
Expected: PASS.
Run: `npm run lint`
Expected: PASS (ESLint + markdownlint).

- [ ] **Step 2: Manual smoke (optional but recommended)**

Per `AGENTS.md`: `npx wrangler dev` (apps/party) + `npx expo start` (apps/mobile, web). Walk two browsers through lobby ready-up → prep authoring → game activation; confirm own statements show, others' are hidden until played, and the game ends when a player runs out.

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch to open the PR for `feat/user-authored-trap-cards`.

---

## Notes for the implementer

- **Index export merge:** `packages/shared/src/index.ts` already re-exports everything via `export * from './types.js'` etc., so the new exports (`setReady`, `MAX_STATEMENT_LENGTH`, message types, …) are picked up automatically — no edit needed there.
- **Workers test-pool constraint (AGENTS.md):** do not add party tests that create a lobby DO and then re-touch the same DO within one test (trips the Windows isolated-storage teardown). The realtime block stays `.skip`ped; the new rules are fully covered by `packages/shared` unit tests.
- **Do not** run `npm audit fix --force` in `apps/party`.
- **GitNexus:** MCP tools are not connected — use `npx gitnexus status` / `analyze` if needed.
- **Commit hygiene:** no `Co-Authored-By: Claude` trailer; run `npm run lint` before every commit.
