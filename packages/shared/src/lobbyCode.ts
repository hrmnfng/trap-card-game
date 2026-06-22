/**
 * Lobby code generation + normalization.
 *
 * Uses Crockford's Base32 alphabet (no I, L, O, U) so generated codes have no
 * easily-confused characters and typed codes can be mapped back to canonical
 * form. Single source of truth shared by the Worker (generation) and the mobile
 * client (join-input normalization).
 */

/**
 * Module-scoped type for the Web Crypto global. The shared package compiles with
 * `lib: ["ES2022"]` and no `@types/node`, so `crypto` is otherwise untyped here.
 * Both runtimes that use this code (workerd and Node 18+) expose it globally.
 */
declare const crypto: { getRandomValues<T extends ArrayBufferView>(array: T): T };

/** Crockford Base32: digits + A-Z minus I, L, O, U. */
export const LOBBY_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Length of a freshly generated lobby code. */
export const LOBBY_CODE_LENGTH = 4;

/** Generate a random lobby code (4 chars from the Crockford alphabet). */
export function generateLobbyCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LOBBY_CODE_LENGTH));
  let code = '';
  for (let i = 0; i < LOBBY_CODE_LENGTH; i++) {
    code += LOBBY_CODE_ALPHABET[bytes[i]! % LOBBY_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Normalize a user-typed lobby code to canonical form.
 *
 * Always trims and uppercases. Applies Crockford's confusable mapping
 * (I/L -> 1, O -> 0) only to new-format (4-char) codes: the legacy 6-char
 * alphabet included I/L/O/U, so a legacy code must pass through unchanged or it
 * would resolve to the wrong Durable Object. Accepts any length so legacy codes
 * remain joinable.
 */
export function normalizeLobbyCode(input: string): string {
  const trimmed = input.trim().toUpperCase();
  if (trimmed.length !== LOBBY_CODE_LENGTH) return trimmed;
  return trimmed.replace(/[IL]/g, '1').replace(/O/g, '0');
}
