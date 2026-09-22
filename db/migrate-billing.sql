-- One-time migration: add Stripe billing columns to users.
-- Run once against an existing database:
--   npx wrangler d1 execute myboard --remote --file=./db/migrate-billing.sql

ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE users ADD COLUMN subscription_status TEXT;
