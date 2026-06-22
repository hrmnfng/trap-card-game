# Short Room Codes + Tap-to-Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shorten lobby codes to 4 ambiguity-stripped characters (collision-checked on create), normalize typed codes on join, and let the host tap the lobby code to copy it.

**Architecture:** A new `@trap/shared` module owns the code alphabet, generator, and normalizer (the single source of truth, unit-tested in plain vitest). The Worker generates codes from it and probes the strongly-consistent Durable Object — whose `/create` route now reports whether it actually created state — retrying on the rare collision. The mobile app normalizes typed codes through the shared helper and uses `expo-clipboard` for tap-to-copy.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects (`@cloudflare/vitest-pool-workers`), Expo / React Native, `expo-clipboard`, vitest.

Spec: `docs/superpowers/specs/2026-06-22-short-room-codes-design.md`

---

## File Structure

- `packages/shared/src/lobbyCode.ts` (create) — `LOBBY_CODE_ALPHABET`, `LOBBY_CODE_LENGTH`, `generateLobbyCode()`, `normalizeLobbyCode()`.
- `packages/shared/src/lobbyCode.test.ts` (create) — unit tests for the above.
- `packages/shared/src/index.ts` (modify) — re-export the new module.
- `apps/party/src/LobbyDO.ts` (modify) — `/create` route returns `created: boolean`.
- `apps/party/src/lobbyCodes.ts` (create) — `pickUnusedCode()` collision-retry helper.
- `apps/party/test/lobbyCodes.test.ts` (create) — unit tests for `pickUnusedCode`.
- `apps/party/src/server.ts` (modify) — use shared generator + `pickUnusedCode`; drop the local 6-char generator.
- `apps/party/test/lobby.integration.test.ts` (modify) — assert `created: true` on first create.
- `apps/mobile/app/index.tsx` (modify) — Join uses `normalizeLobbyCode`.
- `apps/mobile/app/lobby/[code].tsx` (modify) — tap-to-copy the code via `expo-clipboard`.
- `apps/mobile/package.json` (modify) — add `expo-clipboard`.

---

## Task 1: Shared lobby-code module (alphabet, generator, normalizer)

**Files:**
- Create: `packages/shared/src/lobbyCode.ts`
- Test: `packages/shared/src/lobbyCode.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/lobbyCode.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  LOBBY_CODE_ALPHABET,
  LOBBY_CODE_LENGTH,
  generateLobbyCode,
  normalizeLobbyCode,
} from './lobbyCode.js';

describe('generateLobbyCode', () => {
  it('produces a code of the configured length', () => {
    expect(generateLobbyCode()).toHaveLength(LOBBY_CODE_LENGTH);
  });

  it('uses only alphabet characters, never I/L/O/U', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateLobbyCode();
      for (const ch of code) {
        expect(LOBBY_CODE_ALPHABET).toContain(ch);
      }
      expect(code).not.toMatch(/[ILOU]/);
    }
  });
});

describe('normalizeLobbyCode', () => {
  it('trims and uppercases', () => {
    expect(normalizeLobbyCode('  ab1d ')).toBe('AB1D');
  });

  it('maps confusable characters on 4-char codes (I/L -> 1, O -> 0)', () => {
    expect(normalizeLobbyCode('oilz')).toBe('0112'); // O->0, I->1, L->1, Z stays
    expect(normalizeLobbyCode('I00L')).toBe('1001');
  });

  it('leaves legacy 6-char codes untouched beyond trim/uppercase', () => {
    // The old alphabet included I/L/O/U, so a 6-char code must pass through.
    expect(normalizeLobbyCode('hello1')).toBe('HELLO1');
    expect(normalizeLobbyCode(' room0a ')).toBe('ROOM0A');
  });

  it('leaves a clean 4-char code unchanged', () => {
    expect(normalizeLobbyCode('AB12')).toBe('AB12');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:shared`
Expected: FAIL — `Cannot find module './lobbyCode.js'` (file not created yet).

- [ ] **Step 3: Create the implementation**

Create `packages/shared/src/lobbyCode.ts`:

```ts
/**
 * Lobby code generation + normalization.
 *
 * Uses Crockford's Base32 alphabet (no I, L, O, U) so generated codes have no
 * easily-confused characters and typed codes can be mapped back to canonical
 * form. Single source of truth shared by the Worker (generation) and the mobile
 * client (join-input normalization).
 */

/**
 * Module-scoped type for the Web Crypto global. The shared package compiles with
 * `lib: ["ES2022"]` and no `@types/node`, so `crypto` is otherwise untyped here.
 * Both runtimes that use this code (workerd and Node 18+) expose it globally.
 */
declare const crypto: { getRandomValues<T extends ArrayBufferView>(array: T): T };

/** Crockford Base32: digits + A-Z minus I, L, O, U. */
export const LOBBY_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Length of a freshly generated lobby code. */
export const LOBBY_CODE_LENGTH = 4;

/** Generate a random lobby code (4 chars from the Crockford alphabet). */
export function generateLobbyCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LOBBY_CODE_LENGTH));
  let code = '';
  for (let i = 0; i < LOBBY_CODE_LENGTH; i++) {
    code += LOBBY_CODE_ALPHABET[bytes[i]! % LOBBY_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Normalize a user-typed lobby code to canonical form.
 *
 * Always trims and uppercases. Applies Crockford's confusable mapping
 * (I/L -> 1, O -> 0) only to new-format (4-char) codes: the legacy 6-char
 * alphabet included I/L/O/U, so a legacy code must pass through unchanged or it
 * would resolve to the wrong Durable Object. Accepts any length so legacy codes
 * remain joinable.
 */
export function normalizeLobbyCode(input: string): string {
  const trimmed = input.trim().toUpperCase();
  if (trimmed.length !== LOBBY_CODE_LENGTH) return trimmed;
  return trimmed.replace(/[IL]/g, '1').replace(/O/g, '0');
}
```

- [ ] **Step 4: Export from the package index**

In `packages/shared/src/index.ts`, add the re-export after the existing lines:

```ts
export * from './types.js';
export * from './messages.js';
export * from './gameRules.js';
export * from './lobbyCode.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:shared`
Expected: PASS — all `lobbyCode.test.ts` tests green.

- [ ] **Step 6: Build shared so downstream workspaces see the new exports**

Run: `npm run build --workspace=@trap/shared`
Expected: tsc emits to `packages/shared/dist` with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/lobbyCode.ts packages/shared/src/lobbyCode.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): 4-char Crockford lobby codes + join normalizer"
```

---

## Task 2: Durable Object reports whether `/create` created state

**Files:**
- Modify: `apps/party/src/LobbyDO.ts:111-115`
- Test: `apps/party/test/lobby.integration.test.ts:91-98`

- [ ] **Step 1: Update the integration test to assert the `created` flag**

In `apps/party/test/lobby.integration.test.ts`, replace the body of the existing `'creates a lobby via HTTP'` test (currently at lines 92-98) with:

```ts
  it('creates a lobby via HTTP and reports created: true', async () => {
    const res = await createLobby('ROOM01');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      lobbyCode: string;
      status: string;
      created: boolean;
    };
    expect(body.lobbyCode).toBe('ROOM01');
    expect(body.status).toBe('waiting');
    expect(body.created).toBe(true);
  });
```

Note: we deliberately do NOT add a second `/create` on the same DO to assert
`created: false`. Touching one LobbyDO twice in this pool reproducibly trips the
isolated-storage teardown on Windows (see the `.skip`ped
`'persists created lobby state'` test below). The `created: false` branch is
trivial (`!existing`) and the consumer's retry logic is unit-tested in Task 3.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:party -- lobby.integration`
Expected: FAIL — `expected undefined to be true` (the `created` field does not exist yet).

- [ ] **Step 3: Implement the `created` flag in the DO create route**

In `apps/party/src/LobbyDO.ts`, replace the create route (lines 111-115):

```ts
    // POST .../create  -> reserve/create the room
    if (request.method === 'POST' && url.pathname.endsWith('/create')) {
      const existing = await this.loadRoom();
      const room = existing ?? (await this.ensureRoom());
      return json({
        lobbyCode: room.lobbyCode,
        status: room.status,
        created: existing === null,
      });
    }
```

(`loadRoom()` returns `GameRoomState | null`; `ensureRoom()` is unchanged, so
its other two callers are unaffected.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:party -- lobby.integration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/party/src/LobbyDO.ts apps/party/test/lobby.integration.test.ts
git commit -m "feat(party): LobbyDO /create reports created flag"
```

---

## Task 3: Collision-retry helper + wire into lobby creation

**Files:**
- Create: `apps/party/src/lobbyCodes.ts`
- Test: `apps/party/test/lobbyCodes.test.ts`
- Modify: `apps/party/src/server.ts:28-29,54-61,126-140`

- [ ] **Step 1: Write the failing unit tests for `pickUnusedCode`**

Create `apps/party/test/lobbyCodes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickUnusedCode } from '../src/lobbyCodes.js';

describe('pickUnusedCode', () => {
  it('returns the first code that reserves successfully', async () => {
    const code = await pickUnusedCode(
      async () => true, // reserve always succeeds
      () => 'AAAA'
    );
    expect(code).toBe('AAAA');
  });

  it('retries past taken codes until one reserves', async () => {
    const generated = ['AAAA', 'BBBB', 'CCCC'];
    let i = 0;
    const code = await pickUnusedCode(
      async (c) => c === 'CCCC', // only the third reserves
      () => generated[i++]!
    );
    expect(code).toBe('CCCC');
  });

  it('throws after exhausting maxTries', async () => {
    await expect(
      pickUnusedCode(async () => false, () => 'AAAA', 3)
    ).rejects.toThrow(/unique lobby code/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:party -- lobbyCodes`
Expected: FAIL — `Cannot find module '../src/lobbyCodes.js'`.

- [ ] **Step 3: Implement `pickUnusedCode`**

Create `apps/party/src/lobbyCodes.ts`:

```ts
import { generateLobbyCode } from '@trap/shared';

/**
 * Allocate a lobby code that is not already in use.
 *
 * `tryReserve(code)` must atomically attempt to claim `code` and resolve `true`
 * only if it was free (i.e. this call created it). At ~1M-code keyspace a
 * collision is vanishingly rare, but a collision would silently reuse a live
 * lobby, so we retry on a clash and fail loudly rather than return a taken code.
 */
export async function pickUnusedCode(
  tryReserve: (code: string) => Promise<boolean>,
  generate: () => string = generateLobbyCode,
  maxTries = 5
): Promise<string> {
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const code = generate();
    if (await tryReserve(code)) return code;
  }
  throw new Error(`could not allocate a unique lobby code after ${maxTries} tries`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:party -- lobbyCodes`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Wire `pickUnusedCode` into the Worker create route**

In `apps/party/src/server.ts`:

(a) Remove the now-unused local constants and generator. Delete lines 28-29:

```ts
const LOBBY_CODE_LENGTH = 6;
const LOBBY_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
```

and delete the whole `generateLobbyCode` function (lines 54-61):

```ts
function generateLobbyCode(): string {
  let code = '';
  const bytes = crypto.getRandomValues(new Uint8Array(LOBBY_CODE_LENGTH));
  for (let i = 0; i < LOBBY_CODE_LENGTH; i++) {
    code += LOBBY_CODE_ALPHABET[bytes[i]! % LOBBY_CODE_ALPHABET.length];
  }
  return code;
}
```

(b) Add the import for the helper near the other local imports (after the
`listLobbyHistory` import on line 23):

```ts
import { pickUnusedCode } from './lobbyCodes.js';
```

(c) Replace the lobby-create handler body (lines 131-139, from `const code = generateLobbyCode();` through the `return json(...)`):

```ts
      // Mint a unique code: probe the DO's /create route, which returns
      // created:false when that code already maps to a live (or concluded,
      // not-yet-expired) lobby. getServerByName persists PartyServer's name
      // record so the later WebSocket connect can resolve the lobby.
      const code = await pickUnusedCode(async (candidate) => {
        const stub = await getServerByName(env.LOBBY, candidate);
        const res = await stub.fetch(
          `https://do/parties/lobby/${candidate}/create`,
          { method: 'POST' }
        );
        const data = (await res.json()) as { created?: boolean };
        return data.created === true;
      });
      return json({ code, status: 'waiting' });
```

- [ ] **Step 6: Typecheck and run the full party suite**

Run: `npm run typecheck --workspace=@trap/party`
Expected: no errors.

Run: `npm run test:party`
Expected: PASS — existing suite plus the new `lobbyCodes` tests; `created` integration test green.

- [ ] **Step 7: Commit**

```bash
git add apps/party/src/lobbyCodes.ts apps/party/test/lobbyCodes.test.ts apps/party/src/server.ts
git commit -m "feat(party): mint unique 4-char lobby codes with collision retry"
```

---

## Task 4: Normalize typed codes on join (mobile)

**Files:**
- Modify: `apps/mobile/app/index.tsx:13,89-93`

- [ ] **Step 1: Import the shared normalizer**

In `apps/mobile/app/index.tsx`, add `normalizeLobbyCode` to the existing
`@trap/shared` import (currently `import type { LobbyHistoryItem } from '@trap/shared';`
on line 13). Because `normalizeLobbyCode` is a value (not a type), split it:

```ts
import type { LobbyHistoryItem } from '@trap/shared';
import { normalizeLobbyCode } from '@trap/shared';
```

- [ ] **Step 2: Use it in the join handler**

Replace the `joinLobby` function (lines 89-93):

```ts
  const joinLobby = () => {
    const code = normalizeLobbyCode(joinCode);
    if (code.length === 0) return;
    router.push(`/lobby/${code}`);
  };
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace=@trap/mobile`
Expected: no errors.

(No new automated test: `normalizeLobbyCode` is unit-tested in `@trap/shared`
Task 1; this is wiring only. Verify manually that typing `oil2` / `OIL2` routes
to lobby `0112`.)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/index.tsx
git commit -m "feat(mobile): normalize typed lobby codes on join"
```

---

## Task 5: Tap-to-copy the lobby code (mobile)

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/app/lobby/[code].tsx:1-8,12-19,48-61,101-127`

- [ ] **Step 1: Install `expo-clipboard`**

Run (from `apps/mobile`): `npx expo install expo-clipboard`
Expected: adds `expo-clipboard` to `apps/mobile/package.json` dependencies at the Expo-SDK-54-compatible version.

- [ ] **Step 2: Add copy state + handler and make the code tappable**

In `apps/mobile/app/lobby/[code].tsx`:

(a) Update imports (lines 1-8). Add `useState` to the react import, add
`Pressable` is already imported; add the clipboard import:

```ts
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import * as Clipboard from 'expo-clipboard';
import { gameStore } from '../../src/state/game';
import { useAuth, useGame } from '../../src/state/hooks';
import { colors } from '../../src/lib/theme';
import { PressableScale } from '../../src/ui/PressableScale';
```

(b) Add copy state inside the component, after the existing `error` selector
(line 20). Insert:

```ts
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
```

(c) Replace the code `<Text>` (line 55) with a tappable version that shows the
"Copied!" confirmation:

```ts
      <Pressable onPress={copyCode} testID="copy-code">
        <Text style={styles.code}>Lobby {code}</Text>
        <Text style={styles.copyHint}>{copied ? 'Copied!' : 'Tap to copy'}</Text>
      </Pressable>
```

(d) Add the `copyHint` style to the `StyleSheet.create` block (after the `code`
style on line 103):

```ts
  copyHint: { color: colors.muted, fontSize: 12, marginTop: 2 },
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace=@trap/mobile`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run (from `apps/mobile`): `npx expo start`, open a lobby, tap the code, confirm
the hint flips to "Copied!" and the clipboard holds the code. (Clipboard is a
thin native call; left to manual/e2e per the spec.)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/package.json apps/mobile/package-lock.json apps/mobile/app/lobby/[code].tsx
git commit -m "feat(mobile): tap lobby code to copy to clipboard"
```

---

## Final verification

- [ ] **Run the whole test suite**

Run: `npm test`
Expected: all workspaces green (shared lobbyCode tests, party lobbyCodes + integration, existing suites).

- [ ] **Lint**

Run: `npm run lint`
Expected: 0 errors (ESLint + markdownlint). Fix findings rather than disabling rules.

- [ ] **End-to-end sanity (manual, against `wrangler dev` + Expo)**

Create a lobby → confirm the code is 4 Crockford chars. Tap to copy. On a second
client, type the code (try a confusable like lowercase `l`/`o`) → confirm it
joins the same lobby. Confirm a legacy 6-char code (from history) still joins.
