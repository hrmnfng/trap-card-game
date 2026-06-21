import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, DarkTheme } from '@react-navigation/native';
import { configureStorage } from '../src/lib/storage';
import { secureStorage } from '../src/lib/expoStorage';
import { authStore } from '../src/state/auth';
import { colors } from '../src/lib/theme';
import { GradientBackground } from '../src/ui/GradientBackground';

// Make the navigator's background transparent so the shared GradientBackground
// shows through. Otherwise React Navigation's default theme paints an opaque
// light-gray (rgb(242,242,242)) over the gradient.
const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: 'transparent' },
};

// Wire the native secure-store implementation before any store reads the
// persisted auth token. Runs once at module load.
configureStorage(secureStorage);

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void authStore
      .getState()
      .restoreSession()
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ThemeProvider value={navTheme}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <GradientBackground />
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: 'transparent' },
            headerTransparent: true,
            headerTintColor: colors.text,
            contentStyle: { backgroundColor: 'transparent' },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Trap Card Game' }} />
          <Stack.Screen name="login" options={{ title: 'Sign in' }} />
          <Stack.Screen name="lobby/[code]" options={{ title: 'Lobby' }} />
          <Stack.Screen name="game/[code]" options={{ title: 'Game' }} />
        </Stack>
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
});
