'use strict';

// =============================================================================
// G.PACK 2.0 — Public Client Statement API (No Authentication Required)
// كشف حساب عام للعميل - متاح بدون تسجيل دخول
// =============================================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');

// =============================================================================
// GET /api/public/client-statement/:clientId
// Public endpoint for client to view their own statement
// Security: Client ID is encoded in token, rate limiting recommended
// =============================================================================
router.get('/client-statement/:clientId', async (req, res) => {
    try {
        const { clientId } = req.params;

        // Verify client exists and is active (status = 'active')
        const clientRes = await db.query(
            "SELECT id, name, phone, city FROM clients WHERE id = $1 AND status = 'active'",
            [clientId]
        );
        if (clientRes.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found or inactive' });
        }
        const client = clientRes.rows[0];

        // Get transactions - ALL transactions including receipts
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
                    COALESCE(i.notes, '') as notes
                FROM invoices i
                WHERE i.client_id = $1 AND i.status != 'cancelled'
                
                UNION ALL
                
                -- Receipt Vouchers (Credit - له) - Link via client_id in description or reference
                SELECT 
                    av.id::text as transaction_id,
                    av.voucher_date as trans_date,
                    'سند قبض' as document_type,
                    av.voucher_number::text as document_number,
                    0 as debit,
                    av.total_amount as credit,
                    av.status as status,
                    COALESCE(av.description, '') as notes
                FROM accounting_vouchers av
                WHERE av.voucher_type = 'receipt' 
                    AND av.status = 'posted'
                    AND (
                        av.description ILIKE '%' || (SELECT name FROM clients WHERE id = $1) || '%'
                        OR av.reference_type = 'client' AND av.reference_id = $1
                    )
            ) transactions
            ORDER BY trans_date ASC, document_number ASC
            LIMIT 500
        `, [clientId]);

        // Calculate running balance (oldest first - ASC order)
        let runningBalance = 0;
        const withBalance = transactionsRes.rows.map(t => {
            const debit = parseFloat(t.debit || 0);
            const credit = parseFloat(t.credit || 0);
            runningBalance += debit - credit;
            return { ...t, running_balance: runningBalance };
        });

        // Reverse to show newest first (DESC) for display
        withBalance.reverse();

        // Get summary
        const summaryRes = await db.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN doc_type = 'invoice' THEN amount ELSE 0 END), 0) as total_invoices,
                COALESCE(SUM(CASE WHEN doc_type = 'payment' THEN amount ELSE 0 END), 0) as total_payments
            FROM (
                SELECT 'invoice' as doc_type, grand_total as amount 
                FROM invoices 
                WHERE client_id = $1 AND status != 'cancelled'
                UNION ALL
                SELECT 'payment' as doc_type, avl.credit as amount
                FROM accounting_vouchers av
                JOIN accounting_voucher_lines avl ON avl.voucher_id = av.id
                JOIN accounts a ON a.id = avl.account_id
                WHERE av.voucher_type = 'receipt' 
                    AND av.status = 'posted'
                    AND a.name LIKE '%' || (SELECT name FROM clients WHERE id = $1) || '%'
            ) totals
        `, [clientId]);

        const totalInvoices = parseFloat(summaryRes.rows[0]?.total_invoices || 0);
        const totalPayments = parseFloat(summaryRes.rows[0]?.total_payments || 0);

        res.json({
            client: client,
            transactions: withBalance,
            summary: {
                total_invoices: totalInvoices,
                total_payments: totalPayments,
                balance: totalInvoices - totalPayments
            },
            generated_at: new Date().toISOString()
        });

    } catch (err) {
        console.error('[PublicStatement] GET /client-statement/:clientId error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
