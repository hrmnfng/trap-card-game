/// <reference types="@cloudflare/workers-types" />

/**
 * LobbyDO - a single lobby/game room backed by a Cloudflare Durable Object.
 *
 * One Durable Object instance exists per lobby code. It:
 *  - persists the authoritative `GameRoomState` in DO storage (survives across
 *    days / hibernation), replacing the legacy Postgres event log;
 *  - manages realtime WebSocket connections via PartyServer, replacing the
 *    legacy in-memory ConnectionManager AND the Redis pub/sub fan-out (a single
 *    `broadcast` mechanism removes the prior dual-path drift);
 *  - applies the shared, pure game rules from `@trap/shared`;
 *  - triggers Expo push notifications for the three chosen events
 *    (card-played-targeting-you, player joined/left, game started/ended).
 */

import { Server, type Connection, type ConnectionContext } from 'partyserver';
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
  hasGameEnded,
  getFinishedPlayers,
  getWinner,
  type GameRoomState,
  type RuleDeps,
} from '@trap/shared';
import type { ServerMessage } from '@trap/shared';
import { parseClientMessage } from '@trap/shared';
import type { Env } from './env.js';
import { getDeviceTokensForUsers } from './auth.js';
import { recordLobbyHistory } from './history.js';
import { sendExpoPush } from './push.js';

const STATE_KEY = 'roomState';
const LOBBY_EXPIRATION_HOURS = 24;

/** Per-connection state we persist so it survives hibernation. */
interface ConnState {
  playerId: string;
  username: string;
}

export class LobbyDO extends Server<Env> {
  static override options = { hibernate: true };

  /** In-memory cache of the room state; source of truth is DO storage. */
  private room: GameRoomState | null = null;

  /** Rule deps backed by the runtime. */
  private deps(): RuleDeps {
    return {
      newId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    };
  }

  override async onStart(): Promise<void> {
    const stored = await this.ctx.storage.get<GameRoomState>(STATE_KEY);
    this.room = stored ?? null;
  }

  private async loadRoom(): Promise<GameRoomState | null> {
    if (this.room) return this.room;
    this.room = (await this.ctx.storage.get<GameRoomState>(STATE_KEY)) ?? null;
    return this.room;
  }

  private async saveRoom(next: GameRoomState): Promise<void> {
    this.room = next;
    await this.ctx.storage.put(STATE_KEY, next);
  }

  /**
   * Ensure the room exists. The DO `name` is the lobby code. The first time a
   * room is touched we lazily create its state (a lobby is "created" the moment
   * someone addresses it; the HTTP create route simply reserves a code).
   */
  private async ensureRoom(): Promise<GameRoomState> {
    const existing = await this.loadRoom();
    if (existing) return existing;
    const now = new Date();
    const expires = new Date(now.getTime() + LOBBY_EXPIRATION_HOURS * 3600 * 1000);
    const created = createRoomState({
      lobbyId: this.name,
      lobbyCode: this.name,
      now: now.toISOString(),
      expiresAt: expires.toISOString(),
    });
    await this.saveRoom(created);
    return created;
  }

  /* ----------------------------------------------------------------------- */
  /* HTTP (push/pull): create + read state                                   */
  /* ----------------------------------------------------------------------- */

  override async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // CORS: the web build calls the DO's /state pull route cross-origin (Expo
    // web on :8081 → Worker on :8787). The Worker's REST routes set these; the
    // DO's own responses must too, or the browser blocks the read.
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
      });

    // POST .../create  -> reserve/create the room
    if (request.method === 'POST' && url.pathname.endsWith('/create')) {
      const existing = await this.loadRoom();
      const room = existing ?? (await this.ensureRoom());
      return json({
        lobbyCode: room.lobbyCode,
        status: room.status,
        created: existing === null,
      });
    }

    // GET .../state?playerId=...  -> per-player filtered state
    if (request.method === 'GET' && url.pathname.endsWith('/state')) {
      const room = await this.loadRoom();
      if (!room) return json({ error: 'not_found' }, 404);
      const playerId = url.searchParams.get('playerId') ?? '';
      // HTTP pull read: no live WS context, so every player shows isOnline:false
      // (acceptable for a non-realtime state fetch).
      return json(getGameState(room, playerId));
    }

    return json({ error: 'method_not_allowed' }, 405);
  }

  /* ----------------------------------------------------------------------- */
  /* WebSocket lifecycle                                                     */
  /* ----------------------------------------------------------------------- */

  override async onConnect(
    connection: Connection<ConnState>,
    ctx: ConnectionContext
  ): Promise<void> {
    const url = new URL(ctx.request.url);
    const playerId = url.searchParams.get('playerId');
    const username = url.searchParams.get('username') ?? 'Player';

    if (!playerId) {
      this.sendTo(connection, {
        type: 'error',
        message: 'playerId is required',
        code: 'missing_player_id',
      });
      connection.close(4001, 'playerId required');
      return;
    }

    // The lobby must already exist (created via POST /api/lobbies). Connecting
    // to a code that was never created must NOT lazily mint a phantom lobby —
    // reject so a typed-in junk code can't create one.
    const existing = await this.loadRoom();
    if (!existing) {
      this.sendTo(connection, {
        type: 'error',
        message: 'No lobby found for that code',
        code: 'lobby_not_found',
      });
      connection.close(4004, 'lobby_not_found');
      return;
    }
    let room = existing;

    // Register the player (idempotent). New players are rejected with
    // joins_locked once the lobby has left waiting; existing members (including
    // into a concluded lobby) are admitted for read-only access.
    const wasNew = !room.usernames[playerId];
    const result = addPlayer(room, playerId, username, this.deps());
    if (!result.ok) {
      this.sendTo(connection, {
        type: 'error',
        message: result.error ?? 'join_failed',
        code: result.error,
      });
      connection.close(4002, result.error ?? 'join_failed');
      return;
    }
    room = result.state;
    await this.saveRoom(room);

    // Record the membership row before any state_update goes out: clients (and
    // the e2e suite) treat the first state_update as "the server has seen me in
    // this lobby", so the history row must already exist by then.
    if (wasNew) {
      await recordLobbyHistory(this.env, room);
    }

    connection.setState({ playerId, username });

    // Welcome + initial state.
    this.sendTo(connection, {
      type: 'connected',
      playerId,
      lobbyCode: room.lobbyCode,
    });
    this.sendTo(connection, {
      type: 'state_update',
      state: getGameState(room, playerId, this.onlinePlayerIds()),
    });

    if (wasNew) {
      this.broadcastMessage(
        { type: 'player_joined', playerId, username },
        [connection.id]
      );
      await this.notifyOthers(room, playerId, {
        title: 'Player joined',
        body: `${username} joined the lobby`,
        data: { kind: 'player_joined', lobbyCode: room.lobbyCode },
      });
      // Refresh everyone's state so counts reflect the new member.
      await this.broadcastState(room);
    }
  }

  override async onMessage(
    connection: Connection<ConnState>,
    raw: string | ArrayBuffer
  ): Promise<void> {
    const state = connection.state;
    if (!state) {
      this.sendTo(connection, { type: 'error', message: 'Not joined', code: 'not_joined' });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      this.sendTo(connection, { type: 'error', message: 'Invalid JSON', code: 'bad_json' });
      return;
    }

    const message = parseClientMessage(parsed);
    if (!message) {
      this.sendTo(connection, { type: 'error', message: 'Unknown message', code: 'unknown_message' });
      return;
    }

    let room = await this.ensureRoom();

    switch (message.type) {
      case 'ping':
        this.sendTo(connection, { type: 'pong' });
        return;

      case 'get_state':
        this.sendTo(connection, {
          type: 'state_update',
          state: getGameState(room, state.playerId, this.onlinePlayerIds()),
        });
        return;

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
          const winnerId = getWinner(concluded);
          this.broadcastMessage({
            type: 'game_ended',
            finishedPlayerIds: getFinishedPlayers(concluded),
            winnerId,
            winnerUsername: winnerId ? concluded.usernames[winnerId] ?? null : null,
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
    }
  }

  override async onClose(connection: Connection<ConnState>): Promise<void> {
    const state = connection.state;
    if (!state) return;
    // Membership is permanent — a closed socket is only a presence change.
    // Re-broadcast state so everyone sees the player go offline. No leave, no push.
    const room = await this.loadRoom();
    // Cloudflare excludes the closing WS from getConnections() before calling
    // onClose, so onlinePlayerIds() correctly omits the disconnecting player and
    // the broadcast reflects them as offline.
    if (room) await this.broadcastState(room);
  }

  /* ----------------------------------------------------------------------- */
  /* Broadcast helpers                                                       */
  /* ----------------------------------------------------------------------- */

  private sendTo(connection: Connection, message: ServerMessage): void {
    connection.send(JSON.stringify(message));
  }

  private broadcastMessage(message: ServerMessage, exclude: string[] = []): void {
    this.broadcast(JSON.stringify(message), exclude);
  }

  /** Player ids with at least one open connection right now. */
  private onlinePlayerIds(): Set<string> {
    const ids = new Set<string>();
    for (const c of this.getConnections<ConnState>()) {
      const pid = c.state?.playerId;
      if (pid) ids.add(pid);
    }
    return ids;
  }

  /** Send each connected player their own per-player filtered state. */
  private async broadcastState(room: GameRoomState): Promise<void> {
    const online = this.onlinePlayerIds();
    for (const connection of this.getConnections<ConnState>()) {
      const playerId = connection.state?.playerId;
      if (!playerId) continue;
      this.sendTo(connection, {
        type: 'state_update',
        state: getGameState(room, playerId, online),
      });
    }
  }

  /* ----------------------------------------------------------------------- */
  /* Push helpers                                                            */
  /* ----------------------------------------------------------------------- */

  private async notifyUsers(
    room: GameRoomState,
    userIds: string[],
    payload: { title: string; body: string; data?: Record<string, unknown> }
  ): Promise<void> {
    try {
      const tokens = await getDeviceTokensForUsers(this.env, userIds);
      await sendExpoPush(tokens, payload, { url: this.env.EXPO_PUSH_URL });
    } catch {
      // Push failures must never break gameplay.
    }
  }

  private async notifyOthers(
    room: GameRoomState,
    exceptUserId: string,
    payload: { title: string; body: string; data?: Record<string, unknown> }
  ): Promise<void> {
    const others = getLobbyMembers(room)
      .map((m) => m.playerId)
      .filter((id) => id !== exceptUserId);
    await this.notifyUsers(room, others, payload);
  }

  private async notifyAll(
    room: GameRoomState,
    payload: { title: string; body: string; data?: Record<string, unknown> }
  ): Promise<void> {
    const all = getLobbyMembers(room).map((m) => m.playerId);
    await this.notifyUsers(room, all, payload);
  }
}
