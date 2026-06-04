-- Migration 033: Add pricing_status to orders table for manager pricing approval workflow
-- pricing_status: 'pending' = needs manager pricing, 'priced' = manager approved prices

ALTER TABLE orders ADD COLUMN IF NOT EXISTS pricing_status VARCHAR(20) DEFAULT 'priced';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pricing_notes TEXT;

-- Create index for efficient lookup of pending pricing
CREATE INDEX IF NOT EXISTS idx_orders_pricing_status ON orders(pricing_status) WHERE pricing_status = 'pending';
