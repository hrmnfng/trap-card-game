/**
 * Web implementation of the `KVStorage` interface. Metro resolves this
 * `.web.ts` file in place of `./expoStorage` for web builds, where
 * `expo-secure-store` has no native module (its web shim is empty and every
 * call throws).
 *
 * The auth token lives in `localStorage`: persistent for installed
 * (home-screen) web apps, cleared when the user removes the icon/site data.
 * Web is served over HTTPS in production, and localStorage is the accepted
 * baseline for browser token storage in this app's threat model.
 */

import type { KVStorage } from './storage';

export const secureStorage: KVStorage = {
  getItem: async (key) => globalThis.localStorage.getItem(key),
  setItem: async (key, value) => {
    globalThis.localStorage.setItem(key, value);
  },
  removeItem: async (key) => {
    globalThis.localStorage.removeItem(key);
  },
};
