-- =============================================================================
-- Migration 090: Link warehouse sales invoices to delivery notes and stock rows.
-- =============================================================================

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS delivery_note_id UUID REFERENCES delivery_notes(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) NOT NULL DEFAULT 'none';

ALTER TABLE delivery_notes
    ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;

ALTER TABLE invoice_items
    ADD COLUMN IF NOT EXISTS source_stock_id UUID REFERENCES warehouse_stock(id) ON DELETE SET NULL;

ALTER TABLE delivery_note_items
    ADD COLUMN IF NOT EXISTS source_stock_id UUID REFERENCES warehouse_stock(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_warehouse_delivery_note
    ON invoices(delivery_note_id) WHERE delivery_note_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_notes_invoice
    ON delivery_notes(invoice_id) WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_warehouse_delivery_status
    ON invoices(warehouse_id, delivery_status);
