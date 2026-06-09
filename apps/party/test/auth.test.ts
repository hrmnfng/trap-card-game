import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import {
  register,
  login,
  getUserFromToken,
  extractBearer,
  validateUsername,
  registerDeviceToken,
  getDeviceTokensForUsers,
} from '../src/auth.js';
import type { Env } from '../src/env.js';

const testEnv = env as unknown as Env;

describe('validateUsername', () => {
  it('accepts valid usernames', () => {
    expect(validateUsername('alice_99')).toBeNull();
  });
  it('rejects too short / too long / bad chars', () => {
    expect(validateUsername('ab')).not.toBeNull();
    expect(validateUsername('a'.repeat(21))).not.toBeNull();
    expect(validateUsername('bad name!')).not.toBeNull();
  });
});

describe('extractBearer', () => {
  it('extracts a bearer token', () => {
    expect(extractBearer('Bearer abc123')).toBe('abc123');
    expect(extractBearer('bearer xyz')).toBe('xyz');
  });
  it('returns null for missing/invalid headers', () => {
    expect(extractBearer(null)).toBeNull();
    expect(extractBearer('Basic abc')).toBeNull();
  });
});

describe('register', () => {
  it('creates a user and returns a token', async () => {
    const res = await register(testEnv, 'alice', 'password1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.username).toBe('alice');
      expect(res.value.token).toBeTruthy();
      expect(res.value.userId).toBeTruthy();
    }
  });

  it('rejects duplicate usernames (case-insensitive)', async () => {
    await register(testEnv, 'Bob', 'password1');
    const res = await register(testEnv, 'bob', 'password2');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('username_taken');
  });

  it('rejects weak passwords', async () => {
    const res = await register(testEnv, 'carol', '123');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('invalid_password');
  });
});

describe('login', () => {
  it('logs in with correct credentials', async () => {
    await register(testEnv, 'dave', 'password1');
    const res = await login(testEnv, 'dave', 'password1');
    expect(res.ok).toBe(true);
  });

  it('rejects wrong password', async () => {
    await register(testEnv, 'erin', 'password1');
    const res = await login(testEnv, 'erin', 'wrongpass');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('invalid_credentials');
  });

  it('rejects unknown user', async () => {
    const res = await login(testEnv, 'nobody', 'password1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('invalid_credentials');
  });
});

describe('token resolution', () => {
  it('resolves a user from a valid token', async () => {
    const reg = await register(testEnv, 'frank', 'password1');
    if (!reg.ok) throw new Error('register failed');
    const user = await getUserFromToken(testEnv, reg.value.token);
    expect(user?.username).toBe('frank');
  });

  it('returns null for invalid token', async () => {
    expect(await getUserFromToken(testEnv, 'nope')).toBeNull();
    expect(await getUserFromToken(testEnv, null)).toBeNull();
  });
});

describe('device tokens', () => {
  it('registers and retrieves device tokens for a user', async () => {
    const reg = await register(testEnv, 'grace', 'password1');
    if (!reg.ok) throw new Error('register failed');
    const userId = reg.value.userId;

    const res = await registerDeviceToken(testEnv, userId, 'ExpoPushToken[abc]', 'ios');
    expect(res.ok).toBe(true);

    const tokens = await getDeviceTokensForUsers(testEnv, [userId]);
    expect(tokens).toContain('ExpoPushToken[abc]');
  });

  it('rejects invalid platform', async () => {
    const reg = await register(testEnv, 'heidi', 'password1');
    if (!reg.ok) throw new Error('register failed');
    const res = await registerDeviceToken(testEnv, reg.value.userId, 'tok', 'windows');
    expect(res.ok).toBe(false);
  });

  it('upserts on duplicate expo token (re-points to latest user)', async () => {
    const a = await register(testEnv, 'ivan', 'password1');
    const b = await register(testEnv, 'judy', 'password1');
    if (!a.ok || !b.ok) throw new Error('register failed');

    await registerDeviceToken(testEnv, a.value.userId, 'shared-token', 'android');
    await registerDeviceToken(testEnv, b.value.userId, 'shared-token', 'android');

    const aTokens = await getDeviceTokensForUsers(testEnv, [a.value.userId]);
    const bTokens = await getDeviceTokensForUsers(testEnv, [b.value.userId]);
    expect(aTokens).not.toContain('shared-token');
    expect(bTokens).toContain('shared-token');
  });

  it('returns empty for no user ids', async () => {
    expect(await getDeviceTokensForUsers(testEnv, [])).toEqual([]);
  });
});
