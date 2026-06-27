import { useEffect, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { MAX_STATEMENT_LENGTH } from '@trap/shared';
import { gameStore } from '../../src/state/game';
import { useAuth, useGame } from '../../src/state/hooks';
import { colors } from '../../src/lib/theme';
import { PressableScale } from '../../src/ui/PressableScale';
import { screenForState } from '../../src/lib/navigation';

export default function PrepScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const userId = useAuth((s) => s.userId);
  const username = useAuth((s) => s.username);

  const gameState = useGame((s) => s.gameState);
  const lobbyCode = useGame((s) => s.lobbyCode);
  const error = useGame((s) => s.error);

  const cardsPerPlayer = gameState?.cardsPerPlayer ?? 3;
  const [statements, setStatements] = useState<string[]>([]);

  // Keep the input array sized to cardsPerPlayer.
  useEffect(() => {
    setStatements((prev) => {
      if (prev.length === cardsPerPlayer) return prev;
      const next = prev.slice(0, cardsPerPlayer);
      while (next.length < cardsPerPlayer) next.push('');
      return next;
    });
  }, [cardsPerPlayer]);

  // Reconnect if opened directly.
  useEffect(() => {
    if (code && userId && username && lobbyCode !== code) {
      gameStore.getState().connect({ code, playerId: userId, username });
    }
  }, [code, userId, username, lobbyCode]);

  const me = gameState?.players.find((p) => p.id === userId);
  const hasSubmitted = me?.hasSubmitted ?? false;

  // Route forward/back when status changes (game start, or back to lobby).
  useEffect(() => {
    if (!gameState || !code) return;
    const target = screenForState(gameState.status, hasSubmitted);
    if (target !== 'prep') router.replace(`/${target}/${code}`);
  }, [gameState?.status, hasSubmitted, code]);

  if (!userId) return <Redirect href="/login" />;

  const players = gameState?.players ?? [];
  const isOwner = gameState?.ownerId === userId;
  const allSubmitted = players.length > 0 && players.every((p) => p.hasSubmitted);
  const trimmed = statements.map((s) => s.trim());
  const allValid =
    trimmed.length === cardsPerPlayer &&
    trimmed.every((s) => s.length > 0 && s.length <= MAX_STATEMENT_LENGTH);

  const setAt = (i: number, value: string) =>
    setStatements((prev) => prev.map((s, idx) => (idx === i ? value : s)));

  const submit = () => {
    if (!allValid || hasSubmitted) return;
    gameStore.getState().submitCards(trimmed);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Author your traps</Text>
        <Text style={styles.subtle}>
          Write {cardsPerPlayer} trap statements. They lock once you submit.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {statements.map((value, i) => (
          <View key={i} style={styles.inputBlock}>
            <TextInput
              testID={`statement-${i}`}
              style={[styles.input, hasSubmitted && styles.inputLocked]}
              value={value}
              onChangeText={(t) => setAt(i, t)}
              editable={!hasSubmitted}
              placeholder={`Trap ${i + 1} (e.g. "checks their phone")`}
              placeholderTextColor={colors.muted}
              maxLength={MAX_STATEMENT_LENGTH}
              multiline
            />
            <Text style={styles.counter}>
              {value.trim().length}/{MAX_STATEMENT_LENGTH}
            </Text>
          </View>
        ))}

        {hasSubmitted ? (
          <Text style={styles.submitted}>Submitted ✓</Text>
        ) : (
          <PressableScale
            testID="submit-cards"
            style={[styles.button, !allValid && styles.buttonDisabled]}
            onPress={submit}
            disabled={!allValid}
          >
            <Text style={styles.buttonText}>Submit cards</Text>
          </PressableScale>
        )}

        <Text style={styles.section}>Players</Text>
        <FlatList
          scrollEnabled={false}
          data={players}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <View style={styles.playerRow}>
              <Text style={styles.playerName}>
                {item.isOnline ? '🟢 ' : '⚪ '}
                {item.username}
                {item.id === userId ? '  (you)' : ''}
              </Text>
              <Text style={item.hasSubmitted ? styles.ready : styles.notReady}>
                {item.hasSubmitted ? 'Submitted' : 'Writing…'}
              </Text>
            </View>
          )}
        />
      </ScrollView>

      {isOwner ? (
        <PressableScale
          testID="begin-game"
          style={[styles.button, styles.beginButton, !allSubmitted && styles.buttonDisabled]}
          onPress={() => gameStore.getState().startGame()}
          disabled={!allSubmitted}
        >
          <Text style={styles.buttonText}>
            {allSubmitted ? 'Begin game' : 'Waiting for all to submit'}
          </Text>
        </PressableScale>
      ) : (
        <Text style={styles.subtleFooter}>Waiting for the host to begin…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 20, gap: 10 },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  subtle: { color: colors.muted, fontSize: 14 },
  subtleFooter: { color: colors.muted, fontSize: 14, textAlign: 'center', padding: 14 },
  error: { color: colors.danger, fontSize: 14 },
  inputBlock: { marginTop: 8 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    padding: 12,
    minHeight: 48,
  },
  inputLocked: { opacity: 0.6 },
  counter: { color: colors.muted, fontSize: 11, textAlign: 'right', marginTop: 2 },
  submitted: { color: colors.accent, fontSize: 16, fontWeight: '700', marginTop: 8 },
  section: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 20 },
  playerRow: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  playerName: { color: colors.text, fontSize: 15 },
  ready: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  notReady: { color: colors.muted, fontSize: 14 },
  button: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  beginButton: { margin: 16, marginTop: 0 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
});
