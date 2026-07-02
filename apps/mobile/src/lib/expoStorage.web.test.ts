import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { secureStorage } from './expoStorage.web';

/**
 * Minimal localStorage stand-in: the vitest environment is node, which has no
 * Web Storage. Only the three methods the backend uses are provided.
 */
function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  } as Storage;
}

describe('web storage backend (localStorage)', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeLocalStorage();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('round-trips a value through localStorage', async () => {
    await secureStorage.setItem('k', 'v');
    expect(await secureStorage.getItem('k')).toBe('v');
  });

  it('returns null for a missing key', async () => {
    expect(await secureStorage.getItem('absent')).toBeNull();
  });

  it('removes a stored value', async () => {
    await secureStorage.setItem('k', 'v');
    await secureStorage.removeItem('k');
    expect(await secureStorage.getItem('k')).toBeNull();
  });
});
