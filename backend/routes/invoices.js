'use strict';

// =============================================================================
// G.PACK 2.0 — Sales Invoices Routes
// GET  /api/invoices          — list all sales invoices with filters
// GET  /api/invoices/:id       — get invoice details with items
// POST /api/invoices           — create new sales invoice
// =============================================================================

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const db      = require('../db');
const { success, created } = require('../utils/response');
const { authenticate } = require('../middleware/authMiddleware');
const authorize = require('../middleware/authorize');
const { getVatRate } = require('../utils/settings');
const { encryptToken, hashToken, hasShareTokenSecret } = require('../utils/crypto');
const { invoiceCreate, invoiceShare, invoiceStatusUpdate, validateBody } = require('../utils/validators');

// View permission: all authenticated users with 'sales' view can list/get
router.use(authorize('sales', 'view'));

// Write/Edit permissions
const restrictWrite = authorize('sales', 'create');
const restrictEdit  = authorize('sales', 'edit');

// ── GET /api/invoices ───────────────────────────────────────────────────────
// Query params: client_id, status, from, to, search, limit, offset
router.get('/', async (req, res) => {
    try {
        const { client_id, status, from, to, search, limit = 50, offset = 0 } = req.query;

        let where = ['i.id IS NOT NULL']; // always true base
        const params = [];
        let paramIdx = 1;

        // DATA SCOPING: sales_rep sees only invoices for orders they created
        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep) {
            where.push(`o.created_by = $${paramIdx++}`);
            params.push(req.user.id);
        }

        if (client_id) {
            where.push(`i.client_id = $${paramIdx++}`);
            params.push(client_id);
        }
        if (status) {
            where.push(`i.status = $${paramIdx++}`);
            params.push(status);
        }
        if (from) {
            where.push(`i.invoice_date >= $${paramIdx++}`);
            params.push(from);
        }
        if (to) {
            where.push(`i.invoice_date <= $${paramIdx++}`);
            params.push(to);
        }
        if (search) {
            where.push(`(c.name ILIKE $${paramIdx} OR CAST(i.invoice_number AS TEXT) ILIKE $${paramIdx})`);
            params.push(`%${search}%`);
            paramIdx++;
        }

        const whereClause = where.join(' AND ');

        // Count query
        const countRes = await db.query(`
            SELECT COUNT(*)::int AS total
            FROM invoices i
            LEFT JOIN clients c ON c.id = i.client_id
            WHERE ${whereClause}
        `, params);

        // Data query
        const dataRes = await db.query(`
            SELECT
                i.id, i.invoice_number, i.invoice_date, i.due_date,
                i.subtotal, i.tax_rate, i.tax_amount, i.grand_total,
                i.status, i.notes, i.created_at,
                c.id AS client_id, c.name AS client_name,
                o.id AS order_id, o.order_number,
                u.name AS created_by_name
            FROM invoices i
            LEFT JOIN clients c ON c.id = i.client_id
            LEFT JOIN orders o ON o.id = i.order_id
            LEFT JOIN users u ON u.id = i.created_by
            WHERE ${whereClause}
            ORDER BY i.created_at DESC
            LIMIT $${paramIdx++} OFFSET $${paramIdx++}
        `, [...params, parseInt(limit), parseInt(offset)]);

        res.json({
            data: dataRes.rows,
            total: countRes.rows[0].total,
            limit: parseInt(limit),
            offset: parseInt(offset),
        });

    } catch (err) {
        console.error('[Invoices] GET / error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// ── GET /api/invoices/:id ───────────────────────────────────────────────────
// Full invoice details with items
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Invoice header
        const invRes = await db.query(`
            SELECT
                i.id, i.invoice_number, i.invoice_date, i.due_date,
                i.subtotal, i.tax_rate, i.tax_amount, i.additional_expenses, i.grand_total,
                i.status, i.payment_terms, i.notes, i.created_at,
                c.id AS client_id, c.name AS client_name, c.phone AS client_phone,
                o.id AS order_id, o.order_number,
                u.name AS created_by_name
            FROM invoices i
            LEFT JOIN clients c ON c.id = i.client_id
            LEFT JOIN orders o ON o.id = i.order_id
            LEFT JOIN users u ON u.id = i.created_by
            WHERE i.id = $1
        `, [id]);

        if (!invRes.rows.length) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        const invoice = invRes.rows[0];

        // DATA SCOPING: sales_rep can only view invoices for their own orders
        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep) {
            const orderCheck = await db.query(
                'SELECT created_by FROM orders WHERE id = $1',
                [invoice.order_id]
            );
            if (!orderCheck.rows.length || orderCheck.rows[0].created_by !== req.user.id) {
                return res.status(403).json({ error: 'غير مصرح لك بعرض هذه الفاتورة.' });
            }
        }

        // Invoice items
        const itemsRes = await db.query(`
            SELECT
                ii.id, ii.quantity, ii.unit_price, ii.discount_percent, ii.line_total,
                pv.id AS variant_id, pv.size_name,
                p.id AS product_id, p.name AS product_name,
                oi.id AS order_item_id
            FROM invoice_items ii
            JOIN product_variants pv ON pv.id = ii.variant_id
            JOIN products p ON p.id = pv.product_id
            LEFT JOIN order_items oi ON oi.id = ii.order_item_id
            WHERE ii.invoice_id = $1
        `, [id]);

        invoice.items = itemsRes.rows;

        // Additional expenses
        const expRes = await db.query(`
            SELECT id, description, amount
            FROM invoice_expenses
            WHERE invoice_id = $1
        `, [id]);
        invoice.expenses = expRes.rows;

        res.json({ data: invoice });

    } catch (err) {
        console.error('[Invoices] GET /:id error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// ── POST /api/invoices/:id/share
// Generate a public share token for an invoice
router.post('/:id/share', authenticate, validateBody(invoiceShare), async (req, res) => {
    try {
        const { id } = req.params;
        const expiresDays = req.validatedBody.expires_days || 30;

        const plainToken = crypto.randomBytes(32).toString('hex');
        let storedToken  = plainToken;
        let tokenHash;
        try {
            storedToken = encryptToken(plainToken);
            tokenHash   = hashToken(plainToken);
        } catch (cryptoErr) {
            console.error('[Invoices] share crypto error:', cryptoErr.message);
            tokenHash = crypto.createHmac('sha256', plainToken).digest('hex');
            storedToken = plainToken;
        }
        const expiresAt  = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000);

        try {
            await db.query(
                `UPDATE invoices SET share_token = $1, share_token_hash = $2, token_expires_at = $3 WHERE id = $4`,
                [storedToken, tokenHash, expiresAt, id]
            );
        } catch (dbErr) {
            const missingHashColumn = dbErr?.code === '42703' || /share_token_hash/i.test(dbErr?.message || '');
            if (missingHashColumn) {
                console.warn('[Invoices] share_token_hash column missing — falling back to plaintext column only. Please run migrations.');
                await db.query(
                    `UPDATE invoices SET share_token = $1, token_expires_at = $2 WHERE id = $3`,
                    [storedToken, expiresAt, id]
                );
            } else {
                throw dbErr;
            }
        }

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        res.json({
            success: true,
            url: `${baseUrl}/public-invoice.html?token=${plainToken}`,
            token: plainToken,
            expires_at: expiresAt
        });
    } catch (err) {
        console.error('[Invoices] POST /:id/share error:', err.message);
        const needsSecret = !hasShareTokenSecret();
        const message = needsSecret
            ? 'تعذّر إنشاء رابط مشاركة الفاتورة. تأكد من إعداد SHARE_TOKEN_SECRET في ملف .env'
            : `تعذّر إنشاء رابط مشاركة الفاتورة: ${err.message}`;
        res.status(500).json({ error: message });
    }
});

// ── POST /api/invoices ──────────────────────────────────────────────────────
// Create new sales invoice
// Body: client_id, invoice_date, due_date, items[], tax_rate, notes, order_id (optional)
router.post('/', restrictWrite, validateBody(invoiceCreate), async (req, res) => {
    const client = await db.pool.connect();
    try {
        const {
            client_id,
            order_id = null,
            invoice_date,
            due_date,
            items = [],
            tax_rate,
            additional_expenses = 0,
            additional_expense_label = null,
            notes = '',
        } = req.validatedBody;

        const effectiveTaxRate = tax_rate ?? await getVatRate();

        if (!client_id || !items.length) {
            return res.status(400).json({ error: 'client_id and items[] required' });
        }

        const userId = req.user?.id || null;

        await client.query('BEGIN');

        // Calculate totals
        let subtotal = 0;
        for (const item of items) {
            const qty = parseFloat(item.quantity) || 0;
            const price = parseFloat(item.unit_price) || 0;
            const discount = parseFloat(item.discount_percent) || 0;
            const lineTotal = qty * price * (1 - discount / 100);
            subtotal += lineTotal;
        }

        const taxAmount = parseFloat((subtotal * effectiveTaxRate).toFixed(2));
        const grandTotal = parseFloat((subtotal + taxAmount + parseFloat(additional_expenses)).toFixed(2));

        // Insert invoice
        const invRes = await client.query(`
            INSERT INTO invoices
                (client_id, order_id, invoice_date, due_date, subtotal, tax_rate, tax_amount,
                 additional_expenses, grand_total, status, notes, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'issued', $10, $11)
            RETURNING id, invoice_number
        `, [
            client_id, order_id, invoice_date || new Date().toISOString().split('T')[0],
            due_date, subtotal, effectiveTaxRate, taxAmount,
            additional_expenses, grandTotal, notes, userId,
        ]);

        const invoiceId = invRes.rows[0].id;
        const invoiceNumber = invRes.rows[0].invoice_number;

        // Insert invoice items
        for (const item of items) {
            await client.query(`
                INSERT INTO invoice_items (invoice_id, variant_id, order_item_id, quantity, unit_price, discount_percent)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                invoiceId, item.variant_id, item.order_item_id || null,
                item.quantity, item.unit_price, item.discount_percent || 0,
            ]);
        }

        if (additional_expenses > 0) {
            const label = (additional_expense_label || '').trim() || 'مصاريف إضافية';
            await client.query(`
                INSERT INTO invoice_expenses (invoice_id, expense_type, description, amount)
                VALUES ($1, $2, $3, $4)
            `, [invoiceId, 'additional', label, additional_expenses]);
        }

        // Client transaction record
        await client.query(`
            INSERT INTO client_transactions (client_id, invoice_id, type, amount, description, created_at)
            VALUES ($1, $2, 'invoice', $3, $4, NOW())
        `, [
            client_id, invoiceId, grandTotal,
            `فاتورة مبيعات رقم ${invoiceNumber}`,
        ]);

        await client.query('COMMIT');

        return created(res, { id: invoiceId, invoice_number: invoiceNumber }, 'تم إنشاء الفاتورة بنجاح');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Invoices] POST / error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    } finally {
        client.release();
    }
});

// ── PATCH /api/invoices/:id/status ────────────────────────────────────────────
// Update invoice status (paid, overdue, cancelled, archived).
// When status = 'paid', automatically creates a client_transaction receipt record.
// طلبات التعديل على حالة الفاتورة
router.patch('/:id/status', restrictEdit, validateBody(invoiceStatusUpdate), async (req, res) => {
    const client = await db.pool.connect();
    try {
        const { id } = req.params;
        const { status } = req.validatedBody;

        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        const validStatuses = ['issued', 'paid', 'overdue', 'cancelled', 'archived'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
            });
        }

        // Check invoice exists
        const invRes = await client.query(`
            SELECT id, invoice_number, grand_total, status, client_id
            FROM invoices WHERE id = $1
        `, [id]);

        if (!invRes.rows.length) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        const invoice = invRes.rows[0];

        if (invoice.status === status) {
            return res.status(400).json({ error: `Invoice is already ${status}` });
        }

        await client.query('BEGIN');

        // Update status
        await client.query(`
            UPDATE invoices SET status = $1, updated_at = NOW()
            WHERE id = $2
        `, [status, id]);

        // If marking as paid, create receipt transaction if not already paid
        if (status === 'paid' && invoice.status !== 'paid') {
            await client.query(`
                INSERT INTO client_transactions (client_id, invoice_id, type, amount, description, created_at)
                VALUES ($1, $2, 'receipt', $3, $4, NOW())
            `, [
                invoice.client_id, id, invoice.grand_total,
                `دفعة فاتورة رقم ${invoice.invoice_number}`,
            ]);
        }

        // If cancelling, add note to description
        if (status === 'cancelled') {
            console.log(`[Invoices] Invoice #${invoice.invoice_number} (ID: ${id}) cancelled by user ${req.user?.id || 'unknown'}`);
        }

        await client.query('COMMIT');

        res.json({
            data: { id: parseInt(id), status },
            message: `تم تحديث حالة الفاتورة إلى ${status === 'paid' ? 'مدفوعة' : status === 'overdue' ? 'متأخرة' : status === 'cancelled' ? 'ملغية' : status === 'archived' ? 'مؤرشفة' : status}`,
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Invoices] PATCH /:id/status error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    } finally {
        client.release();
    }
});

module.exports = router;
