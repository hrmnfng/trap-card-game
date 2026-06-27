# End-to-end (Playwright) tests

Browser tests that drive the Expo **web** build against a real local Cloudflare
Worker + Durable Object (HTTP + WebSocket). They automate the Phase A4 manual
matrix from `plans/2026-06-21-remaining-work.md`.

## Run

```bash
# from apps/mobile
npm run test:e2e          # headless
npm run test:e2e:ui       # Playwright UI mode
```

A `pretest:e2e` hook runs `npm run e2e:clean` first (`scripts/free-e2e-ports.mjs`),
which frees ports `8081`/`8787` so Playwright starts its **own** correctly-configured
services. This prevents the classic failure where a **manual `npx expo start`** (built
from `.env`'s LAN IP, not the e2e `127.0.0.1` override) gets reused and every test
fails at login with `Failed to fetch`. Run `npm run e2e:clean` by itself any time to
clear leftover dev servers.

`playwright.config.ts` starts both services via `webServer` (and **reuses** them
if already running, so a `wrangler dev` / `expo start --web` you already have up
is fine):

1. **Worker** — applies the local D1 schema, then `wrangler dev` on `:8787`.
2. **Expo web** — `expo start --web` on `:8081`, pointed at the local Worker via
   `EXPO_PUBLIC_*` env (overrides `apps/mobile/.env`, whose LAN IP is for
   physical devices).

First run is slow (Metro's initial web bundle); subsequent runs are ~8s.

## Coverage

- `auth.spec.ts` — register → authenticated Home; logout → login round-trip.
- `multiplayer.spec.ts` — two isolated browser contexts ("two devices"): host
  creates a lobby, guest joins by code, both see each other, the non-owner has
  no Start control; both players ready up, the owner starts prep, each authors
  and submits 3 statements, the owner begins the game → each has a 3-card hand,
  and a played card surfaces its statement on both clients (hand count drops,
  history shows on both). Then it covers the cross-device guarantees: the guest
  **exits the game and re-enters from Home** with their hand and roster intact
  (permanent membership / reconnection over a real socket close+reopen), and the
  host **empties their hand** so both clients show the winner banner naming the
  first-to-empty.

## Web-build gotchas (baked into `helpers.ts`)

- **Stacked screens stay mounted.** Expo Router keeps previously-visited screens
  in the DOM (hidden), so a `/ → /login → /` round trip leaves two Home screens.
  Every locator is wrapped in `vis()` (`.filter({ visible: true })`) to target
  the active screen and to make count assertions (e.g. "three cards") correct.
- **Navigations carry a `?__EXPO_ROUTER_key=` query string.** `waitForURL`
  matchers must not anchor with `$`; read route params from
  `new URL(page.url()).pathname`, not by splitting the raw URL.
- **`testID`** on a React Native component renders as `data-testid` on web, so
  `getByTestId(...)` works against the same components used on native.
