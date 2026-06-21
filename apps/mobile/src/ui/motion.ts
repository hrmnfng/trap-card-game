/**
 * Shared animation tokens and the reduce-motion gate for the src/ui layer.
 * One source of truth so screens animate consistently. Presentational only.
 */
import { useReducedMotion } from 'react-native-reanimated';

export const DURATION = {
  fast: 180,
  base: 260,
  slow: 9000, // gradient drift loop
} as const;

/** Per-card deal stagger (ms). */
export const DEAL_STAGGER = 70;

/** True when the OS "reduce motion" setting is on — callers fall back to static. */
export { useReducedMotion };
