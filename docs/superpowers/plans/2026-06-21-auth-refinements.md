# Auth Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relax password validation to non-empty-only (usernames unchanged, case-insensitive uniqueness locked with a test) and add an operator CLI to reset any user's password against local or production D1.

**Architecture:** Two independent changes in `apps/party`. (1) A one-line rule change in `src/auth.ts` + test updates. (2) A new `scripts/reset-password.ts` CLI that reuses the Worker's `hashPassword` and applies an `UPDATE` via `wrangler d1 execute`, with pure arg/SQL helpers split into `scripts/reset-password.lib.ts` for unit testing.

**Tech Stack:** TypeScript, Cloudflare Workers/D1, wrangler, vitest (`@cloudflare/vitest-pool-workers`), Node 24 native TypeScript execution.

**Reference spec:** `docs/superpowers/specs/2026-06-21-auth-refinements-design.md`

---

## Background the engineer needs

- **Run all commands from `apps/party`** unless stated otherwise. Branch: `feat/feature-refinement` (stay on it).
- `apps/party/src/auth.ts` holds `validateUsername` (3–20, `^[A-Za-z0-9_]+$`) and `validatePassword` (currently min 6). `register`/`login` already lowercase the username into a `username_lc UNIQUE` column, so case-insensitive uniqueness already works — we only add a test.
- `apps/party/src/password.ts` exports `hashPassword(password)` → `pbkdf2$<iterations>$<saltBase64>$<hashBase64>` and `verifyPassword`. It is self-contained (only Web Crypto globals + `btoa`/`atob`/`TextEncoder`, all available in Node 24), so a Node-run script can import it.
- The party test suite runs in the **workers pool** (workerd), where `node:*` modules are unavailable. So unit-testable logic must avoid `node:*` imports — hence the pure `reset-password.lib.ts` split (the `node:*` + `wrangler` shell-out live only in `reset-password.ts`, which is **not** imported by any test).
- `apps/party/tsconfig.json` uses `moduleResolution: Bundler`, `include: ["src/**/*.ts"]` — so `scripts/**` and `test/**` are **not** type-checked by `npm run typecheck` (only `vitest` transforms tests). Node 24 runs `.ts` directly via type stripping (default-on); the npm script adds `--disable-warning=ExperimentalWarning` to keep output clean.
- **Import-extension rule:** files **run by Node** (`reset-password.ts`) must import with the real `.ts` extension (Node type-stripping does no extension rewriting). The **vitest test** follows the repo's `.js`-specifier convention (Bundler resolution maps it to the `.ts` file), matching `test/auth.test.ts` which imports `'../src/auth.js'`.

## File structure

- Modify `apps/party/src/auth.ts` — relax `validatePassword`; update stale comment.
- Modify `apps/party/test/auth.test.ts` — replace the weak-password test; add a login case-insensitivity test.
- Create `apps/party/scripts/reset-password.lib.ts` — pure helpers (`parseResetArgs`, `buildUpdateSql`), no `node:*`/Worker deps.
- Create `apps/party/test/reset-password.test.ts` — unit tests for the pure helpers.
- Create `apps/party/scripts/reset-password.ts` — CLI entry (hashing + wrangler shell-out).
- Modify `apps/party/package.json` — add the `reset-password` script.
- Modify `AGENTS.md` — document operator recovery.

---

## Task 1: Relax password validation

**Files:**
- Modify: `apps/party/src/auth.ts`
- Modify: `apps/party/test/auth.test.ts`

- [ ] **Step 1: Update the tests (TDD — these fail against current code)**

In `apps/party/test/auth.test.ts`, find the `rejects weak passwords` test inside the `describe('register', …)` block:

```ts
  it('rejects weak passwords', async () => {
    const res = await register(testEnv, 'carol', '123');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('invalid_password');
  });
```

Replace it with these two tests:

```ts
  it('rejects an empty password', async () => {
    const res = await register(testEnv, 'carol', '');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('invalid_password');
  });

  it('accepts a short (1-char) password', async () => {
    const res = await register(testEnv, 'carl', 'x');
    expect(res.ok).toBe(true);
  });
```

Then, inside the `describe('login', …)` block, add a case-insensitive login test:

```ts
  it('logs in case-insensitively on username', async () => {
    await register(testEnv, 'Mallory', 'password1');
    const res = await login(testEnv, 'MALLORY', 'password1');
    expect(res.ok).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `npm run test:party 2>&1 | grep -E "accepts a short|rejects an empty|case-insensitively|Tests "`
Expected: `accepts a short (1-char) password` FAILS (current code rejects `'x'` via the 6-char minimum). The other two pass. (On Windows the suite also prints an unrelated EBUSY teardown error — ignore it; the CI/Linux signal is what matters.)

- [ ] **Step 3: Relax `validatePassword` in `apps/party/src/auth.ts`**

Remove the constant `const MIN_PASSWORD_LEN = 6;` (line ~19). Replace the `validatePassword` function:

```ts
function validatePassword(password: string): AuthError | null {
  if (password.length === 0) {
    return {
      status: 400,
      code: 'invalid_password',
      message: 'Password is required',
    };
  }
  return null;
}
```

Also update the stale module comment near the top of the file — replace this bullet:

```ts
 *  - No email, no password recovery (per product decision: accounts only need
 *    to stay individual; a forgotten password is a lost account).
```

with:

```ts
 *  - No email and no self-service recovery. An operator can reset a forgotten
 *    password with `npm run reset-password` (see AGENTS.md → Account recovery).
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:party 2>&1 | grep -E "accepts a short|rejects an empty|case-insensitively|Tests "`
Expected: all three named tests pass; the suite's test count is green (ignore the Windows-only EBUSY teardown line).

- [ ] **Step 5: Commit**

```bash
git add apps/party/src/auth.ts apps/party/test/auth.test.ts
git commit -m "feat(auth): relax password rule to non-empty; lock case-insensitive login"
```

---

## Task 2: Account-recovery CLI

**Files:**
- Create: `apps/party/scripts/reset-password.lib.ts`
- Create: `apps/party/test/reset-password.test.ts`
- Create: `apps/party/scripts/reset-password.ts`
- Modify: `apps/party/package.json`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `apps/party/test/reset-password.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseResetArgs, buildUpdateSql } from '../scripts/reset-password.lib.js';

describe('parseResetArgs', () => {
  it('parses username + password and defaults to local', () => {
    expect(parseResetArgs(['Alice', 'secret'])).toEqual({
      username: 'Alice',
      usernameLc: 'alice',
      newPassword: 'secret',
      remote: false,
    });
  });

  it('detects --remote in any position', () => {
    expect(parseResetArgs(['--remote', 'Bob', 'pw']).remote).toBe(true);
    expect(parseResetArgs(['Bob', 'pw', '--remote']).remote).toBe(true);
  });

  it('throws on missing args', () => {
    expect(() => parseResetArgs(['onlyuser'])).toThrow();
  });

  it('throws on an invalid username', () => {
    expect(() => parseResetArgs(['bad name', 'pw'])).toThrow();
  });

  it('throws on an empty password', () => {
    expect(() => parseResetArgs(['alice', ''])).toThrow();
  });
});

describe('buildUpdateSql', () => {
  it('builds an UPDATE keyed on username_lc', () => {
    expect(buildUpdateSql('alice', 'pbkdf2$100000$c2FsdA==$aGFzaA==')).toBe(
      "UPDATE users SET password_hash = 'pbkdf2$100000$c2FsdA==$aGFzaA==' WHERE username_lc = 'alice';"
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:party 2>&1 | grep -E "reset-password|Cannot find|Tests "`
Expected: FAILS to resolve `../scripts/reset-password.lib.js` (module doesn't exist yet).

- [ ] **Step 3: Create the pure helpers**

Create `apps/party/scripts/reset-password.lib.ts`:

```ts
/**
 * Pure helpers for the reset-password CLI. No `node:*` or Worker imports, so they
 * run in the vitest workers pool. The CLI entry (reset-password.ts) adds the
 * Node-only I/O (hashing, fs, wrangler shell-out).
 */

/** Same rule as auth.ts validateUsername: 3-20 letters/numbers/underscore. */
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export interface ResetArgs {
  username: string;
  usernameLc: string;
  newPassword: string;
  remote: boolean;
}

const USAGE = 'Usage: npm run reset-password -- <username> <newPassword> [--remote]';

/** Parse argv (already sliced past node + script). Throws Error on bad input. */
export function parseResetArgs(argv: string[]): ResetArgs {
  const remote = argv.includes('--remote');
  const positional = argv.filter((a) => a !== '--remote');
  const username = positional[0];
  const newPassword = positional[1];
  if (username === undefined || newPassword === undefined) {
    throw new Error(USAGE);
  }
  if (!USERNAME_RE.test(username)) {
    throw new Error('username must be 3-20 characters of letters, numbers, or underscore');
  }
  if (newPassword.length === 0) {
    throw new Error('newPassword must not be empty');
  }
  return { username, usernameLc: username.toLowerCase(), newPassword, remote };
}

/**
 * Build the UPDATE. `passwordHash` is a base64 PBKDF2 string and `usernameLc`
 * matches USERNAME_RE, so neither can contain a single quote — safe to inline.
 */
export function buildUpdateSql(usernameLc: string, passwordHash: string): string {
  return `UPDATE users SET password_hash = '${passwordHash}' WHERE username_lc = '${usernameLc}';`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:party 2>&1 | grep -E "parseResetArgs|buildUpdateSql|Tests "`
Expected: the `parseResetArgs` and `buildUpdateSql` tests pass.

- [ ] **Step 5: Create the CLI entry**

Create `apps/party/scripts/reset-password.ts` (note the `.ts` import extensions — required because Node runs this file via type stripping, which does no extension rewriting):

```ts
/**
 * Operator password-reset CLI (account recovery backdoor).
 *
 *   npm run reset-password -- <username> <newPassword> [--remote]
 *
 * Reuses the Worker's PBKDF2 hashPassword so the stored format matches, then
 * applies an UPDATE via `wrangler d1 execute` (a temp .sql file avoids any shell
 * quoting). Default target is local Miniflare; --remote hits production D1 using
 * your existing `wrangler login` session (or CLOUDFLARE_API_TOKEN). No DB secret.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from '../src/password.ts';
import { parseResetArgs, buildUpdateSql } from './reset-password.lib.ts';

const DB_NAME = 'trapcard';

async function main(): Promise<void> {
  let args;
  try {
    args = parseResetArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const { usernameLc, newPassword, remote } = args;
  const target = remote ? '--remote' : '--local';

  const hash = await hashPassword(newPassword);
  const dir = mkdtempSync(join(tmpdir(), 'reset-pw-'));
  const file = join(dir, 'reset.sql');
  writeFileSync(file, buildUpdateSql(usernameLc, hash), 'utf8');

  try {
    const res = spawnSync(
      'npx',
      ['wrangler', 'd1', 'execute', DB_NAME, target, '--file', file],
      { stdio: 'inherit', shell: process.platform === 'win32' }
    );
    if (res.status !== 0) process.exit(res.status ?? 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(
    `\nReset password for '${usernameLc}' on the ${remote ? 'remote' : 'local'} DB. ` +
      `If 0 rows changed above, that username does not exist — verify by logging in.`
  );
}

await main();
```

- [ ] **Step 6: Add the npm script**

In `apps/party/package.json`, add to `scripts` (after `"db:apply:remote"`):

```json
    "reset-password": "node --disable-warning=ExperimentalWarning scripts/reset-password.ts",
```

- [ ] **Step 7: Smoke-test argument handling**

Run: `npm run reset-password`
Expected: prints the usage line and exits non-zero (no DB touched). Then run `npm run reset-password -- ab pw` → prints the "username must be 3-20…" error and exits non-zero.

- [ ] **Step 8: Manual end-to-end against local D1**

In one terminal: `npm run db:apply:local && npx wrangler dev --ip 0.0.0.0 --port 8787`.
Register a user, then reset and re-login:

```bash
curl -s -XPOST http://127.0.0.1:8787/api/auth/register -H 'content-type: application/json' -d '{"username":"recoverme","password":"oldpass"}'
npm run reset-password -- recoverme brandnewpass
curl -s -o /dev/null -w "old=%{http_code} " -XPOST http://127.0.0.1:8787/api/auth/login -H 'content-type: application/json' -d '{"username":"recoverme","password":"oldpass"}'
curl -s -o /dev/null -w "new=%{http_code}\n" -XPOST http://127.0.0.1:8787/api/auth/login -H 'content-type: application/json' -d '{"username":"recoverme","password":"brandnewpass"}'
```

Expected: the reset prints wrangler's "1 row" summary; the final line prints `old=401 new=200` (old password rejected, new password works).

- [ ] **Step 9: Document operator recovery in `AGENTS.md`**

Add this subsection under the party/ops area of `AGENTS.md` (e.g. right after the "Workers test pool & dev-only audit advisories" section):

```markdown
### Account recovery (operator password reset)

No self-service recovery. To reset a forgotten password, an operator runs (from
`apps/party`):

    npm run reset-password -- <username> <newPassword> [--remote]

It reuses the Worker's PBKDF2 `hashPassword` and applies an `UPDATE users …` via
`wrangler d1 execute` — local Miniflare by default, `--remote` for production D1.
`--remote` uses your existing `wrangler login` session (or a scoped
`CLOUDFLARE_API_TOKEN` for non-interactive/CI use); there is no separate DB secret.
`--remote` needs the real `database_id` in `wrangler.toml` (set at deploy time).
```

- [ ] **Step 10: Lint and commit**

Run: `cd ../.. && npm run lint` → expect `0 error(s)`. (markdownlint covers `AGENTS.md`.)

```bash
git add apps/party/scripts/reset-password.lib.ts apps/party/scripts/reset-password.ts apps/party/test/reset-password.test.ts apps/party/package.json AGENTS.md
git commit -m "feat(auth): add operator reset-password CLI for account recovery"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** password→non-empty ✓ Task 1 Step 3; usernames unchanged ✓ (no change); case-insensitive uniqueness locked ✓ Task 1 (register collision already tested in `auth.test.ts`; login case added); recovery CLI reusing `hashPassword` + wrangler, local/remote, wrangler-login default + documented `CLOUDFLARE_API_TOKEN` ✓ Task 2; stale comment updated ✓ Task 1 Step 3; docs ✓ Task 2 Step 9. The spec's "hash-parity unit test" is intentionally replaced by the more valuable pure arg/SQL helper tests — hash↔verify roundtrip is already covered by `apps/party/test/password.test.ts`, so a parity test would duplicate it (DRY); the script reuses `hashPassword` directly so parity holds by construction, and Task 2 Step 8 verifies it end-to-end.
- **Type/name consistency:** `parseResetArgs`/`buildUpdateSql`/`ResetArgs`/`USERNAME_RE` are defined in `reset-password.lib.ts` and consumed identically in the test (`.js` specifier) and the CLI (`.ts` specifier). `DB_NAME = 'trapcard'` matches `wrangler.toml`'s `database_name`.
- **Import extensions are intentional:** `.ts` in `reset-password.ts` (Node type-stripping), `.js` in the vitest test (repo convention + Bundler resolution). Both resolve to `reset-password.lib.ts`.
```
