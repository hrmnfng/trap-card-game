/**
 * Async key/value storage abstraction.
 *
 * The core (auth store, session persistence) depends only on this interface,
 * never on Expo. The app entry point injects a concrete implementation backed
 * by `expo-secure-store` (for the auth token) / `AsyncStorage`; unit tests use
 * the in-memory default. This keeps the testable core free of native imports.
 */
export interface KVStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Default in-memory implementation (used by tests and before injection). */
export class MemoryStorage implements KVStorage {
  private readonly map = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.map.delete(key);
  }
}

let current: KVStorage = new MemoryStorage();

/** Replace the process-wide storage implementation (called once at app start). */
export function configureStorage(impl: KVStorage): void {
  current = impl;
}

/** Resolve the active storage implementation. */
export function getStorage(): KVStorage {
  return current;
}
