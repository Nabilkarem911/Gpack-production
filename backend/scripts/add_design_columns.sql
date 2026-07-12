-- Add design columns to manufacturer_order_items
ALTER TABLE manufacturer_order_items ADD COLUMN IF NOT EXISTS design_status VARCHAR(20) DEFAULT 'new';
ALTER TABLE manufacturer_order_items ADD COLUMN IF NOT EXISTS design_id UUID REFERENCES client_designs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_moi_design_id ON manufacturer_order_items(design_id);
