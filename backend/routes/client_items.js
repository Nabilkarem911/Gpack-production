'use strict';

// =============================================================================
// G.PACK 2.0 — Client Items Route
// GET /api/client-items?client_id=<uuid>&months=12
// Returns all product variants linked to a client via:
//   1. warehouse_stock (current stock)
//   2. order_items → orders (purchase history)
// Also computes: total_ordered_qty, order_count, avg_monthly_consumption,
//                turnover_months, last_order_date
// =============================================================================

const express = require('express');
const db      = require('../db');
const router  = express.Router();

router.get('/', async (req, res) => {
    const { client_id, months } = req.query;
    if (!client_id) return res.status(400).json({ error: 'client_id مطلوب' });

    // Ownership check for sales_rep
    const isSalesRep = req.user.role === 'sales_rep';
    if (isSalesRep) {
        const clientCheck = await db.query(
            'SELECT created_by FROM clients WHERE id = $1 LIMIT 1',
            [client_id]
        );
        if (!clientCheck.rows.length || clientCheck.rows[0].created_by !== req.user.id) {
            return res.status(403).json({ error: 'غير مصرح لك بعرض أصناف هذا العميل.' });
        }
    }

    const lookbackMonths = parseInt(months) || 12;

    try {
        // ── 1. Current warehouse stock for this client ──────────────────────
        const stockRes = await db.query(`
            SELECT
                pv.id           AS variant_id,
                p.id            AS product_id,
                p.name          AS product_name,
                p.sku           AS product_code,
                pv.size_name,
                pv.sku          AS variant_sku,
                COALESCE(ws.quantity, 0)       AS current_stock,
                COALESCE(ws.available_qty, ws.quantity, 0) AS available_qty,
                cat.name        AS category_name
            FROM warehouse_stock ws
            JOIN product_variants pv  ON pv.id = ws.variant_id
            JOIN products p           ON p.id  = pv.product_id
            LEFT JOIN categories cat  ON cat.id = p.category_id
            WHERE ws.client_id = $1
              AND (ws.quantity > 0 OR ws.available_qty > 0)
            ORDER BY p.name, pv.size_name
        `, [client_id]);

        // ── 2. Actual client withdrawals for this client (last N months) ───
        const historyRes = await db.query(`
            WITH withdrawal_events AS (
                SELECT
                    dn.client_id,
                    dni.variant_id,
                    ddi.quantity::numeric AS quantity,
                    dnd.created_at AS withdrawal_date,
                    dnd.id AS reference_id,
                    'dispatch' AS source_type,
                    dnd.dispatch_number::text AS reference_number
                FROM delivery_dispatch_items ddi
                JOIN delivery_note_dispatches dnd ON dnd.id = ddi.dispatch_id
                JOIN delivery_note_items dni ON dni.id = ddi.dn_item_id
                JOIN delivery_notes dn ON dn.id = dnd.delivery_note_id
                WHERE dn.client_id = $1
                  AND dnd.created_at >= NOW() - ($2 || ' months')::interval

                UNION ALL

                SELECT
                    dn.client_id,
                    dni.variant_id,
                    dni.delivered_qty::numeric AS quantity,
                    COALESCE(dn.delivered_at, dn.delivery_date::timestamp, dn.created_at) AS withdrawal_date,
                    dn.id AS reference_id,
                    'delivery_note' AS source_type,
                    dn.note_number::text AS reference_number
                FROM delivery_note_items dni
                JOIN delivery_notes dn ON dn.id = dni.delivery_note_id
                WHERE dn.client_id = $1
                  AND COALESCE(dni.delivered_qty, 0) > 0
                  AND COALESCE(dn.delivered_at, dn.delivery_date::timestamp, dn.created_at) >= NOW() - ($2 || ' months')::interval
                  AND NOT EXISTS (
                      SELECT 1
                      FROM delivery_dispatch_items ddi
                      WHERE ddi.dn_item_id = dni.id
                  )

                UNION ALL

                SELECT
                    it.client_id,
                    it.variant_id,
                    ABS(it.quantity)::numeric AS quantity,
                    it.created_at AS withdrawal_date,
                    it.reference_id,
                    'inventory_transaction' AS source_type,
                    NULL::text AS reference_number
                FROM inventory_transactions it
                WHERE it.client_id = $1
                  AND it.transaction_type = 'dispense'
                  AND it.created_at >= NOW() - ($2 || ' months')::interval
                  AND (
                      it.reference_type IS DISTINCT FROM 'delivery_note'
                      OR it.reference_id IS NULL
                      OR NOT EXISTS (
                          SELECT 1
                          FROM delivery_notes dn
                          WHERE dn.id = it.reference_id
                      )
                  )
            )
            SELECT
                variant_id,
                COUNT(*)::int AS withdrawal_count,
                COALESCE(SUM(quantity), 0)::numeric AS total_withdrawn_qty,
                MAX(withdrawal_date) AS last_withdrawal_date,
                MIN(withdrawal_date) AS first_withdrawal_date,
                json_agg(
                    json_build_object(
                        'date', withdrawal_date,
                        'quantity', quantity,
                        'source_type', source_type,
                        'reference_id', reference_id,
                        'reference_number', reference_number
                    )
                    ORDER BY withdrawal_date DESC
                ) AS withdrawals
            FROM withdrawal_events
            GROUP BY variant_id
        `, [client_id, lookbackMonths]);

        // ── 3. All variant_ids from both sources ───────────────────────────
        const stockMap   = {};
        stockRes.rows.forEach(r => { stockMap[r.variant_id] = r; });

        const historyMap = {};
        historyRes.rows.forEach(r => { historyMap[r.variant_id] = r; });

        // ── 4. For variants in history but NOT in stock, fetch product info ─
        const missingIds = Object.keys(historyMap).filter(vid => !stockMap[vid]);
        let extraInfo = {};
        if (missingIds.length > 0) {
            const placeholders = missingIds.map((_, i) => `$${i+1}`).join(',');
            const extraRes = await db.query(`
                SELECT
                    pv.id           AS variant_id,
                    p.id            AS product_id,
                    p.name          AS product_name,
                    p.sku           AS product_code,
                    pv.size_name,
                    pv.sku          AS variant_sku,
                    0               AS current_stock,
                    0               AS available_qty,
                    cat.name        AS category_name
                FROM product_variants pv
                JOIN products p          ON p.id = pv.product_id
                LEFT JOIN categories cat ON cat.id = p.category_id
                WHERE pv.id IN (${placeholders})
            `, missingIds);
            extraRes.rows.forEach(r => { extraInfo[r.variant_id] = r; });
        }

        // ── 5. Merge and compute metrics ───────────────────────────────────
        const allVariantIds = [...new Set([
            ...Object.keys(stockMap),
            ...Object.keys(historyMap)
        ])];

        const items = allVariantIds.map(vid => {
            const s = stockMap[vid]   || extraInfo[vid] || {};
            const h = historyMap[vid] || {};

            const totalQty   = parseFloat(h.total_withdrawn_qty || 0);
            const orderCount = parseInt(h.withdrawal_count || 0);
            const stock      = parseFloat(s.current_stock || 0);

            const avgMonthly = lookbackMonths > 0 ? (totalQty / lookbackMonths) : 0;

            const turnoverMonths = avgMonthly > 0
                ? (stock / avgMonthly).toFixed(1)
                : null;

            return {
                variant_id:       vid,
                product_id:       s.product_id       || null,
                product_name:     s.product_name     || '—',
                product_code:     s.product_code     || '—',
                size_name:        s.size_name        || '—',
                sku:              s.sku              || '—',
                category_name:    s.category_name    || '—',
                current_stock:    stock,
                available_qty:    parseFloat(s.available_qty || 0),
                total_ordered_qty: totalQty,
                total_withdrawn_qty: totalQty,
                order_count:      orderCount,
                withdrawal_count: orderCount,
                avg_monthly_consumption: parseFloat(avgMonthly.toFixed(2)),
                avg_monthly_withdrawal: parseFloat(avgMonthly.toFixed(2)),
                turnover_months:  turnoverMonths !== null ? parseFloat(turnoverMonths) : null,
                last_order_date:  h.last_withdrawal_date  || null,
                first_order_date: h.first_withdrawal_date || null,
                last_withdrawal_date:  h.last_withdrawal_date  || null,
                first_withdrawal_date: h.first_withdrawal_date || null,
                withdrawals: h.withdrawals || [],
            };
        });

        // Sort: items with stock first, then by product name
        items.sort((a, b) => {
            if (b.current_stock !== a.current_stock) return b.current_stock - a.current_stock;
            return (a.product_name).localeCompare(b.product_name, 'ar');
        });

        // ── 6. Summary stats ──────────────────────────────────────────────
        const summary = {
            total_variants:    items.length,
            total_stock_units: items.reduce((s, i) => s + i.current_stock, 0),
            total_ordered_qty: items.reduce((s, i) => s + i.total_ordered_qty, 0),
            total_withdrawn_qty: items.reduce((s, i) => s + i.total_withdrawn_qty, 0),
            lookback_months:   lookbackMonths,
        };

        return res.status(200).json({ data: items, summary });

    } catch (err) {
        console.error('[ClientItems] GET error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
