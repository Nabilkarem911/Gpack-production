'use strict';

// =============================================================================
// G.PACK 2.0 — Receiving Vouchers Route
// /api/receiving-vouchers
// Warehouse receiving of goods from suppliers/manufacturers
// =============================================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const authorize = require('../middleware/authorize');
const { validateBody, receivingVoucherCreate } = require('../utils/validators');

router.use(authorize('receiving', 'view'));
const restrictWrite  = authorize('receiving', 'create');
const restrictEdit   = authorize('receiving', 'edit');
const restrictDelete = authorize('receiving', 'delete');

// =============================================================================
// GET /api/receiving-vouchers
// List receiving vouchers
// =============================================================================
router.get('/', async (req, res) => {
    try {
        const { search, supplier_id, date_from, date_to, limit = 50, offset = 0 } = req.query;

        let where  = ['1=1'];
        const params = [];

        if (search) {
            params.push(`%${search}%`);
            where.push(`(rv.voucher_number::text ILIKE $${params.length} OR rv.notes ILIKE $${params.length})`);
        }
        if (supplier_id) {
            params.push(supplier_id);
            where.push(`rv.supplier_id = $${params.length}`);
        }
        if (date_from) {
            params.push(date_from);
            where.push(`rv.receiving_date >= $${params.length}`);
        }
        if (date_to) {
            params.push(date_to);
            where.push(`rv.receiving_date <= $${params.length}`);
        }

        const countRes = await db.query(
            `SELECT COUNT(*)::int AS total FROM receiving_vouchers rv WHERE ${where.join(' AND ')}`,
            params
        );

        params.push(parseInt(limit));
        params.push(parseInt(offset));

        const rows = await db.query(`
            SELECT rv.id, rv.voucher_number, rv.receiving_date, rv.total_amount, rv.status, rv.notes,
                   rv.created_at,
                   s.id AS supplier_id, s.company_name AS supplier_name,
                   pi.id AS purchase_invoice_id, pi.invoice_number AS purchase_invoice_number,
                   mo.id AS manufacturer_order_id, mo.mo_number,
                   u.name AS created_by_name
            FROM receiving_vouchers rv
            LEFT JOIN suppliers s ON s.id = rv.supplier_id
            LEFT JOIN purchase_invoices pi ON pi.id = rv.purchase_invoice_id
            LEFT JOIN manufacturer_orders mo ON mo.id = rv.manufacturer_order_id
            LEFT JOIN users u ON u.id = rv.created_by
            WHERE ${where.join(' AND ')}
            ORDER BY rv.receiving_date DESC, rv.voucher_number DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);

        return res.json({ data: rows.rows, total: countRes.rows[0].total });
    } catch (err) {
        console.error('[ReceivingVouchers] GET / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/receiving-vouchers/:id
// Single voucher with items
// =============================================================================
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const vRes = await db.query(`
            SELECT rv.id, rv.voucher_number, rv.receiving_date, rv.total_amount, rv.status, rv.notes, rv.created_at,
                   s.id AS supplier_id, s.company_name AS supplier_name,
                   pi.id AS purchase_invoice_id, pi.invoice_number AS purchase_invoice_number,
                   mo.id AS manufacturer_order_id, mo.mo_number,
                   u.name AS created_by_name
            FROM receiving_vouchers rv
            LEFT JOIN suppliers s ON s.id = rv.supplier_id
            LEFT JOIN purchase_invoices pi ON pi.id = rv.purchase_invoice_id
            LEFT JOIN manufacturer_orders mo ON mo.id = rv.manufacturer_order_id
            LEFT JOIN users u ON u.id = rv.created_by
            WHERE rv.id = $1
        `, [id]);

        if (!vRes.rows.length) return res.status(404).json({ error: 'Voucher not found.' });

        const itemsRes = await db.query(`
            SELECT rvi.id, rvi.variant_id, rvi.quantity, rvi.unit_cost, rvi.line_total,
                   pv.size_name, p.name AS product_name
            FROM receiving_voucher_items rvi
            JOIN product_variants pv ON pv.id = rvi.variant_id
            JOIN products p ON p.id = pv.product_id
            WHERE rvi.receiving_voucher_id = $1
            ORDER BY rvi.created_at
        `, [id]);

        return res.json({ data: { voucher: vRes.rows[0], items: itemsRes.rows } });
    } catch (err) {
        console.error('[ReceivingVouchers] GET /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/receiving-vouchers
// Create receiving voucher:
//   - Add to warehouse_stock
//   - Create accounting voucher if purchase invoice exists
// =============================================================================
router.post('/', restrictWrite, validateBody(receivingVoucherCreate), async (req, res) => {
    const { receiving_date, supplier_id, purchase_invoice_id, manufacturer_order_id, warehouse_id, notes, items } = req.validatedBody;

    // ── Validation ───────────────────────────────────────────────────────────
    if (!receiving_date) return res.status(400).json({ error: 'تاريخ الاستلام مطلوب.' });
    if (!supplier_id)    return res.status(400).json({ error: 'المورد مطلوب.' });
    if (!warehouse_id) return res.status(400).json({ error: 'المستودع مطلوب.' });
    if (!Array.isArray(items) || items.length === 0)
        return res.status(400).json({ error: 'يجب إدخال صنف واحد على الأقل.' });

    // Validate items
    let totalAmount = 0;
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.variant_id) return res.status(400).json({ error: `الصنف ${i+1}: المنتج مطلوب.` });
        if (!it.quantity || it.quantity <= 0) return res.status(400).json({ error: `الصنف ${i+1}: الكمية يجب أن تكون أكبر من صفر.` });
        if (it.unit_cost == null || it.unit_cost < 0) return res.status(400).json({ error: `الصنف ${i+1}: التكلفة يجب أن تكون موجبة.` });
        totalAmount += (parseFloat(it.quantity) * parseFloat(it.unit_cost));
    }
    totalAmount = Math.round(totalAmount * 100) / 100;

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // 1. Create voucher header (voucher_number auto-generated via sequence DEFAULT)
        const vRes = await client.query(`
            INSERT INTO receiving_vouchers
                (receiving_date, supplier_id, purchase_invoice_id, manufacturer_order_id, warehouse_id, total_amount, notes, status, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8)
            RETURNING *
        `, [receiving_date, supplier_id, purchase_invoice_id || null, manufacturer_order_id || null, warehouse_id, totalAmount, notes || null, req.user?.id || null]);

        const voucherId     = vRes.rows[0].id;
        const voucherNumber = vRes.rows[0].voucher_number;

        // 3. Create items and add to stock
        for (const it of items) {
            const lineTotal = parseFloat(it.quantity) * parseFloat(it.unit_cost);
            const itemClientId = it.client_id || null; // optional per-item client scope

            // Add to warehouse_stock — match on client too, otherwise the
            // quantity could be credited to another client's stock row.
            const stockCheck = await client.query(`
                SELECT id FROM warehouse_stock
                WHERE variant_id = $1 AND warehouse_id = $2
                  AND client_id IS NOT DISTINCT FROM $3
                LIMIT 1
            `, [it.variant_id, warehouse_id, itemClientId]);

            let stockId;
            if (stockCheck.rows.length) {
                stockId = stockCheck.rows[0].id;
                await client.query(`
                    UPDATE warehouse_stock SET quantity = quantity + $1, last_updated = NOW() WHERE id = $2
                `, [it.quantity, stockId]);
            } else {
                const ins = await client.query(`
                    INSERT INTO warehouse_stock (variant_id, warehouse_id, client_id, quantity)
                    VALUES ($1, $2, $3, $4) RETURNING id
                `, [it.variant_id, warehouse_id, itemClientId, it.quantity]);
                stockId = ins.rows[0].id;
            }

            // Insert item — remember exactly which stock row was credited so
            // voiding the voucher later deducts from that row only.
            await client.query(`
                INSERT INTO receiving_voucher_items
                    (receiving_voucher_id, variant_id, quantity, unit_cost, line_total, warehouse_stock_id)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [voucherId, it.variant_id, it.quantity, it.unit_cost, lineTotal, stockId]);

            // Inventory transaction log (was missing entirely)
            await client.query(`
                INSERT INTO inventory_transactions
                    (stock_id, variant_id, transaction_type, quantity, warehouse_to, client_id,
                     reference_type, reference_id, notes, created_by, created_at)
                VALUES ($1, $2, 'receipt', $3, $4, $5, 'receiving_voucher', $6, $7, $8, NOW())
            `, [stockId, it.variant_id, it.quantity, warehouse_id, itemClientId,
                voucherId, `سند استلام #${voucherNumber}`, req.user?.id || null]);
        }

        // 4. Create accounting voucher if linked to purchase invoice
        if (purchase_invoice_id) {
            const accRes = await client.query(`SELECT id, code FROM accounts WHERE code IN ('1400', '2100')`);
            const accMap = {};
            for (const row of accRes.rows) accMap[row.code] = row.id;
            
            if (accMap['1400'] && accMap['2100']) {
                const acVRes = await client.query(`
                    INSERT INTO accounting_vouchers
                        (voucher_type, voucher_number, voucher_date, description, total_amount, status, reference_type, reference_id, created_by)
                    VALUES ('journal', nextval('voucher_number_seq'), $1, $2, $3, 'posted', 'receiving_voucher', $4, $5)
                    RETURNING id, voucher_number
                `, [receiving_date, `استلام بضاعة #${voucherNumber} — ${notes || ''}`, totalAmount, voucherId, req.user?.id || null]);

                // Dr Inventory (increasing asset)
                await client.query(`
                    INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, description)
                    VALUES ($1, $2, $3, 0, 'بضاعة مستلمة')
                `, [acVRes.rows[0].id, accMap['1400'], totalAmount]);

                // Cr Accounts Payable (increasing liability to supplier)
                await client.query(`
                    INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, description, sub_account_type, sub_account_id)
                    VALUES ($1, $2, 0, $3, 'ذمة للمورد', 'supplier', $4)
                `, [acVRes.rows[0].id, accMap['2100'], totalAmount, supplier_id]);
            }
        }

        await client.query('COMMIT');

        return res.status(201).json({
            data: vRes.rows[0]
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[ReceivingVouchers] POST / error:', err.message);
        return res.status(500).json({ error: err.message || 'Internal server error.' });
    } finally {
        client.release();
    }
});

// =============================================================================
// DELETE /api/receiving-vouchers/:id
// Cancel/void a receiving voucher
// =============================================================================
router.delete('/:id', restrictDelete, async (req, res) => {
    try {
        const { id } = req.params;

        const exist = await db.query(`SELECT id, status FROM receiving_vouchers WHERE id = $1`, [id]);
        if (!exist.rows.length) return res.status(404).json({ error: 'سند الاستلام غير موجود.' });
        if (exist.rows[0].status === 'voided') return res.status(400).json({ error: 'سند الاستلام ملغي مسبقاً.' });

        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            // Get items to deduct from stock — each item remembers the exact
            // stock row it credited. Legacy rows (no warehouse_stock_id) fall
            // back to the voucher's warehouse + NULL client row.
            const voucherWh = await client.query(`SELECT warehouse_id FROM receiving_vouchers WHERE id = $1`, [id]);
            const warehouseId = voucherWh.rows[0]?.warehouse_id || null;

            const items = await client.query(`SELECT variant_id, quantity, warehouse_stock_id FROM receiving_voucher_items WHERE receiving_voucher_id = $1`, [id]);

            // Deduct from stock
            const shelfService = require('../services/shelf-service');
            for (const it of items.rows) {
                // Resolve the exact stock row this item credited. Pinned items
                // are exact; legacy items (no warehouse_stock_id) are only
                // reversible when exactly ONE candidate row exists for the
                // variant in this voucher's warehouse — otherwise the original
                // row cannot be determined confidently, so the void is blocked.
                let stockRow = null;
                if (it.warehouse_stock_id) {
                    const pinned = await client.query(`
                        SELECT id, quantity FROM warehouse_stock
                        WHERE id = $1
                        FOR UPDATE
                    `, [it.warehouse_stock_id]);
                    stockRow = pinned.rows[0] || null;
                } else {
                    const candidates = await client.query(`
                        SELECT id, quantity FROM warehouse_stock
                        WHERE variant_id = $1 AND warehouse_id = $2
                        FOR UPDATE
                    `, [it.variant_id, warehouseId]);
                    if (candidates.rowCount === 1) {
                        stockRow = candidates.rows[0];
                    } else if (candidates.rowCount > 1) {
                        const ambiguous = new Error('لا يمكن إلغاء السند — تعذّر تحديد سجل المخزون الأصلي بدقة (أكثر من سجل مرشّح لهذا الصنف في نفس المستودع). يتطلب الأمر مراجعة يدوية.');
                        ambiguous.statusCode = 409;
                        throw ambiguous;
                    }
                }

                if (!stockRow) {
                    const missing = new Error('لا يمكن إلغاء السند — سجل المخزون المرتبط بالبند غير موجود.');
                    missing.statusCode = 409;
                    throw missing;
                }

                // Keep shelf placements consistent BEFORE the stock update —
                // consumes the unassigned bucket first, then flagged auto-picks.
                // Failure aborts the whole void — never warn-and-continue.
                await shelfService.deductFromStock(client, {
                    stockId: stockRow.id,
                    quantity: it.quantity,
                    refType: 'receiving_voucher_void',
                    refId: id,
                    userId: req.user?.id || null,
                    notes: 'إلغاء سند استلام',
                });

                await client.query(`
                    UPDATE warehouse_stock
                    SET quantity = GREATEST(0, quantity - $1), last_updated = NOW()
                    WHERE id = $2
                `, [it.quantity, stockRow.id]);

                await client.query(`
                    INSERT INTO inventory_transactions
                        (stock_id, variant_id, transaction_type, quantity, warehouse_from,
                         reference_type, reference_id, notes, created_by, created_at)
                    VALUES ($1, $2, 'reversal', $3, $4, 'receiving_voucher', $5, $6, $7, NOW())
                `, [stockRow.id, it.variant_id, it.quantity, warehouseId,
                    id, `إلغاء سند استلام`, req.user?.id || null]);
            }

            // Reverse accounting voucher
            await client.query(`
                UPDATE accounting_vouchers SET status = 'reversed'
                WHERE reference_type = 'receiving_voucher' AND reference_id = $1
            `, [id]);

            // Mark as voided
            await client.query(`
                UPDATE receiving_vouchers SET status = 'voided' WHERE id = $1
            `, [id]);

            await client.query('COMMIT');
            return res.json({ message: 'تم إلغاء سند الاستلام بنجاح.' });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('[ReceivingVouchers] DELETE /:id error:', err.message);
        return res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error.' });
    }
});

module.exports = router;
