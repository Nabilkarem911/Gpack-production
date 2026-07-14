'use strict';

// =============================================================================
// G.PACK 2.0 — Payment Vouchers API (سندات الصرف)
// Double-entry: DR Accounts Payable (2100) — CR Cash/Bank (1100/1200)
// Vouchers are IMMUTABLE once posted. Cancellation = reverse + new voucher.
// =============================================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const authorize = require('../middleware/authorize');
const { validateBody, paymentVoucherCreate, voucherCancel } = require('../utils/validators');

router.use(authorize('payment_voucher', 'view'));
const restrictWrite  = authorize('payment_voucher', 'create');
const restrictEdit   = authorize('payment_voucher', 'edit');
const restrictDelete = authorize('payment_voucher', 'delete');

// =============================================================================
// GET /api/payment-vouchers
// List all payment vouchers with supplier info, paginated + filterable
// =============================================================================
router.get('/', async (req, res) => {
    try {
        const { search = '', status = '', from = '', to = '', limit = 50, offset = 0 } = req.query;

        const conditions = ["av.voucher_type = 'payment'"];
        const params = [];

        if (search) {
            params.push(`%${search}%`);
            conditions.push(`(
                av.description ILIKE $${params.length}
                OR av.voucher_number::text ILIKE $${params.length}
                OR (av.reference_type = 'supplier'           AND EXISTS (SELECT 1 FROM suppliers sx WHERE sx.id = av.reference_id AND sx.company_name ILIKE $${params.length}))
                OR (av.reference_type = 'purchase_invoice'   AND EXISTS (SELECT 1 FROM purchase_invoices px JOIN suppliers sx ON sx.id = px.supplier_id WHERE px.id = av.reference_id AND sx.company_name ILIKE $${params.length}))
                OR (av.reference_type = 'manufacturer_order' AND EXISTS (SELECT 1 FROM manufacturer_orders mo JOIN suppliers sx ON sx.id = mo.manufacturer_id WHERE mo.id = av.reference_id AND sx.company_name ILIKE $${params.length}))
                OR (av.reference_type = 'client'             AND EXISTS (SELECT 1 FROM clients cx WHERE cx.id = av.reference_id AND cx.name ILIKE $${params.length}))
            )`);
        }
        if (status) {
            params.push(status);
            conditions.push(`av.status = $${params.length}`);
        }
        if (from) {
            params.push(from);
            conditions.push(`av.voucher_date >= $${params.length}`);
        }
        if (to) {
            params.push(to);
            conditions.push(`av.voucher_date <= $${params.length}`);
        }

        const where = conditions.join(' AND ');

        const countRes = await db.query(`
            SELECT COUNT(*) as total
            FROM accounting_vouchers av
            WHERE ${where}
        `, params);

        params.push(parseInt(limit));
        params.push(parseInt(offset));

        const rows = await db.query(`
            SELECT
                av.id, av.voucher_number, av.voucher_date, av.description,
                av.total_amount, av.status, av.reference_type, av.reference_id,
                av.created_at,
                COALESCE(
                    CASE WHEN av.reference_type = 'supplier'           THEN s_direct.company_name END,
                    CASE WHEN av.reference_type = 'client'             THEN c_direct.name END,
                    (SELECT sx.company_name FROM purchase_invoices pi JOIN suppliers sx ON sx.id = pi.supplier_id WHERE pi.id = av.reference_id LIMIT 1),
                    (SELECT sx.company_name FROM manufacturer_orders mo JOIN suppliers sx ON sx.id = mo.manufacturer_id WHERE mo.id = av.reference_id LIMIT 1)
                ) AS supplier_name,
                COALESCE(
                    CASE WHEN av.reference_type = 'supplier'           THEN s_direct.phone END,
                    CASE WHEN av.reference_type = 'client'             THEN c_direct.phone END,
                    (SELECT sx.phone FROM purchase_invoices pi JOIN suppliers sx ON sx.id = pi.supplier_id WHERE pi.id = av.reference_id LIMIT 1),
                    (SELECT sx.phone FROM manufacturer_orders mo JOIN suppliers sx ON sx.id = mo.manufacturer_id WHERE mo.id = av.reference_id LIMIT 1)
                ) AS supplier_phone,
                u.name AS created_by_name
            FROM accounting_vouchers av
            LEFT JOIN suppliers s_direct ON s_direct.id = av.reference_id AND av.reference_type = 'supplier'
            LEFT JOIN clients  c_direct ON c_direct.id = av.reference_id AND av.reference_type = 'client'
            LEFT JOIN users u ON u.id = av.created_by
            WHERE ${where}
            ORDER BY av.voucher_date DESC, av.voucher_number DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);

        res.json({
            data: rows.rows,
            total: parseInt(countRes.rows[0].total),
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (err) {
        console.error('[PaymentVouchers] GET / error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/payment-vouchers/:id
// Single payment voucher with double-entry lines
// =============================================================================
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const voucherRes = await db.query(`
            SELECT
                av.id, av.voucher_number, av.voucher_date, av.description,
                av.total_amount, av.status, av.reference_type, av.reference_id,
                av.created_at,
                COALESCE(
                    CASE WHEN av.reference_type = 'supplier'           THEN s_direct.company_name END,
                    CASE WHEN av.reference_type = 'client'             THEN c_direct.name END,
                    (SELECT sx.company_name FROM purchase_invoices pi JOIN suppliers sx ON sx.id = pi.supplier_id WHERE pi.id = av.reference_id LIMIT 1),
                    (SELECT sx.company_name FROM manufacturer_orders mo JOIN suppliers sx ON sx.id = mo.manufacturer_id WHERE mo.id = av.reference_id LIMIT 1)
                ) AS supplier_name,
                COALESCE(
                    CASE WHEN av.reference_type = 'supplier'           THEN s_direct.phone END,
                    CASE WHEN av.reference_type = 'client'             THEN c_direct.phone END,
                    (SELECT sx.phone FROM purchase_invoices pi JOIN suppliers sx ON sx.id = pi.supplier_id WHERE pi.id = av.reference_id LIMIT 1),
                    (SELECT sx.phone FROM manufacturer_orders mo JOIN suppliers sx ON sx.id = mo.manufacturer_id WHERE mo.id = av.reference_id LIMIT 1)
                ) AS supplier_phone,
                u.name AS created_by_name
            FROM accounting_vouchers av
            LEFT JOIN suppliers s_direct ON s_direct.id = av.reference_id AND av.reference_type = 'supplier'
            LEFT JOIN clients  c_direct ON c_direct.id = av.reference_id AND av.reference_type = 'client'
            LEFT JOIN users u ON u.id = av.created_by
            WHERE av.id = $1 AND av.voucher_type = 'payment'
        `, [id]);

        if (!voucherRes.rows.length) {
            return res.status(404).json({ error: 'Voucher not found' });
        }

        const linesRes = await db.query(`
            SELECT avl.id, avl.debit, avl.credit, avl.description,
                   avl.sub_account_type, avl.sub_account_id,
                   a.code AS account_code, a.name AS account_name, a.account_type
            FROM accounting_voucher_lines avl
            JOIN accounts a ON a.id = avl.account_id
            WHERE avl.voucher_id = $1
            ORDER BY avl.debit DESC
        `, [id]);

        res.json({ data: { ...voucherRes.rows[0], lines: linesRes.rows } });

    } catch (err) {
        console.error('[PaymentVouchers] GET /:id error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/payment-vouchers
// Create a new payment voucher (double-entry)
// Body: { payee_type ('supplier'|'client'), payee_id, amount, payment_method, cash_account_id, voucher_date, description }
// Double-entry for supplier: DR ذمم الموردين (2100) — CR نقدية/بنك
// Double-entry for client:   DR ذمم العملاء  (1300) — CR نقدية/بنك  (إرجاع دفعة)
// =============================================================================
router.post('/', restrictWrite, validateBody(paymentVoucherCreate), async (req, res) => {
    try {
        const {
            payee_type = 'supplier',
            payee_id,
            amount,
            payment_method = 'cash',
            cash_account_id,
            voucher_date,
            description,
            purchase_invoice_id = null,
        } = req.validatedBody;

        if (!payee_id || !amount || !cash_account_id || !voucher_date) {
            return res.status(400).json({ error: 'payee_id, amount, cash_account_id, voucher_date are required' });
        }
        if (!['supplier', 'client', 'account'].includes(payee_type)) {
            return res.status(400).json({ error: 'payee_type must be supplier, client, or account' });
        }

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'Amount must be a positive number' });
        }

        // Resolve payee name + contra account
        let payeeName, contraAccountCode, subAccountType, subAccountId;
        if (payee_type === 'supplier') {
            const r = await db.query('SELECT id, company_name FROM suppliers WHERE id = $1', [payee_id]);
            if (!r.rows.length) return res.status(404).json({ error: 'Supplier not found' });
            payeeName        = r.rows[0].company_name;
            contraAccountCode = '2100'; // ذمم الموردين
            subAccountType   = 'supplier';
            subAccountId     = payee_id;
        } else if (payee_type === 'client') {
            const r = await db.query('SELECT id, name FROM clients WHERE id = $1', [payee_id]);
            if (!r.rows.length) return res.status(404).json({ error: 'Client not found' });
            payeeName        = r.rows[0].name;
            contraAccountCode = '1300'; // ذمم العملاء
            subAccountType   = 'client';
            subAccountId     = payee_id;
        } else {
            // 'account' type — use the selected account directly as the contra account
            const r = await db.query('SELECT id, code, name FROM accounts WHERE id = $1 AND is_active = true', [payee_id]);
            if (!r.rows.length) return res.status(404).json({ error: 'Account not found' });
            payeeName        = r.rows[0].name;
            subAccountType   = null;
            subAccountId     = null;
            // Use the account directly — skip the contra account lookup below
            const contraAccountId = r.rows[0].id;

            const cashAccRes = await db.query('SELECT id, name FROM accounts WHERE id = $1 AND is_active = true', [cash_account_id]);
            if (!cashAccRes.rows.length) return res.status(404).json({ error: 'Cash/Bank account not found' });

            const result = await db.withTransaction(async (txClient) => {
                const voucherRes = await txClient.query(`
                    INSERT INTO accounting_vouchers
                        (voucher_type, voucher_date, description, total_amount, status, reference_type, reference_id, created_by)
                    VALUES ('payment', $1, $2, $3, 'posted', $4, $5, $6)
                    RETURNING id, voucher_number
                `, [
                    voucher_date,
                    description || `سند صرف - ${payeeName}`,
                    parsedAmount,
                    'account',
                    payee_id,
                    req.user?.id || null
                ]);

                const voucherId     = voucherRes.rows[0].id;
                const voucherNumber = voucherRes.rows[0].voucher_number;

                // Line 1: DR selected account directly
                await txClient.query(`
                    INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
                    VALUES ($1, $2, $3, 0, NULL, NULL, $4)
                `, [voucherId, contraAccountId, parsedAmount, `صرف لـ ${payeeName}`]);

                // Line 2: CR Cash/Bank account
                await txClient.query(`
                    INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
                    VALUES ($1, $2, 0, $3, NULL, NULL, $4)
                `, [voucherId, cash_account_id, parsedAmount, `دفع لـ ${payeeName}`]);

                return { id: voucherId, voucher_number: voucherNumber };
            });

            return res.status(201).json({ message: 'Payment voucher created successfully', data: result });
        }

        const cashAccRes = await db.query('SELECT id, name FROM accounts WHERE id = $1 AND is_active = true', [cash_account_id]);
        if (!cashAccRes.rows.length) return res.status(404).json({ error: 'Cash/Bank account not found' });

        const contraAccRes = await db.query('SELECT id FROM accounts WHERE code = $1 LIMIT 1', [contraAccountCode]);
        if (!contraAccRes.rows.length) return res.status(500).json({ error: `Account ${contraAccountCode} not found in chart of accounts` });
        const contraAccountId = contraAccRes.rows[0].id;

        const result = await db.withTransaction(async (txClient) => {
            const voucherRes = await txClient.query(`
                INSERT INTO accounting_vouchers
                    (voucher_type, voucher_date, description, total_amount, status, reference_type, reference_id, created_by)
                VALUES ('payment', $1, $2, $3, 'posted', $4, $5, $6)
                RETURNING id, voucher_number
            `, [
                voucher_date,
                description || `سند صرف - ${payeeName}`,
                parsedAmount,
                payee_type,
                payee_id,
                req.user?.id || null
            ]);

            const voucherId     = voucherRes.rows[0].id;
            const voucherNumber = voucherRes.rows[0].voucher_number;

            // Line 1: DR contra account (ذمم الموردين أو ذمم العملاء)
            await txClient.query(`
                INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
                VALUES ($1, $2, $3, 0, $4, $5, $6)
            `, [voucherId, contraAccountId, parsedAmount, payee_type, payee_id, `صرف لـ ${payeeName}`]);

            // Line 2: CR Cash/Bank account
            await txClient.query(`
                INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
                VALUES ($1, $2, 0, $3, $4, $5, $6)
            `, [voucherId, cash_account_id, parsedAmount, payee_type, payee_id, `دفع لـ ${payeeName}`]);

            // ── Update purchase invoice paid_amount + status ─────────────────
            if (purchase_invoice_id) {
                const invRes = await txClient.query(
                    `SELECT grand_total, paid_amount, status FROM purchase_invoices WHERE id = $1 AND supplier_id = $2 FOR UPDATE`,
                    [purchase_invoice_id, payee_id]
                );
                if (!invRes.rows.length) throw new Error('فاتورة المشتريات غير موجودة أو لا تخص هذا المورد');

                const inv          = invRes.rows[0];
                const newPaid      = parseFloat(inv.paid_amount || 0) + parsedAmount;
                const grandTotal   = parseFloat(inv.grand_total);
                const newStatus    = newPaid >= grandTotal - 0.01 ? 'paid'
                                   : newPaid > 0                  ? 'partially_paid'
                                   : 'unpaid';

                await txClient.query(
                    `UPDATE purchase_invoices SET paid_amount = $1, status = $2 WHERE id = $3`,
                    [newPaid, newStatus, purchase_invoice_id]
                );
            }

            return { id: voucherId, voucher_number: voucherNumber };
        });

        res.status(201).json({ message: 'Payment voucher created successfully', data: result });

    } catch (err) {
        console.error('[PaymentVouchers] POST / error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/payment-vouchers/:id/cancel
// Cancel a posted payment voucher (IMMUTABILITY RULE: reverse + new cancellation)
// =============================================================================
router.post('/:id/cancel', restrictDelete, validateBody(voucherCancel), async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.validatedBody;

        const origRes = await db.query(`
            SELECT av.*, s.company_name AS supplier_name
            FROM accounting_vouchers av
            LEFT JOIN suppliers s ON s.id = av.reference_id
            WHERE av.id = $1 AND av.voucher_type = 'payment'
        `, [id]);

        if (!origRes.rows.length) return res.status(404).json({ error: 'Voucher not found' });
        const orig = origRes.rows[0];
        if (orig.status === 'cancelled') return res.status(400).json({ error: 'Voucher is already cancelled' });

        const linesRes = await db.query('SELECT * FROM accounting_voucher_lines WHERE voucher_id = $1', [id]);

        const reversalId = await db.withTransaction(async (txClient) => {
            await txClient.query("UPDATE accounting_vouchers SET status = 'cancelled' WHERE id = $1", [id]);

            // Revert purchase invoice paid_amount if this voucher was linked to an invoice
            if (orig.reference_type === 'purchase_invoice' && orig.reference_id) {
                const invRes = await txClient.query(
                    `SELECT grand_total, paid_amount, status FROM purchase_invoices WHERE id = $1 FOR UPDATE`,
                    [orig.reference_id]
                );
                if (invRes.rows.length) {
                    const inv = invRes.rows[0];
                    const newPaid = Math.max(0, parseFloat(inv.paid_amount || 0) - parseFloat(orig.total_amount || 0));
                    const grandTotal = parseFloat(inv.grand_total || 0);
                    const newStatus = newPaid >= grandTotal - 0.01 ? 'paid'
                                   : newPaid > 0                  ? 'partially_paid'
                                   : 'unpaid';
                    await txClient.query(
                        `UPDATE purchase_invoices SET paid_amount = $1, status = $2 WHERE id = $3`,
                        [newPaid, newStatus, orig.reference_id]
                    );
                }
            }

            const reversalRes = await txClient.query(`
                INSERT INTO accounting_vouchers
                    (voucher_type, voucher_date, description, total_amount, status, reference_type, reference_id, created_by)
                VALUES ('payment', CURRENT_DATE, $1, $2, 'cancelled', $3, $4, $5)
                RETURNING id
            `, [
                `إلغاء سند صرف رقم ${orig.voucher_number}${reason ? ' - ' + reason : ''}`,
                orig.total_amount,
                orig.reference_type,
                orig.reference_id,
                req.user?.id || null
            ]);

            const revId = reversalRes.rows[0].id;

            for (const line of linesRes.rows) {
                await txClient.query(`
                    INSERT INTO accounting_voucher_lines
                        (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [
                    revId, line.account_id,
                    line.credit, line.debit,
                    line.sub_account_type, line.sub_account_id,
                    `عكس: ${line.description || ''}`
                ]);
            }

            return revId;
        });

        res.json({ message: 'Voucher cancelled successfully', reversal_id: reversalId });

    } catch (err) {
        console.error('[PaymentVouchers] POST /:id/cancel error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/payment-vouchers/meta/accounts
// Returns available cash/bank accounts for the payment method selector
// =============================================================================
router.get('/meta/accounts', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT
                child.id, child.code, child.name, child.account_type,
                parent.code AS parent_code
            FROM accounts AS child
            JOIN accounts AS parent ON parent.id = child.parent_id
            WHERE parent.code IN ('1100', '1200')
              AND child.is_active = true
            ORDER BY parent.code, child.code
        `);
        res.json({ data: result.rows });
    } catch (err) {
        console.error('[PaymentVouchers] GET /meta/accounts error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
