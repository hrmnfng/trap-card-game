/**
 * The running release version, from the ROOT package.json — the single value
 * release.yml gates and tags on. Metro inlines the JSON at build time on
 * every platform (dev, APK, PWA export), so no CI wiring is needed. Shown
 * only on login and Home by design.
 */
import { StyleSheet, Text } from 'react-native';
import { colors } from '../lib/theme';
import { version } from '../../../../package.json';

export function VersionFooter() {
  return (
    <Text testID="app-version" style={styles.version}>
      v{version}
    </Text>
  );
}

const styles = StyleSheet.create({
  version: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 8,
    opacity: 0.7,
  },
});
