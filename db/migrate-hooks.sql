-- Inbound webhook tokens for "push" chart data sources.
-- Run once against an existing database:
--   npx wrangler d1 execute myboard --remote --file=./db/migrate-hooks.sql

CREATE TABLE IF NOT EXISTS chart_hooks (
  token      TEXT PRIMARY KEY,
  board_id   TEXT NOT NULL,
  chart_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chart_hooks_chart ON chart_hooks (chart_id);
