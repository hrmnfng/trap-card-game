import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import * as Clipboard from 'expo-clipboard';
import { gameStore } from '../../src/state/game';
import { useAuth, useGame } from '../../src/state/hooks';
import { colors } from '../../src/lib/theme';
import { PressableScale } from '../../src/ui/PressableScale';
import { screenForState } from '../../src/lib/navigation';

const MIN_PLAYERS = 2;

export default function LobbyScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const userId = useAuth((s) => s.userId);
  const username = useAuth((s) => s.username);

  const gameState = useGame((s) => s.gameState);
  const connectionStatus = useGame((s) => s.connectionStatus);
  const lobbyCode = useGame((s) => s.lobbyCode);
  const error = useGame((s) => s.error);

  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyCode = async () => {
    if (!code) return;
    const ok = await Clipboard.setStringAsync(code);
    if (!ok) return;
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!code || !userId || !username) return;
    if (lobbyCode !== code) {
      gameStore.getState().connect({ code, playerId: userId, username });
    }
  }, [code, userId, username, lobbyCode]);

  // Advance to prep/game when the status moves on.
  const me = gameState?.players.find((p) => p.id === userId);
  useEffect(() => {
    if (!gameState || !code) return;
    const target = screenForState(gameState.status, me?.hasSubmitted ?? false);
    if (target !== 'lobby') router.replace(`/${target}/${code}`);
  }, [gameState?.status, me?.hasSubmitted, code]);

  if (!userId) return <Redirect href="/login" />;

  const players = gameState?.players ?? [];
  const isOwner = gameState?.ownerId === userId;
  const allReady = players.length > 0 && players.every((p) => p.isReady);
  const canStart = isOwner && players.length >= MIN_PLAYERS && allReady;
  const cardsPerPlayer = gameState?.cardsPerPlayer ?? 3;
  const iAmReady = me?.isReady ?? false;

  const leave = () => {
    gameStore.getState().exit();
    router.replace('/');
  };

  return (
    <MotiView
      style={styles.container}
      from={{ opacity: 0, translateY: 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 260 }}
    >
      <Pressable onPress={copyCode} testID="copy-code">
        <Text style={styles.code}>Lobby {code}</Text>
        <Text style={styles.copyHint}>{copied ? 'Copied!' : 'Tap to copy'}</Text>
      </Pressable>
      <Text style={styles.status}>
        {connectionStatus === 'open'
          ? `${players.length} player${players.length === 1 ? '' : 's'} in lobby`
          : `Connection: ${connectionStatus}`}
      </Text>
      <Text style={styles.subtle}>This game: {cardsPerPlayer} cards each</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        style={styles.list}
        data={players}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <View style={styles.playerRow}>
            <Text style={styles.playerName}>
              {item.username}
              {item.id === gameState?.ownerId ? '  (host)' : ''}
              {item.id === userId ? '  (you)' : ''}
            </Text>
            <Text style={item.isReady ? styles.ready : styles.notReady}>
              {item.isReady ? 'Ready' : 'Not ready'}
            </Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.subtle}>Waiting for players…</Text>}
      />

      <PressableScale
        testID="ready-toggle"
        style={[styles.button, iAmReady && styles.buttonSecondary]}
        onPress={() => gameStore.getState().setReady(!iAmReady)}
      >
        <Text style={styles.buttonText}>{iAmReady ? "I'm not ready" : "I'm ready"}</Text>
      </PressableScale>

      {isOwner ? (
        <PressableScale
          testID="start-game"
          style={[styles.button, !canStart && styles.buttonDisabled]}
          onPress={() => gameStore.getState().startPrep()}
          disabled={!canStart}
        >
          <Text style={styles.buttonText}>
            {canStart
              ? 'Start (author cards)'
              : players.length < MIN_PLAYERS
                ? `Need ${MIN_PLAYERS}+ players`
                : 'Waiting for all to ready'}
          </Text>
        </PressableScale>
      ) : (
        <Text style={styles.subtle}>Waiting for the host to start…</Text>
      )}

      <Pressable style={styles.linkButton} onPress={leave}>
        <Text style={styles.linkText}>Leave lobby</Text>
      </Pressable>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  code: { color: colors.text, fontSize: 26, fontWeight: '700', letterSpacing: 2 },
  copyHint: { color: colors.muted, fontSize: 12, marginTop: 2 },
  status: { color: colors.muted, fontSize: 15 },
  error: { color: colors.danger, fontSize: 14 },
  list: { flexGrow: 0, marginVertical: 8 },
  playerRow: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  playerName: { color: colors.text, fontSize: 16 },
  ready: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  notReady: { color: colors.muted, fontSize: 14 },
  subtle: { color: colors.muted, fontSize: 14 },
  button: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonSecondary: { backgroundColor: colors.surface },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  linkButton: { alignItems: 'center', paddingVertical: 8 },
  linkText: { color: colors.muted, fontSize: 14 },
});
