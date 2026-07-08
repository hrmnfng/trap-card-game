/**
 * Spinner state around a refresh action shared by the native RefreshControl
 * and the web RefreshButton. Defaults to gameStore.refresh() (the lobby and
 * game screens' socket round-trip); screens without a socket pass their own
 * promise-returning refetch instead. The action never rejects today, but
 * `finally` keeps the spinner honest even if that ever changes. Hands back
 * the themed RefreshControl element too, so callers don't each copy the
 * tintColor/colors block.
 */
import { useCallback, useState } from 'react';
import { RefreshControl } from 'react-native';
import { colors } from '../lib/theme';
import { gameStore } from '../state/game';

export function useRefresh(refresh?: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void (refresh ? refresh() : gameStore.getState().refresh()).finally(() =>
      setRefreshing(false)
    );
  }, [refresh]);

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
