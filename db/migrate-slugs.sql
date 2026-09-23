-- One-time migration: add a stable slug to boards for deep links (/b/<slug>).
-- Existing rows are backfilled lazily by the API (slug is generated on first list).
-- Run once against an existing database:
--   npx wrangler d1 execute myboard --remote --file=./db/migrate-slugs.sql

ALTER TABLE boards ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_slug ON boards (slug) WHERE slug IS NOT NULL;
