-- =============================================================================
-- G.PACK 2.0 — Add created_by to products table
-- Enables tracking which user created each product.
-- =============================================================================

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Add index for faster joins
CREATE INDEX IF NOT EXISTS idx_products_created_by
    ON products (created_by);