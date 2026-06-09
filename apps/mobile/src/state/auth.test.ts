import { describe, it, expect, vi } from 'vitest';
import {
  createAuthStore,
  AUTH_TOKEN_KEY,
  selectIsAuthenticated,
} from './auth';
import { MemoryStorage } from '../lib/storage';
import type { ApiClient } from '../lib/apiClient';

function fakeApi(impl: Partial<ApiClient>): ApiClient {
  return impl as unknown as ApiClient;
}

describe('auth store', () => {
  it('register stores the token and authenticates', async () => {
    const storage = new MemoryStorage();
    const api = fakeApi({
      register: vi
        .fn()
        .mockResolvedValue({ userId: 'u1', username: 'alice', token: 't1' }),
    });
    const store = createAuthStore({ api, storage });

    await store.getState().register('alice', 'password1');

    expect(store.getState()).toMatchObject({
      userId: 'u1',
      username: 'alice',
      token: 't1',
      loading: false,
      error: null,
    });
    expect(selectIsAuthenticated(store.getState())).toBe(true);
    expect(await storage.getItem(AUTH_TOKEN_KEY)).toBe('t1');
  });

  it('login stores the token and authenticates', async () => {
    const storage = new MemoryStorage();
    const api = fakeApi({
      login: vi
        .fn()
        .mockResolvedValue({ userId: 'u2', username: 'bob', token: 't2' }),
    });
    const store = createAuthStore({ api, storage });

    await store.getState().login('bob', 'password1');

    expect(store.getState().token).toBe('t2');
    expect(await storage.getItem(AUTH_TOKEN_KEY)).toBe('t2');
  });

  it('surfaces the error and stays unauthenticated on failure', async () => {
    const storage = new MemoryStorage();
    const api = fakeApi({
      register: vi.fn().mockRejectedValue(new Error('username taken')),
    });
    const store = createAuthStore({ api, storage });

    await expect(store.getState().register('a', 'b')).rejects.toThrow('username taken');

    expect(store.getState().error).toBe('username taken');
    expect(store.getState().loading).toBe(false);
    expect(selectIsAuthenticated(store.getState())).toBe(false);
    expect(await storage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });

  it('logout clears state and persisted token', async () => {
    const storage = new MemoryStorage();
    const api = fakeApi({
      login: vi
        .fn()
        .mockResolvedValue({ userId: 'u1', username: 'alice', token: 't1' }),
    });
    const store = createAuthStore({ api, storage });

    await store.getState().login('alice', 'password1');
    await store.getState().logout();

    expect(selectIsAuthenticated(store.getState())).toBe(false);
    expect(store.getState().token).toBeNull();
    expect(await storage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });

  it('restoreSession returns false when there is no saved token', async () => {
    const storage = new MemoryStorage();
    const api = fakeApi({ me: vi.fn() });
    const store = createAuthStore({ api, storage });

    expect(await store.getState().restoreSession()).toBe(false);
    expect(api.me).not.toHaveBeenCalled();
  });

  it('restoreSession validates a saved token and restores the user', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(AUTH_TOKEN_KEY, 'saved-token');
    const api = fakeApi({
      me: vi.fn().mockResolvedValue({ userId: 'u1', username: 'alice' }),
    });
    const store = createAuthStore({ api, storage });

    expect(await store.getState().restoreSession()).toBe(true);
    expect(store.getState()).toMatchObject({
      userId: 'u1',
      username: 'alice',
      token: 'saved-token',
    });
  });

  it('restoreSession clears an invalid saved token', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(AUTH_TOKEN_KEY, 'stale-token');
    const api = fakeApi({
      me: vi.fn().mockRejectedValue(new Error('unauthorized')),
    });
    const store = createAuthStore({ api, storage });

    expect(await store.getState().restoreSession()).toBe(false);
    expect(selectIsAuthenticated(store.getState())).toBe(false);
    expect(await storage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });
});
