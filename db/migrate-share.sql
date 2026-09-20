-- One-time migration: add share columns to boards.
-- Run once against an existing database:
--   npx wrangler d1 execute myboard --remote --file=./db/migrate-share.sql

ALTER TABLE boards ADD COLUMN share_token TEXT;
ALTER TABLE boards ADD COLUMN share_mode TEXT NOT NULL DEFAULT 'view';
CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_share ON boards (share_token) WHERE share_token IS NOT NULL;
