/**
 * Compact in-game history timeline (spec decision 6): dense one-liners —
 * `attacker ▸ target — "truncated sentence"` with a time-ago column — that
 * expand on tap to show the full sentence. Plays targeting the viewer are
 * tinted. Newest first. Pure presentation: no store access, no Expo imports.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GameHistoryItem } from '@trap/shared';
import { colors } from '../lib/theme';
import { timeAgo } from '../lib/format';

export function HistoryTimeline({
  items,
  myPlayerId,
}: {
  items: GameHistoryItem[];
  myPlayerId: string | null;
}) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());

  if (items.length === 0) {
    return <Text style={styles.empty}>No plays yet.</Text>;
  }

  const toggle = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <View>
      {items
        .slice()
        .reverse()
        .map((h) => {
          const onMe = h.targetId != null && h.targetId === myPlayerId;
          const expanded = expandedIds.has(h.id);
          return (
            <Pressable
              key={h.id}
              testID="history-item"
              onPress={() => toggle(h.id)}
              style={[styles.row, onMe && styles.rowOnMe]}
            >
              <Text style={styles.time}>{timeAgo(h.timestamp)}</Text>
              <Text
                style={[styles.line, onMe && styles.lineOnMe]}
                numberOfLines={expanded ? undefined : 1}
              >
                <Text style={styles.who}>{h.playerUsername}</Text>
                {' ▸ '}
                <Text style={[styles.who, onMe && styles.whoOnMe]}>
                  {onMe ? 'you' : h.targetUsername ?? 'unknown'}
                </Text>
                {' — '}
                {`"${h.statement ?? '?'}"`}
              </Text>
            </Pressable>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.muted, fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  rowOnMe: { borderBottomColor: '#742a2a' },
  time: { color: colors.muted, fontSize: 11, width: 32 },
  line: { color: colors.text, fontSize: 13, flex: 1 },
  lineOnMe: { color: '#feb2b2' },
  who: { fontWeight: '700' },
  whoOnMe: { color: '#fc8181' },
});
