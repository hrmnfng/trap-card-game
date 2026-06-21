import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing (PBKDF2 / Web Crypto)', () => {
  it('produces the documented storable format', async () => {
    const hash = await hashPassword('correct horse battery staple');
    const parts = hash.split('$');
    expect(parts[0]).toBe('pbkdf2');
    expect(Number(parts[1])).toBeGreaterThan(0);
    expect(parts).toHaveLength(4);
  });

  it('verifies a correct password', async () => {
    const hash = await hashPassword('s3cret-pass');
    expect(await verifyPassword('s3cret-pass', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('s3cret-pass');
    expect(await verifyPassword('wrong-pass', hash)).toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$1$a$b')).toBe(false);
  });
});
