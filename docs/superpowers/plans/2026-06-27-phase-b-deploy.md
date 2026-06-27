# Phase B — Deploy the Worker (Cloudflare) Runbook

> **For the human running this:** This is a user-executed runbook, not an agentic
> plan — each step is a command to run against **your** Cloudflare account, with the
> expected output. Decisions (locked 2026-06-27): deploy to a **workers.dev
> subdomain**; **defer** the Expo Dev Build + on-device push to a follow-up.

**Goal:** Provision the real Cloudflare resources (D1 + KV), wire their ids into
`apps/party/wrangler.toml`, apply the remote schema, and deploy the Worker so the
app can run against a hosted backend at `https://trapcard-party.<subdomain>.workers.dev`.

**Architecture:** One Worker (`trapcard-party`) fronting D1 (accounts, device
tokens, lobby history), KV (opaque auth tokens), and the `LobbyDO` Durable Object
(one instance per lobby code) over WebSocket via PartyServer.

**No secrets needed.** The Worker's `Env` is only `DB`, `TOKENS`, `LOBBY` (+ an
optional test-only `EXPO_PUSH_URL`). Auth uses opaque KV tokens; Expo push posts to
`exp.host` unauthenticated. So there is **no `wrangler secret put`** step.

**Tech Stack:** Cloudflare Workers + D1 + KV + Durable Objects, Wrangler, Expo (for
the client config step).

---

## Dev vs prod config (read first)

**Worker — no separate config file.** Dev and prod are separated by the *command*,
not by a file: `wrangler dev` runs a **local Miniflare** with its own simulated
D1/KV (it ignores the real ids in `wrangler.toml`), while `wrangler deploy` /
`--remote` use the **real** resources. So one `wrangler.toml` and one hosted Worker
is correct. (A separate hosted *staging* env would use a `[env.staging]` block —
overkill for now.)

**Mobile — use Expo's env-file split.** A single `.env` gets clobbered when you
toggle LAN ↔ prod. Your `.gitignore` ignores `.env`, `.env.local`, `.env.*.local`
but **not** `.env.development` / `.env.production`, so use:

| File | Committed? | Purpose |
|------|-----------|---------|
| `.env.development` | yes | local default (e.g. `127.0.0.1:8787` for emulator/web) |
| `.env.production` | yes | the deployed `workers.dev` URL — used by production builds/exports |
| `.env.local` | no (git-ignored) | **your** machine override: a physical device's LAN IP, or pointing local at prod for ad-hoc testing |

> **Gotcha:** `expo start` always runs in **development** mode, so `.env.production`
> is *not* loaded by `expo start` — it only applies to production builds
> (`eas build` / `expo export`). To test the **prod backend from a local
> `expo start`**, override via `.env.local` (Step 5), not by editing `.env`.

---

## Prerequisites

- A Cloudflare account (the free tier covers Workers + D1 + KV + Durable Objects
  for a casual game).
- Wrangler authenticated. From `apps/party`:

  ```bash
  npx wrangler login        # opens a browser to authorize
  npx wrangler whoami       # confirm: prints your account email + id
  ```

- Node 24 and the repo installed (`npm ci` at the repo root).

> All commands below run from `apps/party` unless noted.

---

## Step 1: Create D1 + KV and wire the ids into `wrangler.toml`

`wrangler.toml` currently has two placeholders: `REPLACE_WITH_D1_DATABASE_ID` and
`REPLACE_WITH_KV_NAMESPACE_ID`.

1. Create the D1 database (its `database_name` must stay `trapcard` — the
   `db:apply:*` scripts reference it by that name):

   ```bash
   npx wrangler d1 create trapcard
   ```

   Expected: prints a block including `database_id = "xxxxxxxx-...."`. Copy that id
   into `wrangler.toml`, replacing `REPLACE_WITH_D1_DATABASE_ID`.

2. Create the KV namespace for auth tokens:

   ```bash
   npx wrangler kv namespace create TOKENS
   ```

   Expected: prints `id = "xxxxxxxx...."`. Copy it into `wrangler.toml`, replacing
   `REPLACE_WITH_KV_NAMESPACE_ID`.

3. Verify both ids landed:

   ```bash
   git diff wrangler.toml
   ```

   Expected: the two `REPLACE_WITH_*` strings are now real ids. (These are resource
   identifiers, **not secrets** — they are safe to commit.)

---

## Step 2: Apply the schema to the remote D1

```bash
npm run db:apply:remote   # wrangler d1 execute trapcard --remote --file=./src/db/schema.sql
```

Expected: Wrangler asks you to confirm a remote execution (answer yes), then reports
the executed statements (tables `users`, `device_tokens`, `lobby_history` created)
with no error.

Verify the tables exist:

```bash
npx wrangler d1 execute trapcard --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
```

Expected: lists `users`, `device_tokens`, `lobby_history` (plus `_cf_KV`/sqlite
internal rows).

---

## Step 3: Deploy the Worker

```bash
npm run deploy            # wrangler deploy
```

Expected: uploads the Worker, applies the Durable Object migration `v1`
(`new_sqlite_classes = ["LobbyDO"]`) on this first deploy, and prints the deployed
URL: `https://trapcard-party.<your-subdomain>.workers.dev`. **Note that URL** — the
next steps use it.

---

## Step 4: Smoke-test the deployed Worker (curl)

Replace `<URL>` with your deployed URL.

1. Register a user:

   ```bash
   curl -s -XPOST https://<URL>/api/auth/register \
     -H 'content-type: application/json' \
     -d '{"username":"alice","password":"password1"}'
   ```

   Expected: `{"userId":"...","username":"alice","token":"..."}` (HTTP 200). This
   exercises D1 (insert user) + KV (store token).

2. Create a lobby with the returned token:

   ```bash
   curl -s -XPOST https://<URL>/api/lobbies -H 'authorization: Bearer <token>'
   ```

   Expected: `{"code":"XXXX","status":"waiting"}`. This exercises the Durable Object
   create path (`getServerByName` → `LobbyDO`).

3. Read the lobby state back (DO HTTP pull):

   ```bash
   curl -s "https://<URL>/parties/lobby/XXXX/state?playerId=probe"
   ```

   Expected: a JSON `GameState` for code `XXXX` (status `waiting`), HTTP 200.

If all three succeed, the hosted backend is live and correct.

---

## Step 5: Point the app at production and play against it

1. **Record the prod URL for builds** — create `apps/mobile/.env.production`
   (committed; the URL is public, not a secret):

   ```bash
   EXPO_PUBLIC_API_BASE_URL=https://trapcard-party.<your-subdomain>.workers.dev
   EXPO_PUBLIC_PARTY_HOST=trapcard-party.<your-subdomain>.workers.dev
   ```

   `EXPO_PUBLIC_PARTY_HOST` is host-only (no scheme); PartySocket auto-selects
   **`wss`** for a non-local host, so realtime runs over secure WebSocket. The web
   build's cross-origin calls are allowed by the Worker's `Access-Control-Allow-Origin: *`.

2. **Test prod from a local `expo start`** — because `expo start` runs in
   *development* mode (so it won't read `.env.production`), put the same two values
   in `apps/mobile/.env.local` (git-ignored, highest precedence — it overrides your
   dev `.env`). Then restart Metro and run two clients (e.g. Expo Go + web, or two
   devices):

   ```bash
   cd apps/mobile && npx expo start
   ```

   Walk a quick game: register/login → one client creates a lobby → the other joins
   by code → ready → prep → play a card → both see it. This confirms HTTPS REST +
   WSS realtime against production.

   > To switch back to local LAN dev, delete (or empty) `.env.local` and restart
   > Metro — your `.env` / `.env.development` defaults take over again.

---

## Step 6: Commit the wired config

The D1/KV ids and the prod URL are public (not secrets), and CI/other machines need
them — so commit both. (`.env.local` stays git-ignored.)

```bash
git add apps/party/wrangler.toml apps/mobile/.env.production
git commit -m "chore: wire production D1 + KV ids + prod client URL; deploy to workers.dev"
```

---

## Verification checklist

- [ ] `wrangler whoami` shows your account
- [ ] D1 `trapcard` + KV `TOKENS` created; both ids in `wrangler.toml` (no `REPLACE_WITH_*` left)
- [ ] remote schema applied; `users`/`device_tokens`/`lobby_history` exist
- [ ] `wrangler deploy` printed the `workers.dev` URL
- [ ] curl register + create-lobby + state succeed against the deployed URL
- [ ] two clients play a game against production over `wss` (via `.env.local`)
- [ ] `wrangler.toml` + `.env.production` committed; `.env.local` left git-ignored

---

## Deferred to a follow-up (NOT this phase)

- **Expo Dev Build + on-device push (was Phase B6).** Remote push was removed from
  Expo Go (SDK 53+), so on-device push needs a **Dev Build**, which needs EAS
  (`eas.json`, `expo-dev-client`, an EAS `projectId` in `app.json`, an Expo account).
  Outline when picked up: `npx expo install expo-dev-client`; `eas build --profile
  development --platform android|ios`; install on device; after login confirm
  `POST /api/devices` is hit (`wrangler tail`) and a targeted card-play delivers a
  push. Tracked in `docs/superpowers/plans/2026-06-21-remaining-work.md`.
- **Custom domain.** Swap the `workers.dev` URL for a domain on Cloudflare (add a
  `route`/`custom_domain` in `wrangler.toml`); update the mobile `EXPO_PUBLIC_*`
  accordingly.
- **EAS env for store builds.** This runbook commits `.env.production` (auto-used by
  `expo export` / production builds) and uses `.env.local` for local prod testing.
  An EAS-driven store build can instead source `EXPO_PUBLIC_*` from EAS env/secrets
  if you prefer not to commit the URL — decide alongside the Dev Build follow-up.

---

## Notes / sharp edges

- **DO migration runs once.** The first `wrangler deploy` applies migration `v1`
  (`new_sqlite_classes = ["LobbyDO"]`). Don't edit that tag; add a new migration if
  the DO class ever changes shape.
- **Free-tier limits.** D1 / KV / Durable Objects free tiers are ample for a casual
  game; no paid plan required to start.
- **`db:apply:remote` is idempotent-ish.** `schema.sql` uses `CREATE TABLE IF NOT
  EXISTS`, so re-running it is safe.
