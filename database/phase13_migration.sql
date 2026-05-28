-- =============================================================================
-- Phase 13 Migration: standard_terms table + design_status on order_items
-- Run: docker exec -i gpack_postgres psql -U gpack_user -d gpack_db < database/phase13_migration.sql
-- =============================================================================

-- 1. Standard Terms & Conditions table
CREATE TABLE IF NOT EXISTS standard_terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Design Status column on order_items
-- Values: 'new' (تصميم جديد) or 'reprint' (إعادة طباعة)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS design_status VARCHAR(50) DEFAULT 'new';

-- Done
SELECT 'Phase 13 migration applied successfully.' AS status;
