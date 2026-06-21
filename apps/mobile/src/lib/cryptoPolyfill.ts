/**
 * Polyfill the global `crypto` for Hermes (React Native).
 *
 * `partysocket` calls `crypto.randomUUID()` when it opens a connection (i.e. on
 * entering a game/lobby). Hermes has no `crypto` global, so the bare reference
 * throws `ReferenceError: Property 'crypto' doesn't exist` — optional chaining
 * (`crypto?.randomUUID`) does NOT guard an *undeclared* identifier, only
 * null/undefined on a declared one. `expo-crypto` provides a real Web-Crypto
 * implementation that works in Expo Go and on web.
 *
 * Conditional, so it is a no-op where a real `crypto` already exists (the web
 * build, Node/vitest). Imported once at the app entry (`app/_layout.tsx`); it
 * lives outside the Expo-free `src/lib` core surface that the unit tests import,
 * because it pulls in `expo-crypto`.
 */
import { getRandomValues, randomUUID } from 'expo-crypto';

const g = globalThis as unknown as {
  crypto?: {
    randomUUID?: typeof randomUUID;
    getRandomValues?: typeof getRandomValues;
  };
};

if (!g.crypto) {
  g.crypto = { randomUUID, getRandomValues };
} else {
  if (!g.crypto.randomUUID) g.crypto.randomUUID = randomUUID;
  if (!g.crypto.getRandomValues) g.crypto.getRandomValues = getRandomValues;
}
