# On-device test suite (Maestro + Expo Go)

Runs the app on a real Hermes runtime to catch native/global gaps the web e2e
(Playwright) cannot — e.g. Reanimated native init, missing `EventTarget`/`crypto`
on Hermes. Driven in CI by `.github/workflows/device.yml`.

## Pieces

- `.maestro/smoke.yaml` — boots the app in Expo Go; asserts the home screen
  renders (proves the JS ran on Hermes).
- `.maestro/game.yaml` — registers player 1, joins the lobby created by the
  helper, waits for game start, plays a card.
- `maestro/player2.mjs` — Node helper that acts as player 2 (owner): registers,
  creates the lobby, prints `LOBBY_CODE=<code>`, starts the game once the device
  joins, and stays connected.
- `maestro/ci-device-run.sh` — runs inside the emulator step: installs Expo Go
  (SDK 54) on the booted emulator, then runs the flows. (Kept as a script because
  the emulator-runner action executes its `script:` via dash.)

## Run locally (with an emulator/device on `adb`)

1. Worker: `cd apps/party && npm run db:apply:local && npx wrangler dev --ip 0.0.0.0 --port 8787`
2. Metro: `cd apps/mobile && npx expo start`
3. Helper: `cd apps/mobile && npm run device:player2` — note the printed `LOBBY_CODE`.
4. Maestro: `cd apps/mobile && maestro test -e LOBBY_CODE=<code> -e P1_USER=p1local .maestro`

On an emulator the app reaches the host at `10.0.2.2`; on a physical device use
the machine's LAN IP for `EXPO_PUBLIC_API_BASE_URL` / `EXPO_PUBLIC_PARTY_HOST`.
