# Game-Feel Enhancements Design (card play animations, wordmark, app icon)

**Date:** 2026-07-04
**Status:** Approved (visual-companion brainstorm with owner; selections recorded per section)

## Goal

Make the core play moment *feel* like something on both distribution targets
(Android APK, iOS/web PWA): animate playing a card, animate being hit by one,
give Home a wordmark, replace the app icon, upgrade the in-game history to a
readable timeline, and make the Home lobby list sortable — all with the
existing moti/reanimated stack, no GL, no new native dependencies.

Replaces the stale Phase D outline in `2026-06-21-remaining-work.md` (R3F +
`expo-gl` shaders): with iOS served as a PWA, WebKit-standalone is a
first-class target and expo-gl has no web path. Transform/opacity animation on
the installed stack covers everything below.

## Decisions (owner-selected, browser previews)

1. **Actor view — "travel + hit."** When you play a card, a proxy card
   animates from the tapped hand card to the target opponent's row, which
   flashes/scales on arrival (extends the existing `MotiView` hit-scale).
2. **Target view — "center-stage reveal."** When a card is played on you and
   the game screen is foregrounded: brief dimmed overlay; the card flips large
   in the center showing the attacker's name and the card's **sentence**
   (cards carry authored sentences, not just values); tap to dismiss.
   Backgrounded targets are already covered by push notifications.
3. **Multi-hit — coalesce when >1, "stacked cascade."** One mechanism for
   both live barrages and open-after-away: one pending hit = the single-card
   reveal; two or more = one overlay listing all pending cards (attacker +
   sentence each), staggered entrance, single "Got it" dismiss, scrollable
   beyond ~4 cards.
4. **Home wordmark — "glyph + stacked type."** The tilted exclamation-card
   glyph floating gently (transform-only loop) above stacked "TRAP / card
   game" type. Owner explicitly kept the card glyph on Home even though the
   launcher icon changes to a lettermark (the card still says "card game").
5. **App icon — "T!" lettermark.** Bold monogram, dark bg, blue "!". Replaces
   the tilted-card icon. Drawn with shapes (rects/circles), never `<text>`,
   so the generator stays font-independent.
6. **In-game history — "compact timeline."** Replaces the plain text lines:
   dense one-liners (`attacker ▸ target — "truncated sentence…"`) with a
   time-ago column and tap-to-expand for the full sentence; plays targeting
   you are tinted. Time-ago uses the timestamp already carried by
   `gameHistory` entries (events inject timestamps via `RuleDeps`); if a
   legacy entry lacks one, the row simply omits the time column.
7. **Home lobby sort — control + recency default.** Within the existing
   Active/Completed groups, default order becomes most-recent-activity first,
   with a small sort toggle in the "Your lobbies" header cycling
   Recent · Oldest · A–Z (code). The choice persists per user via the
   existing `KVStorage`. Recency = the lobby's last-activity timestamp from
   the lobby-history API (the implementation plan verifies the exact field;
   if the API exposes none, expose it from `lobby_history`'s existing
   column server-side).
8. **Deferred:** win/lose celebration parity on web (confetti is native-only
   today) — explicitly out of scope this round.

## Components

| Unit | Responsibility |
|------|----------------|
| `src/ui/Wordmark.tsx` (new) | Glyph + stacked type; float loop; static under reduce-motion. Consumed by `app/index.tsx`. |
| `src/ui/IncomingReveal.tsx` (new) | Absolute-fill overlay in the game screen. Renders null with no pending hits; single-flip or stacked-cascade otherwise; dismiss marks seen. |
| `app/game/[code].tsx` (modify) | Actor travel: absolutely-positioned proxy card animated between measured positions (`onLayout`/`measure`) of the tapped hand card and the target row; degrades to the existing hit-flash if measurement is unavailable. Mounts `IncomingReveal`. |
| `src/state/game.ts` (modify) | Pending-hits selector + last-seen event index. |
| `apps/mobile/scripts/generate-icons.mjs` (modify) | New `masterSvg()`: "T!" lettermark (shapes only). Regenerates all six PNGs. |
| `src/ui/HistoryTimeline.tsx` (new) | Compact timeline rows (time-ago, truncation, tap-to-expand, on-you tint). Consumed by `app/game/[code].tsx`, replacing the inline text list. |
| `src/lib/lobbies.ts` (modify) | Pure sort comparators (Recent/Oldest/A–Z) alongside the existing `groupLobbiesByState`; unit-tested under Node. |
| `app/index.tsx` (modify) | Sort toggle in the "Your lobbies" header; persisted preference via `KVStorage`. |

## State: what counts as a pending hit

The game is event-sourced; "cards played on me" is derived from the event
log. The game store gains a **last-seen event index, persisted per lobby**
through the existing `KVStorage` abstraction:

- Pending = events targeting me with index > lastSeen.
- Dismissing the reveal advances lastSeen to the newest revealed event.
- Persisted → reopening after 3 hits shows exactly those 3; a reload after
  dismissing shows nothing.
- New lobby → lastSeen starts at 0, so hits that landed before your first
  visit to the game screen still reveal.

Pure store logic; unit-testable under Node like the rest of `src/state`.

## Motion discipline

- Transform/opacity only (the `GradientBackground` precedent — safe for the
  web e2e); durations from the existing `DURATION` tokens.
- Every animation has a `useReducedMotion` fallback. The reveal overlay still
  *appears* under reduce-motion (it's information, not decoration) — just
  without flip/cascade/travel movement.

## App icon pipeline (files + propagation)

Six committed PNGs in `apps/mobile/public/icons/`, produced by
`node scripts/generate-icons.mjs`:

| File | Size | Consumed by |
|------|------|-------------|
| `icon-1024.png` | 1024² | `app.json` `expo.icon` → Android launcher (baked by EAS) |
| `icon-512.png` / `icon-192.png` | 512²/192² | `public/manifest.json` (PWA install) |
| `icon-maskable-512.png` | 512² | manifest `purpose: maskable` — art inside the center ~80% circle |
| `apple-touch-icon.png` | 180² | `app/+html.tsx` (iPhone home screen) |
| `favicon.png` | 48² | `app/+html.tsx` (browser tab) |

Owner-supplied art remains possible by replacing these six files directly
(same sizes, maskable safe zone) and updating/removing the generator.

**Propagation:** Android launcher icon → next APK build (next production
release). PWA icons → next `expo export` + `wrangler deploy`; iPhone caches
the home-screen icon at install, so **remove + re-add** the PWA to see it.
`pwa.test.ts` already guards that manifest-referenced icons exist.

## Testing

- **Unit:** pending-hits selector + seen-marker (new events pending; dismiss
  advances; persists across store recreation); lobby sort comparators
  (Recent/Oldest/A–Z, stable within groups, missing-timestamp handling);
  icon files exist at expected dimensions (extend the existing `pwa.test.ts`
  pattern if needed).
- **e2e (chromium + webkit):** guest plays a card on the host → host page
  shows the reveal overlay containing the card's sentence; dismissing clears
  it; a reload does not re-show it. Second test: two quick plays → coalesced
  cascade ("2 cards"). Existing suite must stay green (the overlay must not
  block the multiplayer flow test — dismiss where needed; history-related
  selectors in `multiplayer.spec.ts` updated for the timeline markup).
- **On-device (owner):** travel-animation feel on Android APK + iPhone PWA;
  new icon after the next release (with the iPhone re-add caveat).

## Out of scope

- Win/lose celebration parity on web (own round later).
- Web push, R3F/GL effects, sounds/haptics.
