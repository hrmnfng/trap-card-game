# iOS PWA v1 — Design

**Date:** 2026-07-02
**Status:** Approved (design review with owner, this date)
**Context:** iOS distribution decision (see `plans/2026-06-21-remaining-work.md`):
native iOS was declined ($99/yr); iOS ships as a free installable PWA. Android
continues as a sideloaded native APK — this design does not touch that path.

## Goal

Make the existing Expo web build installable on an iPhone via Safari
"Add to Home Screen" as a standalone (no browser chrome) app, served from the
already-deployed `trapcard-party` Worker, with WebKit e2e coverage. **No push,
no offline support** — deliberately out of scope (see Non-goals).

## Decisions (locked with owner, 2026-07-02)

| Decision | Choice |
|----------|--------|
| Hosting | Same Worker, Cloudflare static assets (one deploy, same origin) |
| Icons | Programmatically generated placeholder (card glyph on theme dark) |
| Deploys | Manual runbook step (`expo export` → `wrangler deploy`) |
| WebKit coverage | Full existing e2e suite on Chromium **and** WebKit |
| HTML head customization | **Approach A:** switch `web.output` to `"static"` + `app/+html.tsx` |

Approach A alternatives considered and rejected: post-processing `index.html`
in the deploy script (hand-rolled tooling, breaks silently when Expo's template
changes); runtime JS injection of the manifest link (iOS reads the manifest at
page load — unreliable).

## Prerequisite (already landed)

Web session persistence: the auth store resolves storage lazily and web
persists the token via `localStorage` (`src/lib/expoStorage.web.ts`), with a
reload e2e test. Branch `fix/auth-storage-lazy-binding` (PR #13).

## Design

### 1. Install shell (`apps/mobile`)

- `public/manifest.json`: `name` "Trap Card Game", `short_name` "TrapCard",
  `display: "standalone"`, `orientation: "portrait"`, `start_url: "/"`,
  `theme_color`/`background_color` `#1a202c` (= `colors.bg` in
  `src/lib/theme.ts`), icons 192/512 plus a maskable variant.
- `public/icons/`: PNGs derived from a 1024px programmatic master (card glyph
  on the dark theme color) — 1024 master, 512, 192, 180 (`apple-touch-icon`),
  favicon. Generated once during implementation; the PNGs are committed, the
  generator script lives in `apps/mobile/scripts/` for regeneration.
- `app/+html.tsx`: Expo Router HTML shell adding `<link rel="manifest">`,
  `<link rel="apple-touch-icon">`, and `<meta name="theme-color">`.
- `app.json`: `web.output` `"single"` → `"static"` (required for `+html.tsx`);
  `expo.icon` set to the 1024 master (side benefit: the Android APK gets a
  real icon).
- **No service worker.** iOS 16.4+ installs standalone from the manifest
  alone; the game is online-only.

### 2. Hosting (`apps/party`)

`wrangler.toml` gains:

```toml
[assets]
directory = "../mobile/dist"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*", "/parties/*"]
```

- `run_worker_first` is **load-bearing**: without it, SPA fallback would
  answer `/api/*` calls and the `/parties/*` WebSocket upgrade with
  `index.html`.
- `not_found_handling = "single-page-application"` serves `index.html` for
  deep links (`/lobby/ABCD`), which the client router hydrates from the URL.
- A committed `apps/mobile/dist/.gitkeep` (directory contents gitignored)
  keeps `wrangler dev` working before an export exists. The local e2e is
  unaffected — it serves web from the Expo dev server on :8081.

### 3. Config

No code changes. `EXPO_PUBLIC_API_BASE_URL` / `EXPO_PUBLIC_PARTY_HOST` are
baked at export time in the runbook, pointed at the workers.dev URL
(consistent with the Android EAS-env approach; nothing committed). Same-origin
hosting makes CORS irrelevant for the PWA; the existing `*` headers stay for
LAN dev.

### 4. Testing

- `playwright.config.ts`: add a `webkit` project; the full 5-test suite runs
  on both engines (sequential, `workers: 1` unchanged).
- Implementation must validate the **exported** build, not just the dev
  server: `expo export --platform web` → serve `dist` via `wrangler dev` →
  smoke register/login + lobby create against it (catches static-export-only
  breakage).
- Final gate (owner-run, in the runbook): iPhone checklist — Add to Home
  Screen → standalone launch (no Safari chrome) → register/login → reload
  restores session → play a round across two clients → kill/relaunch
  reconnects to the lobby.

### 5. Rollout

A dated runbook (`plans/`, Phase-B style): export with env vars →
`wrangler deploy` → verify manifest/icons/API at the workers.dev URL → iPhone
checklist. Repeatable for every web release.

## Risks

- **Static export exercises screens at build time.** Components touching
  browser globals during render could break `expo export`. Caught by the
  export-smoke step and the two-engine e2e.
- **WebKit unknowns.** Nothing has ever run this app in WebKit; the new
  Playwright project exists precisely to surface this before the iPhone does.
- **`wrangler dev` + assets interplay.** The `.gitkeep` mitigation is
  asserted by running the existing e2e (which spins `wrangler dev`) after the
  wrangler.toml change.

## Non-goals (v1)

- **Web push** — separately-decided later phase (service worker + VAPID +
  Web Push protocol from the Worker; Expo push cannot reach browsers).
- **Offline support / service worker.**
- **Custom domain** (workers.dev URL is fine), **CI deploys**, **store
  listings**, and **Phase D visual polish** (deferred until the PWA ships —
  WebKit/standalone becomes a first-class target for any effects).
