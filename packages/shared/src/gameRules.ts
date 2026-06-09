/**
 * Pure, framework-agnostic game rules for the Trap Card Game.
 *
 * Ported from the legacy backend services:
 *  - `backend/app/services/game.py`   (card distribution, play, state derivation)
 *  - `backend/app/services/lobby.py`  (membership join/leave, mid-game provisioning)
 *
 * Design notes:
 *  - Event-sourced: the authoritative data is `GameRoomState.events`; derived
 *    views (hands, counts, history) are computed by replaying events. This
 *    mirrors the legacy `GameAction` table.
 *  - Pure functions: every function takes state + inputs and returns new state
 *    or a derived value. No I/O, no globals. This makes the rules trivially
 *    unit-testable and reusable on both the client and the Durable Object.
 *  - Determinism: randomness (card values, ids) is injected via `RuleDeps` so
 *    tests are reproducible. The legacy code called `random.randint`/`uuid4`
 *    directly, which was not testable.
 */

import {
  DEFAULT_GAME_SETTINGS,
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

/**
 * The complete, serializable state of a single lobby/game room.
 * This is what a Durable Object persists in storage.
 */
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
  /** Returns an integer card value in [min, max] inclusive. */
  randomCardValue: (min: number, max: number) => number;
  /** Returns an ISO-8601 timestamp. */
  now: () => string;
}

/** Result wrapper for rule operations that can fail validation. */
export interface RuleResult {
  ok: boolean;
  state: GameRoomState;
  /** Reason for failure when `ok` is false. */
  error?: string;
}

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

/** Create an empty room state for a freshly created lobby. */
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

/** Set of card ids that have been played (by anyone). */
function playedCardIds(state: GameRoomState): Set<string> {
  const played = new Set<string>();
  for (const ev of state.events) {
    if (ev.type === 'play_card' && ev.cardId) played.add(ev.cardId);
  }
  return played;
}

/** Whether a given player currently holds a given card (owns + not played). */
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

/** Whether a card (by id) has already been played. */
export function isCardPlayed(state: GameRoomState, cardId: string): boolean {
  return state.events.some(
    (ev) => ev.type === 'play_card' && ev.cardId === cardId
  );
}

/* -------------------------------------------------------------------------- */
/* Membership (ported from lobby.py)                                          */
/* -------------------------------------------------------------------------- */

/** True if the player has never joined this lobby (no prior `join` event). */
export function isPlayerNewToLobby(
  state: GameRoomState,
  playerId: string
): boolean {
  return !state.events.some(
    (ev) => ev.type === 'join' && ev.playerId === playerId
  );
}

/** Current members (join adds, leave removes), in stable join order. */
export function getLobbyMembers(state: GameRoomState): LobbyMember[] {
  const order: string[] = [];
  const present = new Map<string, string>(); // playerId -> joinedAt
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
 * Add a player to the lobby (idempotent join). For brand-new players who join
 * an already in-progress game, their starting hand is provisioned immediately
 * (mirrors `provision_new_player_cards`). The first joiner becomes owner.
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

  // Idempotent rejoin: known player, just succeed.
  if (!isPlayerNewToLobby(state, playerId)) {
    // Keep username fresh.
    return {
      ok: true,
      state: { ...state, usernames: { ...state.usernames, [playerId]: username } },
    };
  }

  // Reject duplicate username (case-insensitive) held by a different player.
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

  // First player becomes owner.
  if (!next.ownerId) {
    next = { ...next, ownerId: playerId };
  }

  // Record join.
  next = appendEvent(next, {
    id: deps.newId(),
    type: 'join',
    playerId,
    timestamp: deps.now(),
  });

  // Mid-game joiner: provision a starting hand now.
  if (hasGameStarted(next)) {
    next = dealHand(next, playerId, deps);
  }

  return { ok: true, state: next };
}

/** Record a player leaving the lobby. */
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
/* Card distribution (ported from game.py)                                    */
/* -------------------------------------------------------------------------- */

/** Append `cardsPerPlayer` distribute events for a single player. */
function dealHand(
  state: GameRoomState,
  playerId: string,
  deps: RuleDeps
): GameRoomState {
  let next = state;
  for (let i = 0; i < state.settings.cardsPerPlayer; i++) {
    next = appendEvent(next, {
      id: deps.newId(),
      type: 'distribute',
      playerId,
      cardValue: deps.randomCardValue(
        state.settings.minCardValue,
        state.settings.maxCardValue
      ),
      cardId: deps.newId(),
      timestamp: deps.now(),
    });
  }
  return next;
}

/**
 * Start the game: distribute cards to players that don't already have them and
 * transition to `in-progress`. Returns failure if the game already started or
 * there are fewer than `minPlayers`.
 *
 * Mirrors `GameService.distribute_cards` + the owner's "start game" action.
 */
export function startGame(state: GameRoomState, deps: RuleDeps): RuleResult {
  if (hasGameStarted(state)) {
    return { ok: false, state, error: 'already_started' };
  }
  const members = getLobbyMembers(state);
  if (members.length < state.settings.minPlayers) {
    return { ok: false, state, error: 'not_enough_players' };
  }

  let next = state;
  for (const member of members) {
    const existing = getPlayerCards(next, member.playerId);
    if (existing.length === 0) {
      next = dealHand(next, member.playerId, deps);
    }
  }
  next = { ...next, status: 'in-progress' };
  return { ok: true, state: next };
}

/* -------------------------------------------------------------------------- */
/* Hand / counts derivation                                                   */
/* -------------------------------------------------------------------------- */

/** A player's current (un-played) cards, with real values. */
export function getPlayerCards(
  state: GameRoomState,
  playerId: string
): Card[] {
  const played = playedCardIds(state);
  const cards: Card[] = [];
  for (const ev of state.events) {
    if (ev.type !== 'distribute' || ev.playerId !== playerId || !ev.cardId) {
      continue;
    }
    if (!played.has(ev.cardId)) {
      cards.push({
        id: ev.cardId,
        value: ev.cardValue ?? null,
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
/* Playing a card (ported from game.py)                                       */
/* -------------------------------------------------------------------------- */

/**
 * Play a card targeting another player. Validates ownership and that the card
 * has not already been played. There is no turn enforcement (free-for-all).
 */
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

  // Find the card's value from its distribute event.
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
    cardValue: distributeEv.cardValue,
    cardId,
    targetId: targetPlayerId,
    timestamp: deps.now(),
  });
  return { ok: true, state: next };
}

/* -------------------------------------------------------------------------- */
/* End condition (ported from game.py has_game_ended)                         */
/* -------------------------------------------------------------------------- */

/** Player ids who have played at least one card. */
function playersWhoHavePlayed(state: GameRoomState): Set<string> {
  const set = new Set<string>();
  for (const ev of state.events) {
    if (ev.type === 'play_card') set.add(ev.playerId);
  }
  return set;
}

/**
 * The game ends when any player who has played at least one card runs out of
 * cards. Players who joined mid-game but never played do not trigger the end.
 * Returns the ids of finished players (empty if not ended).
 */
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
/* Full per-player state view (ported from game.py get_game_state)            */
/* -------------------------------------------------------------------------- */

/** Build the game history feed (all play_card actions, oldest first). */
export function getGameHistory(state: GameRoomState): GameHistoryItem[] {
  return state.events
    .filter((ev) => ev.type === 'play_card')
    .map((ev) => ({
      id: ev.id,
      actionType: ev.type,
      playerId: ev.playerId,
      playerUsername: state.usernames[ev.playerId] ?? 'Unknown',
      targetId: ev.targetId ?? null,
      targetUsername: ev.targetId
        ? state.usernames[ev.targetId] ?? null
        : null,
      cardValue: ev.cardValue ?? null,
      timestamp: ev.timestamp,
    }));
}

/**
 * Derive the complete game state filtered for a specific viewing player.
 * The viewer sees real values for their own cards; other players expose only
 * remaining-card counts.
 */
export function getGameState(
  state: GameRoomState,
  viewerId: string
): GameState {
  const members = getLobbyMembers(state);
  const players: PlayerView[] = members.map((m) => ({
    id: m.playerId,
    username: m.username,
    cardsRemaining: getRemainingCardsCount(state, m.playerId),
  }));

  // Reflect computed end condition in the surfaced status.
  let status: LobbyStatus = state.status;
  if (hasGameEnded(state)) status = 'concluded';

  return {
    lobbyId: state.lobbyId,
    lobbyCode: state.lobbyCode,
    status,
    ownerId: state.ownerId,
    players,
    myCards: getPlayerCards(state, viewerId),
    gameHistory: getGameHistory(state),
  };
}
