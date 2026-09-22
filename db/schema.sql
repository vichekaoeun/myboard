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
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  subscription_status    TEXT,
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

-- Boards: many per account. `user_id` is the owner. A board can be shared via
-- a secret link token; `share_mode` is 'view' (default) or 'edit'.
CREATE TABLE IF NOT EXISTS boards (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT 'Board',
  payload     TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  share_token TEXT,
  share_mode  TEXT NOT NULL DEFAULT 'view'
);

CREATE INDEX IF NOT EXISTS idx_boards_user ON boards (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_share ON boards (share_token) WHERE share_token IS NOT NULL;
