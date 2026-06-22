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
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { hashPassword } from '../src/password.ts';
import { parseResetArgs, buildUpdateSql } from './reset-password.lib.ts';

const DB_NAME = 'trapcard';

/**
 * Absolute path to wrangler's JS entry. We run it with `node` directly rather
 * than via `npx`/a shell: a shell-out (`shell: true`) concatenates args unescaped
 * (DEP0190) and breaks on temp paths with spaces, and `npx` on Windows is a
 * `.cmd` that won't spawn without a shell. `bin/wrangler.js` isn't an exported
 * subpath, so we resolve the package's `package.json` and derive it.
 */
const require = createRequire(import.meta.url);
const WRANGLER_BIN = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');

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

  console.log(
    `Resetting password for '${usernameLc}' on the ${remote ? 'REMOTE (production)' : 'local'} D1 database...`
  );

  const hash = await hashPassword(newPassword);
  const dir = mkdtempSync(join(tmpdir(), 'reset-pw-'));
  const file = join(dir, 'reset.sql');
  writeFileSync(file, buildUpdateSql(usernameLc, hash), 'utf8');

  try {
    const res = spawnSync(
      process.execPath,
      [WRANGLER_BIN, 'd1', 'execute', DB_NAME, target, '--file', file],
      { stdio: 'inherit' }
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
