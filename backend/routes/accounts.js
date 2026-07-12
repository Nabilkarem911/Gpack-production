'use strict';

// =============================================================================
// G.PACK 2.0 — Chart of Accounts Route
// /api/accounts
// =============================================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const authorize = require('../middleware/authorize');
const { accountCreate, accountUpdate, validateBody } = require('../utils/validators');

router.use(authorize('chart_of_accounts', 'view'));
const restrictWrite = authorize('chart_of_accounts', 'create');
const restrictEdit  = authorize('chart_of_accounts', 'edit');

// =============================================================================
// GET /api/accounts
// List all accounts with optional balance from accounting_voucher_lines
// =============================================================================
router.get('/', async (req, res) => {
    try {
        const { type, active, search } = req.query;

        let where  = ['1=1'];
        const params = [];

        if (type) {
            params.push(type);
            where.push(`a.account_type = $${params.length}`);
        }
        if (active !== undefined) {
            params.push(active === 'true');
            where.push(`a.is_active = $${params.length}`);
        }
        if (search) {
            params.push(`%${search}%`);
            where.push(`(a.name ILIKE $${params.length} OR a.code ILIKE $${params.length})`);
        }

        const result = await db.query(`
            SELECT
                a.id, a.code, a.name, a.account_type, a.parent_id, a.is_active,
                p.name  AS parent_name,
                p.code  AS parent_code,
                COALESCE(SUM(avl.debit),  0) AS total_debit,
                COALESCE(SUM(avl.credit), 0) AS total_credit,
                COALESCE(SUM(avl.debit),  0) - COALESCE(SUM(avl.credit), 0) AS balance
            FROM accounts a
            LEFT JOIN accounts p          ON p.id = a.parent_id
            LEFT JOIN accounting_voucher_lines avl ON avl.account_id = a.id
            WHERE ${where.join(' AND ')}
            GROUP BY a.id, a.code, a.name, a.account_type, a.parent_id, a.is_active, p.name, p.code
            ORDER BY a.code
        `, params);

        return res.json({ data: result.rows, total: result.rows.length });
    } catch (err) {
        console.error('[Accounts] GET / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/accounts/:id
// Single account detail with voucher lines
// =============================================================================
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const accRes = await db.query(`
            SELECT
                a.id, a.code, a.name, a.account_type, a.parent_id, a.is_active,
                p.name AS parent_name,
                COALESCE(SUM(avl.debit),  0) AS total_debit,
                COALESCE(SUM(avl.credit), 0) AS total_credit,
                COALESCE(SUM(avl.debit),  0) - COALESCE(SUM(avl.credit), 0) AS balance
            FROM accounts a
            LEFT JOIN accounts p          ON p.id = a.parent_id
            LEFT JOIN accounting_voucher_lines avl ON avl.account_id = a.id
            WHERE a.id = $1
            GROUP BY a.id, a.code, a.name, a.account_type, a.parent_id, a.is_active, p.name
        `, [id]);

        if (!accRes.rows.length) return res.status(404).json({ error: 'Account not found.' });

        const linesRes = await db.query(`
            SELECT
                avl.id, avl.debit AS debit_amount, avl.credit AS credit_amount, avl.description,
                av.voucher_number, av.voucher_date, av.voucher_type, av.status
            FROM accounting_voucher_lines avl
            JOIN accounting_vouchers av ON av.id = avl.voucher_id
            WHERE avl.account_id = $1
            ORDER BY av.voucher_date DESC, av.voucher_number DESC
            LIMIT 100
        `, [id]);

        return res.json({ data: { account: accRes.rows[0], lines: linesRes.rows } });
    } catch (err) {
        console.error('[Accounts] GET /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/accounts
// Create a new account
// =============================================================================
router.post('/', restrictWrite, validateBody(accountCreate), async (req, res) => {
    try {
        const { code, name, account_type, parent_id } = req.validatedBody;

        if (!code || !name || !account_type) {
            return res.status(400).json({ error: 'code و name و account_type مطلوبة.' });
        }

        const valid_types = ['asset','liability','equity','revenue','expense'];
        if (!valid_types.includes(account_type)) {
            return res.status(400).json({ error: 'نوع الحساب غير صحيح.' });
        }

        // Check code uniqueness
        const exists = await db.query('SELECT id FROM accounts WHERE code = $1', [code]);
        if (exists.rows.length) return res.status(409).json({ error: `كود الحساب "${code}" موجود مسبقاً.` });

        const result = await db.query(`
            INSERT INTO accounts (code, name, account_type, parent_id, is_active)
            VALUES ($1, $2, $3, $4, true)
            RETURNING *
        `, [code, name, account_type, parent_id || null]);

        return res.status(201).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Accounts] POST / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// PUT /api/accounts/:id
// Update account (name, parent_id, is_active only — code & type are immutable)
// =============================================================================
router.put('/:id', restrictEdit, validateBody(accountUpdate), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, parent_id, is_active } = req.validatedBody;

        if (!name) return res.status(400).json({ error: 'اسم الحساب مطلوب.' });

        const result = await db.query(`
            UPDATE accounts
            SET name = $1, parent_id = $2, is_active = $3
            WHERE id = $4
            RETURNING *
        `, [name, parent_id || null, is_active !== false, id]);

        if (!result.rows.length) return res.status(404).json({ error: 'Account not found.' });

        return res.json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Accounts] PUT /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
