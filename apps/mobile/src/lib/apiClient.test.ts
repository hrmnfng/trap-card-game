import { describe, it, expect, vi } from 'vitest';
import { ApiClient, ApiError } from './apiClient';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

describe('ApiClient', () => {
  it('register posts credentials and returns the AuthResponse', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ userId: 'u1', username: 'alice', token: 't1' }));
    const api = new ApiClient({ baseUrl: 'https://api.test', fetchImpl });

    const res = await api.register('alice', 'password1');

    expect(res).toEqual({ userId: 'u1', username: 'alice', token: 't1' });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.test/api/auth/register');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      username: 'alice',
      password: 'password1',
    });
    expect(headersOf(init as RequestInit)['Content-Type']).toBe('application/json');
    // No token configured -> no Authorization header.
    expect(headersOf(init as RequestInit)['Authorization']).toBeUndefined();
  });

  it('login posts credentials to the login route', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ userId: 'u1', username: 'alice', token: 't1' }));
    const api = new ApiClient({ baseUrl: 'https://api.test', fetchImpl });

    await api.login('alice', 'password1');

    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.test/api/auth/login');
  });

  it('me attaches the bearer token from getToken', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ userId: 'u1', username: 'alice' }));
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      fetchImpl,
      getToken: () => 'tok-123',
    });

    await api.me();

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.test/api/auth/me');
    expect((init as RequestInit).method).toBe('GET');
    expect(headersOf(init as RequestInit)['Authorization']).toBe('Bearer tok-123');
  });

  it('createLobby is authenticated and returns code/status', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ code: 'ABC123', status: 'waiting' }));
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      fetchImpl,
      getToken: () => 'tok',
    });

    const res = await api.createLobby();

    expect(res).toEqual({ code: 'ABC123', status: 'waiting' });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.test/api/lobbies');
    expect(headersOf(init as RequestInit)['Authorization']).toBe('Bearer tok');
  });

  it('registerDevice posts the expo token and platform', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      fetchImpl,
      getToken: () => 'tok',
    });

    await api.registerDevice('ExpoPushToken[x]', 'ios');

    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.test/api/devices');
    expect(JSON.parse(init.body as string)).toEqual({
      expoToken: 'ExpoPushToken[x]',
      platform: 'ios',
    });
  });

  it('throws ApiError carrying status and code on a non-ok response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: 'username taken', code: 'username_taken' }, 409)
      );
    const api = new ApiClient({ baseUrl: 'https://api.test', fetchImpl });

    await expect(api.register('a', 'b')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'username_taken',
      message: 'username taken',
    });
    await expect(api.register('a', 'b')).rejects.toBeInstanceOf(ApiError);
  });
});
