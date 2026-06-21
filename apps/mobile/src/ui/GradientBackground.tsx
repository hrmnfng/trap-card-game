/**
 * Full-screen slow-drifting gradient. Mounted once behind the navigator so every
 * screen shares it. Respects reduce-motion (renders a static gradient then).
 * Animates transform only — safe for the web e2e.
 */
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { gradient } from '../lib/theme';
import { DURATION, useReducedMotion } from './motion';

export function GradientBackground() {
  const reduce = useReducedMotion();

  const Gradient = (
    <LinearGradient
      colors={[...gradient.colors]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.fill}
    />
  );

  if (reduce) {
    return <MotiView pointerEvents="none" style={styles.layer}>{Gradient}</MotiView>;
  }

  return (
    <MotiView
      pointerEvents="none"
      style={styles.layer}
      from={{ translateX: -24, translateY: -16 }}
      animate={{ translateX: 24, translateY: 16 }}
      transition={{ type: 'timing', duration: DURATION.slow, loop: true, repeatReverse: true }}
    >
      {Gradient}
    </MotiView>
  );
}

const styles = StyleSheet.create({
  // Oversized so the drift never reveals an edge.
  layer: { position: 'absolute', top: -60, left: -60, right: -60, bottom: -60 },
  fill: { flex: 1 },
});
