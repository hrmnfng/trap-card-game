/**
 * A single hand card showing the player's authored trap statement. Deals in with
 * a staggered fade/slide, lifts when selected, and flips/flies out when played
 * (exit, via AnimatePresence in the parent). Keeps testID="hand-card" so the e2e
 * count assertion still works.
 */
import { Pressable, StyleSheet, Text } from 'react-native';
import { MotiView } from 'moti';
import { colors } from '../lib/theme';
import { DEAL_STAGGER, DURATION } from './motion';

export function PlayingCard({
  statement,
  selected,
  index,
  onPress,
}: {
  statement: string | null;
  selected: boolean;
  index: number;
  onPress: () => void;
}) {
  return (
    <MotiView
      from={{ opacity: 0, translateY: 16, scale: 0.96 }}
      animate={{ opacity: 1, translateY: selected ? -10 : 0, scale: selected ? 1.04 : 1 }}
      exit={{ opacity: 0, translateY: -40, scale: 0.8, rotateY: '90deg' }}
      transition={{ type: 'timing', duration: DURATION.base, delay: index * DEAL_STAGGER }}
    >
      <Pressable
        testID="hand-card"
        onPress={onPress}
        style={[styles.card, selected && styles.cardSelected]}
      >
        <Text style={styles.cardText} numberOfLines={4}>
          {statement ?? '?'}
        </Text>
      </Pressable>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 150,
    minHeight: 90,
    borderRadius: 10,
    backgroundColor: colors.surface,
    padding: 12,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
  },
  cardSelected: { borderColor: colors.accent, backgroundColor: '#22543d' },
  cardText: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
