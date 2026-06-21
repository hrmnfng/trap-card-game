# Quick Start

Get the Trap Card Game running locally, then deploy it. For architecture and the
full command reference see `README.md`; for conventions and gotchas see `AGENTS.md`.

## Prerequisites

- Node.js 24+ and npm.
- Expo tooling (`npx expo …`) for the mobile app.
- A Cloudflare account — only for the deploy section (local dev uses Miniflare).

```bash
npm install            # from the repo root; installs all workspaces
npm run build:shared   # build packages/shared (dist/ required by the Worker bundler)
```

## 1. Run it locally

### Worker (Durable Object + D1 + KV)

From `apps/party`:

```bash
npm run db:apply:local      # apply src/db/schema.sql to the local D1
npx wrangler dev            # serves on http://127.0.0.1:8787 (note the LAN URL too)
```

Local dev uses Miniflare's local D1/KV/DO, so the `REPLACE_WITH_*` ids in
`wrangler.toml` don't matter yet.

Smoke-test without the app:

```bash
curl -s -XPOST http://127.0.0.1:8787/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"username":"alice","password":"password1"}'
# -> {"userId":"...","username":"alice","token":"..."}

curl -s -XPOST http://127.0.0.1:8787/api/lobbies -H 'authorization: Bearer <token>'
# -> {"code":"XXXXXX","status":"waiting"}
```

(Lobby state is served by the DO at `/parties/lobby/<code>/state?playerId=<id>`,
not by a `/api/lobbies/<code>` route.)

### Mobile app

From `apps/mobile`, create a git-ignored `.env` pointing at the Worker. Use the
dev machine's LAN IP so a physical device can reach it (localhost/127.0.0.1 is fine
for web and simulators):

```bash
# apps/mobile/.env
EXPO_PUBLIC_API_BASE_URL=http://<LAN-IP>:8787
EXPO_PUBLIC_PARTY_HOST=<LAN-IP>:8787        # host:port, no scheme
```

```bash
npx expo start              # press w (web), i/a (simulators), or scan for a device
```

### On a physical device (Expo Go — no Cloudflare needed)

You can run the app on your phone against the **local** Worker (Miniflare) — no
deploy or credentials required. The phone and the dev machine must be on the
**same Wi-Fi**.

1. **Serve the Worker on your LAN.** Plain `wrangler dev` binds localhost only, so
   a phone can't reach it — bind all interfaces instead (from `apps/party`):

   ```bash
   npx wrangler dev --ip 0.0.0.0 --port 8787
   ```

2. **Point `.env` at the dev machine's LAN IP** (not `127.0.0.1`), e.g.
   `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.31:8787`. Find the IP with `ipconfig`
   (Windows) / `ifconfig` (macOS/Linux).
3. **Allow the ports through the firewall.** On Windows, accept the prompt to let
   Node/`workerd` through on a private network (otherwise the phone can't reach
   `:8787`).
4. **Start Expo and scan the QR:**

   ```bash
   cd apps/mobile && npx expo start
   ```

   Install **Expo Go** (App Store / Play Store). **iOS:** scan the QR with the
   Camera app. **Android:** scan it from inside Expo Go.

No code changes are required — the app reads the Worker URL from the
`EXPO_PUBLIC_*` env. This runs the full app, including the native-only win/lose
confetti. Remote **push notifications** are limited in Expo Go (SDK 54); they need
a dev build (see §3).

### Try it with two clients

Register a user; create a lobby on client 1; open the same code on client 2 (or tap
it under "Your lobbies"); start the game (owner, 2+ players); play a card and watch
both update. The game ends when a player who has played runs out of cards.

## 2. Verify

```bash
npm test                                                  # shared + party + mobile
npm run typecheck --workspace=@trap/shared                # typecheck each workspace
npm run typecheck --workspace=@trap/party
npm run typecheck --workspace=@trap/mobile
npm run test:e2e                                          # Playwright: web build vs a live local Worker
npm run e2e:clean                                         # (optional) free ports 8081/8787 by hand
```

(Some `apps/party` WS/DO integration tests are `describe.skip` on Windows — see
`AGENTS.md`. The shared, mobile, and D1/Worker tests are the reliable signal. The
Playwright suite covers the two-client lobby/play flow end-to-end; it starts/reuses
`wrangler dev` + `expo start --web` for you. A `pretest:e2e` hook runs `e2e:clean`
first, so it frees ports `8081`/`8787` and never reuses a mismatched server — see the
Troubleshooting note below.)

## 3. Deploy to Cloudflare

From `apps/party` (after `npx wrangler login`):

```bash
npx wrangler d1 create trapcard            # copy database_id -> wrangler.toml
npx wrangler kv namespace create TOKENS    # copy id          -> wrangler.toml
npm run db:apply:remote                    # apply schema to the remote D1
npx wrangler deploy                        # -> https://trapcard-party.<sub>.workers.dev
```

Smoke-test the deployed URL with the curls from step 1.

### Production app config + push

Point the app at the deployed Worker for production builds:

```bash
EXPO_PUBLIC_API_BASE_URL=https://trapcard-party.<sub>.workers.dev
EXPO_PUBLIC_PARTY_HOST=trapcard-party.<sub>.workers.dev
```

Push notifications need an Expo **Dev Build** (not Expo Go):

```bash
npx expo install expo-dev-client
npx eas build --profile development --platform ios   # and/or android
```

After login on the device, confirm `POST /api/devices` registers a token
(`npx wrangler tail`) and that a targeted card-play delivers a push.

## Troubleshooting

- **`NetworkError` on web** — the Worker isn't running, or a CORS preflight failed.
  Confirm `wrangler dev` is up and `EXPO_PUBLIC_API_BASE_URL` is correct.
- **Port 8787 in use** — stop the other `wrangler dev` (Windows:
  `netstat -ano | findstr :8787`).
- **e2e tests all fail at login with `Failed to fetch`** — you left a manual
  `npx expo start` running, and Playwright reused it. A manual `expo start` is built
  from `.env`'s LAN IP, not the e2e `127.0.0.1` override, so its API calls go nowhere.
  `npm run test:e2e` now auto-clears ports `8081`/`8787` first; run `npm run e2e:clean`
  manually if you hit this. Don't keep a hand-run `expo start` up during an e2e run.
- **`npm audit fix --force` in `apps/party`** — don't; it swaps in a broken test-pool
  version. See `AGENTS.md`.

## Next steps

The remaining roadmap (local validation gate, Cloudflare provisioning, cutover, and
deferred graphics polish) lives in `plans/remaining-work.md`.
