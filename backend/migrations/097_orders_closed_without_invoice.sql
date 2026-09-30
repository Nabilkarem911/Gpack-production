-- Migration 097: closed_without_invoice flag on orders
-- Storage (VMI) clients withdraw their stock in partial batches over long
-- periods, so their production orders pile up in the "awaiting invoice" tab.
-- This flag moves an order to the Completed tab WITHOUT issuing a final
-- invoice and WITHOUT changing order status: stock movements, delivery notes
-- and later invoicing keep working untouched.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS closed_without_invoice BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id);

COMMENT ON COLUMN orders.closed_without_invoice IS 'Order manually moved to Completed without a final invoice — hidden from awaiting-invoice lists, invoicing stays possible';
