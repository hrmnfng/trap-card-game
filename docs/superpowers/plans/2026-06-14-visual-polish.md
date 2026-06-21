# Animated 2D Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightweight, cross-platform animated-2D polish (animated gradient background, card deal/flip, play feedback, win/lose celebration) to the four Expo screens without touching the server, stores, or game rules.

**Architecture:** A new presentational layer in `apps/mobile/src/ui/` (small, single-purpose components) driven entirely by existing store state. The Expo-free, unit-tested core (`src/lib`, `src/state`) is untouched. The gradient is mounted once in the root layout so all screens share it.

**Tech Stack:** `moti` + `react-native-reanimated` (declarative animation), `expo-linear-gradient` (gradient), `react-native-confetti-cannon` (celebration, native-only).

**Verification model (read first):** `src/ui` is presentational RN/Moti code and is intentionally **out of the vitest scope** (per the spec). So per-task verification is: `npm run typecheck --workspace=@trap/mobile` clean + `npm run test:e2e` (Playwright) green + a manual visual check. There are no new unit tests; the existing **30 unit tests** and the **Playwright suite** are the regression gate. New animation behaviour is verified visually. This is a deliberate, spec-approved deviation from unit-TDD.

**Reference:** spec at `docs/superpowers/specs/2026-06-14-visual-polish-design.md`.

**Global rule for every task:** animate **only `opacity`/`transform`** (never `display`/`visibility`); preserve every existing `testID`. This keeps the Playwright suite green.

---

### Task 1: Install dependencies + Babel plugin (bundle smoke — de-risks reanimated-on-web)

**Files:**
- Modify: `apps/mobile/package.json` (via installers)
- Modify: `apps/mobile/babel.config.js`

- [ ] **Step 1: Install the libraries** (from `apps/mobile`)

```bash
npx expo install moti react-native-reanimated expo-linear-gradient
npm install react-native-confetti-cannon
```
Expected: deps added; `expo install` picks SDK-compatible versions of reanimated/expo-linear-gradient.

- [ ] **Step 2: Add the reanimated Babel plugin (MUST be last)**

Replace `apps/mobile/babel.config.js` with:
```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-reanimated/plugin must be listed LAST.
    plugins: ['react-native-reanimated/plugin'],
  };
};
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace=@trap/mobile`
Expected: clean (no UI changes yet).

- [ ] **Step 4: Bundle smoke — confirm the web build still bundles and e2e is green**

Run (from `apps/mobile`): `npm run test:e2e`
Expected: **2 passed** (same as before). This proves reanimated's Babel transform + Metro web bundle work end-to-end before we build any effects. If the web bundle fails here, stop and resolve (clear Metro cache: `npx expo start -c`) before continuing.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/package.json apps/mobile/package-lock.json apps/mobile/babel.config.js
git commit -m "build(mobile): add moti/reanimated/linear-gradient/confetti deps + reanimated babel plugin"
```

---

### Task 2: Motion tokens + reduce-motion gate

**Files:**
- Create: `apps/mobile/src/ui/motion.ts`
- Modify: `apps/mobile/src/lib/theme.ts`

- [ ] **Step 1: Add gradient palette to the theme**

Append to `apps/mobile/src/lib/theme.ts` (after the `colors` object):
```ts
/** Gradient stops for the shared animated background (dark slate → indigo). */
export const gradient = {
  colors: ['#171e2e', '#1f2940', '#241f43', '#1a2030'] as const,
};
```

- [ ] **Step 2: Create the motion tokens + reduce-motion hook**

Create `apps/mobile/src/ui/motion.ts`:
```ts
/**
 * Shared animation tokens and the reduce-motion gate for the src/ui layer.
 * One source of truth so screens animate consistently. Presentational only.
 */
import { useReducedMotion } from 'react-native-reanimated';

export const DURATION = {
  fast: 180,
  base: 260,
  slow: 9000, // gradient drift loop
} as const;

/** Per-card deal stagger (ms). */
export const DEAL_STAGGER = 70;

/** True when the OS "reduce motion" setting is on — callers fall back to static. */
export { useReducedMotion };
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace=@trap/mobile`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/ui/motion.ts apps/mobile/src/lib/theme.ts
git commit -m "feat(mobile): add motion tokens + gradient palette"
```

---

### Task 3: Animated gradient background (shared by all screens)

**Files:**
- Create: `apps/mobile/src/ui/GradientBackground.tsx`
- Modify: `apps/mobile/app/_layout.tsx`

- [ ] **Step 1: Create the GradientBackground component**

Create `apps/mobile/src/ui/GradientBackground.tsx`:
```tsx
/**
 * Full-screen slow-drifting gradient. Mounted once behind the navigator so every
 * screen shares it. Respects reduce-motion (renders a static gradient then).
 * Animates transform only — safe for the web e2e.
 */
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { gradient } from '../lib/theme';
import { DURATION, useReducedMotion } from './motion';

export function GradientBackground() {
  const reduce = useReducedMotion();

  const Gradient = (
    <LinearGradient
      colors={[...gradient.colors]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.fill}
    />
  );

  if (reduce) {
    return <MotiView pointerEvents="none" style={styles.layer}>{Gradient}</MotiView>;
  }

  return (
    <MotiView
      pointerEvents="none"
      style={styles.layer}
      from={{ translateX: -24, translateY: -16 }}
      animate={{ translateX: 24, translateY: 16 }}
      transition={{ type: 'timing', duration: DURATION.slow, loop: true, repeatReverse: true }}
    >
      {Gradient}
    </MotiView>
  );
}

const styles = StyleSheet.create({
  // Oversized so the drift never reveals an edge.
  layer: { position: 'absolute', top: -60, left: -60, right: -60, bottom: -60 },
  fill: { flex: 1 },
});
```

- [ ] **Step 2: Mount it behind the navigator + make screens transparent**

In `apps/mobile/app/_layout.tsx`: add the import and wrap the returned tree. Change the import block to include:
```tsx
import { View } from 'react-native';
import { GradientBackground } from '../src/ui/GradientBackground';
```
Replace the returned `<>...</>` fragment with:
```tsx
return (
  <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <GradientBackground />
    <StatusBar style="light" />
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: 'transparent' },
        headerTransparent: true,
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: 'transparent' },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Trap Card Game' }} />
      <Stack.Screen name="login" options={{ title: 'Sign in' }} />
      <Stack.Screen name="lobby/[code]" options={{ title: 'Lobby' }} />
      <Stack.Screen name="game/[code]" options={{ title: 'Game' }} />
    </Stack>
  </View>
);
```
(The loading `ActivityIndicator` branch is unchanged.)

- [ ] **Step 3: Typecheck + e2e + visual**

Run: `npm run typecheck --workspace=@trap/mobile` → clean.
Run (from `apps/mobile`): `npm run test:e2e` → **2 passed** (gradient is `pointerEvents:none`, no testID impact).
Visual: `npx expo start` → press `w`; confirm a slow-drifting gradient behind all screens.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/ui/GradientBackground.tsx apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): shared animated gradient background"
```

---

### Task 4: Button press-scale + content fade-in (login / home / lobby)

**Files:**
- Create: `apps/mobile/src/ui/PressableScale.tsx`
- Modify: `apps/mobile/app/login.tsx`, `apps/mobile/app/index.tsx`, `apps/mobile/app/lobby/[code].tsx`

- [ ] **Step 1: Create PressableScale**

Create `apps/mobile/src/ui/PressableScale.tsx`:
```tsx
/**
 * A Pressable that scales down slightly while pressed. Forwards testID/onPress/
 * disabled so it is a drop-in for the existing primary buttons (keeps e2e selectors).
 */
import { useState, type ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { MotiView } from 'moti';
import { DURATION } from './motion';

export function PressableScale({
  children,
  onPress,
  disabled,
  style,
  testID,
}: {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
    >
      <MotiView
        animate={{ scale: pressed && !disabled ? 0.96 : 1 }}
        transition={{ type: 'timing', duration: DURATION.fast }}
        style={style}
      >
        {children}
      </MotiView>
    </Pressable>
  );
}
```

- [ ] **Step 2: Use it for primary buttons + add a content fade-in**

In each of `app/login.tsx`, `app/index.tsx`, `app/lobby/[code].tsx`:
1. Add imports:
```tsx
import { MotiView } from 'moti';
import { PressableScale } from '../src/ui/PressableScale';
// lobby/[code].tsx uses: '../../src/ui/PressableScale'
```
2. Replace the primary action `Pressable` (the one with `styles.button`) with `PressableScale`, moving its `style`, `onPress`, `disabled`, and `testID` props across. Example (login submit):
```tsx
<PressableScale
  testID="auth-submit"
  style={[styles.button, loading && styles.buttonDisabled]}
  onPress={submit}
  disabled={loading}
>
  {loading ? (
    <ActivityIndicator color={colors.primaryText} />
  ) : (
    <Text style={styles.buttonText}>{mode === 'login' ? 'Sign in' : 'Register'}</Text>
  )}
</PressableScale>
```
3. Wrap each screen's outermost content `View` children in a fade-in by replacing the top-level `<View style={styles.container}>` with:
```tsx
<MotiView
  style={styles.container}
  from={{ opacity: 0, translateY: 8 }}
  animate={{ opacity: 1, translateY: 0 }}
  transition={{ type: 'timing', duration: 260 }}
>
  {/* existing children unchanged */}
</MotiView>
```
(Keep all existing `testID`s and text exactly.)

- [ ] **Step 3: Typecheck + e2e + visual**

Run: `npm run typecheck --workspace=@trap/mobile` → clean.
Run (from `apps/mobile`): `npm run test:e2e` → **2 passed** (auth flow uses `auth-submit`/`logout`/`join-lobby`/`create-lobby` — all preserved).
Visual: buttons dip when pressed; screens fade in.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/ui/PressableScale.tsx apps/mobile/app/login.tsx apps/mobile/app/index.tsx "apps/mobile/app/lobby/[code].tsx"
git commit -m "feat(mobile): button press-scale + screen fade-in on auth/home/lobby"
```

---

### Task 5: Animated playing card — deal stagger + select lift

**Files:**
- Create: `apps/mobile/src/ui/PlayingCard.tsx`
- Modify: `apps/mobile/app/game/[code].tsx`

- [ ] **Step 1: Create PlayingCard**

Create `apps/mobile/src/ui/PlayingCard.tsx`:
```tsx
/**
 * A single hand card. Deals in with a staggered fade/slide, lifts when selected,
 * and flips/flies out when played (exit, via AnimatePresence in the parent).
 * Keeps testID="hand-card" so the e2e count assertion still works.
 */
import { Pressable, StyleSheet, Text } from 'react-native';
import { MotiView } from 'moti';
import { colors } from '../lib/theme';
import { DEAL_STAGGER, DURATION } from './motion';

export function PlayingCard({
  value,
  selected,
  index,
  onPress,
}: {
  value: number | null;
  selected: boolean;
  index: number;
  onPress: () => void;
}) {
  return (
    <MotiView
      from={{ opacity: 0, translateY: 16, scale: 0.96 }}
      animate={{ opacity: 1, translateY: selected ? -10 : 0, scale: selected ? 1.06 : 1 }}
      exit={{ opacity: 0, translateY: -40, scale: 0.8, rotateY: '90deg' }}
      transition={{ type: 'timing', duration: DURATION.base, delay: index * DEAL_STAGGER }}
    >
      <Pressable
        testID="hand-card"
        onPress={onPress}
        style={[styles.card, selected && styles.cardSelected]}
      >
        <Text style={styles.cardValue}>{value ?? '?'}</Text>
      </Pressable>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 56,
    height: 80,
    borderRadius: 8,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
  },
  cardSelected: { borderColor: colors.accent, backgroundColor: '#22543d' },
  cardValue: { color: colors.text, fontSize: 24, fontWeight: '700' },
});
```

- [ ] **Step 2: Use it in the game hand with AnimatePresence**

In `apps/mobile/app/game/[code].tsx`:
1. Add imports:
```tsx
import { AnimatePresence } from 'moti';
import { PlayingCard } from '../../src/ui/PlayingCard';
```
2. Replace the hand `myCards.map(...)` block (the inline card `Pressable`s) with:
```tsx
<AnimatePresence>
  {myCards.map((card: Card, i: number) => (
    <PlayingCard
      key={card.id}
      value={card.value}
      index={i}
      selected={card.id === selectedCardId}
      onPress={() => setSelectedCardId(card.id === selectedCardId ? null : card.id)}
    />
  ))}
</AnimatePresence>
```
(Leave the `myCards.length === 0` "No cards left." branch and the `styles.hand` wrapper as-is.)

- [ ] **Step 3: Typecheck + e2e + visual**

Run: `npm run typecheck --workspace=@trap/mobile` → clean.
Run (from `apps/mobile`): `npm run test:e2e` → **2 passed**. (Cards mount immediately so `getByTestId('hand-card')` still resolves to 3, then 2 after a play; selection + play still work.)
Visual: cards deal in staggered; tapping one lifts it.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/ui/PlayingCard.tsx "apps/mobile/app/game/[code].tsx"
git commit -m "feat(mobile): animated hand cards (deal stagger + select lift)"
```

---

### Task 6: Play feedback — opponent pulse on a new play

**Files:**
- Modify: `apps/mobile/app/game/[code].tsx`

- [ ] **Step 1: Pulse the opponent row when it becomes the latest target**

In `apps/mobile/app/game/[code].tsx`:
1. Ensure `MotiView` is imported (add if not present from Task 5):
```tsx
import { MotiView } from 'moti';
```
2. Derive the latest play just after `const myCards = gameState.myCards;`:
```tsx
const lastPlay = gameState.gameHistory[gameState.gameHistory.length - 1];
```
3. Wrap each opponent `Pressable` in a keyed `MotiView` that replays a scale bump when that opponent is the most recent target. Replace the `opponents.map((p) => ( ... ))` body's `Pressable` with:
```tsx
<MotiView
  key={`${p.id}-${lastPlay?.targetId === p.id ? lastPlay.id : 'idle'}`}
  from={{ scale: lastPlay?.targetId === p.id ? 1.08 : 1 }}
  animate={{ scale: 1 }}
  transition={{ type: 'timing', duration: 260 }}
>
  <Pressable
    testID="opponent"
    style={[styles.opponent, !selectedCardId && styles.opponentIdle]}
    onPress={() => playOn(p.id)}
    disabled={!selectedCardId}
  >
    <Text style={styles.opponentName}>{p.username}</Text>
    <Text style={styles.subtle}>{p.cardsRemaining} cards</Text>
  </Pressable>
</MotiView>
```
(The `key` changes when a new play targets this opponent, remounting the `MotiView` so the `from`→`animate` bump replays. `testID="opponent"` preserved.)

- [ ] **Step 2: Typecheck + e2e + visual**

Run: `npm run typecheck --workspace=@trap/mobile` → clean.
Run (from `apps/mobile`): `npm run test:e2e` → **2 passed** (the multiplayer test plays a card on the opponent — `getByTestId('opponent')` still resolves, history asserts unchanged).
Visual: with two clients, the targeted opponent row gives a quick pulse on a play.

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/app/game/[code].tsx"
git commit -m "feat(mobile): pulse the opponent row on a card play"
```

---

### Task 7: Win/lose celebration + end-banner animation

**Files:**
- Create: `apps/mobile/src/ui/Celebration.tsx`
- Modify: `apps/mobile/app/game/[code].tsx`

- [ ] **Step 1: Create the Celebration component (native-only confetti)**

Create `apps/mobile/src/ui/Celebration.tsx`:
```tsx
/**
 * One-shot confetti burst for game end. Native only (web is test-only) and
 * pointerEvents:none so it never blocks the "Game over" controls in the e2e.
 */
import { Platform, StyleSheet, View } from 'react-native';
import ConfettiCannon from 'react-native-confetti-cannon';

export function Celebration() {
  if (Platform.OS === 'web') return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <ConfettiCannon
        count={120}
        origin={{ x: -10, y: 0 }}
        fadeOut
        autoStart
        explosionSpeed={350}
        fallSpeed={2600}
      />
    </View>
  );
}
```

- [ ] **Step 2: Render it + animate the end banner on game end**

In `apps/mobile/app/game/[code].tsx`:
1. Add import:
```tsx
import { Celebration } from '../../src/ui/Celebration';
```
2. Replace the `gameEnded ? ( <View style={styles.endedBanner}> ... </View> )` block with an animated banner plus the celebration:
```tsx
{gameEnded ? (
  <>
    <Celebration />
    <MotiView
      style={styles.endedBanner}
      from={{ opacity: 0, translateY: 24 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 320 }}
    >
      <Text style={styles.endedText}>Game over</Text>
      <Pressable style={styles.button} onPress={leave}>
        <Text style={styles.buttonText}>Back to home</Text>
      </Pressable>
    </MotiView>
  </>
) : (
  <Pressable style={styles.linkButton} onPress={leave}>
    <Text style={styles.linkText}>Leave game</Text>
  </Pressable>
)}
```
(Keep the `leave` handler and styles; `MotiView` already imported in Task 5/6.)

- [ ] **Step 3: Typecheck + e2e + visual**

Run: `npm run typecheck --workspace=@trap/mobile` → clean.
Run (from `apps/mobile`): `npm run test:e2e` → **2 passed** (confetti is `null` on web; the end banner text/buttons are unchanged and reachable).
Visual: on a device, finishing a game shows confetti + the banner sliding up.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/ui/Celebration.tsx "apps/mobile/app/game/[code].tsx"
git commit -m "feat(mobile): win/lose celebration + animated end banner"
```

---

### Task 8: Full verification + reduce-motion pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run (repo root): `npm test`
Expected: shared + mobile green (mobile **30** unit tests pass; the `apps/party` Windows test-pool EBUSY/WS skips are pre-existing — see `AGENTS.md`).

- [ ] **Step 2: e2e**

Run (from `apps/mobile`): `npm run test:e2e`
Expected: **2 passed**.

- [ ] **Step 3: Typecheck all**

Run: `npm run typecheck --workspace=@trap/mobile` (and `--workspace=@trap/party`, `npm run typecheck`)
Expected: clean.

- [ ] **Step 4: Manual reduce-motion check**

Enable OS "Reduce Motion" (simulator: Settings → Accessibility) and launch `npx expo start`.
Expected: gradient renders static (no drift); cards appear without the deal animation; no crashes.

- [ ] **Step 5: Manual visual pass**

`npx expo start`, walk all four screens (web + a device/simulator): gradient everywhere, button press-scale, card deal/lift, opponent pulse + play, end celebration.

- [ ] **Step 6: Commit any fixes** (only if Steps 1–5 surfaced issues)

```bash
git add -A
git commit -m "fix(mobile): visual-polish verification fixes"
```

---

## Self-Review Notes

- **Spec coverage:** animated gradient (Task 3), card deal+flip (Task 5 deal/lift + exit flip), play feedback (Task 5 lift + Task 6 pulse), win/lose celebration (Task 7), button/transition polish (Task 4), reduce-motion (Tasks 2/3/8), e2e-safety (global rule + per-task e2e runs), bundle-smoke-first (Task 1). All spec sections map to a task.
- **Libraries match the spec/non-goals:** moti + reanimated + expo-linear-gradient + react-native-confetti-cannon only; no skia/r3f/three/expo-gl.
- **Type/name consistency:** `GradientBackground`, `PressableScale`, `PlayingCard`, `Celebration`, `motion.ts` exports (`DURATION`, `DEAL_STAGGER`, `useReducedMotion`), and `gradient` (theme) are used consistently across tasks.
- **No server/store/rule changes:** all effects read existing `gameState`/`gameEnded`; the opponent pulse + reveal derive from `gameState.gameHistory`.
