'use strict';

// =============================================================================
// G.PACK 2.0 — Supplier Accounts Route (حسابات الموردين)
// /api/supplier-accounts
//
// Per-supplier payable balance, computed from the SAME sources as the supplier
// statement (account-statement.js):
//   debit  = payment vouchers + journal & opening-balance debit lines on 2100
//   credit = purchase invoices (non-cancelled) + journal & opening-balance
//            credit lines on 2100
//   balance = debit - credit  →  >0 مدين (لنا عند المورد) / <0 دائن (للمورد عندنا)
// =============================================================================

const express   = require('express');
const router    = express.Router();
const db        = require('../db');
const authorize = require('../middleware/authorize');

router.use(authorize('supplier_accounts', 'view'));

// =============================================================================
// GET /api/supplier-accounts
//   ?search=<text>  — company_name/phone filter
//   ?include_zero=1 — include suppliers with zero balance (default: exclude)
// =============================================================================
router.get('/', async (req, res) => {
    try {
        const { search } = req.query;
        const includeZero = req.query.include_zero === '1' || req.query.include_zero === 'true';

        const params = [];
        let whereExtra = '';
        if (search) {
            params.push(`%${search}%`);
            whereExtra = ` AND (s.company_name ILIKE $${params.length} OR s.phone ILIKE $${params.length} OR s.contact_person ILIKE $${params.length})`;
        }

        const rows = await db.query(
            `SELECT
                s.id, s.company_name AS name, s.phone, s.contact_person,
                s.supplier_type,
                COALESCE(inv.total,  0) AS invoiced,
                COALESCE(pay.total,  0) AS paid,
                COALESCE(jl.debit,   0) AS journal_debit,
                COALESCE(jl.credit,  0) AS journal_credit
             FROM suppliers s
             -- Purchase invoices (credit side — مستحق للمورد)
             LEFT JOIN (
                SELECT supplier_id, SUM(grand_total) AS total
                FROM purchase_invoices
                WHERE status != 'cancelled'
                GROUP BY supplier_id
             ) inv ON inv.supplier_id = s.id
             -- Payment vouchers (debit side)
             LEFT JOIN (
                SELECT avl.sub_account_id, SUM(avl.debit) AS total
                FROM accounting_voucher_lines avl
                JOIN accounting_vouchers av ON av.id = avl.voucher_id
                WHERE av.voucher_type = 'payment'
                  AND av.status = 'posted'
                  AND avl.account_id = (SELECT id FROM accounts WHERE code = '2100' LIMIT 1)
                  AND avl.sub_account_type = 'supplier'
                GROUP BY avl.sub_account_id
             ) pay ON pay.sub_account_id = s.id
             -- Manual journal + opening-balance lines on 2100 (both sides)
             LEFT JOIN (
                SELECT avl.sub_account_id,
                       SUM(avl.debit)  AS debit,
                       SUM(avl.credit) AS credit
                FROM accounting_voucher_lines avl
                JOIN accounting_vouchers av ON av.id = avl.voucher_id
                WHERE av.voucher_type IN ('journal', 'opening_balance')
                  AND av.status = 'posted'
                  AND avl.account_id = (SELECT id FROM accounts WHERE code = '2100' LIMIT 1)
                  AND avl.sub_account_type = 'supplier'
                GROUP BY avl.sub_account_id
             ) jl ON jl.sub_account_id = s.id
             WHERE 1=1 ${whereExtra}
             ORDER BY s.company_name ASC`,
            params
        );

        const data = rows.rows.map(r => {
            const balance = parseFloat(r.paid) + parseFloat(r.journal_debit)
                          - parseFloat(r.invoiced) - parseFloat(r.journal_credit);
            return {
                id: r.id, name: r.name, phone: r.phone,
                contact_person: r.contact_person, supplier_type: r.supplier_type,
                invoiced: parseFloat(r.invoiced), paid: parseFloat(r.paid),
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
        console.error('[SupplierAccounts] GET / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
