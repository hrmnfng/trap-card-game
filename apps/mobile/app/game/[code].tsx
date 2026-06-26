import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { AnimatePresence, MotiView } from 'moti';
import type { Card } from '@trap/shared';
import { gameStore } from '../../src/state/game';
import { useAuth, useGame } from '../../src/state/hooks';
import { colors } from '../../src/lib/theme';
import { screenForState } from '../../src/lib/navigation';
import { PlayingCard } from '../../src/ui/PlayingCard';
import { Celebration } from '../../src/ui/Celebration';

export default function GameScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const userId = useAuth((s) => s.userId);
  const username = useAuth((s) => s.username);

  const gameState = useGame((s) => s.gameState);
  const lobbyCode = useGame((s) => s.lobbyCode);
  const gameEnded = useGame((s) => s.gameEnded);

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // Reconnect if this screen is opened directly (deep link / reload).
  useEffect(() => {
    if (code && userId && username && lobbyCode !== code) {
      gameStore.getState().connect({ code, playerId: userId, username });
    }
  }, [code, userId, username, lobbyCode]);

  const me = gameState?.players.find((p) => p.id === userId);
  useEffect(() => {
    if (!gameState || !code) return;
    const target = screenForState(gameState.status, me?.hasSubmitted ?? false);
    if (target !== 'game') router.replace(`/${target}/${code}`);
  }, [gameState?.status, me?.hasSubmitted, code]);

  if (!userId) return <Redirect href="/login" />;

  if (!gameState) {
    return (
      <View style={styles.centered}>
        <Text style={styles.subtle}>Loading game…</Text>
      </View>
    );
  }

  const opponents = gameState.players.filter((p) => p.id !== userId);
  const myCards = gameState.myCards;
  const lastPlay = gameState.gameHistory[gameState.gameHistory.length - 1];

  const playOn = (targetPlayerId: string) => {
    if (!selectedCardId) return;
    gameStore.getState().playCard(selectedCardId, targetPlayerId);
    setSelectedCardId(null);
  };

  const leave = () => {
    gameStore.getState().exit();
    router.replace('/');
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.section}>Opponents</Text>
        <Text style={styles.hint}>
          {selectedCardId
            ? 'Tap an opponent to play your selected card.'
            : 'Select a card from your hand first.'}
        </Text>
        {opponents.map((p) => (
          <MotiView
            key={`${p.id}-${lastPlay?.targetId === p.id ? lastPlay.id : 'idle'}`}
            from={{ scale: lastPlay?.targetId === p.id ? 1.08 : 1 }}
            animate={{ scale: 1 }}
            transition={{ type: 'timing', duration: 260 }}
          >
            <Pressable
              testID="opponent"
              style={[styles.opponent, selectedCardId ? styles.opponentArmed : styles.opponentIdle]}
              onPress={() => playOn(p.id)}
              disabled={!selectedCardId}
            >
              <View style={styles.opponentInfo}>
                <Text style={styles.opponentName}>{p.username}</Text>
                <Text style={styles.subtle}>{p.cardsRemaining} cards</Text>
              </View>
              <Text
                style={[styles.opponentAction, !selectedCardId && styles.opponentActionIdle]}
              >
                {selectedCardId ? 'Play here ▸' : 'Select a card first'}
              </Text>
            </Pressable>
          </MotiView>
        ))}

        <Text style={styles.section}>Your hand</Text>
        <View style={styles.hand}>
          <AnimatePresence>
            {myCards.map((card: Card, i: number) => (
              <PlayingCard
                key={card.id}
                statement={card.statement}
                index={i}
                selected={card.id === selectedCardId}
                onPress={() => setSelectedCardId(card.id === selectedCardId ? null : card.id)}
              />
            ))}
          </AnimatePresence>
          {myCards.length === 0 ? (
            <Text style={styles.subtle}>No cards left.</Text>
          ) : null}
        </View>

        <Text style={styles.section}>History</Text>
        {gameState.gameHistory.length === 0 ? (
          <Text style={styles.subtle}>No plays yet.</Text>
        ) : (
          gameState.gameHistory
            .slice()
            .reverse()
            .map((h) => (
              <Text key={h.id} style={styles.historyItem}>
                {h.playerUsername} played "{h.statement ?? '?'}" on{' '}
                {h.targetUsername ?? 'unknown'}
              </Text>
            ))
        )}
      </ScrollView>

      {gameEnded ? (
        <>
          <Celebration />
          <MotiView
            style={styles.endedBanner}
            from={{ opacity: 0, translateY: 24 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 320 }}
          >
            <Text style={styles.endedText}>Game over</Text>
            <Pressable style={styles.button} onPress={leave}>
              <Text style={styles.buttonText}>Back to home</Text>
            </Pressable>
          </MotiView>
        </>
      ) : (
        <Pressable style={styles.linkButton} onPress={leave}>
          <Text style={styles.linkText}>Leave game</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, gap: 8 },
  section: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
  },
  hint: { color: colors.muted, fontSize: 13 },
  opponent: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
    borderWidth: 2,
    borderColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Dimmed + neutral border until a card is selected.
  opponentIdle: { borderColor: colors.border, opacity: 0.55 },
  // Lit up as a tap target once a card is armed (matches the green selected card).
  opponentArmed: { borderColor: colors.accent },
  opponentInfo: { flexShrink: 1 },
  opponentAction: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  opponentActionIdle: { color: colors.muted, fontSize: 13, fontWeight: '400' },
  opponentName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  hand: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  historyItem: { color: colors.muted, fontSize: 14, marginTop: 4 },
  subtle: { color: colors.muted, fontSize: 14 },
  endedBanner: {
    backgroundColor: colors.surface,
    padding: 20,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  endedText: { color: colors.text, fontSize: 20, fontWeight: '700' },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  linkButton: { alignItems: 'center', paddingVertical: 14 },
  linkText: { color: colors.muted, fontSize: 14 },
});
