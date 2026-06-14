# End-to-end (Playwright) tests

Browser tests that drive the Expo **web** build against a real local Cloudflare
Worker + Durable Object (HTTP + WebSocket). They automate the Phase A4 manual
matrix from `plans/remaining-work.md`.

## Run

```bash
# from apps/mobile
npm run test:e2e          # headless
npm run test:e2e:ui       # Playwright UI mode
```

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
  no Start control, the owner starts → each is dealt 3 cards, and a played card
  is reflected on both clients (hand count drops, history shows on both).

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
