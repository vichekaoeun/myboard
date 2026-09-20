-- One-time migration: single board per account -> many boards per account.
-- Run once against an existing database that still uses the old schema
-- (boards.user_id TEXT PRIMARY KEY, payload, updated_at):
--   npx wrangler d1 execute myboard --remote --file=./db/migrate-multiboard.sql
--
-- It rebuilds the table with id/name columns and turns each existing board into
-- a named board owned by the same user (keeping its id so local caches match).

CREATE TABLE IF NOT EXISTS boards_v2 (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT 'Board',
  payload     TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

INSERT OR IGNORE INTO boards_v2 (id, user_id, name, payload, updated_at)
  SELECT user_id, user_id, 'My Board', payload, updated_at FROM boards;

DROP TABLE boards;
ALTER TABLE boards_v2 RENAME TO boards;

CREATE INDEX IF NOT EXISTS idx_boards_user ON boards (user_id);
