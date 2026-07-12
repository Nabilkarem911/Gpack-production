-- =============================================================================
-- G.PACK 2.0 - Migration 002: Create Manufacturer Orders Tables
-- Phase 19: Production Orders Management Module
-- =============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- Suppliers/Manufacturers Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS suppliers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    type            VARCHAR(50) DEFAULT 'manufacturer', -- 'manufacturer', 'vendor', 'both'
    contact_person  VARCHAR(255),
    phone           VARCHAR(50),
    email           VARCHAR(255),
    address         TEXT,
    notes           TEXT,
    status          VARCHAR(20) DEFAULT 'active', -- 'active', 'inactive'
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);
CREATE INDEX IF NOT EXISTS idx_suppliers_type ON suppliers(type);

-- =============================================================================
-- Manufacturer Orders Table (POs to suppliers)
-- =============================================================================
CREATE TABLE IF NOT EXISTS manufacturer_orders (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    supplier_id         UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    po_number           VARCHAR(50) NOT NULL UNIQUE,
    status              VARCHAR(20) DEFAULT 'pending', -- 'pending', 'ordered', 'received', 'cancelled'
    order_date          DATE DEFAULT CURRENT_DATE,
    expected_delivery   DATE,
    actual_delivery     DATE,
    notes               TEXT,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_manufacturer_orders_order_id ON manufacturer_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_manufacturer_orders_supplier_id ON manufacturer_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_manufacturer_orders_status ON manufacturer_orders(status);
CREATE INDEX IF NOT EXISTS idx_manufacturer_orders_po_number ON manufacturer_orders(po_number);

-- =============================================================================
-- Manufacturer Order Items Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS manufacturer_order_items (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    manufacturer_order_id   UUID NOT NULL REFERENCES manufacturer_orders(id) ON DELETE CASCADE,
    order_item_id           UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
    quantity                INTEGER NOT NULL CHECK (quantity > 0),
    mo_quantity             INTEGER NOT NULL CHECK (mo_quantity > 0),
    unit_cost               NUMERIC(12,2) DEFAULT 0,
    line_total              NUMERIC(12,2) DEFAULT 0,
    received_qty            INTEGER DEFAULT 0 CHECK (received_qty >= 0),
    design_status           VARCHAR(20) DEFAULT 'new', -- 'new', 'reprint', 'redesign'
    design_id               UUID REFERENCES client_designs(id) ON DELETE SET NULL,
    notes                   TEXT,
    created_at              TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_moi_manufacturer_order_id ON manufacturer_order_items(manufacturer_order_id);
CREATE INDEX IF NOT EXISTS idx_moi_order_item_id ON manufacturer_order_items(order_item_id);
CREATE INDEX IF NOT EXISTS idx_moi_design_id ON manufacturer_order_items(design_id);

-- Add design_status and design_id columns if table already exists (migration safety)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'manufacturer_order_items'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'manufacturer_order_items' AND column_name = 'design_status'
        ) THEN
            ALTER TABLE manufacturer_order_items ADD COLUMN design_status VARCHAR(20) DEFAULT 'new';
        END IF;
        
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'manufacturer_order_items' AND column_name = 'design_id'
        ) THEN
            ALTER TABLE manufacturer_order_items ADD COLUMN design_id UUID REFERENCES client_designs(id) ON DELETE SET NULL;
        END IF;
    END IF;
END $$;

-- =============================================================================
-- Add manufacturer_po_qty tracking column to order_items (if not exists)
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'order_items' AND column_name = 'manufacturer_po_qty'
    ) THEN
        ALTER TABLE order_items ADD COLUMN manufacturer_po_qty INTEGER DEFAULT 0;
    END IF;
END $$;

-- =============================================================================
-- Sequence for PO numbers (if not exists)
-- =============================================================================
CREATE SEQUENCE IF NOT EXISTS manufacturer_po_seq START 1;

-- =============================================================================
-- Add tax_rate column to manufacturer_orders (if not exists)
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'manufacturer_orders' AND column_name = 'tax_rate'
    ) THEN
        ALTER TABLE manufacturer_orders ADD COLUMN tax_rate DECIMAL(5,4) DEFAULT 0;
    END IF;
END $$;

-- =============================================================================
-- Insert sample suppliers (optional - for testing)
-- =============================================================================
INSERT INTO suppliers (name, type, contact_person, phone, email, status) VALUES
    ('مطبعة النصر', 'manufacturer', 'أحمد محمد', '0501234567', 'ahmed@nasr.com', 'active'),
    ('مصنع التقنية للتغليف', 'manufacturer', 'خالد عبدالله', '0509876543', 'khaled@tech.com', 'active'),
    ('شركة الورق الذهبي', 'vendor', 'سالم سعيد', '0555555555', 'salem@gold.com', 'active')
ON CONFLICT DO NOTHING;
