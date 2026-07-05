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
 * Conditional, so it is a no-op where a complete `crypto` already exists (the
 * web build on a secure origin, Node/vitest). On an INSECURE web origin (a
 * LAN-IP dev URL) `crypto` exists but `randomUUID` doesn't — it's a
 * secure-context-only API — and expo-crypto's web `randomUUID` can't fill the
 * gap because it just calls the global `crypto.randomUUID` back (installing it
 * there recursed until the stack blew). So `randomUUID` is always synthesized
 * from `getRandomValues`, which every context provides (natively on web,
 * via expo-crypto on Hermes). Imported once at the app entry
 * (`app/_layout.tsx`); it lives outside the Expo-free `src/lib` core surface
 * that the unit tests import, because it pulls in `expo-crypto`.
 */
import { getRandomValues } from 'expo-crypto';
import { uuidV4FromBytes } from './uuid';

const g = globalThis as unknown as {
  crypto?: {
    randomUUID?: () => string;
    getRandomValues?: typeof getRandomValues;
  };
};

if (!g.crypto) g.crypto = {};
if (!g.crypto.getRandomValues) g.crypto.getRandomValues = getRandomValues;
if (!g.crypto.randomUUID) {
  // Bind: the browser-native getRandomValues throws "Illegal invocation"
  // when called detached from its `crypto` receiver.
  const fill = g.crypto.getRandomValues.bind(g.crypto);
  g.crypto.randomUUID = () => uuidV4FromBytes(fill);
}
