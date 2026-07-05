/**
 * RFC-4122 v4 UUID synthesized from a `getRandomValues`-style byte source
 * (kept Expo-free so it stays unit-testable — see AGENTS.md).
 *
 * Exists because `crypto.randomUUID` is a secure-context-only API: it's absent
 * on a LAN-IP dev origin (http://192.168.x.x), while `getRandomValues` is
 * available everywhere. The polyfill must build UUIDs from the latter — it can
 * never delegate to expo-crypto's web `randomUUID`, which just calls the
 * global `crypto.randomUUID` back (infinite recursion once we've installed it
 * there).
 */
export function uuidV4FromBytes(getRandomValues: (bytes: Uint8Array) => Uint8Array): string {
  const bytes = getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
