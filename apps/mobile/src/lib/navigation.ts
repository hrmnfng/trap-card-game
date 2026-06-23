import type { GameState } from '@trap/shared';

export type GameScreen = 'lobby' | 'prep' | 'game';

/**
 * The screen a player should be on for a given lobby status. A player who has
 * not yet submitted their hand stays in prep even after the game starts (the
 * mid-game-join path), mirroring the server's submit gate.
 */
export function screenForState(
  status: GameState['status'],
  hasSubmitted: boolean
): GameScreen {
  switch (status) {
    case 'waiting':
      return 'lobby';
    case 'prep':
      return 'prep';
    case 'in-progress':
      return hasSubmitted ? 'game' : 'prep';
    case 'concluded':
      return 'game';
  }
}
