/**
 * Expo Push notification helper.
 *
 * Sends server-triggered notifications to specific users' devices via the
 * Expo Push API. Used by the Lobby Durable Object when game events occur
 * (card played against you, player joined/left, game started/ended) so that
 * notifications arrive even when the mobile app is closed.
 *
 * Web is test-only and does not receive push notifications.
 */

const DEFAULT_EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface SendPushResult {
  sent: number;
  ok: boolean;
}

/**
 * Send a push notification to a list of Expo push tokens.
 * No-ops (successfully) when there are no tokens.
 */
export async function sendExpoPush(
  tokens: string[],
  payload: PushPayload,
  options?: { url?: string; fetchImpl?: typeof fetch }
): Promise<SendPushResult> {
  if (tokens.length === 0) return { sent: 0, ok: true };

  const url = options?.url ?? DEFAULT_EXPO_PUSH_URL;
  const doFetch = options?.fetchImpl ?? fetch;

  const messages = tokens.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    sound: 'default' as const,
  }));

  const res = await doFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
  });

  return { sent: tokens.length, ok: res.ok };
}
