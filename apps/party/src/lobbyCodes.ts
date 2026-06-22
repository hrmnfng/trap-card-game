import { generateLobbyCode } from '@trap/shared';

/**
 * Allocate a lobby code that is not already in use.
 *
 * `tryReserve(code)` must atomically attempt to claim `code` and resolve `true`
 * only if it was free (i.e. this call created it). At ~1M-code keyspace a
 * collision is vanishingly rare, but a collision would silently reuse a live
 * lobby, so we retry on a clash and fail loudly rather than return a taken code.
 */
export async function pickUnusedCode(
  tryReserve: (code: string) => Promise<boolean>,
  generate: () => string = generateLobbyCode,
  maxTries = 5
): Promise<string> {
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const code = generate();
    if (await tryReserve(code)) return code;
  }
  throw new Error(`could not allocate a unique lobby code after ${maxTries} tries`);
}
