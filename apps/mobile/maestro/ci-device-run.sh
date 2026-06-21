#!/usr/bin/env bash
# Runs inside reactivecircus/android-emulator-runner once the emulator has booted:
# installs Expo Go (SDK 54) onto the emulator, then runs the Maestro flows.
# Kept as a committed script (not an inline workflow `script:`) because the action
# invokes `script` via dash (`/usr/bin/sh -c`), where multi-line command
# substitution + an inline `node -e "..."` breaks ("Syntax error: end of file
# unexpected"). A real bash file with a shebang avoids that.
#
# Expects in the environment: LOBBY_CODE, P1_USER (set by the workflow), and a
# booted emulator on adb. Run from the repo root.
set -euo pipefail

# Resolve the Expo Go (SDK 54) APK URL from Expo's versions endpoint.
URL="$(curl -fsSL https://api.expo.dev/v2/versions | node -e '
  let d = "";
  process.stdin.on("data", (c) => (d += c));
  process.stdin.on("end", () => {
    const v = JSON.parse(d).data;
    const s = v.sdkVersions && v.sdkVersions["54.0.0"];
    console.log((s && (s.androidClientUrl || s.androidClientUri)) || v.androidUrl || "");
  });
')"

if [ -z "$URL" ]; then
  echo "Could not resolve an Expo Go APK URL from api.expo.dev/v2/versions" >&2
  exit 1
fi

echo "Expo Go APK: $URL"
curl -fsSL "$URL" -o /tmp/expo-go.apk
adb install -r /tmp/expo-go.apk

maestro test \
  -e LOBBY_CODE="${LOBBY_CODE}" \
  -e P1_USER="${P1_USER}" \
  apps/mobile/.maestro
