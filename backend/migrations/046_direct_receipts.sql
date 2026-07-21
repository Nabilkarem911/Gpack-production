-- =============================================================================
-- Migration 046: Direct Receipts (استلام مؤقت)
-- Purpose: Allow warehouse keeper to record incoming goods without prior
--          manufacturer order or stock request. Manager reviews and converts
--          to a purchase invoice later.
-- =============================================================================

-- Sequence for receipt numbers
CREATE SEQUENCE IF NOT EXISTS direct_receipt_seq START 1;

-- ── direct_receipts ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS direct_receipts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_number      INTEGER NOT NULL UNIQUE DEFAULT nextval('direct_receipt_seq'),
    has_invoice         BOOLEAN NOT NULL DEFAULT FALSE,
    status              VARCHAR(20) NOT NULL DEFAULT 'pending_review',
    -- pending_review | converted | cancelled
    received_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    received_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    notes               TEXT,
    -- Manager review fields
    supplier_id         UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    supplier_invoice_ref VARCHAR(100),
    supplier_invoice_date DATE,
    warehouse_id        UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    converted_at        TIMESTAMP WITH TIME ZONE,
    purchase_invoice_id UUID REFERENCES purchase_invoices(id) ON DELETE SET NULL,
    converted_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_direct_receipts_status   ON direct_receipts(status);
CREATE INDEX IF NOT EXISTS idx_direct_receipts_received_by ON direct_receipts(received_by);
CREATE INDEX IF NOT EXISTS idx_direct_receipts_received_at ON direct_receipts(received_at);

-- ── direct_receipt_items ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS direct_receipt_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    direct_receipt_id   UUID NOT NULL REFERENCES direct_receipts(id) ON DELETE CASCADE,
    -- Warehouse keeper fields (free text)
    product_name        VARCHAR(255) NOT NULL,
    unit_name           VARCHAR(100) NOT NULL,
    quantity            DECIMAL(12,3) NOT NULL CHECK (quantity > 0),
    product_photo_url   TEXT,
    invoice_photo_url   TEXT,
    notes               TEXT,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    -- Manager review fields (nullable until review)
    variant_id          UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    unit_id             UUID REFERENCES units(id) ON DELETE SET NULL,
    confirmed_quantity  DECIMAL(12,3),
    unit_cost           DECIMAL(15,4),
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_direct_receipt_items_receipt_id ON direct_receipt_items(direct_receipt_id);
CREATE INDEX IF NOT EXISTS idx_direct_receipt_items_variant_id ON direct_receipt_items(variant_id);
