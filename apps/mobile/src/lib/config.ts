/**
 * Runtime configuration for the mobile client.
 *
 * Expo inlines `EXPO_PUBLIC_*` variables at build time, exposing them on
 * `process.env`. The same lookup works under Node during unit tests, so this
 * module has no Expo dependency. Defaults target a local `wrangler dev`.
 */

function envVar(key: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined;
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}

/** Default `wrangler dev` address for the Worker. */
const DEFAULT_API_BASE_URL = 'http://localhost:8787';
/** Default PartySocket host (host[:port], no scheme). */
const DEFAULT_PARTY_HOST = 'localhost:8787';

export interface AppConfig {
  /** Base URL for the Worker REST API (auth, lobby create, devices). */
  apiBaseUrl: string;
  /** Host (`host` or `host:port`, no scheme) that PartySocket connects to. */
  partyHost: string;
}

export const config: AppConfig = {
  apiBaseUrl: envVar('EXPO_PUBLIC_API_BASE_URL') ?? DEFAULT_API_BASE_URL,
  partyHost: envVar('EXPO_PUBLIC_PARTY_HOST') ?? DEFAULT_PARTY_HOST,
};
