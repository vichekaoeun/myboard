-- Cloudflare D1 schema for SimpleBoard (run once, locally and in production).
--   local:  npx wrangler d1 execute myboard --local  --file=./db/schema.sql
--   remote: npx wrangler d1 execute myboard --remote --file=./db/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT,
  picture     TEXT,
  provider    TEXT NOT NULL DEFAULT 'email',
  plan        TEXT NOT NULL DEFAULT 'free',
  plan_renews_at INTEGER,
  created_at  INTEGER NOT NULL
);

-- One-time magic-link tokens (store only the hash, never the raw token).
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_tokens_email ON login_tokens (email);

-- Boards: many per account. `user_id` is the owner.
CREATE TABLE IF NOT EXISTS boards (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT 'Board',
  payload     TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_boards_user ON boards (user_id);
