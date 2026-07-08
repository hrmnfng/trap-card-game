/**
 * The app's standard action button and quiet link-style counterpart.
 * Consolidates the PressableScale + per-screen button styles that five screens
 * hand-rolled (primary vs accent vs surface differed; spacing comes via
 * `style`). Keeps testIDs/labels intact so every e2e selector still works.
 */
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors } from '../lib/theme';
import { PressableScale } from './PressableScale';

export type ButtonVariant = 'primary' | 'accent' | 'surface';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  testID,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const inert = disabled || loading;
  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      disabled={inert}
      style={[styles.base, variants[variant], inert && styles.disabled, style]}
    >
      {loading ? (
        <ActivityIndicator color={colors.primaryText} />
      ) : (
        <Text style={styles.text}>{title}</Text>
      )}
    </PressableScale>
  );
}

export function LinkButton({
  title,
  onPress,
  testID,
  style,
}: {
  title: string;
  onPress?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable testID={testID} style={[styles.link, style]} onPress={onPress}>
      <Text style={styles.linkText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  disabled: { opacity: 0.6 },
  text: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  link: { alignItems: 'center', paddingVertical: 8 },
  linkText: { color: colors.muted, fontSize: 14 },
});

const variants = StyleSheet.create({
  primary: { backgroundColor: colors.primary },
  accent: { backgroundColor: colors.accent },
  surface: { backgroundColor: colors.surface },
});
