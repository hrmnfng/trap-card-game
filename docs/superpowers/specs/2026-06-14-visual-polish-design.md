# Visual Polish — Animated 2D (Design Spec)

**Date:** 2026-06-14
**Status:** Approved design (pending spec review)
**Scope:** `apps/mobile` only. No server, store-contract, or game-rule changes.

This is the "optional visual updates" phase (the migration plan's Phase 7 /
remaining-work Phase D), descoped from the original R3F/GLSL vision to a
**lightweight animated-2D** treatment that is cross-platform and keeps the test
suite green.

## Goals

Add tasteful motion/"juice" across all four screens (Login, Home, Lobby, Game),
driven entirely by existing state:

1. **Animated gradient background** — a slow-drifting gradient shared by every screen.
2. **Card deal + flip** — cards animate into the hand on game start; a played card
   flips/flies as it leaves the hand.
3. **Play feedback** — selected-card lift, an opponent-row pulse when a card is played,
   and the hand re-laying-out smoothly.
4. **Win/lose celebration** — a confetti moment + animated end banner on game end.

Plus baseline polish: card faces/backs styling, button press-scale, screen fade-ins.

## Non-goals (YAGNI)

- No 3D, GLSL/shaders, `react-native-skia`, `@react-three/fiber`, `three`, or
  `expo-gl`. (shadergradient / liquid-logo are web-DOM-only and can't run on the
  mobile product; the Skia/R3F routes were considered and declined for weight/risk.)
- No new server messages, store fields, or game-rule changes — all effects derive
  from existing `gameState` (`myCards`, `players`, `gameHistory`) + `gameEnded`.
- No gesture systems, drag-to-play, or sound.

## Library stack

Chosen for popularity + minimal custom code (per user preference), all Expo-compatible:

| Library | Purpose | Notes |
|---------|---------|-------|
| `moti` | Declarative animations (cards, transitions, press, gradient drift) | Wraps reanimated; minimal custom code |
| `react-native-reanimated` | Moti's engine | Needs one Babel plugin line (must be **last** in `babel.config.js`) |
| `expo-linear-gradient` | The gradient layer | Expo-official; renders a CSS gradient on web |
| `react-native-confetti-cannon` | Win celebration | Native only; **no-op on web** via `Platform.OS` guard |

Install via `npx expo install` so versions match the SDK. The only build-config change
is adding `react-native-reanimated/plugin` to `babel.config.js`.

## Architecture — a new presentational layer

All visual code lives in a **new `apps/mobile/src/ui/` folder**, keeping the
Expo-free, unit-tested core (`src/lib`, `src/state`) untouched. Each component is
small and single-purpose:

- **`src/ui/motion.ts`** — shared tokens (durations, easing, gradient palette) and a
  `useReducedMotion()` gate. One source of truth for timing so screens stay consistent.
- **`src/ui/GradientBackground.tsx`** — full-screen `expo-linear-gradient` with a slow
  Moti drift (animate gradient layer position/opacity via transform). Mounted **once**
  in `app/_layout.tsx` behind the `Stack` (`contentStyle: { backgroundColor: 'transparent' }`),
  so all four screens share it with zero per-screen work. Input: none (ambient).
- **`src/ui/PlayingCard.tsx`** — a `MotiView` card face. Props: `value`, `selected`,
  `onPress`, and animation intent (`enter`/`exit`). Encapsulates: staggered **deal-in**,
  **lift** when `selected`, and **flip+fly** on play (exit). Preserves `testID="hand-card"`.
  Replaces the inline card `Pressable` in `app/game/[code].tsx`.
- **`src/ui/PressableScale.tsx`** — thin Moti press-scale wrapper for buttons; forwards
  `testID`, `onPress`, `disabled`. Used for the primary buttons across screens.
- **`src/ui/Celebration.tsx`** — fires `react-native-confetti-cannon` on game end (native
  only); `pointerEvents="none"`; never overlaps the "Game over" controls. No-op on web.

### Data flow (no new contracts)

```
game store (existing)            src/ui (new, presentational)
  gameState.myCards     ───────► PlayingCard (deal / hand re-layout via AnimatePresence)
  selectedCardId (local)───────► PlayingCard.selected (lift)
  gameState.gameHistory ──────► opponent-row pulse (last item) + played-card reveal
  gameEnded + finisher  ──────► Celebration + end-banner animation
  (ambient)             ──────► GradientBackground
```

The played-card reveal / opponent pulse is derived from the **last `gameHistory`
item** (player, target, value) — no store change needed.

## Screen integration

- `app/_layout.tsx` — mount `GradientBackground` behind the `Stack`; make screen
  backgrounds transparent so the gradient shows through everywhere.
- `app/login.tsx`, `app/index.tsx`, `app/lobby/[code].tsx` — swap primary buttons for
  `PressableScale`; add a light fade/slide-in on the main content (Moti `from`/`animate`).
- `app/game/[code].tsx` — replace inline hand cards with `PlayingCard` (deal stagger +
  flip-on-play); wrap the hand in Moti `AnimatePresence` for smooth re-layout; pulse the
  opponent row on a new `gameHistory` entry; render `Celebration` + animate the end banner
  on `gameEnded`.

## e2e + test safety (hard constraints)

The Playwright suite (`apps/mobile/e2e/`) and 30 unit tests must stay green.

- **Animate only `opacity`/`transform`** — never `display`/`visibility`. (Playwright
  treats `opacity:0` as visible; `display:none` would break `.filter({ visible:true })`.)
- **Preserve every `testID`** (`hand-card`, `opponent`, `create-lobby`, `auth-submit`,
  `start-game`, etc.) on the new animated components.
- **Cards mount immediately** (animate from a start state) so `toHaveCount(3)` resolves;
  AnimatePresence keeps them in the DOM during transitions.
- **Confetti is `pointerEvents:none` and native-only**, so it never intercepts taps or
  covers the end-screen controls in the web e2e.
- Animations **settle to a stable end state** (Moti animations finish), which Playwright's
  auto-waiting absorbs.
- Respect OS **reduce-motion** via `useReducedMotion()` (static fallback: gradient shows
  but doesn't drift; cards appear without fly).

## Testing plan

1. **Bundle smoke (first implementation step, de-risks the top risk):** add the deps +
   Babel plugin, mount only `GradientBackground`, and confirm `expo start --web` bundles
   and `npm run test:e2e` stays green **before** building the rest.
2. **Unit:** core (`lib`/`state`) is unchanged → still 30 green. `src/ui` is
   presentational RN/Moti and is out of the vitest scope (no native imports in the tested core).
3. **e2e:** re-run the Playwright suite after each effect; fix any interference
   (e.g. gate confetti to native, ensure cards mount immediately).
4. **Manual:** visual pass on `expo start` (web + a device/simulator) per screen.

## Risks & mitigations

- **reanimated Babel plugin + Metro web bundling for the e2e** *(top risk)* — validated by
  the step-1 bundle smoke before further work; reanimated/Moti both support web.
- **`react-native-confetti-cannon` on web** — gated to native (`Platform.OS !== 'web'`);
  web is test-only so this costs nothing there.
- **Animation timing vs. e2e** — mitigated by opacity/transform-only + immediate mount +
  Playwright auto-wait; reduce-motion provides a fast static path.

## Acceptance

- All four screens show the shared animated gradient; game cards deal/lift/flip; an
  opponent pulse + reveal on play; a celebration on game end.
- `npm test` (30 unit) and `npm run test:e2e` (Playwright) both green.
- No changes to `packages/shared`, `apps/party`, or any store contract.
- Honors reduce-motion.
