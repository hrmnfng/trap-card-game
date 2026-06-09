/**
 * React bindings for the vanilla Zustand stores. Components select slices via
 * `useAuth` / `useGame`; the stores themselves stay framework-agnostic so the
 * core remains unit-testable without React.
 */

import { useStore } from 'zustand';
import { authStore, type AuthState } from './auth';
import { gameStore, type GameStoreState } from './game';

export function useAuth<T>(selector: (state: AuthState) => T): T {
  return useStore(authStore, selector);
}

export function useGame<T>(selector: (state: GameStoreState) => T): T {
  return useStore(gameStore, selector);
}
