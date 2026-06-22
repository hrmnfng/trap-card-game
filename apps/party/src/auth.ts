/**
 * Minimal username + password authentication for the Workers runtime.
 *
 * Ported from `backend/app/services/auth.py` and `password.py`, with these
 * intentional changes:
 *  - No email and no self-service recovery. An operator can reset a forgotten
 *    password with `npm run reset-password` (see AGENTS.md → Account recovery).
 *  - Passwords hashed with PBKDF2 (Web Crypto) instead of bcrypt.
 *  - Opaque tokens stored in Workers KV with a TTL (replacing Redis).
 *  - User rows stored in D1 (replacing Postgres).
 */

import type { AuthResponse, User } from '@trap/shared';
import {
  USERNAME_CHARSET_RE,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '@trap/shared';
import { hashPassword, verifyPassword } from './password.js';
import { TOKEN_TTL_SECONDS, type Env } from './env.js';

export interface AuthError {
  status: number;
  code: string;
  message: string;
}

export type AuthOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: AuthError };

function fail(status: number, code: string, message: string): AuthOutcome<never> {
  return { ok: false, error: { status, code, message } };
}

/** Validate username format (alphanumeric + underscore, length bounds). */
export function validateUsername(username: string): AuthError | null {
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
    return {
      status: 400,
      code: 'invalid_username',
      message: `Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters`,
    };
  }
  if (!USERNAME_CHARSET_RE.test(username)) {
    return {
      status: 400,
      code: 'invalid_username',
      message: 'Username may only contain letters, numbers and underscores',
    };
  }
  return null;
}

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

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
}

/** Register a new account. Returns an auth response with a fresh token. */
export async function register(
  env: Env,
  username: string,
  password: string
): Promise<AuthOutcome<AuthResponse>> {
  const u = validateUsername(username);
  if (u) return { ok: false, error: u };
  const p = validatePassword(password);
  if (p) return { ok: false, error: p };

  const usernameLc = username.toLowerCase();
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE username_lc = ?'
  )
    .bind(usernameLc)
    .first<{ id: string }>();
  if (existing) {
    return fail(409, 'username_taken', 'Username is already taken');
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const createdAt = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO users (id, username, username_lc, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(id, username, usernameLc, passwordHash, createdAt)
    .run();

  const token = await issueToken(env, id);
  return { ok: true, value: { userId: id, username, token } };
}

/** Log in with username + password. Returns an auth response with a token. */
export async function login(
  env: Env,
  username: string,
  password: string
): Promise<AuthOutcome<AuthResponse>> {
  const row = await env.DB.prepare(
    'SELECT id, username, password_hash FROM users WHERE username_lc = ?'
  )
    .bind(username.toLowerCase())
    .first<UserRow>();

  if (!row) {
    return fail(401, 'invalid_credentials', 'Invalid username or password');
  }
  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    return fail(401, 'invalid_credentials', 'Invalid username or password');
  }

  const token = await issueToken(env, row.id);
  return { ok: true, value: { userId: row.id, username: row.username, token } };
}

/** Issue a fresh opaque token bound to a user id, stored in KV with a TTL. */
export async function issueToken(env: Env, userId: string): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  await env.TOKENS.put(`auth_token:${token}`, userId, {
    expirationTtl: TOKEN_TTL_SECONDS,
  });
  return token;
}

/** Resolve the current user from a Bearer token. */
export async function getUserFromToken(
  env: Env,
  token: string | null
): Promise<User | null> {
  if (!token) return null;
  const userId = await env.TOKENS.get(`auth_token:${token}`);
  if (!userId) return null;
  const row = await env.DB.prepare(
    'SELECT id, username FROM users WHERE id = ?'
  )
    .bind(userId)
    .first<{ id: string; username: string }>();
  if (!row) return null;
  return { userId: row.id, username: row.username };
}

/** Extract a Bearer token from an Authorization header value. */
export function extractBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/** Register (upsert) an Expo push token for a user. */
export async function registerDeviceToken(
  env: Env,
  userId: string,
  expoToken: string,
  platform: string
): Promise<AuthOutcome<{ id: string }>> {
  if (platform !== 'ios' && platform !== 'android') {
    return fail(400, 'invalid_platform', 'platform must be ios or android');
  }
  if (!expoToken) {
    return fail(400, 'invalid_token', 'expoToken is required');
  }

  // Upsert on the unique expo_token: re-point to the latest user.
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO device_tokens (id, user_id, expo_token, platform, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(expo_token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform`
  )
    .bind(id, userId, expoToken, platform, createdAt)
    .run();

  return { ok: true, value: { id } };
}

/** Fetch all Expo push tokens registered for a set of user ids. */
export async function getDeviceTokensForUsers(
  env: Env,
  userIds: string[]
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const placeholders = userIds.map(() => '?').join(', ');
  const result = await env.DB.prepare(
    `SELECT expo_token FROM device_tokens WHERE user_id IN (${placeholders})`
  )
    .bind(...userIds)
    .all<{ expo_token: string }>();
  return (result.results ?? []).map((r) => r.expo_token);
}
