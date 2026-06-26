# Cross-Device Gameplay — Validation Design

> **Companion fix spec:** `2026-06-26-cross-device-gameplay-fixes-design.md` (written after this
> spec is approved). This document defines **how we prove each issue exists** before any fix lands;
> the fix spec defines the changes that turn these validations green.

## Goal

Take the `feat/user-authored-trap-cards` branch from "code-complete + unit-passing" to "the
known end-to-end gameplay defects are reproduced by an explicit, repeatable validation harness."
Each fixable issue gets (a) a **failing automated test** at the lowest practical layer and/or
(b) a **manual two-device LAN step** with a stated expected outcome. This is the red gate that the
fix spec must turn green.

This is a light-hearted party game. Validation favors the **most practical** layer for each issue
(deterministic pure-rules tests where possible, Node WebSocket harness for transport, manual device
steps only where visual/Hermes-only), not maximal protocol rigor.

## Canonical model correction (read first)

The current code encodes a **player "leave"** concept that should not exist, and this nuance was
lost across earlier designs (`2026-06-22-user-authored-trap-cards-design.md` lists `'leave'` as a
`GameActionType`; `LobbyDO.onClose` calls `removePlayer`; `2026-06-10-lobby-history-design.md` notes
"leaving does not delete history"). The corrected model these validations assert:

- **Membership is permanent.** A unique user ID is a member of a lobby for that lobby's life.
  A lobby lives **until someone wins** (`concluded`); there is no time-based expiry this round (the
  stored `expiresAt`/24h value is currently unenforced — DO storage persists the lobby indefinitely).
  A **7-day-without-activity** expiry is recorded as **future work**, out of scope here. There is
  **no action that removes a player from the playerbase** — not a button, not a disconnect.
- **Exiting is navigation, not leaving.** Closing the screen / dropping the socket does **not**
  change membership. The player remains in the roster and re-enters from the Home "your lobbies"
  list at any time.
- **Presence is separate from membership.** "Currently viewing / online" is derived from live
  WebSocket connections and surfaced distinctly in the UI. It is transient; membership is not.

Validation therefore treats any disconnect → roster change, any `player_left` broadcast, or any
"vanishing player on reconnect" as a **defect to reproduce**, not expected behavior.

## LAN vs. deployed Worker — functional differences (explicit)

Per the scoping decision, testing happens against a local `wrangler dev` over LAN. The game
**logic is byte-identical** between LAN and a deployed Worker (same workerd, same WS message flow,
same DO state, same rules). The only real differences, called out as requested:

1. **Transport security (device-config only).** Deployed Cloudflare is `https`/`wss`; LAN
   `wrangler dev` is `http`/`ws`. A physical iOS/Android device may block cleartext WS to a LAN IP
   (iOS ATS, Android `usesCleartextTraffic`). Manual validation may need a cleartext exception that
   production does not. **No code difference.**
2. **Push notifications — un-validatable on LAN + Expo Go.** Expo Go (SDK 53+) dropped remote push
   on Android. Push (issue **I9**) therefore cannot be exercised on the LAN/Expo Go setup at all; it
   requires the Phase B6 Dev Build regardless of network. I9 is **deferred**, not covered here.
3. **Durable Object hibernation / alarms.** Server-side only (Cloudflare evicting an idle lobby DO
   from memory while parking its WebSockets at the edge, then re-instantiating from storage on the
   next event — `LobbyDO` enables it via `static options = { hibernate: true }`). Unrelated to the
   user's device. Behaves the same locally and deployed; lobby state persists in DO storage across
   it, which is what lets a lobby live until someone wins. No functional gap.

Everything else validated here behaves identically once deployed.

## Issue register

Severity from the agreed scope: **P0 + P1 this round.** P2 are documented open questions; deferred
items are out of this round's scope.

| ID | Severity | Issue | Validated by |
|----|----------|-------|--------------|
| I1 | P0 | Reconnect makes a player vanish from the roster (leave-on-disconnect membership bug) | Pure-rules test + Node WS harness + manual |
| I3 | P0 | Disconnect treated as a real leave (broadcasts `player_left`, fires push) instead of a transient presence change | Pure-rules test + Node WS harness + manual |
| I6 | P1 | Sticky error banner — `error` set on any rejected action, only cleared on connect/leave | Game-store unit test + manual |
| I7 | P1 | "Connecting…" forever — no timeout/actionable error when the Worker is unreachable | Realtime/store unit test + manual |
| I8 | P1 | No win/lose resolution — `game_ended` shows a generic "Game over" with no outcome | State assertion + manual |
| I10′ | P1 | Controls cluster top-left and are overlapped by system UI (status bar/notch) in Expo Go — missing safe-area insets | Manual device (visual) |
| I5 | P1 (documented limitation) | Owner who goes dark stalls the lobby (start is owner-only) — no time-based expiry to recover it this round | Documented; no fix this round |
| I2 | Deferred (Phase B) | Worker not deployed — true cross-network play impossible | Out of scope (LAN only) |
| I9 | Deferred (Phase B6) | Push needs a Dev Build; un-validatable on LAN/Expo Go | Out of scope |
| I10 | Dropped | Turn-order is intentional (any player may play anytime) | N/A |
| I11 | P2 (open question) | Mid-game joiner authoring flow is half-built | Confirm intent in fix spec |
| I12 | P2 (open question) | Reconnecting to a concluded lobby dead-ends at "Loading game…" | Confirm intent in fix spec |

## Platform parity & CI layering

The cross-platform question is **not** "web vs Android vs iOS look different" — it is
**platform-agnostic logic vs the runtime substrate it runs on**. Validation tiers follow that split,
and the existing CI already encodes it correctly, so **no CI architecture change is made this round.**

**Where behavior is identical (the game logic).** `packages/shared` (rules + WS contract) and
`apps/mobile/src/lib` + `src/state` are deliberately Expo-free with native deps injected (AGENTS.md),
so the reducers behave the same on every platform. This is ~all the game logic and is fully covered
by Node/vitest on the cheapest runner.

**Where behavior differs — substrate, not cosmetics.** The same logic runs on different substrates:

- **JS engine:** browser V8/JSC (web) vs **Hermes** (device). Hermes lacks
  `EventTarget`/`Event`/`MessageEvent`/`crypto` globals; AGENTS.md records three crashes that passed
  on web/Node and failed only on Hermes.
- **Native modules:** Expo Go bundles fixed native versions (a Reanimated JS/native mismatch crashed
  only on device).
- **Lifecycle/network:** backgrounding a mobile app **closes the WebSocket** — the exact reconnection
  path (I1/I3). Browser tabs do not behave this way, so **I1/I3 cannot be reproduced in the web/Node
  layers alone.**

**The validation pyramid (already in CI):**

| Tier | What it proves | Where | Substrate caveat |
|------|----------------|-------|------------------|
| 1. Platform-agnostic logic | Rules, reducers, message contract | Node/vitest (`ci.yml` `test`) | None — truly identical everywhere |
| 2. Integrated client + server loop | Auth, lobby, three-stage flow end-to-end | Playwright web (`ci.yml` `e2e`) | Browser substrate — **misses Hermes/native gaps** |
| 3. Hermes/native gate | Real device runtime (globals, native init, app lifecycle) | Maestro + Expo Go, Android emulator (`device.yml`) | Single device; iOS not duplicated |

**Android as the single device gate.** For game *functionality*, Android in Expo Go is a faithful
proxy for iOS — both run Hermes with the same JS and native module versions, so substrate gaps
manifest on both. iOS-specific deltas are **config/policy, not game logic** (ATS cleartext for LAN
`ws://`, push entitlements/APNs, safe-area inset values, keychain vs keystore) and are better covered
by targeted/manual checks than a duplicate macOS-runner suite. **iOS functional parity is therefore
by-construction**, not by a second CI functional gate.

**Consequences for this spec's validation routing:**

- **I1 / I3 (reconnection)** must be proven at **tier 1** (Node WS harness simulating a socket close)
  **and tier 3** (background/foreground + force-quit on the Android gate). Web e2e (tier 2) does
  **not** count as coverage for it, because the backgrounding→WS-close behavior does not exist in a
  browser.
- **I10′ (safe-area)** is a tier-3/manual item; insets differ by device (notch/iOS vs Android), so
  eyeball on both where possible — though the fix (`SafeAreaView`/insets) is platform-agnostic.
- Everything else (I6, I7, I8) is validated at tier 1 plus a manual confirmation.

## Validation strategy

Three layers, cheapest first:

1. **Pure-rules tests (`packages/shared`)** — deterministic, toolchain-independent. The reconnection
   membership defect (I1/I3) is fundamentally a rules-model question, so it reproduces cleanly here
   without a socket. This is the primary red test.
2. **Node WebSocket harness** — extend the existing `tmp/e2e-ws.mjs` pattern (Node 24 global
   `WebSocket` against `wrangler dev`) that already drives the full server loop, to cover a
   drop-and-reconnect mid-game. This validates the transport path that the vitest workers-pool can't
   (WS-in-test segfaults on this toolchain — see AGENTS.md).
3. **Unit tests (`apps/mobile`)** — store/realtime reducers for sticky error (I6) and connect
   timeout (I7).
4. **Manual two-device LAN matrix** — Hermes-only and visual items (I10′), plus a human pass of the
   reconnection and game-over flows. Extends Phase A4 rows 7–8 in `2026-06-21-remaining-work.md`.

### Per-issue validation

#### I1 / I3 — Reconnection must preserve membership; disconnect is presence-only

**Pure-rules red test** (`packages/shared/src/gameRules.test.ts`): the corrected model has no
`leave`-on-disconnect, so the test asserts that a player who drops and returns is still a member.

```text
- Build a room: addPlayer(p1, Alice), addPlayer(p2, Bob), readied, prep, submitted, startGame.
- Simulate the CURRENT onClose path: removePlayer(state, 'p1').
- Simulate reconnect: addPlayer(state, 'p1', 'Alice').
- ASSERT getLobbyMembers(state) still contains p1.            // currently FAILS — p1 vanished
- ASSERT getPlayerCards(state, 'p1') is unchanged (hand intact).
```

This fails today because `addPlayer` sees a historic `join` event, skips appending a new one, and
`getLobbyMembers` ends on the `leave`. The test encodes the intended invariant: **membership
survives a disconnect/reconnect cycle.**

**Node WS harness red step** (`tmp/e2e-ws-reconnect.mjs`, run against `wrangler dev`):

```text
- create lobby; connect Alice + Bob; ready -> prep -> submit -> start_game.
- Record Alice's hand from her state_update.
- Close Alice's socket; observe Bob's stream.
- ASSERT Bob does NOT receive player_left for Alice.          // currently FAILS — leave broadcast
- Reconnect Alice (same playerId); request_state.
- ASSERT Alice's roster still lists both players and her hand matches the pre-drop snapshot.
```

**Manual:** see matrix rows R1–R3.

#### I6 — Errors must be transient/clearable

**Store unit test** (`apps/mobile/src/state/game.test.ts`): drive an `error` server message, then a
successful `state_update`, and assert the error does not persist indefinitely (the fix spec decides
the exact clearing rule — e.g. cleared on the next successful state update or after a timeout). The
red assertion encodes "a stale rejection must not stay on screen across a subsequent valid update."

**Manual:** matrix row R5.

#### I7 — Unreachable Worker must surface an actionable state within a bounded time

**Realtime/store unit test** (`apps/mobile/src/lib/realtime.test.ts` or `game.test.ts` with a fake
socket that never emits `open`): assert that after a bounded timeout with no `open`, the store
exposes a distinct "could not connect" state rather than sitting in `connecting` forever.

**Manual:** matrix row R6 (point `.env` at a dead host).

#### I8 — Game end must expose an outcome

**State assertion** (`packages/shared` / store): assert the end-of-game state exposes enough to show
a result (who finished / a winner-or-loser concept), not just a boolean "ended." Today
`getFinishedPlayers` returns players whose hands emptied but the UI renders a generic "Game over"
with no outcome semantics. The fix spec defines the outcome model; this validation pins the gap.

**Manual:** matrix row R7.

#### I10′ — Safe-area insets

Visual, Hermes/Expo Go only. **Manual:** matrix row R8. (Optional post-fix guard: assert each screen
renders inside a safe-area wrapper once the fix lands.)

### Manual two-device LAN test matrix

Setup: `wrangler dev` on the dev box; `apps/mobile/.env` points at the LAN IP; two clients
(two phones in Expo Go, or one phone + the web build). Extends `2026-06-21-remaining-work.md` Phase A4.

| Row | Step | Expected (corrected model) |
|-----|------|----------------------------|
| R1 | Both clients join lobby; both ready; owner starts prep; both author + submit; owner begins game. | Both reach the game with 3 cards each. |
| R2 | Mid-game, **background** client 2 (home button), wait ~30s, **foreground** it. | Client 2 returns to its game with hand + roster intact; **client 1 never saw a "left" message**; no roster change. |
| R3 | Mid-game, **force-quit** client 2 and reopen the app; tap the lobby from Home "your lobbies". | Client 2 rejoins the same game, same hand/roster; still a member. |
| R4 | Client 2 taps "Back to home" from the game, then re-opens the lobby from Home. | Client 2 is still in the roster the whole time; returns to live state. |
| R5 | Non-owner taps an owner-only action (or trigger any rejected action). | Error message appears, then **clears** on the next valid update; not stuck on screen. |
| R6 | Stop `wrangler dev` (or use a wrong IP); open a lobby. | Within a few seconds, an actionable "can't connect" state — not an indefinite "Connecting…". |
| R7 | Play a full game to a hand emptying. | The end screen communicates an **outcome** (winner/loser/result), not a bare "Game over". |
| R8 | Inspect lobby/prep/game screens on a device with a notch/status bar. | Top controls sit below the status bar/notch; nothing overlapped or clustered into the corner. |

## Out of scope (this round)

- **I2 (deploy) / I9 (push):** Phase B / B6 follow-ups; un-testable on LAN + Expo Go.
- **I5 fix:** owner-offline stall is a **documented limitation**; no host-migration this round. With
  no time-based expiry, a stalled lobby simply persists — acceptable for a light-hearted game.
- **Lobby expiry:** lobbies live until `concluded`. A **7-day-inactivity** expiry is **future work**,
  not implemented or validated this round.
- **I10 (turn order):** intentional; not a defect.
- **I11 / I12:** P2 design questions resolved in the fix spec, not validated here.

## Self-review

- **Placeholders:** none — every issue has a concrete validation layer or an explicit deferral.
- **Consistency:** the membership/presence correction is applied uniformly; "leave" appears only as
  the defect being reproduced.
- **Scope:** focused on reproducing P0+P1; deferrals and P2 are listed but not specced here.
- **Ambiguity:** exact error-clearing rule (I6) and outcome model (I8) are deliberately left to the
  fix spec; this spec pins only the observable gap so the fix can choose the mechanism.
