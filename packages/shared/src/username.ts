/**
 * Username rule — single source of truth.
 *
 * Shared by the auth service (`apps/party/src/auth.ts`) and the operator
 * reset-password CLI (`apps/party/scripts/reset-password.lib.ts`). Keeping one
 * definition prevents the recovery tool from silently diverging: if the two
 * encodings drifted, a legitimately registered user could become unrecoverable
 * because the CLI rejects a username the auth service accepted.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/** Allowed username characters (letters, digits, underscore — no length anchor). */
export const USERNAME_CHARSET_RE = /^[A-Za-z0-9_]+$/;

/** True if `username` satisfies both the length bounds and the allowed charset. */
export function isValidUsername(username: string): boolean {
  return (
    username.length >= USERNAME_MIN_LENGTH &&
    username.length <= USERNAME_MAX_LENGTH &&
    USERNAME_CHARSET_RE.test(username)
  );
}
