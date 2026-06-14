# Trap Card Game — Remaining Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> superpowers:subagent-driven-development) to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the migrated stack from "code complete + unit-verified" to "validated
end-to-end, deployed, and with the legacy Vue/FastAPI stack removed."

**Architecture:** Expo (RN) client ↔ Cloudflare Worker + PartyServer Durable Object
(`LobbyDO`) over WebSocket, with D1 (accounts/devices/history) + KV (tokens). Shared
types/rules in `@trap/shared`.

**Tech Stack:** TypeScript, npm workspaces, Expo SDK 52, PartyServer, Cloudflare
Workers/D1/KV, Wrangler, Vitest.

---

## Current Status (entering this plan)

| Area | State |
|------|-------|
| `packages/shared` (types, messages, game rules) | ✅ built, 25 tests pass |
| `apps/party` (Worker, LobbyDO, auth, push) | ✅ 26 tests pass, 4 WS-transport tests `.skip` (test-pool segfault) |
| `apps/mobile` (Expo app) | ✅ code complete, 28 unit tests pass, typecheck clean, `expo-doctor` 18/18 |
| End-to-end on a real device | ❌ not yet run |
| Cloudflare resources (D1 id, KV id) provisioned | ❌ `wrangler.toml` has `REPLACE_WITH_*` placeholders |
| Worker deployed | ❌ |
| Legacy `frontend/` + `backend/` removed | ❌ (Phase 6) |
| Graphics polish | ❌ (Phase 7, deferred/low priority) |

**Gating rule:** Do NOT start Phase C (cutover / deleting the old stack) until Phase A
(end-to-end validation) passes. The old stack is the only known-working fallback.

---

## Phase A — Local End-to-End Validation (the gate)

**Goal:** Prove register → login → create/join → start → play → push → reconnect →
persistence works against a locally-running Worker, from at least two clients.

**Files:**
- Reference: `apps/party/wrangler.toml`, `apps/party/src/db/schema.sql`, `apps/party/package.json`
- Create: `apps/mobile/.env` (git-ignored)

- [x] **Step A1: Start the Worker locally with a fresh local D1.** ✅ 2026-06-10: `db:apply:local` applied schema; `wrangler dev` Ready on http://127.0.0.1:8787 with local D1/KV/DO bindings.

Run (from `apps/party`):
```bash
npm run db:apply:local        # applies src/db/schema.sql to the local D1
npx wrangler dev              # serves on http://127.0.0.1:8787 (note the LAN URL it prints)
```
Expected: wrangler prints `Ready on http://127.0.0.1:8787` (and a `http://<LAN-IP>:8787`).
Local dev uses Miniflare's local D1/KV, so the `REPLACE_WITH_*` ids don't matter yet.

- [x] **Step A2: Smoke-test the REST API with curl (no app needed).** ✅ 2026-06-10: register→200+token (dup→409), login→200, `POST /api/lobbies`→`{code,status:"waiting"}`, bad token→401. NOTE: lobby state is served by the DO at `/parties/lobby/<code>/state?playerId=<id>`, NOT `/api/lobbies/<code>/state` (no such Worker route).

Run:
```bash
curl -s -XPOST http://127.0.0.1:8787/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"username":"alice","password":"password1"}'
```
Expected: JSON `{"userId":"...","username":"alice","token":"..."}` (HTTP 200).
Then create a lobby with the returned token:
```bash
curl -s -XPOST http://127.0.0.1:8787/api/lobbies -H 'authorization: Bearer <token>'
```
Expected: `{"code":"XXXXXX","status":"waiting"}`.

- [x] **Step A3: Point the mobile app at the Worker.** ✅ 2026-06-10: created git-ignored `apps/mobile/.env` with LAN IP `192.168.1.31:8787`.

Create `apps/mobile/.env` with the dev machine's LAN IP (so a physical device can reach it):
```
EXPO_PUBLIC_API_BASE_URL=http://<LAN-IP>:8787
EXPO_PUBLIC_PARTY_HOST=<LAN-IP>:8787
```
(For the iOS simulator / web you may use `localhost`/`127.0.0.1`; a physical device needs the LAN IP or a tunnel.)

- [ ] **Step A4: Run the app and complete the manual test matrix.**

Run (from `apps/mobile`):
```bash
npx expo start          # press w for web, i/a for simulators, or scan for a device
```
Complete this matrix with two clients (e.g. web + simulator, or two devices):

- [ ] Register a new user; app lands on Home authenticated.
- [ ] Log out, log back in (validates token persistence via secure-store / restoreSession).
- [ ] Client 1 creates a lobby; both clients open `/lobby/<code>` and see each other.
- [ ] Owner (client 1) taps Start with 2 players; both navigate to `/game/<code>`, each shows 3 cards.
- [ ] Client 1 selects a card and plays it on client 2; both see the `card_played` reflected and hands/counts update.
- [ ] Non-owner Start attempt is rejected (no crash; nothing happens / error surfaced).
- [ ] Kill and reopen a client mid-lobby; it reconnects to the same lobby and state.
- [ ] Leave wait ~ and re-fetch `/parties/lobby/<code>/state?playerId=<id>` — lobby still present (durability).

Expected: all rows pass. Log any failure as a bug and fix before Phase C.

> **Automated A4 coverage — Playwright (2026-06-14):** rows 1–6 are now covered by
> a browser e2e suite that drives the Expo **web** build against a live local
> Worker (`apps/mobile/e2e/`, run with `npm run test:e2e` from `apps/mobile`).
> `playwright.config.ts` starts/reuses `wrangler dev` (:8787, schema applied
> first) + `expo start --web` (:8081). `auth.spec.ts` covers register +
> logout/login; `multiplayer.spec.ts` uses two isolated browser contexts to cover
> create/join (both see each other), non-owner-has-no-Start, owner start → 3-card
> deal, and a played card reflected on both clients. Two web-build quirks are
> handled in `e2e/helpers.ts` and documented in `e2e/README.md`: Expo Router keeps
> previous screens mounted (hidden) — every locator is `.filter({ visible: true })`
> via `vis()`; and navigations append a `?__EXPO_ROUTER_key=` query string — so
> `waitForURL` must not `$`-anchor and route params are read from the pathname.
> `testID`s were added to the four screens (render as `data-testid` on web).
> Rows 7–8 (kill/reopen reconnect, durability re-fetch) remain a manual pass.

> **A4 bug fixed (2026-06-10):** web login/register threw *"'fetch' called on an
> object that does not implement interface Window."* Root cause: `apiClient.ts`
> stored the global `fetch` on the instance (`this.fetchImpl = ... ?? fetch`) and
> called it as `this.fetchImpl(...)`, so on the web build `fetch`'s `this` was the
> ApiClient, not `Window`. Fixed by wrapping the default in a free-function
> indirection (`const globalFetch: typeof fetch = (i, init) => fetch(i, init)`).
> Added a regression test that emulates the browser WebIDL `this`-guard (29/29 mobile
> tests pass, typecheck clean). Native/unit paths never hit it because they inject a
> mock `fetchImpl`.

> **Protocol-level pre-validation (2026-06-10):** A two-client WebSocket e2e harness
> (`tmp/e2e-ws.mjs`, run with Node 24's global `WebSocket` against `wrangler dev`) drives
> the full server loop and passes 18/18: create → two-client join → owner assignment →
> non-owner `start_game` rejected (`not_owner`) → owner start → 3-card deal → `play_card`
> (value + hand/count updates) → drop & reconnect recovers in-progress state + hand →
> HTTP state persistence → play-to-end → `concluded`. This proves the realtime contract
> end-to-end on real workerd; the remaining A4 rows below are the **client/UI** pass that
> still needs a human at a device/simulator/browser. (Also confirms the 4 `.skip`ped WS
> tests fail only in the in-process workers test-pool, not in the product.)

> **Feature added during validation — lobby history (2026-06-10):** the new stack
> shipped without the legacy "your lobbies" list (users had to type a code after
> re-login). Implemented end-to-end: the `LobbyDO` records a `lobby_history` row per
> participating user on join/start/conclude (D1), the Worker serves
> `GET /api/lobbies/history`, and the Expo Home screen lists them (active = tap to
> rejoin, concluded = shown but disabled). Upserts use UPDATE-then-INSERT (no
> `ON CONFLICT`) so they don't need the unique index. Spec/plan:
> `docs/superpowers/specs/2026-06-10-lobby-history-design.md`,
> `docs/superpowers/plans/2026-06-10-lobby-history.md`. Tests: `apps/party/test/history.test.ts`
> + `history.integration.test.ts` (D1/Worker only — they avoid a DO round-trip), plus the
> mobile `apiClient` test.

> **Pre-existing test-pool flake observed (2026-06-10):** `lobby.integration.test.ts`'s
> "persists created lobby state…" test (which resolves the **same** Durable Object twice via
> `getServerByName`) intermittently fails its post-test cleanup with
> `EBUSY … unlink …\Temp\miniflare-…\do\…LobbyDO\….sqlite` → "Failed to pop isolated storage
> stack frame." This is a Windows file-handle-release quirk in the pinned
> `@cloudflare/vitest-pool-workers`, **not** a product or lobby-history regression (that test
> never touches `lobby_history`). Same family as the `.skip`ped WS tests. New history tests
> were written to avoid the DO double-resolution so they're reliable.

- [ ] **Step A5: (Optional but recommended) re-enable the skipped WS tests to confirm they pass on a non-crashing platform.**

If running on macOS/Linux CI later, temporarily change `describe.skip` →
`describe` in `apps/party/test/lobby.integration.test.ts` and run `npm run test:party`.
Expected on a working workerd: all 6 integration tests pass. Revert the `.skip` only
if still on the crashing Windows/workerd build.

---

## Phase B — Cloudflare Provisioning & Deploy

**Goal:** Create the real D1 + KV resources, wire them into `wrangler.toml`, apply the
remote schema, and deploy the Worker. Set up an Expo dev build so push works on device.

**Files:**
- Modify: `apps/party/wrangler.toml` (replace the two `REPLACE_WITH_*` ids)
- Reference: `apps/party/src/db/schema.sql`, `apps/mobile/app.json`

- [ ] **Step B1: Create the D1 database.**

Run (from `apps/party`):
```bash
npx wrangler d1 create trapcard
```
Expected: prints a `database_id`. Copy it into `wrangler.toml` replacing
`REPLACE_WITH_D1_DATABASE_ID`.

- [ ] **Step B2: Create the KV namespace for tokens.**

Run:
```bash
npx wrangler kv namespace create TOKENS
```
Expected: prints an `id`. Copy it into `wrangler.toml` replacing
`REPLACE_WITH_KV_NAMESPACE_ID`.

- [ ] **Step B3: Apply the schema to the remote D1.**

Run:
```bash
npm run db:apply:remote      # wrangler d1 execute trapcard --remote --file=./src/db/schema.sql
```
Expected: reports the executed statements (tables created) with no error.

- [ ] **Step B4: Deploy the Worker.**

Run:
```bash
npx wrangler deploy
```
Expected: prints the deployed `https://trapcard-party.<subdomain>.workers.dev` URL.
Smoke-test it with the Step A2 curls against that URL.

- [ ] **Step B5: Point the production app config at the deployed Worker.**

Set `EXPO_PUBLIC_API_BASE_URL=https://trapcard-party.<subdomain>.workers.dev` and
`EXPO_PUBLIC_PARTY_HOST=trapcard-party.<subdomain>.workers.dev` (no scheme) for
production builds (e.g. via EAS env / `eas.json`).

- [ ] **Step B6: Create an Expo Dev Build for on-device push.**

Push notifications require a Dev Build (not Expo Go). Run:
```bash
npx expo install expo-dev-client   # if not present
npx eas build --profile development --platform ios   # and/or android
```
Then verify: after login on the device, `POST /api/devices` is called (check Worker
logs via `npx wrangler tail`) and a `device_tokens` row appears. Trigger a card-played
event from another client and confirm the targeted user receives a push.

---

## Phase C — Cutover & Cleanup (Phase 6)

**Goal:** Remove the legacy stack and refresh user-facing docs. **Only after Phase A
passes** (and ideally Phase B is deployed).

**Files:**
- Delete: `frontend/`, `backend/`, `docker-compose.yml`
- Modify: `README.md`, `QUICKSTART.md`
- Reference: `AGENTS.md` (already refreshed), `plans/migration-expo-cloudflare.md`

- [ ] **Step C1: Confirm nothing in the new stack imports the legacy code.**

Run:
```bash
grep -rEn "(\.\./)?(frontend|backend)/" apps packages --include=*.ts --include=*.tsx
```
Expected: no matches (the new code is self-contained). If any appear, resolve first.

- [ ] **Step C2: Delete the legacy frontend, backend, and Docker compose.**

Run:
```bash
git rm -r frontend backend docker-compose.yml
```
(Also remove now-orphaned PWA/Python artifacts if any remain: `frontend/dev-dist`,
`frontend/dist`, `.pytest_cache`.)

- [ ] **Step C3: Rewrite `README.md` for the monorepo.**

Replace stack/run instructions with: monorepo layout (`apps/mobile`, `apps/party`,
`packages/shared`), prerequisites (Node 24, a Cloudflare account, Expo tooling), and
the run commands (`wrangler dev`, `expo start`, the `npm test` matrix). Remove all
Docker/Postgres/Redis/FastAPI references.

- [ ] **Step C4: Rewrite `QUICKSTART.md`.**

Distill Phase A + Phase B of this plan into a short "get it running locally / deploy it"
guide. Remove the old docker-compose quickstart.

- [ ] **Step C5: Dependency audit.**

Run:
```bash
npm audit --workspace=@trap/mobile
```
Expected: review findings; do NOT `npm audit fix --force` in `apps/party` (see AGENTS.md
test-pool note). Python audit no longer applies (backend removed).

- [ ] **Step C6: Full verification + commit.**

Run:
```bash
npm test            # shared + party + mobile all green
```
Then commit the cutover (with user approval, per AGENTS.md):
```bash
git add -A
git commit -m "chore: cut over to Expo + Cloudflare; remove legacy Vue/FastAPI stack"
```

---

## Phase D — Graphics & Visual Polish (Phase 7, deferred / low priority)

**Goal:** Add the deferred visual polish using `@react-three/fiber/native` + `expo-gl`
so effects run on both mobile and web. **Deferred** until functional parity is proven;
do not start before Phases A–C.

This phase is an outline (not bite-sized steps) because the effects are creative and
should be brainstormed before implementation. Acceptance is visual + "no regression in
the game flow / frame rate," so build it behind the existing screens without changing
the game/store contracts.

- [ ] **D1:** Add deps via `npx expo install @react-three/fiber expo-gl three`; configure
  Metro for `glb`/asset extensions if needed.
- [ ] **D2:** Animated gradient background behind menu/lobby (custom GLSL shader material).
- [ ] **D3:** Liquid-metal logo/splash on Home (port the GLSL idea from liquid-logo's Paper Shaders).
- [ ] **D4:** 3D/animated cards in `app/game/[code].tsx` (flip + shader), driven by the
  existing `gameState`/`lastCardPlayed` store fields — no new server contract.
- [ ] **D5:** Win/lose & event celebration effects on `gameEnded` / `card_played`.
- [ ] **D6:** Optionally use shadergradient/liquid-logo directly on the web-test build via
  `Platform.select`, with the R3F-native version as the canonical mobile path.

Constraint: effects must be cross-platform (R3F-native), since shadergradient/liquid-logo
are web-DOM WebGL and have no documented native Expo path.

---

## Self-Review Notes

- **Spec coverage:** Covers the migration plan's outstanding items — Phase 5 device
  validation (A), the previously-undocumented Cloudflare provisioning/deploy gap (B),
  Phase 6 cutover (C), and Phase 7 graphics (D).
- **Gating:** Phase C is explicitly gated on Phase A to protect the working fallback.
- **Known sharp edges referenced:** PartyServer namespace = binding kebab (`lobby`),
  `getServerByName` addressing, the workers test-pool WS segfault, Expo Dev Build for push.
