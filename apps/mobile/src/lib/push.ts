/**
 * Expo push-notification registration. After login the app calls
 * `registerForPushNotifications`, which obtains an Expo push token and stores it
 * server-side (`POST /api/devices`) so the LobbyDO can notify this user even
 * when the app is backgrounded.
 *
 * Notes:
 *  - Push requires a physical device and an Expo Dev Build (not Expo Go).
 *  - No-ops on web and simulators (no token available there).
 */

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import type { DevicePlatform } from '@trap/shared';
import type { ApiClient } from './apiClient';
import Constants from 'expo-constants'

export async function registerForPushNotifications(
  api: ApiClient
): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  if (!granted) return null;

  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
  if (!projectId) return null; // not an EAS build
  const { data: expoToken } = await Notifications.getExpoPushTokenAsync({ projectId });
  const platform: DevicePlatform = Platform.OS === 'ios' ? 'ios' : 'android';
  await api.registerDevice(expoToken, platform);
  return expoToken;
}
