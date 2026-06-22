# Short Room Codes + Tap-to-Copy — Design

Date: 2026-06-22
Status: Approved (brainstorming)
Sub-project: B (of the game-refinement work; A = auth refinements, C = user-authored trap cards)

## Goal

Make joining a game easier:

1. **Shorter room codes** — 4 characters (down from 6), drawn from an
   ambiguity-stripped alphabet, with a collision check on create.
2. **Tap-to-copy** — tapping the room code on the lobby screen copies it to the
   clipboard so the host can paste it into a chat/message. Recipients open the
   app themselves and type or paste it into the existing Join field.

## Non-goals (future work)

- **Shareable HTTPS join link + landing page** that deep-links installed apps
  and routes new users to download/sign-in. Deferred: true universal/app links
  require a standalone build (associated domains) and don't work in Expo Go, and
  there is no store listing yet. Captured here so the code-format and join
  changes don't preclude it later — a `/j/<code>` Worker route can be added
  without touching anything in this spec.
- Validating that a typed code corresponds to a live lobby before connecting
  (rejecting typos up front). Current behavior is unchanged: an unknown code
  connects to a fresh DO. Out of scope for B.

## Code format

- **Length:** 4 characters.
- **Alphabet:** Crockford Base32 — `0123456789ABCDEFGHJKMNPQRSTVWXYZ`
  (32 chars; excludes `I`, `L`, `O`, `U`). Keyspace = 32⁴ ≈ 1.05M codes.
- **Generation:** unchanged approach — `crypto.getRandomValues` indexed into the
  alphabet (replaces the current 6-char, 36-char-alphabet generator in
  `apps/party/src/server.ts`).

### Join-input normalization

Crockford's payoff is on input. Before connecting, the client normalizes a typed
code so look-alike keys can't cause a miss:

- Uppercase.
- Map `I` → `1`, `L` → `1`, `O` → `0` (Crockford's decode rule). `U` is simply
  not in the alphabet, so it never appears in a generated code.
- Strip surrounding whitespace.

This is a pure helper in `@trap/shared` (e.g. `normalizeLobbyCode(input): string`)
so both the generator's alphabet and the normalizer live next to each other and
are unit-tested together. The mobile Join handler calls it in place of the
current `.trim().toUpperCase()`.

**Length is not enforced on join.** Existing 6-char codes (in users' lobby
history) must remain joinable, so the Join field accepts any normalized
non-empty code. Only *generation* is fixed at 4 chars.

## Collision avoidance

At 32⁴ the probability of collision is negligible at this game's scale, but a
collision is a real bug (a new "create" would silently reuse a live lobby's DO),
so we guard it with the strongly-consistent authority that already exists — the
Durable Object — rather than introducing a registry.

- `LobbyDO.ensureRoom()` already distinguishes "loaded existing state" from
  "created new state". Surface that: the `POST .../create` route returns
  `{ lobbyCode, status, created: boolean }` where `created` is `false` when the
  DO already had state (i.e. the code is taken — including a not-yet-expired
  concluded lobby).
- `POST /api/lobbies` in `server.ts` loops: mint a code → call create → if
  `created === false`, retry with a fresh code (cap at a small N, e.g. 5). On
  success return `{ code, status }` as today. If all retries collide (effectively
  impossible), return a 503 so the failure is explicit rather than silently
  reusing a lobby.

Codes free themselves when a DO's state expires (`LOBBY_EXPIRATION_HOURS`) — no
explicit reclamation needed given the keyspace.

## Tap-to-copy (mobile)

- Library: **`expo-clipboard`** (`setStringAsync`) — off-the-shelf, matches the
  project preference for libraries over custom.
- Location: the lobby screen (`apps/mobile/app/lobby/[code].tsx`), on the element
  that displays the code. Tapping copies the code and shows a brief, transient
  "Copied!" confirmation (inline label or lightweight toast).
- Home-screen history rows are **not** made copyable in this pass (kept to the
  lobby screen per the agreed scope).

## Data flow

```text
Create:
  mobile  --POST /api/lobbies-->  Worker
                                   loop: generateLobbyCode()  (4-char Crockford)
                                         getServerByName(LOBBY, code)
                                         stub.fetch(.../create) -> { created }
                                         created === false ? retry : done
          <--{ code, status }--  Worker

Join:
  user types code -> normalizeLobbyCode() -> router.push(/lobby/<code>) -> WS connect

Copy:
  tap code on lobby screen -> Clipboard.setStringAsync(code) -> "Copied!" flash
```

## Affected files

- `packages/shared/src/` — new `normalizeLobbyCode` + the Crockford alphabet
  constant (exported), with tests in `gameRules.test.ts` or a new
  `lobbyCode.test.ts`.
- `apps/party/src/server.ts` — 4-char Crockford generator + create-with-retry loop.
- `apps/party/src/LobbyDO.ts` — `/create` route returns `created: boolean`;
  `ensureRoom` reports whether it created.
- `apps/party/test/lobby.integration.test.ts` (and/or server tests) — collision
  retry + `created` flag behavior.
- `apps/mobile/app/index.tsx` — Join handler uses `normalizeLobbyCode`.
- `apps/mobile/app/lobby/[code].tsx` — tap-to-copy on the code display.
- `apps/mobile/package.json` — add `expo-clipboard` (via `npx expo install`).

## Testing

- **Shared (unit):** generated-code length/alphabet membership; `normalizeLobbyCode`
  maps `I/L→1`, `O→0`, uppercases, trims, leaves valid codes unchanged, accepts
  legacy 6-char codes.
- **Party (integration):** `/create` returns `created: true` first time and
  `created: false` on a repeat for the same name; `POST /api/lobbies` retries past
  a simulated collision and never returns a code whose DO already had state.
- **Mobile:** unit-test the normalize call wiring is straightforward; the
  clipboard tap is thin enough to leave to manual / e2e verification.

## Backward compatibility

- Existing 6-char codes in lobby history stay valid: join accepts any normalized
  non-empty code; only new-code *generation* changes.
- `created` is an additive field on the `/create` response; existing callers that
  ignore it are unaffected.
