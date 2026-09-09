'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const authorize = require('../middleware/authorize');
const { validateBody, salesReturnCreate } = require('../utils/validators');

router.use(authorize('sales', 'view'));
const restrictWrite = authorize('sales', 'create');

router.get('/eligible-invoices', async (req, res) => {
    try {
        const search = String(req.query.search || '').trim();
        const params = [];
        // Eligible for return: any delivered (fully or partially) invoice from any source
        // as long as a delivery note exists and it is not cancelled.
        let where = [
            "i.delivery_note_id IS NOT NULL",
            "i.status <> 'cancelled'",
        ];
        if (search) {
            params.push(`%${search}%`);
            where.push(`(i.invoice_number::text ILIKE $1 OR c.name ILIKE $1)`);
        }
        const result = await db.query(`
            SELECT i.id, i.invoice_number, i.invoice_date, i.grand_total, i.status,
                   c.id AS client_id, c.name AS client_name,
                   i.delivery_note_id
            FROM invoices i
            JOIN clients c ON c.id = i.client_id
            WHERE ${where.join(' AND ')}
            ORDER BY i.invoice_date DESC, i.invoice_number DESC
            LIMIT 50
        `, params);
        return res.json({ data: result.rows });
    } catch (err) {
        console.error('[SalesReturns] eligible invoices error:', err.message);
        return res.status(500).json({ error: 'تعذر تحميل الفواتير المؤهلة للمرتجع.' });
    }
});

router.get('/warehouses', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT w.id, w.name, w.client_id
            FROM warehouses w
            WHERE w.status = 'active'
              AND (w.client_id = $1 OR w.client_id IS NULL OR w.client_id = (SELECT parent_id FROM clients WHERE id = $1) OR w.client_id IN (SELECT id FROM clients WHERE parent_id = $1))
            ORDER BY w.name
        `, [req.query.client_id]);
        return res.json({ data: result.rows });
    } catch (err) {
        console.error('[SalesReturns] warehouses error:', err.message);
        return res.status(500).json({ error: 'تعذر تحميل مستودعات الإرجاع.' });
    }
});

router.get('/', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT sr.id, sr.return_number, sr.return_date, sr.total_amount,
                   sr.return_action, sr.status, sr.notes,
                   c.name AS client_name,
                   i.invoice_number,
                   w.name AS destination_warehouse_name
            FROM sales_returns sr
            JOIN clients c ON c.id = sr.client_id
            JOIN invoices i ON i.id = sr.invoice_id
            JOIN warehouses w ON w.id = sr.destination_warehouse_id
            ORDER BY sr.created_at DESC
            LIMIT 100
        `);
        return res.json({ data: result.rows });
    } catch (err) {
        console.error('[SalesReturns] list error:', err.message);
        return res.status(500).json({ error: 'تعذر تحميل مرتجعات المبيعات.' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT sr.id, sr.return_number, sr.return_date, sr.total_amount,
                   sr.return_action, sr.status, sr.notes, sr.client_id,
                   sr.invoice_id, sr.destination_warehouse_id,
                   c.name AS client_name, i.invoice_number
            FROM sales_returns sr
            JOIN clients c ON c.id = sr.client_id
            JOIN invoices i ON i.id = sr.invoice_id
            WHERE sr.id = $1
        `, [req.params.id]);
        if (!result.rowCount) return res.status(404).json({ error: 'مرتجع المبيعات غير موجود.' });
        const items = await db.query(`
            SELECT sri.id, sri.invoice_item_id, sri.variant_id, sri.quantity,
                   sri.unit_price, sri.line_total, p.name AS product_name, pv.size_name
            FROM sales_return_items sri
            JOIN product_variants pv ON pv.id = sri.variant_id
            JOIN products p ON p.id = pv.product_id
            WHERE sri.sales_return_id = $1
            ORDER BY sri.created_at
        `, [req.params.id]);
        return res.json({ data: { return: result.rows[0], items: items.rows } });
    } catch (err) {
        console.error('[SalesReturns] detail error:', err.message);
        return res.status(500).json({ error: 'تعذر تحميل تفاصيل المرتجع.' });
    }
});

router.get('/by-invoice/:invoiceId', async (req, res) => {
    try {
        const invoiceRes = await db.query(`
            SELECT i.id, i.invoice_number, i.invoice_date, i.client_id,
                   i.grand_total, i.tax_rate, i.delivery_status, i.delivery_note_id,
                   c.name AS client_name
            FROM invoices i
            JOIN clients c ON c.id = i.client_id
            WHERE i.id = $1 AND i.delivery_note_id IS NOT NULL
              AND i.status <> 'cancelled'
        `, [req.params.invoiceId]);
        if (!invoiceRes.rowCount) return res.status(404).json({ error: 'الفاتورة غير مؤهلة للمرتجع؛ لا يوجد سند تسليم مسجل لها.' });

        const itemsRes = await db.query(`
            SELECT ii.id AS invoice_item_id, ii.variant_id, ii.quantity,
                   ii.unit_price, p.name AS product_name, pv.size_name,
                   (
                       LEAST(
                           ii.quantity,
                           COALESCE((
                               SELECT SUM(dni.delivered_qty)
                               FROM delivery_note_items dni
                               WHERE dni.order_item_id = ii.order_item_id
                                 AND dni.delivery_note_id = i.delivery_note_id
                           ), ii.quantity)
                       ) - COALESCE((
                           SELECT SUM(sri.quantity) FROM sales_return_items sri
                           JOIN sales_returns sr ON sr.id = sri.sales_return_id
                           WHERE sri.invoice_item_id = ii.id AND sr.status = 'completed'
                       ), 0)
                   ) AS remaining_qty
            FROM invoice_items ii
            JOIN product_variants pv ON pv.id = ii.variant_id
            JOIN products p ON p.id = pv.product_id
            JOIN invoices i ON i.id = ii.invoice_id
            WHERE ii.invoice_id = $1
            ORDER BY ii.id
        `, [req.params.invoiceId]);
        return res.json({ data: { invoice: invoiceRes.rows[0], items: itemsRes.rows } });
    } catch (err) {
        console.error('[SalesReturns] invoice error:', err.message);
        return res.status(500).json({ error: 'تعذر تحميل أصناف الفاتورة.' });
    }
});

router.post('/', restrictWrite, validateBody(salesReturnCreate), async (req, res) => {
    const { invoice_id, return_date, destination_warehouse_id, return_action, notes, items } = req.validatedBody;
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const invoiceRes = await client.query(`
            SELECT id, client_id, delivery_status, delivery_note_id, source, status, tax_rate
            FROM invoices WHERE id = $1 FOR UPDATE
        `, [invoice_id]);
        if (!invoiceRes.rowCount) throw new Error('الفاتورة غير موجودة.');
        const invoice = invoiceRes.rows[0];
        if (!invoice.delivery_note_id) {
            throw new Error('لا يمكن إنشاء مرتجع إلا بعد إنشاء سند تسليم للفاتورة.');
        }

        const warehouseRes = await client.query(
            `SELECT id FROM warehouses WHERE id = $1 AND status = 'active'`,
            [destination_warehouse_id]
        );
        if (!warehouseRes.rowCount) throw new Error('مستودع الإرجاع غير موجود أو غير نشط.');

        const normalized = [];
        let subtotal = 0;
        for (const item of items) {
            const itemRes = await client.query(`
                SELECT ii.id, ii.variant_id, ii.quantity, ii.unit_price,
                       (
                           LEAST(
                               ii.quantity,
                               COALESCE((
                                   SELECT SUM(dni.delivered_qty)
                                   FROM delivery_note_items dni
                                   WHERE dni.order_item_id = ii.order_item_id
                                     AND dni.delivery_note_id = i.delivery_note_id
                               ), ii.quantity)
                           ) - COALESCE((
                               SELECT SUM(sri.quantity) FROM sales_return_items sri
                               JOIN sales_returns sr ON sr.id = sri.sales_return_id
                               WHERE sri.invoice_item_id = ii.id AND sr.status = 'completed'
                           ), 0)
                       ) AS remaining_qty
                FROM invoice_items ii
                JOIN invoices i ON i.id = ii.invoice_id
                WHERE ii.id = $1 AND ii.invoice_id = $2
                FOR UPDATE
            `, [item.invoice_item_id, invoice_id]);
            if (!itemRes.rowCount) throw new Error('أحد أصناف المرتجع غير تابع لهذه الفاتورة.');
            const source = itemRes.rows[0];
            const quantity = parseFloat(item.quantity);
            if (quantity > parseFloat(source.remaining_qty || 0)) {
                throw new Error(`الكمية المرتجعة تتجاوز المتبقي للصنف (${source.remaining_qty}).`);
            }
            const lineTotal = quantity * parseFloat(source.unit_price || 0);
            subtotal += lineTotal;
            normalized.push({ ...source, quantity, lineTotal });
        }
        if (!normalized.length) throw new Error('أدخل صنفًا واحدًا على الأقل.');
        const totalAmount = Math.round((subtotal * (1 + parseFloat(invoice.tax_rate || 0))) * 100) / 100;

        const returnRes = await client.query(`
            INSERT INTO sales_returns
                (return_date, client_id, invoice_id, destination_warehouse_id, total_amount, return_action, notes, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, return_number
        `, [return_date || new Date().toISOString().slice(0, 10), invoice.client_id, invoice.id,
            destination_warehouse_id, totalAmount, return_action, notes || null, req.user?.id || null]);
        const returnId = returnRes.rows[0].id;

        for (const item of normalized) {
            await client.query(`
                INSERT INTO sales_return_items
                    (sales_return_id, invoice_item_id, variant_id, quantity, unit_price, line_total)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [returnId, item.id, item.variant_id, item.quantity, item.unit_price, item.lineTotal]);

            const stockRes = await client.query(`
                SELECT id FROM warehouse_stock
                WHERE warehouse_id = $1 AND variant_id = $2 AND client_id = $3
                FOR UPDATE
            `, [destination_warehouse_id, item.variant_id, invoice.client_id]);
            if (stockRes.rowCount) {
                await client.query(
                    `UPDATE warehouse_stock SET quantity = quantity + $1, last_updated = NOW() WHERE id = $2`,
                    [item.quantity, stockRes.rows[0].id]
                );
            } else {
                await client.query(`
                    INSERT INTO warehouse_stock (warehouse_id, variant_id, client_id, quantity, last_updated)
                    VALUES ($1, $2, $3, $4, NOW())
                `, [destination_warehouse_id, item.variant_id, invoice.client_id, item.quantity]);
            }
            await client.query(`
                INSERT INTO inventory_transactions
                    (variant_id, transaction_type, quantity, warehouse_to, client_id, reference_id, reference_type, notes, created_by, created_at)
                VALUES ($1, 'sales_return', $2, $3, $4, $5, 'sales_return', $6, $7, NOW())
            `, [item.variant_id, item.quantity, destination_warehouse_id, invoice.client_id, returnId,
                `مرتجع مبيعات #${returnRes.rows[0].return_number}`, req.user?.id || null]);
        }

        await client.query(`
            INSERT INTO client_transactions (client_id, invoice_id, type, amount, description, created_at)
            VALUES ($1, $2, 'sales_return', $3, $4, NOW())
        `, [invoice.client_id, invoice.id, totalAmount, `${return_action === 'cash_refund' ? 'رد نقدي' : 'إشعار دائن'} — مرتجع مبيعات #${returnRes.rows[0].return_number}`]);

        await client.query('COMMIT');
        return res.status(201).json({ data: { id: returnId, return_number: returnRes.rows[0].return_number, total_amount: totalAmount }, message: 'تم اعتماد مرتجع المبيعات وإضافة البضاعة للمخزون.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[SalesReturns] POST / error:', err.message);
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;
