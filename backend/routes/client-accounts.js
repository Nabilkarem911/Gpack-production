'use strict';

// =============================================================================
// G.PACK 2.0 — Client Accounts Route (حسابات العملاء)
// /api/client-accounts
//
// Per-client receivable balance, computed from the SAME sources as the client
// statement (account-statement.js):
//   debit  = invoices (issued/paid/archived, orders+warehouse) + journal &
//            opening-balance debit lines on control account 1300
//   credit = receipt vouchers + sales returns + journal & opening-balance
//            credit lines on 1300
//   balance = debit - credit  →  >0 مدين (لنا عند العميل) / <0 دائن (للعميل عندنا)
// =============================================================================

const express   = require('express');
const router    = express.Router();
const db        = require('../db');
const authorize = require('../middleware/authorize');

router.use(authorize('client_accounts', 'view'));

// =============================================================================
// GET /api/client-accounts
// Returns every client with their computed balance + split totals.
//   ?search=<text>  — name/phone filter
//   ?include_zero=1 — include clients with zero balance (default: exclude)
// =============================================================================
router.get('/', async (req, res) => {
    try {
        const { search } = req.query;
        const includeZero = req.query.include_zero === '1' || req.query.include_zero === 'true';

        const params = [];
        let whereExtra = '';
        if (search) {
            params.push(`%${search}%`);
            whereExtra = ` AND (c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length})`;
        }

        const rows = await db.query(
            `SELECT
                c.id, c.name, c.phone, c.parent_id,
                cp.name AS parent_name,
                COALESCE(inv.total,  0) AS invoiced,
                COALESCE(recv.total, 0) AS received,
                COALESCE(ret.total,  0) AS returned,
                COALESCE(jl.debit,   0) AS journal_debit,
                COALESCE(jl.credit,  0) AS journal_credit
             FROM clients c
             LEFT JOIN clients cp ON cp.id = c.parent_id
             -- Sales invoices (debit side)
             LEFT JOIN (
                SELECT client_id, SUM(grand_total) AS total
                FROM invoices
                WHERE source IN ('orders', 'warehouse')
                  AND status IN ('issued', 'paid', 'archived')
                GROUP BY client_id
             ) inv ON inv.client_id = c.id
             -- Receipt vouchers (credit side)
             LEFT JOIN (
                SELECT avl.sub_account_id, SUM(avl.credit) AS total
                FROM accounting_voucher_lines avl
                JOIN accounting_vouchers av ON av.id = avl.voucher_id
                WHERE av.voucher_type = 'receipt'
                  AND av.status = 'posted'
                  AND avl.account_id = (SELECT id FROM accounts WHERE code = '1300' LIMIT 1)
                  AND avl.sub_account_type = 'client'
                GROUP BY avl.sub_account_id
             ) recv ON recv.sub_account_id = c.id
             -- Sales returns (credit side)
             LEFT JOIN (
                SELECT client_id, SUM(total_amount) AS total
                FROM sales_returns
                WHERE status = 'completed'
                GROUP BY client_id
             ) ret ON ret.client_id = c.id
             -- Manual journal + opening-balance lines on 1300 (both sides)
             LEFT JOIN (
                SELECT avl.sub_account_id,
                       SUM(avl.debit)  AS debit,
                       SUM(avl.credit) AS credit
                FROM accounting_voucher_lines avl
                JOIN accounting_vouchers av ON av.id = avl.voucher_id
                WHERE av.voucher_type IN ('journal', 'opening_balance')
                  AND av.status = 'posted'
                  AND avl.account_id = (SELECT id FROM accounts WHERE code = '1300' LIMIT 1)
                  AND avl.sub_account_type = 'client'
                GROUP BY avl.sub_account_id
             ) jl ON jl.sub_account_id = c.id
             WHERE 1=1 ${whereExtra}
             ORDER BY c.name ASC`,
            params
        );

        const data = rows.rows.map(r => {
            const balance = parseFloat(r.invoiced) + parseFloat(r.journal_debit)
                          - parseFloat(r.received) - parseFloat(r.returned) - parseFloat(r.journal_credit);
            return {
                id: r.id, name: r.name, phone: r.phone,
                parent_id: r.parent_id, parent_name: r.parent_name,
                invoiced: parseFloat(r.invoiced), received: parseFloat(r.received),
                returned: parseFloat(r.returned),
                journal_debit: parseFloat(r.journal_debit),
                journal_credit: parseFloat(r.journal_credit),
                balance,
            };
        }).filter(r => includeZero || r.balance !== 0);

        const totals = data.reduce((a, r) => {
            if (r.balance > 0) a.debit  += r.balance;
            if (r.balance < 0) a.credit += Math.abs(r.balance);
            return a;
        }, { debit: 0, credit: 0 });
        totals.net = totals.debit - totals.credit;

        return res.json({ data, totals });
    } catch (err) {
        console.error('[ClientAccounts] GET / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
