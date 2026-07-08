-- Migration 038: expand share_token columns to handle encrypted payloads (D-005)
-- Encrypted AES-GCM tokens exceed 100 characters; switch to TEXT for safety.

ALTER TABLE orders
    ALTER COLUMN share_token TYPE TEXT;

ALTER TABLE invoices
    ALTER COLUMN share_token TYPE TEXT;
