# Android Preview Build (sideload) + On-Device Push Runbook

> **For the human running this:** A user-executed runbook (like the Phase B deploy
> one). Decisions (locked 2026-06-27): **Android only**; **sideloaded preview APK**
> (no Play Store, no Apple, no fees); **keep push**; **EAS cloud build**; **free Expo
> account**. iOS + public store listing are deliberate later decisions.

**Goal:** Produce a **real, signed Android APK** (preview profile, internal
distribution) you can **sideload** onto your phone, with **push working** end-to-end
against the deployed Worker. Unlike a dev build, this bundles the JS — it's the
actual app binary, just distributed by direct download instead of the Play Store.

**What's already done (don't rebuild it):** the client registers an Expo push token
at login (`POST /api/devices` → D1); the deployed Worker pushes on four events —
player joined, game started, **a card played on you**, game over. Push only fails in
Expo Go (which can't receive it). This runbook makes a binary that can.

**Two roles:** **[code]** = repo changes (account-independent, can be pre-staged in a
PR). **[you]** = steps needing your Expo/Google accounts + a physical Android phone.

**Tech Stack:** Expo SDK 54, EAS Build (cloud), `expo-notifications`, Firebase Cloud
Messaging (FCM v1), Expo push service.

---

## Prerequisites

- A physical **Android phone** (push tokens don't work on emulators).
- Your **free Expo account** + a **Google account** (for Firebase).
- `eas-cli` via `npx eas-cli ...` (no global install needed).

---

## Part 1 — Create the EAS project  [you]

From `apps/mobile`:

```bash
npx eas-cli login
npx eas-cli init      # creates the EAS project; writes expo.extra.eas.projectId (+ owner) into app.json
```

Commit the `app.json` change. The `projectId` is what the push-token call needs.

---

## Part 2 — Repo config  [code]

1. Create `apps/mobile/eas.json` with a **preview** profile — a release binary, APK,
   internal distribution, pulling build-time env from the EAS `preview` environment:

   ```json
   {
     "cli": { "version": ">= 12.0.0" },
     "build": {
       "preview": {
         "distribution": "internal",
         "android": { "buildType": "apk" },
         "environment": "preview"
       }
     }
   }
   ```

2. Wire the `projectId` into the push-token call. In `apps/mobile/src/lib/push.ts`,
   import `expo-constants` (already a dependency) and pass the id (SDK 54 needs it):

   ```ts
   import Constants from 'expo-constants';
   // ...inside registerForPushNotifications, replace the getExpoPushTokenAsync line:
   const projectId =
     Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
   if (!projectId) return null; // not an EAS build
   const { data: expoToken } = await Notifications.getExpoPushTokenAsync({ projectId });
   ```

`typecheck` + `lint` stay green after these. (No `expo-dev-client` — that's only for
dev builds; this is a release binary.)

---

## Part 3 — Bake the prod backend URL via EAS env  [you]

A release build bundles the JS, so `EXPO_PUBLIC_*` must be set **at build time** — not
via a local `.env`. Keep it out of the repo (per our env policy) by storing it as EAS
environment variables on the `preview` environment:

```bash
npx eas-cli env:create --environment preview --name EXPO_PUBLIC_API_BASE_URL \
  --value https://trapcard-party.<your-subdomain>.workers.dev --visibility plaintext
npx eas-cli env:create --environment preview --name EXPO_PUBLIC_PARTY_HOST \
  --value trapcard-party.<your-subdomain>.workers.dev --visibility plaintext
```

The `preview` build profile (`"environment": "preview"`) pulls these in automatically.
(`EXPO_PUBLIC_PARTY_HOST` is host-only; PartySocket uses `wss` for a non-local host.)

---

## Part 4 — Firebase / FCM (Android push)  [you]

Expo's push service delivers to Android via **your** Firebase project. Two artifacts:
`google-services.json` (in the build, so the app registers with FCM) and an **FCM v1
service-account key** (to Expo, so its push service can authenticate to FCM).

1. Create a Firebase project at <https://console.firebase.google.com> (free).
2. Add an **Android app** with package **`com.trapcard.app`** (matches
   `app.json` → `expo.android.package`). Download **`google-services.json`**.
3. Put it at `apps/mobile/google-services.json` and reference it in `app.json`:

   ```json
   "android": {
     "package": "com.trapcard.app",
     "googleServicesFile": "./google-services.json"
   }
   ```

   > **Handling:** it's Android *client* config (package-restricted key — Google says
   > it's safe to commit). Simplest is to commit it. To keep it out of the repo (our
   > env policy), gitignore it and add it as an EAS **file** env var
   > (`eas env:create --environment preview --type file --name GOOGLE_SERVICES_JSON ...`)
   > then point `googleServicesFile` at `$GOOGLE_SERVICES_JSON`. Either works.

4. **FCM v1 service-account key (the real secret):** Firebase console → Project
   settings → **Service accounts** → **Generate new private key** → JSON. **Never
   commit this.**
5. Upload it to Expo:

   ```bash
   npx eas-cli credentials   # Android → "Google Service Account Key for Push Notifications (FCM V1)" → upload
   ```

---

## Part 5 — Build the preview APK and sideload it  [you]

```bash
npx eas-cli build --profile preview --platform android -m "<what changed>"
```

(`-m` is optional but recommended — the message labels the build on expo.dev and in
`npx eas-cli build:list`, which helps when iterating with uncommitted changes.)

Expected: a cloud build runs (free tier covers a handful/month); EAS prompts to
**generate an Android Keystore** on the first build — accept (EAS manages it). On
success EAS prints an **install page + QR**. On the phone, open it and install the
**`.apk`** (allow "install from this source"). This is your sideloaded app.

---

## Part 6 — Validate push end-to-end  [you]

1. Tail the deployed Worker:

   ```bash
   cd ../party && npx wrangler tail
   ```

2. On the phone, open the installed app, register/log in, and **grant the
   notifications permission** prompt. Expected in the tail: `POST /api/devices 200`
   (the device's Expo push token is stored).

3. From a second client (web build, or another phone) join the same lobby and **play
   a trap on the phone's player** (or start/finish the game). **Background the app on
   the phone** and confirm the OS notification arrives — e.g. *"A card was played on
   you — `<name>` played `…` on you"*.

If the banner shows on the backgrounded phone, push works end-to-end on a real binary.

---

## Verification checklist

- [ ] `eas init` wrote `extra.eas.projectId` + `owner` into `app.json` (committed)
- [ ] `eas.json` `preview` profile added; `push.ts` passes `projectId`
- [ ] `EXPO_PUBLIC_*` set as EAS env vars on the `preview` environment (not committed)
- [ ] Firebase project + Android app (`com.trapcard.app`); `google-services.json` in place
- [ ] FCM v1 service-account key uploaded via `eas credentials` (NOT committed)
- [ ] preview APK built and **sideloaded** onto a physical Android phone
- [ ] `wrangler tail` shows `POST /api/devices` on login
- [ ] a trap played from another client delivers a push to the backgrounded phone

---

## Notes / sharp edges

- **Sideload = no store.** `distribution: internal` gives a direct-download APK — no
  Play Console, no $25, no review. You can share the APK link with anyone.
- **Physical device only / background to see it.** Emulators have no push token; a
  foregrounded app shows the in-app event, not the OS banner — background it to confirm.
- **Secrets boundary.** The FCM v1 service-account JSON is the only true secret here
  (uploaded to Expo, never committed). `google-services.json` is client config.
- **Icons/splash.** Defaults are fine for a sideloaded preview; swap in real assets
  before any public listing.
- **Deferred by choice:** iOS (Apple Developer Program $99/yr) and public store
  listing (Play Console $25 + review). Revisit if/when you want broader distribution.
