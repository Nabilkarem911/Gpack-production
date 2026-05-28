-- Migration: add account_id FK to pos_terminals so each POS device links to a GL account
ALTER TABLE pos_terminals ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id);
COMMENT ON COLUMN pos_terminals.account_id IS 'Linked GL account for POS settlement (e.g. a bank account)';
