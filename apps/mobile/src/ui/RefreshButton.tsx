/**
 * Web-only manual refresh affordance: RefreshControl (the native pull
 * gesture) is a no-op on react-native-web, so the PWA gets a button wired to
 * the same refresh. Native renders nothing — the gesture owns it there.
 */
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../lib/theme';

export function RefreshButton({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
}) {
  if (Platform.OS !== 'web') return null;
  return (
    <Pressable
      testID="refresh"
      onPress={onRefresh}
      disabled={refreshing}
      hitSlop={8}
      style={styles.btn}
    >
      <Text style={styles.text}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { alignSelf: 'flex-end' },
  text: { color: colors.muted, fontSize: 13, fontWeight: '600' },
});
