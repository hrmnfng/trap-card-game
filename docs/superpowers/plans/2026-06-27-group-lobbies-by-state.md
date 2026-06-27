# Group "Your lobbies" by State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Home screen, group the "Your lobbies" list into **Active** (waiting/prep/in-progress) and **Completed** (concluded) sections, with completed **hidden by default** behind a persisted "Show completed (N)" toggle (#3 from the post-merge backlog).

**Architecture:** Pure client-side. No server/contract change — `LobbyHistoryItem.status` already distinguishes the states. A pure partition helper is unit-tested; the Home screen renders a `SectionList`; the toggle preference persists via the existing `KVStorage` (`getStorage()`).

**Tech Stack:** TypeScript, Expo / React Native, Vitest, Playwright.

**Decisions (locked with the user):** two sections (Active + Completed); completed hidden by default with a persisted toggle; within each section preserve the server's returned order (already recency-ordered).

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `apps/mobile/src/lib/lobbies.ts` | create | `groupLobbiesByState(items)` → `{ active, completed }` (pure) |
| `apps/mobile/src/lib/lobbies.test.ts` | create | Unit-test the partition (statuses, order, empties) |
| `apps/mobile/app/index.tsx` | modify | Render Active/Completed `SectionList`; persisted show-completed toggle |

---

## Task 1: Pure grouping helper

**Files:**
- Create: `apps/mobile/src/lib/lobbies.ts`
- Create: `apps/mobile/src/lib/lobbies.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { groupLobbiesByState } from './lobbies';
import type { LobbyHistoryItem } from '@trap/shared';

const item = (code: string, status: LobbyHistoryItem['status']): LobbyHistoryItem => ({
  id: `id-${code}`,
  code,
  status,
  ownerId: 'u1',
  ownerUsername: 'alice',
  createdAt: '2026-06-27T00:00:00.000Z',
  joinedAt: '2026-06-27T00:00:00.000Z',
  playerCount: 2,
});

describe('groupLobbiesByState', () => {
  it('puts waiting/prep/in-progress under active and concluded under completed', () => {
    const { active, completed } = groupLobbiesByState([
      item('AAAA', 'waiting'),
      item('BBBB', 'concluded'),
      item('CCCC', 'in-progress'),
      item('DDDD', 'prep'),
      item('EEEE', 'concluded'),
    ]);
    expect(active.map((l) => l.code)).toEqual(['AAAA', 'CCCC', 'DDDD']);
    expect(completed.map((l) => l.code)).toEqual(['BBBB', 'EEEE']);
  });

  it('returns empty groups for an empty list', () => {
    expect(groupLobbiesByState([])).toEqual({ active: [], completed: [] });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace=@trap/mobile`
Expected: FAIL — module `./lobbies` not found.

- [ ] **Step 3: Implement the helper**

Create `apps/mobile/src/lib/lobbies.ts`:

```ts
import type { LobbyHistoryItem } from '@trap/shared';

export interface GroupedLobbies {
  active: LobbyHistoryItem[];
  completed: LobbyHistoryItem[];
}

/**
 * Partition lobby-history items into Active (still joinable: waiting/prep/
 * in-progress) and Completed (concluded). Input order is preserved within each
 * group, so the server's recency ordering carries through.
 */
export function groupLobbiesByState(items: LobbyHistoryItem[]): GroupedLobbies {
  const active: LobbyHistoryItem[] = [];
  const completed: LobbyHistoryItem[] = [];
  for (const lobby of items) {
    if (lobby.status === 'concluded') completed.push(lobby);
    else active.push(lobby);
  }
  return { active, completed };
}
```

- [ ] **Step 4: Run to verify pass + lint + commit**

Run: `npm run test --workspace=@trap/mobile && npm run typecheck --workspace=@trap/mobile && npm run lint:js`
Expected: PASS.

```bash
git add apps/mobile/src/lib/lobbies.ts apps/mobile/src/lib/lobbies.test.ts
git commit -m "feat(mobile): groupLobbiesByState helper"
```

---

## Task 2: Home screen — sectioned list + persisted toggle

**Files:**
- Modify: `apps/mobile/app/index.tsx`

> UI task: gate is typecheck + lint + the existing web e2e staying green (create/join still read Home) + a manual check. Add a focused e2e assertion that the Active section shows a created lobby.

- [ ] **Step 1: Imports + persisted toggle state**

In `apps/mobile/app/index.tsx`: add `SectionList` to the `react-native` import; add `import { groupLobbiesByState } from '../src/lib/lobbies';` and `import { getStorage } from '../src/lib/storage';`.

Add the preference key (module scope, near `MIN_PLAYERS`-style consts or top of component file):

```ts
const SHOW_COMPLETED_KEY = 'pref_show_completed';
```

Inside the component, add state + load/persist:

```tsx
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    let active = true;
    void getStorage()
      .getItem(SHOW_COMPLETED_KEY)
      .then((v) => {
        if (active) setShowCompleted(v === '1');
      });
    return () => {
      active = false;
    };
  }, []);

  const toggleCompleted = () => {
    setShowCompleted((prev) => {
      const next = !prev;
      void getStorage().setItem(SHOW_COMPLETED_KEY, next ? '1' : '0');
      return next;
    });
  };
```

- [ ] **Step 2: Build the sections and replace the FlatList with a SectionList**

Compute groups (after `history` is available) and the sections:

```tsx
  const { active: activeLobbies, completed: completedLobbies } = groupLobbiesByState(history);
  const sections = [
    ...(activeLobbies.length ? [{ key: 'active', title: 'Active', data: activeLobbies }] : []),
    ...(completedLobbies.length
      ? [{ key: 'completed', title: 'Completed', data: showCompleted ? completedLobbies : [] }]
      : []),
  ];
```

Replace the existing `loadingHistory ? ... : history.length === 0 ? ... : <FlatList ... />` block with:

```tsx
        {loadingHistory ? (
          <ActivityIndicator color={colors.muted} />
        ) : history.length === 0 ? (
          <Text style={styles.subtle}>No lobbies yet — create or join one below.</Text>
        ) : (
          <SectionList
            style={styles.list}
            sections={sections}
            keyExtractor={(item) => item.code}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) =>
              section.key === 'completed' ? (
                <Pressable
                  testID="toggle-completed"
                  style={styles.sectionHeaderRow}
                  onPress={toggleCompleted}
                >
                  <Text style={styles.sectionHeader}>Completed</Text>
                  <Text style={styles.sectionToggle}>
                    {showCompleted ? 'Hide' : `Show (${completedLobbies.length})`}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.sectionHeader}>{section.title}</Text>
              )
            }
            renderItem={({ item }) => (
              <Pressable
                style={styles.lobbyRow}
                onPress={() => openLobby(item)}
                disabled={item.status === 'concluded'}
              >
                <Text style={styles.lobbyCode}>{item.code}</Text>
                <Text style={styles.lobbyMeta}>
                  {item.status} · {item.playerCount} player
                  {item.playerCount === 1 ? '' : 's'}
                  {item.ownerUsername ? ` · host ${item.ownerUsername}` : ''}
                </Text>
              </Pressable>
            )}
          />
        )}
```

- [ ] **Step 3: Add the section styles**

In the `StyleSheet.create({...})` add:

```tsx
  sectionHeader: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 10,
    marginBottom: 4,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  sectionToggle: { color: colors.primary, fontSize: 13, fontWeight: '600' },
```

- [ ] **Step 4: Typecheck + tests + lint**

Run: `npm run typecheck --workspace=@trap/mobile && npm run test --workspace=@trap/mobile && npm run lint:js`
Expected: PASS.

- [ ] **Step 5: Web e2e — Active section shows a created lobby**

In `apps/mobile/e2e/multiplayer.spec.ts`, the existing flows already exercise Home after create/join. Add a light assertion in a small new test (or extend an existing one) that a freshly created lobby appears under the "Active" header. Minimal new test:

```ts
test('a created lobby appears under the Active section on Home', async ({ page }) => {
  const user = uniqueUser('grp');
  await registerAndLand(page, user);
  await vis(page.getByTestId('create-lobby')).click();
  await page.waitForURL(/\/lobby\/[A-Z0-9]+/);
  const code = new URL(page.url()).pathname.split('/lobby/')[1]!;
  // Return Home and confirm the lobby is listed under Active.
  await page.goBack();
  await expect(vis(page.getByText('Active'))).toBeVisible();
  await expect(vis(page.getByText(code))).toBeVisible();
});
```

(If `goBack()` is unreliable on the web build, navigate Home via `page.goto('/')` after re-auth, or assert from the host context already on Home in the multiplayer flow. Adjust per `e2e/README.md`.)

Run (from `apps/mobile`): `npm run test:e2e`
Expected: PASS.

- [ ] **Step 6: Manual check + commit**

Manual (device/web): completed lobbies are hidden by default; "Show (N)" reveals them; the choice survives an app restart.

```bash
git add apps/mobile/app/index.tsx apps/mobile/e2e/multiplayer.spec.ts
git commit -m "feat(mobile): group Your lobbies into Active/Completed with a persisted toggle"
```

---

## Self-Review

- **Coverage:** grouping (Task 1, unit-tested), sectioned UI + hidden-by-default persisted toggle (Task 2). Decisions (2 sections; completed hidden by default; persisted; preserve order) all implemented.
- **No server change:** uses existing `LobbyHistoryItem.status` and `getStorage()`.
- **Concluded rows stay non-tappable** (existing `disabled={item.status === 'concluded'}` preserved).
