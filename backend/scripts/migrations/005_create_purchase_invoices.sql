-- =============================================================================
-- G.PACK 2.0 - Migration 005: Create Purchase Invoices Tables
-- فواتير المشتريات من الموردين
-- =============================================================================

-- =============================================================================
-- Sequence for purchase invoice numbers
-- =============================================================================
CREATE SEQUENCE IF NOT EXISTS purchase_invoice_seq START 1000;

-- =============================================================================
-- Purchase Invoices Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS purchase_invoices (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id         UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    manufacturer_order_id UUID REFERENCES manufacturer_orders(id) ON DELETE SET NULL,
    
    invoice_number      INTEGER NOT NULL UNIQUE DEFAULT nextval('purchase_invoice_seq'),
    invoice_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date          DATE,
    
    supplier_invoice_ref VARCHAR(100), -- رقم فاتورة المورد
    
    subtotal          DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_rate          DECIMAL(5,4) DEFAULT 0.15,
    tax_amount        DECIMAL(15,2) NOT NULL DEFAULT 0,
    grand_total       DECIMAL(15,2) NOT NULL DEFAULT 0,
    paid_amount       DECIMAL(15,2) NOT NULL DEFAULT 0,
    
    status            VARCHAR(20) DEFAULT 'unpaid', -- unpaid, partially_paid, paid, cancelled
    notes             TEXT,
    
    created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier_id ON purchase_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_mo_id ON purchase_invoices(manufacturer_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_status ON purchase_invoices(status);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_invoice_date ON purchase_invoices(invoice_date);

-- =============================================================================
-- Purchase Invoice Items Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS purchase_invoice_items (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_invoice_id UUID NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
    variant_id          UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    
    quantity            DECIMAL(12,3) NOT NULL CHECK (quantity > 0),
    unit_price          DECIMAL(15,4) NOT NULL CHECK (unit_price >= 0),
    line_total          DECIMAL(15,2) NOT NULL DEFAULT 0,
    
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pii_invoice_id ON purchase_invoice_items(purchase_invoice_id);
CREATE INDEX IF NOT EXISTS idx_pii_variant_id ON purchase_invoice_items(variant_id);
