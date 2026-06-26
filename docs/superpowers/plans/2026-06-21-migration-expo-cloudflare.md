# Migration Plan: Trap Card Game → Expo + Cloudflare/PartyServer

> Extracted from a prior planning/build session (`opencode.history`, now removed).
> This is the source of truth for the in-progress migration off the Vue PWA +
> FastAPI/Redis/Postgres stack onto Expo (React Native) + Cloudflare Workers,
> Durable Objects (PartyServer), D1, and KV.

## Status Snapshot (as of extraction, 2026-06-09)

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | npm workspace root + `packages/shared` scaffold (types, messages contracts + tests) | ✅ completed |
| 1 | Port game rules to `packages/shared/src/gameRules.ts` (TDD — tests first) | ✅ completed |
| 2 | Worker auth + D1 schema + device tokens (TDD) | ✅ completed |
| 3 | `LobbyDO` Durable Object (PartyServer) with DO SQLite state | ✅ completed |
| 4 | Expo Push notifications (3 triggers) + tests | ✅ completed |
| 4b | `LobbyDO` integration test (connect/start/play via WebSocket) | ✅ completed (WS-transport tests `.skip` — see below) |
| 5 | Expo app (expo-router, Zustand, PartySocket, screens) | ✅ code complete + verified (typecheck/tests/doctor); device run pending (user) |
| 6 | Cutover — delete old `frontend/`/`backend/`, update docs, `npm audit` | ⬜ pending (medium) |
| 7 | Graphics polish with R3F native (deferred effects) | ⬜ pending (low) |

Phases 0–4 produced real code under `apps/party/` and `packages/shared/`. The work
lives on branch `feat/game-mechanics` (committed + pushed).

### Post-extraction updates (2026-06-10)
- **Lobby history shipped.** The `LobbyDO` records a `lobby_history` row per
  participating user on join / start / conclude (D1), the Worker serves
  `GET /api/lobbies/history`, and the Expo Home screen lists them (active = tap to
  rejoin; concluded = shown, disabled). Upserts use UPDATE-then-INSERT (no
  `ON CONFLICT`). Design: `docs/superpowers/specs/2026-06-10-lobby-history-design.md`.
- **Web-build fixes during A4 prep:** CORS preflight now returns a bodyless 204
  (a 204-with-body threw in workerd → "NetworkError" on web); the API client calls
  the global `fetch` as a free function (browser WebIDL `this`-binding). Both are
  documented in `AGENTS.md`.
- **Status:** Phase A's device/UI pass (A4) is still the outstanding gate; Phases
  B (deploy) and C (cutover) follow. See `plans/2026-06-21-remaining-work.md`.

### Phase 4b resolution (2026-06-09)

Investigation found the original integration-test failure had **two real root-cause
bugs** (now fixed) plus **one environmental tooling limitation** (documented + skipped):

1. **DO name resolution (production bug, fixed).** `server.ts` provisioned lobbies with
   a raw `env.LOBBY.idFromName(code)` + direct `stub.fetch()`. PartyServer cannot
   resolve a DO's name from a raw stub when the runtime doesn't expose `ctx.id.name`
   (the test pool doesn't), so it threw `Cannot determine the name for LobbyDO`. Fixed
   by using PartyServer's documented `getServerByName(env.LOBBY, code)`, which persists
   the name record (`__ps_name`) so the subsequent WebSocket connect (routed via
   `routePartykitRequest`) always resolves.
2. **Party namespace mismatch (latent production bug, fixed).** The DO binding is
   `LOBBY`, whose PartyServer kebab namespace is **`lobby`** — but the WebSocket URLs
   used `lobby-do` (the class-name kebab). The WS route would have 404/400'd in
   production. All URLs/clients must use `/parties/lobby/:code`.
3. **workerd test-pool segfault (environmental, skipped).** Opening a WebSocket via
   `SELF.fetch` crashes the workerd build bundled with
   `@cloudflare/vitest-pool-workers@0.8.19` (workerd `1.20250417.0`) on Windows
   (`structured exception 0xc0000005: access violation`), even for one connection.
   The 4 WS-transport tests are wrapped in `describe.skip` with a documented reason;
   the realtime path will be validated against `wrangler dev` + the Expo client in
   Phase 5. Re-enable once the toolchain ships a workerd that handles in-test WS
   upgrades on this platform.

Result: `npm run test:party` → **26 passed, 4 skipped**; party `tsc` clean; shared
**25 passed**. HTTP-level DO integration (create + state persistence) runs and passes.

---

## Locked Decisions

| Area | Decision |
|---|---|
| Frontend | **Expo** (RN + react-native-web), npm workspaces. **Mobile = product, web = test-only** |
| Realtime | **PartyServer + Cloudflare Durable Objects** (1 DO per lobby). Retires FastAPI WS + Redis |
| Persistence | **D1** (accounts, device tokens, history) + **DO SQLite** (live game state). Retires Postgres |
| Auth | **Minimal Worker auth**: username + password (PBKDF2 via Web Crypto), opaque token in KV. No email, no recovery |
| Push | **Expo Push, mobile only**. No Web Push |
| Push triggers | card-played-targeting-you · player joined/left · game started/ended |
| Turn order | **Not enforced** (free-for-all; events driven externally) |
| Graphics | **Deferred to Phase 7** (R3F native): animated gradient bg, liquid logo/splash, 3D cards, win/lose & event effects |
| Repo | **Clean rewrite in place** (replace `frontend/` + `backend/`) |

## Target Structure

```
trap-card-game/
  package.json                # npm workspaces: apps/*, packages/*
  apps/
    mobile/                   # Expo (iOS/Android product; web for testing)
      app/                    # expo-router: index, login, lobby/[code], game/[code]
      src/components/         # GameBoard, LobbyWaiting, Card, etc. (RN)
      src/state/              # Zustand stores: auth, lobby, game (port from Pinia)
      src/lib/                # partysocket client, api client, push registration
      app.config.ts
    party/                    # Cloudflare Worker + Durable Object
      src/server.ts           # Worker entry: auth/lobby HTTP routes, DO binding
      src/LobbyDO.ts          # PartyServer DO = one lobby (live state in DO SQLite)
      src/auth.ts             # username/password + token (D1 + KV)
      src/push.ts             # Expo Push send helper
      src/db/schema.sql       # D1: users, device_tokens, lobby_history
      wrangler.toml
  packages/
    shared/                   # @trap/shared
      src/types.ts            # unified contract (fixes current drift)
      src/gameRules.ts        # ported from backend/app/services/game.py
      src/messages.ts         # WS message contract (client <-> DO)
```

---

## Phase 0 — Workspace & Shared Contracts (TDD foundation) ✅
- Root `package.json` with npm workspaces (`apps/*`, `packages/*`).
- Build `packages/shared` first:
  - `types.ts` — port `frontend/src/types/index.ts` + `backend/app/models/schemas.py`;
    **unify status to `waiting | in-progress | concluded`** and unify the WS event union
    (resolves the documented contract drift).
  - `messages.ts` — preserve existing protocol: client→DO (`get_state`, `start_game`,
    `play_card`, `ping`); DO→client (`connected`, `state_update`, `player_joined`,
    `player_left`, `game_started`, `card_played`, `game_ended`, `error`, `pong`).
- **Write contracts + Vitest tests before logic** (per AGENTS.md).

## Phase 1 — Port Game Rules (`packages/shared/gameRules.ts`) ✅
Pure, framework-agnostic TS over an in-memory event log (keeps event-sourced design),
ported from `backend/app/services/game.py`:
- `distributeCards`, `playCard`, `getPlayerCards`, `getRemainingCardsCount`,
  `playerOwnsCard`, `isCardPlayed`, `getGameState` (per-player filtering: own card values
  visible, others' counts only), `hasGameStarted`, `hasGameEnded`.
- Preserve mid-game-joiner provisioning + end condition (only counts players who've played).
- Timestamps as ISO strings/epoch in TS (eliminates the `.isoformat()` serialization hazard).
- Vitest tests mirroring current behavior (incl. mid-game join + end condition).

## Phase 2 — Worker: Auth + D1 + Device Tokens ✅
- `wrangler.toml`: bind D1, KV (tokens), DO class `LobbyDO`.
- `db/schema.sql`:
  - `users(id, username UNIQUE, password_hash, created_at)`
  - `device_tokens(id, user_id, expo_token, platform, created_at)`
  - `lobby_history(id, code, user_id, status, owner_id, owner_username, player_count, created_at, joined_at)`
- `auth.ts` (port `services/auth.py` + `password.py`): `POST /api/auth/register`,
  `POST /api/auth/login` → `{user_id, username, token}`, `GET /api/auth/me`.
  **PBKDF2 via Web Crypto** (no bcrypt on Workers). Token = opaque value in KV w/ TTL
  (mirrors 7-day Redis token).
- `POST /api/devices` — register Expo push token for authed user.
- Tests via `@cloudflare/vitest-pool-workers` / Miniflare.

## Phase 3 — Lobby as a Durable Object (PartyServer) ✅
- `LobbyDO.ts` extends PartyServer `Server`; DO id = lobby code; live state in
  **DO SQLite** → **persists across days** (core requirement).
- Hooks (port `api/websocket.py` + `services/lobby.py`):
  - `onConnect` — validate active lobby, register connection, send `connected` +
    per-player `state_update`; idempotent rejoin.
  - `onMessage` — `get_state` / `start_game` (owner-only, ≥2 players, `distributeCards`,
    broadcast `game_started` + per-player `state_update`) / `play_card` (validate via
    shared rules, broadcast `card_played` + `state_update`) / `ping`.
  - `onClose` — handle leave.
  - **`room.broadcast`** replaces both `ConnectionManager.broadcast` and Redis pub/sub.
- `onRequest` (HTTP push/pull): `POST /api/lobbies` (mint code), `GET /api/lobbies/:code/state`.
- Per-player filtered `my_cards` via `getGameState(state, connectionUserId)`.

## Phase 4 — Push Notifications (Expo, server-triggered) ✅
- `push.ts`: `sendExpoPush(tokens, payload)` → `https://exp.host/--/api/v2/push/send`.
- Wire only the 3 chosen triggers in `LobbyDO`: card-played-targeting-you,
  player joined/left, game started/ended → look up target user(s) `device_tokens` in
  D1 → send (fires even when offline).
- DO **Alarms** noted as the mechanism if future scheduled/time-based pushes are added
  (architected for, not built now).
- Tests: mock Expo endpoint; assert recipients per event.

## Phase 4b — LobbyDO integration test 🔧 (BLOCKED — see Status Snapshot)

## Phase 5 — Expo App (replaces Vue PWA) ✅ (code complete + verified; device run pending)

**Built (`apps/mobile`, Expo SDK 52, react-native 0.76.9):**
- Testable core (zero Expo imports, 28 vitest unit tests, typecheck clean):
  - `src/lib/config.ts` — `EXPO_PUBLIC_*` env config (wrangler-dev defaults).
  - `src/lib/storage.ts` — injectable `KVStorage` (in-memory default; Expo impl injected at app entry).
  - `src/lib/apiClient.ts` — REST client for the Worker (register/login/me, createLobby, registerDevice); camelCase contract, `ApiError` with status+code.
  - `src/lib/realtime.ts` — `LobbyConnection` over an injectable socket (default PartySocket, party namespace `lobby`); typed `@trap/shared` messages.
  - `src/state/auth.ts` — Zustand auth store (factory + singleton), token persisted via storage.
  - `src/state/game.ts` — unified realtime lobby+game store driven by `state_update`.
- UI shell (typecheck clean; runs on device — user-verified later):
  - `src/lib/expoStorage.ts` (expo-secure-store), `src/lib/push.ts` (expo-notifications → `/api/devices`),
    `src/lib/apiSingleton.ts`, `src/lib/theme.ts`, `src/state/hooks.ts` (zustand React bindings).
  - `app/_layout.tsx` (wires storage, restores session, Stack nav), `app/index.tsx` (Home: create/join/logout),
    `app/login.tsx` (register/login + push registration), `app/lobby/[code].tsx` (waiting room + start),
    `app/game/[code].tsx` (GameBoard: hand, opponents, play card, history, end).
  - Config: `app.json`, `babel.config.js`, `metro.config.js` (monorepo, doctor-clean), `tsconfig.json` (extends `expo/tsconfig.base`), `expo-env.d.ts`.
- Verification run: `npm run test --workspace=@trap/mobile` → 28 passed; `tsc` clean; `npx expo install --check` up to date; `npx expo-doctor` 18/18.

**Remaining for the user (cannot run a device/simulator from the build CLI):**
`npx expo start` (or a dev build) on a device — exercise register/login, create/join,
start, play card, push, reconnect. This is the live validation of the realtime path
(also re-enables confidence in the Phase 4b WS tests that the test pool can't run).

Original plan items, all addressed above:
- Scaffold Expo + `expo-router` + TS; enable web output for testing.
- **Zustand** stores replace Pinia (`auth`, `lobby`, `game`), incl. reconnect/saved-session
  via `expo-secure-store`/`AsyncStorage`.
- **PartySocket** (`partysocket`) replaces hand-rolled `services/websocket.ts` (keeps
  reconnect/buffering).
- API client ports `services/api.ts` + `auth.ts`.
- Screens from Vue views: `index` (Home), `login` (UserLogin), `lobby/[code]`
  (Create+Waiting), `game/[code]` (GameBoard) as RN components.
- Push registration via `expo-notifications` → `POST /api/devices` after login.
  (Requires an **Expo Dev Build**, not Expo Go, for push on device.)

## Phase 6 — Cutover & Cleanup ⬜
- Verify parity: register/login, create/join, start, play card, the 3 push events,
  reconnect across app restart, **lobby persists across days**.
- Delete `frontend/`, `backend/`, `docker-compose.yml`, PWA artifacts (`dev-dist/`,
  `dist/`, SWs, manifest config).
- Update `README.md`, `QUICKSTART.md`, `AGENTS.md` (remove Redis/datetime/PWA learnings;
  add Workers-PBKDF2-not-bcrypt, DO-state, Expo-Dev-Build notes).
- `npm audit` on `apps/mobile`. Python audit no longer applicable.

## Phase 7 — Graphics & Visual Polish (deferred, R3F native) ⬜
- Add `@react-three/fiber/native` + `expo-gl` + `three`; configure Metro for assets.
- Build effects as **custom R3F shader materials (GLSL)** so they run on mobile *and* web
  (avoids shadergradient/liquid-logo's web-only DOM dependency):
  1. **Animated gradient background** behind menu/lobby (shadergradient-style flowing gradient).
  2. **Liquid-metal logo / splash / home hero** (port the GLSL idea from liquid-logo's Paper Shaders).
  3. **3D / animated cards** in `GameBoard` (flip + shader).
  4. **Win/lose & event celebration** effects on game start/end and card-played-against-you.
- Optionally use shadergradient/liquid-logo directly *only* in the web-test build via
  `Platform.select`, with the R3F-native version as the canonical mobile path.

---

## Key Risks / Notes
- **No bcrypt on Workers** → PBKDF2 (Web Crypto). Greenfield, so no user-hash migration needed.
- **Expo Push requires a Dev Build** on physical devices (not Expo Go); plan an `eas build` dev profile.
- **DO is single-threaded per lobby** → removes Redis fan-out and the current dual-broadcast drift.
- **shadergradient/liquid-logo are web-DOM WebGL** → Phase 7 reimplements their looks in
  R3F-native for true cross-platform; the original libs are optional web-only extras.
- **react-native-web caveats** accepted since web is test-only.
- **vitest-pool-workers isolated storage** → integration tests that cross the SELF.fetch /
  WebSocket boundary can trip `Isolated storage failed`; prefer DO-stub fetch and
  event-driven waits over `setTimeout` polling (Phase 4b lesson).
