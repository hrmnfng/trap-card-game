import { env } from 'cloudflare:test';
import { beforeEach } from 'vitest';
import type { Env } from '../src/env.js';

/**
 * The D1 schema as executable statements. Kept in sync with src/db/schema.sql.
 * (The vitest workers pool does not run the .sql file automatically, so we
 * create the tables here before each test for an isolated, clean database.)
 */
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL,
     username_lc TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS device_tokens (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     expo_token TEXT NOT NULL UNIQUE,
     platform TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS lobby_history (
     id TEXT PRIMARY KEY,
     code TEXT NOT NULL,
     user_id TEXT NOT NULL,
     status TEXT NOT NULL,
     owner_id TEXT,
     owner_username TEXT,
     player_count INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     joined_at TEXT NOT NULL
   )`,
];

const RESET_STATEMENTS = [
  'DELETE FROM device_tokens',
  'DELETE FROM lobby_history',
  'DELETE FROM users',
];

beforeEach(async () => {
  const db = (env as unknown as Env).DB;
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.prepare(stmt).run();
  }
  for (const stmt of RESET_STATEMENTS) {
    await db.prepare(stmt).run();
  }
});
