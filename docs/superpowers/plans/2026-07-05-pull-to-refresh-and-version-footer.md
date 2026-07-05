# Pull-to-Refresh + Version Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull-to-refresh on the lobby and game screens (Android gesture + web button) with an honest spinner, and a version footer on login/home — preceded by the three mobile-side dedupe refactors that touch the same code (`useLobbyScreen` hook, `Button`/`LinkButton` component, `startTwoPlayerGame` e2e helper).

**Architecture:** `refresh()` lives in the Expo-free game store: on an open socket it sends the existing `get_state`; otherwise it reconnects via a new `LobbyConnection.reconnect()`. The returned promise resolves on the next `state_update` (5s cap), so the spinner ending means fresh state arrived. UI consumes it through a tiny `useRefresh()` hook feeding both React Native's `RefreshControl` (native) and a web-only refresh button. The version footer inlines the **root** `package.json` version via Metro's JSON import.

**Tech Stack:** React Native / Expo SDK 54, Zustand vanilla stores, partysocket, vitest (Expo-free `src/lib` + `src/state`), Playwright e2e (web build vs local Worker).

**Spec:** `docs/superpowers/specs/2026-07-05-pull-to-refresh-and-version-footer-design.md`

**Conventions that apply to every task:** run `npm run lint` from the repo root before each commit (CI enforces it). Unit tests / typecheck run from `apps/mobile`. Playwright runs from `apps/mobile`; run `npm run e2e:clean` first if a manual dev server may be holding ports 8081/8787 (a reused prod-pointed server would silently run the suite against production — see the runsheet note in QUICKSTART.md).

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `apps/mobile/src/state/useLobbyScreen.ts` | create | Shared connect-on-open + route-forward + `me` selection for the three live screens |
| `apps/mobile/src/ui/Button.tsx` | create | `Button` (primary/accent/surface variants, loading) + `LinkButton` |
| `apps/mobile/e2e/helpers.ts` | modify | Add `startTwoPlayerGame()` |
| `apps/mobile/e2e/multiplayer.spec.ts` | modify | Use the helper (mid-lobby assertions via callback) |
| `apps/mobile/src/lib/realtime.ts` | modify | `LobbyConnection.reconnect()` |
| `apps/mobile/src/state/game.ts` | modify | `refresh(): Promise<void>` + `refreshTimeoutMs` dep |
| `apps/mobile/src/ui/useRefresh.ts` | create | `{refreshing, onRefresh}` spinner state around `refresh()` |
| `apps/mobile/src/ui/RefreshButton.tsx` | create | Web-only manual refresh affordance |
| `apps/mobile/src/ui/VersionFooter.tsx` | create | `v{version}` from root package.json |
| `apps/mobile/app/lobby/[code].tsx` | modify | Hook + Button swap + RefreshControl + RefreshButton |
| `apps/mobile/app/prep/[code].tsx` | modify | Hook + Button swap (no refresh UI — out of scope) |
| `apps/mobile/app/game/[code].tsx` | modify | Hook + Button swap + RefreshControl + RefreshButton |
| `apps/mobile/app/login.tsx` | modify | Button swap + VersionFooter |
| `apps/mobile/app/index.tsx` | modify | Button swap + VersionFooter |
| `apps/mobile/src/lib/realtime.test.ts` | modify | reconnect() tests |
| `apps/mobile/src/state/game.test.ts` | modify | refresh() tests |
| `apps/mobile/e2e/refresh.spec.ts` | create | Web refresh-button e2e (lobby + game) |
| `apps/mobile/e2e/version.spec.ts` | create | Version footer e2e |

---

### Task 1: `useLobbyScreen` hook (refactor — dedupe the 3×2 copied effects)

Behavior-preserving refactor; the guard is the existing e2e suite (it traverses every transition this hook owns: lobby→prep→game advance, direct re-entry reconnect, winner flow) plus `navigation.test.ts` for `screenForState`. No new unit test — the hook needs a React renderer the repo deliberately doesn't have.

**Files:**
- Create: `apps/mobile/src/state/useLobbyScreen.ts`
- Modify: `apps/mobile/app/lobby/[code].tsx`, `apps/mobile/app/prep/[code].tsx`, `apps/mobile/app/game/[code].tsx`

- [ ] **Step 1: Create the hook**

```tsx
// apps/mobile/src/state/useLobbyScreen.ts
/**
 * Shared per-screen wiring for the three live screens (lobby / prep / game):
 *  - connect the game store when the screen is opened directly (deep link,
 *    reload, or re-entry from Home) and the store isn't already on this code;
 *  - route forward/back when the server status moves on (mirrors the server's
 *    submit gate: an unsubmitted player stays in prep after game start);
 *  - derive `me` from the per-player state.
 * Replaces three verbatim copies of the same two effects. The screen itself
 * still owns its `<Redirect>` for the unauthenticated case (it must render).
 */
import { useEffect } from 'react';
import { router } from 'expo-router';
import { gameStore } from './game';
import { useAuth, useGame } from './hooks';
import { screenForState, type GameScreen } from '../lib/navigation';

export function useLobbyScreen(current: GameScreen, code: string | undefined) {
  const userId = useAuth((s) => s.userId);
  const username = useAuth((s) => s.username);
  const gameState = useGame((s) => s.gameState);
  const lobbyCode = useGame((s) => s.lobbyCode);
  const connectionStatus = useGame((s) => s.connectionStatus);
  const error = useGame((s) => s.error);

  useEffect(() => {
    if (code && userId && username && lobbyCode !== code) {
      gameStore.getState().connect({ code, playerId: userId, username });
    }
  }, [code, userId, username, lobbyCode]);

  const me = gameState?.players.find((p) => p.id === userId);
  const hasSubmitted = me?.hasSubmitted ?? false;

  useEffect(() => {
    if (!gameState || !code) return;
    const target = screenForState(gameState.status, hasSubmitted);
    if (target !== current) router.replace(`/${target}/${code}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on status like the originals
  }, [gameState?.status, hasSubmitted, code, current]);

  return { userId, username, gameState, me, hasSubmitted, connectionStatus, error };
}
```

(If ESLint doesn't flag the deps array, drop the disable comment — only keep it if the repo's config complains, matching how the original screens passed lint.)

- [ ] **Step 2: Use it in the lobby screen**

In `apps/mobile/app/lobby/[code].tsx`: delete the `useAuth`/`useGame` selector lines for `userId, username, gameState, connectionStatus, lobbyCode, error`, the connect `useEffect`, the `me` computation, and the route-forward `useEffect` (lines 16–56 region). Replace with:

```tsx
const { code } = useLocalSearchParams<{ code: string }>();
const { userId, gameState, me, connectionStatus, error } = useLobbyScreen('lobby', code);
```

Add the import: `import { useLobbyScreen } from '../../src/state/useLobbyScreen';`. Remove now-unused imports (`useEffect` stays only if still used by the copy-timer effect — it is; `gameStore` stays for `setReady`/`startPrep`/`exit`; remove `useGame`/`useAuth`/`screenForState` imports if unused). The rest of the screen reads `me?.isReady` etc. unchanged.

- [ ] **Step 3: Use it in the prep screen**

Same surgery in `apps/mobile/app/prep/[code].tsx`: replace the selectors, the connect effect, `me`/`hasSubmitted`, and the route effect with:

```tsx
const { code } = useLocalSearchParams<{ code: string }>();
const { userId, gameState, hasSubmitted, error } = useLobbyScreen('prep', code);
```

`cardsPerPlayer`, the statements state, and everything else stays.

- [ ] **Step 4: Use it in the game screen**

Same in `apps/mobile/app/game/[code].tsx`:

```tsx
const { code } = useLocalSearchParams<{ code: string }>();
const { userId, gameState, me } = useLobbyScreen('game', code);
```

(The game screen doesn't use `error`/`connectionStatus`; keep `useGame((s) => s.gameHistory…)`-style reads it already has — it reads everything off `gameState`, so only the deleted blocks change.)

- [ ] **Step 5: Typecheck + unit tests**

Run from `apps/mobile`: `npm run typecheck && npx vitest run`
Expected: clean; all existing tests pass (none import the new hook).

- [ ] **Step 6: Full e2e**

From `apps/mobile`: `npm run test:e2e`
Expected: 14 passed (both engines). This is the behavioral guard for the refactor.

- [ ] **Step 7: Commit**

```bash
npm run lint   # repo root
git add apps/mobile/src/state/useLobbyScreen.ts apps/mobile/app
git commit -m "refactor(mobile): useLobbyScreen hook dedupes the copied connect/route effects"
```

---

### Task 2: `Button` / `LinkButton` component (refactor — dedupe ~13 hand-rolled sites)

Behavior-preserving; guarded by the e2e suite, which clicks/asserts every converted control by testID or text. Two deliberate unifications: press-scale feedback everywhere (three sites used plain `Pressable`), and disabled opacity 0.6 everywhere (two screens used 0.5).

**Files:**
- Create: `apps/mobile/src/ui/Button.tsx`
- Modify: `apps/mobile/app/login.tsx`, `apps/mobile/app/index.tsx`, `apps/mobile/app/lobby/[code].tsx`, `apps/mobile/app/prep/[code].tsx`, `apps/mobile/app/game/[code].tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/mobile/src/ui/Button.tsx
/**
 * The app's standard action button and quiet link-style counterpart.
 * Consolidates the PressableScale + per-screen button styles that five screens
 * hand-rolled (primary vs accent vs surface differed; spacing comes via
 * `style`). Keeps testIDs/labels intact so every e2e selector still works.
 */
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors } from '../lib/theme';
import { PressableScale } from './PressableScale';

export type ButtonVariant = 'primary' | 'accent' | 'surface';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  testID,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const inert = disabled || loading;
  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      disabled={inert}
      style={[styles.base, variants[variant], inert && styles.disabled, style]}
    >
      {loading ? (
        <ActivityIndicator color={colors.primaryText} />
      ) : (
        <Text style={styles.text}>{title}</Text>
      )}
    </PressableScale>
  );
}

export function LinkButton({
  title,
  onPress,
  testID,
  style,
}: {
  title: string;
  onPress?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable testID={testID} style={[styles.link, style]} onPress={onPress}>
      <Text style={styles.linkText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  disabled: { opacity: 0.6 },
  text: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  link: { alignItems: 'center', paddingVertical: 8 },
  linkText: { color: colors.muted, fontSize: 14 },
});

const variants = StyleSheet.create({
  primary: { backgroundColor: colors.primary },
  accent: { backgroundColor: colors.accent },
  surface: { backgroundColor: colors.surface },
});
```

Note: `PressableScale`'s `style` prop lands on the inner `MotiView`, so passing the visual style through works unchanged.

- [ ] **Step 2: Convert `login.tsx`**

```tsx
<Button
  testID="auth-submit"
  title={mode === 'login' ? 'Sign in' : 'Register'}
  loading={loading}
  onPress={submit}
/>

<LinkButton
  testID="auth-toggle"
  title={mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign in'}
  onPress={() => setMode(mode === 'login' ? 'register' : 'login')}
/>
```

Delete `button`, `buttonDisabled`, `buttonText`, `linkButton`, `linkText` from the StyleSheet and the now-unused `ActivityIndicator`/`PressableScale`/`Pressable` imports (keep `Pressable` only if still used elsewhere in the file — it isn't).

- [ ] **Step 3: Convert `index.tsx`**

```tsx
<Button testID="signin-cta" title="Sign in / Register" onPress={() => router.push('/login')} />
// ...
<Button
  testID="create-lobby"
  title={creating ? 'Creating…' : 'Create lobby'}
  disabled={creating}
  onPress={createLobby}
/>
// ...in the join row:
<Button testID="join-lobby" title="Join" style={styles.joinButton} onPress={joinLobby} />
// ...
<LinkButton testID="logout" title="Log out" onPress={() => { void authStore.getState().logout(); }} />
```

Add `joinButton: { paddingHorizontal: 20 }` to the StyleSheet; delete `button`, `buttonDisabled`, `buttonText`, `linkButton`, `linkText`.

- [ ] **Step 4: Convert `lobby/[code].tsx`**

```tsx
<Button
  testID="ready-toggle"
  title={iAmReady ? "I'm not ready" : "I'm ready"}
  variant={iAmReady ? 'surface' : 'accent'}
  style={styles.stackedButton}
  onPress={() => gameStore.getState().setReady(!iAmReady)}
/>

{isOwner ? (
  <Button
    testID="start-game"
    title={
      canStart
        ? 'Start (author cards)'
        : players.length < MIN_PLAYERS
          ? `Need ${MIN_PLAYERS}+ players`
          : 'Waiting for all to ready'
    }
    variant="accent"
    disabled={!canStart}
    style={styles.stackedButton}
    onPress={() => gameStore.getState().startPrep()}
  />
) : (
  <Text style={styles.subtle}>Waiting for the host to start…</Text>
)}

<LinkButton title="Leave lobby" onPress={leave} />
```

Add `stackedButton: { marginTop: 8 }`; delete `button`, `buttonSecondary`, `buttonDisabled`, `buttonText`, `linkButton`, `linkText`.

- [ ] **Step 5: Convert `prep/[code].tsx`**

```tsx
<Button
  testID="submit-cards"
  title="Submit cards"
  variant="accent"
  disabled={!allValid}
  style={styles.submitButton}
  onPress={submit}
/>
// ...footer:
<Button
  testID="begin-game"
  title={allSubmitted ? 'Begin game' : 'Waiting for all to submit'}
  variant="accent"
  disabled={!allSubmitted}
  style={styles.beginButton}
  onPress={() => gameStore.getState().startGame()}
/>
```

Add `submitButton: { marginTop: 12 }`; keep `beginButton: { margin: 16, marginTop: 0 }`; delete `button`, `buttonDisabled`, `buttonText`.

- [ ] **Step 6: Convert `game/[code].tsx`**

```tsx
// in the concluded banner:
<Button title="Back to home" onPress={leave} />
// the non-concluded footer:
<LinkButton title="Return to lobby" style={styles.returnLink} onPress={leave} />
```

Add `returnLink: { paddingVertical: 14 }`; delete `button`, `buttonText`, `linkButton`, `linkText`.

- [ ] **Step 7: Typecheck + unit tests**

From `apps/mobile`: `npm run typecheck && npx vitest run` — expected clean.

- [ ] **Step 8: Full e2e**

From `apps/mobile`: `npm run test:e2e` — expected 14 passed. Every converted control is exercised (auth-submit, auth-toggle, signin-cta implicit, create-lobby, join-lobby, ready-toggle, start-game, submit-cards, begin-game, Return to lobby, Leave lobby).

- [ ] **Step 9: Commit**

```bash
npm run lint
git add apps/mobile/src/ui/Button.tsx apps/mobile/app
git commit -m "refactor(mobile): shared Button/LinkButton replaces per-screen button styles"
```

---

### Task 3: `startTwoPlayerGame` e2e helper

Extract the create→join→ready→prep→begin flow so the refresh e2e (Task 6) doesn't copy it. `multiplayer.spec.ts`'s mid-lobby assertions move into an `onLobby` callback so the spec loses no coverage.

**Files:**
- Modify: `apps/mobile/e2e/helpers.ts`, `apps/mobile/e2e/multiplayer.spec.ts`

- [ ] **Step 1: Add the helper to `helpers.ts`**

```ts
export interface TwoPlayerGame {
  code: string;
  hostUser: string;
  guestUser: string;
}

/**
 * Drive two fresh accounts from registration to the in-game screen (3-card
 * hands each). `onLobby` runs after the guest has joined and both rosters are
 * visible, before anyone readies up — the place for lobby-stage assertions.
 */
export async function startTwoPlayerGame(
  host: Page,
  guest: Page,
  onLobby?: (ctx: TwoPlayerGame) => Promise<void>
): Promise<TwoPlayerGame> {
  const hostUser = uniqueUser('host');
  const guestUser = uniqueUser('guest');
  await registerAndLand(host, hostUser);
  await registerAndLand(guest, guestUser);

  await vis(host.getByTestId('create-lobby')).click();
  await host.waitForURL(/\/lobby\/[A-Z0-9]+/);
  const code = new URL(host.url()).pathname.split('/lobby/')[1]!;

  await vis(guest.getByPlaceholder('Lobby code')).fill(code);
  await vis(guest.getByTestId('join-lobby')).click();
  await guest.waitForURL(new RegExp(`/lobby/${code}`));
  await expect(vis(host.getByText(guestUser))).toBeVisible();
  await expect(vis(guest.getByText(hostUser))).toBeVisible();

  const ctx: TwoPlayerGame = { code, hostUser, guestUser };
  if (onLobby) await onLobby(ctx);

  await vis(host.getByTestId('ready-toggle')).click();
  await vis(guest.getByTestId('ready-toggle')).click();
  await expect(vis(host.getByTestId('start-game'))).toBeEnabled();
  await vis(host.getByTestId('start-game')).click();
  await host.waitForURL(new RegExp(`/prep/${code}`));
  await guest.waitForURL(new RegExp(`/prep/${code}`));

  for (const page of [host, guest]) {
    for (let i = 0; i < 3; i++) {
      await vis(page.getByTestId(`statement-${i}`)).fill(`trap ${i + 1}`);
    }
    await vis(page.getByTestId('submit-cards')).click();
  }

  await expect(vis(host.getByTestId('begin-game'))).toBeEnabled();
  await vis(host.getByTestId('begin-game')).click();
  await host.waitForURL(new RegExp(`/game/${code}`));
  await guest.waitForURL(new RegExp(`/game/${code}`));
  await expect(vis(host.getByTestId('hand-card'))).toHaveCount(3);
  await expect(vis(guest.getByTestId('hand-card'))).toHaveCount(3);
  return ctx;
}
```

- [ ] **Step 2: Refactor `multiplayer.spec.ts` test 1 to use it**

Replace everything from `await registerAndLand(host, hostUser);` through the two `toHaveCount(3)` assertions (lines 27–77) with:

```ts
const { code, hostUser, guestUser } = await startTwoPlayerGame(host, guest, async () => {
  // The guest is not the owner: no Start control, and the waiting hint shows.
  await expect(vis(guest.getByTestId('start-game'))).toHaveCount(0);
  await expect(vis(guest.getByText('Waiting for the host to start…'))).toBeVisible();
});
```

Delete the local `hostUser`/`guestUser` declarations (they come from the helper now) and update the import line to include `startTwoPlayerGame`. The rest of the test (play, reconnect, winner) is unchanged and keeps using `code`, `hostUser`, `guestUser`.

- [ ] **Step 3: Run the multiplayer spec**

From `apps/mobile`: `npx playwright test e2e/multiplayer.spec.ts`
Expected: 8 passed (4 tests × 2 engines).

- [ ] **Step 4: Commit**

```bash
npm run lint
git add apps/mobile/e2e
git commit -m "test(e2e): extract startTwoPlayerGame helper for game-screen preconditions"
```

---

### Task 4: `LobbyConnection.reconnect()`

**Files:**
- Modify: `apps/mobile/src/lib/realtime.ts`, `apps/mobile/src/lib/realtime.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `realtime.test.ts`; reuse the file's existing fake socket if one fits, otherwise this local one)

```ts
describe('reconnect', () => {
  class RecordingSocket implements RealtimeSocket {
    closed = false;
    send(): void {}
    close(): void {
      this.closed = true;
    }
    addEventListener(): void {}
  }

  it('closes the old socket and opens a fresh one', () => {
    const sockets: RecordingSocket[] = [];
    const conn = new LobbyConnection({
      code: 'ABCD',
      playerId: 'p1',
      username: 'alice',
      host: 'example.test',
      socketFactory: () => {
        const s = new RecordingSocket();
        sockets.push(s);
        return s;
      },
    });
    conn.connect();
    expect(sockets).toHaveLength(1);

    conn.reconnect();
    expect(sockets).toHaveLength(2);
    expect(sockets[0]!.closed).toBe(true);
    expect(conn.getStatus()).toBe('connecting');
  });

  it('is a plain connect when never connected', () => {
    const sockets: RecordingSocket[] = [];
    const conn = new LobbyConnection({
      code: 'ABCD',
      playerId: 'p1',
      username: 'alice',
      host: 'example.test',
      socketFactory: () => {
        const s = new RecordingSocket();
        sockets.push(s);
        return s;
      },
    });
    conn.reconnect();
    expect(sockets).toHaveLength(1);
  });
});
```

(TypeScript: `addEventListener(): void {}` satisfies the overloaded interface; if the compiler objects, use `addEventListener(_type: string, _handler: unknown): void {}` with a cast at the assignment.)

- [ ] **Step 2: Run to verify failure**

From `apps/mobile`: `npx vitest run src/lib/realtime.test.ts`
Expected: FAIL — `conn.reconnect is not a function`.

- [ ] **Step 3: Implement** (in `realtime.ts`, after `close()`)

```ts
/**
 * Tear down the current socket (if any) and open a fresh one with the same
 * options. Used by pull-to-refresh when the socket isn't open: the DO pushes
 * a state_update on connect, so fresh state arrives without a request.
 */
reconnect(): void {
  this.close();
  this.connect();
}
```

(`close()` nulls the socket and clears the connect timer; `connect()` is guarded on `this.socket` being null, so the sequence is safe. Message/status handlers live on the connection, not the socket, so subscribers survive.)

- [ ] **Step 4: Run to verify pass**

`npx vitest run src/lib/realtime.test.ts` — expected: all pass.

- [ ] **Step 5: Commit**

```bash
npm run lint
git add apps/mobile/src/lib/realtime.ts apps/mobile/src/lib/realtime.test.ts
git commit -m "feat(mobile): LobbyConnection.reconnect() reopens the socket with the same options"
```

---

### Task 5: `gameStore.refresh()` — the honest-spinner core

**Files:**
- Modify: `apps/mobile/src/state/game.ts`, `apps/mobile/src/state/game.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `game.test.ts`; adapt the fake-connection shape to the file's existing fake if one exists — the required surface is `getStatus`, `requestState`, `reconnect`, `onMessage`, `onStatus`, `connect`, `close` plus the send methods the store calls)

```ts
// Add to the imports at the top of game.test.ts (merge with existing lines):
import type { GameState, ServerMessage } from '@trap/shared';
import type { ConnectionStatus, LobbyConnection } from '../lib/realtime';
// createGameStore is already imported by the existing tests.

function minimalState(): GameState {
  return {
    lobbyId: 'L',
    lobbyCode: 'ABCD',
    status: 'waiting',
    ownerId: 'p1',
    cardsPerPlayer: 3,
    players: [],
    myCards: [],
    gameHistory: [],
    winnerId: null,
    winnerUsername: null,
  };
}

class RefreshFakeConnection {
  status: ConnectionStatus = 'open';
  requested = 0;
  reconnected = 0;
  private handlers = new Set<(m: ServerMessage) => void>();

  connect(): void {}
  close(): void {}
  getStatus(): ConnectionStatus {
    return this.status;
  }
  onStatus(): () => void {
    return () => {};
  }
  onMessage(h: (m: ServerMessage) => void): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
  emit(m: ServerMessage): void {
    for (const h of this.handlers) h(m);
  }
  requestState(): void {
    this.requested += 1;
  }
  reconnect(): void {
    this.reconnected += 1;
  }
  startGame(): void {}
  setReady(): void {}
  startPrep(): void {}
  submitCards(): void {}
  playCard(): void {}
}

describe('refresh', () => {
  function makeStore(conn: RefreshFakeConnection, timeoutMs = 5000) {
    return createGameStore({
      connectionFactory: () => conn as unknown as LobbyConnection,
      refreshTimeoutMs: timeoutMs,
    });
  }

  it('resolves immediately when there is no connection', async () => {
    const store = createGameStore();
    await expect(store.getState().refresh()).resolves.toBeUndefined();
  });

  it('on an open socket, sends get_state and resolves on the next state_update', async () => {
    const conn = new RefreshFakeConnection();
    const store = makeStore(conn);
    store.getState().connect({ code: 'ABCD', playerId: 'p1', username: 'alice' });

    let settled = false;
    const p = store.getState().refresh().then(() => {
      settled = true;
    });
    expect(conn.requested).toBe(1);
    expect(conn.reconnected).toBe(0);
    expect(settled).toBe(false);

    conn.emit({ type: 'state_update', state: minimalState() });
    await p;
    expect(settled).toBe(true);
  });

  it('on a non-open socket, reconnects instead of requesting', async () => {
    const conn = new RefreshFakeConnection();
    conn.status = 'closed';
    const store = makeStore(conn);
    store.getState().connect({ code: 'ABCD', playerId: 'p1', username: 'alice' });

    const p = store.getState().refresh();
    expect(conn.reconnected).toBe(1);
    expect(conn.requested).toBe(0);
    conn.emit({ type: 'state_update', state: minimalState() });
    await p;
  });

  it('resolves via the timeout when no state_update ever arrives', async () => {
    const conn = new RefreshFakeConnection();
    const store = makeStore(conn, 20);
    store.getState().connect({ code: 'ABCD', playerId: 'p1', username: 'alice' });
    await expect(store.getState().refresh()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

`npx vitest run src/state/game.test.ts`
Expected: FAIL — `refreshTimeoutMs` not in `GameStoreDeps` / `refresh` not a function.

- [ ] **Step 3: Implement in `game.ts`**

Add to the interface and deps:

```ts
export interface GameStoreState {
  // ...existing fields...
  /**
   * Force a sync: on an open socket, request fresh state; otherwise reconnect
   * (the DO pushes state on connect). Resolves when the next `state_update`
   * arrives — or after `refreshTimeoutMs` so a spinner can never hang. Never
   * rejects. Resolves immediately when there is no connection (post-exit).
   */
  refresh(): Promise<void>;
}

export interface GameStoreDeps {
  connectionFactory?: ConnectionFactory;
  /** Refresh promise cap (ms). Overridable for tests. Default 5000. */
  refreshTimeoutMs?: number;
}
```

In `createGameStore`, read the dep and add the action:

```ts
const refreshTimeoutMs = deps.refreshTimeoutMs ?? 5000;
```

```ts
refresh() {
  const conn = connection;
  if (!conn) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = conn.onMessage((message) => {
      if (message.type === 'state_update') finish();
    });
    function finish(): void {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      resolve();
    }
    timer = setTimeout(finish, refreshTimeoutMs);
    if (conn.getStatus() === 'open') conn.requestState();
    else conn.reconnect();
  });
},
```

(The one-shot `onMessage` subscription rides the same dispatch path the reducer uses, so "resolved" and "state applied" can't disagree.)

- [ ] **Step 4: Run to verify pass**

`npx vitest run src/state/game.test.ts` — expected: all pass. Then the full unit suite: `npx vitest run` and `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
npm run lint
git add apps/mobile/src/state/game.ts apps/mobile/src/state/game.test.ts
git commit -m "feat(mobile): gameStore.refresh() resolves on the actual state_update (5s cap)"
```

---

### Task 6: Refresh UI — RefreshControl + web button on lobby/game, with e2e

**Files:**
- Create: `apps/mobile/src/ui/useRefresh.ts`, `apps/mobile/src/ui/RefreshButton.tsx`, `apps/mobile/e2e/refresh.spec.ts`
- Modify: `apps/mobile/app/lobby/[code].tsx`, `apps/mobile/app/game/[code].tsx`

- [ ] **Step 1: Write the failing e2e**

```ts
// apps/mobile/e2e/refresh.spec.ts
import { test, expect } from '@playwright/test';
import { registerAndLand, startTwoPlayerGame, uniqueUser, vis } from './helpers';

/**
 * Pull-to-refresh, web half: RefreshControl is a no-op on react-native-web, so
 * web gets a visible refresh button wired to the same store refresh(). The
 * button label returning from "Refreshing…" to "↻ Refresh" is the honest-spinner
 * contract: it flips back only after a state_update round-trip (or the 5s cap).
 */
test('lobby refresh button round-trips and the lobby stays rendered', async ({ page }) => {
  await registerAndLand(page, uniqueUser('refresh'));
  await vis(page.getByTestId('create-lobby')).click();
  await page.waitForURL(/\/lobby\/[A-Z0-9]+/);
  await expect(vis(page.getByText(/1 player in lobby/i))).toBeVisible();

  await vis(page.getByTestId('refresh')).click();
  await expect(vis(page.getByTestId('refresh'))).toHaveText('↻ Refresh');
  await expect(vis(page.getByText(/1 player in lobby/i))).toBeVisible();
});

test('game refresh button round-trips with the hand intact', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  try {
    await startTwoPlayerGame(host, guest);
    await vis(host.getByTestId('refresh')).click();
    await expect(vis(host.getByTestId('refresh'))).toHaveText('↻ Refresh');
    await expect(vis(host.getByTestId('hand-card'))).toHaveCount(3);
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
```

- [ ] **Step 2: Run to verify failure**

From `apps/mobile`: `npx playwright test e2e/refresh.spec.ts --project=chromium`
Expected: FAIL — no element with testID `refresh`.

- [ ] **Step 3: Create the hook and button**

```ts
// apps/mobile/src/ui/useRefresh.ts
/**
 * Spinner state around gameStore.refresh() shared by the native
 * RefreshControl and the web RefreshButton. refresh() never rejects, but
 * `finally` keeps the spinner honest even if that ever changes.
 */
import { useCallback, useState } from 'react';
import { gameStore } from '../state/game';

export function useRefresh(): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void gameStore
      .getState()
      .refresh()
      .finally(() => setRefreshing(false));
  }, []);
  return { refreshing, onRefresh };
}
```

```tsx
// apps/mobile/src/ui/RefreshButton.tsx
/**
 * Web-only manual refresh affordance: RefreshControl (the native pull
 * gesture) is a no-op on react-native-web, so the PWA gets a button wired to
 * the same refresh. Native renders nothing — the gesture owns it there.
 */
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../lib/theme';

export function RefreshButton({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
}) {
  if (Platform.OS !== 'web') return null;
  return (
    <Pressable
      testID="refresh"
      onPress={onRefresh}
      disabled={refreshing}
      hitSlop={8}
      style={styles.btn}
    >
      <Text style={styles.text}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { alignSelf: 'flex-end' },
  text: { color: colors.muted, fontSize: 13, fontWeight: '600' },
});
```

- [ ] **Step 4: Wire the lobby screen**

In `apps/mobile/app/lobby/[code].tsx`:

```tsx
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRefresh } from '../../src/ui/useRefresh';
import { RefreshButton } from '../../src/ui/RefreshButton';
// inside the component:
const { refreshing, onRefresh } = useRefresh();
```

Below the connection-status `<Text>` add:

```tsx
<RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
```

And on the FlatList:

```tsx
<FlatList
  refreshControl={
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />
  }
  // ...existing props unchanged
/>
```

- [ ] **Step 5: Wire the game screen**

In `apps/mobile/app/game/[code].tsx`, same imports/hook; on the ScrollView:

```tsx
<ScrollView
  contentContainerStyle={styles.scroll}
  refreshControl={
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />
  }
>
  <RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
  <Text style={styles.section}>Opponents</Text>
  {/* ...rest unchanged */}
```

- [ ] **Step 6: Run the e2e to verify pass**

`npx playwright test e2e/refresh.spec.ts` — expected: 4 passed (2 tests × 2 engines).

- [ ] **Step 7: Full gates**

From `apps/mobile`: `npm run typecheck && npx vitest run && npm run test:e2e`
Expected: all green (e2e now 18: 14 prior + 4 new).

- [ ] **Step 8: Commit**

```bash
npm run lint
git add apps/mobile/src/ui/useRefresh.ts apps/mobile/src/ui/RefreshButton.tsx apps/mobile/app apps/mobile/e2e/refresh.spec.ts
git commit -m "feat(mobile): pull-to-refresh on lobby/game (native gesture + web button)"
```

---

### Task 7: Version footer on login/home

**Files:**
- Create: `apps/mobile/src/ui/VersionFooter.tsx`, `apps/mobile/e2e/version.spec.ts`
- Modify: `apps/mobile/app/login.tsx`, `apps/mobile/app/index.tsx`

- [ ] **Step 1: Write the failing e2e**

```ts
// apps/mobile/e2e/version.spec.ts
import { test, expect } from '@playwright/test';
import { registerAndLand, uniqueUser, vis } from './helpers';
import { version } from '../../../package.json';

/**
 * The footer must show the ROOT package.json version — the value release.yml
 * gates and tags on — on the login screen and both Home states.
 */
test('login and home show the release version', async ({ page }) => {
  await page.goto('/login');
  await expect(vis(page.getByTestId('app-version'))).toHaveText(`v${version}`);

  await registerAndLand(page, uniqueUser('ver'));
  await expect(vis(page.getByTestId('app-version'))).toHaveText(`v${version}`);
});
```

- [ ] **Step 2: Run to verify failure**

`npx playwright test e2e/version.spec.ts --project=chromium`
Expected: FAIL — no element with testID `app-version`.

- [ ] **Step 3: Create the component**

```tsx
// apps/mobile/src/ui/VersionFooter.tsx
/**
 * The running release version, from the ROOT package.json — the single value
 * release.yml gates and tags on. Metro inlines the JSON at build time on
 * every platform (dev, APK, PWA export), so no CI wiring is needed. Shown
 * only on login and Home by design.
 */
import { StyleSheet, Text } from 'react-native';
import { colors } from '../lib/theme';
import { version } from '../../../../package.json';

export function VersionFooter() {
  return (
    <Text testID="app-version" style={styles.version}>
      v{version}
    </Text>
  );
}

const styles = StyleSheet.create({
  version: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 8,
    opacity: 0.7,
  },
});
```

- [ ] **Step 4: Render it on login and both Home states**

`login.tsx` — as the last child inside `<Screen>` (after the closing `</MotiView>`):

```tsx
  </MotiView>
  <VersionFooter />
</Screen>
```

`index.tsx` — same position in **both** returns (the unauthenticated early return and the main authenticated return):

```tsx
  {/* unauthenticated branch */}
  <Pressable testID="signin-cta" ...>...</Pressable>
  <VersionFooter />
</Screen>
```

```tsx
  </MotiView>
  <VersionFooter />
</Screen>
```

(By Task 7 the signin-cta is a `<Button>` from Task 2 — position is what matters: last child of `<Screen>`.)

- [ ] **Step 5: Run to verify pass**

`npx playwright test e2e/version.spec.ts` — expected: 2 passed. If the web bundle fails to resolve `../../../../package.json`, Metro's monorepo watchFolders isn't covering the root — fix by adding a `metro.config.js` with the workspace root in `watchFolders` (Expo SDK 54 normally auto-detects npm workspaces, so this is a fallback, not the expectation).

- [ ] **Step 6: Full gates**

`npm run typecheck && npx vitest run && npm run test:e2e` — all green (e2e now 20).

- [ ] **Step 7: Commit**

```bash
npm run lint
git add apps/mobile/src/ui/VersionFooter.tsx apps/mobile/app/login.tsx apps/mobile/app/index.tsx apps/mobile/e2e/version.spec.ts
git commit -m "feat(mobile): version footer on login/home from the root package.json"
```

---

### Task 8: Final validation

- [ ] **Step 1: Everything, once**

From the repo root:

```bash
npm test          # all workspaces
npm run lint
```

From `apps/mobile`:

```bash
npm run typecheck
npm run test:e2e  # 20 expected
```

- [ ] **Step 2: Owner device check (not automatable here)**

On the next Expo Go / dev-build session on the Android phone: pull down on the lobby and on the game screen — the spinner must appear and settle, content clear of the header. This is the only platform where the native gesture actually renders.

- [ ] **Step 3: Update memory/PR notes**

PR description should note: two dedupe refactors + e2e helper (behavior-preserving, e2e-guarded), then the two features per the spec. Android gesture validated on device by owner (or listed as the one pending check).
