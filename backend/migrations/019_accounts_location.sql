-- Migration: add location column to accounts for cash box / bank branch info
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS location VARCHAR(200);
COMMENT ON COLUMN accounts.location IS 'Physical location or branch name for cash/bank accounts';
