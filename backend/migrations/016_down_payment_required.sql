-- Migration 016: Add down_payment_required to orders table
-- This allows setting a required down payment/deposit for quotations

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS down_payment_required NUMERIC(12,2) DEFAULT NULL;

COMMENT ON COLUMN orders.down_payment_required IS 'Required down payment amount for quotations (shown in client view and print)';
