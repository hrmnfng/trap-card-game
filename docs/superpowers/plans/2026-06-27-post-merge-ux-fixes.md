# Post-Merge UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the batch of UX/correctness bugs found after the cross-device merge (PR #7): a misleading Home back button, an overlapping lobby header title, a "Leave game" label that should read "Return to lobby", the ability to "join" a non-existent lobby (which silently created one), and a keyboard that hides the lobby-code input.

**Architecture:** Expo (RN) client ↔ Cloudflare Worker + PartyServer Durable Object (`LobbyDO`) over WebSocket. These are mostly client-side (expo-router header config, screen copy, keyboard handling) plus one server correctness fix (stop auto-creating a lobby on connect) and one client guard (pre-check a typed code exists before navigating).

**Tech Stack:** TypeScript, npm workspaces, Expo SDK 54 / expo-router 6 / `@react-navigation/native-stack` 7.x, Cloudflare Workers + PartyServer, Vitest, Playwright.

**Working principle:** Per-issue. Each task ends green for its workspace (typecheck + lint, plus the unit/e2e test where one applies), then commits, before the next. Several tasks are header/keyboard config whose only honest gate is typecheck + the existing e2e staying green + a manual device check — those are called out explicitly rather than faking a unit test.

**Branch:** `fix/post-merge-ux-fixes` (off `main` after the PR #7 merge).

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `apps/mobile/app/_layout.tsx` | modify | Header options: minimal back-button (no overlapping title); no back button on Home (#1, #2) |
| `apps/mobile/app/game/[code].tsx` | modify | Footer link copy "Leave game" → "Return to lobby" (#6) |
| `apps/mobile/e2e/multiplayer.spec.ts` | modify | Update the reconnect locator to the new "Return to lobby" copy (#6) |
| `apps/party/src/LobbyDO.ts` | modify | `onConnect` rejects an unknown room instead of lazily creating it (#5 server) |
| `apps/party/test/lobby.integration.test.ts` | modify | `.skip`ped doc test: connecting to an uncreated code is rejected (#5) |
| `apps/mobile/src/lib/apiClient.ts` | modify | `lobbyExists(code)` existence probe (#5 client) |
| `apps/mobile/src/lib/apiClient.test.ts` | modify | Unit-test `lobbyExists` (200 → true, 404 → false) |
| `apps/mobile/app/index.tsx` | modify | Join-by-code guards on `lobbyExists` + alerts; keyboard avoidance (#5 client, #4) |
| `apps/mobile/app/login.tsx` | modify | Keyboard avoidance (#4) |

---

## Task 1: Header — minimal back button + no back button on Home (#1, #2)

**Files:**
- Modify: `apps/mobile/app/_layout.tsx`

> Validation note: native-stack headers don't render meaningfully in the Playwright **web** build, so this task's gate is `typecheck` + the existing web e2e staying green + a **manual device check** (header on the Lobby screen no longer overlaps; Home has no top-left back control). No unit test.

- [ ] **Step 1: Add `headerBackButtonDisplayMode: 'minimal'` to the Stack `screenOptions`**

In `apps/mobile/app/_layout.tsx`, the `<Stack screenOptions={{ ... }}>` currently sets transparent header styles. Add the minimal back-button mode so the previous screen's title ("Trap Card Game") is no longer drawn next to the chevron (which is what overlaps the "Lobby"/code title):

```tsx
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: 'transparent' },
            headerTransparent: true,
            headerTintColor: colors.text,
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        >
```

- [ ] **Step 2: Hide the back button on the Home (`index`) screen**

In the same file, give the `index` screen `headerBackVisible: false` so Home never shows a top-left back control regardless of how it was reached:

```tsx
          <Stack.Screen name="index" options={{ title: 'Trap Card Game', headerBackVisible: false }} />
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck --workspace=@trap/mobile && npm run lint:js`
Expected: PASS (both are valid native-stack 7.x options).

- [ ] **Step 4: Web e2e still green**

Run (from `apps/mobile`): `npm run test:e2e`
Expected: PASS (header config doesn't change `testID`s or routes).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/_layout.tsx
git commit -m "fix(mobile): minimal header back button; none on Home"
```

---

## Task 2: Copy — "Leave game" → "Return to lobby" (#6)

**Files:**
- Modify: `apps/mobile/app/game/[code].tsx`
- Modify: `apps/mobile/e2e/multiplayer.spec.ts`

> Pure copy change on the in-progress (non-concluded) game footer. The web e2e already clicks this link by text, so its locator must move in lockstep.

- [ ] **Step 1: Update the footer link text**

In `apps/mobile/app/game/[code].tsx`, the non-concluded branch renders a "Leave game" link. Change the label (only the visible text; `leave` still calls `exit()` + `router.replace('/')`):

```tsx
        <Pressable style={styles.linkButton} onPress={leave}>
          <Text style={styles.linkText}>Return to lobby</Text>
        </Pressable>
```

- [ ] **Step 2: Update the e2e locator that clicks it**

In `apps/mobile/e2e/multiplayer.spec.ts`, the reconnect step clicks the footer by text. Update it:

```ts
    await vis(guest.getByText('Return to lobby')).click();
```

- [ ] **Step 3: Web e2e green**

Run (from `apps/mobile`): `npm run test:e2e`
Expected: PASS (the reconnect step now finds "Return to lobby").

- [ ] **Step 4: Typecheck + lint + commit**

Run: `npm run typecheck --workspace=@trap/mobile && npm run lint:js`
Expected: PASS.

```bash
git add apps/mobile/app/game/[code].tsx apps/mobile/e2e/multiplayer.spec.ts
git commit -m "fix(mobile): game footer says 'Return to lobby'"
```

---

## Task 3: Server — reject joining a non-existent lobby (#5, server side)

**Files:**
- Modify: `apps/party/src/LobbyDO.ts`
- Modify: `apps/party/test/lobby.integration.test.ts`

> Root cause: `onConnect` calls `ensureRoom()`, which lazily creates a room for **any** code, so a typed-in junk code mints a phantom lobby. Fix: connect must `loadRoom()` and reject when the room was never created via the HTTP `/create` path. The HTTP `/create` route keeps using `ensureRoom()` (it is the one creation path).
>
> Validation note: `onConnect` is WebSocket-only, so it is exercised by the `describe.skip`ped integration suite (segfaults in the Windows workers test-pool per AGENTS.md, runs on CI/Linux). The runnable, user-facing gate for #5 is the client guard + its e2e in Task 4.

- [ ] **Step 1: Add/adjust the skipped integration test documenting the rejection**

In `apps/party/test/lobby.integration.test.ts`, inside the existing `describe.skip(...)`, add a test asserting a connect to a never-created code is rejected and creates nothing:

```ts
  it('rejects connecting to a lobby that was never created', async () => {
    const code = 'NOPE01';
    // No createLobby(code) call — the room does not exist.
    const ws = await connect(code, 'p1', 'Alice');
    const msg = await waitFor(ws, 'error');
    expect(msg.code).toBe('lobby_not_found');

    // And it did not get created as a side effect: HTTP /state is still 404.
    const res = await fetchState(code, 'p1');
    expect(res.status).toBe(404);

    ws.ws.close();
  });
```

(Match the file's existing `connect` / `waitFor` helpers; if there is no `fetchState` helper, inline a `fetch` of `/parties/lobby/<code>/state?playerId=p1` and read `res.status`. This stays `.skip`ped on the Windows toolchain.)

- [ ] **Step 2: Replace `ensureRoom()` with `loadRoom()` + reject in `onConnect`**

In `apps/party/src/LobbyDO.ts`, in `onConnect`, change the room acquisition so a missing room is a hard rejection rather than a lazy create. Replace:

```ts
    let room = await this.ensureRoom();
```

with:

```ts
    const existing = await this.loadRoom();
    if (!existing) {
      this.sendTo(connection, {
        type: 'error',
        message: 'No lobby found for that code',
        code: 'lobby_not_found',
      });
      connection.close(4004, 'lobby_not_found');
      return;
    }
    let room = existing;
```

(Leave the HTTP `/create` route's use of `ensureRoom()` unchanged — that remains the sole creation path, reached by `POST /api/lobbies` → `pickUnusedCode`.)

- [ ] **Step 3: Typecheck + party tests + lint**

Run: `npm run typecheck --workspace=@trap/party && npm run test:party && npm run lint:js`
Expected: PASS (the new integration test stays `.skip`ped; HTTP create/history/CORS tests pass; nothing regresses because the owner's connect still finds the room created by `POST /api/lobbies`).

- [ ] **Step 4: Commit**

```bash
git add apps/party/src/LobbyDO.ts apps/party/test/lobby.integration.test.ts
git commit -m "fix(party): reject connecting to a never-created lobby"
```

---

## Task 4: Client — pre-check a typed code exists before joining (#5, client side)

**Files:**
- Modify: `apps/mobile/src/lib/apiClient.ts`
- Modify: `apps/mobile/src/lib/apiClient.test.ts`
- Modify: `apps/mobile/app/index.tsx`

> This is the runnable, user-facing fix: a typed-in junk code shows an alert and never navigates or opens a socket (so PartySocket can't reconnect-storm against the server's rejection). Rejoining from "Your lobbies" is unaffected (those always exist). `GET /parties/lobby/<code>/state` returns 404 for an unknown room **without** creating it (it uses `loadRoom`).

- [ ] **Step 1: Write the failing `lobbyExists` unit test**

In `apps/mobile/src/lib/apiClient.test.ts`, add (match the file's existing fetch-mock style — a `fetchImpl` that returns a `Response`-like object):

```ts
  it('lobbyExists returns true on 200 and false on 404', async () => {
    const okFetch = vi.fn(async () => new Response(JSON.stringify({ status: 'waiting' }), { status: 200 }));
    const okClient = new ApiClient({ baseUrl: 'http://x', fetchImpl: okFetch as unknown as typeof fetch });
    expect(await okClient.lobbyExists('ABCD')).toBe(true);

    const missingFetch = vi.fn(async () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));
    const missingClient = new ApiClient({ baseUrl: 'http://x', fetchImpl: missingFetch as unknown as typeof fetch });
    expect(await missingClient.lobbyExists('ZZZZ')).toBe(false);
  });
```

(If the existing tests build responses differently, mirror that — the only behavior asserted is `res.ok` → boolean.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace=@trap/mobile`
Expected: FAIL — `lobbyExists` is not a method on `ApiClient`.

- [ ] **Step 3: Implement `lobbyExists`**

In `apps/mobile/src/lib/apiClient.ts`, add a method (it must NOT throw on 404, so it bypasses `request()` and reads `res.ok` directly):

```ts
  /**
   * True if a lobby with this code exists. Hits the Durable Object's `/state`
   * pull route, which 404s for an unknown room without creating it. Used to stop
   * a typed-in junk code from opening a socket / minting a phantom lobby.
   */
  async lobbyExists(code: string): Promise<boolean> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/parties/lobby/${encodeURIComponent(code)}/state?playerId=exists-probe`,
      { method: 'GET' }
    );
    return res.ok;
  }
```

- [ ] **Step 4: Run to verify the test passes**

Run: `npm run test --workspace=@trap/mobile`
Expected: PASS.

- [ ] **Step 5: Guard the join-by-code handler**

In `apps/mobile/app/index.tsx`, the `joinLobby` handler currently normalizes the code and navigates. Make it async and pre-check existence, alerting on a miss (leave `createLobby` and the history-row `openLobby` untouched — those don't need a check):

```tsx
  const joinLobby = async () => {
    const code = normalizeLobbyCode(joinCode);
    if (code.length === 0) return;
    const exists = await api.lobbyExists(code).catch(() => false);
    if (!exists) {
      Alert.alert('Lobby not found', `No lobby exists with code ${code}.`);
      return;
    }
    router.push(`/lobby/${code}`);
  };
```

(`Alert` is already imported in `index.tsx`; `api` is the singleton already imported. Update the `onPress` to `() => void joinLobby()` if the `Pressable` expects a sync handler — check the existing `join-lobby` `Pressable`.)

- [ ] **Step 6: Typecheck + tests + lint**

Run: `npm run typecheck --workspace=@trap/mobile && npm run test --workspace=@trap/mobile && npm run lint:js`
Expected: PASS.

- [ ] **Step 7: Web e2e — junk code is blocked**

In `apps/mobile/e2e/multiplayer.spec.ts` (or a small new case in the same file), assert a junk code does not navigate. Minimal addition near the top-level flow is optional; if added, keep it cheap:

```ts
test('joining a non-existent code shows an alert and does not navigate', async ({ page }) => {
  const user = uniqueUser('solo');
  await registerAndLand(page, user);
  page.on('dialog', (d) => d.accept()); // dismiss the RN web alert
  await vis(page.getByPlaceholder('Lobby code')).fill('ZZZZ');
  await vis(page.getByTestId('join-lobby')).click();
  await expect(page).toHaveURL(/\/(?:index)?(?:\?|$)/); // still on Home, not /lobby/ZZZZ
});
```

Run (from `apps/mobile`): `npm run test:e2e`
Expected: PASS. (On web, `Alert.alert` surfaces as a `window` dialog; the `dialog` handler accepts it. If RN-web renders `Alert` differently and the dialog never fires, assert only the URL did not become `/lobby/ZZZZ`.)

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/lib/apiClient.ts apps/mobile/src/lib/apiClient.test.ts apps/mobile/app/index.tsx apps/mobile/e2e/multiplayer.spec.ts
git commit -m "fix(mobile): block joining a non-existent lobby code"
```

---

## Task 5: Keyboard no longer hides the lobby-code input (#4)

**Files:**
- Modify: `apps/mobile/app/index.tsx`
- Modify: `apps/mobile/app/login.tsx`

> The join-code input sits low on Home; the soft keyboard covers it on both platforms. Fix with the built-in `KeyboardAvoidingView` (no new dependency). This is a layout fix with no unit seam — the gate is `typecheck` + existing e2e green + a **manual device check on Android and iOS**. If `KeyboardAvoidingView` proves insufficient on a real device, fall back to `react-native-keyboard-aware-scroll-view` (per the "prefer libraries" preference) — note that in the PR rather than hand-rolling offsets.

- [ ] **Step 1: Wrap Home content in `KeyboardAvoidingView`**

In `apps/mobile/app/index.tsx`, add the import and wrap the existing `<MotiView style={styles.container}>` (authenticated branch) so it lifts above the keyboard. Add `KeyboardAvoidingView` and `Platform` to the existing `react-native` import, then:

```tsx
  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <MotiView
          style={styles.container}
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 260 }}
        >
          {/* ...existing children unchanged... */}
        </MotiView>
      </KeyboardAvoidingView>
    </Screen>
  );
```

Add a `flex` style to the stylesheet:

```tsx
  flex: { flex: 1 },
```

- [ ] **Step 2: Wrap Login content in `KeyboardAvoidingView`**

In `apps/mobile/app/login.tsx`, do the same around its `<MotiView style={styles.container}>` (the password field is the one that gets covered). Add `KeyboardAvoidingView` + `Platform` to its `react-native` import, wrap the `MotiView`, and add the `flex: { flex: 1 }` style.

- [ ] **Step 3: Typecheck + lint + web e2e**

Run: `npm run typecheck --workspace=@trap/mobile && npm run lint:js`
Expected: PASS.
Run (from `apps/mobile`): `npm run test:e2e`
Expected: PASS (`KeyboardAvoidingView` renders as a plain flex container on web; no keyboard there, no `testID` change).

- [ ] **Step 4: Manual device check (both platforms)**

On an Android device/emulator and an iOS simulator/device: focus the "Lobby code" input on Home and the password field on Login — the focused input stays visible above the keyboard.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/index.tsx apps/mobile/app/login.tsx
git commit -m "fix(mobile): keyboard no longer hides code/password inputs"
```

---

## Backlog (triaged, deferred — documented not scheduled)

These came out of the same triage but are intentionally **not** in the task list above. Ordered by priority.

- **#3 — Group "Your lobbies" by state + hide completed (fast-follow, P2).** Home currently lists `lobby_history` flat. Want: section by state (active/waiting vs concluded) with a toggle to hide completed. Server already returns `status` per row (`listLobbyHistory`); this is a Home-screen UI change (sectioned list + a persisted "hide completed" toggle). Medium effort — its own small spec/plan.

- **#7 — Push notifications don't work in Expo Go over LAN (expected; resolved by Phase B6).** This is a known Expo Go (SDK 54) limitation, already documented in `QUICKSTART.md` §3 and the migration plan. Remote push needs an **Expo Dev Build** (`2026-06-21-remaining-work.md` Phase B6). No code fix in the current Expo Go setup — close as "working as intended; tracked under Phase B deploy."

- **Maestro device-tier CI is flaky / currently red (P2, likely involved).** `.github/workflows/device.yml` runs the Hermes/Android gate on `ubuntu-latest` via `reactivecircus/android-emulator-runner` + Expo Go. Known flakiness surfaces:
  - emulator cold-boot + KVM accel variance on GH runners;
  - installing the Expo Go (SDK 54) APK onto the freshly-booted emulator (`ci-device-run.sh`);
  - Metro's first Hermes bundle timing vs. the Maestro flow's waits;
  - the host↔emulator bridge (`10.0.2.2:8787`) and the `player2.mjs` `LOBBY_CODE` handshake racing app readiness.
  Likely fixes (to scope later): add Maestro retries/longer `waitForAnimationToEnd`/`extendedWaitUntil` in the flows; gate the emulator step on an explicit "Metro ready"/"app installed" probe; pin/prewarm the Expo Go APK; consider AVD snapshot caching; make the job `continue-on-error` (non-blocking nightly) until stabilized so PRs aren't blocked by infra flake. Its own spec/plan when picked up — **do not block this UX branch on it.**

- **Pre-existing future work (unchanged):** 7-day lobby-inactivity expiry (the stale `LOBBY_EXPIRATION_HOURS = 24` in `LobbyDO.ts` is currently not enforced as a hard cap and should become the 7-day inactivity policy); I5 owner-offline stall (documented limitation); Phase B deploy (real D1/KV ids + `wrangler deploy` + Dev Build); Phase D graphics polish (deferred/low priority).

---

## Self-Review

- **Spec coverage:** #2 (Task 1), #1 (Task 1), #6 (Task 2), #5 server (Task 3) + client (Task 4), #4 (Task 5). #3, #7, Maestro flakiness, and prior future-work are in the Backlog section.
- **Placeholder scan:** every code step shows the actual edit; test helper names (`connect`/`waitFor` in party, the apiClient fetch-mock, `vis()`/`uniqueUser` in e2e) are flagged to match the existing files rather than invented.
- **Type consistency:** `lobbyExists(code: string): Promise<boolean>` is defined in Task 4 and called in `index.tsx` (Task 4); the server error `code: 'lobby_not_found'` (Task 3) matches what the client guard avoids triggering by pre-checking (Task 4); header options (`headerBackButtonDisplayMode`, `headerBackVisible`) are native-stack 7.x.
- **Honest validation:** Tasks 1 and 5 (header/keyboard) are explicitly typecheck + e2e-green + manual-device, not faked unit tests; Task 3 (WS-only server path) is documented via the `.skip`ped integration test with the user-facing gate living in Task 4's e2e.
