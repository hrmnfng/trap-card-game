# User-Authored Trap Cards — Design

Date: 2026-06-22
Status: Approved (brainstorming)
Sub-project: C (of the game-refinement work; A = auth refinements, B = short room codes)

## Goal

Replace the random numeric card values with **player-authored condition
statements** (e.g. "spills their drink", "checks their phone"). Each player
writes their own hand of trap statements, locked once submitted, then activates
them against other players using the existing targeting + game-end mechanics.

The game gains an explicit three-stage lifecycle:

1. **Lobby** (`waiting`) — players join and **ready up**. They see who is present
   and how many cards the game involves. No card authoring yet.
2. **Prep** (`prep`, new) — every player fills in and **submits** their cards.
   A submitted hand is locked (cannot be edited).
3. **Game** (`in-progress`) — players **activate** their cards against other
   players (the existing free-for-all play mechanic), until the existing end
   condition fires (`concluded`).

## Why this is low-risk to the end mechanic

In the current rules the card `value` is **display-only** — nothing compares or
scores on it (`getFinishedPlayers`/`hasGameEnded` only count a player's remaining
cards). So replacing the numeric `value` with an authored `statement` string
leaves targeting and the run-out-ends-game condition untouched.

## Non-goals (future modes, documented so the model doesn't preclude them)

- **Shared community pool** mode — players contribute statements to one shuffled
  pool and play traps authored by others. This build is "author your own hand"
  only; the data model should not block adding a pool mode later.
- **Owner-configurable card count** — choosing `cardsPerPlayer` in the lobby
  before start. This build fixes the count at the default (3); the value is
  already a per-game setting, so a future UI can set it without a model change.

## Lifecycle & transitions

```text
waiting ──(owner: Start)──▶ prep ──(owner: Begin game)──▶ in-progress ──▶ concluded
 Stage 1                     Stage 2                        Stage 3
 join + ready-up             author + submit cards          activate cards (existing)
```

- **Both gates are owner-triggered** (consistent with today's owner-only start):
  - `waiting → prep`: owner sends `start_prep`. Gated on **all present members
    Ready** and member count ≥ `minPlayers`.
  - `prep → in-progress`: owner sends `start_game`. Gated on **all present
    members Submitted** a full, locked hand.
- **Card count** is fixed at `cardsPerPlayer` (default 3) for the whole game,
  including mid-game joiners. Surfaced in the lobby UI.
- **Mid-game join** (during `in-progress`): the joiner authors + submits their
  `cardsPerPlayer` statements before they can activate anything. There is no
  auto-deal. A player who joins during `prep` simply participates in the prep gate.

## Data model (single source of truth: `packages/shared/src/types.ts`)

- `LobbyStatus`: `'waiting' | 'prep' | 'in-progress' | 'concluded'` (adds `prep`).
- `Card`: `{ id: string; statement: string | null; status: CardStatus; ownerId: string }`
  — replaces `value: number | null`. `statement` holds the real text for the
  viewer's own cards; it is **null/hidden for other players' cards** until the
  card is activated.
- `GameActionType`: `'join' | 'leave' | 'set_ready' | 'distribute' | 'play_card'`
  (adds `set_ready`; `distribute` now records an authored card rather than a
  random one).
- `GameEvent`: replace `cardValue?: number` with `statement?: string`; add
  `ready?: boolean` (for `set_ready` events). `cardId`, `targetId`, `playerId`,
  `timestamp`, `id`, `type` unchanged.
- `GameHistoryItem`: `cardValue: number | null` → `statement: string | null`
  (revealed to everyone on activation — the trap becomes public).
- `PlayerView`: add `isReady: boolean` and `hasSubmitted: boolean` alongside the
  existing `cardsRemaining`.
- `GameSettings`: drop `minCardValue` and `maxCardValue`; keep `minPlayers`,
  `maxPlayers`, `cardsPerPlayer`. Update `DEFAULT_GAME_SETTINGS` accordingly.
- `GameState`: unchanged shape except `myCards` now carries statements and
  `players` carries the new flags.

### Statement validation

- Exactly `cardsPerPlayer` statements per submission.
- Each statement: trimmed, **non-empty**, and at most **100 characters**.
- A hand is **locked on submit** — a second `submit_cards` from the same player
  is rejected.

## Rules (`packages/shared/src/gameRules.ts`, pure + event-sourced)

- `RuleDeps`: remove `randomCardValue` (no random deal); keep `newId`, `now`.
- `createRoomState`: settings without min/max card value.
- Readiness:
  - `setReady(state, playerId, ready, deps): RuleResult` — appends a `set_ready`
    event. Allowed only while `status === 'waiting'`.
  - `isPlayerReady(state, playerId): boolean` and `getReadyPlayers(state)` —
    derived from each player's **latest** `set_ready` event (default not-ready).
- Stage 1 → 2:
  - `startPrep(state, deps): RuleResult` — guards `status === 'waiting'`, all
    present members ready, member count ≥ `minPlayers`; sets `status = 'prep'`.
    Failure codes: `not_waiting`, `not_enough_players`, `not_all_ready`.
- Authoring:
  - `submitCards(state, playerId, statements, deps): RuleResult` — guards the
    player has not already submitted, `statements.length === cardsPerPlayer`,
    each statement valid (trimmed non-empty, ≤ 100 chars), and `status` is
    `prep` or `in-progress` (the latter only for a mid-game joiner who has not
    submitted). Appends one `distribute` event per statement (carrying the
    trimmed `statement` text and a fresh `cardId`). Failure codes:
    `already_submitted`, `wrong_card_count`, `invalid_statement`, `wrong_phase`.
  - `hasPlayerSubmitted(state, playerId): boolean` (has ≥1 `distribute` event)
    and `getSubmittedPlayers(state)`.
- Stage 2 → 3:
  - `startGame(state, deps): RuleResult` — now guards `status === 'prep'` and all
    present members submitted; sets `status = 'in-progress'`. **No dealing.**
    Failure codes: `not_in_prep`, `not_all_submitted`.
- Unchanged in behavior (now operating on statements): `playCard` (records
  `statement` from the card's distribute event), `getPlayerCards` (returns cards
  with `statement`), `getFinishedPlayers` / `hasGameEnded` (still count remaining
  cards), `addPlayer`/`removePlayer` (join no longer auto-deals — `dealHand` is
  removed).
- `getGameState`: populate `PlayerView.isReady` / `hasSubmitted`; `myCards`
  carries statements; history carries statements.

## WebSocket contract (`packages/shared/src/messages.ts`)

**Client → Server** (`ClientMessage`):
- Add `SetReadyMessage { type: 'set_ready'; ready: boolean }`.
- Add `StartPrepMessage { type: 'start_prep' }` (owner-only, enforced server-side).
- Add `SubmitCardsMessage { type: 'submit_cards'; statements: string[] }`.
- Keep `StartGameMessage { type: 'start_game' }` (now the prep → in-progress gate).
- Keep `play_card`, `get_state`, `ping`.
- Extend `parseClientMessage` to parse/validate the new shapes (`ready` is a
  boolean; `statements` is a `string[]`).

**Server → Client** (`ServerMessage`):
- Add `PrepStartedMessage { type: 'prep_started' }` (mirrors `game_started`).
- Change `CardPlayedMessage`: `cardValue: number` → `statement: string`.
- Ready/submit progress is delivered through the existing `state_update`
  (the new `PlayerView` flags) — no dedicated message.
- Unchanged: `connected`, `player_joined`, `player_left`, `game_started`,
  `game_ended`, `error`, `pong`.

## Server (`apps/party/src/LobbyDO.ts`)

Route new client messages to the rule functions and broadcast results:
- `set_ready` → `setReady` → broadcast `state_update`.
- `start_prep` → **owner-only** (`not_owner` error otherwise) → `startPrep` →
  broadcast `prep_started` + `state_update`.
- `submit_cards` → `submitCards` → broadcast `state_update` (others see the
  submitter's `hasSubmitted`/count flip; statements stay hidden).
- `start_game` → **owner-only** → `startGame` → broadcast `game_started` +
  `state_update`.
- `play_card` → `playCard` → broadcast `card_played` (now with `statement`) +
  `state_update`; existing `game_ended` emission unchanged.

The per-player state filtering (own statements visible, others hidden) lives in
`getGameState`, so the DO keeps sending per-viewer `state_update`s as today.

## Mobile (`apps/mobile`)

Status drives navigation, exactly as `in-progress` routes to the game screen today:
- **`app/lobby/[code].tsx` (`waiting`):** member list with per-player ready
  indicators; a **Ready / Unready** toggle for self; "This game: N cards each";
  owner-only **Start** button (disabled until all present are ready and ≥
  `minPlayers`).
- **`app/prep/[code].tsx` (new, `prep`):** `cardsPerPlayer` text inputs with a
  per-input character counter (≤ 100); a **Submit** action that validates and
  locks (inputs become read-only, "Submitted ✓"); a roster showing who has
  submitted; owner-only **Begin game** (disabled until all submitted).
- **`app/game/[code].tsx` (`in-progress`):** the existing activate-at-target
  flow, rendering each card's **statement** instead of a number; the history feed
  and `card_played` surface the activated statement.

Navigation: the lobby/prep/game screens redirect based on `gameState.status`
(e.g. a player in the lobby is pushed to `/prep/<code>` when status becomes
`prep`, and to `/game/<code>` when it becomes `in-progress`), mirroring the
current lobby → game redirect.

## Testing

- **Shared (unit, `packages/shared`):**
  - `setReady` + ready derivation (latest event wins; default not-ready).
  - `startPrep` gating (not waiting / not enough players / not all ready / success).
  - `submitCards` validation (wrong count, empty, > 100 chars, double-submit,
    mid-game allowed, prep allowed, wrong phase rejected) and that it appends
    `cardsPerPlayer` distribute events with the trimmed statements.
  - `startGame` prep-gate (not in prep / not all submitted / success, no deal).
  - `playCard` + `getFinishedPlayers`/`hasGameEnded` still behave with statements.
  - `getGameState` exposes correct `isReady`/`hasSubmitted` and hides other
    players' statements while showing the viewer's own.
- **Party (integration, `apps/party`):** keep the existing `/create` + state
  coverage; add transition coverage where the workers-pool single-touch DO limit
  allows (respect the documented `.skip`ped-test constraints — do not introduce
  create-then-re-touch patterns that trip the Windows isolated-storage teardown).
- **Mobile:** unit-cover any extracted helpers; verify the three-stage flow via
  the Playwright e2e and manual `wrangler dev` + Expo run.

## Backward compatibility

This changes the WS contract and the persisted event shape (`statement` replaces
`cardValue`, new `set_ready` events, new `prep` status). There is no migration
concern for live data: lobbies are ephemeral Durable Objects with a short
expiry, and this is a pre-release hobby project — any in-flight lobby from the
old build can be abandoned. All three workspaces ship together.
