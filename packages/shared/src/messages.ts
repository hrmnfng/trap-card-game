/**
 * WebSocket message contract between the Expo client and the Lobby Durable
 * Object. This preserves the legacy protocol (see `backend/app/api/websocket.py`
 * and `frontend/src/services/websocket.ts`) so behaviour is identical after the
 * migration, while giving both ends a single typed source of truth.
 */

import type { GameState } from './types.js';

/* -------------------------------------------------------------------------- */
/* Client -> Server (Durable Object)                                          */
/* -------------------------------------------------------------------------- */

export type ClientMessageType = 'get_state' | 'start_game' | 'play_card' | 'ping';

export interface GetStateMessage {
  type: 'get_state';
}

export interface StartGameMessage {
  type: 'start_game';
}

export interface PlayCardMessage {
  type: 'play_card';
  cardId: string;
  targetPlayerId: string;
}

export interface PingMessage {
  type: 'ping';
}

export type ClientMessage =
  | GetStateMessage
  | StartGameMessage
  | PlayCardMessage
  | PingMessage;

/* -------------------------------------------------------------------------- */
/* Server (Durable Object) -> Client                                          */
/* -------------------------------------------------------------------------- */

export type ServerMessageType =
  | 'connected'
  | 'state_update'
  | 'player_joined'
  | 'player_left'
  | 'game_started'
  | 'card_played'
  | 'game_ended'
  | 'error'
  | 'pong';

export interface ConnectedMessage {
  type: 'connected';
  playerId: string;
  lobbyCode: string;
}

export interface StateUpdateMessage {
  type: 'state_update';
  state: GameState;
}

export interface PlayerJoinedMessage {
  type: 'player_joined';
  playerId: string;
  username: string;
}

export interface PlayerLeftMessage {
  type: 'player_left';
  playerId: string;
  username: string;
}

export interface GameStartedMessage {
  type: 'game_started';
}

export interface CardPlayedMessage {
  type: 'card_played';
  playerId: string;
  playerUsername: string;
  targetPlayerId: string;
  targetUsername: string;
  cardValue: number;
}

export interface GameEndedMessage {
  type: 'game_ended';
  /** Player ids that ran out of cards (triggered the end). */
  finishedPlayerIds: string[];
}

export interface ErrorMessage {
  type: 'error';
  message: string;
  code?: string;
}

export interface PongMessage {
  type: 'pong';
}

export type ServerMessage =
  | ConnectedMessage
  | StateUpdateMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | GameStartedMessage
  | CardPlayedMessage
  | GameEndedMessage
  | ErrorMessage
  | PongMessage;

/* -------------------------------------------------------------------------- */
/* Type guards / helpers                                                      */
/* -------------------------------------------------------------------------- */

/** Narrowly parse an unknown payload into a ClientMessage, or return null. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const msg = raw as Record<string, unknown>;
  switch (msg['type']) {
    case 'get_state':
      return { type: 'get_state' };
    case 'start_game':
      return { type: 'start_game' };
    case 'ping':
      return { type: 'ping' };
    case 'play_card':
      if (
        typeof msg['cardId'] === 'string' &&
        typeof msg['targetPlayerId'] === 'string'
      ) {
        return {
          type: 'play_card',
          cardId: msg['cardId'],
          targetPlayerId: msg['targetPlayerId'],
        };
      }
      return null;
    default:
      return null;
  }
}
