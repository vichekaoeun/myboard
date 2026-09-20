-- One-time migration: add plan/entitlement columns to users.
-- Run once against an existing database:
--   npx wrangler d1 execute myboard --remote --file=./db/migrate-plans.sql

ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN plan_renews_at INTEGER;
