import type { RuleDeps } from './gameRules.js';

/**
 * Deterministic RuleDeps for tests: sequential ids and a monotonic clock.
 * Keeps rule tests reproducible.
 */
export function createTestDeps(options?: {
  startId?: number;
  startTimeMs?: number;
}): RuleDeps {
  let idCounter = options?.startId ?? 0;
  let timeMs = options?.startTimeMs ?? Date.parse('2026-01-01T00:00:00.000Z');

  return {
    newId: () => `id-${idCounter++}`,
    now: () => {
      const iso = new Date(timeMs).toISOString();
      timeMs += 1000;
      return iso;
    },
  };
}
