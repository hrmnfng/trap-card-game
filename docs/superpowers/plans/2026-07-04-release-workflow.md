# Release Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One GitHub workflow (`release.yml`) that deploys the PWA and builds the
Android APK, tagging + creating a GitHub Release only for production releases,
with `package.json` as the version source of truth; plus the `docs/runsheets/`
extraction and the AGENTS/CLAUDE preview-asymmetry notes.

**Architecture:** Production path triggers on `main` pushes touching root
`package.json` (no-ops unless the version is new); `deploy-pwa` and
`build-android` run in parallel after a `version` gate job; `tag-and-release`
runs only when both succeed. Preview path is `workflow_dispatch` → Android EAS
preview build only. See the approved spec:
`docs/superpowers/specs/2026-07-04-release-workflow-design.md`.

**Tech Stack:** GitHub Actions, `eas-cli` (EXPO_TOKEN), wrangler
(CLOUDFLARE_API_TOKEN), `gh` CLI, jq.

**GitNexus note:** Every change is workflow YAML, JSON config, or docs — no
existing function/class/method is modified; per-symbol impact analysis does not
apply.

---

## File structure

| File | Task | Responsibility |
|------|------|----------------|
| `apps/mobile/eas.json` | 1 | Modify: add `production` build profile |
| `.github/workflows/release.yml` | 2 | Create: the release workflow |
| `AGENTS.md` | 3 | Modify: preview-asymmetry gotcha bullet |
| `CLAUDE.md` | 3 | Modify: release + runsheets note in repo docs section |
| `docs/runsheets/cloudflare-setup.md` | 4 | Move from `docs/superpowers/plans/2026-06-27-phase-b-deploy.md` + preamble |
| `docs/runsheets/android-deploy.md` | 4 | Move from `docs/superpowers/plans/2026-06-27-android-preview-build-push.md` + preamble |
| `docs/runsheets/pwa-deploy.md` | 4 | Move from `docs/superpowers/plans/2026-07-03-ios-pwa-rollout.md` + preamble |
| `docs/superpowers/plans/2026-06-21-remaining-work.md` | 4 | Modify: repoint runbook references |
| (owner, no repo change) | 5 | One-time secrets/EAS-env setup + staged live test |

Reference-update policy: only **live** docs get repointed (`remaining-work.md`).
Dated historical plans (`2026-06-21-migration-expo-cloudflare.md`,
`2026-07-03-ios-pwa.md`) keep their original paths — they describe the repo as
it was when written.

---

### Task 1: `production` EAS build profile

**Files:**
- Modify: `apps/mobile/eas.json`

- [ ] **Step 1: Add the profile**

Replace the full file content with:

```json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "environment": "preview"
    },
    "production": {
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "environment": "production"
    }
  }
}
```

(`production` still sideloads — APK + internal distribution, no store. The
`environment` pulls `EXPO_PUBLIC_*` from the EAS **production** environment,
which the owner creates in Task 5.)

- [ ] **Step 2: Validate JSON parses**

Run from repo root:

```powershell
node -e "JSON.parse(require('fs').readFileSync('apps/mobile/eas.json','utf8')); console.log('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
npm run lint
git add apps/mobile/eas.json
git commit -m "chore(mobile): add EAS production build profile"
```

---

### Task 2: `release.yml`

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Sanity-test the version-gate shell logic locally**

The `version` job's comparison logic is plain bash — verify it standalone
before embedding it. Run (Git Bash via the Bash tool):

```bash
VERSION=1.2.3
LATEST=v1.2.2
HIGHEST=$(printf '%s\n%s\n' "${LATEST#v}" "$VERSION" | sort -V | tail -n1)
[ "$HIGHEST" = "$VERSION" ] && echo "1.2.3 beats 1.2.2: release"
VERSION=1.2.1
HIGHEST=$(printf '%s\n%s\n' "${LATEST#v}" "$VERSION" | sort -V | tail -n1)
[ "$HIGHEST" != "$VERSION" ] && echo "1.2.1 below 1.2.2: refuse"
echo "9.9.9" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' && echo "semver ok"
echo "1.2" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || echo "1.2 rejected"
```

Expected output, in order: `1.2.3 beats 1.2.2: release`, `1.2.1 below 1.2.2:
refuse`, `semver ok`, `1.2 rejected`.

- [ ] **Step 2: Create the workflow**

Create `.github/workflows/release.yml` with exactly:

```yaml
name: Release

run-name: >-
  Release · ${{ github.event_name == 'workflow_dispatch' && 'preview (Android only)' || 'production' }} · @${{ github.actor }}

# Production: a push to main that changes the root package.json version.
# (The paths filter fires on ANY root package.json edit — e.g. adding a dep —
# so the version job below no-ops cleanly when the version is unchanged.)
# Preview: manual dispatch → Android EAS preview build only. The PWA has no
# preview environment (see AGENTS.md); it is pre-validated by the
# exported-build Playwright suite and deploys to production only.
on:
  push:
    branches: [main]
    paths: [package.json]
  workflow_dispatch:

# Never interleave two releases; don't cancel one already in flight.
concurrency:
  group: release
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  version:
    name: Version gate (package.json is truth)
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.gate.outputs.version }}
      release: ${{ steps.gate.outputs.release }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # need all tags for the comparison
      - name: Read and validate the version
        id: gate
        run: |
          VERSION=$(jq -r .version package.json)
          if ! echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
            echo "::error::package.json version '$VERSION' is not strict semver X.Y.Z"
            exit 1
          fi
          if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
            echo "Tag v$VERSION already exists — package.json changed without a version bump; nothing to release."
            echo "release=false" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          LATEST=$(git tag --list 'v*' --sort=-v:refname | head -n1)
          if [ -n "$LATEST" ]; then
            HIGHEST=$(printf '%s\n%s\n' "${LATEST#v}" "$VERSION" | sort -V | tail -n1)
            if [ "$HIGHEST" != "$VERSION" ]; then
              echo "::error::version $VERSION is below the latest tag $LATEST — downgrade/typo?"
              exit 1
            fi
          fi
          echo "Releasing v$VERSION"
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
          echo "release=true" >> "$GITHUB_OUTPUT"

  deploy-pwa:
    name: Deploy PWA (Worker static assets)
    needs: version
    if: needs.version.outputs.release == 'true'
    runs-on: ubuntu-latest
    env:
      # Non-secret prod URLs, kept out of the repo per the env-config policy.
      EXPO_PUBLIC_API_BASE_URL: ${{ vars.EXPO_PUBLIC_API_BASE_URL }}
      EXPO_PUBLIC_PARTY_HOST: ${{ vars.EXPO_PUBLIC_PARTY_HOST }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - name: Guard repo variables are configured
        run: |
          test -n "$EXPO_PUBLIC_API_BASE_URL" || { echo "::error::repo variable EXPO_PUBLIC_API_BASE_URL is unset"; exit 1; }
          test -n "$EXPO_PUBLIC_PARTY_HOST" || { echo "::error::repo variable EXPO_PUBLIC_PARTY_HOST is unset"; exit 1; }
      # --clear is belt-and-braces on a fresh runner; EXPO_PUBLIC_* is inlined
      # at Metro transform time and must be the production values (AGENTS.md).
      - name: Export web build (production URLs baked)
        working-directory: apps/mobile
        run: npx expo export --platform web --clear
      - name: Verify the prod host is baked into the bundle
        run: grep -rq "$EXPO_PUBLIC_PARTY_HOST" apps/mobile/dist/_expo/static/js/web/
      - name: Deploy Worker + static assets
        working-directory: apps/party
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: npx wrangler deploy
      - name: Verify the deployed surface
        run: |
          check() {
            CODE=$(curl -s -o /dev/null -w '%{http_code}' "$1")
            if [ "$CODE" != "$2" ]; then
              echo "::error::$1 returned $CODE (expected $2)"
              exit 1
            fi
            echo "$1 -> $CODE"
          }
          check "$EXPO_PUBLIC_API_BASE_URL/manifest.json" 200
          check "$EXPO_PUBLIC_API_BASE_URL/icons/icon-192.png" 200
          check "$EXPO_PUBLIC_API_BASE_URL/api/auth/me" 401

  build-android:
    name: Build Android APK (EAS production)
    needs: version
    if: needs.version.outputs.release == 'true'
    runs-on: ubuntu-latest
    outputs:
      build_url: ${{ steps.eas.outputs.build_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      # Waits for the cloud build (~10-20 min): the tag must mean "everything
      # actually shipped". EXPO_PUBLIC_* comes from the EAS production
      # environment (eas.json profile), not from this job's env.
      - name: EAS build (production profile, wait for completion)
        id: eas
        working-directory: apps/mobile
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
        run: |
          npx eas-cli build --profile production --platform android \
            --non-interactive --json \
            -m "release v${{ needs.version.outputs.version }}" > build.json
          jq . build.json
          echo "build_url=$(jq -r '.[0].artifacts.buildUrl // empty' build.json)" >> "$GITHUB_OUTPUT"

  tag-and-release:
    name: Tag + GitHub Release
    needs: [version, deploy-pwa, build-android]
    if: needs.version.outputs.release == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Create tag and Release
        env:
          GH_TOKEN: ${{ github.token }}
          VERSION: ${{ needs.version.outputs.version }}
          APK_URL: ${{ needs.build-android.outputs.build_url }}
        run: |
          {
            echo "**PWA:** ${{ vars.EXPO_PUBLIC_API_BASE_URL }}"
            if [ -n "$APK_URL" ]; then
              echo "**Android APK (sideload):** $APK_URL"
            else
              echo "**Android APK (sideload):** see the EAS build list (https://expo.dev)"
            fi
          } > notes.md
          gh release create "v$VERSION" \
            --target "$GITHUB_SHA" \
            --title "v$VERSION" \
            --notes-file notes.md \
            --generate-notes

  android-preview:
    name: Android preview build (EAS, no tag)
    if: github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - name: EAS build (preview profile)
        working-directory: apps/mobile
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
        run: |
          npx eas-cli build --profile preview --platform android \
            --non-interactive \
            -m "preview ${GITHUB_SHA::7} (${GITHUB_REF_NAME})"
```

- [ ] **Step 3: Validate the YAML parses**

```powershell
node -e "const yaml=require('yaml'); yaml.parse(require('fs').readFileSync('.github/workflows/release.yml','utf8')); console.log('yaml ok')"
```

If the `yaml` package isn't available, use:
`npx --yes js-yaml .github/workflows/release.yml > $null; if ($?) { 'yaml ok' }`
Expected: `yaml ok` (no parse errors).

- [ ] **Step 4: Commit**

```bash
npm run lint
git add .github/workflows/release.yml
git commit -m "ci(release): package.json-driven release workflow (PWA deploy + EAS build + tag)"
```

---

### Task 3: AGENTS.md + CLAUDE.md notes

**Files:**
- Modify: `AGENTS.md` (gotchas — after the "`expo start` in CI needs `--offline`" section)
- Modify: `CLAUDE.md` ("Read first" section)

- [ ] **Step 1: AGENTS.md bullet**

Insert after the `### \`expo start\` in CI needs \`--offline\`` section (before
the `<!-- gitnexus:start -->` marker):

```markdown
### Releases: preview is Android-only

- `.github/workflows/release.yml` releases both targets. **Production** runs on
  a `main` push that bumps the root `package.json` version (the single source
  of truth) — it deploys the PWA, builds the Android APK (EAS `production`
  profile), and only then tags `vX.Y.Z` + creates the GitHub Release.
  **Preview** (manual dispatch) is **Android-only**: the PWA has no preview
  environment — its pre-prod gate is the exported-build Playwright suite
  (`playwright.exported.config.ts`). Manual/first-time paths live in
  `docs/runsheets/`.
```

- [ ] **Step 2: CLAUDE.md note**

In `CLAUDE.md`, in the "Read first" list, add a fourth bullet after the
`plans/2026-06-21-remaining-work.md` bullet:

```markdown
- **`docs/runsheets/`** — operational runbooks (Cloudflare setup, Android
  deploy, PWA deploy). Releases are normally automated by
  `.github/workflows/release.yml` (production = root `package.json` version
  bump on main; preview = manual dispatch, **Android-only** — the PWA has no
  preview environment).
```

- [ ] **Step 3: Lint and commit**

```bash
npm run lint
git add AGENTS.md CLAUDE.md
git commit -m "docs: record release model (preview = Android-only) in AGENTS/CLAUDE"
```

---

### Task 4: `docs/runsheets/` extraction

**Files:**
- Move: `docs/superpowers/plans/2026-06-27-phase-b-deploy.md` → `docs/runsheets/cloudflare-setup.md`
- Move: `docs/superpowers/plans/2026-06-27-android-preview-build-push.md` → `docs/runsheets/android-deploy.md`
- Move: `docs/superpowers/plans/2026-07-03-ios-pwa-rollout.md` → `docs/runsheets/pwa-deploy.md`
- Modify: `docs/superpowers/plans/2026-06-21-remaining-work.md` (repoint references)

- [ ] **Step 1: Move the files with git mv**

```bash
mkdir docs/runsheets
git mv docs/superpowers/plans/2026-06-27-phase-b-deploy.md docs/runsheets/cloudflare-setup.md
git mv docs/superpowers/plans/2026-06-27-android-preview-build-push.md docs/runsheets/android-deploy.md
git mv docs/superpowers/plans/2026-07-03-ios-pwa-rollout.md docs/runsheets/pwa-deploy.md
```

- [ ] **Step 2: Add a preamble to each moved file**

Insert at the very top of each file (above the existing H1), with the right
`<original-path>` per file:

```markdown
> **Runsheet** (moved 2026-07-04 from `docs/superpowers/plans/<original-path>`).
> Day-to-day releases are automated by `.github/workflows/release.yml`
> (production = root `package.json` version bump; preview = manual dispatch,
> Android-only). Use this document for first-time setup or when deploying
> manually.
```

- [ ] **Step 3: Repoint references in the live plan doc**

In `docs/superpowers/plans/2026-06-21-remaining-work.md`, replace every
occurrence:

- `docs/superpowers/plans/2026-06-27-phase-b-deploy.md` and bare
  `2026-06-27-phase-b-deploy.md` → `docs/runsheets/cloudflare-setup.md`
- bare `2026-06-27-android-preview-build-push.md` → `docs/runsheets/android-deploy.md`
- bare `2026-07-03-ios-pwa-rollout.md` → `docs/runsheets/pwa-deploy.md`

(Historical plans `2026-06-21-migration-expo-cloudflare.md` and
`2026-07-03-ios-pwa.md` are left unchanged by policy — see the header of this
plan.)

- [ ] **Step 4: Verify no live doc references the old paths, and lint**

```bash
grep -rn "2026-06-27-phase-b-deploy\|2026-06-27-android-preview-build-push\|2026-07-03-ios-pwa-rollout" --include="*.md" . | grep -v node_modules | grep -v "2026-06-21-migration-expo-cloudflare.md\|2026-07-03-ios-pwa.md\|2026-07-04-release-workflow"
npm run lint:md
```

Expected: the grep prints nothing (only the two historical plans and this plan
may still reference old names); markdownlint passes — **the moved files are now
linted** (`docs/runsheets/` is not in `.markdownlint-cli2.jsonc` ignores; only
`docs/superpowers/**` is). Fix any findings in the moved files (likely
candidates: MD022 blanks around headings, MD031/MD032 blanks around
fences/lists, MD040 fenced code language) rather than adding ignores.

- [ ] **Step 5: Commit**

```bash
npm run lint
git add -A docs
git commit -m "docs: extract operational runsheets to docs/runsheets/"
```

---

### Task 5: Owner setup + staged live test  [owner-run]

No repo changes — the one-time account wiring and the live verification. The
implementing agent stops before this task and hands the checklist to the owner.

- [ ] **Step 1: EAS production environment vars**

From `apps/mobile`:

```bash
npx eas-cli env:create --environment production --name EXPO_PUBLIC_API_BASE_URL --value https://trapcard-party.hrmnfng.workers.dev --visibility plaintext
npx eas-cli env:create --environment production --name EXPO_PUBLIC_PARTY_HOST --value trapcard-party.hrmnfng.workers.dev --visibility plaintext
npx eas-cli env:list --environment production
```

- [ ] **Step 2: GitHub secrets + variables**

```bash
gh secret set EXPO_TOKEN            # from https://expo.dev/settings/access-tokens (create a robot token)
gh secret set CLOUDFLARE_API_TOKEN  # Cloudflare dashboard -> API tokens -> "Edit Cloudflare Workers" template
gh secret set CLOUDFLARE_ACCOUNT_ID # from the Cloudflare dashboard URL / wrangler whoami
gh variable set EXPO_PUBLIC_API_BASE_URL --body "https://trapcard-party.hrmnfng.workers.dev"
gh variable set EXPO_PUBLIC_PARTY_HOST --body "trapcard-party.hrmnfng.workers.dev"
```

- [ ] **Step 3: Test the preview path (cheap, proves EAS wiring)**

After the PR with Tasks 1–4 merges: Actions → Release → Run workflow (main).
Expected: single `Android preview build` job; a preview APK appears on the EAS
builds page with message `preview <sha> (main)`.

- [ ] **Step 4: First production release**

PR that bumps the root version — given both platforms shipped 2026-07-04,
start at `1.0.0`:

```bash
npm version 1.0.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: v1.0.0"
```

Merge it. Expected: the Release workflow runs `version → deploy-pwa +
build-android → tag-and-release`; tag `v1.0.0` and a GitHub Release exist with
the APK link and PWA URL; the PWA still serves (curl checks ran in-workflow).

- [ ] **Step 5: Confirm the no-op path**

The next merged PR that touches root `package.json` *without* a version bump
should produce a skipped run: `version` job logs "Tag v1.0.0 already exists",
`release=false`, downstream jobs skip.
