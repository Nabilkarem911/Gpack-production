-- ═══════════════════════════════════════════════════════════════════════════
-- G.PACK 2.0 — Wipe All Business Data (KEEP: terms, users, accounts, settings)
-- ═══════════════════════════════════════════════════════════════════════════
-- Run manually from the SERVER terminal (inside the postgres container):
--
--   docker exec -i gpack-postgres psql -U gpack_user -d gpack_db \
--     < /path/to/backend/scripts/wipe_business_data.sql
--
-- Or from the PROJECT terminal if psql is available:
--
--   docker exec -i gpack-postgres psql -U gpack_user -d gpack_db \
--     < backend/scripts/wipe_business_data.sql
--
-- ⚠️  THIS IS DESTRUCTIVE AND IRREVERSIBLE.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Disable FK checks temporarily for safe truncation ──────────────────
SET session_replication_role = 'replica';

-- ── 2. Truncate all business-data tables ───────────────────────────────────
TRUNCATE TABLE
    client_transactions,
    accounting_voucher_lines,
    accounting_vouchers,
    receiving_voucher_items,
    receiving_vouchers,
    purchase_return_items,
    purchase_returns,
    purchase_invoice_items,
    purchase_invoices,
    invoice_expenses,
    invoice_items,
    invoices,
    delivery_dispatch_items,
    delivery_note_dispatches,
    delivery_note_items,
    delivery_notes,
    mo_receipt_session_items,
    mo_receipt_sessions,
    manufacturer_order_items,
    manufacturer_orders,
    inventory_transactions,
    warehouse_stock,
    order_notes,
    order_items,
    orders,
    client_design_files,
    client_designs,
    client_pantone_colors,
    warehouses,
    product_variants,
    products,
    categories,
    units,
    clients,
    suppliers,
    task_notifications,
    task_comments,
    task_subtasks,
    tasks,
    audit_logs,
    cash_boxes,
    pos_terminals
CASCADE;

-- ── 3. Re-enable FK checks ─────────────────────────────────────────────────
SET session_replication_role = 'origin';

-- ── 4. Reset sequences to 1 ────────────────────────────────────────────────
ALTER SEQUENCE IF EXISTS order_number_seq            RESTART WITH 1;
ALTER SEQUENCE IF EXISTS invoice_number_seq          RESTART WITH 1;
ALTER SEQUENCE IF EXISTS delivery_note_number_seq    RESTART WITH 1;
ALTER SEQUENCE IF EXISTS manufacturer_order_number_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS voucher_number_seq          RESTART WITH 1;
ALTER SEQUENCE IF EXISTS purchase_return_number_seq  RESTART WITH 1;

-- ── 5. Verify what remains (should be non-empty) ───────────────────────────
SELECT 'standard_terms' AS table_name, COUNT(*) AS remaining FROM standard_terms
UNION ALL
SELECT 'users',          COUNT(*) FROM users
UNION ALL
SELECT 'roles',          COUNT(*) FROM roles
UNION ALL
SELECT 'accounts',       COUNT(*) FROM accounts
UNION ALL
SELECT 'system_settings',COUNT(*) FROM system_settings;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ✅ Done. Remaining data: standard_terms, users, roles, accounts, settings.
-- ═══════════════════════════════════════════════════════════════════════════
