/**
 * Spinner state around gameStore.refresh() shared by the native
 * RefreshControl and the web RefreshButton. refresh() never rejects, but
 * `finally` keeps the spinner honest even if that ever changes. Hands back
 * the themed RefreshControl element too, so the lobby and game screens don't
 * each copy the tintColor/colors block.
 */
import { useCallback, useState } from 'react';
import { RefreshControl } from 'react-native';
import { colors } from '../lib/theme';
import { gameStore } from '../state/game';

export function useRefresh() {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void gameStore
      .getState()
      .refresh()
      .finally(() => setRefreshing(false));
  }, []);

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.muted}
      colors={[colors.muted]}
    />
  );

  return { refreshing, onRefresh, refreshControl };
}
