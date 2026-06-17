# Agent Instructions

The role of this file is to describe common mistakes and confusion points that
agents might encounter as they work in this project. If you ever encounter
something that surprises you, alert the developer working with you and note it
here to help prevent future agents from having the same issue.

## Project Structure

- This is a greenfield project and it's okay to make drastic changes.
- TypeScript (Node v24) across an **npm-workspace monorepo**:
  - `apps/mobile` — Expo (React Native + react-native-web). **Mobile is the
    product; web is test-only.** Expo SDK 52.
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
- **Plans:** the live docs are `plans/migration-expo-cloudflare.md` (overall
  migration + status) and `plans/remaining-work.md` (executable remaining work).
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

## Architecture Notes & Resolved Confusion Points

### Workers test pool & dev-only audit advisories

`apps/party` is pinned to `@cloudflare/vitest-pool-workers@0.8.19` + `vitest@3.1.4`.
The newer pool (0.16.x) is audit-clean but its `/config` export does not resolve
under the current Vite, so it cannot be used yet. The 0.8.19 line carries
transitive advisories (vite/esbuild/undici/ws/devalue, and the vitest UI server
CVE) — ALL are in the test runner / dev tooling and are NEVER bundled into the
deployed Worker (`wrangler deploy` builds only `src/`). Do not run
`npm audit fix --force` to "fix" these: it will swap in the broken pool version.
Revisit when the newer pool line works with current Vite.

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

Same pinned pool, separate failure mode from the WS segfault. Symptom:
`Failed to pop isolated storage stack frame` / `Isolated storage failed`, with an
`EBUSY: ... unlink ...\Temp\miniflare-...\do\...LobbyDO\....sqlite` in the logs
above it (Windows releases the DO SQLite handle too late for the post-test
cleanup). Two known triggers:

- A test that **resolves the same Durable Object twice** in one test (e.g.
  `getServerByName` in a helper *and* again to read state back) — flaky here.
  `lobby.integration.test.ts`'s "persists created lobby state…" test hits this.
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
