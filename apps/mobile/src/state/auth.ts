/**
 * Authentication store (Zustand). Ports `frontend/src/stores/auth.ts` (Pinia)
 * onto the Worker auth contract.
 *
 * Built as a vanilla store via a factory so it is unit-testable without React:
 * dependencies (API client, token storage) are injectable, and the default
 * singleton wires the real implementations. RN components consume it with
 * `useStore(authStore, selector)`.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AuthResponse } from '@trap/shared';
import { ApiClient } from '../lib/apiClient';
import { getStorage, type KVStorage } from '../lib/storage';

/** Storage key for the persisted bearer token (mirrors the legacy key). */
export const AUTH_TOKEN_KEY = 'trap_card_auth_token';

export interface AuthState {
  userId: string | null;
  username: string | null;
  token: string | null;
  loading: boolean;
  error: string | null;

  register(username: string, password: string): Promise<void>;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** Restore a persisted session by validating the saved token. */
  restoreSession(): Promise<boolean>;
}

export interface AuthStoreDeps {
  api?: ApiClient;
  storage?: KVStorage;
}

/** Derived selector: is the user authenticated? */
export const selectIsAuthenticated = (s: AuthState): boolean =>
  s.userId !== null && s.token !== null;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createAuthStore(deps: AuthStoreDeps = {}): StoreApi<AuthState> {
  const storage = deps.storage ?? getStorage();
  let store: StoreApi<AuthState>;
  const api =
    deps.api ?? new ApiClient({ getToken: () => store.getState().token });

  store = createStore<AuthState>((set) => {
    const applyAuth = async (res: AuthResponse): Promise<void> => {
      await storage.setItem(AUTH_TOKEN_KEY, res.token);
      set({ userId: res.userId, username: res.username, token: res.token });
    };

    const runAuth = async (
      action: () => Promise<AuthResponse>
    ): Promise<void> => {
      set({ loading: true, error: null });
      try {
        await applyAuth(await action());
      } catch (err) {
        set({ error: errorMessage(err) });
        throw err;
      } finally {
        set({ loading: false });
      }
    };

    return {
      userId: null,
      username: null,
      token: null,
      loading: false,
      error: null,

      register: (username, password) =>
        runAuth(() => api.register(username, password)),

      login: (username, password) =>
        runAuth(() => api.login(username, password)),

      async logout() {
        await storage.removeItem(AUTH_TOKEN_KEY);
        set({ userId: null, username: null, token: null, error: null });
      },

      async restoreSession() {
        const token = await storage.getItem(AUTH_TOKEN_KEY);
        if (!token) return false;
        // Set the token first so the API client authenticates the `me` call.
        set({ token });
        try {
          const user = await api.me();
          set({ userId: user.userId, username: user.username, token });
          return true;
        } catch {
          await storage.removeItem(AUTH_TOKEN_KEY);
          set({ userId: null, username: null, token: null });
          return false;
        }
      },
    };
  });

  return store;
}

/** Process-wide auth store used by the app. */
export const authStore = createAuthStore();
