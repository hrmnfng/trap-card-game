/**
 * REST client for the Cloudflare Worker API (auth, lobby creation, device
 * push-token registration). Ports `frontend/src/services/{api,auth}.ts` onto
 * the new Worker contract:
 *
 *  - responses are camelCase (`{ userId, username, token }`), not snake_case;
 *  - errors are `{ error, code }` with a meaningful HTTP status;
 *  - lobby creation returns `{ code, status }` (joining happens over the
 *    WebSocket, so there is no HTTP join/leave/list anymore).
 *
 * `fetch` is global in React Native and Node 18+, and is injectable for tests.
 */

import type { AuthResponse, DevicePlatform, User } from '@trap/shared';
import { config } from './config';

/** Error carrying the Worker's HTTP status and machine-readable `code`. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Supplies the current bearer token for authenticated requests. */
  getToken?: () => string | null;
}

export interface CreateLobbyResponse {
  code: string;
  status: string;
}

/**
 * The global `fetch`, wrapped so it is always invoked as a free function rather
 * than as a method of an `ApiClient` instance. Browsers' WebIDL binding throws
 * "'fetch' called on an object that does not implement interface Window" when
 * `fetch`'s `this` is anything other than the global (Window) — which is what
 * happened when the global was stored on the instance and called as
 * `this.fetchImpl(...)`. Calling bare `fetch(...)` here keeps `this` correct on
 * web, and is a transparent indirection on React Native / Node. The lookup is
 * deferred to call time so a late-installed polyfill is still picked up.
 */
const globalFetch: typeof fetch = (input, init) => fetch(input, init);

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly getToken: () => string | null;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? config.apiBaseUrl;
    this.fetchImpl = options.fetchImpl ?? globalFetch;
    this.getToken = options.getToken ?? (() => null);
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    authenticated = false
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    };
    if (authenticated) {
      const token = this.getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      const message =
        typeof body['error'] === 'string' ? body['error'] : res.statusText;
      const code = typeof body['code'] === 'string' ? body['code'] : undefined;
      throw new ApiError(message, res.status, code);
    }
    return body as T;
  }

  register(username: string, password: string): Promise<AuthResponse> {
    return this.request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  login(username: string, password: string): Promise<AuthResponse> {
    return this.request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  me(): Promise<User> {
    return this.request<User>('/api/auth/me', { method: 'GET' }, true);
  }

  createLobby(): Promise<CreateLobbyResponse> {
    return this.request<CreateLobbyResponse>('/api/lobbies', { method: 'POST' }, true);
  }

  registerDevice(
    expoToken: string,
    platform: DevicePlatform
  ): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      '/api/devices',
      { method: 'POST', body: JSON.stringify({ expoToken, platform }) },
      true
    );
  }
}
