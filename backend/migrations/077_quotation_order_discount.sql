-- Migration 077: Add order-level quotation discount support
-- Discount is recalculated server-side from discount_type and discount_value.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS discount_type VARCHAR(10) NOT NULL DEFAULT 'percent',
    ADD COLUMN IF NOT EXISTS discount_value NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0;

ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_discount_type_check;

ALTER TABLE orders
    ADD CONSTRAINT orders_discount_type_check
    CHECK (discount_type IN ('percent', 'fixed'));

ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_discount_value_nonnegative;

ALTER TABLE orders
    ADD CONSTRAINT orders_discount_value_nonnegative
    CHECK (discount_value >= 0 AND discount_amount >= 0);
