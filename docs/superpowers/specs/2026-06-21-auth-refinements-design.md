# Auth refinements: relaxed validation + account recovery — design

Date: 2026-06-21
Status: Approved (pre-implementation)

## Problem

Two UX/ops gaps in the current minimal auth:

1. **Over-strict validation.** Registration enforces a 6-char minimum password. Nothing
   sensitive is stored, so the password rule is friction with no benefit. Usernames are
   fine as-is, but we want to be sure casing can't create duplicate identities
   (`bob` vs `Bob`).
2. **No account recovery.** `auth.ts` intentionally shipped with "no password recovery"
   (a forgotten password = a lost account). We now want an operator-run way to reset a
   user's password without standing up a new service — a direct backdoor into the D1
   database.

Scope: this is one cohesive sub-project (sub-project "A" of a larger refinement effort).
The other refinements — shareable short room codes, and user-authored trap cards — are
separate specs/plans.

## Goals

- Drop the password minimum to **non-empty only**; keep username rules unchanged.
- Guarantee **case-insensitive username uniqueness** (lock it with a test).
- Provide an **operator CLI** to reset any user's password, against local **or** remote
  (production) D1, with no new service and no stored DB secret.

## Non-goals

- In-app self-service recovery (no recovery factor exists without email — out of scope).
- Any change to username length/charset rules.
- A networked admin endpoint (explicitly rejected in favor of the CLI/DB backdoor).
- Migrating existing stored password hashes (the change only relaxes new-password
  validation; existing hashes stay valid).

## Design

### 1. Relaxed password validation (`apps/party/src/auth.ts`)

- Replace the `MIN_PASSWORD_LEN = 6` check in `validatePassword` with a non-empty check:
  reject only `password.length === 0` (code stays `invalid_password`, message
  → `"Password is required"`). Remove the now-unused `MIN_PASSWORD_LEN` constant.
- **Usernames unchanged** (`3–20`, `^[A-Za-z0-9_]+$`).
- **Case-insensitive uniqueness** already holds: `register` computes
  `username_lc = username.toLowerCase()` and checks/inserts it against the
  `username_lc TEXT NOT NULL UNIQUE` column; `login` looks up by
  `username.toLowerCase()`. No code change — we add a regression test.
- **Mobile:** no change. `apps/mobile/app/login.tsx` performs no client-side password
  validation (submit is gated only on `loading`), so nothing rejects short passwords
  client-side.
- Update the stale module comment in `auth.ts` ("No email, no password recovery…") to
  reflect that operator-side recovery now exists via the CLI.

### 2. Account-recovery CLI (`apps/party`)

A script run as:

```
npm run reset-password -- <username> <newPassword> [--remote]
```

Behavior:

1. Validate args; lowercase the username to `username_lc`.
2. Compute the new hash by **reusing the Worker's `hashPassword`** from
   `src/password.ts` (no reimplementation — guarantees the stored
   `pbkdf2$<iterations>$<salt>$<hash>` format matches what `verifyPassword` expects).
   `password.ts` is self-contained (only Web Crypto globals, available in Node 24), so
   it imports cleanly into a Node-run script.
3. Run the update via wrangler against the bound D1:
   `wrangler d1 execute trapcard [--local | --remote] --command
   "UPDATE users SET password_hash = '<hash>' WHERE username_lc = '<usernameLc>'"`.
   Default target is **local** (Miniflare); `--remote` targets production D1.
4. Report the result: rows changed → success; 0 rows → `user not found` with a non-zero
   exit so mistakes are obvious.

Safety / correctness:

- The hash is base64 (`A–Z a–z 0–9 + / =`) — no single quotes — so inlining it in the
  SQL string is safe. The username is lowercased and matches `^[A-Za-z0-9_]+$`; the
  script rejects anything else before building SQL (defense-in-depth; no quote injection).
- Run mechanism: execute the script with Node 24's native TypeScript support so it can
  import `hashPassword` directly (the implementation plan pins the exact invocation and
  any tsconfig handling for `scripts/`).

Auth for `--remote` (no DB secret to store):

- **Default:** the operator's existing `wrangler login` session (same auth as
  `wrangler deploy`). Nothing committed.
- **Documented alternative:** a scoped `CLOUDFLARE_API_TOKEN` env var for
  non-interactive/CI use.
- `--remote` requires the real `database_id` in `wrangler.toml` (filled at deploy/D1
  provisioning time) — an id, not a secret.

Docs: a short "Account recovery" section (AGENTS.md and/or an `apps/party` README)
covering both auth paths and the `--local`/`--remote` distinction.

### 3. Testing

- **Password validation** (`apps/party/test/auth.test.ts`): empty password rejected
  (`invalid_password`); a 1-char password accepted; a long password accepted.
- **Case-insensitive uniqueness** (`auth.test.ts`): register `Bob`, then registering
  `bob` returns `username_taken`; and login with `BOB` finds the `Bob` account.
- **Recovery hash parity**: a unit test that hashes a password via the same
  `hashPassword` the script uses and asserts `verifyPassword` accepts it (proves the
  script writes a hash the Worker can verify). The wrangler/D1 shell-out itself is
  validated by a documented manual check: `reset-password --local`, then log in with the
  new password.

## Success criteria

- Registering with a 1-character password succeeds; an empty password is rejected.
- `bob`/`Bob` cannot both exist; login is case-insensitive on the username.
- `npm run reset-password -- <user> <newpass>` (local) lets that user log in with the new
  password; `--remote` does the same against production using existing wrangler auth.
- `npm test`, `npm run typecheck`, and `npm run lint` stay green.

## Out of scope / future (other sub-projects)

- Shareable short (4-char) room codes + join links.
- User-authored trap cards (core-mechanic rewrite).
