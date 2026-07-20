-- =============================================================================
-- Migration 045: Consolidated Purchase Invoices
-- Purpose: Allow merging multiple draft purchase invoices from the SAME supplier
--          into a single consolidated invoice (e.g. supplier ships goods for
--          multiple clients in one physical invoice).
-- =============================================================================

-- ── 1. Add merged_into_invoice_id to purchase_invoices ───────────────────────
ALTER TABLE purchase_invoices
    ADD COLUMN IF NOT EXISTS merged_into_invoice_id UUID REFERENCES purchase_invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_merged_into
    ON purchase_invoices(merged_into_invoice_id);

-- ── 2. Junction table: purchase_invoice_mo_links ─────────────────────────────
-- Tracks which manufacturer orders are covered by a consolidated invoice.
-- A single consolidated invoice can link to multiple MOs (different client orders).
CREATE TABLE IF NOT EXISTS purchase_invoice_mo_links (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_invoice_id  UUID NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
    manufacturer_order_id UUID NOT NULL REFERENCES manufacturer_orders(id) ON DELETE CASCADE,
    original_invoice_id  UUID REFERENCES purchase_invoices(id) ON DELETE SET NULL,
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(purchase_invoice_id, manufacturer_order_id)
);

CREATE INDEX IF NOT EXISTS idx_piml_purchase_invoice_id
    ON purchase_invoice_mo_links(purchase_invoice_id);

CREATE INDEX IF NOT EXISTS idx_piml_manufacturer_order_id
    ON purchase_invoice_mo_links(manufacturer_order_id);
