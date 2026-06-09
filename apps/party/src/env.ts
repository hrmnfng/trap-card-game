/// <reference types="@cloudflare/workers-types" />

import type { LobbyDO } from './LobbyDO.js';

/** Cloudflare bindings available to the Worker and Durable Objects. */
export interface Env {
  /** D1 database: users, device_tokens, lobby_history. */
  DB: D1Database;
  /** KV namespace storing opaque auth tokens (token -> userId, with TTL). */
  TOKENS: KVNamespace;
  /** Durable Object namespace for lobby rooms. */
  LOBBY: DurableObjectNamespace<LobbyDO>;
  /** Optional: override Expo push endpoint (used in tests). */
  EXPO_PUSH_URL?: string;
}

/** Auth token time-to-live in seconds (mirrors legacy 7-day Redis token). */
export const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
