/**
 * Presentation formatting helpers. Pure and Expo-free so they unit-test under
 * Node (same posture as the rest of src/lib).
 */

/** Compact relative time for timeline rows: now · 7m · 3h · 3d. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
