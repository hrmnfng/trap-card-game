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
