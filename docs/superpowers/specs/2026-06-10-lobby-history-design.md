# Lobby History — Design

**Date:** 2026-06-10
**Status:** Approved (pending spec review)
**Area:** `apps/party` (Worker + `LobbyDO`), `packages/shared`, `apps/mobile`

## Problem

After logging back in, a user has no way to see lobbies they're part of — they must
manually type a lobby code. The D1 schema already defines a `lobby_history` table
("per-user summaries of lobbies they participated in"), but **nothing writes to or reads
it**. The legacy Vue frontend had `GET /api/lobbies/history`; the feature was dropped in
the Expo + Cloudflare migration and never re-implemented.

This is a missing feature, not a regression.

## Goal

On the Home screen, show the authenticated user a list of their lobbies — both **active**
(rejoinable: `waiting` / `in-progress`) and **past** (`concluded`) — with status kept
fresh as the game progresses. Tapping an active lobby rejoins it.

## Key facts that shaped the design

- The client connects with `connect({ code, playerId: userId, username })`, so
  **`playerId` IS the authenticated user id** (push lookups already rely on this:
  `getDeviceTokensForUsers(env, [playerId])`).
- The `LobbyDO` already holds `this.env.DB` (the D1 binding) and is the single place where
  every status transition happens: create (`waiting`), `start_game` (`in-progress`), and
  game conclude (`concluded`).
- The schema has `lobby_history` with a `UNIQUE(user_id, code)` index — built for upserts.

## Approach (chosen: "DO is the history writer")

The Durable Object writes/updates `lobby_history` at the lifecycle points it already
handles. The Worker exposes a read-only list endpoint. Because the DO owns every
transition, status stays correct with **zero client trust**.

Rejected alternatives:
- **Worker/client-driven writes:** status freshness would depend on the client still being
  connected at game conclude (often it isn't), so "past games" would show stale
  `in-progress`.
- **Derive on read (no table):** no way to find "which lobbies was this user in" without
  scanning every Durable Object. This is why the `lobby_history` table exists.

## Components & data flow

### `apps/party/src/history.ts` (new)

- `recordLobbyHistory(env, room): Promise<void>`
  - Upserts a row for **every user who has ever joined** the room
    (`Object.keys(room.usernames)`), so a conclude also updates the rows of players who
    already left.
  - Columns set: `status` (= `room.status`), `owner_id`, `owner_username`
    (`room.usernames[room.ownerId]`), `player_count` (current member count via
    `getLobbyMembers(room).length`), `created_at` (`room.createdAt`).
  - `joined_at` is set on insert and **preserved** on conflict (it represents first entry).
  - SQL: `INSERT INTO lobby_history (...) VALUES (...) ON CONFLICT(user_id, code) DO UPDATE
    SET status=excluded.status, owner_id=excluded.owner_id,
    owner_username=excluded.owner_username, player_count=excluded.player_count`.
  - `id`: `crypto.randomUUID()` for the insert path (unused on update).
  - Wrapped in try/catch — a history write must **never** break gameplay (same posture as
    push notifications).
- `listLobbyHistory(env, userId): Promise<LobbyHistoryItem[]>`
  - `SELECT code, status, owner_id, owner_username, player_count, created_at, joined_at
    FROM lobby_history WHERE user_id = ? ORDER BY joined_at DESC LIMIT 50`, mapped to
    camelCase.

### `apps/party/src/LobbyDO.ts`

Calls `await recordLobbyHistory(this.env, room)` after:
1. a **new** player joins (`onConnect`, `wasNew` branch, after `saveRoom`),
2. `start_game` succeeds (after the room becomes `in-progress`),
3. game conclude (after the room is saved as `concluded`).

No change to `onClose`/leave: leaving does not delete history (it's history).

### `packages/shared` contract

New type in `types.ts`:

```ts
export interface LobbyHistoryItem {
  code: string;
  status: LobbyStatus;        // 'waiting' | 'in-progress' | 'concluded'
  ownerId: string | null;
  ownerUsername: string | null;
  playerCount: number;
  createdAt: string;          // ISO-8601
  joinedAt: string;           // ISO-8601
}
```

No game-rule changes — history is infrastructure, not rules.

### Worker route (`apps/party/src/server.ts`)

`GET /api/lobbies/history` (bearer auth):
- Resolve user via `getUserFromToken`; 401 if absent.
- Return `json({ lobbies: await listLobbyHistory(env, user.userId) })`.

### Client (`apps/mobile`)

- `apiClient.ts`: `listLobbyHistory(): Promise<LobbyHistoryItem[]>` →
  `GET /api/lobbies/history` (authenticated), returning `body.lobbies`.
- Home screen (`app/index.tsx`): a "Your lobbies" section above the join-code box, fetched
  when the screen gains focus and the user is authenticated.
  - Row shows: code, status badge (`waiting` / `in-progress` / `concluded`), player count,
    host name.
  - Tapping a `waiting` / `in-progress` row → `router.push('/lobby/<code>')` (the lobby
    screen forwards to `/game/<code>` when the state is `in-progress`).
  - `concluded` rows are shown but not tappable.
  - The manual join-code box remains as a fallback.

## Error handling

- History writes in the DO are best-effort (try/catch, swallowed) so they never affect
  gameplay or the WebSocket lifecycle.
- The list endpoint returns 401 without a valid token; an empty history returns
  `{ lobbies: [] }`.
- Client: a failed history fetch surfaces a non-blocking empty/“couldn’t load” state; it
  must not block creating or joining a lobby.

## Testing

- **party (`apps/party/test/`):**
  - Unit-test `history.ts` against the test D1 (tables already created in `test/setup.ts`):
    assert rows transition `waiting → in-progress → concluded`; assert a player who left
    before conclude still ends with a `concluded` row; assert `joined_at` is preserved
    across updates; assert `listLobbyHistory` ordering/limit and camelCase mapping.
  - `GET /api/lobbies/history` test via `SELF.fetch` (HTTP path — not affected by the WS
    test-pool segfault).
- **mobile (`apps/mobile/src/lib/apiClient.test.ts`):**
  - `listLobbyHistory` issues `GET /api/lobbies/history` with the bearer header and returns
    the mapped `lobbies` array.

## Known limitation (v1, intentional)

A `waiting` lobby older than the DO's 24h expiration could still appear "rejoinable." Low
impact — reconnecting simply re-creates/normalizes the room. Left as a code comment; not
handled in v1.

## Out of scope

- Match outcomes / per-player win-loss records (the chosen scope is status, not results).
- Pagination beyond a fixed `LIMIT 50`.
- Deleting/hiding history entries from the UI.
