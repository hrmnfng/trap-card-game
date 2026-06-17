import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { router } from 'expo-router';
import { MotiView } from 'moti';
import { authStore } from '../src/state/auth';
import { useAuth } from '../src/state/hooks';
import { api } from '../src/lib/apiSingleton';
import { registerForPushNotifications } from '../src/lib/push';
import { colors } from '../src/lib/theme';
import { PressableScale } from '../src/ui/PressableScale';

type Mode = 'login' | 'register';

export default function LoginScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const loading = useAuth((s) => s.loading);
  const error = useAuth((s) => s.error);

  const submit = async () => {
    const { login, register } = authStore.getState();
    const action = mode === 'login' ? login : register;
    try {
      await action(username.trim(), password);
      // Register for push in the background; failure must not block entry.
      void registerForPushNotifications(api).catch(() => undefined);
      router.replace('/');
    } catch {
      // Error is surfaced from the store's `error` state.
    }
  };

  return (
    <MotiView
      style={styles.container}
      from={{ opacity: 0, translateY: 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 260 }}
    >
      <Text style={styles.heading}>
        {mode === 'login' ? 'Sign in' : 'Create an account'}
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Username"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        value={username}
        onChangeText={setUsername}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={colors.muted}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <PressableScale
        testID="auth-submit"
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={submit}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={colors.primaryText} />
        ) : (
          <Text style={styles.buttonText}>
            {mode === 'login' ? 'Sign in' : 'Register'}
          </Text>
        )}
      </PressableScale>

      <Pressable
        testID="auth-toggle"
        style={styles.linkButton}
        onPress={() => setMode(mode === 'login' ? 'register' : 'login')}
      >
        <Text style={styles.linkText}>
          {mode === 'login'
            ? "Don't have an account? Register"
            : 'Already have an account? Sign in'}
        </Text>
      </Pressable>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '700' },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  error: { color: colors.danger, fontSize: 14 },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  linkButton: { alignItems: 'center', paddingVertical: 8 },
  linkText: { color: colors.muted, fontSize: 14 },
});
