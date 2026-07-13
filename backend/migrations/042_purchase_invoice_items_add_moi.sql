-- Add manufacturer_order_item_id to purchase_invoice_items
-- Links each invoice line back to the specific MO item that was received

ALTER TABLE purchase_invoice_items
    ADD COLUMN IF NOT EXISTS manufacturer_order_item_id UUID REFERENCES manufacturer_order_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pii_moi_id ON purchase_invoice_items(manufacturer_order_item_id);
