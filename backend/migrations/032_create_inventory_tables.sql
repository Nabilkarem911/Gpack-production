-- Migration: Create inventory tables if missing (warehouses, warehouse_stock, inventory_transactions)
-- These tables exist in init.sql but may be missing in existing databases

-- Create warehouses table
CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE,
    warehouse_type VARCHAR(50) NOT NULL DEFAULT 'main',
    client_id UUID REFERENCES clients(id),
    address TEXT,
    manager_id UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create warehouse_stock table
CREATE TABLE IF NOT EXISTS warehouse_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID REFERENCES warehouses(id),
    variant_id UUID REFERENCES product_variants(id),
    client_id UUID REFERENCES clients(id),
    quantity DECIMAL(15,3) NOT NULL DEFAULT 0,
    reserved_qty DECIMAL(15,3) DEFAULT 0,
    available_qty DECIMAL(15,3) GENERATED ALWAYS AS (quantity - reserved_qty) STORED,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(warehouse_id, variant_id, client_id)
);

-- Create inventory_transactions table
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_id UUID REFERENCES warehouse_stock(id),
    transaction_type VARCHAR(50) NOT NULL,
    quantity DECIMAL(15,3) NOT NULL,
    variant_id UUID REFERENCES product_variants(id),
    warehouse_from UUID REFERENCES warehouses(id),
    warehouse_to UUID REFERENCES warehouses(id),
    client_id UUID REFERENCES clients(id),
    reference_type VARCHAR(50),
    reference_id UUID,
    notes TEXT,
    delivery_status VARCHAR(50),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default warehouse if none exists
INSERT INTO warehouses (name, code, warehouse_type, status)
SELECT 'المستودع الرئيسي', 'MAIN', 'main', 'active'
WHERE NOT EXISTS (SELECT 1 FROM warehouses);
