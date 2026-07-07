/**
 * Spinner state around gameStore.refresh() shared by the native
 * RefreshControl and the web RefreshButton. refresh() never rejects, but
 * `finally` keeps the spinner honest even if that ever changes.
 */
import { useCallback, useState } from 'react';
import { gameStore } from '../state/game';

export function useRefresh(): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void gameStore
      .getState()
      .refresh()
      .finally(() => setRefreshing(false));
  }, []);
  return { refreshing, onRefresh };
}
