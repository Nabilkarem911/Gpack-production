-- =============================================================================
-- Migration 013: MO Receipt Sessions
-- Purpose: Track each receiving operation as a reversible "session"
--          so warehouse staff can undo/edit receipts as long as the MO
--          has NOT been fully closed (status != 'received').
-- =============================================================================

-- ── 1. Receipt Sessions header ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mo_receipt_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer_order_id UUID NOT NULL REFERENCES manufacturer_orders(id) ON DELETE CASCADE,
    warehouse_id        UUID NOT NULL REFERENCES warehouses(id),
    received_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    session_number      INTEGER NOT NULL,           -- auto-increment per MO
    subtotal            DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_rate            DECIMAL(5,4)  NOT NULL DEFAULT 0,
    tax_amount          DECIMAL(15,2) NOT NULL DEFAULT 0,
    grand_total         DECIMAL(15,2) NOT NULL DEFAULT 0,
    has_supplier_invoice BOOLEAN DEFAULT FALSE,
    supplier_invoice_ref VARCHAR(100),
    notes               TEXT,
    status              VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | reversed
    purchase_invoice_id UUID REFERENCES purchase_invoices(id),
    accounting_voucher_id UUID REFERENCES accounting_vouchers(id),
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reversed_at         TIMESTAMP WITH TIME ZONE,
    reversed_by         UUID REFERENCES users(id),
    UNIQUE(manufacturer_order_id, session_number)
);

-- ── 2. Receipt Session Items (line-level detail) ──────────────────────────────
CREATE TABLE IF NOT EXISTS mo_receipt_session_items (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id                  UUID NOT NULL REFERENCES mo_receipt_sessions(id) ON DELETE CASCADE,
    manufacturer_order_item_id  UUID NOT NULL REFERENCES manufacturer_order_items(id),
    variant_id                  UUID NOT NULL REFERENCES product_variants(id),
    quantity                    DECIMAL(15,3) NOT NULL,
    unit_cost                   DECIMAL(15,2) NOT NULL DEFAULT 0,
    line_total                  DECIMAL(15,2) NOT NULL DEFAULT 0,
    created_at                  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── 3. Add received_qty column to manufacturer_order_items if missing ─────────
ALTER TABLE manufacturer_order_items
    ADD COLUMN IF NOT EXISTS received_qty DECIMAL(15,3) NOT NULL DEFAULT 0;

-- ── 4. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mo_receipt_sessions_mo_id
    ON mo_receipt_sessions(manufacturer_order_id);

CREATE INDEX IF NOT EXISTS idx_mo_receipt_sessions_status
    ON mo_receipt_sessions(status);

CREATE INDEX IF NOT EXISTS idx_mo_receipt_session_items_session_id
    ON mo_receipt_session_items(session_id);

CREATE INDEX IF NOT EXISTS idx_mo_receipt_session_items_mo_item_id
    ON mo_receipt_session_items(manufacturer_order_item_id);
