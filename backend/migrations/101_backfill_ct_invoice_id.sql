-- =============================================================================
-- Migration 101: Backfill client_transactions.invoice_id for order-linked
-- payments.
--
-- Why: payments recorded through the order screen (orders/:id/payment and the
-- quotation conversion flow) write client_transactions with order_id set and
-- invoice_id NULL. Every invoice-level paid calculation — invoice payment,
-- mark-paid, cash_refund guard, AI functions, aging/briefing reports and the
-- client ledger — reads by invoice_id and therefore under-counts collections
-- on those invoices.
--
-- What: stamp invoice_id on rows whose order maps to EXACTLY ONE active
-- invoice ('issued','overdue'). Orders with multiple active invoices are
-- ambiguous and are intentionally skipped (manual review). Orders with no
-- active invoice have nothing to link to and are skipped.
--
-- Safety: a timestamped backup table of every candidate row is created inside
-- the same transaction BEFORE the UPDATE. Re-running is a no-op (affected
-- rows already have invoice_id set).
-- =============================================================================

BEGIN;

-- 1) Timestamped backup of ALL order-linked rows missing invoice_id (the
--    whole 49-row pool: safe + ambiguous + no-invoice) before any write.
DO $$
BEGIN
    EXECUTE format(
        'CREATE TABLE client_transactions_inv_bf_%s AS
         SELECT * FROM client_transactions
         WHERE invoice_id IS NULL AND order_id IS NOT NULL',
        to_char(now(), 'YYYYMMDD_HH24MISS')
    );
END $$;

-- 2) Visibility: log the candidate pool for the deploy log.
DO $$
DECLARE
    c int; s numeric;
BEGIN
    SELECT count(*), COALESCE(sum(amount), 0) INTO c, s
      FROM client_transactions
     WHERE invoice_id IS NULL AND order_id IS NOT NULL;
    RAISE NOTICE '101 backfill pool: % order-linked rows / % total amount', c, s;
END $$;

-- 3) The backfill itself — 1:1 orders only, nothing guessed.
UPDATE client_transactions ct
SET invoice_id = i.id
FROM invoices i
WHERE ct.invoice_id IS NULL
  AND ct.order_id = i.order_id
  AND i.status IN ('issued','overdue')
  AND (SELECT count(*) FROM invoices x
        WHERE x.order_id = i.order_id
          AND x.status IN ('issued','overdue')) = 1;

COMMIT;
