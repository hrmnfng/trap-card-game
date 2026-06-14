# Trap Card Game

A real-time multiplayer card game built on **hidden information** and **targeted
interaction**: each player holds cards only they can see, plays one against another
player, and the value is then revealed to everyone. Mobile is the product; the web
build exists for testing.

## Architecture

An npm-workspace monorepo on TypeScript (Node 24):

- **`apps/mobile`** — Expo (React Native + react-native-web), Expo SDK 52. The
  client: expo-router screens, Zustand stores, a `partysocket` realtime client.
- **`apps/party`** — Cloudflare Worker + a PartyServer Durable Object (`LobbyDO`,
  one per lobby) holding live game state in DO SQLite. Backed by **D1** (accounts,
  device tokens, lobby history) and **KV** (opaque auth tokens). Replaces the
  retired FastAPI + Redis + Postgres backend.
- **`packages/shared`** (`@trap/shared`) — single source of truth for the domain
  types, the WebSocket message contract, and the pure, deterministic game rules.

Auth is username + password only (PBKDF2 via Web Crypto, no email/recovery); tokens
are opaque values in KV. Push notifications use **Expo Push** (mobile only, requires
an Expo Dev Build on device).

Two design choices worth knowing up front:

- **The game rules are pure and event-sourced.** `packages/shared/src/gameRules.ts`
  keeps an append-only `events` log as the authoritative data; hands, counts, and
  history are *derived* by replaying it. Randomness, ids, and timestamps are injected
  via `RuleDeps`, so the rules are deterministic and unit-testable, and the *same*
  rules run on the client and inside the Durable Object.
- **Realtime state is per-viewer.** A client opens a WebSocket to
  `/parties/lobby/<code>?playerId=&username=` (the PartyServer namespace is the
  kebab-case of the DO binding `LOBBY` → `lobby`). On each change `LobbyDO` broadcasts
  the action event (e.g. `card_played`) then a full `state_update` computed *per
  connection*, so a player sees real card values only for their own hand.

## Game mechanics

1. **Lobby**: create or join with a 6-character code (joining = connecting over the
   WebSocket; there is no HTTP join).
2. **Deal**: each player starts with 3 hidden cards (values 1–9).
3. **Play**: choose a hidden card and target another player. There is **no turn
   order** (free-for-all).
4. **Reveal**: the card's value becomes public; the targeted player is notified.
5. **End**: the game concludes the moment any player who has played a card runs out
   of cards.

## Code map

Where the major pieces live:

**`packages/shared/src`** — the single source of truth (used by both other workspaces):
- `types.ts` — domain types (`GameState`, `Card`, `GameEvent`, …) + `DEFAULT_GAME_SETTINGS`.
- `messages.ts` — the WebSocket contract (`ClientMessage`/`ServerMessage` + `parseClientMessage`).
- `gameRules.ts` — the pure, event-sourced rules engine (`addPlayer`, `startGame`,
  `playCard`, `getGameState`, `hasGameEnded`); `testUtils.ts` supplies deterministic `RuleDeps`.

**`apps/party/src`** — the Cloudflare backend:
- `server.ts` — Worker entry: REST routes (auth, lobby create, lobby history, device
  tokens), CORS, and WS routing to the DO.
- `LobbyDO.ts` — the Durable Object: live game state, WS message handling, broadcasts,
  `lobby_history` writes, and Expo push triggers.
- `auth.ts` / `password.ts` — register/login, opaque tokens (KV), PBKDF2 hashing.
- `history.ts` — `lobby_history` upserts. `push.ts` — Expo push. `env.ts` — typed
  bindings. `db/schema.sql` — D1 schema (`users`, `device_tokens`, `lobby_history`).

**`apps/mobile`** — the Expo client:
- `app/` — expo-router screens: `_layout.tsx` (wires native storage, restores session),
  `login.tsx`, `index.tsx` (Home), `lobby/[code].tsx`, `game/[code].tsx`.
- `src/lib/` — `apiClient.ts` (REST), `realtime.ts` (partysocket WS), `config.ts`
  (`EXPO_PUBLIC_*`), `storage.ts`/`expoStorage.ts`, `push.ts`, `theme.ts`.
- `src/state/` — Zustand stores as injectable factories: `auth.ts`, `game.ts`, `hooks.ts`.
  The `lib` + `state` **core is Expo-free** (native deps injected at the app entry), so
  it unit-tests under Node. `e2e/` holds the Playwright browser tests.

To change things: game rules → `packages/shared/src/gameRules.ts`; the WS contract →
`messages.ts` (both ends); a REST endpoint → `apps/party/src/server.ts`; a screen →
`apps/mobile/app/*` + a store in `src/state/`.

## Prerequisites

- Node.js 24+ and npm (workspaces).
- A Cloudflare account (for remote deploy; local dev uses Miniflare, no account
  needed).
- Expo tooling for the mobile app (`npx expo …`); an Expo Dev Build for on-device
  push.

## Setup

```bash
npm install          # installs all workspaces from the repo root
```

## Running locally

**Worker** (from `apps/party`):

```bash
npm run db:apply:local      # apply src/db/schema.sql to the local (Miniflare) D1
npx wrangler dev            # serves on http://127.0.0.1:8787
```

**Mobile** (from `apps/mobile`): create a git-ignored `.env`, then start Expo:

```bash
# .env
EXPO_PUBLIC_API_BASE_URL=http://<LAN-IP>:8787   # localhost for web/simulator
EXPO_PUBLIC_PARTY_HOST=<LAN-IP>:8787            # host:port, no scheme
```

```bash
npx expo start              # press w (web), i/a (simulators), or scan for a device
```

See `QUICKSTART.md` for the end-to-end local + deploy walkthrough.

## Testing & typechecking

```bash
npm test                                  # all workspaces
npm run test:shared                       # packages/shared
npm run test:party                        # apps/party (Vitest workers pool)
npm run test --workspace=@trap/mobile     # apps/mobile

npm run typecheck                         # packages/shared
npm run typecheck --workspace=@trap/party
npm run typecheck --workspace=@trap/mobile
```

Browser end-to-end tests (Playwright, drives the Expo **web** build against a live
local Worker) live in `apps/mobile/e2e/` — run `npm run test:e2e` from `apps/mobile`.
The config starts (or reuses) `wrangler dev` + `expo start --web` automatically. See
`apps/mobile/e2e/README.md`.

Mobile health checks (from `apps/mobile`): `npx expo-doctor`, `npx expo install --check`.

> Note: some `apps/party` integration tests are `describe.skip` due to a Windows
> quirk in the pinned `@cloudflare/vitest-pool-workers` (in-test WebSocket upgrades
> segfault; DO storage cleanup can hit `EBUSY`). See `AGENTS.md` for details and the
> reliable test patterns.

## Deploying

```bash
# from apps/party
npx wrangler d1 create trapcard            # -> copy database_id into wrangler.toml
npx wrangler kv namespace create TOKENS    # -> copy id into wrangler.toml
npm run db:apply:remote                    # apply schema to the remote D1
npx wrangler deploy                        # deploy the Worker
```

Point the production app config at the deployed URL via `EXPO_PUBLIC_*`, and build
the mobile app with EAS (`eas build`). Full steps in `QUICKSTART.md`.

## Project structure

```
trap-card-game/
├── apps/
│   ├── mobile/            # Expo client (app/ routes, src/lib, src/state)
│   └── party/             # Worker + LobbyDO (src/, test/, src/db/schema.sql)
├── packages/
│   └── shared/            # @trap/shared: types, messages, gameRules
├── docs/superpowers/      # feature specs & implementation plans
├── plans/                 # migration plan + remaining work
├── AGENTS.md              # conventions, gotchas, resolved confusion points
├── CLAUDE.md              # guidance for Claude Code
└── README.md
```

## Contributing

Test-driven: outline tests and function contracts before functional changes. Keep
`packages/shared` the single source of truth for cross-cutting types and the WS
contract. Read `AGENTS.md` before editing — it documents the project's sharp edges.

## License

MIT
