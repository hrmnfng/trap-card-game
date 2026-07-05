import { describe, expect, it } from 'vitest';
import { uuidV4FromBytes } from './uuid';

/**
 * The insecure-context UUID fallback. `crypto.randomUUID` only exists on
 * secure origins (https / localhost), so on a LAN-IP dev origin the polyfill
 * must synthesize v4 UUIDs from `getRandomValues` — which insecure contexts
 * DO provide — without ever calling back into `crypto.randomUUID` (that
 * self-reference is what caused the "too much recursion" crash).
 */
describe('uuidV4FromBytes', () => {
  const filledWith = (value: number) => (bytes: Uint8Array) => {
    bytes.fill(value);
    return bytes;
  };

  it('produces a canonical v4 UUID from random bytes', () => {
    const uuid = uuidV4FromBytes((bytes) => {
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 17 + 3) & 0xff;
      return bytes;
    });
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('forces the version and variant bits even for all-zero bytes', () => {
    expect(uuidV4FromBytes(filledWith(0x00))).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('forces the version and variant bits even for all-ones bytes', () => {
    expect(uuidV4FromBytes(filledWith(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('asks the byte source for exactly 16 bytes and uses them', () => {
    let requested = 0;
    const a = uuidV4FromBytes((bytes) => {
      requested = bytes.length;
      bytes.fill(0xab);
      return bytes;
    });
    const b = uuidV4FromBytes(filledWith(0xab));
    expect(requested).toBe(16);
    expect(a).toBe(b);
  });
});
