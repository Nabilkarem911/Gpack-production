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
-- active invoice have nothing to link to and are skipped — the intentional
-- order-only advances stay order-only.
--
-- Safety:
--   * Single UPDATE, always gated by `ct.invoice_id IS NULL` — re-running is
--     a no-op.
--   * If nothing matches the 1:1 rule the migration logs one line and exits —
--     no backup table is created, nothing is written.
--   * When there is work to do, a timestamped backup of the whole
--     order-linked pool is created in the same transaction BEFORE the UPDATE.
--   * RAISE NOTICE logs the pool size, the matchable count and the number of
--     rows actually updated (GET DIAGNOSTICS) so the deploy log shows the
--     real effect.
-- =============================================================================

BEGIN;

DO $$
DECLARE
    pool_n   int;
    pool_sum numeric;
    link_n   int;
    upd_n    int;
BEGIN
    SELECT count(*), COALESCE(sum(amount), 0) INTO pool_n, pool_sum
      FROM client_transactions
     WHERE invoice_id IS NULL AND order_id IS NOT NULL;

    -- Rows that actually qualify: order has EXACTLY ONE active invoice.
    SELECT count(*) INTO link_n
      FROM client_transactions ct
      JOIN invoices i ON i.order_id = ct.order_id
     WHERE ct.invoice_id IS NULL
       AND i.status IN ('issued','overdue')
       AND (SELECT count(*) FROM invoices x
             WHERE x.order_id = i.order_id
               AND x.status IN ('issued','overdue')) = 1;

    IF link_n = 0 THEN
        RAISE NOTICE '101 backfill: % order-linked rows in pool, 0 match the 1:1 rule — nothing to do', pool_n;
        RETURN;
    END IF;

    -- Timestamped backup of ALL order-linked rows missing invoice_id (the
    -- whole pool: linkable + ambiguous + no-invoice) before any write.
    EXECUTE format(
        'CREATE TABLE client_transactions_inv_bf_%s AS
         SELECT * FROM client_transactions
         WHERE invoice_id IS NULL AND order_id IS NOT NULL',
        to_char(now(), 'YYYYMMDD_HH24MISS')
    );

    -- The backfill itself — 1:1 orders only, nothing guessed. The
    -- invoice_id IS NULL predicate is mandatory and must never be dropped.
    UPDATE client_transactions ct
    SET invoice_id = i.id
    FROM invoices i
    WHERE ct.invoice_id IS NULL
      AND ct.order_id = i.order_id
      AND i.status IN ('issued','overdue')
      AND (SELECT count(*) FROM invoices x
            WHERE x.order_id = i.order_id
              AND x.status IN ('issued','overdue')) = 1;

    GET DIAGNOSTICS upd_n = ROW_COUNT;
    RAISE NOTICE '101 backfill: updated % rows (expected %); pool was % order-linked rows / % total amount',
        upd_n, link_n, pool_n, pool_sum;
END $$;

COMMIT;
