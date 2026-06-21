/**
 * Realtime lobby connection.
 *
 * Wraps PartySocket (which preserves reconnect/buffering) behind a small,
 * injectable socket interface so the message-dispatch logic is unit-testable
 * without a real WebSocket. Replaces the hand-rolled
 * `frontend/src/services/websocket.ts`.
 *
 * Wire details that matter:
 *  - the PartyServer party namespace is the kebab-case of the DO binding
 *    (`LOBBY` -> `lobby`), NOT the class name;
 *  - `playerId` / `username` travel as query params, read by `LobbyDO.onConnect`;
 *  - client messages use the camelCase `@trap/shared` contract.
 */

// Hermes (React Native) lacks the EventTarget/Event/ErrorEvent web globals that
// partysocket needs at module load; this conditional polyfill installs them and
// is a no-op where they already exist (browser/web build, Node/vitest). MUST be
// imported before partysocket. realtime.ts is the sole partysocket importer.
import 'partysocket/event-target-polyfill';
import PartySocket from 'partysocket';
import type { ClientMessage, ServerMessage } from '@trap/shared';
import { config } from './config';

/** PartyServer namespace for the lobby Durable Object (kebab of `LOBBY`). */
export const LOBBY_PARTY = 'lobby';

/** Minimal message event shape shared by PartySocket and test fakes. */
export interface RealtimeMessageEvent {
  data: string;
}

/** The slice of a (reconnecting) WebSocket the connection relies on. */
export interface RealtimeSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open', handler: () => void): void;
  addEventListener(type: 'close', handler: () => void): void;
  addEventListener(type: 'error', handler: (ev: unknown) => void): void;
  addEventListener(type: 'message', handler: (ev: RealtimeMessageEvent) => void): void;
}

export interface SocketFactoryArgs {
  host: string;
  party: string;
  room: string;
  query: Record<string, string>;
}

export type SocketFactory = (args: SocketFactoryArgs) => RealtimeSocket;

const defaultSocketFactory: SocketFactory = ({ host, party, room, query }) =>
  new PartySocket({ host, party, room, query }) as unknown as RealtimeSocket;

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface LobbyConnectionOptions {
  code: string;
  playerId: string;
  username: string;
  /** Override the PartySocket host (defaults to `config.partyHost`). */
  host?: string;
  /** Override the socket factory (tests inject a fake). */
  socketFactory?: SocketFactory;
}

type MessageHandler = (message: ServerMessage) => void;
type StatusHandler = (status: ConnectionStatus) => void;

/** Narrow an arbitrary parsed payload to a `ServerMessage`. */
function asServerMessage(value: unknown): ServerMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  return typeof (value as { type?: unknown }).type === 'string'
    ? (value as ServerMessage)
    : null;
}

export class LobbyConnection {
  private socket: RealtimeSocket | null = null;
  private status: ConnectionStatus = 'closed';
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly statusHandlers = new Set<StatusHandler>();

  constructor(private readonly options: LobbyConnectionOptions) {}

  /** Open the socket and begin dispatching messages. Idempotent. */
  connect(): void {
    if (this.socket) return;
    const factory = this.options.socketFactory ?? defaultSocketFactory;
    this.setStatus('connecting');
    this.socket = factory({
      host: this.options.host ?? config.partyHost,
      party: LOBBY_PARTY,
      room: this.options.code,
      query: { playerId: this.options.playerId, username: this.options.username },
    });

    this.socket.addEventListener('open', () => this.setStatus('open'));
    this.socket.addEventListener('close', () => this.setStatus('closed'));
    this.socket.addEventListener('message', (ev: RealtimeMessageEvent) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;
      }
      const message = asServerMessage(parsed);
      if (!message) return;
      for (const handler of this.messageHandlers) handler(message);
    });
  }

  /** Subscribe to server messages; returns an unsubscribe function. */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /** Subscribe to connection-status changes; returns an unsubscribe function. */
  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  private send(message: ClientMessage): void {
    this.socket?.send(JSON.stringify(message));
  }

  requestState(): void {
    this.send({ type: 'get_state' });
  }

  startGame(): void {
    this.send({ type: 'start_game' });
  }

  playCard(cardId: string, targetPlayerId: string): void {
    this.send({ type: 'play_card', cardId, targetPlayerId });
  }

  ping(): void {
    this.send({ type: 'ping' });
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
    this.setStatus('closed');
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const handler of this.statusHandlers) handler(status);
  }
}
