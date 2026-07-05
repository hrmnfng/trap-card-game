/**
 * Screen — a container that clears the app chrome consistently on every
 * platform. The Stack uses `headerTransparent: true`, so content renders under
 * the navigation header unless each screen pads for it; `useHeaderHeight()` is
 * the real header height (it already includes the status-bar/notch inset, and
 * differs across Android, web, and the installed PWA — which is why hardcoded
 * paddings drifted). On Android the measurement itself misreports under a
 * transparent header, so it's clamped to the platform default via
 * `headerClearance`. Bottom/left/right still come from the safe area. Kept
 * transparent so the shared GradientBackground (painted once at the root)
 * shows through. DRY: every route uses this instead of padding by hand.
 */
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDefaultHeaderHeight, useHeaderHeight } from '@react-navigation/elements';
import { headerClearance } from '../lib/layout';

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const measured = useHeaderHeight();
  const frame = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const headerHeight = headerClearance(
    measured,
    getDefaultHeaderHeight(frame, false, insets.top)
  );
  return (
    <SafeAreaView
      style={[styles.safe, { paddingTop: headerHeight }]}
      edges={['bottom', 'left', 'right']}
    >
      {/* Lift inputs above the soft keyboard (e.g. the join-code field on Home,
          the password field on Login). `undefined` on Android is a no-op, so it
          needs `height` to actually avoid the keyboard there. Inert when no
          keyboard is showing, so screens without inputs are unaffected. */}
      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.body, style]}>{children}</View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  body: { flex: 1 },
});
