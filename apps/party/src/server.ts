/// <reference types="@cloudflare/workers-types" />

/**
 * Worker entry point for the Trap Card Game backend.
 *
 * Responsibilities:
 *  - REST auth API (register / login / me) backed by D1 + KV.
 *  - Device push-token registration.
 *  - Lobby creation (mints a code, provisions the Durable Object).
 *  - PartyServer routing for realtime WebSocket lobby connections.
 *
 * Replaces the FastAPI app, Redis pub/sub, and Postgres entirely.
 */

import { getServerByName, routePartykitRequest } from 'partyserver';
import {
  extractBearer,
  getUserFromToken,
  login,
  register,
  registerDeviceToken,
} from './auth.js';
import { listLobbyHistory } from './history.js';
import { pickUnusedCode } from './lobbyCodes.js';
import type { Env } from './env.js';

export { LobbyDO } from './LobbyDO.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
} as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/**
 * CORS preflight response. Must be bodyless: a 204 carrying a body throws in
 * workerd ("null body status ... cannot have a body"), producing a 500 with no
 * CORS headers that browsers report as "NetworkError when attempting to fetch
 * resource".
 */
function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return preflight();
    }

    // ---- Auth -----------------------------------------------------------
    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      const body = await readJson<{ username?: string; password?: string }>(request);
      if (!body?.username || !body?.password) {
        return json({ error: 'username and password are required' }, 400);
      }
      const res = await register(env, body.username, body.password);
      return res.ok ? json(res.value) : json({ error: res.error.message, code: res.error.code }, res.error.status);
    }

    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      const body = await readJson<{ username?: string; password?: string }>(request);
      if (!body?.username || !body?.password) {
        return json({ error: 'username and password are required' }, 400);
      }
      const res = await login(env, body.username, body.password);
      return res.ok ? json(res.value) : json({ error: res.error.message, code: res.error.code }, res.error.status);
    }

    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      const token = extractBearer(request.headers.get('Authorization'));
      const user = await getUserFromToken(env, token);
      return user ? json(user) : json({ error: 'unauthorized' }, 401);
    }

    // ---- Device push tokens --------------------------------------------
    if (url.pathname === '/api/devices' && request.method === 'POST') {
      const token = extractBearer(request.headers.get('Authorization'));
      const user = await getUserFromToken(env, token);
      if (!user) return json({ error: 'unauthorized' }, 401);
      const body = await readJson<{ expoToken?: string; platform?: string }>(request);
      if (!body?.expoToken || !body?.platform) {
        return json({ error: 'expoToken and platform are required' }, 400);
      }
      const res = await registerDeviceToken(env, user.userId, body.expoToken, body.platform);
      return res.ok ? json(res.value) : json({ error: res.error.message, code: res.error.code }, res.error.status);
    }

    // ---- Lobby history --------------------------------------------------
    if (url.pathname === '/api/lobbies/history' && request.method === 'GET') {
      const token = extractBearer(request.headers.get('Authorization'));
      const user = await getUserFromToken(env, token);
      if (!user) return json({ error: 'unauthorized' }, 401);
      return json({ lobbies: await listLobbyHistory(env, user.userId) });
    }

    // ---- Lobby create ---------------------------------------------------
    if (url.pathname === '/api/lobbies' && request.method === 'POST') {
      const token = extractBearer(request.headers.get('Authorization'));
      const user = await getUserFromToken(env, token);
      if (!user) return json({ error: 'unauthorized' }, 401);

      // Mint a unique code: probe the DO's /create route, which returns
      // created:false when that code already maps to a live (or concluded,
      // not-yet-expired) lobby. getServerByName persists PartyServer's name
      // record so the later WebSocket connect can resolve the lobby.
      //
      // Only a clean created:false counts as a collision (retry another code).
      // A non-ok probe is a DO/transport failure: throw so it surfaces as a 503
      // rather than masquerading as collision exhaustion or escaping the handler
      // as an uncaught (CORS-less) 500.
      try {
        const code = await pickUnusedCode(async (candidate) => {
          const stub = await getServerByName(env.LOBBY, candidate);
          const res = await stub.fetch(
            `https://do/parties/lobby/${candidate}/create`,
            { method: 'POST' }
          );
          if (!res.ok) {
            throw new Error(`lobby create probe failed: ${res.status}`);
          }
          const data = (await res.json()) as { created?: boolean };
          return data.created === true;
        });
        return json({ code, status: 'waiting' });
      } catch {
        return json({ error: 'could not create lobby', code: 'lobby_create_failed' }, 503);
      }
    }

    // ---- PartyServer (WebSocket + DO HTTP) ------------------------------
    const partyResponse = await routePartykitRequest(request, env as unknown as Record<string, unknown>);
    if (partyResponse) return partyResponse;

    return json({ error: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env>;
