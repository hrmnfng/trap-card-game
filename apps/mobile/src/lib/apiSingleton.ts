/**
 * Process-wide API client for authenticated, non-auth calls (lobby creation,
 * device push-token registration). It reads the current bearer token from the
 * auth store, so it stays in sync after login/logout.
 *
 * The auth store keeps its own internal client for register/login/me; this
 * singleton imports the store (one-way), avoiding an import cycle.
 */

import { ApiClient } from './apiClient';
import { authStore } from '../state/auth';

export const api = new ApiClient({
  getToken: () => authStore.getState().token,
});
