-- =============================================================================
-- Migration 008: Client-Specific Designs System
-- Description: Multi-design support per client/variant with file storage
-- =============================================================================

-- Table: client_designs
-- Stores design metadata for each client+variant combination
CREATE TABLE IF NOT EXISTS client_designs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    design_number INT NOT NULL DEFAULT 1,           -- Sequential: 1, 2, 3...
    design_name VARCHAR(255),                        -- "تصميم الصيف 2025"
    description TEXT,
    is_active BOOLEAN DEFAULT true,                  -- Show in dropdown?
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Each client+variant can have multiple designs numbered sequentially
    UNIQUE(client_id, variant_id, design_number)
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_client_designs_client_variant ON client_designs(client_id, variant_id);
CREATE INDEX IF NOT EXISTS idx_client_designs_variant ON client_designs(variant_id);
CREATE INDEX IF NOT EXISTS idx_client_designs_active ON client_designs(client_id, variant_id, is_active);

-- Table: client_design_files
-- Stores files for each design (thumbnail, pdf, ai, psd)
CREATE TABLE IF NOT EXISTS client_design_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    design_id UUID NOT NULL REFERENCES client_designs(id) ON DELETE CASCADE,
    file_type VARCHAR(50) NOT NULL,                  -- 'thumbnail', 'pdf', 'ai', 'psd', 'image'
    file_path VARCHAR(500) NOT NULL,                 -- Relative path in uploads
    original_name VARCHAR(255),                      -- Original filename
    file_size BIGINT,                               -- Size in bytes
    mime_type VARCHAR(100),
    uploaded_by UUID REFERENCES users(id),
    uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_design_files_design ON client_design_files(design_id);
CREATE INDEX IF NOT EXISTS idx_design_files_type ON client_design_files(design_id, file_type);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_client_designs_updated_at ON client_designs;
CREATE TRIGGER update_client_designs_updated_at
    BEFORE UPDATE ON client_designs 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
