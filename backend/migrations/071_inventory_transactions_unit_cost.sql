-- Migration 071: Add unit_cost column to inventory_transactions
-- Allows tracking the cost per unit for stock adjustments (تسوية)
-- Useful for calculating total inventory value and cost of goods.

ALTER TABLE inventory_transactions
    ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(15,4) DEFAULT 0;

COMMENT ON COLUMN inventory_transactions.unit_cost IS 'سعر التكلفة للقطعة عند التسوية';
