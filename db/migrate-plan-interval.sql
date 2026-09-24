-- Add plan interval + cancel-at-period-end so the UI can show and switch plans.
-- Run once against an existing database:
--   npx wrangler d1 execute myboard --remote --file=./db/migrate-plan-interval.sql

ALTER TABLE users ADD COLUMN plan_interval TEXT;
ALTER TABLE users ADD COLUMN cancel_at_period_end INTEGER DEFAULT 0;
