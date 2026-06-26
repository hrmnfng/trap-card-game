/**
 * Realtime lobby + game store (Zustand). Consolidates the legacy Pinia `lobby`
 * and `game` stores: the new Durable Object exposes a single per-player
 * `GameState` over `state_update`, so player list, status, hand, and history
 * all derive from one source instead of separate HTTP polls.
 *
 * Vanilla store via a factory: the `LobbyConnection` factory is injectable so
 * the message-handling reducer is unit-testable without a real socket.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';
import type { CardPlayedMessage, GameState, ServerMessage } from '@trap/shared';
import {
  LobbyConnection,
  type ConnectionStatus,
  type LobbyConnectionOptions,
} from '../lib/realtime';

export type GameConnectionStatus = ConnectionStatus | 'idle';

export interface ConnectArgs {
  code: string;
  playerId: string;
  username: string;
}

export interface GameStoreState {
  connectionStatus: GameConnectionStatus;
  lobbyCode: string | null;
  playerId: string | null;
  /** Latest per-player filtered game state from the server. */
  gameState: GameState | null;
  /** Most recent `card_played` event (for transient UI/animation). */
  lastCardPlayed: CardPlayedMessage | null;
  /** Set when the game ends; carries the players who ran out of cards plus the winner. */
  gameEnded: { finishedPlayerIds: string[]; winnerId: string | null; winnerUsername: string | null } | null;
  error: string | null;

  connect(args: ConnectArgs): void;
  startGame(): void;
  setReady(ready: boolean): void;
  startPrep(): void;
  submitCards(statements: string[]): void;
  playCard(cardId: string, targetPlayerId: string): void;
  requestState(): void;
  exit(): void;
}

export type ConnectionFactory = (options: LobbyConnectionOptions) => LobbyConnection;

export interface GameStoreDeps {
  /** Overridable so tests can inject a connection backed by a fake socket. */
  connectionFactory?: ConnectionFactory;
}

const defaultConnectionFactory: ConnectionFactory = (options) =>
  new LobbyConnection(options);

/** Apply a server message to the store state. */
function reduce(
  set: (partial: Partial<GameStoreState>) => void,
  message: ServerMessage
): void {
  switch (message.type) {
    case 'connected':
      set({ playerId: message.playerId, lobbyCode: message.lobbyCode, error: null });
      return;
    case 'state_update':
      set({ gameState: message.state, error: null });
      return;
    case 'card_played':
      set({ lastCardPlayed: message });
      return;
    case 'game_ended':
      set({
        gameEnded: {
          finishedPlayerIds: message.finishedPlayerIds,
          winnerId: message.winnerId,
          winnerUsername: message.winnerUsername,
        },
      });
      return;
    case 'error':
      set({ error: message.message });
      return;
    // player_joined / game_started / pong are always followed by
    // a `state_update`, so no separate handling is needed.
    default:
      return;
  }
}

export function createGameStore(deps: GameStoreDeps = {}): StoreApi<GameStoreState> {
  const connectionFactory = deps.connectionFactory ?? defaultConnectionFactory;
  let connection: LobbyConnection | null = null;

  return createStore<GameStoreState>((set) => ({
    connectionStatus: 'idle',
    lobbyCode: null,
    playerId: null,
    gameState: null,
    lastCardPlayed: null,
    gameEnded: null,
    error: null,

    connect({ code, playerId, username }) {
      connection?.close();
      const conn = connectionFactory({ code, playerId, username });
      conn.onStatus((status) => set({ connectionStatus: status }));
      conn.onMessage((message) => reduce(set, message));
      connection = conn;
      set({
        lobbyCode: code,
        playerId,
        gameState: null,
        lastCardPlayed: null,
        gameEnded: null,
        error: null,
        connectionStatus: conn.getStatus(),
      });
      conn.connect();
    },

    startGame() {
      connection?.startGame();
    },

    setReady(ready) {
      connection?.setReady(ready);
    },

    startPrep() {
      connection?.startPrep();
    },

    submitCards(statements) {
      connection?.submitCards(statements);
    },

    playCard(cardId, targetPlayerId) {
      connection?.playCard(cardId, targetPlayerId);
    },

    requestState() {
      connection?.requestState();
    },

    exit() {
      connection?.close();
      connection = null;
      set({
        connectionStatus: 'idle',
        lobbyCode: null,
        gameState: null,
        lastCardPlayed: null,
        gameEnded: null,
        error: null,
      });
    },
  }));
}

/** Process-wide game store used by the app. */
export const gameStore = createGameStore();
