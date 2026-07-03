# iOS PWA Rollout Runbook

> **For the human running this:** user-executed runbook (Phase-B style), not an
> agentic plan. Repeat it for **every** web release — the web build ships inside
> the Worker deploy. Design: `docs/superpowers/specs/2026-07-02-ios-pwa-design.md`.

**Goal:** Export the Expo web build with production config, deploy it with the
Worker, verify the PWA surface at the workers.dev URL, and pass the iPhone
install checklist.

**Prerequisites:** the Worker is already provisioned and deployed once (Phase B
runbook); wrangler is authenticated (`npx wrangler whoami`).

> **Gotcha:** `expo export` wipes `apps/mobile/dist/` first — including the
> tracked `.gitkeep`. After any export, restore it before committing anything:
> `git checkout -- apps/mobile/dist/.gitkeep` (or just don't stage the
> deletion). It only exists so `wrangler dev` works before an export.

## 1. Pre-deploy validation (optional but recommended)

From `apps/mobile`, run the exported-build suite against a local Worker:

    npm run e2e:clean
    $env:EXPO_PUBLIC_API_BASE_URL = 'http://127.0.0.1:8787'
    $env:EXPO_PUBLIC_PARTY_HOST = '127.0.0.1:8787'
    npx expo export --platform web
    npx playwright test --config playwright.exported.config.ts

Expected: 5 passed.

## 2. Export with production config

Env vars are baked into the bundle at export time — never committed (see the
env-config policy in the Phase B runbook). Replace `<subdomain>` with yours
(the URL Phase B deployed; `npx wrangler whoami` shows the account).

From `apps/mobile` (PowerShell):

    $env:EXPO_PUBLIC_API_BASE_URL = 'https://trapcard-party.<subdomain>.workers.dev'
    $env:EXPO_PUBLIC_PARTY_HOST = 'trapcard-party.<subdomain>.workers.dev'
    npx expo export --platform web

Expected: exits 0, writes `apps/mobile/dist/`.

> Don't mix steps 1 and 2: whichever export ran **last** is what deploys. Always
> re-export with the production values immediately before deploying.

## 3. Deploy

From `apps/party`:

    npx wrangler deploy

Expected: uploads static assets from `../mobile/dist` plus the Worker; prints
the workers.dev URL.

## 4. Verify the deployed surface

    curl.exe -s -o NUL -w "%{http_code}" https://trapcard-party.<subdomain>.workers.dev/manifest.json
    curl.exe -s -o NUL -w "%{http_code}" https://trapcard-party.<subdomain>.workers.dev/icons/icon-192.png
    curl.exe -s -o NUL -w "%{http_code}" https://trapcard-party.<subdomain>.workers.dev/api/auth/me

Expected: `200`, `200`, `401` (the API is still routed to the Worker, not the
SPA fallback). Then open the URL in a desktop browser: the app loads and login
works against production.

## 5. iPhone checklist (the final gate)

On an iPhone (iOS 16.4+), in Safari:

- [ ] Open the workers.dev URL → the game loads.
- [ ] Share → **Add to Home Screen** → the icon is the card glyph (not a
      screenshot), the label is **TrapCard**.
- [ ] Launch from the Home Screen → standalone (no Safari chrome), dark
      background, portrait.
- [ ] Register or log in.
- [ ] Kill the app (swipe away) → relaunch → still logged in (session
      restored from localStorage).
- [ ] Play a round across two clients (the iPhone + a desktop browser on the
      same deployment): create → join → ready → prep → play → winner shows on
      both.
- [ ] Mid-game, kill and relaunch the PWA → it reconnects into the lobby/game.

Any failure here: file it against the PWA phase and debug with the WebKit
Playwright project first — it reproduces most iOS Safari behavior locally.
