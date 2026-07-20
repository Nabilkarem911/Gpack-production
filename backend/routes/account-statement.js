'use strict';

// =============================================================================
// G.PACK 2.0 — Account Statement API
// كشف حساب عميل / مورد
// =============================================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate } = require('../middleware/authMiddleware');
const authorize = require('../middleware/authorize');

router.use(authenticate);

router.use(authorize('account_statement', 'view'));

// =============================================================================
// GET /api/account-statement/client/:clientId
// Client account statement: invoices (debit) + payments (credit)
// =============================================================================
router.get('/client/:clientId', async (req, res) => {
    try {
        const { clientId } = req.params;
        const { from, to, limit = 100, offset = 0 } = req.query;

        // Verify client exists
        const clientRes = await db.query(
            'SELECT id, name, phone, city FROM clients WHERE id = $1',
            [clientId]
        );
        if (clientRes.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }
        const client = clientRes.rows[0];

        // Build date filter
        let dateFilter = '';
        const params = [clientId];
        if (from) {
            params.push(from);
            dateFilter += ` AND date >= $${params.length}`;
        }
        if (to) {
            params.push(to);
            dateFilter += ` AND date <= $${params.length}`;
        }

        // Get all transactions (invoices + payments) using UNION
        const transactionsRes = await db.query(`
            SELECT * FROM (
                -- Sales Invoices (Debit - عليه)
                SELECT 
                    i.id::text as transaction_id,
                    i.invoice_date as trans_date,
                    'فاتورة مبيعات' as document_type,
                    i.invoice_number::text as document_number,
                    i.grand_total as debit,
                    0 as credit,
                    i.status as status,
                    COALESCE(i.notes, '') as notes,
                    NULL as reference_id
                FROM invoices i
                WHERE i.client_id = $1 AND i.status != 'cancelled'
                    ${dateFilter.replace(/date/g, 'i.invoice_date')}
                
                UNION ALL
                
                -- Receipt Vouchers (Credit - له)
                SELECT 
                    av.id::text as transaction_id,
                    av.voucher_date as trans_date,
                    'سند قبض' as document_type,
                    av.voucher_number::text as document_number,
                    0 as debit,
                    avl.credit as credit,
                    av.status as status,
                    COALESCE(av.description, '') as notes,
                    av.id as reference_id
                FROM accounting_vouchers av
                JOIN accounting_voucher_lines avl ON avl.voucher_id = av.id
                WHERE av.voucher_type = 'receipt' 
                    AND av.status = 'posted'
                    AND avl.sub_account_type = 'client'
                    AND avl.sub_account_id = $1
                    AND avl.credit > 0
                    ${dateFilter.replace(/date/g, 'av.voucher_date')}
            ) transactions
            ORDER BY trans_date ASC, document_number ASC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `, [...params, parseInt(limit), parseInt(offset)]);

        // Calculate running balance (oldest first for correct accumulation)
        let runningBalance = 0;
        const withBalance = transactionsRes.rows.map(t => {
            const debit = parseFloat(t.debit || 0);
            const credit = parseFloat(t.credit || 0);
            runningBalance += debit - credit;
            return { ...t, running_balance: runningBalance };
        });

        // Reverse to show newest first for display
        const transactions = withBalance.reverse();

        // Get summary
        const summaryRes = await db.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN doc_type = 'invoice' THEN amount ELSE 0 END), 0) as total_invoices,
                COALESCE(SUM(CASE WHEN doc_type = 'payment' THEN amount ELSE 0 END), 0) as total_payments
            FROM (
                SELECT 'invoice' as doc_type, grand_total as amount 
                FROM invoices 
                WHERE client_id = $1 AND status != 'cancelled' ${dateFilter.replace(/date/g, 'invoice_date')}
                UNION ALL
                SELECT 'payment' as doc_type, avl.credit as amount
                FROM accounting_vouchers av
                JOIN accounting_voucher_lines avl ON avl.voucher_id = av.id
                WHERE av.voucher_type = 'receipt' 
                    AND av.status = 'posted'
                    AND avl.sub_account_type = 'client'
                    AND avl.sub_account_id = $1
                    AND avl.credit > 0
                    ${dateFilter.replace(/date/g, 'av.voucher_date')}
            ) totals
        `, params);

        const totalInvoices = parseFloat(summaryRes.rows[0]?.total_invoices || 0);
        const totalPayments = parseFloat(summaryRes.rows[0]?.total_payments || 0);

        res.json({
            client: client,
            transactions: transactions,
            summary: {
                total_invoices: totalInvoices,
                total_payments: totalPayments,
                balance: totalInvoices - totalPayments
            },
            limit: parseInt(limit),
            offset: parseInt(offset),
            total: transactions.length
        });

    } catch (err) {
        console.error('[AccountStatement] GET /client/:clientId error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/account-statement/supplier/:supplierId
// Supplier account statement: purchase invoices (credit) + payments (debit)
// =============================================================================
router.get('/supplier/:supplierId', async (req, res) => {
    try {
        const { supplierId } = req.params;
        const { from, to, limit = 100, offset = 0 } = req.query;

        // Verify supplier exists
        const supplierRes = await db.query(
            'SELECT id, company_name as name, phone, city FROM suppliers WHERE id = $1',
            [supplierId]
        );
        if (supplierRes.rows.length === 0) {
            return res.status(404).json({ error: 'Supplier not found' });
        }
        const supplier = supplierRes.rows[0];

        // Build date filter
        let dateFilter = '';
        const params = [supplierId];
        if (from) {
            params.push(from);
            dateFilter += ` AND date >= $${params.length}`;
        }
        if (to) {
            params.push(to);
            dateFilter += ` AND date <= $${params.length}`;
        }

        // Get all transactions
        const transactionsRes = await db.query(`
            SELECT * FROM (
                -- Purchase Invoices (Credit - له)
                SELECT 
                    pi.id::text as transaction_id,
                    pi.invoice_date as trans_date,
                    'فاتورة مشتريات' as document_type,
                    pi.invoice_number::text as document_number,
                    0 as debit,
                    pi.grand_total as credit,
                    pi.status as status,
                    COALESCE(pi.notes, '') as notes,
                    NULL as reference_id
                FROM purchase_invoices pi
                WHERE pi.supplier_id = $1 AND pi.status != 'cancelled'
                    ${dateFilter.replace(/date/g, 'pi.invoice_date')}
                
                UNION ALL
                
                -- Payment Vouchers (Debit - عليه)
                SELECT 
                    av.id::text as transaction_id,
                    av.voucher_date as trans_date,
                    'سند صرف' as document_type,
                    av.voucher_number::text as document_number,
                    avl.debit as debit,
                    0 as credit,
                    av.status as status,
                    COALESCE(av.description, '') as notes,
                    av.id as reference_id
                FROM accounting_vouchers av
                JOIN accounting_voucher_lines avl ON avl.voucher_id = av.id
                WHERE av.voucher_type = 'payment' 
                    AND av.status = 'posted'
                    AND avl.sub_account_type = 'supplier'
                    AND avl.sub_account_id = $1
                    AND avl.debit > 0
                    ${dateFilter.replace(/date/g, 'av.voucher_date')}
            ) transactions
            ORDER BY trans_date DESC, document_number DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `, [...params, parseInt(limit), parseInt(offset)]);

        // Calculate running balance
        let balance = 0;
        const transactions = transactionsRes.rows.map(t => {
            balance += parseFloat(t.debit || 0) - parseFloat(t.credit || 0);
            return {
                ...t,
                balance: balance
            };
        });

        // Get summary
        const summaryRes = await db.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN doc_type = 'invoice' THEN amount ELSE 0 END), 0) as total_invoices,
                COALESCE(SUM(CASE WHEN doc_type = 'payment' THEN amount ELSE 0 END), 0) as total_payments
            FROM (
                SELECT 'invoice' as doc_type, grand_total as amount 
                FROM purchase_invoices 
                WHERE supplier_id = $1 AND status != 'cancelled' ${dateFilter.replace(/date/g, 'invoice_date')}
                UNION ALL
                SELECT 'payment' as doc_type, avl.debit as amount
                FROM accounting_vouchers av
                JOIN accounting_voucher_lines avl ON avl.voucher_id = av.id
                WHERE av.voucher_type = 'payment' 
                    AND av.status = 'posted'
                    AND avl.sub_account_type = 'supplier'
                    AND avl.sub_account_id = $1
                    AND avl.debit > 0
                    ${dateFilter.replace(/date/g, 'av.voucher_date')}
            ) totals
        `, params);

        const totalInvoices = parseFloat(summaryRes.rows[0]?.total_invoices || 0);
        const totalPayments = parseFloat(summaryRes.rows[0]?.total_payments || 0);

        res.json({
            supplier: supplier,
            transactions: transactions,
            summary: {
                total_invoices: totalInvoices,
                total_payments: totalPayments,
                balance: totalPayments - totalInvoices
            },
            limit: parseInt(limit),
            offset: parseInt(offset),
            total: transactions.length
        });

    } catch (err) {
        console.error('[AccountStatement] GET /supplier/:supplierId error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/account-statement/lookup
// Search clients and suppliers for statement lookup
// =============================================================================
router.get('/lookup', async (req, res) => {
    try {
        const { search } = req.query;
        
        const clientsRes = await db.query(`
            SELECT id, name, phone, city, 'client' as type
            FROM clients
            WHERE name ILIKE $1 OR phone ILIKE $1
            ORDER BY name
            LIMIT 20
        `, [`%${search || ''}%`]);

        const suppliersRes = await db.query(`
            SELECT id, company_name as name, phone, city, 'supplier' as type
            FROM suppliers
            WHERE company_name ILIKE $1 OR phone ILIKE $1
            ORDER BY company_name
            LIMIT 20
        `, [`%${search || ''}%`]);

        res.json({
            clients: clientsRes.rows,
            suppliers: suppliersRes.rows
        });

    } catch (err) {
        console.error('[AccountStatement] GET /lookup error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/account-statement/accounts-tree
// Returns parent accounts (no parent_id) and their children
// =============================================================================
router.get('/accounts-tree', async (req, res) => {
    try {
        const parentsRes = await db.query(`
            SELECT id, code, name, account_type
            FROM accounts
            WHERE parent_id IS NULL AND is_active = true
            ORDER BY code
        `);

        const childrenRes = await db.query(`
            SELECT id, code, name, account_type, parent_id
            FROM accounts
            WHERE parent_id IS NOT NULL AND is_active = true
            ORDER BY code
        `);

        // Find receivable account (code 1300) and payable account (code 2100)
        const receivableAcc = parentsRes.rows.find(a => a.code === '1300');
        const payableAcc = parentsRes.rows.find(a => a.code === '2100');

        const virtualChildren = [];

        // Add clients as virtual children of Accounts Receivable (1300)
        if (receivableAcc) {
            const clientsRes = await db.query(`
                SELECT id, name, phone, city,
                       ROW_NUMBER() OVER (ORDER BY name) AS seq
                FROM clients
                WHERE status = 'active' OR status IS NULL
                ORDER BY name
            `);
            clientsRes.rows.forEach(c => {
                virtualChildren.push({
                    id: c.id,
                    code: `1300-${String(c.seq).padStart(4, '0')}`,
                    name: c.name,
                    account_type: 'asset',
                    parent_id: receivableAcc.id,
                    sub_account_type: 'client',
                    sub_account_id: c.id,
                    phone: c.phone,
                    city: c.city
                });
            });
        }

        // Add suppliers as virtual children of Accounts Payable (2100)
        if (payableAcc) {
            const suppliersRes = await db.query(`
                SELECT id, company_name as name, phone, city,
                       ROW_NUMBER() OVER (ORDER BY company_name) AS seq
                FROM suppliers
                ORDER BY company_name
            `);
            suppliersRes.rows.forEach(s => {
                virtualChildren.push({
                    id: s.id,
                    code: `2100-${String(s.seq).padStart(4, '0')}`,
                    name: s.name,
                    account_type: 'liability',
                    parent_id: payableAcc.id,
                    sub_account_type: 'supplier',
                    sub_account_id: s.id,
                    phone: s.phone,
                    city: s.city
                });
            });
        }

        res.json({
            parents: parentsRes.rows,
            children: [...childrenRes.rows, ...virtualChildren]
        });
    } catch (err) {
        console.error('[AccountStatement] GET /accounts-tree error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/account-statement/account/:accountId
// Ledger statement for a specific account from chart of accounts
// =============================================================================
router.get('/account/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { from, to, subAccountId, subAccountType } = req.query;

        // Verify account exists
        const accRes = await db.query(
            'SELECT id, code, name, account_type, parent_id FROM accounts WHERE id = $1',
            [accountId]
        );
        if (accRes.rows.length === 0) {
            return res.status(404).json({ error: 'Account not found' });
        }
        const account = accRes.rows[0];

        // Build date filter
        let dateFilter = '';
        let subFilter = '';
        const params = [accountId];
        if (from) {
            params.push(from);
            dateFilter += ` AND av.voucher_date >= $${params.length}`;
        }
        if (to) {
            params.push(to);
            dateFilter += ` AND av.voucher_date <= $${params.length}`;
        }
        if (subAccountId) {
            params.push(subAccountId);
            subFilter += ` AND avl.sub_account_id = $${params.length}`;
        }

        // Get all voucher lines for this account
        // When subAccountId is provided, match by sub_account_id (with or without account_id)
        let accountCondition;
        if (subAccountId) {
            accountCondition = `(avl.account_id = $1 OR avl.sub_account_id = $${params.length})`;
        } else {
            accountCondition = `avl.account_id = $1`;
        }

        const linesRes = await db.query(`
            SELECT 
                avl.id::text as line_id,
                av.id::text as voucher_id,
                av.voucher_number::text as document_number,
                av.voucher_date as trans_date,
                av.voucher_type as document_type,
                av.description as notes,
                avl.debit,
                avl.credit,
                av.status
            FROM accounting_voucher_lines avl
            JOIN accounting_vouchers av ON av.id = avl.voucher_id
            WHERE ${accountCondition}
                AND av.status = 'posted'
                ${dateFilter}
            ORDER BY av.voucher_date ASC, av.voucher_number ASC
        `, params);

        // Calculate running balance
        let runningBalance = 0;
        const withBalance = linesRes.rows.map(t => {
            const debit = parseFloat(t.debit || 0);
            const credit = parseFloat(t.credit || 0);
            runningBalance += debit - credit;
            return { ...t, running_balance: runningBalance };
        });

        // Reverse for display (newest first)
        const transactions = withBalance.reverse();

        // Summary
        const totalDebit = withBalance.reduce((sum, t) => sum + parseFloat(t.debit || 0), 0);
        const totalCredit = withBalance.reduce((sum, t) => sum + parseFloat(t.credit || 0), 0);

        // Map voucher_type to Arabic
        const typeMap = {
            'receipt': 'سند قبض',
            'payment': 'سند صرف',
            'journal': 'قيد يومية',
            'sales_invoice': 'فاتورة مبيعات',
            'purchase_invoice': 'فاتورة مشتريات',
            'production_order': 'أمر إنتاج'
        };
        transactions.forEach(t => {
            t.document_type = typeMap[t.document_type] || t.document_type;
        });

        res.json({
            account: account,
            transactions: transactions,
            summary: {
                total_debit: totalDebit,
                total_credit: totalCredit,
                balance: runningBalance
            }
        });

    } catch (err) {
        console.error('[AccountStatement] GET /account/:accountId error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
