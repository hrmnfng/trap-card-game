import { useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import { gameStore } from '../../src/state/game';
import { useAuth, useGame } from '../../src/state/hooks';
import { colors } from '../../src/lib/theme';
import { PressableScale } from '../../src/ui/PressableScale';

const MIN_PLAYERS = 2;

export default function LobbyScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const userId = useAuth((s) => s.userId);
  const username = useAuth((s) => s.username);

  const gameState = useGame((s) => s.gameState);
  const connectionStatus = useGame((s) => s.connectionStatus);
  const lobbyCode = useGame((s) => s.lobbyCode);
  const error = useGame((s) => s.error);

  // Connect to the lobby once we know who we are.
  useEffect(() => {
    if (!code || !userId || !username) return;
    if (lobbyCode !== code) {
      gameStore.getState().connect({ code, playerId: userId, username });
    }
  }, [code, userId, username, lobbyCode]);

  // When the owner starts the game, everyone moves to the game screen.
  useEffect(() => {
    if (gameState?.status === 'in-progress' && code) {
      router.replace(`/game/${code}`);
    }
  }, [gameState?.status, code]);

  if (!userId) return <Redirect href="/login" />;

  const players = gameState?.players ?? [];
  const isOwner = gameState?.ownerId === userId;
  const canStart = isOwner && players.length >= MIN_PLAYERS;

  const leave = () => {
    gameStore.getState().leave();
    router.replace('/');
  };

  return (
    <MotiView
      style={styles.container}
      from={{ opacity: 0, translateY: 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 260 }}
    >
      <Text style={styles.code}>Lobby {code}</Text>
      <Text style={styles.status}>
        {connectionStatus === 'open'
          ? `${players.length} player${players.length === 1 ? '' : 's'} waiting`
          : `Connection: ${connectionStatus}`}
      </Text>
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
          </View>
        )}
        ListEmptyComponent={<Text style={styles.subtle}>Waiting for players…</Text>}
      />

      {isOwner ? (
        <PressableScale
          testID="start-game"
          style={[styles.button, !canStart && styles.buttonDisabled]}
          onPress={() => gameStore.getState().startGame()}
          disabled={!canStart}
        >
          <Text style={styles.buttonText}>
            {canStart ? 'Start game' : `Need ${MIN_PLAYERS}+ players`}
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
  status: { color: colors.muted, fontSize: 15 },
  error: { color: colors.danger, fontSize: 14 },
  list: { flexGrow: 0, marginVertical: 8 },
  playerRow: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  playerName: { color: colors.text, fontSize: 16 },
  subtle: { color: colors.muted, fontSize: 14 },
  button: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 'auto',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  linkButton: { alignItems: 'center', paddingVertical: 8 },
  linkText: { color: colors.muted, fontSize: 14 },
});
