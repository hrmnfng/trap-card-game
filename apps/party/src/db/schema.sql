-- D1 schema for Trap Card Game.
--
-- Live game state lives inside each Lobby Durable Object's SQLite storage.
-- D1 holds the cross-session, durable account data:
--   * users          - username + password (no email, no recovery)
--   * device_tokens  - Expo push tokens for server-triggered notifications
--   * lobby_history  - per-user summaries of lobbies they participated in
--
-- Apply with:
--   wrangler d1 execute trapcard --local  --file=./src/db/schema.sql
--   wrangler d1 execute trapcard --remote --file=./src/db/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  username_lc   TEXT NOT NULL UNIQUE, -- lower-cased for case-insensitive uniqueness
  password_hash TEXT NOT NULL,        -- format: pbkdf2$<iterations>$<saltB64>$<hashB64>
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expo_token TEXT NOT NULL UNIQUE,
  platform   TEXT NOT NULL,          -- 'ios' | 'android'
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

CREATE TABLE IF NOT EXISTS lobby_history (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  status         TEXT NOT NULL,       -- 'waiting' | 'in-progress' | 'concluded'
  owner_id       TEXT,
  owner_username TEXT,
  player_count   INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  joined_at      TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lobby_history_user ON lobby_history(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lobby_history_user_code ON lobby_history(user_id, code);
