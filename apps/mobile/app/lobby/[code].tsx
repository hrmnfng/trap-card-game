import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import * as Clipboard from 'expo-clipboard';
import { gameStore } from '../../src/state/game';
import { colors } from '../../src/lib/theme';
import { Button, LinkButton } from '../../src/ui/Button';
import { Screen } from '../../src/ui/Screen';
import { RefreshButton } from '../../src/ui/RefreshButton';
import { useRefresh } from '../../src/ui/useRefresh';
import { useLobbyScreen } from '../../src/state/useLobbyScreen';

const MIN_PLAYERS = 2;

export default function LobbyScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { userId, gameState, me, connectionStatus, error } = useLobbyScreen('lobby', code);
  const { refreshing, onRefresh } = useRefresh();

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
    <Screen>
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
            : connectionStatus === 'unreachable'
              ? "Can't reach the server — retrying…"
              : `Connection: ${connectionStatus}`}
        </Text>
        <RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
        <Text style={styles.subtle}>This game: {cardsPerPlayer} cards each</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <FlatList
          style={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.muted}
              colors={[colors.muted]}
            />
          }
          data={players}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <View style={styles.playerRow}>
              <Text style={styles.playerName}>
                {item.isOnline ? '🟢 ' : '⚪ '}
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

        <Button
          testID="ready-toggle"
          title={iAmReady ? "I'm not ready" : "I'm ready"}
          variant={iAmReady ? 'surface' : 'accent'}
          style={styles.stackedButton}
          onPress={() => gameStore.getState().setReady(!iAmReady)}
        />

        {isOwner ? (
          <Button
            testID="start-game"
            title={
              canStart
                ? 'Start (author cards)'
                : players.length < MIN_PLAYERS
                  ? `Need ${MIN_PLAYERS}+ players`
                  : 'Waiting for all to ready'
            }
            variant="accent"
            disabled={!canStart}
            style={styles.stackedButton}
            onPress={() => gameStore.getState().startPrep()}
          />
        ) : (
          <Text style={styles.subtle}>Waiting for the host to start…</Text>
        )}

        <LinkButton title="Leave lobby" onPress={leave} />
      </MotiView>
    </Screen>
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
  stackedButton: { marginTop: 8 },
});
