'use strict';

// =============================================================================
// G.PACK 2.0 — Receipt Vouchers API (سندات القبض)
// Double-entry: DR Cash/Bank — CR Accounts Receivable
// Vouchers are IMMUTABLE once posted. Cancellation = reverse + new voucher.
// =============================================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const authorize = require('../middleware/authorize');
const { validateBody, receiptVoucherCreate, voucherCancel } = require('../utils/validators');

router.use(authorize('receipt_voucher', 'view'));
const restrictWrite  = authorize('receipt_voucher', 'create');
const restrictEdit   = authorize('receipt_voucher', 'edit');
const restrictDelete = authorize('receipt_voucher', 'delete');

// =============================================================================
// GET /api/receipt-vouchers
// List all receipt vouchers with client info, paginated + filterable
// =============================================================================
router.get('/', async (req, res) => {
    try {
        const { search = '', status = '', from = '', to = '', limit = 50, offset = 0 } = req.query;

        const conditions = ["av.voucher_type = 'receipt'"];
        const params = [];

        if (search) {
            params.push(`%${search}%`);
            conditions.push(`(
                av.description ILIKE $${params.length}
                OR av.voucher_number::text ILIKE $${params.length}
                OR (av.reference_type = 'client' AND EXISTS (SELECT 1 FROM clients cx WHERE cx.id = av.reference_id AND cx.name ILIKE $${params.length}))
                OR (av.reference_type = 'order' AND EXISTS (SELECT 1 FROM orders ox JOIN clients cx ON cx.id = ox.client_id WHERE ox.id = av.reference_id AND cx.name ILIKE $${params.length}))
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
                    CASE WHEN av.reference_type = 'client' THEN c_direct.name END,
                    (SELECT cl.name FROM orders o JOIN clients cl ON cl.id = o.client_id WHERE o.id = av.reference_id LIMIT 1)
                ) AS client_name,
                COALESCE(
                    CASE WHEN av.reference_type = 'client' THEN c_direct.phone END,
                    (SELECT cl.phone FROM orders o JOIN clients cl ON cl.id = o.client_id WHERE o.id = av.reference_id LIMIT 1)
                ) AS client_phone,
                u.name AS created_by_name
            FROM accounting_vouchers av
            LEFT JOIN clients c_direct ON c_direct.id = av.reference_id AND av.reference_type = 'client'
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
        console.error('[ReceiptVouchers] GET / error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/receipt-vouchers/:id
// Single receipt voucher with its double-entry lines
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
                    CASE WHEN av.reference_type = 'client' THEN c_direct.name END,
                    (SELECT cl.name FROM orders o JOIN clients cl ON cl.id = o.client_id WHERE o.id = av.reference_id LIMIT 1)
                ) AS client_name,
                COALESCE(
                    CASE WHEN av.reference_type = 'client' THEN c_direct.phone END,
                    (SELECT cl.phone FROM orders o JOIN clients cl ON cl.id = o.client_id WHERE o.id = av.reference_id LIMIT 1)
                ) AS client_phone,
                u.name AS created_by_name
            FROM accounting_vouchers av
            LEFT JOIN clients c_direct ON c_direct.id = av.reference_id AND av.reference_type = 'client'
            LEFT JOIN users u ON u.id = av.created_by
            WHERE av.id = $1 AND av.voucher_type = 'receipt'
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

        res.json({
            data: { ...voucherRes.rows[0], lines: linesRes.rows }
        });

    } catch (err) {
        console.error('[ReceiptVouchers] GET /:id error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/receipt-vouchers
// Create a new receipt voucher (double-entry)
// Body: { client_id, amount, payment_method, cash_account_id, voucher_date, description }
// Double-entry:
//   DR  cash_account_id           amount   (debit - نقدية/بنك)
//   CR  Accounts Receivable 1300  amount   (credit - ذمم العملاء)
// =============================================================================
router.post('/', restrictWrite, validateBody(receiptVoucherCreate), async (req, res) => {
    try {
        const {
            client_id,
            client_type = 'client',
            amount,
            payment_method = 'cash',
            cash_account_id,
            voucher_date,
            description
        } = req.validatedBody;

        if (!client_id || !amount || !cash_account_id || !voucher_date) {
            return res.status(400).json({ error: 'client_id, amount, cash_account_id, voucher_date are required' });
        }

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'Amount must be a positive number' });
        }

        const cashAccRes = await db.query('SELECT id, name FROM accounts WHERE id = $1 AND is_active = true', [cash_account_id]);
        if (!cashAccRes.rows.length) return res.status(404).json({ error: 'Cash/Bank account not found' });

        // Resolve payee name, contra account, and sub-account info based on type
        let payeeName, contraAccountCode, subAccountType, subAccountId, referenceType, referenceId;

        if (client_type === 'client') {
            const clientRes = await db.query('SELECT id, name FROM clients WHERE id = $1', [client_id]);
            if (!clientRes.rows.length) return res.status(404).json({ error: 'Client not found' });
            payeeName        = clientRes.rows[0].name;
            contraAccountCode = '1300';
            subAccountType   = 'client';
            subAccountId     = client_id;
            referenceType    = 'client';
            referenceId      = client_id;
        } else if (client_type === 'supplier') {
            const supplierRes = await db.query('SELECT id, company_name FROM suppliers WHERE id = $1', [client_id]);
            if (!supplierRes.rows.length) return res.status(404).json({ error: 'Supplier not found' });
            payeeName        = supplierRes.rows[0].company_name;
            contraAccountCode = '2100';
            subAccountType   = 'supplier';
            subAccountId     = client_id;
            referenceType    = 'supplier';
            referenceId      = client_id;
        } else {
            // 'account' type — use the selected account directly as the contra account
            const accRes = await db.query('SELECT id, code, name FROM accounts WHERE id = $1 AND is_active = true', [client_id]);
            if (!accRes.rows.length) return res.status(404).json({ error: 'Account not found' });
            payeeName        = accRes.rows[0].name;
            subAccountType   = null;
            subAccountId     = null;
            referenceType    = 'account';
            referenceId      = client_id;
            // Skip contra account lookup — we'll use the selected account directly
            const contraAccountId = accRes.rows[0].id;

            const result = await db.withTransaction(async (txClient) => {
                const voucherRes = await txClient.query(`
                    INSERT INTO accounting_vouchers
                        (voucher_type, voucher_date, description, total_amount, status, reference_type, reference_id, created_by)
                    VALUES ('receipt', $1, $2, $3, 'posted', $4, $5, $6)
                    RETURNING id, voucher_number
                `, [
                    voucher_date,
                    description || `سند قبض - ${payeeName}`,
                    parsedAmount,
                    referenceType,
                    referenceId,
                    req.user?.id || null
                ]);

                const voucherId     = voucherRes.rows[0].id;
                const voucherNumber = voucherRes.rows[0].voucher_number;

                // Line 1: DR Cash/Bank account
                await txClient.query(`
                    INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
                    VALUES ($1, $2, $3, 0, NULL, NULL, $4)
                `, [voucherId, cash_account_id, parsedAmount, `قبض - ${payeeName}`]);

                // Line 2: CR selected account directly
                await txClient.query(`
                    INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
                    VALUES ($1, $2, 0, $3, NULL, NULL, $4)
                `, [voucherId, contraAccountId, parsedAmount, `ذمة - ${payeeName}`]);

                return { id: voucherId, voucher_number: voucherNumber };
            });

            return res.status(201).json({ message: 'Receipt voucher created successfully', data: result });
        }

        // For client/supplier types: look up the contra account (1300 or 2100)
        const arAccRes = await db.query(`SELECT id FROM accounts WHERE code = '${contraAccountCode}' LIMIT 1`);
        if (!arAccRes.rows.length) return res.status(500).json({ error: `Account ${contraAccountCode} not found in chart of accounts` });
        const arAccountId = arAccRes.rows[0].id;

        const result = await db.withTransaction(async (txClient) => {
            // Insert voucher header
            const voucherRes = await txClient.query(`
                INSERT INTO accounting_vouchers
                    (voucher_type, voucher_date, description, total_amount, status, reference_type, reference_id, created_by)
                    VALUES ('receipt', $1, $2, $3, 'posted', $4, $5, $6)
                    RETURNING id, voucher_number
            `, [
                voucher_date,
                description || `سند قبض - ${payeeName}`,
                parsedAmount,
                referenceType,
                referenceId,
                req.user?.id || null
            ]);

            const voucherId     = voucherRes.rows[0].id;
            const voucherNumber = voucherRes.rows[0].voucher_number;

            // Line 1: DR Cash/Bank account
            await txClient.query(`
                INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
                VALUES ($1, $2, $3, 0, $4, $5, $6)
            `, [voucherId, cash_account_id, parsedAmount, subAccountType, subAccountId, `قبض من ${payeeName}`]);

            // Line 2: CR contra account (1300 for clients, 2100 for suppliers)
            await txClient.query(`
                INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
                VALUES ($1, $2, 0, $3, $4, $5, $6)
            `, [voucherId, arAccountId, parsedAmount, subAccountType, subAccountId, `ذمة ${payeeName}`]);

            return { id: voucherId, voucher_number: voucherNumber };
        });

        res.status(201).json({ message: 'Receipt voucher created successfully', data: result });

    } catch (err) {
        console.error('[ReceiptVouchers] POST / error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/receipt-vouchers/:id/cancel
// Cancel a posted receipt voucher (IMMUTABILITY RULE: reverse + new cancellation)
// =============================================================================
router.post('/:id/cancel', restrictDelete, validateBody(voucherCancel), async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.validatedBody;
        const origRes = await db.query(`
            SELECT av.*, c.name AS client_name
            FROM accounting_vouchers av
            LEFT JOIN clients c ON c.id = av.reference_id
            WHERE av.id = $1 AND av.voucher_type = 'receipt'
        `, [id]);

        if (!origRes.rows.length) return res.status(404).json({ error: 'Voucher not found' });
        const orig = origRes.rows[0];
        if (orig.status === 'cancelled') return res.status(400).json({ error: 'Voucher is already cancelled' });

        const linesRes = await db.query('SELECT * FROM accounting_voucher_lines WHERE voucher_id = $1', [id]);

        const reversalId = await db.withTransaction(async (txClient) => {
            // Mark original as cancelled
            await txClient.query("UPDATE accounting_vouchers SET status = 'cancelled' WHERE id = $1", [id]);

            // Create reversal voucher
            const reversalRes = await txClient.query(`
                INSERT INTO accounting_vouchers
                    (voucher_type, voucher_date, description, total_amount, status, reference_type, reference_id, created_by)
                VALUES ('receipt', CURRENT_DATE, $1, $2, 'cancelled', $3, $4, $5)
                RETURNING id
            `, [
                `إلغاء سند قبض رقم ${orig.voucher_number}${reason ? ' - ' + reason : ''}`,
                orig.total_amount,
                orig.reference_type,
                orig.reference_id,
                req.user?.id || null
            ]);

            const revId = reversalRes.rows[0].id;

            // Insert reversed lines (swap debit/credit)
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
        console.error('[ReceiptVouchers] POST /:id/cancel error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/receipt-vouchers/meta/accounts
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
        console.error('[ReceiptVouchers] GET /meta/accounts error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
