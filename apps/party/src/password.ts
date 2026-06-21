/**
 * Password hashing for the Workers runtime.
 *
 * The legacy backend used bcrypt (passlib), which is unavailable on the
 * Cloudflare Workers runtime. We use PBKDF2 via the Web Crypto API instead.
 *
 * Stored format: `pbkdf2$<iterations>$<saltBase64>$<hashBase64>`
 */

const ITERATIONS = 100_000;
const KEY_LEN_BITS = 256;
const SALT_BYTES = 16;
const HASH_ALGO = 'SHA-256';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveBits(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: HASH_ALGO },
    keyMaterial,
    KEY_LEN_BITS
  );
  return new Uint8Array(bits);
}

/** Hash a plaintext password into the storable string format. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveBits(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** Constant-time comparison of two byte arrays. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Verify a plaintext password against a stored hash string. */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const salt = fromBase64(parts[2]!);
  const expected = fromBase64(parts[3]!);
  const actual = await deriveBits(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}
