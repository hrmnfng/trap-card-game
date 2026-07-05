/**
 * Center-stage reveal for cards played on the viewer (spec decisions 2+3).
 * One pending hit: dimmed overlay, the card flips in large with the
 * attacker's name and sentence. Two or more pending (barrage, or reopening
 * after being away): one coalesced overlay with all cards as a staggered
 * cascade and a single "Got it" dismiss. Pending = hitsOnMe(...) minus a
 * per-lobby persisted seen-count (KVStorage), so a reload after dismissing
 * shows nothing. Under reduce-motion the overlay still appears (it is
 * information), without flip/cascade movement.
 */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MotiView } from 'moti';
import type { GameState } from '@trap/shared';
import { colors } from '../lib/theme';
import { getStorage } from '../lib/storage';
import { hitsOnMe, seenHitsKey } from '../state/game';
import { DURATION, useReducedMotion } from './motion';

export function IncomingReveal({
  lobbyCode,
  playerId,
  gameState,
}: {
  lobbyCode: string;
  playerId: string | null;
  gameState: GameState | null;
}) {
  const reduce = useReducedMotion();
  // null = still loading the persisted count; render nothing until known so a
  // reload never flashes already-seen hits.
  const [seen, setSeen] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void getStorage()
      .getItem(seenHitsKey(lobbyCode))
      .then((v) => {
        if (active) setSeen(v ? Number.parseInt(v, 10) || 0 : 0);
      })
      .catch(() => {
        if (active) setSeen(0);
      });
    return () => {
      active = false;
    };
  }, [lobbyCode]);

  const hits = hitsOnMe(gameState, playerId);
  const pending = seen === null ? [] : hits.slice(seen);
  if (pending.length === 0) return null;

  const dismiss = () => {
    setSeen(hits.length);
    void getStorage()
      .setItem(seenHitsKey(lobbyCode), String(hits.length))
      .catch(() => {
        /* best-effort; worst case the reveal re-shows next visit */
      });
  };

  const single = pending.length === 1;

  return (
    <MotiView
      testID="incoming-reveal"
      style={styles.overlay}
      from={{ opacity: reduce ? 1 : 0 }}
      animate={{ opacity: 1 }}
      transition={{ type: 'timing', duration: DURATION.fast }}
    >
      <Text style={styles.title}>
        {single ? 'A card was played on you' : `${pending.length} cards were played on you`}
      </Text>
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        bounces={false}
      >
        {pending.map((h, i) => (
          <MotiView
            key={h.id}
            from={
              reduce
                ? { opacity: 1 }
                : single
                  ? { opacity: 0, rotateY: '90deg', scale: 0.8 }
                  : { opacity: 0, translateY: 16 }
            }
            animate={
              single
                ? { opacity: 1, rotateY: '0deg', scale: 1 }
                : { opacity: 1, translateY: 0 }
            }
            transition={{
              type: 'timing',
              duration: DURATION.base,
              delay: reduce ? 0 : i * 120,
            }}
            style={[styles.card, single && styles.cardSingle]}
          >
            <Text style={styles.attacker}>{h.playerUsername}</Text>
            <Text style={styles.statement}>{h.statement ?? '?'}</Text>
          </MotiView>
        ))}
      </ScrollView>
      <Pressable testID="incoming-dismiss" style={styles.dismiss} onPress={dismiss}>
        <Text style={styles.dismissText}>Got it</Text>
      </Pressable>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 14, 22, 0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 10,
  },
  title: { color: '#90cdf4', fontSize: 16, fontWeight: '700', marginBottom: 14 },
  list: { alignSelf: 'stretch', flexGrow: 0, maxHeight: 360 },
  listContent: { gap: 10, alignItems: 'center' },
  card: {
    alignSelf: 'stretch',
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    padding: 14,
  },
  cardSingle: { alignSelf: 'center', minWidth: 240, maxWidth: 320 },
  attacker: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  statement: { color: colors.text, fontSize: 16, fontWeight: '600' },
  dismiss: {
    marginTop: 16,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 28,
  },
  dismissText: { color: '#1a202c', fontWeight: '800' },
});
