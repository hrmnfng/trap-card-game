# Agent Instructions

The role of this file is to describe common mistakes and confusion points that
agents might encounter as they work in this project. If you ever encounter
something that surprises you, alert the developer working with you and note it
here to help prevent future agents from having the same issue.

## Project Structure

- This is a greenfield project and it's okay to make drastic changes.
- TypeScript (Node v24) across an **npm-workspace monorepo**:
  - `apps/mobile` — Expo (React Native + react-native-web). **Mobile is the
    product; web is test-only.** Expo SDK 54.
  - `apps/party` — Cloudflare Worker + PartyServer Durable Object. One
    `LobbyDO` per lobby code holds live game state in DO SQLite storage.
    Replaces FastAPI WebSockets + Redis pub/sub.
  - `packages/shared` (`@trap/shared`) — single source of truth for types, the
    WS message contract, and the pure game rules (ported from the legacy
    `backend/app/services/game.py` and `lobby.py`).
- D1 holds durable account data (`users`, `device_tokens`, `lobby_history`).
  Auth is username + password only (no email/recovery); opaque tokens in KV.
  `lobby_history` is written by the `LobbyDO` (on join / start / conclude) and
  read via `GET /api/lobbies/history` — it backs the Home "your lobbies" list.
- The legacy `frontend/` (Vue PWA) and `backend/` (FastAPI/Redis/Postgres) stacks
  have been **removed** (Phase 6 cutover landed). The repo is now the monorepo above.
- **Plans:** the live docs are `plans/2026-06-21-migration-expo-cloudflare.md` (overall
  migration + status) and `plans/2026-06-21-remaining-work.md` (executable remaining work).
  Feature designs live under `docs/superpowers/`.

## Code Standards

- All development follows test-driven design: outline tests/plans and function
  contracts before functional changes.
- **Always run `npm run lint` before committing** (ESLint + markdownlint must
  pass; CI enforces it). Fix findings rather than disabling rules.
- DRY — abstract reusable components where possible.
- Don't litter the codebase with emojis.
- Check vulnerabilities with `npm audit` per workspace (but read the test-pool
  note below before running `npm audit fix --force` in `apps/party`).

## Verify / Test Commands

- Everything: `npm test` (runs each workspace's tests).
- Per workspace: `npm run test:shared`, `npm run test:party`,
  `npm run test --workspace=@trap/mobile`.
- Typecheck: `npm run typecheck` (shared) / `--workspace=@trap/party` /
  `--workspace=@trap/mobile`.
- Lint (from repo root): `npm run lint` — ESLint (TS/JS) + markdownlint (docs);
  or `npm run lint:js` / `npm run lint:md`. **Run before every commit** (CI runs it too).
- Mobile health (from `apps/mobile`): `npx expo-doctor`, `npx expo install --check`.
- Worker dev (from `apps/party`): `npx wrangler dev`.
- Browser e2e (from `apps/mobile`): `npm run test:e2e` — Playwright drives the Expo
  **web** build against a live local Worker; the config starts/reuses `wrangler dev`
  - `expo start --web`. See `apps/mobile/e2e/README.md`.
- On-device (Android, Hermes): `.github/workflows/device.yml` runs Maestro flows
  (`apps/mobile/.maestro/`) against Expo Go on an emulator, with a Node player-2
  helper (`apps/mobile/maestro/player2.mjs`). This is the only layer that catches
  Hermes-only gaps (native modules, missing web globals) — see `apps/mobile/maestro/README.md`.

## Architecture Notes & Resolved Confusion Points

### Workers test pool & dev-only audit advisories

`apps/party` is pinned to `@cloudflare/vitest-pool-workers@0.12.21` + `vitest@3.2.6`
(shared/mobile are also on `vitest@3.2.6`). `0.12.21` is the **ceiling for this
setup**: pool `0.8.57 – 0.12.x` support `vitest 2.0.x - 3.2.x` *and* keep the
`@cloudflare/vitest-pool-workers/config` subpath that `vitest.config.ts` imports
`defineWorkersConfig` from; pool `0.13.0+` jumps to `vitest ^4.1.0` **and drops the
`/config` export** (it ships a `codemods/vitest-v3-to-v4` instead), so moving past
`0.12.x` requires a Vitest 4 migration + a config-import rewrite. The `3.2.6` bump
cleared the two `npm audit` **criticals** (the Vitest UI-server CVE + the pool
aggregator) and the `devalue` high. Residual advisories on this line
(miniflare/undici/ws/esbuild + the pool's nested wrangler) are ALL in the test
runner / dev tooling and are NEVER bundled into the deployed Worker
(`wrangler deploy` builds only `src/`). Do not run `npm audit fix --force` to "fix"
these: it swaps in the `vitest 4` pool line. Revisit (Vitest 4 migration) when
that line is worth adopting.

The remaining `npm audit` advisories are all dev/build-time tooling with no
deployed-runtime exposure: the test-pool chain above; the Expo **build** toolchain
(`@expo/cli`/`config`/`metro-config`/`prebuild-config`, `postcss`, `uuid` via
`xcode`, `react-native`'s jest/babel test deps) — only cleared by SDK 56 /
RN 0.86 majors; and `markdownlint-cli2`'s `markdown-it`/`js-yaml` (docs lint;
npm's "fix" is a downgrade). A root `overrides` for `postcss` does **not** take
(npm leaves Expo's nested `~8.4.x` copy in place), and forcing `uuid` past `xcode`'s
`^7` pin risks breaking iOS prebuild — neither is worth it for build-time-only
advisories. Revisit the Expo cluster at the next SDK upgrade.

### Account recovery (operator password reset)

No self-service recovery. To reset a forgotten password, an operator runs (from
`apps/party`):

    npm run reset-password -- <username> <newPassword> [--remote]

It reuses the Worker's PBKDF2 `hashPassword` and applies an `UPDATE users …` via
`wrangler d1 execute` — local Miniflare by default, `--remote` for production D1.
`--remote` uses your existing `wrangler login` session (or a scoped
`CLOUDFLARE_API_TOKEN` for non-interactive/CI use); there is no separate DB secret.
`--remote` needs the real `database_id` in `wrangler.toml` (set at deploy time).

### Game rules are pure and deterministic

`packages/shared/src/gameRules.ts` is framework-agnostic and side-effect free.
Randomness (card values) and id/timestamp generation are injected via `RuleDeps`,
so tests are reproducible (see `testUtils.ts`). The `LobbyDO` supplies
runtime-backed `RuleDeps` (`crypto.randomUUID`, `Math.random`, `Date`).

### Single broadcast path (no dual-path drift)

`LobbyDO` uses PartyServer's single `broadcast`/`getConnections` for everything
(the legacy backend had an in-memory `ConnectionManager` AND Redis pub/sub, which
could drift). Per-player filtered state is sent by iterating connections and
calling `getGameState(room, playerId)` per connection. Broadcast order for an
action: send the action event (e.g. `card_played`) first, then the full
`state_update`. All payloads are JSON-serializable — timestamps are ISO strings,
never `Date` objects (this removes the legacy `datetime not serializable` hazard).

### PartyServer addressing: name resolution + namespace

- Address the lobby DO via `getServerByName(env.LOBBY, code)` or
  `routePartykitRequest` — NOT raw `env.LOBBY.idFromName(code)` + `stub.fetch()`.
  PartyServer must know the room name; in the vitest-pool-workers runtime
  `ctx.id.name` is undefined, and PartyServer recovers the name from a persisted
  `__ps_name` record that `getServerByName`/`setName` writes. A raw `stub.fetch()`
  throws `Cannot determine the name for LobbyDO`.
- The PartyServer **party namespace is the kebab-case of the DO binding name**
  (`LOBBY` → `lobby`), NOT the class name (`LobbyDO`). Clients (PartySocket) and
  WS URLs use `/parties/lobby/:code`.

### WebSocket integration tests crash the test pool

Opening a WebSocket via `SELF.fetch` segfaults the workerd bundled with
`@cloudflare/vitest-pool-workers@0.8.19` (workerd `1.20250417.0`) on Windows
(`structured exception 0xc0000005: access violation`), even for one connection.
The 4 WS-transport tests in `apps/party/test/lobby.integration.test.ts` are
`describe.skip`; the HTTP-level DO tests (create + state) run. Validate the
realtime path against `wrangler dev` + the Expo client. Re-enable once the
toolchain ships a workerd that handles in-test WS upgrades on this platform.

### Test pool: isolated-storage / EBUSY failures (Windows)

Separate failure mode from the WS segfault. Symptom:
`Failed to pop isolated storage stack frame` / `Isolated storage failed`
(`AssertionError: Expected .sqlite, got ...sqlite-shm`), with an
`EBUSY: ... unlink ...\Temp\miniflare-...\do\...LobbyDO\....sqlite` in the logs
above it on Windows. The pool can't pop a test's storage frame while the DO's
SQLite WAL (`.sqlite-shm`) is still open. **On pool 0.12.x this is a hard error
that fails the whole suite on Linux CI too** (not just Windows EBUSY). Triggers:

- A test that **reads DO storage back after writing it** in the same test —
  `getServerByName` in a helper to create, then resolving the DO again to read
  `/state`. `lobby.integration.test.ts`'s "persists created lobby state…" test
  hits this and is **`it.skip`ped** on the 0.12.x pool (its coverage lives in the
  create test, `history.integration.test.ts`, and the Playwright e2e).
- Adding a **UNIQUE index** on `lobby_history` to the test D1 in
  `test/setup.ts` — reproducibly trips it (prod `schema.sql` keeps the index;
  the test schema deliberately omits it).
Guidance: write new integration tests against the **Worker + D1 only** (no DO
round-trip) — see `apps/party/test/history.integration.test.ts`. D1 unit tests
(`history.test.ts`) are fine. Keep D1 upserts index-independent: `recordLobbyHistory`
uses **UPDATE-then-INSERT**, not `INSERT ... ON CONFLICT`, so it needs no unique index.

### CORS preflight must be bodyless

Browsers (Expo web) send an `OPTIONS` preflight before cross-origin JSON POSTs.
The Worker must answer with a **bodyless** 2xx carrying the `Access-Control-*`
headers. A 204 with a body throws in workerd (`Response with null body status ...
cannot have a body`), yielding a 500 with no CORS headers that the browser reports
as "NetworkError when attempting to fetch resource." `server.ts` uses
`new Response(null, { status: 204, headers: CORS_HEADERS })` via `preflight()`.

### Mobile core is Expo-free and unit-tested

`apps/mobile/src/lib` + `src/state` avoid importing Expo / React Native so they
run under vitest (Node). Native dependencies are injected, not imported:
`configureStorage(...)` for storage, a `socketFactory` for `LobbyConnection`, and
store factories (`createAuthStore`/`createGameStore`) take deps. The Expo-backed
implementations live in `src/lib/expoStorage.ts` and `src/lib/push.ts` and are
wired only at the app entry (`app/_layout.tsx`). Mobile uses **extensionless**
relative imports (for Metro), unlike `packages/shared` / `apps/party` which use
`.js` extensions.

### Expo SDK 54: Reanimated 4 + worklets, explicit `babel-preset-expo`

Two non-obvious constraints from the SDK 52 → 54 upgrade:

- **`react-native-reanimated` must be `~4.1.1` + `react-native-worklets@0.5.1`**,
  the versions SDK 54's **Expo Go** ships natively. Expo Go is a prebuilt binary;
  its native modules can't be swapped, so the JS must match. We initially pinned
  Reanimated **3** (moti is built on RA3) — the web build (JS-only) worked and e2e
  passed, but Expo Go on a device crashed at startup with
  `Exception in HostObject::get for prop 'ReanimatedModule'` (a `NativeProxy`
  NullPointerException) because JS RA3 met native RA4. `moti@0.30` has no RA4
  release but its peer is `react-native-reanimated: "*"` and it works with RA4 for
  the **simple** `MotiView`/`AnimatePresence` fades/translates this app uses (avoid
  RA4-only CSS/keyframe features through moti). Reanimated 4 needs New Architecture
  (`newArchEnabled: true`, already on) and the Babel plugin moved: `babel.config.js`
  uses **`react-native-worklets/plugin`** (LAST), not `react-native-reanimated/plugin`.
- **`babel-preset-expo` is an explicit `devDependency`.** In this workspace npm
  nests it under `node_modules/expo/node_modules`, where Metro/Babel (resolving
  from `apps/mobile`) can't find it — the web bundle then 500s with
  `Cannot find module 'babel-preset-expo'`. Listing it directly hoists it to the
  root `node_modules` where it resolves.
- **`partysocket` needs the `EventTarget`/`Event`/`MessageEvent` web globals**,
  which Hermes (React Native) lacks. Missing `EventTarget`/`Event` crashes at load
  (`PartySocket requires a global 'EventTarget' class` / `Property 'Event' doesn't
  exist`); missing `MessageEvent` crashes on the first WS message
  (`Property 'MessageEvent' doesn't exist`), so the lobby/game silently never
  update. `src/lib/partysocketPolyfills.ts` imports `partysocket/event-target-polyfill`
  (Event/EventTarget) then defines a minimal `MessageEvent`; `src/lib/realtime.ts`
  (the sole partysocket importer) imports it **before** `partysocket`. All
  conditional/no-op where the globals exist (browser web build, Node/vitest), so
  the e2e and unit tests don't catch these — only a device/Hermes run does (the
  `device.yml` gate).
- **`partysocket` also needs a global `crypto`** at *connect* time
  (`crypto.randomUUID()` for the connection id). Hermes has no `crypto` global, so
  the bare reference throws `Property 'crypto' doesn't exist` when entering a
  game/lobby (optional chaining doesn't guard an undeclared identifier).
  `src/lib/cryptoPolyfill.ts` installs `globalThis.crypto` from **`expo-crypto`**
  (bundled in Expo Go; works on web) and is imported **first** in
  `app/_layout.tsx`. It is conditional (no-op where `crypto` exists) and lives
  *outside* the Expo-free `src/lib` test surface since it imports `expo-crypto`.
  Same web/Node-pass-but-Hermes-fail blind spot as the EventTarget gap above.

### Regenerate `package-lock.json` with a clean full install (cross-platform)

`vitest` pulls in `rollup`, which has per-platform optional binaries. npm's
optional-dep bug ([npm/cli#4828](https://github.com/npm/cli/issues/4828)) means an
**incremental** `npm install` (or repeated `rm package-lock.json && npm install`)
on Windows prunes the lockfile's `@rollup/rollup-*` entries down to just `win32`.
CI (Linux `npm ci`) then dies with `Cannot find module @rollup/rollup-linux-x64-gnu`.
Fix: regenerate with a **clean full install** — `rm -rf node_modules **/node_modules
package-lock.json && npm install` — which writes all ~25 platform entries. Verify
`@rollup/rollup-linux-x64-gnu` is in the lockfile before committing. (Same applies
to other native optional deps; the clean install is the reliable path.)

### Call the global `fetch` as a free function (web)

The web build throws `'fetch' called on an object that does not implement
interface Window` if the global `fetch` is stored on an instance and invoked as a
method (`this.fetchImpl(...)`), because the browser's WebIDL binding requires
`fetch`'s `this` to be the global. `apiClient.ts` defaults to a free-function
indirection (`const globalFetch: typeof fetch = (i, init) => fetch(i, init)`).
Node/RN don't enforce this; an injected mock `fetchImpl` bypasses it, so unit
tests need the regression test that emulates the browser `this`-guard.

### Playwright e2e on the web build — two locator gotchas

The browser e2e suite (`apps/mobile/e2e/`) drives the Expo web build, where two
Expo-Router-on-web behaviours bite naive selectors (both handled in `e2e/helpers.ts`):

- **Previous screens stay mounted (hidden).** A `/ → /login → /` round trip leaves
  two Home screens in the DOM, so a locator matches 2 elements (one hidden). Wrap
  every locator in `.filter({ visible: true })` (the `vis()` helper) to target the
  active screen — this also makes count assertions (e.g. "three cards") correct.
- **Navigations append `?__EXPO_ROUTER_key=`.** `waitForURL` matchers must not
  `$`-anchor on the path, and route params (the lobby code) must be read from
  `new URL(page.url()).pathname`, not by splitting the raw URL.
Components get `testID`s (e.g. `create-lobby`, `hand-card`), which react-native-web
renders as `data-testid`, so `getByTestId` works against the same native components.

### Worker static assets: `run_worker_first` is load-bearing

- **`[assets].run_worker_first` in `apps/party/wrangler.toml` is load-bearing.**
  The Worker serves the exported web build (`apps/mobile/dist`) as static assets
  with SPA fallback; without `run_worker_first = ["/api/*", "/parties/*"]` the
  fallback would answer API calls and the WebSocket upgrade with `index.html`.
  `apps/mobile/dist/.gitkeep` keeps the directory present so `wrangler dev`
  works before an export exists.

### `expo start` in CI needs `--offline`

- Since `eas init` wrote `owner` + `extra.eas.projectId` into `apps/mobile/app.json`,
  a plain `npx expo start` tries to authenticate against the EAS account to sign the
  dev-server manifest. Locally that's invisible (you're logged in); in non-interactive
  CI it dies with `CommandError: Input is required` and Expo Go shows "Something went
  wrong". Any workflow that starts Metro must pass `--offline` (anonymous manifest
  signatures, no network auth) — see the Device workflow's "Start Metro" step.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **trap-card-game** (919 symbols, 1641 relationships, 53 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/trap-card-game/context` | Codebase overview, check index freshness |
| `gitnexus://repo/trap-card-game/clusters` | All functional areas |
| `gitnexus://repo/trap-card-game/processes` | All execution flows |
| `gitnexus://repo/trap-card-game/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
