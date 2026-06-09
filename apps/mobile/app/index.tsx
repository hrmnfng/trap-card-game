import { useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { authStore, selectIsAuthenticated } from '../src/state/auth';
import { useAuth } from '../src/state/hooks';
import { api } from '../src/lib/apiSingleton';
import { colors } from '../src/lib/theme';

export default function HomeScreen() {
  const isAuthenticated = useAuth(selectIsAuthenticated);
  const username = useAuth((s) => s.username);
  const [joinCode, setJoinCode] = useState('');
  const [creating, setCreating] = useState(false);

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
    <View style={styles.container}>
      <Text style={styles.heading}>Welcome, {username}</Text>

      <Pressable
        style={[styles.button, creating && styles.buttonDisabled]}
        onPress={createLobby}
        disabled={creating}
      >
        <Text style={styles.buttonText}>{creating ? 'Creating…' : 'Create lobby'}</Text>
      </Pressable>

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
        <Pressable style={styles.button} onPress={joinLobby}>
          <Text style={styles.buttonText}>Join</Text>
        </Pressable>
      </View>

      <Pressable
        style={styles.linkButton}
        onPress={() => {
          void authStore.getState().logout();
        }}
      >
        <Text style={styles.linkText}>Log out</Text>
      </Pressable>
    </View>
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
