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
 * We still assert that here so the no-injection guarantee travels with this
 * function rather than depending on every caller having validated first.
 */
export function buildUpdateSql(usernameLc: string, passwordHash: string): string {
  if (/['\\;]/.test(usernameLc) || /['\\;]/.test(passwordHash)) {
    throw new Error('refusing to build SQL: usernameLc/passwordHash contain unsafe characters');
  }
  return `UPDATE users SET password_hash = '${passwordHash}' WHERE username_lc = '${usernameLc}';`;
}
