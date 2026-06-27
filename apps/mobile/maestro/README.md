# On-device test gate (Maestro + Expo Go)

Boots the app on a real Hermes runtime to catch native/global gaps the web e2e
(Playwright) cannot — e.g. Reanimated native init, a missing `EventTarget` /
`crypto` global on Hermes. Driven in CI by `.github/workflows/device.yml`.

## Scope: smoke only

The gate runs a single **smoke** flow:

- `.maestro/smoke.yaml` — launches the app in Expo Go and asserts the home
  screen renders ("Sign in / Register"). Reaching it proves the JS bundle ran on
  Hermes. That is the device gate's whole job: catch native-init crashes that
  never surface in the Node/Playwright tiers.

It needs only **Metro** (to serve the bundle) and a booted emulator — no Worker,
no second player.

## Why there's no full game flow here

A `game.yaml` flow used to drive the whole three-stage game (register → join →
ready → author/submit → play) with a Node `player2.mjs` helper as the second
player. It was **removed**: driving that flow through Maestro on the emulator
proved unreliable against the animated / safe-area / keyboard-avoiding UI —
coordinate taps on `testID`'d buttons miss when the soft keyboard is up
(skewed native bounds), dismissing the keyboard clears the typed code, and
submitting via the IME mis-fires. These are emulator/automation quirks, not app
bugs (the same flow works by hand on a device).

The full game **logic** is covered by the Playwright **web e2e**
(`apps/mobile/e2e/multiplayer.spec.ts`: create/join, ready, prep, play,
reconnect, winner), and the full **on-device** experience is covered by the
manual two-device LAN matrix in the cross-device plan. If an automated on-device
game flow is wanted later, it should target an **Expo Dev Build** (not Expo Go)
with a keyboard-robust input strategy — see the backlog in
`docs/superpowers/plans/2026-06-27-post-merge-ux-fixes.md`.

## Run locally (with an emulator/device on `adb`)

1. Metro: `cd apps/mobile && npx expo start`
2. Maestro: `cd apps/mobile && maestro test .maestro/smoke.yaml`
