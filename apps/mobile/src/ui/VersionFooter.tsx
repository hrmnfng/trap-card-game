/**
 * The running release version, from the ROOT package.json — the single value
 * release.yml gates and tags on. app.config.js injects it as extra.appVersion
 * at config-eval time (dev, APK, PWA export), so the shipped bundle carries
 * only the version string, not the whole root package.json. Shown only on
 * login and Home by design.
 */
import Constants from 'expo-constants';
import { StyleSheet, Text } from 'react-native';
import { colors } from '../lib/theme';

export function VersionFooter() {
  const version: string | undefined = Constants?.expoConfig?.extra?.appVersion;
  if (!version) return null;
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
