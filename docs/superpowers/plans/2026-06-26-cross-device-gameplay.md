# Cross-Device Gameplay Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ## ⏸ Resumption status (updated 2026-06-26)
>
> Executed via subagent-driven development, per-task TDD (each task: red→green, lint + typecheck, commit). **Tasks 1–6 are DONE, reviewed, and committed; the shared, party, and mobile-store layers are green.** Remaining: Tasks 7–11.
>
> **Done (commits on `feat/user-authored-trap-cards`):**
> - Task 1 — shared: permanent membership, remove `leave`/`removePlayer` — `1def97c` (+ fix `835af1f`: existing members reconnect at capacity)
> - Task 2 — shared: live presence `isOnline` — `a2a2618`
> - Task 3 — shared: lock new joins after `waiting`; submit only in `prep` — `0c3f1db` (+ doc `0c528fd`)
> - Task 4 — shared: winner (first to empty); drop `player_left` message — `b5f9bec`
> - Task 5 — party DO: `onClose` presence-only, online-set threading, join lock, winner on `game_ended` — `05dd32e` (+ comments `9e24d4e`)
> - Task 6 — mobile store: `exit()` rename, winner passthrough, drop `player_left`, clear `error` on valid state — `daf0129`
>
> All three workspaces currently: `@trap/shared` green (47 tests), `@trap/party` green (45 pass / 6 WS-skip), `@trap/mobile` green (38 tests, typecheck clean).
>
> **Remaining (NOT started):**
> - **Task 7** — mobile UI: presence dots (lobby/prep), winner banner + read-only-concluded game screen (I12), derive end view from `status === 'concluded'` + `winnerId` (not the transient `gameEnded` flag).
> - **Task 8** — I6 regression test (error clears on next valid state — the logic already landed in Task 6; this just adds the dedicated test).
> - **Task 9** — I7: `unreachable` connection status via an 8s connect timeout in `realtime.ts` + friendlier lobby status text.
> - **Task 10** — I10′: shared `Screen` safe-area wrapper applied to all 5 routes.
> - **Task 11** — tier-3 validation: Android Maestro device gate + two-device LAN matrix (esp. reconnection rows R2–R4, winner R7, safe-area R8). Web e2e (`apps/mobile/e2e/multiplayer.spec.ts`) should also be extended to assert no membership loss on reconnect + winner shown.
>
> **Known minor follow-ups (non-blocking):** Task 6 left two slightly redundant store tests and `exit()` doesn't reset `playerId` (pre-existing). Task 4 left `winnerUsername` without a JSDoc line. Optional cleanup.
>
> **Out of scope this round (documented):** I2 (deploy/Phase B), I9 (push/Dev Build — un-testable on LAN+Expo Go), I5 (owner-offline stall), 7-day lobby-inactivity expiry.

**Goal:** Make two clients play a full trap-card game across realistic mobile lifecycle (background, force-quit, re-entry) without losing players, spamming "left" events, getting stuck, or ending with no result — by correcting the membership/presence model and closing the P0+P1 gameplay gaps.

**Architecture:** Event-sourced rules in `@trap/shared` stay the single source of truth. Membership becomes **permanent** (the `leave` concept is removed); **presence** ("online") is derived live from open WebSocket connections at broadcast time; lobbies **lock to new joiners** once they leave `waiting`; the game exposes a **winner** (first to empty hand). The Durable Object and Expo client are rewired to match, plus client-only fixes for transient errors, connect timeouts, and safe-area layout.

**Tech Stack:** TypeScript, npm workspaces, `@trap/shared` (pure rules), Cloudflare Workers + PartyServer Durable Object (`apps/party`), Expo / React Native + Zustand + expo-router (`apps/mobile`), Vitest, Playwright, Maestro.

**Specs:**
- `docs/superpowers/specs/2026-06-26-cross-device-gameplay-validation-design.md` (validation / red gate)
- `docs/superpowers/specs/2026-06-26-cross-device-gameplay-fixes-design.md` (fix design)

**Working principle (non-negotiable):** Per-issue TDD. Each task is a complete red→green cycle: write/adjust the failing test, implement, **make tests pass and validate**, run `npm run lint` + the affected workspace typecheck, commit, and only then start the next task. Do **not** batch test updates to the end.

**Green-checkpoint policy:** M1–M3 + I8 are one coordinated contract change. Shared tasks (1–4) end green for `@trap/shared` (its tests + typecheck); `apps/party` and `apps/mobile` are expected to be red until their wiring tasks (5–7) land. Do not try to keep party/mobile compiling mid-way through the shared changes.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `packages/shared/src/types.ts` | modify | Drop `'leave'`; add `isOnline` to `PlayerView`; add `winnerId`/`winnerUsername` to `GameState` |
| `packages/shared/src/gameRules.ts` | modify | Remove `removePlayer`/leave handling; lobby-lock in `addPlayer`; `submitCards` prep-only; presence + winner in `getGameState`; `getWinner` helper |
| `packages/shared/src/gameRules.test.ts` | modify | Membership-persists-on-reconnect; joins-locked; prep-only submit; presence; winner |
| `packages/shared/src/messages.ts` | modify | Remove `player_left`; `game_ended` carries `winnerId` |
| `packages/shared/src/messages.test.ts` | modify | Keep parse coverage compiling (no `player_left`) |
| `apps/party/src/LobbyDO.ts` | modify | `onClose` presence-only; `onConnect` lock via `addPlayer`; presence in `broadcastState`; `game_ended` winner; drop `player_left`/`removePlayer` |
| `apps/party/test/lobby.integration.test.ts` | modify | Reconnect keeps membership; no `player_left` (stays `.skip`ped) |
| `apps/mobile/src/state/game.ts` | modify | Drop `player_left` reduce; `leave()`→`exit()`; clear `error` on valid state (I6); map `unreachable` (I7) |
| `apps/mobile/src/state/game.test.ts` | modify | Error-clear; no `player_left` |
| `apps/mobile/src/lib/realtime.ts` | modify | Connect timeout → `unreachable` status (I7) |
| `apps/mobile/src/lib/realtime.test.ts` | modify | Timeout surfaces `unreachable` |
| `apps/mobile/src/ui/Screen.tsx` | create | Shared safe-area screen wrapper (I10′) |
| `apps/mobile/app/lobby/[code].tsx` | modify | Online indicator; `exit()`; `Screen`; lobby-lock error already via `error` |
| `apps/mobile/app/prep/[code].tsx` | modify | Online/submitted indicators; `Screen` |
| `apps/mobile/app/game/[code].tsx` | modify | Winner banner from `status`+`winnerId`; read-only when concluded (I12); `exit()`; `Screen` |
| `apps/mobile/e2e/multiplayer.spec.ts` | modify | Assert no membership loss after a reconnect; winner shown |

---

## Task 1: Shared — permanent membership (remove `leave`)

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/gameRules.ts`
- Modify: `packages/shared/src/gameRules.test.ts`

- [ ] **Step 1: Replace the `removePlayer` test with a membership-persistence test**

In `packages/shared/src/gameRules.test.ts`, the `describe('removePlayer', ...)` block currently asserts a player can be dropped. Replace that entire block with one asserting membership survives a disconnect→reconnect cycle, and remove `removePlayer` from the import list at the top of the file:

```ts
describe('membership is permanent', () => {
  it('a player who disconnects and reconnects stays a member with their hand', () => {
    const deps = createTestDeps({ startId: 400 });
    let state = startGame(submittedTwoInPrep()).state;
    const handBefore = getPlayerCards(state, 'p1').map((c) => c.id);

    // Simulate a reconnect: addPlayer is called again for an existing member.
    const res = addPlayer(state, 'p1', 'Alice', deps);
    expect(res.ok).toBe(true);
    state = res.state;

    expect(getLobbyMembers(state).map((m) => m.playerId)).toEqual(['p1', 'p2']);
    expect(getPlayerCards(state, 'p1').map((c) => c.id)).toEqual(handBefore);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:shared`
Expected: FAIL — `removePlayer` no longer imported / the new block references the intended invariant. (At this point it may fail to compile because `removePlayer` is still exported but unused in the import; that is fine — proceed to remove it.)

- [ ] **Step 3: Remove `'leave'` from `GameActionType`**

In `packages/shared/src/types.ts`, change the action union:

```ts
/** Game action kinds recorded in the event log. */
export type GameActionType =
  | 'join'
  | 'set_ready'
  | 'distribute'
  | 'play_card';
```

- [ ] **Step 4: Remove `removePlayer` and leave-handling from the rules**

In `packages/shared/src/gameRules.ts`:

Delete the entire `removePlayer` function (the `export function removePlayer(...) { ... }` block).

Then simplify `getLobbyMembers` so membership never ends (no `leave` branch):

```ts
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
```

- [ ] **Step 5: Run the tests + typecheck to verify green**

Run: `npm run test:shared`
Expected: PASS (membership-persistence block green; no other shared test references `removePlayer`).
Run: `npm run typecheck --workspace=@trap/shared`
Expected: PASS.

- [ ] **Step 6: Lint + commit**

Run: `npm run lint`
Expected: PASS.

```bash
git add packages/shared/src/types.ts packages/shared/src/gameRules.ts packages/shared/src/gameRules.test.ts
git commit -m "feat(shared): permanent membership; remove leave/removePlayer"
```

---

## Task 2: Shared — presence (`isOnline`)

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/gameRules.ts`
- Modify: `packages/shared/src/gameRules.test.ts`

- [ ] **Step 1: Write the failing presence test**

In `packages/shared/src/gameRules.test.ts`, add to the `describe('getGameState (per-viewer)', ...)` block:

```ts
  it('marks players online from the supplied connected set (default offline)', () => {
    const state = startGame(submittedTwoInPrep()).state;
    const offline = getGameState(state, 'p1');
    expect(offline.players.every((p) => p.isOnline === false)).toBe(true);

    const online = getGameState(state, 'p1', new Set(['p1']));
    expect(online.players.find((p) => p.id === 'p1')?.isOnline).toBe(true);
    expect(online.players.find((p) => p.id === 'p2')?.isOnline).toBe(false);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:shared`
Expected: FAIL — `isOnline` is not on `PlayerView`; `getGameState` takes no online set.

- [ ] **Step 3: Add `isOnline` to `PlayerView`**

In `packages/shared/src/types.ts`:

```ts
/** Public, per-player info (other players' statements are hidden). */
export interface PlayerView {
  id: string;
  username: string;
  cardsRemaining: number;
  isReady: boolean;
  hasSubmitted: boolean;
  /** Live presence — has an open socket right now (transient, not persisted). */
  isOnline: boolean;
}
```

- [ ] **Step 4: Thread an online set through `getGameState`**

In `packages/shared/src/gameRules.ts`, update the signature and the `players` mapping:

```ts
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
```

> Note: a later step (Task 4) adds `winnerId`/`winnerUsername` to this return. Leave room for it; do not add those fields yet.

- [ ] **Step 5: Fix the existing `getGameState` assertions for the new field**

In the same file's existing `getGameState` tests, the `toMatchObject` for p2 still passes (subset match). No change needed unless a test does an exact `toEqual` on a `PlayerView` — if so, add `isOnline: false`.

- [ ] **Step 6: Verify green + lint + commit**

Run: `npm run test:shared && npm run typecheck --workspace=@trap/shared && npm run lint`
Expected: PASS.

```bash
git add packages/shared/src/types.ts packages/shared/src/gameRules.ts packages/shared/src/gameRules.test.ts
git commit -m "feat(shared): live presence (isOnline) in per-player state"
```

---

## Task 3: Shared — lock new joins after `waiting`; submit only in `prep`

**Files:**
- Modify: `packages/shared/src/gameRules.ts`
- Modify: `packages/shared/src/gameRules.test.ts`

- [ ] **Step 1: Write the failing lock + prep-only tests**

In `packages/shared/src/gameRules.test.ts`, replace the two membership tests that assert a mid-game joiner can join/submit. First, in `describe('membership', ...)`, replace the `'first player becomes owner; mid-game join does NOT auto-deal'` test with:

```ts
  it('locks new joins once the lobby has left waiting', () => {
    const deps = createTestDeps({ startId: 100 });
    const started = startGame(submittedTwoInPrep()).state;
    const res = addPlayer(started, 'p3', 'Cara', deps);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('joins_locked');
  });

  it('still accepts an existing member reconnecting after lock', () => {
    const deps = createTestDeps({ startId: 150 });
    const started = startGame(submittedTwoInPrep()).state;
    const res = addPlayer(started, 'p1', 'Alice', deps);
    expect(res.ok).toBe(true);
    expect(getLobbyMembers(res.state).map((m) => m.playerId)).toEqual(['p1', 'p2']);
  });
```

Then in `describe('submitCards', ...)`, replace the `'allows a mid-game joiner to submit while in-progress'` test with:

```ts
  it('rejects submission outside prep (in-progress is not allowed)', () => {
    const deps = createTestDeps();
    const inProgress = startGame(submittedTwoInPrep()).state;
    // p1 already submitted during prep; a fresh submit attempt in-progress is wrong phase.
    const res = submitCards(inProgress, 'p1', ['x', 'y', 'z'], deps);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('already_submitted');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:shared`
Expected: FAIL — `addPlayer` still admits `p3`; `submitCards` still allows `in-progress`.

- [ ] **Step 3: Lock joins in `addPlayer`**

In `packages/shared/src/gameRules.ts`, `addPlayer` already (after Task 1's fix) returns early for an existing member BEFORE the `isLobbyFull` check. Add the new-player lock between the existing-member return and the `isLobbyFull` check, so the guard order is: existing-member reconnect → joins-locked (new + not waiting) → lobby-full → clash → append. Replace the top of `addPlayer` with:

```ts
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
```

- [ ] **Step 4: Restrict `submitCards` to `prep`**

In `submitCards`, tighten the phase guard from `prep || in-progress` to `prep` only:

```ts
  if (state.status !== 'prep') {
    return { ok: false, state, error: 'wrong_phase' };
  }
```

(Leave the rest of `submitCards` unchanged. The existing `already_submitted` check now produces the expected error for the in-progress re-submit test, since `p1` submitted during prep.)

- [ ] **Step 5: Verify green + lint + commit**

Run: `npm run test:shared && npm run typecheck --workspace=@trap/shared && npm run lint`
Expected: PASS.

```bash
git add packages/shared/src/gameRules.ts packages/shared/src/gameRules.test.ts
git commit -m "feat(shared): lock new joins after waiting; submit only in prep"
```

---

## Task 4: Shared — winner outcome (first to empty) + contract cleanup

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/gameRules.ts`
- Modify: `packages/shared/src/gameRules.test.ts`
- Modify: `packages/shared/src/messages.ts`
- Modify: `packages/shared/src/messages.test.ts`

- [ ] **Step 1: Write the failing winner test**

In `packages/shared/src/gameRules.test.ts`, add a block:

```ts
describe('winner (first to empty hand)', () => {
  it('names the first player to empty as winner only when concluded', () => {
    const deps = createTestDeps({ startId: 500 });
    let state = startGame(submittedTwoInPrep()).state;
    expect(getGameState(state, 'p1').winnerId).toBeNull();

    for (const card of getPlayerCards(state, 'p1')) {
      ({ state } = playCard(state, 'p1', card.id, 'p2', deps));
    }
    const view = getGameState(state, 'p2');
    expect(view.status).toBe('concluded');
    expect(view.winnerId).toBe('p1');
    expect(view.winnerUsername).toBe('Alice');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:shared`
Expected: FAIL — `winnerId`/`winnerUsername` are not on `GameState`.

- [ ] **Step 3: Add winner fields to `GameState`**

In `packages/shared/src/types.ts`, extend `GameState`:

```ts
export interface GameState {
  lobbyId: string;
  lobbyCode: string;
  status: LobbyStatus;
  ownerId: string | null;
  cardsPerPlayer: number;
  players: PlayerView[];
  myCards: Card[];
  gameHistory: GameHistoryItem[];
  /** First player to empty their hand; populated only when `concluded`. */
  winnerId: string | null;
  winnerUsername: string | null;
}
```

- [ ] **Step 4: Compute the winner in the rules**

In `packages/shared/src/gameRules.ts`, add a helper near `getFinishedPlayers`:

```ts
/**
 * The first player to empty their hand (the winner), or null if no one has yet.
 * Determined by the `play_card` event that first reduces a player's remaining
 * count to zero.
 */
export function getWinner(state: GameRoomState): string | null {
  if (!hasGameStarted(state)) return null;
  const remaining = new Map<string, number>();
  for (const m of getLobbyMembers(state)) {
    remaining.set(m.playerId, getInitialHandSize(state, m.playerId));
  }
  for (const ev of state.events) {
    if (ev.type !== 'play_card') continue;
    const left = (remaining.get(ev.playerId) ?? 0) - 1;
    remaining.set(ev.playerId, left);
    if (left === 0) return ev.playerId;
  }
  return null;
}

/** How many cards a player was dealt (count of their distribute events). */
function getInitialHandSize(state: GameRoomState, playerId: string): number {
  return state.events.filter(
    (ev) => ev.type === 'distribute' && ev.playerId === playerId
  ).length;
}
```

Then populate the new fields in `getGameState` (replace its `return`):

```ts
  const winnerId = status === 'concluded' ? getWinner(state) : null;
  return {
    lobbyId: state.lobbyId,
    lobbyCode: state.lobbyCode,
    status,
    ownerId: state.ownerId,
    cardsPerPlayer: state.settings.cardsPerPlayer,
    players,
    myCards: getPlayerCards(state, viewerId),
    gameHistory: getGameHistory(state),
    winnerId,
    winnerUsername: winnerId ? state.usernames[winnerId] ?? null : null,
  };
```

- [ ] **Step 5: Carry the winner on `game_ended` and remove `player_left`**

In `packages/shared/src/messages.ts`:

Remove `'player_left'` from `ServerMessageType`, delete the `PlayerLeftMessage` interface, and remove `PlayerLeftMessage` from the `ServerMessage` union.

Extend `GameEndedMessage`:

```ts
export interface GameEndedMessage {
  type: 'game_ended';
  /** Player ids that ran out of cards (triggered the end). */
  finishedPlayerIds: string[];
  /** First player to empty their hand. */
  winnerId: string | null;
  winnerUsername: string | null;
}
```

In `packages/shared/src/messages.test.ts`, if any test imports or references `PlayerLeftMessage`, remove it. (`parseClientMessage` is unaffected — `player_left` is server→client.)

- [ ] **Step 6: Verify green + lint + commit**

Run: `npm run test:shared && npm run typecheck --workspace=@trap/shared && npm run lint`
Expected: PASS.

```bash
git add packages/shared/src
git commit -m "feat(shared): winner outcome; drop player_left message"
```

---

## Task 5: Party — wire membership/presence/lock/winner into the DO

**Files:**
- Modify: `apps/party/src/LobbyDO.ts`
- Modify: `apps/party/test/lobby.integration.test.ts`

- [ ] **Step 1: Update the (skipped) realtime integration test for the new behavior**

In `apps/party/test/lobby.integration.test.ts`, within `describe.skip(...)`, update the reconnect expectation. Replace the `'plays a card ...'` block's tail or add a new test asserting a reconnect keeps membership and emits **no** `player_left`:

```ts
  it('keeps membership on reconnect and never emits player_left', async () => {
    const code = 'ROOM03';
    await createLobby(code);
    const alice = await connect(code, 'p1', 'Alice');
    await waitFor(alice, 'connected');
    const bob = await connect(code, 'p2', 'Bob');
    await waitFor(bob, 'connected');

    const seen: string[] = [];
    bob.ws.addEventListener('message', (e: MessageEvent) => {
      seen.push(JSON.parse(e.data as string).type);
    });

    alice.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(seen).not.toContain('player_left');

    const alice2 = await connect(code, 'p1', 'Alice');
    const reconnected = await waitFor(alice2, 'state_update');
    expect(reconnected.state.players.map((p: { id: string }) => p.id).sort()).toEqual(['p1', 'p2']);

    alice2.ws.close();
    bob.ws.close();
  });
```

(This block stays `.skip`ped on the Windows/test-pool toolchain per AGENTS.md; it documents the intended transport behavior. The Node WS harness in the validation spec is the runnable transport check.)

- [ ] **Step 2: Remove `removePlayer` import and rewrite `onClose` to presence-only**

In `apps/party/src/LobbyDO.ts`, remove `removePlayer` from the `@trap/shared` import. Replace `onClose`:

```ts
  override async onClose(connection: Connection<ConnState>): Promise<void> {
    const state = connection.state;
    if (!state) return;
    // Membership is permanent — a closed socket is only a presence change.
    // Re-broadcast state so everyone sees the player go offline. No leave, no push.
    const room = await this.loadRoom();
    if (room) await this.broadcastState(room);
  }
```

- [ ] **Step 3: Compute the online set and thread it through `broadcastState`**

In `apps/party/src/LobbyDO.ts`, add a helper and update `broadcastState` and the HTTP `/state` and per-connection sends to pass the online set:

```ts
  /** Player ids with at least one open connection right now. */
  private onlinePlayerIds(): Set<string> {
    const ids = new Set<string>();
    for (const c of this.getConnections<ConnState>()) {
      const pid = c.state?.playerId;
      if (pid) ids.add(pid);
    }
    return ids;
  }

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
```

Update the initial `state_update` in `onConnect` and the `get_state` handler to pass `this.onlinePlayerIds()` as the third arg:

```ts
    this.sendTo(connection, {
      type: 'state_update',
      state: getGameState(room, playerId, this.onlinePlayerIds()),
    });
```

```ts
      case 'get_state':
        this.sendTo(connection, {
          type: 'state_update',
          state: getGameState(room, state.playerId, this.onlinePlayerIds()),
        });
        return;
```

(The HTTP `onRequest` `/state` read has no live socket context; leave it calling `getGameState(room, playerId)` — defaults to all-offline, which is correct for a pull read.)

- [ ] **Step 4: Replace the blanket concluded rejection with the lock via `addPlayer`**

In `onConnect`, delete the `if (room.status === 'concluded') { ... }` early rejection block. The `addPlayer` call already returns `joins_locked` for a **new** player when the lobby has started, and admits existing members (including into a concluded lobby for read-only). Keep the existing `if (!result.ok) { ... connection.close(...) }` handling — a non-member now gets `joins_locked` and is closed.

- [ ] **Step 5: Carry the winner on `game_ended`**

In `onMessage`'s `play_card` case, where the game ends, add the winner fields. Add `getWinner` to the import, and update the `game_ended` broadcast:

```ts
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
```

- [ ] **Step 6: Verify green + lint + commit**

Run: `npm run typecheck --workspace=@trap/party && npm run test:party && npm run lint`
Expected: PASS (the reconnect integration test stays `.skip`ped; HTTP create + history + CORS tests pass).

```bash
git add apps/party/src/LobbyDO.ts apps/party/test/lobby.integration.test.ts
git commit -m "feat(party): permanent membership, presence, join lock, winner"
```

---

## Task 6: Mobile store/realtime — consume the new contract (no `player_left`, winner, `exit()`)

**Files:**
- Modify: `apps/mobile/src/state/game.ts`
- Modify: `apps/mobile/src/state/game.test.ts`

- [ ] **Step 1: Write the failing test for `exit()` and winner passthrough**

In `apps/mobile/src/state/game.test.ts`, add (and update any test that referenced `player_left` to remove it):

```ts
  it('exposes exit() that disconnects and resets local state', () => {
    const store = createGameStore({ connectionFactory: fakeFactory });
    store.getState().connect({ code: 'ABC1', playerId: 'p1', username: 'A' });
    store.getState().exit();
    expect(store.getState().lobbyCode).toBeNull();
    expect(store.getState().connectionStatus).toBe('idle');
  });

  it('stores the winner from game_ended', () => {
    const store = createGameStore({ connectionFactory: fakeFactory });
    store.getState().connect({ code: 'ABC1', playerId: 'p1', username: 'A' });
    emit({ type: 'game_ended', finishedPlayerIds: ['p1'], winnerId: 'p1', winnerUsername: 'A' });
    expect(store.getState().gameEnded).toEqual({
      finishedPlayerIds: ['p1'],
      winnerId: 'p1',
      winnerUsername: 'A',
    });
  });
```

(Reuse the file's existing `fakeFactory`/`emit` test helpers; match their names if they differ.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace=@trap/mobile`
Expected: FAIL — `exit` not defined; `gameEnded` lacks winner fields.

- [ ] **Step 3: Update the store**

In `apps/mobile/src/state/game.ts`:

Widen the `gameEnded` shape and rename `leave`→`exit` in the interface:

```ts
  gameEnded: { finishedPlayerIds: string[]; winnerId: string | null; winnerUsername: string | null } | null;
```

```ts
  exit(): void;
```

In `reduce`, update `game_ended` and clear `error` on valid state (this also satisfies Task 8's I6 — but keep the dedicated I6 test in Task 8):

```ts
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
    default:
      return;
```

Rename the `leave` action implementation to `exit` (same body):

```ts
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
```

- [ ] **Step 4: Update the three screens' call sites `leave()`→`exit()`**

In `apps/mobile/app/lobby/[code].tsx` and `apps/mobile/app/game/[code].tsx`, change `gameStore.getState().leave()` to `gameStore.getState().exit()` (the `leave` local function wrappers stay; only the store method name changes).

- [ ] **Step 5: Verify green + lint + commit**

Run: `npm run test --workspace=@trap/mobile && npm run typecheck --workspace=@trap/mobile && npm run lint`
Expected: PASS.

```bash
git add apps/mobile/src/state/game.ts apps/mobile/src/state/game.test.ts apps/mobile/app/lobby/[code].tsx apps/mobile/app/game/[code].tsx
git commit -m "feat(mobile): exit() disconnect, winner in store, drop player_left"
```

---

## Task 7: Mobile UI — presence indicators, winner screen, read-only concluded (I12)

**Files:**
- Modify: `apps/mobile/app/lobby/[code].tsx`
- Modify: `apps/mobile/app/prep/[code].tsx`
- Modify: `apps/mobile/app/game/[code].tsx`

- [ ] **Step 1: Lobby — show an online indicator per player**

In `apps/mobile/app/lobby/[code].tsx`, update the `renderItem` player row to show presence alongside ready state, and add the style:

```tsx
        renderItem={({ item }) => (
          <View style={styles.playerRow}>
            <Text style={styles.playerName}>
              {item.isOnline ? '🟢 ' : '⚪ '}
              {item.username}
              {item.id === gameState?.ownerId ? '  (host)' : ''}
              {item.id === userId ? '  (you)' : ''}
            </Text>
            <Text style={item.isReady ? styles.ready : styles.notReady}>
              {item.isReady ? 'Ready' : 'Not ready'}
            </Text>
          </View>
        )}
```

- [ ] **Step 2: Prep — show online + submitted**

In `apps/mobile/app/prep/[code].tsx`, update its player `renderItem` name line:

```tsx
              <Text style={styles.playerName}>
                {item.isOnline ? '🟢 ' : '⚪ '}
                {item.username}
                {item.id === userId ? '  (you)' : ''}
              </Text>
```

- [ ] **Step 3: Game — winner banner from status + winnerId; read-only when concluded**

In `apps/mobile/app/game/[code].tsx`:

Derive concluded/winner from `gameState` (so a re-entrant who never received the transient `game_ended` still sees the result):

```tsx
  const concluded = gameState.status === 'concluded';
  const winnerId = gameState.winnerId;
  const winnerUsername = gameState.winnerUsername;
  const iWon = concluded && winnerId === userId;
```

Disable play interactions when `concluded` — change `playOn` to no-op and the opponent `Pressable`'s `disabled`:

```tsx
  const playOn = (targetPlayerId: string) => {
    if (concluded || !selectedCardId) return;
    gameStore.getState().playCard(selectedCardId, targetPlayerId);
    setSelectedCardId(null);
  };
```

```tsx
            <Pressable
              testID="opponent"
              style={[styles.opponent, selectedCardId && !concluded ? styles.opponentArmed : styles.opponentIdle]}
              onPress={() => playOn(p.id)}
              disabled={!selectedCardId || concluded}
            >
```

Replace the end-of-screen `gameEnded ?` block with a `concluded ?` block that names the winner:

```tsx
      {concluded ? (
        <>
          <Celebration />
          <MotiView
            style={styles.endedBanner}
            from={{ opacity: 0, translateY: 24 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 320 }}
          >
            <Text style={styles.endedText}>
              {iWon
                ? '🏆 You sprung all your traps first!'
                : `🏆 ${winnerUsername ?? 'Someone'} sprung all their traps first`}
            </Text>
            <Pressable style={styles.button} onPress={leave}>
              <Text style={styles.buttonText}>Back to home</Text>
            </Pressable>
          </MotiView>
        </>
      ) : (
        <Pressable style={styles.linkButton} onPress={leave}>
          <Text style={styles.linkText}>Back to home</Text>
        </Pressable>
      )}
```

(`leave` is the local handler that calls `gameStore.getState().exit()` + `router.replace('/')` from Task 6. The `gameEnded` store field is no longer read here.)

- [ ] **Step 4: Manual smoke (tier-2/web)**

Run (from `apps/mobile`): `npm run test:e2e`
Expected: existing multiplayer e2e still passes (winner banner + presence dots render; concluded disables play). If a locator breaks, fix per `e2e/README.md` (`vis()` + pathname rules).

- [ ] **Step 5: Verify + lint + commit**

Run: `npm run typecheck --workspace=@trap/mobile && npm run test --workspace=@trap/mobile && npm run lint`
Expected: PASS.

```bash
git add apps/mobile/app
git commit -m "feat(mobile): presence dots, winner screen, read-only concluded"
```

---

## Task 8: I6 — errors are transient

**Files:**
- Modify: `apps/mobile/src/state/game.test.ts`

> The clearing logic already landed in Task 6 (`error: null` on `connected`/`state_update`). This task adds the dedicated regression test so I6 has explicit coverage.

- [ ] **Step 1: Write the failing/▶ regression test**

In `apps/mobile/src/state/game.test.ts`:

```ts
  it('clears a stale error once a valid state_update arrives', () => {
    const store = createGameStore({ connectionFactory: fakeFactory });
    store.getState().connect({ code: 'ABC1', playerId: 'p1', username: 'A' });
    emit({ type: 'error', message: 'not_all_ready' });
    expect(store.getState().error).toBe('not_all_ready');
    emit({ type: 'state_update', state: makeGameState() }); // helper from this file
    expect(store.getState().error).toBeNull();
  });
```

(If the test file has no `makeGameState()` helper, build a minimal `GameState` inline with `players: []`, `myCards: []`, `gameHistory: []`, `winnerId: null`, `winnerUsername: null`, `status: 'waiting'`, etc.)

- [ ] **Step 2: Run to verify it passes (logic already present)**

Run: `npm run test --workspace=@trap/mobile`
Expected: PASS (confirms Task 6's clearing rule). If it fails, the clearing in `reduce` was missed — add `error: null` to the `state_update` case.

- [ ] **Step 3: Lint + commit**

Run: `npm run lint`

```bash
git add apps/mobile/src/state/game.test.ts
git commit -m "test(mobile): transient error clears on next valid state"
```

---

## Task 9: I7 — unreachable Worker surfaces an actionable state

**Files:**
- Modify: `apps/mobile/src/lib/realtime.ts`
- Modify: `apps/mobile/src/lib/realtime.test.ts`
- Modify: `apps/mobile/src/state/game.ts`

- [ ] **Step 1: Write the failing timeout test**

In `apps/mobile/src/lib/realtime.test.ts`, add (use Vitest fake timers; a fake socket that never fires `open`):

```ts
import { vi } from 'vitest';

it('surfaces "unreachable" if no open within the timeout', () => {
  vi.useFakeTimers();
  const statuses: string[] = [];
  const conn = new LobbyConnection({
    code: 'ABC1',
    playerId: 'p1',
    username: 'A',
    socketFactory: () => ({
      send() {},
      close() {},
      addEventListener() {}, // never emits 'open'
    }) as unknown as RealtimeSocket,
  });
  conn.onStatus((s) => statuses.push(s));
  conn.connect();
  vi.advanceTimersByTime(8000);
  expect(statuses).toContain('unreachable');
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace=@trap/mobile`
Expected: FAIL — `'unreachable'` is never emitted.

- [ ] **Step 3: Add `unreachable` + the connect timeout**

In `apps/mobile/src/lib/realtime.ts`:

```ts
export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'unreachable';
```

Add a timer field and arm it in `connect()`, clear it on `open`/`close`:

```ts
export class LobbyConnection {
  private socket: RealtimeSocket | null = null;
  private status: ConnectionStatus = 'closed';
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly CONNECT_TIMEOUT_MS = 8000;
  // ...existing handler sets...

  connect(): void {
    if (this.socket) return;
    const factory = this.options.socketFactory ?? defaultSocketFactory;
    this.setStatus('connecting');
    this.connectTimer = setTimeout(() => {
      if (this.status === 'connecting') this.setStatus('unreachable');
    }, LobbyConnection.CONNECT_TIMEOUT_MS);

    this.socket = factory({
      host: this.options.host ?? config.partyHost,
      party: LOBBY_PARTY,
      room: this.options.code,
      query: { playerId: this.options.playerId, username: this.options.username },
    });

    this.socket.addEventListener('open', () => {
      this.clearConnectTimer();
      this.setStatus('open');
    });
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

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  close(): void {
    this.clearConnectTimer();
    this.socket?.close();
    this.socket = null;
    this.setStatus('closed');
  }
```

- [ ] **Step 4: Map `unreachable` in the store + screens**

`apps/mobile/src/state/game.ts`: `GameConnectionStatus` already unions `ConnectionStatus | 'idle'`, so `'unreachable'` flows through automatically. No store change needed.

In `apps/mobile/app/lobby/[code].tsx`, the status line already renders `Connection: ${connectionStatus}`. Make `unreachable` friendlier:

```tsx
      <Text style={styles.status}>
        {connectionStatus === 'open'
          ? `${players.length} player${players.length === 1 ? '' : 's'} in lobby`
          : connectionStatus === 'unreachable'
            ? "Can't reach the server — retrying…"
            : `Connection: ${connectionStatus}`}
      </Text>
```

- [ ] **Step 5: Verify green + lint + commit**

Run: `npm run test --workspace=@trap/mobile && npm run typecheck --workspace=@trap/mobile && npm run lint`
Expected: PASS.

```bash
git add apps/mobile/src/lib/realtime.ts apps/mobile/src/lib/realtime.test.ts apps/mobile/app/lobby/[code].tsx
git commit -m "feat(mobile): surface 'unreachable' on connect timeout"
```

---

## Task 10: I10′ — safe-area screen wrapper

**Files:**
- Create: `apps/mobile/src/ui/Screen.tsx`
- Modify: `apps/mobile/app/index.tsx`, `apps/mobile/app/login.tsx`, `apps/mobile/app/lobby/[code].tsx`, `apps/mobile/app/prep/[code].tsx`, `apps/mobile/app/game/[code].tsx`

- [ ] **Step 1: Confirm the dependency is present**

Run (from `apps/mobile`): `npx expo install --check`
`react-native-safe-area-context` ships with Expo SDK 54 and is used by expo-router's stack. If `npm ls react-native-safe-area-context` is empty, run `npx expo install react-native-safe-area-context`.

- [ ] **Step 2: Create the shared wrapper**

Create `apps/mobile/src/ui/Screen.tsx`:

```tsx
/**
 * Screen — a safe-area-aware container so top controls clear the status bar /
 * notch (and bottom controls clear the home indicator). Wraps content in an
 * edges-aware SafeAreaView using the app background. DRY: every route uses this
 * instead of a bare View.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../lib/theme';

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <View style={[styles.body, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
});
```

(If `colors` has no `background` key, use the existing top-level background color from `theme.ts`; check `src/lib/theme.ts` and match the key name.)

- [ ] **Step 3: Wrap each route's root**

In each of `index.tsx`, `login.tsx`, `lobby/[code].tsx`, `prep/[code].tsx`, `game/[code].tsx`, replace the outermost `<View style={styles.container}>` / `<MotiView style={styles.container}>` root with `<Screen>` wrapping the existing content. Keep the inner content and `MotiView` animations; move the `flex: 1` container padding inside. Example for `game/[code].tsx`'s return:

```tsx
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* ...existing children unchanged... */}
      </ScrollView>
      {/* ...existing footer/banner unchanged... */}
    </Screen>
  );
```

Add the import to each file: `import { Screen } from '../../src/ui/Screen';` (use `'../src/ui/Screen'` for `index.tsx`/`login.tsx`).

- [ ] **Step 4: Verify web e2e + typecheck**

Run (from `apps/mobile`): `npm run test:e2e`
Expected: PASS (the `data-testid`s are unchanged; `Screen` renders a plain container on web). Fix any `vis()` locator drift per `e2e/README.md`.
Run: `npm run typecheck --workspace=@trap/mobile && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/ui/Screen.tsx apps/mobile/app
git commit -m "fix(mobile): safe-area screen wrapper for all routes"
```

---

## Task 11: Device-tier validation pass (tier 3)

**Files:**
- Reference: `apps/mobile/maestro/README.md`, `.github/workflows/device.yml`
- Modify (if needed): `apps/mobile/maestro/player2.mjs`

Per the validation spec, reconnection (I1/I3) and safe-area (I10′) must be confirmed on the Hermes/Android gate — web e2e does not exercise app backgrounding.

- [ ] **Step 1: Run the device flow locally (or via `workflow_dispatch`)**

Follow `apps/mobile/maestro/README.md`: start the Worker (`--ip 0.0.0.0`), Metro, the player-2 helper, then `maestro test`. Confirm the smoke + game flows pass against the rebuilt shared package.

- [ ] **Step 2: Manual two-device LAN matrix (validation spec rows R1–R8)**

With two clients on the LAN, walk the matrix from the validation spec. The must-pass mobile-only rows:
- R2: background client 2 mid-game ~30s, foreground → hand + roster intact; client 1 saw **no "left"**.
- R3: force-quit + reopen client 2; rejoin from Home → same game/hand.
- R7: play to a hand emptying → winner banner names the first-to-empty.
- R8: top controls clear the status bar/notch on a device with a notch.

- [ ] **Step 3: Record results**

Note pass/fail per row in the PR description. Any failure is a bug to fix before merge (re-open the relevant task).

> No commit (validation only). If `player2.mjs` needed a tweak to drive the three-stage flow for the winner assertion, commit that with `test(mobile): device helper drives game to a winner`.

---

## Self-Review

- **Spec coverage:** M1 (Task 1), M2 (Task 2), M3 (Task 3), I8 (Task 4 + 7), `player_left` removal (Task 4 + 5/6), DO wiring (Task 5), `exit()`/winner store (Task 6), presence/winner/read-only-concluded UI = I12 (Task 7), I6 (Task 8), I7 (Task 9), I10′ (Task 10), tier-3 validation incl. I1/I3 (Task 11). I5 is a documented limitation (no task, per spec). I2/I9 deferred (Phase B). I11 = "block" delivered by M3's `joins_locked`.
- **Placeholder scan:** every code step shows complete code; test helper names (`fakeFactory`/`emit`/`makeGameState`) are flagged to match the existing test file rather than invented.
- **Type consistency:** `isOnline` (Task 2) is set in `getGameState` (Task 2/4) and consumed in UI (Task 7); `winnerId`/`winnerUsername` are added once (Task 4) and used consistently in DO (`getWinner`, Task 5), store (Task 6), and UI (Task 7); `getGameState(state, viewerId, onlinePlayerIds?)` signature is used identically across Tasks 2/4/5; `exit()` replaces `leave()` in the store (Task 6) with call sites updated (Task 6 Step 4 + Task 7).
- **Per-issue TDD:** every task is red→green with its own lint + typecheck + commit before the next.
