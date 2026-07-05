# Game-Feel Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved game-feel spec — actor travel animation,
incoming-hit reveal (single + coalesced), Home wordmark, "T!" app icon,
compact-timeline history, and lobby sort — on `feat/game-feel-enhancements`.

**Architecture:** All animation is moti/reanimated transform+opacity (the
`GradientBackground` precedent; no GL, no new native deps). Pending-hit state
derives from the event-sourced `gameState.gameHistory` with a per-lobby seen
count persisted via the existing `KVStorage`. Pure logic (sort comparators,
time-ago, hit selectors) lives in plain modules with Node unit tests.

**Tech Stack:** Expo SDK 54, moti, react-native-reanimated, Zustand vanilla
stores, Vitest, Playwright (chromium + webkit), sharp (icon generation).

**Spec:** `docs/superpowers/specs/2026-07-04-game-feel-enhancements-design.md`

**Approved deviation (flag to owner at handoff):** the spec's "recency =
last-activity from the API" is implemented as **`joinedAt`** — `lobby_history`
has no last-activity column (`apps/party/src/history.ts` orders by
`joined_at DESC` already), and adding one means a production D1 migration.
"Recent" therefore means "most recently joined", which matches today's server
order. Revisit only if it feels wrong in use.

**GitNexus note:** changes are new UI components, pure helpers, docs, and an
icon script — plus additive edits to `app/game/[code].tsx`, `app/index.tsx`,
and `src/state/game.ts` exports. No existing exported function's signature or
behavior changes; if the index reports stale at the end, run `npx gitnexus analyze`.

---

## File structure

| File | Task | Responsibility |
|------|------|----------------|
| (git only) | 1 | Preflight: bring in the PR #18 header-padding fix |
| `apps/mobile/src/lib/lobbies.ts` | 2 | Add `LobbySortMode`, labels/cycle, `sortLobbies` |
| `apps/mobile/src/lib/lobbies.test.ts` | 2 | Extend: comparator tests |
| `apps/mobile/app/index.tsx` | 2, 4 | Sort toggle + persisted preference; wordmark on signed-out hero |
| `apps/mobile/src/lib/format.ts` (+`.test.ts`) | 3 | Create: `timeAgo` |
| `apps/mobile/src/ui/HistoryTimeline.tsx` | 3 | Create: compact timeline rows |
| `apps/mobile/app/game/[code].tsx` | 3, 6, 7 | Swap history rendering; mount `IncomingReveal`; travel proxy |
| `apps/mobile/e2e/multiplayer.spec.ts` | 3, 6 | Update history assertions; reveal/dismiss/coalesce choreography |
| `apps/mobile/src/ui/Wordmark.tsx` | 4 | Create: glyph + stacked type |
| `apps/mobile/scripts/generate-icons.mjs` | 5 | New "T!" `masterSvg`; regenerate PNGs |
| `apps/mobile/public/icons/*.png` | 5 | Regenerated committed icons |
| `apps/mobile/src/state/game.ts` (+`game.test.ts`) | 6 | Add pure `hitsOnMe` + `seenHitsKey` exports |
| `apps/mobile/src/ui/IncomingReveal.tsx` | 6 | Create: single + coalesced overlay |
| `docs/superpowers/plans/2026-06-21-remaining-work.md` | 8 | Phase D status refresh |

---

### Task 1: Preflight — bring in the PR #18 header-padding fix

This branch (`feat/game-feel-enhancements`) was cut from `main` before
PR #18 (`fix/header-padding`) merged. Tasks 3/6/7 edit the same
`app/game/[code].tsx` region PR #18 touches (`paddingTop: 44` → `20`), and
`src/ui/Screen.tsx` gained `useHeaderHeight`.

**Files:** none — git only.

- [ ] **Step 1: Check whether the fix is already present**

```bash
git fetch origin
git merge-base --is-ancestor origin/fix/header-padding HEAD && echo present || echo missing
```

If `present`, skip to Task 2.

- [ ] **Step 2: Merge it in**

If PR #18 has merged to main: `git merge origin/main`.
Otherwise: `git merge origin/fix/header-padding`.
Expected: clean merge (this branch only adds the spec doc so far).

- [ ] **Step 3: Verify**

```bash
grep -n "useHeaderHeight" apps/mobile/src/ui/Screen.tsx   # hit expected
npm run test --workspace=@trap/mobile                      # 51 passing
```

---

### Task 2: Lobby sort — comparators (TDD) + Home toggle

**Files:**
- Modify: `apps/mobile/src/lib/lobbies.ts`
- Modify: `apps/mobile/src/lib/lobbies.test.ts`
- Modify: `apps/mobile/app/index.tsx`

- [ ] **Step 1: Write the failing comparator tests**

Append to `apps/mobile/src/lib/lobbies.test.ts`:

```ts
import { sortLobbies, LOBBY_SORT_CYCLE, type LobbySortMode } from './lobbies';

function item(code: string, joinedAt: string): LobbyHistoryItem {
  return {
    id: `id-${code}`,
    code,
    status: 'waiting',
    ownerId: null,
    ownerUsername: null,
    createdAt: joinedAt,
    joinedAt,
    playerCount: 1,
  };
}

describe('sortLobbies', () => {
  const items = [
    item('BBBB', '2026-07-02T10:00:00Z'),
    item('AAAA', '2026-07-04T10:00:00Z'),
    item('CCCC', '2026-07-03T10:00:00Z'),
  ];

  it('recent puts the newest joinedAt first', () => {
    expect(sortLobbies(items, 'recent').map((i) => i.code)).toEqual([
      'AAAA',
      'CCCC',
      'BBBB',
    ]);
  });

  it('oldest puts the earliest joinedAt first', () => {
    expect(sortLobbies(items, 'oldest').map((i) => i.code)).toEqual([
      'BBBB',
      'CCCC',
      'AAAA',
    ]);
  });

  it('code sorts alphabetically', () => {
    expect(sortLobbies(items, 'code').map((i) => i.code)).toEqual([
      'AAAA',
      'BBBB',
      'CCCC',
    ]);
  });

  it('does not mutate the input', () => {
    const copy = [...items];
    sortLobbies(items, 'recent');
    expect(items).toEqual(copy);
  });

  it('sorts a missing joinedAt as oldest', () => {
    const withMissing = [...items, { ...item('DDDD', ''), joinedAt: '' }];
    expect(sortLobbies(withMissing, 'recent').at(-1)!.code).toBe('DDDD');
  });

  it('cycle covers every mode exactly once', () => {
    expect([...LOBBY_SORT_CYCLE].sort()).toEqual(
      (['code', 'oldest', 'recent'] as LobbySortMode[]).sort()
    );
  });
});
```

(The file already imports `LobbyHistoryItem` and `describe/it/expect` — reuse
its existing imports; only add what's missing.)

- [ ] **Step 2: Run to verify failure**

Run from `apps/mobile`: `npx vitest run src/lib/lobbies.test.ts`
Expected: FAIL — `sortLobbies` is not exported.

- [ ] **Step 3: Implement**

Append to `apps/mobile/src/lib/lobbies.ts`:

```ts
export type LobbySortMode = 'recent' | 'oldest' | 'code';

export const LOBBY_SORT_LABELS: Record<LobbySortMode, string> = {
  recent: 'Recent',
  oldest: 'Oldest',
  code: 'A–Z',
};

/** Order the sort toggle cycles through. */
export const LOBBY_SORT_CYCLE: readonly LobbySortMode[] = ['recent', 'oldest', 'code'];

/**
 * Sort lobby-history items for display. `recent`/`oldest` order by `joinedAt`
 * (the server's own recency column — `lobby_history` has no last-activity
 * column, so "recent" means "most recently joined"); `code` is alphabetical.
 * Returns a new array; missing timestamps sort as oldest.
 */
export function sortLobbies(
  items: LobbyHistoryItem[],
  mode: LobbySortMode
): LobbyHistoryItem[] {
  const copy = [...items];
  switch (mode) {
    case 'recent':
      return copy.sort((a, b) => (b.joinedAt ?? '').localeCompare(a.joinedAt ?? ''));
    case 'oldest':
      return copy.sort((a, b) => (a.joinedAt ?? '').localeCompare(b.joinedAt ?? ''));
    case 'code':
      return copy.sort((a, b) => a.code.localeCompare(b.code));
  }
}
```

- [ ] **Step 4: Run to verify pass**

`npx vitest run src/lib/lobbies.test.ts` → PASS (existing + 6 new tests).

- [ ] **Step 5: Wire the toggle into Home**

In `apps/mobile/app/index.tsx`:

a. Extend the lobbies import (line ~22):

```ts
import {
  groupLobbiesByState,
  sortLobbies,
  LOBBY_SORT_CYCLE,
  LOBBY_SORT_LABELS,
  type LobbySortMode,
} from '../src/lib/lobbies';
```

b. Next to `SHOW_COMPLETED_KEY` (line ~27) add:

```ts
/** Persisted preference key for the lobby-list sort mode. */
const LOBBY_SORT_KEY = 'pref_lobby_sort';
```

c. Alongside the `showCompleted` state add:

```ts
const [sortMode, setSortMode] = useState<LobbySortMode>('recent');
```

d. In the existing preference-loading `useEffect` (the one reading
`SHOW_COMPLETED_KEY`), also load the sort preference (same best-effort
posture):

```ts
void getStorage()
  .getItem(LOBBY_SORT_KEY)
  .then((v) => {
    if (active && (LOBBY_SORT_CYCLE as readonly string[]).includes(v ?? '')) {
      setSortMode(v as LobbySortMode);
    }
  })
  .catch(() => {
    /* keep default */
  });
```

e. Add the cycle handler next to `toggleCompleted`:

```ts
const cycleSort = () => {
  setSortMode((prev) => {
    const next =
      LOBBY_SORT_CYCLE[(LOBBY_SORT_CYCLE.indexOf(prev) + 1) % LOBBY_SORT_CYCLE.length]!;
    void getStorage()
      .setItem(LOBBY_SORT_KEY, next)
      .catch(() => {
        /* best-effort persistence */
      });
    return next;
  });
};
```

f. Sort before grouping (grouping preserves order, so one sort covers both
sections). Replace:

```ts
const { active: activeLobbies, completed: completedLobbies } = groupLobbiesByState(history);
```

with:

```ts
const { active: activeLobbies, completed: completedLobbies } = groupLobbiesByState(
  sortLobbies(history, sortMode)
);
```

g. Replace the plain "Your lobbies" label with a row that carries the toggle.
Find `<Text style={styles.sectionLabel}>Your lobbies</Text>` and replace with:

```tsx
<View style={styles.sectionHeaderRow}>
  <Text style={styles.sectionLabel}>Your lobbies</Text>
  <Pressable testID="lobby-sort" onPress={cycleSort} hitSlop={8}>
    <Text style={styles.sortLabel}>{LOBBY_SORT_LABELS[sortMode]} ⇅</Text>
  </Pressable>
</View>
```

h. Add to the StyleSheet (match the file's existing style keys — `sectionLabel`
already exists):

```ts
sectionHeaderRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'baseline',
},
sortLabel: { color: colors.primary, fontSize: 13, fontWeight: '600' },
```

(If `colors.primary` doesn't exist in `src/lib/theme.ts`, use the accent/link
color the file already uses for `linkText`-style elements — check the theme
file and match.)

- [ ] **Step 6: Verify + commit**

```bash
npm run typecheck --workspace=@trap/mobile
npm run test --workspace=@trap/mobile
npm run lint
git add apps/mobile/src/lib/lobbies.ts apps/mobile/src/lib/lobbies.test.ts apps/mobile/app/index.tsx
git commit -m "feat(mobile): sortable Home lobby list (Recent/Oldest/A-Z, persisted)"
```

---

### Task 3: History timeline — `timeAgo` (TDD) + `HistoryTimeline` + e2e selector update

**Files:**
- Create: `apps/mobile/src/lib/format.ts`, `apps/mobile/src/lib/format.test.ts`
- Create: `apps/mobile/src/ui/HistoryTimeline.tsx`
- Modify: `apps/mobile/app/game/[code].tsx` (history block, lines ~133–146)
- Modify: `apps/mobile/e2e/multiplayer.spec.ts:84-85`

- [ ] **Step 1: Failing `timeAgo` tests**

Create `apps/mobile/src/lib/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { timeAgo } from './format';

describe('timeAgo', () => {
  const now = new Date('2026-07-05T12:00:00Z');

  it('renders sub-minute as "now"', () => {
    expect(timeAgo('2026-07-05T11:59:30Z', now)).toBe('now');
  });

  it('renders minutes', () => {
    expect(timeAgo('2026-07-05T11:53:00Z', now)).toBe('7m');
  });

  it('renders hours', () => {
    expect(timeAgo('2026-07-05T09:00:00Z', now)).toBe('3h');
  });

  it('renders days', () => {
    expect(timeAgo('2026-07-02T12:00:00Z', now)).toBe('3d');
  });

  it('clamps future timestamps to "now"', () => {
    expect(timeAgo('2026-07-05T12:05:00Z', now)).toBe('now');
  });

  it('returns empty string for a malformed timestamp', () => {
    expect(timeAgo('not-a-date', now)).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify failure**

`npx vitest run src/lib/format.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `timeAgo`**

Create `apps/mobile/src/lib/format.ts`:

```ts
/**
 * Presentation formatting helpers. Pure and Expo-free so they unit-test under
 * Node (same posture as the rest of src/lib).
 */

/** Compact relative time for timeline rows: now · 7m · 3h · 3d. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
```

- [ ] **Step 4: Run to verify pass**

`npx vitest run src/lib/format.test.ts` → PASS (6 tests).

- [ ] **Step 5: Create the timeline component**

Create `apps/mobile/src/ui/HistoryTimeline.tsx`:

```tsx
/**
 * Compact in-game history timeline (spec decision 6): dense one-liners —
 * `attacker ▸ target — "truncated sentence"` with a time-ago column — that
 * expand on tap to show the full sentence. Plays targeting the viewer are
 * tinted. Newest first. Pure presentation: no store access, no Expo imports.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GameHistoryItem } from '@trap/shared';
import { colors } from '../lib/theme';
import { timeAgo } from '../lib/format';

export function HistoryTimeline({
  items,
  myPlayerId,
}: {
  items: GameHistoryItem[];
  myPlayerId: string | null;
}) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());

  if (items.length === 0) {
    return <Text style={styles.empty}>No plays yet.</Text>;
  }

  const toggle = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <View>
      {items
        .slice()
        .reverse()
        .map((h) => {
          const onMe = h.targetId != null && h.targetId === myPlayerId;
          const expanded = expandedIds.has(h.id);
          return (
            <Pressable
              key={h.id}
              testID="history-item"
              onPress={() => toggle(h.id)}
              style={[styles.row, onMe && styles.rowOnMe]}
            >
              <Text style={styles.time}>{timeAgo(h.timestamp)}</Text>
              <Text
                style={[styles.line, onMe && styles.lineOnMe]}
                numberOfLines={expanded ? undefined : 1}
              >
                <Text style={styles.who}>{h.playerUsername}</Text>
                {' ▸ '}
                <Text style={[styles.who, onMe && styles.whoOnMe]}>
                  {onMe ? 'you' : h.targetUsername ?? 'unknown'}
                </Text>
                {' — '}
                {`"${h.statement ?? '?'}"`}
              </Text>
            </Pressable>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.muted, fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  rowOnMe: { borderBottomColor: '#742a2a' },
  time: { color: colors.muted, fontSize: 11, width: 32 },
  line: { color: colors.text, fontSize: 13, flex: 1 },
  lineOnMe: { color: '#feb2b2' },
  who: { fontWeight: '700' },
  whoOnMe: { color: '#fc8181' },
});
```

(Check `src/lib/theme.ts` for the exact exported color names — `colors.text`,
`colors.muted`, `colors.surface` are used across `app/*`; match whatever the
theme actually exports. The red literals follow the existing pattern of
inline hex accents, e.g. PlayingCard's `#22543d`.)

- [ ] **Step 6: Swap the game screen's history block**

In `apps/mobile/app/game/[code].tsx`, replace the block after
`<Text style={styles.section}>History</Text>` (the `gameState.gameHistory.length === 0`
ternary through the `.map((h) => ...)` — lines ~134–146) with:

```tsx
<HistoryTimeline items={gameState.gameHistory} myPlayerId={playerId} />
```

Add the import: `import { HistoryTimeline } from '../../src/ui/HistoryTimeline';`
`playerId` must be the viewer's player id — the screen already derives it
(it computes `myCards`/`iWon`; find the existing variable, likely from
`useGame((s) => s.playerId)` or the auth user id used to split opponents, and
pass that same value). The `styles.historyItem` style becomes unused — delete it.

- [ ] **Step 7: Update the e2e history assertions**

`apps/mobile/e2e/multiplayer.spec.ts:84-85` currently asserts the old text
format:

```ts
await expect(vis(host.getByText(new RegExp(`${hostUser} played`)))).toBeVisible();
await expect(vis(guest.getByText(new RegExp(`${hostUser} played`)))).toBeVisible();
```

Replace with testID-based assertions on the new markup:

```ts
await expect(vis(host.getByTestId('history-item')).first()).toContainText(hostUser);
await expect(vis(guest.getByTestId('history-item')).first()).toContainText(hostUser);
```

(Task 6 adds reveal choreography around this same spot; if executing tasks in
order this is a temporary state — the suite must still pass here because the
reveal component doesn't exist yet.)

- [ ] **Step 8: Verify + commit**

```bash
npm run typecheck --workspace=@trap/mobile
npm run test --workspace=@trap/mobile
cd apps/mobile && npm run test:e2e && cd ../..
npm run lint
git add apps/mobile/src/lib/format.ts apps/mobile/src/lib/format.test.ts apps/mobile/src/ui/HistoryTimeline.tsx "apps/mobile/app/game/[code].tsx" apps/mobile/e2e/multiplayer.spec.ts
git commit -m "feat(mobile): compact timeline for in-game history (time-ago, expand, on-you tint)"
```

Expected e2e: 16 passed (8 tests × 2 engines — the suite gained layout.spec
in PR #18).

---

### Task 4: Wordmark

**Files:**
- Create: `apps/mobile/src/ui/Wordmark.tsx`
- Modify: `apps/mobile/app/index.tsx` (signed-out hero, line ~126)

- [ ] **Step 1: Create the component**

Create `apps/mobile/src/ui/Wordmark.tsx`:

```tsx
/**
 * Home wordmark (spec decision 4): the tilted exclamation-card glyph floating
 * gently above stacked "TRAP / card game" type. The glyph is drawn with Views
 * (no image asset) so it always matches the theme. Float is transform-only and
 * disabled under reduce-motion. Deliberately NOT the launcher icon's "T!"
 * lettermark — owner kept the card glyph on Home.
 */
import { StyleSheet, Text, View } from 'react-native';
import { MotiView } from 'moti';
import { colors } from '../lib/theme';
import { useReducedMotion } from './motion';

export function Wordmark() {
  const reduce = useReducedMotion();

  const glyph = (
    <View style={styles.glyph}>
      <View style={styles.exBar} />
      <View style={styles.exDot} />
    </View>
  );

  return (
    <View style={styles.wrap} testID="wordmark">
      {reduce ? (
        glyph
      ) : (
        <MotiView
          from={{ translateY: 0, rotate: '-8deg' }}
          animate={{ translateY: -6, rotate: '-4deg' }}
          transition={{ type: 'timing', duration: 2600, loop: true, repeatReverse: true }}
        >
          {glyph}
        </MotiView>
      )}
      <Text style={styles.title}>TRAP</Text>
      <Text style={styles.subtitle}>CARD GAME</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 4, marginBottom: 8 },
  glyph: {
    width: 44,
    height: 62,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
    marginBottom: 6,
  },
  exBar: {
    width: 8,
    height: 24,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginBottom: 5,
  },
  exDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  title: { color: colors.text, fontSize: 34, fontWeight: '800', letterSpacing: 2 },
  subtitle: { color: colors.primary, fontSize: 13, fontWeight: '600', letterSpacing: 6 },
});
```

(Again: verify `colors.primary` etc. against `src/lib/theme.ts` and match its
real export names. Note the static glyph carries its own `rotate` transform;
the Moti wrapper animates rotate when motion is allowed — don't double-rotate:
when wrapped, the inner `styles.glyph` transform is overridden by Moti's
`rotate`, which is fine because both start at -8deg.)

- [ ] **Step 2: Use it on the signed-out Home hero**

In `apps/mobile/app/index.tsx`, in the `!isAuthenticated` branch, replace
`<Text style={styles.heading}>Trap Card Game</Text>` with `<Wordmark />` and
add the import `import { Wordmark } from '../src/ui/Wordmark';`.

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck --workspace=@trap/mobile
cd apps/mobile && npx playwright test e2e/auth.spec.ts --project=chromium && cd ../..
npm run lint
git add apps/mobile/src/ui/Wordmark.tsx apps/mobile/app/index.tsx
git commit -m "feat(mobile): animated wordmark on the signed-out Home hero"
```

(The auth spec's `registerAndLand` starts from `/login` and the signed-out
Home CTA — it exercises the changed branch. If a test asserted the literal
"Trap Card Game" heading text, update it to `getByTestId('wordmark')`.)

---

### Task 5: "T!" app icon

**Files:**
- Modify: `apps/mobile/scripts/generate-icons.mjs` (the `masterSvg` function + doc comment)
- Regenerate: `apps/mobile/public/icons/*.png` (6 files)

- [ ] **Step 1: Replace `masterSvg`**

In `apps/mobile/scripts/generate-icons.mjs`, replace the `masterSvg` function
(keep BG/SURFACE/PRIMARY constants; SURFACE becomes unused — remove it) and
update the header comment's first line to say "T! lettermark" instead of
"tilted card + exclamation glyph":

```js
// Type color for the "T" (theme text color, kept literal like the others).
const TYPE = '#e2e8f0';

/**
 * 1024x1024 master: bold "T!" lettermark (spec decision 5) — the T in the
 * theme text color, the exclamation in primary blue, drawn with rects/circles
 * (never <text>) so output does not depend on installed fonts. `scale`
 * shrinks the mark toward the center: 1 for regular icons, 0.72 for the
 * maskable variant's ~80% circular safe zone.
 */
function masterSvg(scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" fill="${BG}"/>
  <g transform="translate(512 512) scale(${scale}) translate(-512 -512)">
    <rect x="200" y="290" width="380" height="100" rx="24" fill="${TYPE}"/>
    <rect x="340" y="290" width="100" height="444" rx="24" fill="${TYPE}"/>
    <rect x="640" y="290" width="104" height="330" rx="52" fill="${PRIMARY}"/>
    <circle cx="692" cy="686" r="62" fill="${PRIMARY}"/>
  </g>
</svg>`;
}
```

- [ ] **Step 2: Regenerate**

From `apps/mobile`: `node scripts/generate-icons.mjs`
Expected: six `wrote public/icons/... (NxN)` lines.

- [ ] **Step 3: Eyeball the output**

View `apps/mobile/public/icons/icon-1024.png` with the Read tool: a bold
light "T" and blue "!" centered on the dark background, visually balanced
(the T's stem under the bar's center-left; the "!" clearly separated). View
`icon-maskable-512.png`: same mark with extra dark margin. If the mark looks
off-center or cramped, nudge the rect x/y values (keep the shapes-only rule)
and regenerate — this is a judgment step, take it.

Then verify dimensions:

```bash
node -e "const sharp=require('sharp');const files=['icon-1024.png','icon-512.png','icon-192.png','icon-maskable-512.png','apple-touch-icon.png','favicon.png'];(async()=>{for(const f of files){const m=await sharp('public/icons/'+f).metadata();console.log(f,m.width,m.height,m.format)}})()"
```

Expected sizes: 1024/512/192/512/180/48, all `png`.

- [ ] **Step 4: Confirm the manifest guard still passes**

From `apps/mobile`: `npx vitest run src/lib/pwa.test.ts` → PASS (it checks
manifest-referenced icons exist; filenames/sizes are unchanged).

- [ ] **Step 5: Commit**

```bash
npm run lint
git add apps/mobile/scripts/generate-icons.mjs apps/mobile/public/icons
git commit -m "feat(mobile): T! lettermark app icon (regenerated icon set)"
```

**Propagation note for the final report:** launcher icon lands with the next
APK build; PWA icons with the next export+deploy; iPhone home-screen icon
requires remove + re-add of the PWA (spec §icon pipeline).

---

### Task 6: Incoming reveal — pure helpers (TDD) + overlay + e2e choreography

**Files:**
- Modify: `apps/mobile/src/state/game.ts` (add pure exports)
- Modify: `apps/mobile/src/state/game.test.ts` (helper tests)
- Create: `apps/mobile/src/ui/IncomingReveal.tsx`
- Modify: `apps/mobile/app/game/[code].tsx` (mount)
- Modify: `apps/mobile/e2e/multiplayer.spec.ts` (reveal choreography)

- [ ] **Step 1: Failing helper tests**

Append to `apps/mobile/src/state/game.test.ts` (reuse its existing imports;
add `hitsOnMe, seenHitsKey` to the `./game` import and `GameState`,
`GameHistoryItem` types from `@trap/shared` if not present):

```ts
function historyItem(
  id: string,
  targetId: string | null,
  actionType: GameHistoryItem['actionType'] = 'play_card'
): GameHistoryItem {
  return {
    id,
    actionType,
    playerId: 'attacker',
    playerUsername: 'attacker',
    targetId,
    targetUsername: targetId,
    statement: `trap ${id}`,
    timestamp: '2026-07-05T00:00:00Z',
  };
}

function stateWithHistory(gameHistory: GameHistoryItem[]): GameState {
  return {
    lobbyId: 'l1',
    lobbyCode: 'CODE',
    status: 'in-progress',
    ownerId: null,
    cardsPerPlayer: 3,
    players: [],
    myCards: [],
    gameHistory,
    winnerId: null,
    winnerUsername: null,
  };
}

describe('hitsOnMe', () => {
  it('returns only play_card items targeting the player, in order', () => {
    const state = stateWithHistory([
      historyItem('1', 'me'),
      historyItem('2', 'other'),
      historyItem('3', 'me'),
      historyItem('4', 'me', 'join'),
    ]);
    expect(hitsOnMe(state, 'me').map((h) => h.id)).toEqual(['1', '3']);
  });

  it('is empty for null state or player', () => {
    expect(hitsOnMe(null, 'me')).toEqual([]);
    expect(hitsOnMe(stateWithHistory([historyItem('1', 'me')]), null)).toEqual([]);
  });
});

describe('seenHitsKey', () => {
  it('is namespaced per lobby', () => {
    expect(seenHitsKey('ABCD')).toBe('seen_hits_ABCD');
    expect(seenHitsKey('WXYZ')).not.toBe(seenHitsKey('ABCD'));
  });
});
```

- [ ] **Step 2: Run to verify failure**

`npx vitest run src/state/game.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement the helpers**

Append to `apps/mobile/src/state/game.ts` (import `GameHistoryItem` from
`@trap/shared` alongside the existing type imports):

```ts
/**
 * Plays from the (event-sourced, append-only) game history that target
 * `playerId`, chronological. The IncomingReveal overlay derives "unseen hits"
 * as `hitsOnMe(...).slice(seenCount)` — append-only means a persisted count
 * is a stable cursor.
 */
export function hitsOnMe(
  state: GameState | null,
  playerId: string | null
): GameHistoryItem[] {
  if (!state || !playerId) return [];
  return state.gameHistory.filter(
    (h) => h.actionType === 'play_card' && h.targetId === playerId
  );
}

/** Storage key for the per-lobby count of acknowledged incoming plays. */
export function seenHitsKey(lobbyCode: string): string {
  return `seen_hits_${lobbyCode}`;
}
```

- [ ] **Step 4: Run to verify pass**

`npx vitest run src/state/game.test.ts` → PASS.

- [ ] **Step 5: Create the overlay component**

Create `apps/mobile/src/ui/IncomingReveal.tsx`:

```tsx
/**
 * Center-stage reveal for cards played on the viewer (spec decisions 2+3).
 * One pending hit: dimmed overlay, the card flips in large with the
 * attacker's name and sentence. Two or more pending (barrage, or reopening
 * after being away): one coalesced overlay with all cards as a staggered
 * cascade and a single "Got it" dismiss. Pending = hitsOnMe(...) minus a
 * per-lobby persisted seen-count (KVStorage), so a reload after dismissing
 * shows nothing. Under reduce-motion the overlay still appears (it is
 * information), without flip/cascade movement.
 */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MotiView } from 'moti';
import type { GameState } from '@trap/shared';
import { colors } from '../lib/theme';
import { getStorage } from '../lib/storage';
import { hitsOnMe, seenHitsKey } from '../state/game';
import { DURATION, useReducedMotion } from './motion';

export function IncomingReveal({
  lobbyCode,
  playerId,
  gameState,
}: {
  lobbyCode: string;
  playerId: string | null;
  gameState: GameState | null;
}) {
  const reduce = useReducedMotion();
  // null = still loading the persisted count; render nothing until known so a
  // reload never flashes already-seen hits.
  const [seen, setSeen] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void getStorage()
      .getItem(seenHitsKey(lobbyCode))
      .then((v) => {
        if (active) setSeen(v ? Number.parseInt(v, 10) || 0 : 0);
      })
      .catch(() => {
        if (active) setSeen(0);
      });
    return () => {
      active = false;
    };
  }, [lobbyCode]);

  const hits = hitsOnMe(gameState, playerId);
  const pending = seen === null ? [] : hits.slice(seen);
  if (pending.length === 0) return null;

  const dismiss = () => {
    setSeen(hits.length);
    void getStorage()
      .setItem(seenHitsKey(lobbyCode), String(hits.length))
      .catch(() => {
        /* best-effort; worst case the reveal re-shows next visit */
      });
  };

  const single = pending.length === 1;

  return (
    <MotiView
      testID="incoming-reveal"
      style={styles.overlay}
      from={{ opacity: reduce ? 1 : 0 }}
      animate={{ opacity: 1 }}
      transition={{ type: 'timing', duration: DURATION.fast }}
    >
      <Text style={styles.title}>
        {single ? 'A card was played on you' : `${pending.length} cards were played on you`}
      </Text>
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        bounces={false}
      >
        {pending.map((h, i) => (
          <MotiView
            key={h.id}
            from={
              reduce
                ? { opacity: 1 }
                : single
                  ? { opacity: 0, rotateY: '90deg', scale: 0.8 }
                  : { opacity: 0, translateY: 16 }
            }
            animate={
              single
                ? { opacity: 1, rotateY: '0deg', scale: 1 }
                : { opacity: 1, translateY: 0 }
            }
            transition={{
              type: 'timing',
              duration: DURATION.base,
              delay: reduce ? 0 : i * 120,
            }}
            style={[styles.card, single && styles.cardSingle]}
          >
            <Text style={styles.attacker}>{h.playerUsername}</Text>
            <Text style={styles.statement}>{h.statement ?? '?'}</Text>
          </MotiView>
        ))}
      </ScrollView>
      <Pressable testID="incoming-dismiss" style={styles.dismiss} onPress={dismiss}>
        <Text style={styles.dismissText}>Got it</Text>
      </Pressable>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 14, 22, 0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 10,
  },
  title: { color: '#90cdf4', fontSize: 16, fontWeight: '700', marginBottom: 14 },
  list: { alignSelf: 'stretch', flexGrow: 0, maxHeight: 360 },
  listContent: { gap: 10, alignItems: 'center' },
  card: {
    alignSelf: 'stretch',
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    padding: 14,
  },
  cardSingle: { alignSelf: 'center', minWidth: 240, maxWidth: 320 },
  attacker: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  statement: { color: colors.text, fontSize: 16, fontWeight: '600' },
  dismiss: {
    marginTop: 16,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 28,
  },
  dismissText: { color: '#1a202c', fontWeight: '800' },
});
```

(Same theme-name caveat as earlier tasks. Design choices baked in: the
overlay renders for a single hit as a flip [rotateY] and for multiples as a
cascade; both paths share the one dismiss handler; it does NOT hide when the
game concludes — the ended banner renders after it in the tree and stays
interactable on top.)

- [ ] **Step 6: Mount it in the game screen**

In `apps/mobile/app/game/[code].tsx`, immediately BEFORE the
`{concluded ? (...) : (...)}` block at the bottom of the `<Screen>` (so the
ended banner stacks above it), add:

```tsx
<IncomingReveal lobbyCode={code} playerId={playerId} gameState={gameState} />
```

with the import `import { IncomingReveal } from '../../src/ui/IncomingReveal';`.
`code`, `playerId`, and `gameState` are the values the screen already has
(the route param and the same store selections used elsewhere in the file).

- [ ] **Step 7: e2e choreography**

In `apps/mobile/e2e/multiplayer.spec.ts`, three insertions in the two-player
test:

a. Right after the Task-3 history assertions (following the host's first
play), the guest now sees the single-card reveal — assert and dismiss it:

```ts
// The guest was hit: the center-stage reveal shows the attacker + sentence.
const guestReveal = vis(guest.getByTestId('incoming-reveal'));
await expect(guestReveal).toBeVisible();
await expect(guestReveal).toContainText(hostUser);
await expect(guestReveal).toContainText(/trap \d/);
await vis(guest.getByTestId('incoming-dismiss')).click();
await expect(guest.getByTestId('incoming-reveal')).toHaveCount(0);
```

b. After the guest re-enters the game (`await expect(vis(guest.getByTestId('hand-card'))).toHaveCount(3);`,
line ~95), assert the dismissal persisted across the exit/re-entry:

```ts
// The dismissed hit stays dismissed across exit + re-entry (persisted seen count).
await expect(guest.getByTestId('incoming-reveal')).toHaveCount(0);
```

c. After the winner loop (host plays their last 2 cards onto the guest) and
BEFORE the winner-banner assertions, the guest has 2 undismissed hits — the
coalesced cascade:

```ts
// Two hits landed without a dismissal in between: one coalesced overlay.
const cascade = vis(guest.getByTestId('incoming-reveal'));
await expect(cascade).toContainText('2 cards were played on you');
await expect(vis(guest.getByTestId('incoming-reveal')).getByText(/trap \d/)).toHaveCount(2);
await vis(guest.getByTestId('incoming-dismiss')).click();
```

- [ ] **Step 8: Verify + commit**

```bash
npm run typecheck --workspace=@trap/mobile
npm run test --workspace=@trap/mobile
cd apps/mobile && npm run test:e2e && cd ../..
npm run lint
git add apps/mobile/src/state/game.ts apps/mobile/src/state/game.test.ts apps/mobile/src/ui/IncomingReveal.tsx "apps/mobile/app/game/[code].tsx" apps/mobile/e2e/multiplayer.spec.ts
git commit -m "feat(mobile): center-stage reveal for incoming plays (single flip + coalesced cascade, persisted seen count)"
```

Expected e2e: 16 passed. If the two-player test flakes on the reveal timing,
the assertion order above is the fix-first suspect: every guest interaction
between a hit and its dismissal must go through the overlay's own controls
(it intercepts taps by design).

---

### Task 7: Actor travel animation

**Files:**
- Modify: `apps/mobile/app/game/[code].tsx`

The proxy flies from where the player tapped their hand card to where they
tapped the opponent — both captured from `Pressable` tap coordinates
(`nativeEvent.pageX/pageY`), which works identically on native and web with
no measurement dance. Coordinates are converted from page space to the
Screen container's space by measuring the overlay once per flight.

- [ ] **Step 1: Implement**

In `apps/mobile/app/game/[code].tsx`:

a. Track the selection tap point and the in-flight proxy (top of the
component, with the other `useState` calls; import `useRef` if absent, and
`View` from react-native if absent):

```tsx
const selectPoint = useRef<{ x: number; y: number } | null>(null);
const overlayRef = useRef<View>(null);
const [flight, setFlight] = useState<{
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
} | null>(null);
const reduce = useReducedMotion();
```

(`useReducedMotion` comes from `../../src/ui/motion` — import if absent.)

b. Capture the selection point: the hand cards' `onPress` currently calls
`setSelectedCardId(...)`. `PlayingCard`'s `onPress` prop has no event today —
change its signature to pass it through. In `src/ui/PlayingCard.tsx`:

```tsx
// prop type:
onPress: (e: GestureResponderEvent) => void;
// (import type { GestureResponderEvent } from 'react-native';)
// Pressable already calls onPress with the event — no other change needed.
```

Then in the game screen's hand-card `onPress`:

```tsx
onPress={(e) => {
  selectPoint.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
  setSelectedCardId(card.id === selectedCardId ? null : card.id);
}}
```

c. Launch the flight in `playOn`. The opponent `Pressable`'s `onPress`
currently calls `playOn(p.id)`; change to `onPress={(e) => playOn(p.id, e)}`
and extend `playOn`:

```tsx
const playOn = (targetId: string, e?: GestureResponderEvent) => {
  if (!selectedCardId || concluded) return;
  const start = selectPoint.current;
  const end = e ? { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY } : null;
  if (start && end && !reduce) {
    // Convert page coords to overlay-local coords, then fly.
    overlayRef.current?.measureInWindow((ox, oy) => {
      setFlight({
        id: `${selectedCardId}-${Date.now()}`,
        from: { x: start.x - ox, y: start.y - oy },
        to: { x: end.x - ox, y: end.y - oy },
      });
    });
  }
  selectPoint.current = null;
  // ...existing playCard dispatch + setSelectedCardId(null) stay as-is.
};
```

(Keep whatever the existing `playOn` body does — this only adds the flight
setup before it.)

d. Render the proxy overlay as the LAST child inside `<Screen ...>` (above
everything, below nothing that needs taps — it's `pointerEvents="none"`):

```tsx
<View
  ref={overlayRef}
  pointerEvents="none"
  style={StyleSheet.absoluteFill}
  collapsable={false}
>
  {flight ? (
    <MotiView
      key={flight.id}
      style={styles.flightCard}
      from={{
        translateX: flight.from.x - 17,
        translateY: flight.from.y - 24,
        scale: 1,
        opacity: 1,
        rotate: '0deg',
      }}
      animate={{
        translateX: flight.to.x - 17,
        translateY: flight.to.y - 24,
        scale: 0.55,
        opacity: 0,
        rotate: '10deg',
      }}
      transition={{ type: 'timing', duration: DURATION.base * 1.5 }}
      onDidAnimate={(key) => {
        if (key === 'opacity') setFlight(null);
      }}
    />
  ) : null}
</View>
```

with the style:

```ts
flightCard: {
  position: 'absolute',
  width: 34,
  height: 48,
  borderRadius: 6,
  backgroundColor: colors.surface,
  borderWidth: 2,
  borderColor: colors.primary,
},
```

(`DURATION` import from `../../src/ui/motion` if absent. The target row's
existing hit-flash — the `MotiView` keyed on `lastPlay` — is unchanged and
provides the "impact" half.)

- [ ] **Step 2: Verify (the suite is the regression net; the animation is visual)**

```bash
npm run typecheck --workspace=@trap/mobile
npm run test --workspace=@trap/mobile
cd apps/mobile && npm run test:e2e && cd ../..
```

Expected: all green — the proxy is `pointerEvents="none"` and must not
disturb any existing assertion. Then eyeball it live: from `apps/mobile`,
`npx expo start --web`, play a two-tab game, confirm the card flies from
hand to opponent (and does nothing under OS reduce-motion).

- [ ] **Step 3: Commit**

```bash
npm run lint
git add "apps/mobile/app/game/[code].tsx" apps/mobile/src/ui/PlayingCard.tsx
git commit -m "feat(mobile): card travel animation from hand to target on play"
```

---

### Task 8: Final sweep + status update + handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-06-21-remaining-work.md` (Phase D section)

- [ ] **Step 1: Full verification**

```bash
npm test
npm run typecheck
npm run typecheck --workspace=@trap/party
npm run typecheck --workspace=@trap/mobile
npm run lint
cd apps/mobile && npm run test:e2e && cd ../..
```

Expected: all pass (party keeps its known Windows `.skip`s); e2e 16 passed.

- [ ] **Step 2: Update the Phase D status**

In `docs/superpowers/plans/2026-06-21-remaining-work.md`, in the
"Phase D — Graphics & Visual Polish" intro, add a dated note: the R3F/expo-gl
outline was superseded by the 2026-07-04 game-feel spec (moti/transform-only,
PWA-first); implemented on `feat/game-feel-enhancements` — travel animation,
incoming reveal, wordmark, T! icon, history timeline, lobby sort; win/lose
web parity remains the one open polish item. Match the file's existing status
style; don't rewrite the D1–D6 bullets.

- [ ] **Step 3: Commit**

```bash
npm run lint
git add docs/superpowers/plans/2026-06-21-remaining-work.md
git commit -m "docs: Phase D superseded by game-feel round (implemented); win/lose web parity remains"
```

- [ ] **Step 4: Hand off**

Use superpowers:finishing-a-development-branch (PR of
`feat/game-feel-enhancements` → `main`). The report to the owner must flag:
(1) the recency=joinedAt deviation (header of this plan); (2) the icon
propagation caveats (new APK build; iPhone re-add for the PWA icon); (3) the
on-device eyeball items (travel feel, wordmark, reveal) on Android + iPhone.
