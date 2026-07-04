# Release Workflow Design (`release.yml`)

**Date:** 2026-07-04
**Status:** Approved (design review with owner, this session)

## Goal

One GitHub workflow that releases the game to both distribution targets —
Android (EAS-built sideload APK) and iOS/web (PWA served as Worker static
assets) — with `package.json` as the version source of truth, a semver git tag
+ GitHub Release created **only** for production releases, and a manual
preview path for Android.

## Decisions (locked)

- **`package.json` is the version source of truth.** The root `package.json`
  `version` field drives releases. Releasing = merging a PR that bumps it.
- **Production trigger:** `push` to `main` touching `package.json`; the
  workflow no-ops unless the version is new (its tag doesn't exist yet).
- **Preview = Android only.** The PWA has no preview environment: its only
  pre-prod validation is the exported-build Playwright suite (local Worker).
  Cloud PWA previews (`wrangler versions upload` → shareable preview URL,
  shared prod bindings) were considered and deferred — no new infrastructure
  wanted now. This constraint is recorded in `AGENTS.md` and `CLAUDE.md`.
- **Tag only on production, after both platforms succeed.** The workflow waits
  for the EAS cloud build (~10–20 min) rather than fire-and-forget, so a tag
  means "everything actually shipped".
- **Tag + GitHub Release in one step** (`gh release create v<version>`), with
  the EAS APK link in the release body — the Release page doubles as the
  sideload distribution page.
- **No CI-wait gate:** everything reaches `main` via PR-gated merges (CI +
  Device workflows). Revisit only if merge-order races ever bite.
- **D1 schema changes stay manual** (`db:apply:remote` before merging a
  release) — auto-migrating prod from CI is out of scope.

## Triggers & jobs

```text
on:
  push: {branches: [main], paths: [package.json]}   # production path
  workflow_dispatch:                                 # preview path (Android only)

production:
  version ──▶ deploy-pwa ──────┐
          └─▶ build-android ───┴──▶ tag-and-release

preview (dispatch):
  android-preview   (EAS preview profile, -m "preview <sha>", no tag)
```

- **`version`**: `jq` the root `package.json` version; validate strict semver
  (`X.Y.Z`); exit success/no-op if tag `v<version>` exists; fail if the
  version sorts below the latest `v*` tag (`sort -V` — catches downgrades).
  Outputs `version` for later jobs.
- **`deploy-pwa`**: `npm ci` (the `@trap/shared` `prepare` script builds
  `dist/`), `npx expo export --platform web --clear` with prod
  `EXPO_PUBLIC_*`, `npx wrangler deploy` from `apps/party`, then verify the
  deployed surface (curl: `manifest.json` → 200, `icons/icon-192.png` → 200,
  `/api/auth/me` → 401 so the SPA fallback isn't answering the API).
- **`build-android`**: `npx eas-cli build --profile production --platform
  android --non-interactive -m "release v<version>"`; waits for completion;
  captures the build page / artifact URL from `--json` output.
- **`tag-and-release`**: needs both; `gh release create v<version>
  --generate-notes`, body includes the APK link and the PWA URL. Workflow
  `permissions: contents: write`.
- **`android-preview`** (dispatch): EAS `preview` profile build with
  `-m "preview <short-sha>"`. Nothing else.
- `concurrency: release` (no cancel-in-progress) prevents interleaved runs.

## Config this needs

- **`apps/mobile/eas.json`**: add a `production` profile (same as `preview` —
  APK, internal distribution — but `"environment": "production"`).
- **One-time owner setup:**
  - EAS **production** environment vars: `EXPO_PUBLIC_API_BASE_URL`,
    `EXPO_PUBLIC_PARTY_HOST` (same prod URLs as the preview env).
  - GitHub **secrets**: `EXPO_TOKEN` (expo.dev robot access token),
    `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
  - GitHub **variables** (non-secret, per env policy): the two
    `EXPO_PUBLIC_*` prod URLs for the web-export step.

## Docs changes (same effort)

1. **`AGENTS.md` + `CLAUDE.md`**: note that release environments are
   asymmetric — **preview releases are Android-only** (EAS preview profile);
   the PWA deploys to production only, pre-validated by the exported-build
   Playwright suite.
2. **New `docs/runsheets/` folder** — extract the operational runbooks out of
   `docs/superpowers/plans/` (which mixes them with historical agentic
   plans):
   - `docs/runsheets/cloudflare-setup.md` ← `2026-06-27-phase-b-deploy.md`
     (wrangler auth, D1/KV provisioning, schema, first deploy)
   - `docs/runsheets/android-deploy.md` ← `2026-06-27-android-preview-build-push.md`
     (EAS/Expo setup, Firebase/FCM, manual preview build + sideload)
   - `docs/runsheets/pwa-deploy.md` ← `2026-07-03-ios-pwa-rollout.md`
     (manual export + deploy + verify + iPhone checklist)
   - Each gets a short "normally automated by `release.yml`; this is the
     manual/first-time path" preamble; all references to the old paths
     (QUICKSTART.md, README.md, AGENTS.md, remaining-work plan) are updated.
   - **Gotcha:** `docs/runsheets/**` is NOT excluded from markdownlint (only
     `docs/superpowers/**` is), so the moved files must pass `npm run lint:md`.

## Failure handling

- Any production job fails → no tag, no release; fix and **re-run failed
  jobs** from the Actions UI (the version job is idempotent — the tag doesn't
  exist yet, so re-runs proceed).
- `package.json` edited without a version change (e.g. root dependency
  added) → `version` job no-ops successfully.
- A re-push of an already-tagged version → no-op (tag-exists check).

## Test plan

1. `actionlint` (or careful review) on the workflow file.
2. Dispatch the **preview** path first — proves `EXPO_TOKEN`/EAS wiring
   cheaply.
3. First production release: PR bumping root `package.json` to **1.0.0**
   (both platforms shipped 2026-07-04 — it's earned), watch the run end to
   end, verify tag `v1.0.0` + Release with APK link exist and the PWA still
   serves.

## Out of scope

- PWA preview environments (Option A `versions upload` noted as the cheap
  future upgrade; Option B separate Worker env with own D1/KV rejected for
  drift risk).
- Auto D1 migrations, store distribution, web push.
