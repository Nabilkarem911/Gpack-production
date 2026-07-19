-- =============================================================================
-- MIGRATION 001: Add product_sku_seq and backfill SKUs for existing products
-- Format: PRD-00001, PRD-00002, ...
-- Run on VPS: docker exec <postgres_container> psql -U <user> -d <db> -f /path/to/001_add_product_sku_seq.sql
-- Or: psql -U <user> -d <db> -f backend/migrations/001_add_product_sku_seq.sql
-- =============================================================================

-- 1. Create the sequence (safe if already exists)
CREATE SEQUENCE IF NOT EXISTS product_sku_seq START WITH 1 INCREMENT BY 1;

-- 2. Backfill SKUs for products that have NULL sku
--    Order by created_at so oldest products get lowest numbers
UPDATE products
SET sku = 'PRD-' || LPAD(nextval('product_sku_seq')::TEXT, 5, '0')
WHERE sku IS NULL
ORDER BY created_at ASC;

-- 3. Advance the sequence past any manually-entered PRD-XXXXX SKUs
--    so future auto-generated SKUs don't collide with existing ones.
DO $$
DECLARE
    max_existing INTEGER;
    current_seq  INTEGER;
BEGIN
    -- Extract numeric suffix from any existing PRD-XXXXX SKU
    SELECT COALESCE(MAX(CAST(REPLACE(sku, 'PRD-', '') AS INTEGER)), 0)
    INTO max_existing
    FROM products
    WHERE sku LIKE 'PRD-%'
      AND REPLACE(sku, 'PRD-', '') ~ '^[0-9]+$';

    current_seq := (SELECT last_value FROM product_sku_seq);

    IF max_existing >= current_seq THEN
        PERFORM setval('product_sku_seq', max_existing);
    END IF;
END $$;
