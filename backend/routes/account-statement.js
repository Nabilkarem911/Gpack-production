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

const restrictToAdmin = authorize(['admin', 'manager', 'super_admin']);
router.use(restrictToAdmin);

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
                JOIN accounts a ON a.id = avl.account_id
                WHERE av.voucher_type = 'receipt' 
                    AND av.status = 'posted'
                    AND a.name LIKE '%' || (SELECT name FROM clients WHERE id = $1) || '%'
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
                JOIN accounts a ON a.id = avl.account_id
                WHERE av.voucher_type = 'receipt' 
                    AND av.status = 'posted'
                    AND a.name LIKE '%' || (SELECT name FROM clients WHERE id = $1) || '%'
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
        res.status(500).json({ error: err.message });
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
                JOIN accounts a ON a.id = avl.account_id
                WHERE av.voucher_type = 'payment' 
                    AND av.status = 'posted'
                    AND a.name LIKE '%' || (SELECT company_name FROM suppliers WHERE id = $1) || '%'
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
                WHERE supplier_id = $1 AND status != 'cancelled' ${dateFilter}
                UNION ALL
                SELECT 'payment' as doc_type, avl.debit as amount
                FROM accounting_vouchers av
                JOIN accounting_voucher_lines avl ON avl.voucher_id = av.id
                JOIN accounts a ON a.id = avl.account_id
                WHERE av.voucher_type = 'payment' 
                    AND av.status = 'posted'
                    AND a.name LIKE '%' || (SELECT company_name FROM suppliers WHERE id = $1) || '%'
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
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
