# Lobby History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Repo policy (overrides the skill's commit steps):** `CLAUDE.md` says *never commit without explicit user approval*. Do the `git add`/`git commit` steps only after the user approves; otherwise leave changes staged-but-uncommitted and ask.

**Goal:** Show each authenticated user their lobbies (active + concluded) on the Home screen, populated from D1 by the Durable Object that owns every lobby status transition.

**Architecture:** The `LobbyDO` upserts a `lobby_history` row per participating user at join / start / conclude (it already holds `env.DB` and treats `playerId` as the user id). The Worker exposes a read-only `GET /api/lobbies/history`. The Expo Home screen fetches and lists them. No game-rule changes — history is infrastructure.

**Tech Stack:** TypeScript, npm workspaces, Cloudflare Workers + D1, PartyServer DO, Vitest (`@cloudflare/vitest-pool-workers`), Expo / React Native.

Spec: `docs/superpowers/specs/2026-06-10-lobby-history-design.md`

---

### Task 1: Add the `LobbyHistoryItem` shared type

**Files:**
- Modify: `packages/shared/src/types.ts`
- (auto-exported: `packages/shared/src/index.ts` already does `export * from './types.js'`)

- [ ] **Step 1: Add the type.** Append to `packages/shared/src/types.ts` (after the existing lobby/game types):

```ts
/** Per-user summary of a lobby they participated in (for the Home list). */
export interface LobbyHistoryItem {
  code: string;
  status: LobbyStatus; // 'waiting' | 'in-progress' | 'concluded'
  ownerId: string | null;
  ownerUsername: string | null;
  playerCount: number;
  createdAt: string; // ISO-8601
  joinedAt: string; // ISO-8601
}
```

- [ ] **Step 2: Typecheck.**

Run: `npm run typecheck`
Expected: PASS (shared builds; `LobbyStatus` is already defined in this file).

- [ ] **Step 3: Commit (after approval).**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add LobbyHistoryItem type"
```

---

### Task 2: Add the `UNIQUE(user_id, code)` index to the test D1 setup

**Why:** `test/setup.ts` creates `lobby_history` without indexes, but Task 3's `ON CONFLICT(user_id, code)` upsert requires a unique index on those columns. `schema.sql` already has it; the test setup must match.

**Files:**
- Modify: `apps/party/test/setup.ts`

- [ ] **Step 1: Add the index statements.** In `SCHEMA_STATEMENTS`, after the `lobby_history` `CREATE TABLE` entry, add two more statements to the array:

```ts
  `CREATE INDEX IF NOT EXISTS idx_lobby_history_user ON lobby_history(user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_lobby_history_user_code ON lobby_history(user_id, code)`,
```

- [ ] **Step 2: Verify existing party tests still pass.**

Run: `npm run test:party`
Expected: PASS (27 passed / 4 skipped — unchanged).

- [ ] **Step 3: Commit (after approval).**

```bash
git add apps/party/test/setup.ts
git commit -m "test(party): add lobby_history unique index to test schema"
```

---

### Task 3: Implement `history.ts` (record + list) with unit tests

**Files:**
- Create: `apps/party/src/history.ts`
- Test: `apps/party/test/history.test.ts`

- [ ] **Step 1: Write the failing test.** Create `apps/party/test/history.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import {
  addPlayer,
  createRoomState,
  removePlayer,
  type GameRoomState,
  type RuleDeps,
} from '@trap/shared';
import type { Env } from '../src/env.js';
import { recordLobbyHistory, listLobbyHistory } from '../src/history.js';

const testEnv = env as unknown as Env;

let seq = 0;
const deps: RuleDeps = {
  newId: () => `id-${seq++}`,
  randomCardValue: () => 5,
  now: () => new Date().toISOString(),
};

function newRoom(code: string): GameRoomState {
  return createRoomState({
    lobbyId: code,
    lobbyCode: code,
    now: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
}

/** Add two players; first (p1) becomes owner. */
function roomWithTwo(code: string): GameRoomState {
  let room = newRoom(code);
  room = addPlayer(room, 'p1', 'Alice', deps).state;
  room = addPlayer(room, 'p2', 'Bob', deps).state;
  return room;
}

describe('lobby history persistence', () => {
  it('records a waiting row for every member', async () => {
    const room = roomWithTwo('AAA111');
    await recordLobbyHistory(testEnv, room);

    const alice = await listLobbyHistory(testEnv, 'p1');
    expect(alice).toHaveLength(1);
    expect(alice[0]).toMatchObject({
      code: 'AAA111',
      status: 'waiting',
      ownerId: 'p1',
      ownerUsername: 'Alice',
      playerCount: 2,
    });
    const bob = await listLobbyHistory(testEnv, 'p2');
    expect(bob[0]?.code).toBe('AAA111');
  });

  it('updates status to concluded for a player who already left', async () => {
    let room = roomWithTwo('BBB222');
    await recordLobbyHistory(testEnv, room); // waiting
    room = removePlayer(room, 'p2', deps); // p2 leaves (still in usernames)
    room = { ...room, status: 'concluded' };
    await recordLobbyHistory(testEnv, room);

    const bob = await listLobbyHistory(testEnv, 'p2');
    expect(bob).toHaveLength(1);
    expect(bob[0]?.status).toBe('concluded');
    // p2 is no longer a current member, so the count reflects who remains.
    expect(bob[0]?.playerCount).toBe(1);
  });

  it('preserves joined_at across updates', async () => {
    const room = roomWithTwo('CCC333');
    await recordLobbyHistory(testEnv, room);
    const first = (await listLobbyHistory(testEnv, 'p1'))[0]!;
    await recordLobbyHistory(testEnv, { ...room, status: 'in-progress' });
    const second = (await listLobbyHistory(testEnv, 'p1'))[0]!;
    expect(second.status).toBe('in-progress');
    expect(second.joinedAt).toBe(first.joinedAt);
  });

  it('lists multiple lobbies for a user, newest first, camelCase mapped', async () => {
    await recordLobbyHistory(testEnv, roomWithTwo('DDD444'));
    await new Promise((r) => setTimeout(r, 5));
    await recordLobbyHistory(testEnv, roomWithTwo('EEE555'));

    const list = await listLobbyHistory(testEnv, 'p1');
    expect(list.map((l) => l.code)).toEqual(['EEE555', 'DDD444']);
    expect(list[0]).toHaveProperty('ownerUsername', 'Alice');
    expect(list[0]).toHaveProperty('createdAt');
    expect(list[0]).toHaveProperty('joinedAt');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npm run test:party -- history`
Expected: FAIL — `Cannot find module '../src/history.js'`.

- [ ] **Step 3: Implement `history.ts`.** Create `apps/party/src/history.ts`:

```ts
/// <reference types="@cloudflare/workers-types" />

/**
 * Per-user lobby history persisted in D1. The LobbyDO — the single owner of
 * every lobby status transition — upserts rows here; the Worker reads them for
 * the Home screen "your lobbies" list. Writes are best-effort: a failure must
 * never break gameplay (same posture as push notifications).
 */

import {
  getLobbyMembers,
  type GameRoomState,
  type LobbyHistoryItem,
} from '@trap/shared';
import type { Env } from './env.js';

interface LobbyHistoryRow {
  code: string;
  status: string;
  owner_id: string | null;
  owner_username: string | null;
  player_count: number;
  created_at: string;
  joined_at: string;
}

/**
 * Upsert a row for every user who has ever joined `room` (so a later transition
 * such as conclude also updates players who already left). `joined_at` is set on
 * insert and preserved on conflict.
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

    const stmt = env.DB.prepare(
      `INSERT INTO lobby_history
         (id, code, user_id, status, owner_id, owner_username, player_count, created_at, joined_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, code) DO UPDATE SET
         status = excluded.status,
         owner_id = excluded.owner_id,
         owner_username = excluded.owner_username,
         player_count = excluded.player_count`
    );

    const batch = userIds.map((userId) =>
      stmt.bind(
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
    );
    await env.DB.batch(batch);
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
    `SELECT code, status, owner_id, owner_username, player_count, created_at, joined_at
       FROM lobby_history
      WHERE user_id = ?
      ORDER BY joined_at DESC
      LIMIT 50`
  )
    .bind(userId)
    .all<LobbyHistoryRow>();

  return results.map((r) => ({
    code: r.code,
    status: r.status as LobbyHistoryItem['status'],
    ownerId: r.owner_id,
    ownerUsername: r.owner_username,
    playerCount: r.player_count,
    createdAt: r.created_at,
    joinedAt: r.joined_at,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npm run test:party -- history`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck the workspace.**

Run: `npm run typecheck --workspace=@trap/party`
Expected: PASS.

- [ ] **Step 6: Commit (after approval).**

```bash
git add apps/party/src/history.ts apps/party/test/history.test.ts
git commit -m "feat(party): persist and query per-user lobby history in D1"
```

---

### Task 4: Wire `recordLobbyHistory` into the `LobbyDO`

**Files:**
- Modify: `apps/party/src/LobbyDO.ts`

**Note on testing:** The DO's join/start/conclude paths run over WebSockets, which segfault in this repo's pinned vitest workers pool (the 4 `.skip`ped WS tests). So this wiring is covered by Task 3's direct `history.ts` tests + typecheck here, and validated end-to-end via the `tmp/e2e-ws.mjs` harness / manual A4 run. Do not add a WS integration test for it.

- [ ] **Step 1: Import the recorder.** Add to the imports block of `apps/party/src/LobbyDO.ts` (next to `import { sendExpoPush } from './push.js';`):

```ts
import { recordLobbyHistory } from './history.js';
```

- [ ] **Step 2: Record on new-player join.** In `onConnect`, inside the `if (wasNew) { ... }` block, after `await this.broadcastState(room);`, add:

```ts
      await recordLobbyHistory(this.env, room);
```

- [ ] **Step 3: Record on game start.** In `onMessage`, `case 'start_game'`, after `await this.broadcastState(room);` and before `await this.notifyAll(...)`, add:

```ts
        await recordLobbyHistory(this.env, room);
```

- [ ] **Step 4: Record on conclude.** In `onMessage`, `case 'play_card'`, inside the `if (hasGameEnded(room)) { ... }` block, after `await this.broadcastState(concluded);`, add:

```ts
          await recordLobbyHistory(this.env, concluded);
```

- [ ] **Step 5: Typecheck + full party suite.**

Run: `npm run typecheck --workspace=@trap/party && npm run test:party`
Expected: PASS (typecheck clean; 31 party tests = 27 passed + 4 skipped, plus Task 3's 4 = 35 collected; all green/ skipped unchanged).

- [ ] **Step 6: Commit (after approval).**

```bash
git add apps/party/src/LobbyDO.ts
git commit -m "feat(party): record lobby history on join, start, and conclude"
```

---

### Task 5: Add the `GET /api/lobbies/history` Worker route + integration test

**Files:**
- Modify: `apps/party/src/server.ts`
- Test: `apps/party/test/lobby.integration.test.ts`

- [ ] **Step 1: Write the failing test.** Append a new `describe` block to `apps/party/test/lobby.integration.test.ts` (after the `CORS preflight` block). It registers a user (yielding a real token + userId), seeds a row via `recordLobbyHistory`, then reads it back over HTTP:

```ts
describe('GET /api/lobbies/history', () => {
  it('returns the authenticated user\'s lobbies', async () => {
    // Register to obtain a real token + userId.
    const reg = await SELF.fetch('https://do/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'historian', password: 'password1' }),
    });
    expect(reg.status).toBe(200);
    const { userId, token } = (await reg.json()) as {
      userId: string;
      token: string;
    };

    // Seed a history row for this user via the recorder.
    const room = createRoomState({
      lobbyId: 'HIST01',
      lobbyCode: 'HIST01',
      now: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const joined = addPlayer(room, userId, 'historian', {
      newId: () => crypto.randomUUID(),
      randomCardValue: () => 5,
      now: () => new Date().toISOString(),
    }).state;
    await recordLobbyHistory(testEnv, joined);

    const res = await SELF.fetch('https://do/api/lobbies/history', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lobbies: Array<{ code: string; status: string }> };
    expect(body.lobbies).toHaveLength(1);
    expect(body.lobbies[0]).toMatchObject({ code: 'HIST01', status: 'waiting' });
  });

  it('rejects an unauthenticated request', async () => {
    const res = await SELF.fetch('https://do/api/lobbies/history');
    expect(res.status).toBe(401);
  });
});
```

Also add to the existing imports at the top of the file (the `@trap/shared` import currently brings in `ServerMessage`):

```ts
import { addPlayer, createRoomState } from '@trap/shared';
import { recordLobbyHistory } from '../src/history.js';
```

(`testEnv` is already defined in this file as the `env` alias used by `getServerByName`. If it is named differently, use the existing alias.)

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npm run test:party -- lobby.integration`
Expected: FAIL — the history request returns 404 (`not_found`) because the route does not exist yet, so the `200`/`toHaveLength(1)` assertion fails.

- [ ] **Step 3: Add the route.** In `apps/party/src/server.ts`, add the import near the other imports:

```ts
import { listLobbyHistory } from './history.js';
```

Then add this handler **before** the `// ---- Lobby create ----` block (so the more specific path is matched before any catch-alls):

```ts
    // ---- Lobby history -------------------------------------------------
    if (url.pathname === '/api/lobbies/history' && request.method === 'GET') {
      const token = extractBearer(request.headers.get('Authorization'));
      const user = await getUserFromToken(env, token);
      if (!user) return json({ error: 'unauthorized' }, 401);
      return json({ lobbies: await listLobbyHistory(env, user.userId) });
    }
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npm run test:party -- lobby.integration`
Expected: PASS (both new tests + the existing HTTP/CORS tests).

- [ ] **Step 5: Typecheck + full party suite.**

Run: `npm run typecheck --workspace=@trap/party && npm run test:party`
Expected: PASS.

- [ ] **Step 6: Commit (after approval).**

```bash
git add apps/party/src/server.ts apps/party/test/lobby.integration.test.ts
git commit -m "feat(party): add GET /api/lobbies/history endpoint"
```

---

### Task 6: Add `apiClient.listLobbyHistory` (mobile) with a test

**Files:**
- Modify: `apps/mobile/src/lib/apiClient.ts`
- Test: `apps/mobile/src/lib/apiClient.test.ts`

- [ ] **Step 1: Write the failing test.** Add to `apps/mobile/src/lib/apiClient.test.ts` inside the `describe('ApiClient', ...)` block:

```ts
  it('listLobbyHistory GETs the history route and returns the lobbies array', async () => {
    const lobbies = [
      {
        code: 'ABC123',
        status: 'in-progress',
        ownerId: 'u1',
        ownerUsername: 'alice',
        playerCount: 2,
        createdAt: '2026-06-10T00:00:00.000Z',
        joinedAt: '2026-06-10T00:01:00.000Z',
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ lobbies }));
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      fetchImpl,
      getToken: () => 'tok',
    });

    const res = await api.listLobbyHistory();

    expect(res).toEqual(lobbies);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.test/api/lobbies/history');
    expect((init as RequestInit).method).toBe('GET');
    expect(headersOf(init as RequestInit)['Authorization']).toBe('Bearer tok');
  });
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npm run test --workspace=@trap/mobile -- apiClient`
Expected: FAIL — `api.listLobbyHistory is not a function`.

- [ ] **Step 3: Implement the method.** In `apps/mobile/src/lib/apiClient.ts`, extend the type import and add the method.

Change the shared import to include the new type:

```ts
import type { AuthResponse, DevicePlatform, LobbyHistoryItem, User } from '@trap/shared';
```

Add this method to the `ApiClient` class (e.g. after `createLobby`):

```ts
  listLobbyHistory(): Promise<LobbyHistoryItem[]> {
    return this.request<{ lobbies: LobbyHistoryItem[] }>(
      '/api/lobbies/history',
      { method: 'GET' },
      true
    ).then((r) => r.lobbies);
  }
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npm run test --workspace=@trap/mobile -- apiClient`
Expected: PASS.

- [ ] **Step 5: Typecheck.**

Run: `npm run typecheck --workspace=@trap/mobile`
Expected: PASS.

- [ ] **Step 6: Commit (after approval).**

```bash
git add apps/mobile/src/lib/apiClient.ts apps/mobile/src/lib/apiClient.test.ts
git commit -m "feat(mobile): add listLobbyHistory API client method"
```

---

### Task 7: Show "Your lobbies" on the Home screen

**Files:**
- Modify: `apps/mobile/app/index.tsx`

**Note on testing:** This is presentational React Native wired to `api.listLobbyHistory` (covered by Task 6). There is no RN component test harness in this repo, so verify by typecheck + the manual A4 run. Keep logic trivial (no derived state worth a unit test).

- [ ] **Step 1: Implement the list.** Edit `apps/mobile/app/index.tsx`:

(a) Extend imports:

```ts
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { LobbyHistoryItem } from '@trap/shared';
```

(Merge `useState` with the existing `react` import and `FlatList`/`ActivityIndicator` with the existing `react-native` import rather than duplicating.)

(b) Inside `HomeScreen`, after the existing `const [creating, setCreating] = useState(false);`, add history state + a focus-driven fetch:

```ts
  const [history, setHistory] = useState<LobbyHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) return;
      let active = true;
      setLoadingHistory(true);
      api
        .listLobbyHistory()
        .then((items) => {
          if (active) setHistory(items);
        })
        .catch(() => {
          if (active) setHistory([]);
        })
        .finally(() => {
          if (active) setLoadingHistory(false);
        });
      return () => {
        active = false;
      };
    }, [isAuthenticated])
  );

  const openLobby = (item: LobbyHistoryItem) => {
    if (item.status === 'concluded') return;
    router.push(`/lobby/${item.code}`);
  };
```

(c) In the authenticated `return (...)`, insert a history section between the "Create lobby" `Pressable` and the `joinRow` `View`:

```tsx
      <Text style={styles.sectionLabel}>Your lobbies</Text>
      {loadingHistory ? (
        <ActivityIndicator color={colors.muted} />
      ) : history.length === 0 ? (
        <Text style={styles.subtle}>No lobbies yet — create or join one below.</Text>
      ) : (
        <FlatList
          style={styles.list}
          data={history}
          keyExtractor={(item) => item.code}
          renderItem={({ item }) => (
            <Pressable
              style={styles.lobbyRow}
              onPress={() => openLobby(item)}
              disabled={item.status === 'concluded'}
            >
              <Text style={styles.lobbyCode}>{item.code}</Text>
              <Text style={styles.lobbyMeta}>
                {item.status} · {item.playerCount} player
                {item.playerCount === 1 ? '' : 's'}
                {item.ownerUsername ? ` · host ${item.ownerUsername}` : ''}
              </Text>
            </Pressable>
          )}
        />
      )}
```

(d) Add the referenced styles to the `StyleSheet.create({ ... })` object:

```ts
  sectionLabel: { color: colors.text, fontSize: 16, fontWeight: '600', marginTop: 8 },
  list: { flexGrow: 0, maxHeight: 240 },
  lobbyRow: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lobbyCode: { color: colors.text, fontSize: 16, fontWeight: '600', letterSpacing: 1 },
  lobbyMeta: { color: colors.muted, fontSize: 13, marginTop: 2 },
```

- [ ] **Step 2: Typecheck.**

Run: `npm run typecheck --workspace=@trap/mobile`
Expected: PASS.

- [ ] **Step 3: Mobile health check.**

Run (from `apps/mobile`): `npx expo-doctor`
Expected: 18/18 (or unchanged from baseline).

- [ ] **Step 4: Manual verification (A4 addendum).**
  - Log in; create a lobby → it appears under "Your lobbies" as `waiting`.
  - Log out and back in → the lobby is still listed (no manual code entry).
  - Tap it → rejoins `/lobby/<code>`.
  - Start the game (2 players) → row shows `in-progress` on return to Home.
  - Play it to the end → row shows `concluded` and is not tappable.

- [ ] **Step 5: Commit (after approval).**

```bash
git add apps/mobile/app/index.tsx
git commit -m "feat(mobile): list your lobbies on Home with rejoin"
```

---

### Task 8: Update the remaining-work plan

**Files:**
- Modify: `plans/remaining-work.md`

- [ ] **Step 1: Note the feature.** Under Phase A (or a new "Feature gaps found during validation" note), record that lobby history was implemented (DO → D1 → `GET /api/lobbies/history` → Home list), with a pointer to `docs/superpowers/specs/2026-06-10-lobby-history-design.md`. Keep it to a few lines consistent with the file's style.

- [ ] **Step 2: Full test sweep.**

Run: `npm test`
Expected: shared + party + mobile all green (party 4 skipped unchanged).

- [ ] **Step 3: Commit (after approval).**

```bash
git add plans/remaining-work.md
git commit -m "docs: record lobby-history feature in remaining-work plan"
```

---

## Self-Review

- **Spec coverage:**
  - `recordLobbyHistory` (upsert-all-members, preserve `joined_at`, best-effort) → Task 3.
  - `listLobbyHistory` (order/limit/camelCase) → Task 3.
  - DO writes at join/start/conclude → Task 4.
  - `LobbyHistoryItem` type → Task 1.
  - `GET /api/lobbies/history` (bearer, 401, `{ lobbies }`) → Task 5.
  - `apiClient.listLobbyHistory` → Task 6.
  - Home "Your lobbies" list, rejoin, concluded-not-tappable, join-box fallback → Task 7.
  - Tests (party unit + HTTP integration; mobile apiClient) → Tasks 3, 5, 6.
  - Known limitation comment (24h expiry) → carried as the design's note; not a task (no code path to guard in v1).
  - **Added beyond spec:** Task 2 (unique index in test setup) — required for `ON CONFLICT` to work in tests; Task 8 (update remaining-work doc).
- **Placeholder scan:** none — every code/test step has concrete content.
- **Type consistency:** `LobbyHistoryItem` fields (`code/status/ownerId/ownerUsername/playerCount/createdAt/joinedAt`) are identical across Tasks 1, 3, 5, 6, 7. `recordLobbyHistory(env, room)` and `listLobbyHistory(env, userId)` signatures match between definition (Task 3) and callers (Tasks 4, 5). SQL columns match `schema.sql` and `test/setup.ts`.
