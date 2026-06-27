#!/usr/bin/env bash
# Runs inside reactivecircus/android-emulator-runner once the emulator has booted:
# installs Expo Go (SDK 54) onto the emulator, then runs the Maestro smoke flow.
# Kept as a committed script (not an inline workflow `script:`) because the action
# invokes `script` via dash (`/usr/bin/sh -c`), where multi-line command
# substitution + an inline `node -e "..."` breaks ("Syntax error: end of file
# unexpected"). A real bash file with a shebang avoids that.
#
# Scope: smoke only. The smoke flow boots the app in Expo Go and asserts the
# home screen renders — i.e. the JS bundle ran on Hermes — which is the device
# gate's purpose (catch native-init / missing-global crashes the web e2e can't).
# The full multiplayer `game` flow was removed: driving the three-stage game
# through Maestro on the emulator proved unreliable against the animated /
# safe-area / keyboard-avoiding UI, and the game *logic* is already covered by
# the Playwright web e2e. See apps/mobile/maestro/README.md.
#
# Expects: a booted emulator on adb. Run from the repo root.
set -euo pipefail

# Resolve the Expo Go (SDK 54) APK URL from Expo's versions endpoint.
URL="$(curl -fsSL https://api.expo.dev/v2/versions | node -e '
  let d = "";
  process.stdin.on("data", (c) => (d += c));
  process.stdin.on("end", () => {
    const v = JSON.parse(d);
    const s = v.sdkVersions && v.sdkVersions["54.0.0"];
    console.log((s && s.androidClientUrl) || v.androidClientUrl || v.androidUrl || "");
  });
')"

if [ -z "$URL" ]; then
  echo "Could not resolve an Expo Go APK URL from api.expo.dev/v2/versions" >&2
  exit 1
fi

echo "Expo Go APK: $URL"
curl -fsSL "$URL" -o /tmp/expo-go.apk
adb install -r /tmp/expo-go.apk

maestro test apps/mobile/.maestro/smoke.yaml
