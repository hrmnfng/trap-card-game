import { describe, it, expect, vi } from 'vitest';
import {
  LobbyConnection,
  LOBBY_PARTY,
  type RealtimeSocket,
  type SocketFactory,
  type SocketFactoryArgs,
} from './realtime';
import type { ServerMessage } from '@trap/shared';

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
    emitClose: () => listeners['close']!.forEach((h) => h()),
    emitMessage: (msg: unknown) =>
      listeners['message']!.forEach((h) => h({ data: JSON.stringify(msg) })),
    emitRaw: (data: string) =>
      listeners['message']!.forEach((h) => h({ data })),
  };
}

function setup() {
  const fake = makeFakeSocket();
  let args: SocketFactoryArgs | undefined;
  const socketFactory: SocketFactory = (a) => {
    args = a;
    return fake.socket;
  };
  const conn = new LobbyConnection({
    code: 'ROOM1',
    playerId: 'p1',
    username: 'Alice',
    host: 'localhost:8787',
    socketFactory,
  });
  return { fake, conn, getArgs: () => args };
}

describe('LobbyConnection', () => {
  it('connects to the lobby party with playerId/username query params', () => {
    const { conn, getArgs } = setup();
    conn.connect();
    expect(getArgs()).toEqual({
      host: 'localhost:8787',
      party: LOBBY_PARTY,
      room: 'ROOM1',
      query: { playerId: 'p1', username: 'Alice' },
    });
  });

  it('is idempotent: a second connect() does not open a second socket', () => {
    const { conn, getArgs } = setup();
    conn.connect();
    const first = getArgs();
    conn.connect();
    expect(getArgs()).toBe(first);
  });

  it('parses and dispatches server messages to subscribers', () => {
    const { conn, fake } = setup();
    const received: ServerMessage[] = [];
    conn.onMessage((m) => received.push(m));
    conn.connect();

    fake.emitMessage({ type: 'connected', playerId: 'p1', lobbyCode: 'ROOM1' });
    fake.emitMessage({ type: 'pong' });

    expect(received).toEqual([
      { type: 'connected', playerId: 'p1', lobbyCode: 'ROOM1' },
      { type: 'pong' },
    ]);
  });

  it('ignores invalid JSON and payloads without a string type', () => {
    const { conn, fake } = setup();
    const received: ServerMessage[] = [];
    conn.onMessage((m) => received.push(m));
    conn.connect();

    fake.emitRaw('not json');
    fake.emitMessage(42);
    fake.emitMessage({ noType: true });

    expect(received).toEqual([]);
  });

  it('unsubscribe stops further delivery', () => {
    const { conn, fake } = setup();
    const received: ServerMessage[] = [];
    const off = conn.onMessage((m) => received.push(m));
    conn.connect();

    fake.emitMessage({ type: 'pong' });
    off();
    fake.emitMessage({ type: 'pong' });

    expect(received).toHaveLength(1);
  });

  it('serializes client messages onto the socket', () => {
    const { conn, fake } = setup();
    conn.connect();

    conn.requestState();
    conn.startGame();
    conn.playCard('card-9', 'p2');
    conn.ping();

    expect(fake.sent.map((s) => JSON.parse(s))).toEqual([
      { type: 'get_state' },
      { type: 'start_game' },
      { type: 'play_card', cardId: 'card-9', targetPlayerId: 'p2' },
      { type: 'ping' },
    ]);
  });

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

  it('tracks connection status through open/close', () => {
    const { conn, fake } = setup();
    const statuses: string[] = [];
    conn.onStatus((s) => statuses.push(s));

    conn.connect();
    expect(conn.getStatus()).toBe('connecting');
    fake.emitOpen();
    expect(conn.getStatus()).toBe('open');
    fake.emitClose();
    expect(conn.getStatus()).toBe('closed');

    expect(statuses).toEqual(['connecting', 'open', 'closed']);
  });

  it('close() closes the socket and reports closed status', () => {
    const { conn, fake } = setup();
    conn.connect();
    conn.close();
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(conn.getStatus()).toBe('closed');
  });

  // I7: a Worker that never accepts the socket (wrong host, server down) should
  // surface an actionable status rather than spinning on 'connecting' forever.
  it('surfaces "unreachable" if no open arrives within the connect timeout', () => {
    vi.useFakeTimers();
    try {
      const { conn } = setup();
      const statuses: string[] = [];
      conn.onStatus((s) => statuses.push(s));

      conn.connect();
      expect(conn.getStatus()).toBe('connecting');
      vi.advanceTimersByTime(8000);

      expect(statuses).toContain('unreachable');
      expect(conn.getStatus()).toBe('unreachable');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not flip to "unreachable" when open arrives before the timeout', () => {
    vi.useFakeTimers();
    try {
      const { conn, fake } = setup();
      conn.connect();
      fake.emitOpen();
      vi.advanceTimersByTime(8000);
      expect(conn.getStatus()).toBe('open');
    } finally {
      vi.useRealTimers();
    }
  });
});
