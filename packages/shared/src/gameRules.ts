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
  const joinedAt = new Map<string, string>();
  for (const ev of state.events) {
    if (ev.type === 'join' && !joinedAt.has(ev.playerId)) {
      order.push(ev.playerId);
      joinedAt.set(ev.playerId, ev.timestamp);
    }
  }
  return order.map((id) => ({
    playerId: id,
    username: state.usernames[id] ?? 'Unknown',
    joinedAt: joinedAt.get(id)!,
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
 * New players may only join while the lobby is `waiting`; once it advances,
 * joins are locked and only existing members may reconnect.
 */
export function addPlayer(
  state: GameRoomState,
  playerId: string,
  username: string,
  deps: RuleDeps
): RuleResult {
  // Existing members may always reconnect (idempotent), even at capacity —
  // membership is permanent, so the roster count never frees up.
  if (!isPlayerNewToLobby(state, playerId)) {
    return {
      ok: true,
      state: { ...state, usernames: { ...state.usernames, [playerId]: username } },
    };
  }

  // New players may only join while the lobby is still gathering (waiting).
  if (state.status !== 'waiting') {
    return { ok: false, state, error: 'joins_locked' };
  }

  if (isLobbyFull(state)) {
    return { ok: false, state, error: 'lobby_full' };
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

/** Ids of current members who are ready. */
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

/** Whether a player has submitted their hand (has ≥1 `distribute` event). */
export function hasPlayerSubmitted(state: GameRoomState, playerId: string): boolean {
  return state.events.some(
    (ev) => ev.type === 'distribute' && ev.playerId === playerId
  );
}

/** Ids of current members who have submitted their hand. */
export function getSubmittedPlayers(state: GameRoomState): string[] {
  return getLobbyMembers(state)
    .map((m) => m.playerId)
    .filter((id) => hasPlayerSubmitted(state, id));
}

/**
 * Submit a full, locked hand of authored statements. Allowed only in `prep`.
 * Appends one `distribute` event per trimmed statement.
 */
export function submitCards(
  state: GameRoomState,
  playerId: string,
  statements: string[],
  deps: RuleDeps
): RuleResult {
  if (state.status !== 'prep') {
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

export function getGameState(
  state: GameRoomState,
  viewerId: string,
  onlinePlayerIds: ReadonlySet<string> = new Set()
): GameState {
  const members = getLobbyMembers(state);
  const players: PlayerView[] = members.map((m) => ({
    id: m.playerId,
    username: m.username,
    cardsRemaining: getRemainingCardsCount(state, m.playerId),
    isReady: isPlayerReady(state, m.playerId),
    hasSubmitted: hasPlayerSubmitted(state, m.playerId),
    isOnline: onlinePlayerIds.has(m.playerId),
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
