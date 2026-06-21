import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MotiView } from 'moti';
import type { LobbyHistoryItem } from '@trap/shared';
import { authStore, selectIsAuthenticated } from '../src/state/auth';
import { useAuth } from '../src/state/hooks';
import { api } from '../src/lib/apiSingleton';
import { colors } from '../src/lib/theme';
import { PressableScale } from '../src/ui/PressableScale';

export default function HomeScreen() {
  const isAuthenticated = useAuth(selectIsAuthenticated);
  const username = useAuth((s) => s.username);
  const [joinCode, setJoinCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState<LobbyHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) return;
      let active = true;
      setLoadingHistory(true);
      api
        .listLobbyHistory()
        .then((items) => {
          if (active) setHistory(items);
        })
        .catch(() => {
          if (active) setHistory([]);
        })
        .finally(() => {
          if (active) setLoadingHistory(false);
        });
      return () => {
        active = false;
      };
    }, [isAuthenticated])
  );

  const openLobby = (item: LobbyHistoryItem) => {
    if (item.status === 'concluded') return;
    router.push(`/lobby/${item.code}`);
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        <Text style={styles.heading}>Trap Card Game</Text>
        <Text style={styles.subtle}>Sign in to create or join a lobby.</Text>
        <Pressable style={styles.button} onPress={() => router.push('/login')}>
          <Text style={styles.buttonText}>Sign in / Register</Text>
        </Pressable>
      </View>
    );
  }

  const createLobby = async () => {
    setCreating(true);
    try {
      const { code } = await api.createLobby();
      router.push(`/lobby/${code}`);
    } catch (err) {
      Alert.alert(
        'Could not create lobby',
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      setCreating(false);
    }
  };

  const joinLobby = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length === 0) return;
    router.push(`/lobby/${code}`);
  };

  return (
    <MotiView
      style={styles.container}
      from={{ opacity: 0, translateY: 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 260 }}
    >
      <Text style={styles.heading}>Welcome, {username}</Text>

      <PressableScale
        testID="create-lobby"
        style={[styles.button, creating && styles.buttonDisabled]}
        onPress={createLobby}
        disabled={creating}
      >
        <Text style={styles.buttonText}>{creating ? 'Creating…' : 'Create lobby'}</Text>
      </PressableScale>

      <Text style={styles.sectionLabel}>Your lobbies</Text>
      {loadingHistory ? (
        <ActivityIndicator color={colors.muted} />
      ) : history.length === 0 ? (
        <Text style={styles.subtle}>No lobbies yet — create or join one below.</Text>
      ) : (
        <FlatList
          style={styles.list}
          data={history}
          keyExtractor={(item) => item.code}
          renderItem={({ item }) => (
            <Pressable
              style={styles.lobbyRow}
              onPress={() => openLobby(item)}
              disabled={item.status === 'concluded'}
            >
              <Text style={styles.lobbyCode}>{item.code}</Text>
              <Text style={styles.lobbyMeta}>
                {item.status} · {item.playerCount} player
                {item.playerCount === 1 ? '' : 's'}
                {item.ownerUsername ? ` · host ${item.ownerUsername}` : ''}
              </Text>
            </Pressable>
          )}
        />
      )}

      <View style={styles.joinRow}>
        <TextInput
          style={styles.input}
          placeholder="Lobby code"
          placeholderTextColor={colors.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          value={joinCode}
          onChangeText={setJoinCode}
        />
        <Pressable testID="join-lobby" style={styles.button} onPress={joinLobby}>
          <Text style={styles.buttonText}>Join</Text>
        </Pressable>
      </View>

      <Pressable
        testID="logout"
        style={styles.linkButton}
        onPress={() => {
          void authStore.getState().logout();
        }}
      >
        <Text style={styles.linkText}>Log out</Text>
      </Pressable>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
  heading: { color: colors.text, fontSize: 28, fontWeight: '700' },
  subtle: { color: colors.muted, fontSize: 16 },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  sectionLabel: { color: colors.text, fontSize: 16, fontWeight: '600', marginTop: 8 },
  list: { flexGrow: 0, maxHeight: 240 },
  lobbyRow: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lobbyCode: { color: colors.text, fontSize: 16, fontWeight: '600', letterSpacing: 1 },
  lobbyMeta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  joinRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  linkButton: { alignItems: 'center', paddingVertical: 8 },
  linkText: { color: colors.muted, fontSize: 14 },
});
