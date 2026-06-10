/// <reference types="@cloudflare/workers-types" />

/**
 * Per-user lobby history persisted in D1. The LobbyDO — the single owner of
 * every lobby status transition — records rows here; the Worker reads them for
 * the Home screen "your lobbies" list. Writes are best-effort: a failure must
 * never break gameplay (same posture as push notifications).
 *
 * Upserts use an UPDATE-then-INSERT pattern rather than `INSERT ... ON CONFLICT`
 * so they are correct whether or not the `(user_id, code)` unique index from
 * schema.sql is present. (The vitest-pool-workers test D1 omits that index: a
 * unique index on this table reproducibly trips the pool's isolated-storage
 * cleanup on Windows.)
 */

import {
  getLobbyMembers,
  type GameRoomState,
  type LobbyHistoryItem,
} from '@trap/shared';
import type { Env } from './env.js';

interface LobbyHistoryRow {
  id: string;
  code: string;
  status: string;
  owner_id: string | null;
  owner_username: string | null;
  player_count: number;
  created_at: string;
  joined_at: string;
}

/**
 * Record/refresh a history row for every user who has ever joined `room` (so a
 * later transition such as conclude also updates players who already left).
 * `joined_at` is set on first insert and preserved on subsequent updates.
 */
export async function recordLobbyHistory(
  env: Env,
  room: GameRoomState
): Promise<void> {
  try {
    const userIds = Object.keys(room.usernames);
    if (userIds.length === 0) return;

    const playerCount = getLobbyMembers(room).length;
    const ownerUsername = room.ownerId
      ? room.usernames[room.ownerId] ?? null
      : null;
    const now = new Date().toISOString();

    for (const userId of userIds) {
      const updated = await env.DB.prepare(
        `UPDATE lobby_history
            SET status = ?, owner_id = ?, owner_username = ?, player_count = ?
          WHERE user_id = ? AND code = ?`
      )
        .bind(
          room.status,
          room.ownerId,
          ownerUsername,
          playerCount,
          userId,
          room.lobbyCode
        )
        .run();

      if ((updated.meta.changes ?? 0) === 0) {
        await env.DB.prepare(
          `INSERT INTO lobby_history
             (id, code, user_id, status, owner_id, owner_username, player_count, created_at, joined_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            crypto.randomUUID(),
            room.lobbyCode,
            userId,
            room.status,
            room.ownerId,
            ownerUsername,
            playerCount,
            room.createdAt,
            now
          )
          .run();
      }
    }
  } catch {
    // Best-effort: history must never break gameplay.
  }
}

/** List a user's lobbies, most-recently-joined first. */
export async function listLobbyHistory(
  env: Env,
  userId: string
): Promise<LobbyHistoryItem[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, code, status, owner_id, owner_username, player_count, created_at, joined_at
       FROM lobby_history
      WHERE user_id = ?
      ORDER BY joined_at DESC
      LIMIT 50`
  )
    .bind(userId)
    .all<LobbyHistoryRow>();

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    status: r.status as LobbyHistoryItem['status'],
    ownerId: r.owner_id,
    ownerUsername: r.owner_username,
    playerCount: r.player_count,
    createdAt: r.created_at,
    joinedAt: r.joined_at,
  }));
}
