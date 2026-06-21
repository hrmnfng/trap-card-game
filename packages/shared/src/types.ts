/**
 * Shared domain types for the Trap Card Game.
 *
 * This is the single source of truth shared between the Expo client
 * (`apps/mobile`) and the Cloudflare PartyServer Durable Object
 * (`apps/party`). It replaces the previously hand-mirrored definitions in
 * `frontend/src/types/index.ts` and `backend/app/models/schemas.py`.
 *
 * Drift fixes vs. the legacy code:
 *  - Lobby status is unified to a single union: `waiting | in-progress | concluded`.
 *    (The legacy frontend used `waiting | active | ended` in some places.)
 *  - Timestamps are always ISO-8601 strings (never datetime objects), which
 *    removes the `Object of type datetime is not JSON serializable` hazard.
 */

/** Canonical lobby / game lifecycle status. */
export type LobbyStatus = 'waiting' | 'in-progress' | 'concluded';

/** Card visibility status from a viewer's perspective. */
export type CardStatus = 'hidden' | 'revealed';

/** Game action kinds recorded in the event log. */
export type GameActionType = 'join' | 'leave' | 'distribute' | 'play_card';

/** Default game configuration (ported from backend `Settings`). */
export interface GameSettings {
  minPlayers: number;
  maxPlayers: number;
  cardsPerPlayer: number;
  minCardValue: number;
  maxCardValue: number;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  minPlayers: 2,
  maxPlayers: 10,
  cardsPerPlayer: 3,
  minCardValue: 1,
  maxCardValue: 9,
};

/**
 * A single event in the event-sourced game log. The full game state is derived
 * by replaying these events (mirrors the legacy `GameAction` table design).
 */
export interface GameEvent {
  /** Unique event id. */
  id: string;
  /** The action type. */
  type: GameActionType;
  /** The player who performed the action. */
  playerId: string;
  /** Card value (for `distribute` / `play_card`). */
  cardValue?: number;
  /** Card id (for `distribute` / `play_card`). Stored in legacy `action_metadata`. */
  cardId?: string;
  /** Target player (for `play_card`). */
  targetId?: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
}

/** A card as seen in a player's own hand. */
export interface Card {
  id: string;
  value: number | null;
  status: CardStatus;
  ownerId: string;
}

/** Public, per-player info (other players' card values are hidden). */
export interface PlayerView {
  id: string;
  username: string;
  cardsRemaining: number;
}

/** A play action surfaced in the game history feed. */
export interface GameHistoryItem {
  id: string;
  actionType: GameActionType;
  playerId: string;
  playerUsername: string;
  targetId: string | null;
  targetUsername: string | null;
  cardValue: number | null;
  timestamp: string;
}

/**
 * The full game state, filtered for a specific viewing player.
 * `myCards` shows real values; other players only expose counts.
 */
export interface GameState {
  lobbyId: string;
  lobbyCode: string;
  status: LobbyStatus;
  ownerId: string | null;
  players: PlayerView[];
  myCards: Card[];
  gameHistory: GameHistoryItem[];
}

/** A lobby member registered in a Durable Object. */
export interface LobbyMember {
  playerId: string;
  username: string;
  joinedAt: string;
}

/** Minimal account/user representation returned by the auth API. */
export interface User {
  userId: string;
  username: string;
}

/** Auth API response for register/login. */
export interface AuthResponse {
  userId: string;
  username: string;
  token: string;
}

/** Lobby history summary item (persisted in D1). */
export interface LobbyHistoryItem {
  id: string;
  code: string;
  status: LobbyStatus;
  ownerId: string | null;
  ownerUsername: string | null;
  createdAt: string;
  joinedAt: string;
  playerCount: number;
}

/** Supported push notification platforms. */
export type DevicePlatform = 'ios' | 'android';
