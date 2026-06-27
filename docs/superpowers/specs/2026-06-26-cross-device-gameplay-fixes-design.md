# Cross-Device Gameplay — Fixes Design

> **Companion validation spec:** `2026-06-26-cross-device-gameplay-validation-design.md`. That spec
> defines the red tests / device matrix that reproduce each issue. **This spec defines the fixes that
> turn them green.** Read it first for the issue register, the canonical membership/presence model,
> the LAN-vs-deployed callout, and the CI-tier routing.

## Goal

Resolve the P0 + P1 cross-device gameplay defects on `feat/user-authored-trap-cards`, correcting the
membership/presence model that earlier designs got wrong, so two clients can play a full game with
realistic mobile lifecycle (backgrounding, force-quit, re-entry) without losing players, spamming
"left" events, getting stuck, or ending with no result.

This is a light-hearted party game: each fix takes the **most practical** approach that is also
sound — favoring the pure-rules layer and small, model-consistent changes over heavy infrastructure.

## Core working principle — per-issue TDD (non-negotiable)

Issues are fixed **one at a time**, each as a complete red→green cycle:

1. Update/add the **matching tests for that issue** (from the validation spec) so they fail.
2. Implement the fix.
3. **Tests MUST pass and be validated** (the issue's tier-1/tier-2 tests green; tier-3/manual where
   the validation spec requires it) **before the next issue is started.**
4. Run `npm run lint` and the affected workspace typecheck before moving on.

Tests are **not** batched to the end. Each issue lands green on its own. Cross-workspace contract
changes follow the green-checkpoint policy from the user-authored-trap-cards plan: a coordinated
change ends green for its own workspace; downstream consumers go green as their task lands.

## Canonical model changes (the foundation — do these first)

Three issues (I1, I3, and the I11/I12 lobby-lock) share one root: the code encodes a **leave**
concept that must not exist. Fix the model once, then the rest follow.

### M1 — Membership is permanent; remove the leave concept

- **Drop `'leave'` from `GameActionType` and remove `removePlayer`** from `@trap/shared`. A member is
  any player with a `join` event; membership never ends while the lobby lives (until `concluded`;
  7-day-inactivity expiry is future work, per the validation spec).
- **`getLobbyMembers`** returns all distinct joined players in join order — no `leave` handling.
- **`LobbyDO.onClose` no longer mutates membership.** It does not append a leave, does not broadcast
  `player_left`, does not push. It only triggers a **presence** re-broadcast (M2).
- **Remove the `player_left` server message** from the contract (coordinated shared/party/mobile
  change). Presence changes are reflected by the next `state_update` (M2), so no dedicated message is
  required. `player_joined` stays (real new membership during `waiting`).

### M2 — Presence is a separate, live-connection-derived signal

- Add **`isOnline: boolean`** to `PlayerView`. It is **not** persisted in the event log — it is
  computed from currently-open WebSocket connections at broadcast time.
- **`getGameState(state, viewerId, onlinePlayerIds?)`** takes an optional set of online player ids;
  each `PlayerView.isOnline` is `onlinePlayerIds.has(player.id)` (default empty → all offline, used by
  the HTTP `/state` read where no live context exists).
- **`LobbyDO.broadcastState`** computes the online set from `getConnections()` (distinct
  `state.playerId`) and passes it into `getGameState` per viewer.
- **UI:** lobby/prep/game show an online indicator per player (e.g. a dot + "online"/"away"),
  replacing any "player left" wording. A backgrounded/returning player shows as away→online; the
  roster never changes.

### M3 — Lobby locks to new players once it leaves `waiting`

- **`addPlayer`**: if the player is **new** (no prior `join`) **and** `status !== 'waiting'`, reject
  with `error: 'joins_locked'`. **Existing members** (have a `join` event) are always accepted
  (idempotent re-entry), including when `status === 'concluded'`.
- **`LobbyDO.onConnect`**: remove the blanket "reject all on concluded." Instead rely on `addPlayer`:
  existing members connect to any status (read-only when concluded); new players are rejected with
  `joins_locked` whenever the lobby has started.
- Because joins are locked after `waiting`, the `submitCards` "in-progress mid-game joiner" branch
  becomes unreachable for new players; keep `submitCards` allowed only in `prep` (drop the
  `in-progress` allowance, since all members submit during prep). Update the corresponding rules test.

> **Buttons:** the "Leave lobby" / "Leave game" actions become **"Back to home"** — they close the
> socket and reset local store (going *offline*), but perform no leave. Rename the store action
> `leave()` → `exit()` to kill the misnomer. Re-entry is via the Home "your lobbies" list (already
> built).

## Per-issue fix design

### I1 / I3 — Reconnection preserves membership; disconnect is presence-only
Delivered by **M1 + M2**. Validation: the pure-rules membership test goes green (drop/return keeps the
player a member), the Node WS harness sees **no `player_left`** and a restored roster/hand, and the
Android device matrix rows R2–R4 (background, force-quit, back-to-home) pass.

### I8 — Outcome model: first to empty hand wins
- The game already ends the moment a player empties their hand, so at conclusion there is exactly one
  finisher — the **winner**. Add to `GameState` (populated only when `concluded`):
  - `winnerId: string | null`, `winnerUsername: string | null` — the first player to empty.
  - Ranking is derivable from the existing `players[].cardsRemaining` (ascending: winner has 0).
- The `game_ended` server message carries `winnerId` alongside `finishedPlayerIds`.
- **UI:** the end banner shows "🏆 {winner} sprung all their traps first!" plus the roster ordered by
  cards remaining. Crucially, the UI derives the ended/outcome view from
  **`gameState.status === 'concluded'` + `winnerId`** (not only the transient `gameEnded` store flag),
  so a member **re-entering a concluded lobby** sees the result (this is also I12's read-only view).

### I12 — Read-only concluded re-entry
Delivered by **M3** (existing members may connect to a concluded lobby) **+ I8** (the game screen
renders the final outcome/history from `status: 'concluded'`). The game screen disables card selection
and opponent tap targets when `status === 'concluded'`; only "Back to home" remains. Non-members hit
`joins_locked`.

### I6 — Errors are transient
- In the store reducer, **clear `error` on the next successful `state_update`/`connected`**. (A
  rejected action still sets `error`; it clears as soon as a valid state arrives.) Optionally also
  auto-dismiss after a short timeout — but clear-on-next-update is the minimum and is what the test
  asserts.

### I7 — Unreachable Worker surfaces an actionable state
- Add a **connect timeout** in `LobbyConnection`: start a timer on `connect()`; clear it on `open`;
  if it elapses (~8 s) with no `open`, surface a distinct status. Extend `ConnectionStatus` with
  `'unreachable'` (PartySocket keeps retrying underneath — this is a *surfaced* state, not a give-up).
- The store maps `'unreachable'` through; lobby/prep/game show "Can't reach the server — retrying…"
  instead of an indefinite "Connecting…".

### I10′ — Safe-area insets
- Add a shared **`Screen`** wrapper (DRY) using `react-native-safe-area-context`
  (`SafeAreaView`/`useSafeAreaInsets`; already an Expo dependency) and apply it to `index`, `login`,
  `lobby`, `prep`, `game`. Top controls sit below the status bar/notch.
- Validation is tier-3/manual (device matrix R8); insets differ iOS/Android but the fix is
  platform-agnostic.

### I5 — Owner-offline stall (documented limitation, no fix)
Start remains owner-only. With no time-based expiry, a lobby whose owner goes dark simply persists
(acceptable for a light-hearted game). Recorded as a known limitation; host-migration and
7-day-inactivity expiry are future work.

## Contract & type changes (coordinated, `@trap/shared` first)

| Change | File(s) | Note |
|--------|---------|------|
| Remove `'leave'` from `GameActionType`; remove `removePlayer` | `types.ts`, `gameRules.ts`, tests | M1 |
| Remove `player_left` server message | `messages.ts`, `LobbyDO.ts`, `state/game.ts`, tests | M1 |
| Add `isOnline` to `PlayerView`; `getGameState` takes `onlinePlayerIds?` | `types.ts`, `gameRules.ts`, `LobbyDO.ts` | M2 |
| `addPlayer` rejects new joins with `joins_locked` when not `waiting` | `gameRules.ts`, `LobbyDO.onConnect` | M3 |
| `submitCards` allowed in `prep` only | `gameRules.ts`, tests | M3 |
| Add `winnerId`/`winnerUsername` to `GameState`; `game_ended` carries `winnerId` | `types.ts`, `gameRules.ts`, `messages.ts`, `LobbyDO.ts` | I8 |
| Add `'unreachable'` to `ConnectionStatus`; connect timeout | `realtime.ts`, `state/game.ts` | I7 |
| Clear `error` on next valid state | `state/game.ts` | I6 |
| `leave()` → `exit()` (disconnect only, no membership change) | `state/game.ts`, screens | M1 |
| Shared `Screen` safe-area wrapper | `src/ui/Screen.tsx` (new), screens | I10′ |

## Sequencing

Each step is a full red→green cycle (per-issue TDD); ordered so the model foundation lands first.

1. **M1 + M2 + M3** (membership/presence/lock) — the shared-rules + DO foundation; resolves I1/I3 and
   the join-lock that I11/I12 depend on. (Coordinated contract change across all three workspaces.)
2. **I8** outcome model + end-screen — also enables I12's read-only view.
3. **I12** read-only concluded re-entry (small, builds on M3 + I8).
4. **I6** transient errors.
5. **I7** connect timeout / unreachable state.
6. **I10′** safe-area wrapper.

Tier-3 (Android device matrix) is run for the reconnection-affecting steps (after step 1, and a final
full pass) and for I10′; tier-1/tier-2 run continuously per step.

## Out of scope / future work

- **I2 (deploy) / I9 (push):** Phase B / B6 — un-testable on LAN + Expo Go.
- **I5 host-migration** and **7-day-inactivity lobby expiry:** future work.
- **I11 mid-game join:** intentionally **not** supported (lobby locks after `waiting`).
- Turn-order (I10): intentional, no change.

## Self-review

- **Placeholders:** none — every P0/P1 issue has a concrete fix and a contract-change entry.
- **Consistency:** the membership/presence/lock model is applied once (M1–M3) and every downstream
  issue references it; "leave" survives only as the thing being removed. I8 and I12 share the
  concluded-state rendering path, and the join-lock is the single source for I11/I12's "no new joins."
- **Scope:** P0 + P1 only; deferrals/limitations/future-work are listed, not specced.
- **Ambiguity:** error-clearing rule (I6) and connect-timeout value (I7) are pinned (clear-on-next-
  state; ~8 s). Outcome (I8) is fixed to first-to-empty-wins with a derived ranking.
