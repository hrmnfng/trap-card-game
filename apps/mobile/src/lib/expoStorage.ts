/**
 * Expo-backed implementation of the `KVStorage` interface, wired into the core
 * at app startup via `configureStorage`. Uses the encrypted secure store for
 * the auth token. This is the only file in the storage path that imports Expo.
 */

import * as SecureStore from 'expo-secure-store';
import type { KVStorage } from './storage';

export const secureStorage: KVStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};
