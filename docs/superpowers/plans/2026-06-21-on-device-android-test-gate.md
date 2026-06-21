# On-device Android Test Gate (Maestro + Expo Go) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CI job that runs the app on an Android emulator via Expo Go + Metro and drives it with Maestro (plus a Node "player 2" helper over the real API/WS), catching the Hermes-only regressions (Reanimated native, EventTarget, crypto) the web e2e cannot.

**Architecture:** A Node helper acts as player 2 (registers, creates the lobby, prints the code, starts the game once the device joins, stays connected). Maestro drives the device (Expo Go on an emulator) as player 1 through login → join → in-progress game → play a card. A dedicated GitHub Actions workflow wires up the Worker, Metro, the emulator, Expo Go, the helper, and Maestro.

**Tech Stack:** Maestro (YAML flows), Expo Go, `reactivecircus/android-emulator-runner`, Node (helper, ESM `.mjs`), `partysocket`, GitHub Actions, existing `wrangler dev` + `expo start`.

**Reference spec:** `docs/superpowers/specs/2026-06-21-on-device-android-test-gate-design.md`

---

## Background the engineer needs

- **Why this exists:** the Playwright e2e runs the **web** build in a browser (V8 + browser globals + pure-JS Reanimated). The product runs on **Hermes** (lean globals, native modules). Three "passes on web, crashes on device" bugs reached a device during the SDK 54 upgrade. Only running on Hermes catches them.
- **Emulator networking:** an Android emulator reaches the host machine at **`10.0.2.2`**. So the **device/app** uses `http://10.0.2.2:8787` (Worker) and `10.0.2.2:8081` (Metro); the **helper**, running on the host, uses `127.0.0.1`.
- **Existing selectors (already in the app — do NOT re-add):** testIDs `auth-toggle`, `auth-submit`, `create-lobby`, `join-lobby`, `logout`, `start-game`, `hand-card`, `opponent`; placeholders `Username`, `Password`, `Lobby code`; texts `Welcome, <user>`, `Waiting for the host to start…`, `<user> played …`.
- **Contract used by the helper:** `POST /api/auth/register {username,password}` → `{userId, username, token}`; `POST /api/lobbies` (Bearer token) → `{code, status}`; WebSocket via `partysocket` with `{ host, party: "lobby", room: code, query: { playerId, username } }`; client msgs `{type:"get_state"}` / `{type:"start_game"}`; server `state_update` carries `state.players`. The lobby **owner is the HTTP creator**, so the helper must create the lobby; the device only joins. Game has **no turn enforcement** (any player may play a card).
- **Worker bind:** `apps/party/wrangler.toml` already has `[dev] ip = "0.0.0.0"`, so the emulator can reach it.

---

## File structure

- Create `apps/mobile/maestro/player2.mjs` — the player-2 helper (Node ESM).
- Create `apps/mobile/.maestro/smoke.yaml` — boot/login-renders flow.
- Create `apps/mobile/.maestro/game.yaml` — full login → join → game → play flow.
- Create `apps/mobile/maestro/README.md` — how to run locally.
- Modify `apps/mobile/package.json` — add `device:player2` script.
- Create `.github/workflows/device.yml` — the CI gate.
- Modify `AGENTS.md` — one line pointing at the device suite.

---

## Task 1: Player-2 helper script

**Files:**
- Create: `apps/mobile/maestro/player2.mjs`
- Modify: `apps/mobile/package.json` (scripts)

- [ ] **Step 1: Write the helper**

Create `apps/mobile/maestro/player2.mjs`:

```js
// Player-2 helper for the on-device test gate. Runs on the CI host (Node, which
// has crypto/EventTarget so partysocket works). Registers a second user, creates
// the lobby (becoming owner), prints `LOBBY_CODE=<code>` for the workflow to
// capture, then — once the device (player 1) has joined — starts the game and
// stays connected so the in-progress game persists while the device plays.
import PartySocket from 'partysocket';

const API = process.env.PLAYER2_API_BASE ?? 'http://127.0.0.1:8787';
const HOST = process.env.PLAYER2_PARTY_HOST ?? '127.0.0.1:8787';
const username = process.env.PLAYER2_USER ?? `p2_${Date.now().toString(36)}`;
const password = 'password1';

async function main() {
  const reg = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!reg.ok) throw new Error(`register failed: HTTP ${reg.status}`);
  const { userId, token } = await reg.json();

  const lob = await fetch(`${API}/api/lobbies`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!lob.ok) throw new Error(`createLobby failed: HTTP ${lob.status}`);
  const { code } = await lob.json();

  // The workflow greps this exact line to pass the code to Maestro.
  console.log(`LOBBY_CODE=${code}`);

  const socket = new PartySocket({
    host: HOST,
    party: 'lobby',
    room: code,
    query: { playerId: userId, username },
  });

  let started = false;
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'get_state' }));
  });
  socket.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'state_update' && !started) {
      const players = msg.state?.players ?? [];
      if (players.length >= 2) {
        started = true;
        socket.send(JSON.stringify({ type: 'start_game' }));
        console.log('player2: sent start_game');
      }
    }
  });

  // Keep the process (and the WS) alive until the workflow kills it.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `apps/mobile/package.json`, add to `scripts` (after `"e2e:clean"`):

```json
    "device:player2": "node maestro/player2.mjs",
```

- [ ] **Step 3: Verify the helper locally**

Ensure a local Worker is running (`cd apps/party && npm run db:apply:local && npx wrangler dev --ip 0.0.0.0 --port 8787`).
Run: `cd apps/mobile && node maestro/player2.mjs`
Expected: prints a line `LOBBY_CODE=XXXXXX` (six chars) within ~2s, then `player2:` stays idle (no crash). Stop it with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/maestro/player2.mjs apps/mobile/package.json
git commit -m "test(device): add player-2 helper for on-device flow"
```

---

## Task 2: Maestro flows

**Files:**
- Create: `apps/mobile/.maestro/smoke.yaml`
- Create: `apps/mobile/.maestro/game.yaml`

- [ ] **Step 1: Write the smoke flow**

Create `apps/mobile/.maestro/smoke.yaml`:

```yaml
# Boot smoke: load the project in Expo Go and assert the login screen renders.
# Catches boot-time Hermes crashes (Reanimated native init, missing EventTarget).
appId: host.exp.exponent
---
- launchApp:
    clearState: true
- openLink: exp://10.0.2.2:8081
- assertVisible:
    id: "auth-submit"
    timeout: 120000
```

- [ ] **Step 2: Write the full game flow**

Create `apps/mobile/.maestro/game.yaml`:

```yaml
# Full flow: register player 1 on the device, join the lobby created by the
# player-2 helper, wait for the helper to start the game, then play a card.
# Catches the WS-connect / game-entry crash (missing crypto global on Hermes).
# Env: LOBBY_CODE (from the helper), P1_USER (unique per run, from the workflow).
appId: host.exp.exponent
---
- launchApp:
    clearState: true
- openLink: exp://10.0.2.2:8081
- assertVisible:
    id: "auth-submit"
    timeout: 120000
# Switch to "register" and create player 1.
- tapOn:
    id: "auth-toggle"
- tapOn: "Username"
- inputText: ${P1_USER}
- tapOn: "Password"
- inputText: "password1"
- tapOn:
    id: "auth-submit"
- assertVisible: "Welcome, ${P1_USER}"
# Join the helper's lobby by code.
- tapOn: "Lobby code"
- inputText: ${LOBBY_CODE}
- tapOn:
    id: "join-lobby"
# The helper (owner) starts the game once it sees the device join; the app
# navigates to the game screen and deals a hand. Reaching here exercises the
# game-entry WS connect that previously crashed on Hermes.
- assertVisible:
    id: "hand-card"
    timeout: 60000
# Play a card on the opponent and confirm the play registers.
- tapOn:
    id: "hand-card"
    index: 0
- tapOn:
    id: "opponent"
    index: 0
- assertVisible:
    text: "${P1_USER} played.*"
    timeout: 20000
```

- [ ] **Step 3: Validate YAML parses**

Run: `cd apps/mobile && node -e "const fs=require('fs');for(const f of ['.maestro/smoke.yaml','.maestro/game.yaml'])console.log(f, fs.readFileSync(f,'utf8').length, 'bytes')"`
Expected: both files print a byte count (sanity that they exist and are readable). Maestro syntax itself is verified end-to-end in Task 3 on CI; if a local emulator/device + Maestro is available, optionally run `maestro test -e LOBBY_CODE=<code> -e P1_USER=p1local .maestro/` against it.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/.maestro/smoke.yaml apps/mobile/.maestro/game.yaml
git commit -m "test(device): add Maestro smoke + game flows"
```

---

## Task 3: CI workflow

**Files:**
- Create: `.github/workflows/device.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/device.yml`:

```yaml
name: Device (Android)

run-name: >-
  Device · ${{ github.event_name }} · ${{ github.head_ref || github.ref_name }}${{ github.event.pull_request.number && format(' (PR #{0})', github.event.pull_request.number) || '' }} · @${{ github.actor }}

on:
  pull_request:
    paths:
      - 'apps/mobile/**'
      - 'packages/shared/**'
      - 'package-lock.json'
      - '.github/workflows/device.yml'
  schedule:
    - cron: '0 9 * * *' # nightly ~09:00 UTC
  workflow_dispatch:

concurrency:
  group: device-${{ github.event_name }}-${{ github.head_ref || github.ref }}
  cancel-in-progress: true

jobs:
  android:
    name: Maestro (Expo Go, Android emulator)
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      EXPO_PUBLIC_API_BASE_URL: http://10.0.2.2:8787
      EXPO_PUBLIC_PARTY_HOST: 10.0.2.2:8787
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - name: Build shared package
        run: npm run build --workspace=@trap/shared

      - name: Enable KVM (hardware accel for the emulator)
        run: |
          echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' \
            | sudo tee /etc/udev/rules.d/99-kvm4all.rules
          sudo udevadm control --reload-rules
          sudo udevadm trigger --name-match=kvm

      - name: Install Maestro
        run: |
          curl -fsSL "https://get.maestro.mobile.dev" | bash
          echo "$HOME/.maestro/bin" >> "$GITHUB_PATH"

      - name: Start Worker (binds 0.0.0.0 for the emulator)
        working-directory: apps/party
        run: |
          npm run db:apply:local
          nohup npx wrangler dev --ip 0.0.0.0 --port 8787 > /tmp/worker.log 2>&1 &
          for i in $(seq 1 60); do
            curl -sf -o /dev/null http://127.0.0.1:8787 && break || sleep 2
          done

      - name: Start Metro (Expo dev server)
        working-directory: apps/mobile
        run: |
          nohup npx expo start > /tmp/metro.log 2>&1 &
          for i in $(seq 1 60); do
            curl -sf -o /dev/null http://127.0.0.1:8081 && break || sleep 2
          done

      - name: Start player-2 helper and capture LOBBY_CODE
        working-directory: apps/mobile
        env:
          PLAYER2_API_BASE: http://127.0.0.1:8787
          PLAYER2_PARTY_HOST: 127.0.0.1:8787
        run: |
          nohup node maestro/player2.mjs > /tmp/player2.log 2>&1 &
          CODE=""
          for i in $(seq 1 30); do
            CODE=$(grep -oE 'LOBBY_CODE=[A-Z0-9]+' /tmp/player2.log | head -1 | cut -d= -f2)
            [ -n "$CODE" ] && break || sleep 1
          done
          test -n "$CODE" || { echo "no LOBBY_CODE"; cat /tmp/player2.log; exit 1; }
          echo "LOBBY_CODE=$CODE" >> "$GITHUB_ENV"
          echo "P1_USER=p1_${{ github.run_id }}_${{ github.run_attempt }}" >> "$GITHUB_ENV"

      - name: Run Maestro on the emulator
        uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 34
          arch: x86_64
          profile: pixel_6
          script: |
            # Install Expo Go (SDK 54) onto the emulator, then run the flows.
            URL=$(curl -fsSL https://api.expo.dev/v2/versions \
              | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const v=JSON.parse(d).data;const s=v.sdkVersions&&v.sdkVersions['54.0.0'];console.log((s&&(s.androidClientUrl||s.androidClientUri))||v.androidUrl)})")
            echo "Expo Go APK: $URL"
            curl -fsSL "$URL" -o /tmp/expo-go.apk
            adb install -r /tmp/expo-go.apk
            maestro test \
              -e LOBBY_CODE="${LOBBY_CODE}" \
              -e P1_USER="${P1_USER}" \
              apps/mobile/.maestro

      - name: Upload Maestro artifacts on failure
        if: ${{ failure() }}
        uses: actions/upload-artifact@v4
        with:
          name: maestro-output
          path: |
            ~/.maestro/tests
            /tmp/worker.log
            /tmp/metro.log
            /tmp/player2.log
          retention-days: 7
```

- [ ] **Step 2: Validate the workflow YAML parses**

Run: `node -e "const fs=require('fs');let Y;try{Y=require('yaml')}catch(e){Y=require('js-yaml')};const p=Y.parse?Y.parse.bind(Y):Y.load.bind(Y);const d=p(fs.readFileSync('.github/workflows/device.yml','utf8'));console.log('jobs:',Object.keys(d.jobs),'| triggers:',Object.keys(d.on))"`
Expected: `jobs: [ 'android' ] | triggers: [ 'pull_request', 'schedule', 'workflow_dispatch' ]`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/device.yml
git commit -m "ci: add on-device Android test gate (Maestro + Expo Go)"
```

- [ ] **Step 4: Push and observe the first CI run (the real verification)**

```bash
git push origin feat/local-eas-testing
```
Then watch: `gh run list --workflow device.yml --limit 1` → `gh run watch <id> --exit-status`.
Expected: green. This is the first run that actually exercises the emulator + Expo Go install + Maestro.

- [ ] **Step 5: If the Expo Go install step fails, apply the documented fallback**

If the `curl … api.expo.dev/v2/versions` URL extraction yields an empty/404 APK, replace the install lines in the `script:` block with the auto-install path and rerun:

```bash
            npx expo start --android &
            sleep 60   # let expo install Expo Go + open the project on the emulator
            maestro test -e LOBBY_CODE="${LOBBY_CODE}" -e P1_USER="${P1_USER}" apps/mobile/.maestro
```

Commit the change with `git commit -am "ci: use expo start --android to install Expo Go on the emulator"` and re-push. Iterate until green.

---

## Task 4: Docs

**Files:**
- Create: `apps/mobile/maestro/README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write the Maestro README**

Create `apps/mobile/maestro/README.md`:

```markdown
# On-device test suite (Maestro + Expo Go)

Runs the app on a real Hermes runtime to catch native/global gaps the web e2e
(Playwright) cannot — e.g. Reanimated native init, missing `EventTarget`/`crypto`
on Hermes. Driven in CI by `.github/workflows/device.yml`.

## Pieces

- `.maestro/smoke.yaml` — boots the app in Expo Go; asserts the login screen.
- `.maestro/game.yaml` — registers player 1, joins the lobby created by the
  helper, waits for game start, plays a card.
- `maestro/player2.mjs` — Node helper that acts as player 2 (owner): registers,
  creates the lobby, prints `LOBBY_CODE=<code>`, starts the game once the device
  joins, and stays connected.

## Run locally (with an emulator/device on `adb`)

1. Worker: `cd apps/party && npm run db:apply:local && npx wrangler dev --ip 0.0.0.0 --port 8787`
2. Metro: `cd apps/mobile && npx expo start`
3. Helper: `cd apps/mobile && npm run device:player2` — note the printed `LOBBY_CODE`.
4. Maestro: `cd apps/mobile && maestro test -e LOBBY_CODE=<code> -e P1_USER=p1local .maestro`

On an emulator the app reaches the host at `10.0.2.2`; on a physical device use
the machine's LAN IP for `EXPO_PUBLIC_API_BASE_URL` / `EXPO_PUBLIC_PARTY_HOST`.
```

- [ ] **Step 2: Add an AGENTS.md pointer**

In `AGENTS.md`, under the "Verify / Test Commands" section, add this line:

```markdown
- On-device (Android, Hermes): `.github/workflows/device.yml` runs Maestro flows
  (`apps/mobile/.maestro/`) against Expo Go on an emulator, with a Node player-2
  helper (`apps/mobile/maestro/player2.mjs`). This is the only layer that catches
  Hermes-only gaps (native modules, missing web globals) — see `apps/mobile/maestro/README.md`.
```

- [ ] **Step 3: Lint docs**

Run: `npm run lint:md`
Expected: `Summary: 0 error(s)` (note: `docs/superpowers/**` is excluded; `AGENTS.md` and the new README are linted).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/maestro/README.md AGENTS.md
git commit -m "docs: document the on-device Maestro test suite"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** smoke flow (boot/Reanimated/EventTarget) ✓ Task 2; game flow incl. game-entry (crypto) ✓ Task 2; player-2 helper ✓ Task 1; CI job with path filter + nightly + dispatch + concurrency + artifacts ✓ Task 3; Expo Go install + fallback ✓ Task 3 Steps 4–5; docs ✓ Task 4. iOS / release-binary / EAS push remain out of scope per spec.
- **Env name consistency:** helper reads `PLAYER2_API_BASE` / `PLAYER2_PARTY_HOST` / `PLAYER2_USER`; workflow sets the first two and lets the helper default the user. Flows read `LOBBY_CODE` / `P1_USER`; workflow sets both. App build reads `EXPO_PUBLIC_API_BASE_URL` / `EXPO_PUBLIC_PARTY_HOST`.
- **The genuinely unproven step is Task 3 Step 4–5 (Expo Go on the CI emulator).** Expect to iterate there; the fallback is written out.
```
