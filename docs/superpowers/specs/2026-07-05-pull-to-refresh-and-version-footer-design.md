# Pull-to-refresh + version footer — design

Two small client features, decided 2026-07-05.

## Feature 1: pull-to-refresh (lobby + game screens)

**Purpose.** A reassurance gesture: nothing is provably broken, the user just
wants a familiar way to force a sync and know the screen shows current state.
So the spinner must be honest — it ends when fresh state has actually arrived,
not on a timer.

**Scope.** Lobby and game screens only (not prep). Android gets the native
pull gesture; web/PWA gets a visible refresh button (React Native's
`RefreshControl` is a no-op on react-native-web, and a custom web pull gesture
was rejected per the libraries-over-custom preference).

### Core plumbing (Expo-free, unit-testable)

- **`LobbyConnection.reconnect()`** (new, `src/lib/realtime.ts`): `close()`
  then `connect()` — the class already stores its `LobbyConnectionOptions`, so
  it can reopen a genuinely fresh socket itself. The narrow `RealtimeSocket`
  interface is unchanged; existing test fakes keep working.
- **`gameStore.refresh(): Promise<void>`** (new action, `src/state/game.ts`):
  - no connection (post-`exit`) → resolve immediately;
  - `connectionStatus === 'open'` → send the existing `get_state` message;
  - any other status → `connection.reconnect()` (the DO pushes a
    `state_update` on connect, so fresh state arrives without a request).
  - Resolution: a one-shot `onMessage` subscription resolves the promise on
    the next `state_update`; a 5-second timeout resolves it regardless so the
    spinner can never hang. The subscription is removed on either path.

### UI

- **`useRefresh()`** (small shared hook): wraps `gameStore.refresh()` in local
  `{ refreshing, onRefresh }` state for both consumers.
- **Game screen**: `refreshControl={<RefreshControl refreshing onRefresh />}`
  on the existing ScrollView.
- **Lobby screen**: the same prop on the existing FlatList.
- **Web only** (`Platform.OS === 'web'`): a small muted "↻ Refresh" pressable
  calling the same `onRefresh` — lobby: beside the connection-status line;
  game: right-aligned above "Opponents". Native builds never render it.
- Spinner tint uses the existing theme colors.

## Feature 2: version footer (login + home screens)

**Purpose.** Now that releases are tagged, surface which version a device is
running. All platforms (Android APK, iPhone PWA, web).

- **Source of truth:** the **root** `package.json` version (what release.yml
  gates and tags on). App code imports it directly — from
  `src/ui/VersionFooter.tsx` that is
  `import { version } from '../../../../package.json'` (four levels up to the
  monorepo root). Metro inlines JSON at build time on every platform, dev and
  release alike, and `resolveJsonModule` is already enabled. No CI changes.
- **`src/ui/VersionFooter.tsx`**: one muted, centered `v{version}` text line.
- Rendered at the bottom of **login** and **home** only. Not on lobby, prep,
  or game.
- Explicitly out of scope (decided): syncing `expo.version` in `app.json`, so
  the Android OS-settings version may not match the footer. Cosmetic only;
  revisit if it ever bothers anyone.

## Error handling

- `refresh()` never rejects — on timeout or missing connection it resolves so
  the UI can't get stuck; existing connection-status UI (lobby status line)
  keeps reporting unreachable/connecting states.
- Reconnect during refresh reuses all existing connection behavior
  (partysocket retry, `unreachable` timeout in `LobbyConnection`).

## Testing

- **Unit (vitest, existing fake-connection factory pattern):**
  - open socket: `refresh()` sends `get_state`, resolves when a
    `state_update` is dispatched;
  - closed socket: `refresh()` triggers `reconnect()` (fake factory observes a
    second socket);
  - timeout: no `state_update` → resolves after the timeout;
  - no connection: resolves immediately.
- **e2e (Playwright, web):** refresh button visible in the lobby; clicking it
  keeps the player list rendered (wiring guard). Version footer on login +
  home shows `v` + the root `package.json` version.
- **Android gesture:** manual — one pull on the next dev session or preview
  build (the device gate is smoke-only by policy).

## Implementation order

One feature at a time, per the per-issue TDD convention: pull-to-refresh
(plumbing → UI → tests green) first, then the version footer.
