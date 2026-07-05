/**
 * Home wordmark (spec decision 4): the tilted exclamation-card glyph floating
 * gently above stacked "TRAP / card game" type. The glyph is drawn with Views
 * (no image asset) so it always matches the theme. Float is transform-only and
 * disabled under reduce-motion. Deliberately NOT the launcher icon's "T!"
 * lettermark — owner kept the card glyph on Home.
 */
import { StyleSheet, Text, View } from 'react-native';
import { MotiView } from 'moti';
import { colors } from '../lib/theme';
import { useReducedMotion } from './motion';

export function Wordmark() {
  const reduce = useReducedMotion();

  const glyph = (
    <View style={styles.glyph}>
      <View style={styles.exBar} />
      <View style={styles.exDot} />
    </View>
  );

  return (
    <View style={styles.wrap} testID="wordmark">
      {reduce ? (
        glyph
      ) : (
        <MotiView
          from={{ translateY: 0, rotate: '-8deg' }}
          animate={{ translateY: -6, rotate: '-4deg' }}
          transition={{ type: 'timing', duration: 2600, loop: true, repeatReverse: true }}
        >
          {glyph}
        </MotiView>
      )}
      <Text style={styles.title}>TRAP</Text>
      <Text style={styles.subtitle}>CARD GAME</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 4, marginBottom: 8 },
  glyph: {
    width: 44,
    height: 62,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
    marginBottom: 6,
  },
  exBar: {
    width: 8,
    height: 24,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginBottom: 5,
  },
  exDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  title: { color: colors.text, fontSize: 34, fontWeight: '800', letterSpacing: 2 },
  subtitle: { color: colors.primary, fontSize: 13, fontWeight: '600', letterSpacing: 6 },
});
