/**
 * A single hand card. Deals in with a staggered fade/slide, lifts when selected,
 * and flips/flies out when played (exit, via AnimatePresence in the parent).
 * Keeps testID="hand-card" so the e2e count assertion still works.
 */
import { Pressable, StyleSheet, Text } from 'react-native';
import { MotiView } from 'moti';
import { colors } from '../lib/theme';
import { DEAL_STAGGER, DURATION } from './motion';

export function PlayingCard({
  value,
  selected,
  index,
  onPress,
}: {
  value: number | null;
  selected: boolean;
  index: number;
  onPress: () => void;
}) {
  return (
    <MotiView
      from={{ opacity: 0, translateY: 16, scale: 0.96 }}
      animate={{ opacity: 1, translateY: selected ? -10 : 0, scale: selected ? 1.06 : 1 }}
      exit={{ opacity: 0, translateY: -40, scale: 0.8, rotateY: '90deg' }}
      transition={{ type: 'timing', duration: DURATION.base, delay: index * DEAL_STAGGER }}
    >
      <Pressable
        testID="hand-card"
        onPress={onPress}
        style={[styles.card, selected && styles.cardSelected]}
      >
        <Text style={styles.cardValue}>{value ?? '?'}</Text>
      </Pressable>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 56,
    height: 80,
    borderRadius: 8,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
  },
  cardSelected: { borderColor: colors.accent, backgroundColor: '#22543d' },
  cardValue: { color: colors.text, fontSize: 24, fontWeight: '700' },
});
