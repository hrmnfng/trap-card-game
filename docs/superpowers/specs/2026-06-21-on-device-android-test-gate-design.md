# On-device Android test gate (Maestro + Expo Go) — design

Date: 2026-06-21
Status: Approved (pre-implementation)

## Problem

The Playwright e2e suite runs the **web** build in a browser, so it executes on
V8 with the full set of browser globals and a pure-JS Reanimated. The product
runs on **Hermes** (React Native) with a lean global set and native modules.
That gap let three "passes on web, crashes on device" regressions reach a real
device during the Expo SDK 54 upgrade:

- Reanimated JS/native version mismatch (native module init crash at boot)
- `partysocket` needing `EventTarget`/`Event` (missing Hermes globals, boot)
- `partysocket` needing `crypto.randomUUID()` (missing Hermes global, on WS
  connect when entering a game)

No web-side test can catch this class — it must run on Hermes (a device or
emulator). This spec adds an automated CI gate that does exactly that.

## Goals

- Run the app on a real Hermes runtime in CI and walk the core flow
  (login → lobby → in-progress game → play a card), failing the build on a crash.
- Catch the boot-time **and** WS-connect-time Hermes gaps (all three bug classes
  above) automatically.
- Keep it cheap enough to run on the PRs that matter, plus nightly.

## Non-goals

- iOS coverage (Android only to start; the bug class is engine/global-level, not
  platform-specific, and iOS needs paid macOS runners).
- Testing the exact release binary. We test the **dev runtime** (Hermes via
  Expo Go), which is where these bugs live — no EAS build, no signing.
- Replacing the Playwright web e2e or the vitest unit tests. This is an
  additional layer, not a replacement.
- Push-notification / EAS dev-build setup (separate concern).

## Approach

Driver: **Maestro** (simple YAML flows, no app code changes, Expo-recommended).
Venue: **Expo Go + Metro** on an Android emulator — the bugs all reproduce in
Expo Go, so no native build is required. A Node **player-2 helper** participates
over the real API/WebSocket so the device can reach an in-progress game with a
single emulator.

## Components

### 1. Maestro flows — `apps/mobile/.maestro/`

- `smoke.yaml` — open the project in Expo Go; assert the **login screen renders**.
  Catches boot-time crashes (Reanimated native init, EventTarget global).
- `game.yaml` — register/login as player 1; **join** the lobby using
  `${LOBBY_CODE}`; wait for the game to start; assert the game screen + dealt
  cards are visible; **play a card**; assert the hand shrinks. Catches the
  WS-connect / game-entry path (the `crypto` crash).

Flows select by `testID`/visible text against the rendered RN tree inside Expo Go
(appId `host.exp.exponent`). Entry uses an `exp://10.0.2.2:8081` deep link
(`openLink`) so Expo Go loads our project rather than its home screen.

Flows mirror the existing Playwright specs (`apps/mobile/e2e/auth.spec.ts`,
`multiplayer.spec.ts`) so coverage intent stays consistent across web and device.

### 2. Player-2 helper — `apps/mobile/maestro/player2.mjs`

A Node script (reuses `@trap/shared` types; may reuse `partysocket`) that:

1. registers a second user via the Worker API,
2. **creates the lobby** (becoming owner) and prints `LOBBY_CODE=<code>` to stdout,
3. waits (polling lobby state / WS) until player 1 (the device) has joined,
4. as owner, sends `start_game`,
5. stays connected so the in-progress game persists while the device plays.

Rationale for the role split (helper owns/creates, device joins): the lobby code
is server-generated, so having the helper create it and the device join avoids
the hard problem of extracting the code *out* of the device UI into the shell.

### 3. CI workflow — `.github/workflows/device.yml`

A **separate workflow file** (not a job in `ci.yml`) because its triggers
(path-filtered PRs + nightly schedule + manual dispatch) differ from `ci.yml`'s
run-on-everything model. Runner: `ubuntu-latest` (KVM-enabled), Android emulator
via `reactivecircus/android-emulator-runner`.

Sequence:

1. checkout; `setup-node` (24); `npm ci`; `npm run build:shared`.
2. apply local D1 schema; start the Worker: `wrangler dev --ip 0.0.0.0 --port 8787`
   (the emulator reaches the host at `10.0.2.2`; `wrangler.toml [dev]` already
   binds `0.0.0.0`).
3. start Metro: `expo start` with
   `EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8787` and
   `EXPO_PUBLIC_PARTY_HOST=10.0.2.2:8787` (these are read by Metro at bundle
   time — no rebuild needed).
4. boot the emulator; ensure **Expo Go** is installed (`expo start --android`
   auto-installs it; fallback: fetch the SDK-54 Expo Go APK from Expo's versions
   endpoint and `adb install`); open the project via the `exp://10.0.2.2:8081`
   deep link.
5. start the player-2 helper in the background; capture `LOBBY_CODE` from its
   stdout.
6. install Maestro; run `maestro test --env LOBBY_CODE=<code> apps/mobile/.maestro/`.
7. on failure, upload Maestro screenshots/video as artifacts.

### Data flow / coordination

```
helper: register p2 -> create lobby -> print LOBBY_CODE ----> workflow captures code
                                  \-> wait for p1 join -> start_game -> stay connected
device (Maestro): login p1 -> join LOBBY_CODE -> wait game start -> assert -> play card
Worker (wrangler dev, 0.0.0.0:8787) <- 10.0.2.2 -> emulator (Expo Go + our JS)
```

## Triggers / cadence

- `pull_request` filtered to paths: `apps/mobile/**`, `packages/shared/**`,
  `package-lock.json`, `apps/mobile/.maestro/**`, and the workflow file (where
  this regression class originates).
- nightly `schedule`.
- `workflow_dispatch` (manual).

Runs on its own concurrency group (consistent with the existing
event+branch concurrency keying). Android only.

## Risks & mitigations

- **Expo Go on a CI emulator.** Happy path: `expo start --android` auto-installs
  Expo Go. Fallback: fetch the SDK-54 Expo Go APK from Expo's versions endpoint
  and `adb install`. Validate which is reliable during implementation; keep the
  fallback documented.
- **Maestro interacting inside Expo Go.** Target the rendered RN tree by
  `testID`/text. Add `testID`s to the few lobby/game components that lack stable
  selectors. Use `openLink` to load the project, not Expo Go's home.
- **Emulator / Metro startup timing & flakiness.** Health-wait on the Worker
  (`:8787`) and Metro (`:8081`) before launching; rely on Maestro auto-waits;
  allow one retry on the Maestro step.
- **Slower than the web jobs (~several minutes).** Mitigated by path-filtering +
  nightly cadence rather than every PR.
- **Dev-mode warnings** (reduced-motion, SafeAreaView deprecation,
  expo-notifications-in-Expo-Go) are benign and must not fail the run; assertions
  target UI state, not log output.

## Prerequisites

- None requiring paid services or account secrets (no EAS, no `EXPO_TOKEN`).

## Success criteria

- The `device` job boots Expo Go on the emulator, runs both flows green, and
  fails loudly if the app crashes at boot or on entering a game.
- Re-introducing any of the three known regressions (e.g. reverting the
  `crypto`/`EventTarget` polyfills or pinning Reanimated 3) makes the job fail.
- The job runs on path-filtered PRs, nightly, and on manual dispatch.

## Out-of-scope / future

- iOS (macOS runners) coverage.
- Testing the release/EAS binary in addition to the dev runtime.
- A dedicated EAS dev build for push-notification testing.
```
