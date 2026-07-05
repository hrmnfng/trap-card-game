/**
 * Shared per-screen wiring for the three live screens (lobby / prep / game):
 *  - connect the game store when the screen is opened directly (deep link,
 *    reload, or re-entry from Home) and the store isn't already on this code;
 *  - route forward/back when the server status moves on (mirrors the server's
 *    submit gate: an unsubmitted player stays in prep after game start);
 *  - derive `me` from the per-player state.
 * Replaces three verbatim copies of the same two effects. The screen itself
 * still owns its `<Redirect>` for the unauthenticated case (it must render).
 */
import { useEffect } from 'react';
import { router } from 'expo-router';
import { gameStore } from './game';
import { useAuth, useGame } from './hooks';
import { screenForState, type GameScreen } from '../lib/navigation';

export function useLobbyScreen(current: GameScreen, code: string | undefined) {
  const userId = useAuth((s) => s.userId);
  const username = useAuth((s) => s.username);
  const gameState = useGame((s) => s.gameState);
  const lobbyCode = useGame((s) => s.lobbyCode);
  const connectionStatus = useGame((s) => s.connectionStatus);
  const error = useGame((s) => s.error);

  useEffect(() => {
    if (code && userId && username && lobbyCode !== code) {
      gameStore.getState().connect({ code, playerId: userId, username });
    }
  }, [code, userId, username, lobbyCode]);

  const me = gameState?.players.find((p) => p.id === userId);
  const hasSubmitted = me?.hasSubmitted ?? false;

  useEffect(() => {
    if (!gameState || !code) return;
    const target = screenForState(gameState.status, hasSubmitted);
    if (target !== current) router.replace(`/${target}/${code}`);
  }, [gameState?.status, hasSubmitted, code, current]);

  return { userId, username, gameState, me, hasSubmitted, connectionStatus, error };
}
