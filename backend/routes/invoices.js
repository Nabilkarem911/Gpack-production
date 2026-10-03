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
const idempotency = require('../utils/idempotency');
const { authenticate } = require('../middleware/authMiddleware');
const authorize = require('../middleware/authorize');
const { getVatRate } = require('../utils/settings');
const { encryptToken, decryptShareToken, hashToken, hasShareTokenSecret } = require('../utils/crypto');
const { invoiceCreate, invoiceUpdate, invoiceShare, invoiceStatusUpdate, invoiceMarkIssued, receiptVoucherCreate, validateBody } = require('../utils/validators');

// View permission: all authenticated users with 'sales' view can list/get
router.use(authorize('sales', 'view'));

// Write/Edit permissions
const restrictWrite = authorize('sales', 'create');
const restrictEdit  = authorize('sales', 'edit');

// ── GET /api/invoices ───────────────────────────────────────────────────────
// Query params: client_id, status, source, from, to, search, limit, offset
router.get('/', async (req, res) => {
    try {
        const { client_id, status, source, delivery_status, from, to, search, limit = 50, offset = 0 } = req.query;

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
        if (status === 'warehouse') {
            where.push(`i.source = 'warehouse' AND i.status NOT IN ('archived', 'cancelled') AND COALESCE(i.delivery_status, 'pending') <> 'completed'`);
        } else if (status === 'active') {
            where.push(`(i.status = 'draft' OR (i.source = 'warehouse' AND i.status NOT IN ('archived', 'cancelled') AND COALESCE(i.delivery_status, 'pending') <> 'completed'))`);
        } else if (status === 'archive') {
            where.push(`(i.status = 'archived' OR (i.source <> 'warehouse' AND i.status IN ('issued', 'paid', 'overdue')))`);
        } else if (status) {
            where.push(`i.status = $${paramIdx++}`);
            params.push(status);
        }
        if (delivery_status) {
            where.push(`i.delivery_status = $${paramIdx++}`);
            params.push(delivery_status);
        }
        if (source) {
            where.push(`i.source = $${paramIdx++}`);
            params.push(source);
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
            LEFT JOIN orders o ON o.id = i.order_id
            WHERE ${whereClause}
        `, params);

        // Data query
        const dataRes = await db.query(`
            SELECT
                i.id, i.invoice_number, i.invoice_date, i.due_date,
                i.subtotal, i.tax_rate, i.tax_amount, i.grand_total,
                i.status, i.notes, i.created_at,
                i.source, i.warehouse_id, i.delivery_note_id, i.delivery_status,
                c.id AS client_id, c.name AS client_name,
                parent_c.name AS parent_client_name,
                o.id AS order_id, o.order_number,
                u.name AS created_by_name
            FROM invoices i
            LEFT JOIN clients c ON c.id = i.client_id
            LEFT JOIN clients parent_c ON parent_c.id = c.parent_id
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
                i.subtotal, i.tax_rate, i.tax_amount, i.additional_expenses, i.discount_amount, i.grand_total,
                i.status, i.payment_terms, i.notes, i.created_at,
                i.source, i.external_invoice_number, i.external_issued_at,
                i.warehouse_id, i.delivery_note_id, i.delivery_status,
                c.id AS client_id, c.name AS client_name, c.phone AS client_phone,
                parent_c.name AS parent_client_name,
                o.id AS order_id, o.order_number,
                u.name AS created_by_name
            FROM invoices i
            LEFT JOIN clients c ON c.id = i.client_id
            LEFT JOIN clients parent_c ON parent_c.id = c.parent_id
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
        if (isSalesRep && invoice.order_id) {
            const orderCheck = await db.query(
                'SELECT created_by FROM orders WHERE id = $1',
                [invoice.order_id]
            );
            if (!orderCheck.rows.length || orderCheck.rows[0].created_by !== req.user.id) {
                return res.status(403).json({ error: 'غير مصرح لك بعرض هذه الفاتورة.' });
            }
        }

        // Invoice items (LEFT JOIN so extra free-text lines with variant_id NULL still show)
        const itemsRes = await db.query(`
            SELECT
                ii.id, ii.quantity, ii.unit_price, ii.discount_percent, ii.line_total, ii.source_stock_id,
                ii.item_name, ii.is_extra,
                pv.id AS variant_id, pv.size_name,
                p.id AS product_id, COALESCE(p.name, ii.item_name) AS product_name,
                oi.id AS order_item_id
            FROM invoice_items ii
            LEFT JOIN product_variants pv ON pv.id = ii.variant_id
            LEFT JOIN products p ON p.id = pv.product_id
            LEFT JOIN order_items oi ON oi.id = ii.order_item_id
            WHERE ii.invoice_id = $1
            ORDER BY ii.created_at ASC, ii.id ASC
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
// Returns the public share link for an invoice. Idempotent: a still-valid
// token is reused so copying the link always yields the same URL.
// Body: { expires_days?, regenerate? } — regenerate=true force-rotates the
// token (explicit "change link" action), invalidating the previous URL.
router.post('/:id/share', authenticate, validateBody(invoiceShare), async (req, res) => {
    try {
        const { id } = req.params;
        const expiresDays = req.validatedBody.expires_days || 90;
        const regenerate  = req.validatedBody.regenerate === true;

        const invRes = await db.query(
            `SELECT id, status, share_token, token_expires_at FROM invoices WHERE id = $1`,
            [id]
        );
        if (!invRes.rowCount) {
            return res.status(404).json({ error: 'الفاتورة غير موجودة.' });
        }
        const invoice = invRes.rows[0];
        if (invoice.status === 'cancelled') {
            return res.status(400).json({ error: 'لا يمكن مشاركة فاتورة ملغية.' });
        }

        let plainToken = null;
        let expiresAt  = invoice.token_expires_at ? new Date(invoice.token_expires_at) : null;

        // Reuse the existing token while it is still valid. The stored value
        // may be AES-256-GCM encrypted (new) or plaintext (legacy rows) —
        // decryptShareToken handles both.
        if (!regenerate && invoice.share_token && expiresAt && expiresAt > new Date()) {
            plainToken = decryptShareToken(invoice.share_token);
        }

        if (!plainToken) {
            plainToken = crypto.randomBytes(32).toString('hex');
            expiresAt  = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000);

            let storedToken = plainToken;
            let tokenHash;
            try {
                storedToken = encryptToken(plainToken);
                tokenHash   = hashToken(plainToken);
            } catch (cryptoErr) {
                console.error('[Invoices] share crypto error:', cryptoErr.message);
                tokenHash   = crypto.createHmac('sha256', plainToken).digest('hex');
                storedToken = plainToken;
            }

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
                        [plainToken, expiresAt, id]
                    );
                } else {
                    throw dbErr;
                }
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

router.post('/:id/release', restrictEdit, async (req, res) => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const invRes = await client.query(
            `SELECT i.id, i.invoice_number, i.client_id, i.warehouse_id, i.source, i.status,
                    i.delivery_note_id, i.notes,
                    c.name AS client_name, w.name AS warehouse_name
             FROM invoices i
             LEFT JOIN clients c ON c.id = i.client_id
             LEFT JOIN warehouses w ON w.id = i.warehouse_id
             WHERE i.id = $1 FOR UPDATE`,
            [req.params.id]
        );
        if (!invRes.rowCount) throw new Error('الفاتورة غير موجودة.');
        const invoice = invRes.rows[0];
        if (invoice.source !== 'warehouse') throw new Error('إصدار أمر الفسح متاح لفواتير المخزن فقط.');
        if (invoice.delivery_note_id) throw new Error('تم إصدار أمر الفسح لهذه الفاتورة مسبقًا.');
        if (!invoice.warehouse_id) throw new Error('لا يوجد مستودع مرتبط بالفاتورة.');

        const itemsRes = await client.query(
            `SELECT ii.variant_id, ii.quantity, ii.source_stock_id,
                    p.name AS product_name, pv.size_name
             FROM invoice_items ii
             JOIN product_variants pv ON pv.id = ii.variant_id
             JOIN products p ON p.id = pv.product_id
             WHERE ii.invoice_id = $1
             ORDER BY ii.id`,
            [invoice.id]
        );
        if (!itemsRes.rowCount) throw new Error('الفاتورة لا تحتوي على أصناف.');

        const noteRes = await client.query(
            `INSERT INTO delivery_notes (client_id, warehouse_id, invoice_id, status, notes, created_by)
             VALUES ($1, $2, $3, 'pending', $4, $5)
             RETURNING id, note_number`,
            [invoice.client_id, invoice.warehouse_id, invoice.id, invoice.notes || null, req.user?.id || null]
        );
        const deliveryNote = noteRes.rows[0];

        for (const item of itemsRes.rows) {
            await client.query(
                `INSERT INTO delivery_note_items
                    (delivery_note_id, variant_id, requested_qty, delivered_qty, source_stock_id, notes, created_at)
                 VALUES ($1, $2, $3, 0, $4, NULL, NOW())`,
                [deliveryNote.id, item.variant_id, item.quantity, item.source_stock_id || null]
            );
        }

        await client.query(
            `UPDATE invoices SET delivery_note_id = $1, delivery_status = 'pending' WHERE id = $2`,
            [deliveryNote.id, invoice.id]
        );
        await client.query('COMMIT');

        // Keep WhatsApp notification outside the transaction: a provider failure
        // must not roll back the delivery note or invoice linkage.
        try {
            const itemsSummary = itemsRes.rows
                .map(item => `• ${item.product_name || 'صنف'}${item.size_name ? ` (${item.size_name})` : ''} — ${parseFloat(item.quantity)}`)
                .join('\\n');
            const NotificationService = require('../services/notification-service');
            await NotificationService.notifyReleaseOrderCreated({
                order_number: invoice.invoice_number,
                delivery_note_id: deliveryNote.id,
                delivery_note_number: deliveryNote.note_number,
                client_name: invoice.client_name,
                items_summary: itemsSummary,
                warehouse_name: invoice.warehouse_name,
            });
        } catch (notifyErr) {
            console.error('[Invoices] Release notification error:', notifyErr.message);
        }

        return res.status(201).json({
            success: true,
            data: { delivery_note_id: deliveryNote.id, note_number: deliveryNote.note_number },
            message: 'تم إصدار أمر الفسح وإرساله إلى سندات التسليم.',
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Invoices] POST /:id/release error:', err.message);
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

router.post('/:id/payment', restrictEdit, validateBody(receiptVoucherCreate), async (req, res) => {
    const client = await db.pool.connect();
    try {
        const { amount, payment_method = 'cash', description = null, reference_number = null, client_id, cash_account_id = null, voucher_date = null } = req.validatedBody;
        if (!cash_account_id) {
            return res.status(400).json({ error: 'يجب اختيار حساب الصندوق/البنك المستلم للدفعة.' });
        }
        await client.query('BEGIN');
        const invRes = await client.query(
            `SELECT id, invoice_number, client_id, order_id, grand_total, status
             FROM invoices WHERE id = $1 FOR UPDATE`,
            [req.params.id]
        );
        if (!invRes.rowCount) throw new Error('الفاتورة غير موجودة.');
        const invoice = invRes.rows[0];
        if (client_id !== invoice.client_id) throw new Error('العميل لا يطابق الفاتورة.');
        if (['cancelled', 'archived'].includes(invoice.status)) throw new Error('لا يمكن تسجيل دفعة على فاتورة ملغية أو مؤرشفة.');

        const cashAccRes = await client.query(
            `SELECT id FROM accounts
             WHERE id = $1 AND is_active = true
               AND (code IN ('1100','1200') OR parent_id IN (SELECT id FROM accounts WHERE code IN ('1100','1200')))`,
            [cash_account_id]
        );
        if (!cashAccRes.rowCount) throw new Error('حساب الصندوق/البنك المختار غير صالح.');

        const arRes = await client.query(`SELECT id FROM accounts WHERE code = '1300' LIMIT 1`);
        if (!arRes.rowCount) throw new Error('حساب المدينون (1300) غير موجود في دليل الحسابات.');
        const arAccountId = arRes.rows[0].id;

        // Payments recorded on the parent order count toward this invoice —
        // but only when the order maps to a single active invoice. Orders
        // with sibling active invoices are ambiguous: refuse rather than guess.
        if (invoice.order_id) {
            const ambRes = await client.query(
                `SELECT EXISTS(SELECT 1 FROM client_transactions
                               WHERE order_id = $2 AND type IN ('payment','receipt')) AS has_order_pay,
                        EXISTS(SELECT 1 FROM invoices s
                               WHERE s.order_id = $2 AND s.id <> $1
                                 AND s.status IN ('issued','overdue')) AS has_siblings`,
                [invoice.id, invoice.order_id]
            );
            if (ambRes.rows[0].has_order_pay && ambRes.rows[0].has_siblings) {
                throw new Error('الطلب مرتبط بأكثر من فاتورة نشطة وله دفعات مسجلة — راجع الفواتير المكررة لهذا الطلب قبل تسجيل تحصيل.');
            }
        }
        const paidRes = await client.query(
            `SELECT COALESCE(SUM(amount), 0) AS paid
             FROM client_transactions
             WHERE type IN ('payment', 'receipt')
               AND (invoice_id = $1
                    OR (order_id = $2
                        AND NOT EXISTS (
                            SELECT 1 FROM invoices s
                            WHERE s.order_id = $2 AND s.id <> $1
                              AND s.status IN ('issued','overdue'))))`,
            [invoice.id, invoice.order_id]
        );
        const paid = parseFloat(paidRes.rows[0].paid || 0);
        const remaining = Math.max(0, parseFloat(invoice.grand_total || 0) - paid);
        if (parseFloat(amount) > remaining) throw new Error(`الدفعة تتجاوز المتبقي (${remaining.toFixed(2)}).`);

        const voucherRes = await client.query(
            `INSERT INTO accounting_vouchers
                (voucher_type, voucher_date, description, total_amount, status, reference_type, reference_id, created_by)
             VALUES ('receipt', COALESCE($4::date, CURRENT_DATE), $1, $2, 'posted', 'invoice', $3, $5)
             RETURNING id, voucher_number`,
            [
                description || `دفعة فاتورة رقم ${invoice.invoice_number}`,
                amount,
                invoice.id,
                voucher_date || null,
                req.user?.id || null,
            ]
        );
        const voucherId = voucherRes.rows[0].id;

        await client.query(
            `INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, description)
             VALUES ($1, $2, $3, 0, $4)`,
            [voucherId, cash_account_id, amount, `تحصيل دفعة — فاتورة #${invoice.invoice_number}`]
        );
        await client.query(
            `INSERT INTO accounting_voucher_lines
                (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
             VALUES ($1, $2, 0, $3, 'client', $4, $5)`,
            [voucherId, arAccountId, amount, invoice.client_id, `تسوية ذمة العميل — فاتورة #${invoice.invoice_number}`]
        );

        await client.query(
            `INSERT INTO client_transactions
                (client_id, invoice_id, type, amount, payment_method, document_number, description, linked_voucher_id, created_at)
             VALUES ($1, $2, 'receipt', $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()))`,
            [invoice.client_id, invoice.id, amount, payment_method, reference_number || null, description || `دفعة فاتورة رقم ${invoice.invoice_number}`, voucherId, voucher_date || null]
        );
        const newPaid = paid + parseFloat(amount);
        if (newPaid >= parseFloat(invoice.grand_total || 0)) {
            await client.query(`UPDATE invoices SET status = 'paid' WHERE id = $1`, [invoice.id]);
        }
        await client.query('COMMIT');
        return res.status(201).json({
            success: true,
            data: { invoice_id: invoice.id, paid: newPaid, remaining: Math.max(0, parseFloat(invoice.grand_total || 0) - newPaid), status: newPaid >= parseFloat(invoice.grand_total || 0) ? 'paid' : invoice.status },
            message: 'تم تسجيل الدفعة بنجاح.',
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Invoices] POST /:id/payment error:', err.message);
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

router.delete('/:id', restrictEdit, async (req, res) => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const invRes = await client.query(
            `SELECT id, invoice_number, client_id, source, status, grand_total, delivery_note_id, delivery_status
             FROM invoices WHERE id = $1 FOR UPDATE`,
            [req.params.id]
        );
        if (!invRes.rowCount) throw new Error('الفاتورة غير موجودة.');
        const invoice = invRes.rows[0];

        const paymentRes = await client.query(
            `SELECT 1 FROM client_transactions
             WHERE invoice_id = $1 AND type IN ('payment', 'receipt') LIMIT 1`,
            [invoice.id]
        );
        if (paymentRes.rowCount || invoice.status === 'paid') {
            throw new Error('لا يمكن إلغاء الفاتورة لوجود دفعات مرتبطة بها.');
        }

        const returnRes = await client.query(
            `SELECT 1 FROM sales_returns WHERE invoice_id = $1 AND status = 'completed' LIMIT 1`,
            [invoice.id]
        );
        if (returnRes.rowCount) throw new Error('لا يمكن إلغاء الفاتورة لوجود مرتجع مبيعات مكتمل.');

        const voucherRes = await client.query(
            `SELECT 1 FROM accounting_vouchers
             WHERE reference_type = 'invoice' AND reference_id = $1 AND status = 'posted'
             LIMIT 1`,
            [invoice.id]
        );
        if (voucherRes.rowCount) throw new Error('لا يمكن إلغاء الفاتورة لوجود قيد محاسبي مرحّل مرتبط بها.');

        const isFinalProduction = invoice.source === 'sales_invoices'
            && ['issued', 'overdue', 'archived'].includes(invoice.status);
        const isFinalWarehouse = invoice.source === 'warehouse'
            && ['archived', 'issued'].includes(invoice.status)
            && Boolean(invoice.delivery_note_id);
        const isProforma = invoice.source === 'warehouse'
            && invoice.status === 'issued'
            && !invoice.delivery_note_id;

        if (!isFinalProduction && !isFinalWarehouse && !isProforma) {
            throw new Error('لا يمكن إلغاء هذه الفاتورة في حالتها الحالية.');
        }
        if (isFinalWarehouse && invoice.delivery_status !== 'pending') {
            throw new Error('يجب عكس التسليم وإرجاع المخزون أولًا قبل إلغاء الفاتورة.');
        }

        if (isProforma) {
            const itemsRes = await client.query(
                `SELECT source_stock_id, quantity FROM invoice_items WHERE invoice_id = $1`,
                [invoice.id]
            );
            for (const item of itemsRes.rows) {
                if (item.source_stock_id) {
                    await client.query(
                        `UPDATE warehouse_stock
                         SET reserved_qty = GREATEST(0, reserved_qty - $1), last_updated = NOW()
                         WHERE id = $2`,
                        [item.quantity, item.source_stock_id]
                    );
                }
            }
            await client.query(`DELETE FROM client_transactions WHERE invoice_id = $1`, [invoice.id]);
            await client.query(`DELETE FROM invoice_expenses WHERE invoice_id = $1`, [invoice.id]);
            await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoice.id]);
            await client.query(`DELETE FROM invoices WHERE id = $1`, [invoice.id]);
            await client.query('COMMIT');
            return res.json({ success: true, message: 'تم حذف الفاتورة الأولية وإرجاع الحجز للمخزون.' });
        }

        // Final invoices are cancelled logically and retain their full audit trail.
        if (isFinalWarehouse) {
            await client.query(
                `UPDATE delivery_notes SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
                [invoice.delivery_note_id]
            );
        }
        await client.query(
            `UPDATE invoices SET status = 'cancelled', delivery_status = 'cancelled', updated_at = NOW() WHERE id = $1`,
            [invoice.id]
        );
        await client.query(
            `INSERT INTO client_transactions
                (client_id, invoice_id, type, amount, description, created_at)
             VALUES ($1, $2, 'invoice_reversal', $3, $4, NOW())`,
            [invoice.client_id, invoice.id, -Math.abs(parseFloat(invoice.grand_total || 0)), `عكس فاتورة مبيعات رقم ${invoice.invoice_number}`]
        );
        await client.query(
            `INSERT INTO audit_logs
                (table_name, record_id, action, old_data, new_data, user_id, user_name, ip_address, user_agent)
             VALUES ($1, $2, 'CANCEL', $3::jsonb, $4::jsonb, $5, $6, $7, $8)`,
            [
                'invoices', invoice.id,
                JSON.stringify({ status: invoice.status, delivery_status: invoice.delivery_status, grand_total: invoice.grand_total }),
                JSON.stringify({ status: 'cancelled', reversal_amount: -Math.abs(parseFloat(invoice.grand_total || 0)), delivery_reversed: isFinalWarehouse }),
                req.user?.id || null,
                req.user?.name || req.user?.username || null,
                req.ip || req.connection?.remoteAddress || null,
                req.headers?.['user-agent'] || null,
            ]
        );
        await client.query('COMMIT');
        return res.json({ success: true, message: 'تم إلغاء الفاتورة منطقيًا وإنشاء الأثر العكسي.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Invoices] DELETE /:id error:', err.message);
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
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
            warehouse_id = null,
            source = 'sales_invoices',
            invoice_date,
            due_date,
            items = [],
            tax_rate,
            additional_expenses = 0,
            additional_expense_label = null,
            discount_amount = 0,
            notes = '',
        } = req.validatedBody;

        const effectiveTaxRate = tax_rate ?? await getVatRate();

        if (!client_id || !items.length) {
            return res.status(400).json({ error: 'client_id and items[] required' });
        }

        const userId = req.user?.id || null;

        await client.query('BEGIN');

        // Durable idempotency: a retried create (network retry, double-click
        // that beat the button lock) replays the stored response instead of
        // creating a second invoice. Optional — requests without a key keep
        // working exactly as before.
        const idemKey = req.get('Idempotency-Key') || req.validatedBody?.idempotency_key || req.body?.idempotency_key || null;
        const idem = await idempotency.claim(client, idemKey, 'POST /api/invoices', userId);
        if (idem.mode === 'replay') {
            await client.query('COMMIT');
            return res.status(idem.status).json(idem.body);
        }

        // Calculate totals
        let subtotal = 0;
        for (const item of items) {
            const qty = parseFloat(item.quantity) || 0;
            const price = parseFloat(item.unit_price) || 0;
            const discount = parseFloat(item.discount_percent) || 0;
            const lineTotal = qty * price * (1 - discount / 100);
            subtotal += lineTotal;
        }

        const discount = parseFloat(discount_amount || 0);
        const taxAmount = parseFloat((subtotal * effectiveTaxRate).toFixed(2));
        const grandTotal = parseFloat((subtotal + taxAmount + parseFloat(additional_expenses) - discount).toFixed(2));

        const isWarehouseInvoice = source === 'warehouse' || Boolean(warehouse_id);
        const invoiceSource = isWarehouseInvoice ? 'warehouse' : 'sales_invoices';
        const status = isWarehouseInvoice ? 'issued' : 'draft';

        // One order → at most one active invoice + one draft. Blocks the
        // duplicate-invoice path that produced repeated issued invoices on
        // the same order. The FOR UPDATE lock serializes concurrent creates
        // on the same order so two requests cannot both pass the check.
        if (order_id) {
            await client.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [order_id]);
            const dupStatuses = isWarehouseInvoice ? ['issued', 'overdue'] : ['draft'];
            const dupRes = await client.query(
                `SELECT invoice_number, status FROM invoices
                 WHERE order_id = $1 AND status = ANY($2::text[]) LIMIT 1`,
                [order_id, dupStatuses]
            );
            if (dupRes.rowCount) {
                const d = dupRes.rows[0];
                throw new Error(`يوجد بالفعل فاتورة ${d.status === 'draft' ? 'أولية' : 'نهائية'} لهذا الطلب (رقم ${d.invoice_number}). لا يمكن إصدار فاتورة ثانية على نفس الطلب.`);
            }
        }

        if (isWarehouseInvoice) {
            if (!warehouse_id) throw new Error('يجب اختيار المستودع.');
            const warehouseRes = await client.query(
                `SELECT id FROM warehouses
                 WHERE id = $1
                   AND (client_id = $2 OR client_id = (SELECT parent_id FROM clients WHERE id = $2))`,
                [warehouse_id, client_id]
            );
            if (warehouseRes.rowCount === 0) throw new Error('المستودع غير مرتبط بالعميل المحدد.');

            for (const item of items) {
                const stockRes = await client.query(
                    `SELECT ws.id, ws.quantity, ws.reserved_qty
                     FROM warehouse_stock ws
                     WHERE ws.id = COALESCE($1::uuid, ws.id)
                       AND ws.warehouse_id = $2
                       AND ws.variant_id = $3
                       AND (
                           ws.client_id = $4
                           OR ws.client_id IS NULL
                           OR ws.client_id = (SELECT parent_id FROM clients WHERE id = $4)
                           OR ws.client_id IN (SELECT id FROM clients WHERE parent_id = $4)
                       )
                     FOR UPDATE`,
                    [item.stock_id || null, warehouse_id, item.variant_id, client_id]
                );
                if (stockRes.rowCount === 0) throw new Error('سجل المخزون غير موجود في المستودع المحدد.');
                const stock = stockRes.rows[0];
                const available = parseFloat(stock.quantity || 0) - parseFloat(stock.reserved_qty || 0);
                if (parseFloat(item.quantity) > available) {
                    throw new Error(`الكمية المطلوبة تتجاوز المتاح للصنف (${available}).`);
                }
                item.stock_id = stock.id;
                await client.query(
                    `UPDATE warehouse_stock SET reserved_qty = reserved_qty + $1, last_updated = NOW() WHERE id = $2`,
                    [item.quantity, stock.id]
                );
            }
        }

        // Insert invoice
        const invRes = await client.query(`
            INSERT INTO invoices
                (client_id, order_id, warehouse_id, invoice_date, due_date, subtotal, tax_rate, tax_amount,
                 additional_expenses, discount_amount, grand_total, status, source, delivery_status, notes, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING id, invoice_number
        `, [
            client_id, order_id, isWarehouseInvoice ? warehouse_id : null,
            invoice_date || new Date().toISOString().split('T')[0], due_date,
            subtotal, effectiveTaxRate, taxAmount, additional_expenses, discount,
            grandTotal, status, invoiceSource, isWarehouseInvoice ? 'pending' : 'none', notes, userId,
        ]);

        const invoiceId = invRes.rows[0].id;
        const invoiceNumber = invRes.rows[0].invoice_number;

        // Insert invoice items
        for (const item of items) {
            await client.query(`
                INSERT INTO invoice_items (invoice_id, variant_id, order_item_id, source_stock_id, quantity, unit_price, discount_percent)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                invoiceId, item.variant_id, item.order_item_id || null, item.stock_id || null,
                item.quantity, item.unit_price, item.discount_percent || 0,
            ]);
        }

        const deliveryNoteId = null;

        if (additional_expenses > 0) {
            const label = (additional_expense_label || '').trim() || 'مصاريف إضافية';
            await client.query(`
                INSERT INTO invoice_expenses (invoice_id, expense_type, description, amount)
                VALUES ($1, $2, $3, $4)
            `, [invoiceId, 'additional', label, additional_expenses]);
        }

        // An issued invoice linked to an order counts as its final invoice:
        // clear the manual closed-without-invoice flag if it was set.
        if (order_id && status === 'issued') {
            await client.query(
                `UPDATE orders
                 SET closed_without_invoice = FALSE, closed_at = NULL, closed_by = NULL, updated_at = NOW()
                 WHERE id = $1 AND closed_without_invoice = TRUE`,
                [order_id]
            );
        }

        // Client transaction record (only for invoices that affect the account statement)
        if (source !== 'sales_invoices') {
            await client.query(`
                INSERT INTO client_transactions (client_id, invoice_id, type, amount, description, created_at)
                VALUES ($1, $2, 'invoice', $3, $4, NOW())
            `, [
                client_id, invoiceId, grandTotal,
                `فاتورة مبيعات رقم ${invoiceNumber}`,
            ]);
        }

        const responseBody = {
            success: true,
            data: { id: invoiceId, invoice_number: invoiceNumber, delivery_note_id: deliveryNoteId },
            message: 'تم إنشاء الفاتورة بنجاح',
        };
        await idempotency.store(client, idemKey, 201, responseBody);
        await client.query('COMMIT');

        return res.status(201).json(responseBody);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Invoices] POST / error:', err.message);
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ── PATCH /api/invoices/:id/mark-issued ─────────────────────────────────────
// Marks a sales-invoices-page invoice as issued in Onyx.
// Does NOT post to the client account statement.
router.patch('/:id/mark-issued', restrictEdit, validateBody(invoiceMarkIssued), async (req, res) => {
    const { id } = req.params;
    const { external_invoice_number } = req.validatedBody;

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const invRes = await client.query(
            `SELECT id, invoice_number, source, status, order_id FROM invoices WHERE id = $1 FOR UPDATE`,
            [id]
        );
        if (invRes.rowCount === 0) throw new Error('الفاتورة غير موجودة.');
        const inv = invRes.rows[0];
        if (inv.source !== 'sales_invoices') {
            throw new Error('لا يمكن اعتماد فاتورة أمر التشغيل من هنا.');
        }

        // Issuing a draft on an order that already has an active invoice
        // would create a second one — the duplicate-invoice bug seen in prod.
        if (inv.order_id) {
            const dupRes = await client.query(
                `SELECT invoice_number FROM invoices
                 WHERE order_id = $1 AND id <> $2 AND status IN ('issued','overdue') LIMIT 1`,
                [inv.order_id, id]
            );
            if (dupRes.rowCount) {
                throw new Error(`يوجد بالفعل فاتورة نشطة لهذا الطلب (رقم ${dupRes.rows[0].invoice_number}). لا يمكن اعتماد فاتورة ثانية.`);
            }
        }

        const updated = await client.query(`
            UPDATE invoices
            SET status = 'issued',
                external_invoice_number = $1,
                external_issued_at = NOW()
            WHERE id = $2
            RETURNING id, invoice_number, status, external_invoice_number, external_issued_at
        `, [external_invoice_number || null, id]);

        // Invoice is now issued and order-linked: it counts as the order's
        // final invoice — clear the manual closed-without-invoice flag, and
        // seal the order's unlinked payments onto it (same 1:1 rule as
        // migration 101).
        if (inv.order_id) {
            await client.query(
                `UPDATE orders
                 SET closed_without_invoice = FALSE, closed_at = NULL, closed_by = NULL, updated_at = NOW()
                 WHERE id = $1 AND closed_without_invoice = TRUE`,
                [inv.order_id]
            );
            await client.query(
                `UPDATE client_transactions ct
                 SET invoice_id = i.id
                 FROM invoices i
                 WHERE ct.invoice_id IS NULL
                   AND ct.order_id = i.order_id
                   AND i.order_id = $1
                   AND i.status IN ('issued','overdue')
                   AND (SELECT count(*) FROM invoices x
                         WHERE x.order_id = i.order_id
                           AND x.status IN ('issued','overdue')) = 1`,
                [inv.order_id]
            );
        }

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            data: updated.rows[0],
            message: 'تم تسجيل إصدار الفاتورة.',
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Invoices] PATCH /:id/mark-issued error:', err.message);
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ── PUT /api/invoices/:id ────────────────────────────────────────────────────
// Edit invoice content (items, prices, notes, discount, expenses).
// Only invoices with status 'draft' (proforma) can be edited.
router.put('/:id', restrictEdit, validateBody(invoiceUpdate), async (req, res) => {
    const client = await db.pool.connect();
    try {
        const { id } = req.params;
        const {
            invoice_date,
            due_date,
            tax_rate,
            additional_expenses = 0,
            additional_expense_label = null,
            discount_amount = 0,
            notes = '',
            items = [],
        } = req.validatedBody;

        await client.query('BEGIN');

        // Check invoice exists and is editable
        const invRes = await client.query(`
            SELECT id, invoice_number, status, client_id, order_id, source, warehouse_id, delivery_note_id
            FROM invoices WHERE id = $1 FOR UPDATE
        `, [id]);

        if (!invRes.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Invoice not found' });
        }

        const invoice = invRes.rows[0];
        const isUnreleasedWarehouse = invoice.source === 'warehouse' && invoice.status === 'issued' && !invoice.delivery_note_id;
        const isFinalProductionInvoice = invoice.source === 'sales_invoices'
            && ['issued', 'overdue'].includes(invoice.status)
            && !invoice.delivery_note_id;
        const isDraftInvoice = invoice.status === 'draft';

        if (invoice.status === 'paid' || invoice.status === 'cancelled' || (!isDraftInvoice && !isUnreleasedWarehouse && !isFinalProductionInvoice)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'لا يمكن تعديل هذه الفاتورة بعد الدفع أو إصدار أمر الفسح.' });
        }

        if (isFinalProductionInvoice) {
            const existingItemsRes = await client.query(
                `SELECT variant_id, order_item_id, quantity
                 FROM invoice_items
                 WHERE invoice_id = $1
                 ORDER BY created_at ASC, id ASC`,
                [id]
            );
            const quantitiesChanged = existingItemsRes.rows.length !== items.length
                || existingItemsRes.rows.some((oldItem, index) => {
                    const newItem = items[index];
                    return !newItem
                        || String(oldItem.variant_id) !== String(newItem.variant_id)
                        || String(oldItem.order_item_id || '') !== String(newItem.order_item_id || '')
                        || Math.abs(parseFloat(oldItem.quantity) - parseFloat(newItem.quantity)) > 0.000001;
                });
            if (quantitiesChanged) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'يمكن تعديل سعر الفاتورة النهائية فقط، ولا يمكن تعديل الكميات.' });
            }

            const paymentRes = await client.query(
                `SELECT 1 FROM client_transactions WHERE invoice_id = $1 AND type IN ('payment', 'receipt') LIMIT 1`,
                [id]
            );
            if (paymentRes.rowCount) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'لا يمكن تعديل فاتورة عليها دفعات.' });
            }
            const returnRes = await client.query(
                `SELECT 1 FROM sales_returns WHERE invoice_id = $1 AND status = 'completed' LIMIT 1`,
                [id]
            );
            if (returnRes.rowCount) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'لا يمكن تعديل فاتورة مرتبطة بمرتجع مكتمل.' });
            }
        }

        const effectiveTaxRate = tax_rate ?? await getVatRate();

        if (isUnreleasedWarehouse) {
            const oldItemsRes = await client.query(
                `SELECT source_stock_id, quantity FROM invoice_items WHERE invoice_id = $1`,
                [id]
            );
            for (const oldItem of oldItemsRes.rows) {
                if (oldItem.source_stock_id) {
                    await client.query(
                        `UPDATE warehouse_stock SET reserved_qty = GREATEST(0, reserved_qty - $1), last_updated = NOW() WHERE id = $2`,
                        [oldItem.quantity, oldItem.source_stock_id]
                    );
                }
            }
            for (const item of items) {
                if (!item.stock_id) throw new Error('يجب تحديد سجل المخزون لكل صنف.');
                const stockRes = await client.query(
                    `SELECT id, quantity, reserved_qty FROM warehouse_stock
                     WHERE id = $1 AND warehouse_id = $2 AND variant_id = $3
                       AND (client_id = $4 OR client_id IS NULL OR client_id = (SELECT parent_id FROM clients WHERE id = $4) OR client_id IN (SELECT id FROM clients WHERE parent_id = $4))
                     FOR UPDATE`,
                    [item.stock_id, invoice.warehouse_id, item.variant_id, invoice.client_id]
                );
                if (!stockRes.rowCount) throw new Error('سجل المخزون غير موجود لهذا الصنف.');
                const available = parseFloat(stockRes.rows[0].quantity || 0) - parseFloat(stockRes.rows[0].reserved_qty || 0);
                if (parseFloat(item.quantity) > available) throw new Error(`الكمية المطلوبة تتجاوز المتاح (${available}).`);
                await client.query(
                    `UPDATE warehouse_stock SET reserved_qty = reserved_qty + $1, last_updated = NOW() WHERE id = $2`,
                    [item.quantity, item.stock_id]
                );
            }
        }

        // Calculate new totals
        let subtotal = 0;
        for (const item of items) {
            const qty = parseFloat(item.quantity) || 0;
            const price = parseFloat(item.unit_price) || 0;
            const discount = parseFloat(item.discount_percent) || 0;
            const lineTotal = qty * price * (1 - discount / 100);
            subtotal += lineTotal;
        }
        const discount = parseFloat(discount_amount || 0);
        const taxAmount = parseFloat((subtotal * effectiveTaxRate).toFixed(2));
        const addExp = parseFloat(additional_expenses || 0);
        const grandTotal = parseFloat((subtotal + taxAmount + addExp - discount).toFixed(2));

        // Update invoice header
        await client.query(`
            UPDATE invoices
            SET subtotal = $1, tax_rate = $2, tax_amount = $3,
                additional_expenses = $4, discount_amount = $5, grand_total = $6,
                notes = $7, due_date = $8,
                invoice_date = COALESCE($9, invoice_date)
            WHERE id = $10
        `, [subtotal, effectiveTaxRate, taxAmount, addExp, discount, grandTotal,
            notes || null, due_date || null, invoice_date || null, id]);

        // Delete old items and insert new ones (extra lines are free-text: variant_id NULL)
        await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [id]);
        for (const item of items) {
            const qty = parseFloat(item.quantity) || 0;
            const price = parseFloat(item.unit_price) || 0;
            const disc = parseFloat(item.discount_percent) || 0;
            const isExtra = item.is_extra === true;
            if (isExtra && !(item.item_name || '').trim()) {
                throw new Error('البند الإضافي يتطلب اسم الصنف.');
            }
            await client.query(`
                INSERT INTO invoice_items (invoice_id, variant_id, order_item_id, source_stock_id, quantity, unit_price, discount_percent, item_name, is_extra)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [id, isExtra ? null : item.variant_id, item.order_item_id || null, isUnreleasedWarehouse ? item.stock_id : null, qty, price, disc,
                isExtra ? (item.item_name || '').trim() : null, isExtra]);
        }

        // Delete old expenses and insert new one
        await client.query('DELETE FROM invoice_expenses WHERE invoice_id = $1', [id]);
        if (addExp > 0) {
            const label = (additional_expense_label || '').trim() || 'مصاريف إضافية';
            await client.query(`
                INSERT INTO invoice_expenses (invoice_id, expense_type, description, amount)
                VALUES ($1, $2, $3, $4)
            `, [id, 'additional', label, addExp]);
        }

        // Update client_transactions amount for this invoice
        await client.query(`
            UPDATE client_transactions
            SET amount = $1
            WHERE invoice_id = $2 AND type = 'invoice'
        `, [grandTotal, id]);

        await client.query('COMMIT');

        res.json({
            data: { id, invoice_number: invoice.invoice_number, grand_total: grandTotal },
            message: 'تم تعديل الفاتورة بنجاح',
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Invoices] PUT /:id error:', err.message);
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
            SELECT id, invoice_number, grand_total, status, client_id, order_id
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

        // An order may have at most one active (issued-family) invoice —
        // refuse to activate a second one (multi-invoice duplicate guard).
        if (status === 'issued' && invoice.status !== 'issued' && invoice.order_id) {
            const dupRes = await client.query(
                `SELECT invoice_number FROM invoices
                 WHERE order_id = $1 AND id <> $2
                   AND status IN ('issued','overdue') LIMIT 1`,
                [invoice.order_id, id]
            );
            if (dupRes.rowCount) {
                throw new Error(`لا يمكن إصدار الفاتورة — الطلب له فاتورة نشطة بالفعل (رقم ${dupRes.rows[0].invoice_number}).`);
            }
        }

        // Update status
        await client.query(`
            UPDATE invoices SET status = $1
            WHERE id = $2
        `, [status, id]);

        // An order-linked invoice reaching 'issued' counts as the order's
        // final invoice — clear the manual closed-without-invoice flag,
        // and seal the order's unlinked payments onto the invoice (same
        // 1:1 rule as migration 101).
        if (status === 'issued' && invoice.order_id) {
            await client.query(`
                UPDATE orders
                SET closed_without_invoice = FALSE, closed_at = NULL, closed_by = NULL, updated_at = NOW()
                WHERE id = $1 AND closed_without_invoice = TRUE
            `, [invoice.order_id]);
            await client.query(
                `UPDATE client_transactions ct
                 SET invoice_id = i.id
                 FROM invoices i
                 WHERE ct.invoice_id IS NULL
                   AND ct.order_id = i.order_id
                   AND i.order_id = $1
                   AND i.status IN ('issued','overdue')
                   AND (SELECT count(*) FROM invoices x
                         WHERE x.order_id = i.order_id
                           AND x.status IN ('issued','overdue')) = 1`,
                [invoice.order_id]
            );
        }

        // If marking as paid, create receipt transaction if not already paid
        if (status === 'paid' && invoice.status !== 'paid') {
            // Marking paid must record an actual collection for the remaining
            // balance only — never the full amount, never without a voucher.
            // Payments recorded on the parent order count toward this invoice
            // only when the order has no sibling active invoice — otherwise
            // the mapping is ambiguous and we refuse rather than guess.
            if (invoice.order_id) {
                const ambRes = await client.query(
                    `SELECT EXISTS(SELECT 1 FROM client_transactions
                                   WHERE order_id = $2 AND type IN ('payment','receipt')) AS has_order_pay,
                            EXISTS(SELECT 1 FROM invoices s
                                   WHERE s.order_id = $2 AND s.id <> $1
                                     AND s.status IN ('issued','overdue')) AS has_siblings`,
                    [id, invoice.order_id]
                );
                if (ambRes.rows[0].has_order_pay && ambRes.rows[0].has_siblings) {
                    throw new Error('الطلب مرتبط بأكثر من فاتورة نشطة وله دفعات مسجلة — راجع الفواتير المكررة لهذا الطلب قبل تسجيل تحصيل.');
                }
            }
            const paidRes = await client.query(
                `SELECT COALESCE(SUM(amount), 0) AS paid
                 FROM client_transactions
                 WHERE type IN ('payment', 'receipt')
                   AND (invoice_id = $1
                        OR (order_id = $2
                            AND NOT EXISTS (
                                SELECT 1 FROM invoices s
                                WHERE s.order_id = $2 AND s.id <> $1
                                  AND s.status IN ('issued','overdue'))))`,
                [id, invoice.order_id]
            );
            const alreadyPaid = parseFloat(paidRes.rows[0].paid || 0);
            const remaining = Math.round((parseFloat(invoice.grand_total || 0) - alreadyPaid) * 100) / 100;

            if (remaining > 0) {
                const { payment_method = 'cash', cash_account_id, payment_date, reference_number } = req.validatedBody;
                if (!cash_account_id) {
                    throw new Error(`الفاتورة عليها متبقٍ (${remaining.toFixed(2)}) — حدد حساب الصندوق/البنك لتسجيل تحصيله أولاً أو سجّل دفعة صريحة.`);
                }

                const cashAccRes = await client.query(
                    `SELECT id FROM accounts
                     WHERE id = $1 AND is_active = true
                       AND (code IN ('1100','1200') OR parent_id IN (SELECT id FROM accounts WHERE code IN ('1100','1200')))`,
                    [cash_account_id]
                );
                if (!cashAccRes.rowCount) throw new Error('حساب الصندوق/البنك المختار غير صالح.');

                const arRes = await client.query(`SELECT id FROM accounts WHERE code = '1300' LIMIT 1`);
                if (!arRes.rowCount) throw new Error('حساب المدينون (1300) غير موجود في دليل الحسابات.');

                const voucherRes = await client.query(
                    `INSERT INTO accounting_vouchers
                        (voucher_type, voucher_date, description, total_amount, status, reference_type, reference_id, created_by)
                     VALUES ('receipt', COALESCE($4::date, CURRENT_DATE), $1, $2, 'posted', 'invoice', $3, $5)
                     RETURNING id, voucher_number`,
                    [
                        `تحصيل متبقي — فاتورة رقم ${invoice.invoice_number}`,
                        remaining,
                        id,
                        payment_date || null,
                        req.user?.id || null,
                    ]
                );
                const voucherId = voucherRes.rows[0].id;

                await client.query(
                    `INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, description)
                     VALUES ($1, $2, $3, 0, $4)`,
                    [voucherId, cash_account_id, remaining, `تحصيل متبقي — فاتورة #${invoice.invoice_number}`]
                );
                await client.query(
                    `INSERT INTO accounting_voucher_lines
                        (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
                     VALUES ($1, $2, 0, $3, 'client', $4, $5)`,
                    [voucherId, arRes.rows[0].id, remaining, invoice.client_id, `تسوية ذمة العميل — فاتورة #${invoice.invoice_number}`]
                );

                await client.query(`
                    INSERT INTO client_transactions (client_id, invoice_id, type, amount, payment_method, document_number, description, linked_voucher_id, created_at)
                    VALUES ($1, $2, 'receipt', $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()))
                `, [
                    invoice.client_id, id, remaining, payment_method, reference_number || null,
                    `دفعة فاتورة رقم ${invoice.invoice_number}`, voucherId, payment_date || null,
                ]);
            }
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
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;
