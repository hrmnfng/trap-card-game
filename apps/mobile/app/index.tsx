import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MotiView } from 'moti';
import type { LobbyHistoryItem } from '@trap/shared';
import { normalizeLobbyCode } from '@trap/shared';
import { authStore, selectIsAuthenticated } from '../src/state/auth';
import { useAuth } from '../src/state/hooks';
import { api } from '../src/lib/apiSingleton';
import { colors } from '../src/lib/theme';
import { getStorage } from '../src/lib/storage';
import { groupLobbiesByState } from '../src/lib/lobbies';
import { PressableScale } from '../src/ui/PressableScale';
import { Screen } from '../src/ui/Screen';

/** Persisted preference key for whether completed lobbies are revealed. */
const SHOW_COMPLETED_KEY = 'pref_show_completed';

export default function HomeScreen() {
  const isAuthenticated = useAuth(selectIsAuthenticated);
  const username = useAuth((s) => s.username);
  const [joinCode, setJoinCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState<LobbyHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  // Load the persisted "show completed" preference once. Storage may be
  // unavailable on some platforms (e.g. secure-store on the web build), so a
  // failure just leaves the default (hidden) rather than surfacing an error.
  useEffect(() => {
    let active = true;
    void getStorage()
      .getItem(SHOW_COMPLETED_KEY)
      .then((v) => {
        if (active) setShowCompleted(v === '1');
      })
      .catch(() => {
        /* keep default */
      });
    return () => {
      active = false;
    };
  }, []);

  const toggleCompleted = () => {
    setShowCompleted((prev) => {
      const next = !prev;
      void getStorage()
        .setItem(SHOW_COMPLETED_KEY, next ? '1' : '0')
        .catch(() => {
          /* best-effort persistence */
        });
      return next;
    });
  };

  // Fetch (or re-fetch) the lobby history.
  //
  // Two complementary triggers cover every return-to-Home path:
  //   useFocusEffect — fires on initial mount and whenever the screen regains
  //     focus via in-app navigation (e.g. router.replace('/') from Leave).
  //     The callback is recreated when isAuthenticated changes, so a fresh
  //     login also triggers a refetch.
  //   popstate listener — fires when the browser pops a history entry (back /
  //     forward button). Covers WebKit, which does not reliably emit React
  //     Navigation focus events after browser back-navigation.
  // A duplicate fetch when both fire on the same navigation is a cheap
  // idempotent GET.
  const doFetchHistory = useCallback(() => {
    if (!isAuthenticated) return;
    setLoadingHistory(true);
    api
      .listLobbyHistory()
      .then((items) => setHistory(items))
      .catch(() => setHistory([]))
      .finally(() => setLoadingHistory(false));
  }, [isAuthenticated]);

  // Refresh on focus (fires on initial mount and on in-app navigation, e.g.
  // router.replace('/') from Leave). WebKit does not reliably emit focus events
  // after *browser* back-navigation, so a popstate listener below covers that
  // path; between the two, every return to Home refetches. A duplicate fetch
  // when both fire is a cheap idempotent GET.
  useFocusEffect(
    useCallback(() => {
      doFetchHistory();
    }, [doFetchHistory])
  );

  // Re-load on browser back-navigation. The popstate event fires in all engines
  // (including WebKit) when history.go(-1) pops a history entry; we fire
  // unconditionally — a refetch while the screen is hidden is harmless.
  // Web only: on native Hermes `window` exists (it aliases the global) but has
  // no DOM event API, so calling window.addEventListener would crash Home on
  // mount (caught by the Maestro smoke gate).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onPopState = () => {
      doFetchHistory();
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, [doFetchHistory]);

  const openLobby = (item: LobbyHistoryItem) => {
    if (item.status === 'concluded') return;
    router.push(`/lobby/${item.code}`);
  };

  if (!isAuthenticated) {
    return (
      <Screen style={styles.container}>
        <Text style={styles.heading}>Trap Card Game</Text>
        <Text style={styles.subtle}>Sign in to create or join a lobby.</Text>
        <Pressable
          testID="signin-cta"
          style={styles.button}
          onPress={() => router.push('/login')}
        >
          <Text style={styles.buttonText}>Sign in / Register</Text>
        </Pressable>
      </Screen>
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

  const joinLobby = async () => {
    const code = normalizeLobbyCode(joinCode);
    if (code.length === 0) return;
    // Pre-check existence so a typed-in junk code never navigates or opens a
    // socket (which would otherwise reconnect-storm against the server's reject).
    const exists = await api.lobbyExists(code).catch(() => false);
    if (!exists) {
      Alert.alert('Lobby not found', `No lobby exists with code ${code}.`);
      return;
    }
    router.push(`/lobby/${code}`);
  };

  const { active: activeLobbies, completed: completedLobbies } = groupLobbiesByState(history);
  const sections = [
    ...(activeLobbies.length ? [{ key: 'active', title: 'Active', data: activeLobbies }] : []),
    ...(completedLobbies.length
      ? [{ key: 'completed', title: 'Completed', data: showCompleted ? completedLobbies : [] }]
      : []),
  ];

  return (
    <Screen>
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
          <SectionList
            style={styles.list}
            sections={sections}
            keyExtractor={(item) => item.code}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) =>
              section.key === 'completed' ? (
                <Pressable
                  testID="toggle-completed"
                  style={styles.sectionHeaderRow}
                  onPress={toggleCompleted}
                >
                  <Text style={styles.sectionHeader}>Completed</Text>
                  <Text style={styles.sectionToggle}>
                    {showCompleted ? 'Hide' : `Show (${completedLobbies.length})`}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.sectionHeader}>{section.title}</Text>
              )
            }
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
    </Screen>
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
  sectionHeader: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 10,
    marginBottom: 4,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  sectionToggle: { color: colors.primary, fontSize: 13, fontWeight: '600' },
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
