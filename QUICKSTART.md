# Quick Start

Get the Trap Card Game running locally, then deploy it. For architecture and the
full command reference see `README.md`; for conventions and gotchas see `AGENTS.md`.

## Prerequisites

- Node.js 24+ and npm.
- Expo tooling (`npx expo …`) for the mobile app.
- A Cloudflare account — only for the deploy section (local dev uses Miniflare).

```bash
npm install            # from the repo root; installs all workspaces
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

### Try it with two clients

Register a user; create a lobby on client 1; open the same code on client 2 (or tap
it under "Your lobbies"); start the game (owner, 2+ players); play a card and watch
both update. The game ends when a player who has played runs out of cards.

## 2. Verify

```bash
npm test                                  # shared + party + mobile
npm run typecheck                         # + --workspace=@trap/party / @trap/mobile
```

(Some `apps/party` WS/DO integration tests are `describe.skip` on Windows — see
`AGENTS.md`. The shared, mobile, and D1/Worker tests are the reliable signal.)

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

```
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
- **`npm audit fix --force` in `apps/party`** — don't; it swaps in a broken test-pool
  version. See `AGENTS.md`.

## Next steps

The remaining roadmap (local validation gate, Cloudflare provisioning, cutover, and
deferred graphics polish) lives in `plans/remaining-work.md`.
