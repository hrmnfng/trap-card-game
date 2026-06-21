import type { RuleDeps } from './gameRules.js';

/**
 * Deterministic RuleDeps for tests: sequential ids, a fixed card value (or a
 * scripted sequence), and a monotonic clock. Keeps rule tests reproducible.
 */
export function createTestDeps(options?: {
  cardValues?: number[];
  startId?: number;
  startTimeMs?: number;
}): RuleDeps {
  let idCounter = options?.startId ?? 0;
  let timeMs = options?.startTimeMs ?? Date.parse('2026-01-01T00:00:00.000Z');
  const values = options?.cardValues ?? [];
  let valueIndex = 0;

  return {
    newId: () => `id-${idCounter++}`,
    randomCardValue: (min, _max) => {
      if (values.length > 0) {
        const v = values[valueIndex % values.length]!;
        valueIndex++;
        return v;
      }
      // Default deterministic value within range.
      return min;
    },
    now: () => {
      const iso = new Date(timeMs).toISOString();
      timeMs += 1000;
      return iso;
    },
  };
}
