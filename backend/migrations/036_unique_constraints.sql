-- Migration 036: Add UNIQUE constraints on generated numbers to prevent double-submission (R-004)
-- These constraints guard against race-condition duplicates if a client double-clicks submit.
-- Idempotent: checks if constraint already exists before adding

DO $$
BEGIN
    -- Orders
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_orders_number_client') THEN
        ALTER TABLE orders ADD CONSTRAINT uq_orders_number_client UNIQUE (order_number, client_id);
    END IF;

    -- Sales invoices
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'invoices')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_invoices_number') THEN
        ALTER TABLE invoices ADD CONSTRAINT uq_invoices_number UNIQUE (invoice_number);
    END IF;

    -- Purchase invoices
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'purchase_invoices')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_purchase_invoices_number') THEN
        ALTER TABLE purchase_invoices ADD CONSTRAINT uq_purchase_invoices_number UNIQUE (invoice_number);
    END IF;

    -- Receipt vouchers (legacy separate table — skip if not exists)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'receipt_vouchers')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_receipt_vouchers_number') THEN
        ALTER TABLE receipt_vouchers ADD CONSTRAINT uq_receipt_vouchers_number UNIQUE (voucher_number);
    END IF;

    -- Payment vouchers (legacy separate table — skip if not exists)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_vouchers')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_payment_vouchers_number') THEN
        ALTER TABLE payment_vouchers ADD CONSTRAINT uq_payment_vouchers_number UNIQUE (voucher_number);
    END IF;

    -- Manufacturer orders
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'manufacturer_orders')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_manufacturer_orders_number') THEN
        ALTER TABLE manufacturer_orders ADD CONSTRAINT uq_manufacturer_orders_number UNIQUE (mo_number);
    END IF;

    -- Unified accounting_vouchers table
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'accounting_vouchers')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_accounting_vouchers_number_type') THEN
        ALTER TABLE accounting_vouchers ADD CONSTRAINT uq_accounting_vouchers_number_type UNIQUE (voucher_number, voucher_type);
    END IF;
END $$;
