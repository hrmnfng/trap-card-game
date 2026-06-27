/**
 * Screen — a safe-area-aware container so top controls clear the status bar /
 * notch (and bottom controls clear the home indicator). Wraps content in an
 * edges-aware SafeAreaView. Kept transparent so the shared GradientBackground
 * (painted once at the root) shows through. DRY: every route uses this instead
 * of letting content run under the system UI.
 */
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
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
