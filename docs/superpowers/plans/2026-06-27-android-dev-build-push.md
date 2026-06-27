# Android Dev Build + On-Device Push Runbook

> **For the human running this:** A user-executed runbook (like the Phase B deploy
> one). Decisions (locked 2026-06-27): **Android only** to start; **EAS cloud build**;
> **free Expo account**. iOS is a later follow-up (needs an Apple Developer Program
> membership for APNs).

**Goal:** Build a custom **Dev Build** of the app (a dev client that bundles the
native push module Expo Go lacks) and wire up **Firebase/FCM** so the device can
actually *receive* the push notifications the deployed Worker already sends.

**What's already done (don't rebuild it):** the client registers an Expo push token
at login (`POST /api/devices` → D1), and the deployed Worker pushes on four events —
player joined, game started, **a card played on you**, and game over. The only
missing link is *receiving* on-device, which Expo Go (SDK 53+) can't do.

**Two roles in this runbook:**
- **[code]** — repo changes (account-independent). These can be pre-staged in a PR.
- **[you]** — steps needing your Expo/Google accounts + a physical Android phone.

**Tech Stack:** Expo SDK 54, EAS Build, `expo-notifications`, `expo-dev-client`,
Firebase Cloud Messaging (FCM v1), Expo push service.

---

## Prerequisites

- A physical **Android phone** (push tokens don't work on emulators).
- Your **free Expo account** (you have this) and a **Google account** (for Firebase).
- `eas-cli` via `npx eas-cli ...` (no global install needed).

---

## Part 1 — Create the EAS project  [you]

From `apps/mobile`:

```bash
npx eas-cli login         # your Expo account
npx eas-cli init          # creates an EAS project; writes extra.eas.projectId (+ owner) into app.json
```

Expected: `app.json` gains `expo.extra.eas.projectId` and `expo.owner`. Commit that.
The `projectId` is what the push-token call needs (Part 2).

---

## Part 2 — Repo config  [code]

1. Add the dev-client runtime:

   ```bash
   npx expo install expo-dev-client
   ```

2. Create `apps/mobile/eas.json` with a development profile:

   ```json
   {
     "cli": { "version": ">= 12.0.0" },
     "build": {
       "development": {
         "developmentClient": true,
         "distribution": "internal",
         "android": { "buildType": "apk" }
       }
     }
   }
   ```

3. Wire the `projectId` into the push-token call. In `apps/mobile/src/lib/push.ts`,
   import `expo-constants` and pass the id explicitly (SDK 54 needs it for a reliable
   token):

   ```ts
   import Constants from 'expo-constants';
   // ...inside registerForPushNotifications, replace the getExpoPushTokenAsync line:
   const projectId =
     Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
   if (!projectId) return null; // not an EAS build yet
   const { data: expoToken } = await Notifications.getExpoPushTokenAsync({ projectId });
   ```

`typecheck` + `lint` should stay green after these.

---

## Part 3 — Firebase / FCM  [you]  (the meaty part)

Expo's push service delivers to Android via **your** Firebase project. Two artifacts:
`google-services.json` (goes in the build so the app registers with FCM) and an **FCM
v1 service-account key** (goes to Expo so its push service can authenticate to FCM).

1. **Create a Firebase project** at <https://console.firebase.google.com> (free).
2. **Add an Android app** with package name **`com.trapcard.app`** (must match
   `app.json` → `expo.android.package`). Download the generated
   **`google-services.json`**.
3. Put it at `apps/mobile/google-services.json` and reference it in `app.json`:

   ```json
   "android": {
     "package": "com.trapcard.app",
     "googleServicesFile": "./google-services.json"
   }
   ```

   > **`google-services.json` handling (decision):** it's Android *client* config (a
   > package-restricted API key — Google says it's safe to commit). Simplest for an
   > EAS cloud build is to **commit it**. If you'd rather keep it out of the repo
   > (your env policy), gitignore it and provide it to EAS as a **file env var**
   > (`eas env:create --type file`) — more steps. Either way works; pick one.

4. **Get the FCM v1 service-account key (this one is a real secret):** Firebase
   console → Project settings → **Service accounts** → **Generate new private key** →
   downloads a JSON. **Never commit this.**
5. **Upload it to Expo:**

   ```bash
   npx eas-cli credentials        # Android → "Google Service Account Key for Push Notifications (FCM V1)" → upload the JSON
   ```

   Expected: EAS stores the FCM v1 key for `com.trapcard.app`.

---

## Part 4 — Build the dev client and install it  [you]

From `apps/mobile`:

```bash
npx eas-cli build --profile development --platform android
```

Expected: a cloud build runs (free tier covers a handful per month); on success EAS
prints a link to an **`.apk`** and a QR code. On the Android phone, open the link (or
scan) and install the APK. (You may need to allow "install from this source".)

> First Android build also sets up a Keystore — accept EAS managing it.

---

## Part 5 — Run it and validate push end-to-end  [you]

1. Point the dev build at the **deployed** Worker. Put the prod values in your local
   `apps/mobile/.env.local` (git-ignored), same as Phase B Step 5:

   ```bash
   EXPO_PUBLIC_API_BASE_URL=https://trapcard-party.<your-subdomain>.workers.dev
   EXPO_PUBLIC_PARTY_HOST=trapcard-party.<your-subdomain>.workers.dev
   ```

2. Start Metro for the dev client and open the app on the phone (it appears like a
   custom Expo Go):

   ```bash
   npx expo start --dev-client
   ```

3. **Token registers:** tail the deployed Worker and log in on the phone — you should
   see the device hit `POST /api/devices`:

   ```bash
   cd ../party && npx wrangler tail
   ```

   Expected: a `POST /api/devices 200` line when the phone logs in (grant the
   notifications permission prompt).

4. **Receive a push:** from a second client (web build or another device) create/join
   the same lobby and **play a trap on the phone's player** (or start/finish the
   game). **Background the app on the phone** and confirm the notification arrives:
   e.g. *"A card was played on you — `<name>` played `…` on you"*.

If the banner shows on the backgrounded phone, push is working end-to-end.

---

## Verification checklist

- [ ] `eas init` wrote `extra.eas.projectId` + `owner` into `app.json` (committed)
- [ ] `expo-dev-client` installed; `eas.json` development profile added
- [ ] `push.ts` passes the `projectId` to `getExpoPushTokenAsync`
- [ ] Firebase project + Android app (`com.trapcard.app`); `google-services.json` in place
- [ ] FCM v1 service-account key uploaded via `eas credentials` (NOT committed)
- [ ] dev build APK installed on a physical Android phone
- [ ] `wrangler tail` shows `POST /api/devices` on login
- [ ] a trap played from another client delivers a push to the backgrounded phone

---

## Notes / sharp edges

- **Physical device only.** Emulators don't get push tokens; validation needs a real phone.
- **Background to see it.** A foreground app shows the in-app `card_played`, not the OS
  notification — background the app to confirm the push banner.
- **Secrets boundary.** The FCM v1 service-account JSON is the only true secret here
  (uploaded to Expo, never committed). `google-services.json` is client config.
- **Free-tier builds.** EAS Build's free tier allows a limited number of builds/month —
  ample for setting this up.
- **iOS later.** Same shape, but APNs requires an Apple Developer Program membership
  ($99/yr) + a Mac or EAS cloud build; tackle as a separate follow-up.
