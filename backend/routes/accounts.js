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

function _normalizeCode(code) {
    return String(code || '').trim();
}

function _countTrailingZeros(code) {
    const normalized = _normalizeCode(code);
    const match = normalized.match(/0+$/);
    return match ? match[0].length : 0;
}

function _parseSequenceDigit(parentCode, childCode) {
    const normalizedParent = _normalizeCode(parentCode);
    const normalizedChild  = _normalizeCode(childCode);

    if (!normalizedParent || !normalizedChild) return null;

    const trailingZeros = _countTrailingZeros(normalizedParent);
    if (trailingZeros > 0) {
        const prefix = normalizedParent.slice(0, -trailingZeros);
        const suffix = '0'.repeat(trailingZeros - 1);
        const expectedPrefix = `${prefix}`;
        const expectedSuffix  = `${suffix}`;
        if (!normalizedChild.startsWith(expectedPrefix) || !normalizedChild.endsWith(expectedSuffix)) {
            return null;
        }

        const digit = normalizedChild.slice(prefix.length, prefix.length + 1);
        return /^\d$/.test(digit) ? parseInt(digit, 10) : null;
    }

    if (!normalizedChild.startsWith(normalizedParent) || normalizedChild.length !== normalizedParent.length + 1) {
        return null;
    }

    const digit = normalizedChild.slice(-1);
    return /^\d$/.test(digit) ? parseInt(digit, 10) : null;
}

function _nextRootCode(rootCodes) {
    const existing = rootCodes
        .map(code => _normalizeCode(code))
        .filter(code => /^\d{4}$/.test(code) && code.endsWith('000'))
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    const last = existing.length ? existing[existing.length - 1] : null;
    if (!last) return '1000';

    const next = parseInt(last.slice(0, 1), 10) + 1;
    if (next > 9) {
        throw new Error('لا توجد أكواد جذر متاحة.');
    }

    return `${next}000`;
}

function _nextHierarchicalCode(parentCode, siblingCodes) {
    const normalizedParent = _normalizeCode(parentCode);
    const normalizedSiblings = siblingCodes.map(code => _normalizeCode(code)).filter(Boolean);

    if (!normalizedParent) {
        return _nextRootCode(normalizedSiblings);
    }

    if (!/^\d+$/.test(normalizedParent)) {
        throw new Error('كود الحساب الأب يجب أن يكون رقمياً.');
    }

    const trailingZeros = _countTrailingZeros(normalizedParent);
    const highestSeq = normalizedSiblings.reduce((max, siblingCode) => {
        const seq = _parseSequenceDigit(normalizedParent, siblingCode);
        return seq === null ? max : Math.max(max, seq);
    }, 0);

    if (highestSeq >= 9) {
        throw new Error('لا توجد أكواد فرعية متاحة تحت هذا الحساب الأب.');
    }

    if (trailingZeros > 0) {
        const prefix = normalizedParent.slice(0, -trailingZeros);
        const suffix = '0'.repeat(trailingZeros - 1);
        return `${prefix}${highestSeq + 1}${suffix}`;
    }

    return `${normalizedParent}${highestSeq + 1}`;
}

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

        if (!name || !account_type) {
            return res.status(400).json({ error: 'name و account_type مطلوبة.' });
        }

        const valid_types = ['asset','liability','equity','revenue','expense'];
        if (!valid_types.includes(account_type)) {
            return res.status(400).json({ error: 'نوع الحساب غير صحيح.' });
        }

        const result = await db.withTransaction(async (client) => {
            let finalCode = _normalizeCode(code);

            if (!finalCode) {
                const lockKey = parent_id ? `accounts-parent:${parent_id}` : 'accounts-root';
                await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

                if (parent_id) {
                    const parentRes = await client.query(
                        'SELECT id, code FROM accounts WHERE id = $1 FOR SHARE',
                        [parent_id]
                    );

                    if (!parentRes.rows.length) {
                        const err = new Error('الحساب الأب غير موجود.');
                        err.statusCode = 400;
                        throw err;
                    }

                    const siblingsRes = await client.query(
                        'SELECT code FROM accounts WHERE parent_id = $1 FOR UPDATE',
                        [parent_id]
                    );

                    finalCode = _nextHierarchicalCode(parentRes.rows[0].code, siblingsRes.rows.map(r => r.code));
                } else {
                    const rootsRes = await client.query(
                        'SELECT code FROM accounts WHERE parent_id IS NULL FOR UPDATE',
                        []
                    );

                    finalCode = _nextHierarchicalCode('', rootsRes.rows.map(r => r.code));
                }
            }

            if (!finalCode) {
                const err = new Error('تعذّر توليد كود الحساب.');
                err.statusCode = 400;
                throw err;
            }

            const exists = await client.query('SELECT id FROM accounts WHERE code = $1', [finalCode]);
            if (exists.rows.length) {
                const err = new Error(`كود الحساب "${finalCode}" موجود مسبقاً.`);
                err.statusCode = 409;
                throw err;
            }

            const inserted = await client.query(`
                INSERT INTO accounts (code, name, account_type, parent_id, is_active)
                VALUES ($1, $2, $3, $4, true)
                RETURNING *
            `, [finalCode, name, account_type, parent_id || null]);

            return inserted.rows[0];
        });

        return res.status(201).json({ data: result });
    } catch (err) {
        console.error('[Accounts] POST / error:', err.message);
        return res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error.' });
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
