'use strict';

// =============================================================================
// G.PACK 2.0 — Purchase Returns Route
// /api/purchase-returns
// Returns goods to suppliers, affects inventory and accounting (AP & Inventory)
// =============================================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const authorize = require('../middleware/authorize');
const { validateBody, purchaseReturnCreate } = require('../utils/validators');

router.use(authorize('purchase_returns', 'view'));
const restrictWrite  = authorize('purchase_returns', 'create');
const restrictEdit   = authorize('purchase_returns', 'edit');
const restrictDelete = authorize('purchase_returns', 'delete');

// =============================================================================
// GET /api/purchase-returns
// List returns with supplier info
// =============================================================================
router.get('/', async (req, res) => {
    try {
        const { search, supplier_id, date_from, date_to, limit = 50, offset = 0 } = req.query;

        let where  = ['1=1'];
        const params = [];

        if (search) {
            params.push(`%${search}%`);
            where.push(`(pr.return_number::text ILIKE $${params.length} OR pr.notes ILIKE $${params.length})`);
        }
        if (supplier_id) {
            params.push(supplier_id);
            where.push(`pr.supplier_id = $${params.length}`);
        }
        if (date_from) {
            params.push(date_from);
            where.push(`pr.return_date >= $${params.length}`);
        }
        if (date_to) {
            params.push(date_to);
            where.push(`pr.return_date <= $${params.length}`);
        }

        const countRes = await db.query(
            `SELECT COUNT(*)::int AS total FROM purchase_returns pr WHERE ${where.join(' AND ')}`,
            params
        );

        params.push(parseInt(limit));
        params.push(parseInt(offset));

        const rows = await db.query(`
            SELECT pr.id, pr.return_number, pr.return_date, pr.total_amount, pr.status, pr.notes,
                   pr.created_at,
                   s.id AS supplier_id, s.company_name AS supplier_name,
                   pi.id AS purchase_invoice_id, pi.invoice_number AS purchase_invoice_number,
                   u.name AS created_by_name
            FROM purchase_returns pr
            LEFT JOIN suppliers s ON s.id = pr.supplier_id
            LEFT JOIN purchase_invoices pi ON pi.id = pr.purchase_invoice_id
            LEFT JOIN users u ON u.id = pr.created_by
            WHERE ${where.join(' AND ')}
            ORDER BY pr.return_date DESC, pr.return_number DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);

        return res.json({ data: rows.rows, total: countRes.rows[0].total });
    } catch (err) {
        console.error('[PurchaseReturns] GET / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/purchase-returns/:id
// Single return with items
// =============================================================================
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const retRes = await db.query(`
            SELECT pr.id, pr.return_number, pr.return_date, pr.total_amount, pr.status, pr.notes, pr.created_at,
                   s.id AS supplier_id, s.company_name AS supplier_name,
                   pi.id AS purchase_invoice_id, pi.invoice_number AS purchase_invoice_number,
                   u.name AS created_by_name
            FROM purchase_returns pr
            LEFT JOIN suppliers s ON s.id = pr.supplier_id
            LEFT JOIN purchase_invoices pi ON pi.id = pr.purchase_invoice_id
            LEFT JOIN users u ON u.id = pr.created_by
            WHERE pr.id = $1
        `, [id]);

        if (!retRes.rows.length) return res.status(404).json({ error: 'Return not found.' });

        const itemsRes = await db.query(`
            SELECT pri.id, pri.variant_id, pri.quantity, pri.unit_cost, pri.line_total,
                   pv.size_name, p.name AS product_name,
                   (SELECT COALESCE(SUM(whs.quantity),0) FROM warehouse_stock whs WHERE whs.variant_id = pri.variant_id) AS current_stock
            FROM purchase_return_items pri
            JOIN product_variants pv ON pv.id = pri.variant_id
            JOIN products p ON p.id = pv.product_id
            WHERE pri.purchase_return_id = $1
            ORDER BY pri.created_at
        `, [id]);

        return res.json({ data: { return: retRes.rows[0], items: itemsRes.rows } });
    } catch (err) {
        console.error('[PurchaseReturns] GET /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/purchase-returns
// Create a purchase return:
//   - Deduct from warehouse_stock
//   - Create accounting voucher: Dr Inventory, Cr Accounts Payable
// =============================================================================
router.post('/', restrictWrite, validateBody(purchaseReturnCreate), async (req, res) => {
    const { return_date, supplier_id, purchase_invoice_id, notes, items } = req.validatedBody;

    // ── Validation ───────────────────────────────────────────────────────────
    if (!return_date)              return res.status(400).json({ error: 'تاريخ المرتجع مطلوب.' });
    if (!supplier_id)              return res.status(400).json({ error: 'المورد مطلوب.' });
    if (!Array.isArray(items) || items.length === 0)
        return res.status(400).json({ error: 'يجب إدخال صنف واحد على الأقل.' });

    // Validate items
    let totalAmount = 0;
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.variant_id)  return res.status(400).json({ error: `الصنف ${i+1}: المنتج مطلوب.` });
        if (!it.quantity || it.quantity <= 0)
            return res.status(400).json({ error: `الصنف ${i+1}: الكمية يجب أن تكون أكبر من صفر.` });
        if (it.unit_cost == null || it.unit_cost < 0)
            return res.status(400).json({ error: `الصنف ${i+1}: التكلفة يجب أن تكون موجبة.` });
        totalAmount += (parseFloat(it.quantity) * parseFloat(it.unit_cost));
    }
    totalAmount = Math.round(totalAmount * 100) / 100;

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // 1. Generate return number
        const seqRes = await client.query(`SELECT nextval('purchase_return_number_seq') AS next`);
        const returnNumber = seqRes.rows[0].next;

        // 2. Create return header
        const retRes = await client.query(`
            INSERT INTO purchase_returns
                (return_number, return_date, supplier_id, purchase_invoice_id, total_amount, notes, status, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7)
            RETURNING *
        `, [returnNumber, return_date, supplier_id, purchase_invoice_id || null, totalAmount, notes || null, req.user?.id || null]);

        const returnId = retRes.rows[0].id;

        // 3. Create items and deduct stock
        for (const it of items) {
            const lineTotal = parseFloat(it.quantity) * parseFloat(it.unit_cost);
            
            // Insert item — warehouse_id (optional) scopes the deduction and is
            // persisted so a later void can restore confidently.
            await client.query(`
                INSERT INTO purchase_return_items
                    (purchase_return_id, variant_id, quantity, unit_cost, line_total, warehouse_id)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [returnId, it.variant_id, it.quantity, it.unit_cost, lineTotal, it.warehouse_id || null]);

            // Deduct from warehouse_stock (LIFO per variant — optionally scoped
            // to a warehouse when provided). Each deduction is logged with its
            // exact stock row so voiding restores to the SAME rows.
            const stockRes = await client.query(`
                SELECT ws.id, ws.quantity, ws.warehouse_id, ws.client_id FROM warehouse_stock ws
                WHERE ws.variant_id = $1 AND ws.quantity > 0
                  AND ($2::uuid IS NULL OR ws.warehouse_id = $2)
                ORDER BY ws.last_updated DESC
                FOR UPDATE
            `, [it.variant_id, it.warehouse_id || null]);

            const shelfService = require('../services/shelf-service');
            let remaining = it.quantity;
            for (const row of stockRes.rows) {
                if (remaining <= 0) break;
                const deduct = Math.min(remaining, row.quantity);

                // Shelf-sync BEFORE the stock update: consumes the unassigned
                // bucket first, then flagged auto-picks — keeps placements <= qty.
                // Failure aborts the whole return — never warn-and-continue.
                await shelfService.deductFromStock(client, {
                    stockId: row.id, quantity: deduct,
                    refType: 'purchase_return', refId: returnId,
                    userId: req.user?.id || null,
                    notes: `مرتجع مشتريات #${returnNumber}`,
                });

                await client.query(`
                    UPDATE warehouse_stock SET quantity = quantity - $1, last_updated = NOW() WHERE id = $2
                `, [deduct, row.id]);

                // Exact-row movement log (used by the void path to restore)
                await client.query(`
                    INSERT INTO inventory_transactions
                        (stock_id, variant_id, transaction_type, quantity, warehouse_from, client_id,
                         reference_type, reference_id, notes, created_by, created_at)
                    VALUES ($1, $2, 'dispense', $3, $4, $5, 'purchase_return', $6, $7, $8, NOW())
                `, [row.id, it.variant_id, deduct, row.warehouse_id, row.client_id,
                    returnId, `مرتجع مشتريات #${returnNumber}`, req.user?.id || null]);

                remaining -= deduct;
            }

            // Never record a return larger than the stock actually available —
            // a partial deduction would silently falsify both stock and AP.
            if (remaining > 1e-9) {
                const insufficient = new Error(`الكمية المرتجعة (${it.quantity}) تتجاوز المخزون المتاح للصنف — المتاح أقل بـ ${remaining}.`);
                insufficient.statusCode = 400;
                throw insufficient;
            }
        }

        // 4. Create accounting voucher (Journal Entry)
        // Dr Inventory (1400) — decreasing inventory
        // Cr Accounts Payable (2100) — decreasing liability to supplier
        
        // Get account IDs
        const accRes = await client.query(`SELECT id, code FROM accounts WHERE code IN ('1400', '2100')`);
        const accMap = {};
        for (const row of accRes.rows) accMap[row.code] = row.id;
        
        if (!accMap['1400'] || !accMap['2100']) {
            throw new Error('حسابات المخزون (1400) أو ذمم الموردين (2100) غير موجودة في الدليل المحاسبي.');
        }

        // Create voucher
        const vRes = await client.query(`
            INSERT INTO accounting_vouchers
                (voucher_type, voucher_number, voucher_date, description, total_amount, status, reference_type, reference_id, created_by)
            VALUES ('journal', nextval('voucher_number_seq'), $1, $2, $3, 'posted', 'purchase_return', $4, $5)
            RETURNING id, voucher_number
        `, [return_date, `مرتجع مشتريات #${returnNumber} — ${notes || ''}`, totalAmount, returnId, req.user?.id || null]);

        // Debit Inventory (decreasing asset = credit inventory? No, wait)
        // Actually: returning goods TO supplier means:
        // - Inventory decreases (Credit 1400, because inventory is an asset)
        // - Accounts Payable decreases (Debit 2100, because AP is a liability)
        // Wait that's wrong. Let me think again:
        // 
        // When we BUY: Dr Inventory, Cr AP
        // When we RETURN: reverse
        // - Inventory goes down (Cr Inventory)
        // - AP goes down (Dr AP)
        // 
        // So: Dr AP (2100), Cr Inventory (1400)
        
        await client.query(`
            INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, description, sub_account_type, sub_account_id)
            VALUES ($1, $2, $3, 0, $4, 'supplier', $5)
        `, [vRes.rows[0].id, accMap['2100'], totalAmount, `مرتجع للمورد`, supplier_id]);

        await client.query(`
            INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, description)
            VALUES ($1, $2, 0, $3, 'تكلفة المرتجع')
        `, [vRes.rows[0].id, accMap['1400'], totalAmount]);

        await client.query('COMMIT');

        return res.status(201).json({
            data: { ...retRes.rows[0], voucher_number: vRes.rows[0].voucher_number }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[PurchaseReturns] POST / error:', err.message);
        return res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error.' });
    } finally {
        client.release();
    }
});

// =============================================================================
// DELETE /api/purchase-returns/:id
// Cancel/void a return — reverse all effects
// =============================================================================
router.delete('/:id', restrictDelete, async (req, res) => {
    try {
        const { id } = req.params;

        // Check existence
        const exist = await db.query(`SELECT id, status FROM purchase_returns WHERE id = $1`, [id]);
        if (!exist.rows.length) return res.status(404).json({ error: 'المرتجع غير موجود.' });
        if (exist.rows[0].status === 'voided') return res.status(400).json({ error: 'المرتجع ملغي مسبقاً.' });

        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            // Get items to restore stock
            const items = await client.query(`SELECT variant_id, quantity, warehouse_id FROM purchase_return_items WHERE purchase_return_id = $1`, [id]);

            // Restore stock (add back) — prefer the exact rows recorded in
            // inventory_transactions at deduction time; legacy returns without
            // logged rows fall back to a single matching stock row.
            const logged = await client.query(`
                SELECT stock_id, variant_id, quantity FROM inventory_transactions
                WHERE reference_type = 'purchase_return' AND reference_id = $1
                  AND transaction_type = 'dispense' AND stock_id IS NOT NULL
            `, [id]);

            if (logged.rowCount > 0) {
                for (const mv of logged.rows) {
                    await client.query(`
                        UPDATE warehouse_stock SET quantity = quantity + $1, last_updated = NOW() WHERE id = $2
                    `, [mv.quantity, mv.stock_id]);
                    await client.query(`
                        INSERT INTO inventory_transactions
                            (stock_id, variant_id, transaction_type, quantity,
                             reference_type, reference_id, notes, created_by, created_at)
                        VALUES ($1, $2, 'reversal', $3, 'purchase_return', $4, $5, $6, NOW())
                    `, [mv.stock_id, mv.variant_id, mv.quantity, id,
                        'إلغاء مرتجع مشتريات', req.user?.id || null]);
                }
            } else {
                // Legacy return without logged movements — restore ONLY when
                // the original stock row can be determined confidently:
                // exactly one candidate for the variant, scoped to the item's
                // warehouse when recorded. Otherwise the void is blocked rather
                // than crediting a potentially wrong row.
                for (const it of items.rows) {
                    const stockCheck = await client.query(`
                        SELECT id FROM warehouse_stock
                        WHERE variant_id = $1
                          AND ($2::uuid IS NULL OR warehouse_id = $2)
                        FOR UPDATE
                    `, [it.variant_id, it.warehouse_id || null]);

                    if (stockCheck.rowCount !== 1) {
                        const ambiguous = new Error(
                            stockCheck.rowCount === 0
                                ? 'لا يمكن إلغاء المرتجع — سجل المخزون الأصلي غير موجود.'
                                : 'لا يمكن إلغاء المرتجع — تعذّر تحديد سجل المخزون الأصلي بدقة (أكثر من سجل مرشّح لهذا الصنف). يتطلب الأمر مراجعة يدوية.'
                        );
                        ambiguous.statusCode = 409;
                        throw ambiguous;
                    }

                    await client.query(`
                        UPDATE warehouse_stock SET quantity = quantity + $1, last_updated = NOW() WHERE id = $2
                    `, [it.quantity, stockCheck.rows[0].id]);
                }
            }

            // Reverse accounting voucher
            await client.query(`
                UPDATE accounting_vouchers SET status = 'reversed'
                WHERE reference_type = 'purchase_return' AND reference_id = $1
            `, [id]);

            // Mark return as voided
            await client.query(`
                UPDATE purchase_returns SET status = 'voided' WHERE id = $1
            `, [id]);

            await client.query('COMMIT');
            return res.json({ message: 'تم إلغاء المرتجع بنجاح.' });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('[PurchaseReturns] DELETE /:id error:', err.message);
        return res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error.' });
    }
});

module.exports = router;
