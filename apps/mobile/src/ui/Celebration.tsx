/**
 * One-shot confetti burst for game end. Native only (web is test-only) and
 * pointerEvents:none so it never blocks the "Game over" controls in the e2e.
 */
import { Platform, StyleSheet, View } from 'react-native';
import ConfettiCannon from 'react-native-confetti-cannon';

export function Celebration() {
  if (Platform.OS === 'web') return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <ConfettiCannon
        count={120}
        origin={{ x: -10, y: 0 }}
        fadeOut
        autoStart
        explosionSpeed={350}
        fallSpeed={2600}
      />
    </View>
  );
}
