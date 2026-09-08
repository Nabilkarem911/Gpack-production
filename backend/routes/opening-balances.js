'use strict';

// =============================================================================
// G.PACK 2.0 — Opening Balances Route
// /api/opening-balances
//
// Every opening balance produces ONE balanced voucher (voucher_type =
// 'opening_balance') with two lines:
//   - target account leg (debit or credit per `side`)
//   - contra leg on equity account '3300 — الأرصدة الافتتاحية'
// Clients post to control account 1300 with sub_account_type='client';
// suppliers to 2100 with sub_account_type='supplier'; any other account posts
// directly. Statements already read posted voucher lines, so balances appear in
// كشوف الحسابات automatically.
//
// Immutability: vouchers are never updated. Edit = reverse old voucher + post a
// new one. Cancel = mark voucher 'reversed' + opening_balances.status='cancelled'.
// =============================================================================

const express   = require('express');
const router    = express.Router();
const db        = require('../db');
const authorize = require('../middleware/authorize');

router.use(authorize('opening_balance', 'view'));
const restrictCreate = authorize('opening_balance', 'create');
const restrictEdit   = authorize('opening_balance', 'edit');
const restrictDelete = authorize('opening_balance', 'delete');

const CONTRA_CODE  = '3300';          // الأرصدة الافتتاحية (equity)
const CONTROL_CODES = { client: '1300', supplier: '2100' };

// ── Resolve the contra account id (seeded by migration 093) ──────────────────
async function _contraAccountId(client) {
    const r = await client.query(
        `SELECT id FROM accounts WHERE code = $1 AND is_active = true`, [CONTRA_CODE]
    );
    if (!r.rows.length) {
        const e = new Error('حساب الأرصدة الافتتاحية (3300) غير موجود في الدليل.');
        e.statusCode = 500;
        throw e;
    }
    return r.rows[0].id;
}

// ── Resolve the target account + sub-ledger from the request body ─────────────
async function _resolveTarget(client, body) {
    const kind = body.account_kind; // 'client' | 'supplier' | 'account'
    if (!['client', 'supplier', 'account'].includes(kind)) {
        const e = new Error('نوع الحساب يجب أن يكون: عميل أو مورد أو حساب.');
        e.statusCode = 400; throw e;
    }

    if (kind === 'account') {
        if (!body.account_id) {
            const e = new Error('الحساب مطلوب.'); e.statusCode = 400; throw e;
        }
        const r = await client.query(
            `SELECT id, code, name, account_type FROM accounts WHERE id = $1 AND is_active = true`,
            [body.account_id]
        );
        if (!r.rows.length) {
            const e = new Error('الحساب غير موجود أو غير نشط.'); e.statusCode = 400; throw e;
        }
        return { accountId: r.rows[0].id, subType: null, subId: null, label: `${r.rows[0].code} — ${r.rows[0].name}` };
    }

    // client / supplier sub-ledger on the control account
    if (!body.sub_account_id) {
        const e = new Error(kind === 'client' ? 'العميل مطلوب.' : 'المورد مطلوب.');
        e.statusCode = 400; throw e;
    }
    const table = kind === 'client' ? 'clients' : 'suppliers';
    const nameCol = kind === 'client' ? 'name' : 'company_name';
    const ent = await client.query(
        `SELECT id, ${nameCol} AS label FROM ${table} WHERE id = $1`,
        [body.sub_account_id]
    );
    if (!ent.rows.length) {
        const e = new Error(kind === 'client' ? 'العميل غير موجود.' : 'المورد غير موجود.');
        e.statusCode = 400; throw e;
    }
    const ctrl = await client.query(
        `SELECT id FROM accounts WHERE code = $1 AND is_active = true`,
        [CONTROL_CODES[kind]]
    );
    if (!ctrl.rows.length) {
        const e = new Error(`حساب التحكم ${CONTROL_CODES[kind]} غير موجود.`);
        e.statusCode = 500; throw e;
    }
    return {
        accountId: ctrl.rows[0].id,
        subType: kind,
        subId: body.sub_account_id,
        label: ent.rows[0].label,
    };
}

// ── Insert a balanced opening-balance voucher inside an open transaction ─────
async function _postVoucher(client, { side, amount, date, description, reference, target, userId, openingId }) {
    const desc = `رصيد افتتاحي — ${target.label}` + (description ? ` | ${description}` : '');

    const v = await client.query(
        `INSERT INTO accounting_vouchers
            (voucher_type, voucher_date, description, total_amount, status,
             reference_type, reference_id, created_by)
         VALUES ('opening_balance', $1, $2, $3, 'posted', 'opening_balance', $4, $5)
         RETURNING id, voucher_number`,
        [date, desc, amount, openingId || null, userId || null]
    );
    const voucherId = v.rows[0].id;

    const debitLine  = side === 'debit';
    const refNote    = reference ? `مرجع: ${reference}` : null;
    await client.query(
        `INSERT INTO accounting_voucher_lines
            (voucher_id, account_id, debit, credit, description, sub_account_type, sub_account_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [voucherId, target.accountId,
         debitLine ? amount : 0, debitLine ? 0 : amount,
         refNote || desc, target.subType, target.subId]
    );

    const contraId = await _contraAccountId(client);
    await client.query(
        `INSERT INTO accounting_voucher_lines
            (voucher_id, account_id, debit, credit, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [voucherId, contraId,
         debitLine ? 0 : amount, debitLine ? amount : 0, desc]
    );

    return { voucherId, voucherNumber: v.rows[0].voucher_number };
}

// ── Validate shared scalar fields ─────────────────────────────────────────────
function _validateFields(body) {
    const amount = parseFloat(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return { error: 'المبلغ يجب أن يكون رقمًا موجبًا أكبر من صفر.' };
    }
    if (!['debit', 'credit'].includes(body.side)) {
        return { error: 'طبيعة الرصيد يجب أن تكون مدين أو دائن.' };
    }
    const date = body.balance_date;
    if (!date || isNaN(Date.parse(date))) {
        return { error: 'تاريخ الرصيد مطلوب وصالح.' };
    }
    return { amount, date };
}

// =============================================================================
// GET /api/opening-balances
// List all opening balances with account / sub-ledger names and voucher info.
// =============================================================================
router.get('/', async (req, res) => {
    try {
        const { search, status } = req.query;
        const where  = [];
        const params = [];

        if (status === 'posted' || status === 'cancelled') {
            params.push(status);
            where.push(`ob.status = $${params.length}`);
        }
        if (search) {
            params.push(`%${search}%`);
            where.push(`(a.name ILIKE $${params.length} OR a.code ILIKE $${params.length}
                        OR c.name ILIKE $${params.length} OR s.company_name ILIKE $${params.length}
                        OR ob.reference ILIKE $${params.length} OR av.voucher_number::text ILIKE $${params.length})`);
        }

        const rows = await db.query(
            `SELECT
                ob.id, ob.side, ob.amount, ob.balance_date, ob.description,
                ob.reference, ob.status, ob.created_at, ob.updated_at,
                ob.account_id, ob.sub_account_type, ob.sub_account_id,
                a.code AS account_code, a.name AS account_name, a.account_type,
                CASE
                    WHEN ob.sub_account_type = 'client'   THEN c.name
                    WHEN ob.sub_account_type = 'supplier' THEN s.company_name
                END AS sub_account_name,
                av.id AS voucher_id, av.voucher_number, av.status AS voucher_status,
                u.name AS created_by_name
             FROM opening_balances ob
             JOIN accounts a              ON a.id  = ob.account_id
             LEFT JOIN clients c          ON c.id  = ob.sub_account_id AND ob.sub_account_type = 'client'
             LEFT JOIN suppliers s        ON s.id  = ob.sub_account_id AND ob.sub_account_type = 'supplier'
             LEFT JOIN accounting_vouchers av ON av.id = ob.voucher_id
             LEFT JOIN users u            ON u.id  = ob.created_by
             ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
             ORDER BY ob.balance_date DESC, ob.created_at DESC`,
            params
        );

        return res.json({ data: rows.rows });
    } catch (err) {
        console.error('[OpeningBalances] GET / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/opening-balances/meta
// Selectable accounts + clients + suppliers for the form pickers.
// Accounts that already have a POSTED opening balance are flagged so the UI can
// disable re-entry (edit instead).
// =============================================================================
router.get('/meta', async (_req, res) => {
    try {
        const [accountsRes, clientsRes, suppliersRes, existingRes] = await Promise.all([
            db.query(
                `SELECT a.id, a.code, a.name, a.account_type, a.parent_id
                 FROM accounts a
                 WHERE a.is_active = true
                 ORDER BY a.code ASC`
            ),
            db.query(`SELECT id, name FROM clients ORDER BY name ASC`),
            db.query(`SELECT id, company_name AS name FROM suppliers ORDER BY company_name ASC`),
            db.query(
                `SELECT account_id, sub_account_type, sub_account_id
                 FROM opening_balances WHERE status = 'posted'`
            ),
        ]);

        return res.json({
            data: {
                accounts:  accountsRes.rows,
                clients:   clientsRes.rows,
                suppliers: suppliersRes.rows,
                existing:  existingRes.rows,
            },
        });
    } catch (err) {
        console.error('[OpeningBalances] GET /meta error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/opening-balances
// Create an opening balance. Body:
//   { account_kind: 'client'|'supplier'|'account',
//     account_id?        (kind=account),
//     sub_account_id?    (kind=client|supplier),
//     side: 'debit'|'credit', amount, balance_date, description?, reference? }
// =============================================================================
router.post('/', restrictCreate, async (req, res) => {
    const body = req.body || {};
    const v = _validateFields(body);
    if (v.error) return res.status(400).json({ error: v.error });

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const target = await _resolveTarget(client, body);

        const ins = await client.query(
            `INSERT INTO opening_balances
                (account_id, sub_account_type, sub_account_id, side, amount,
                 balance_date, description, reference, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            [target.accountId, target.subType, target.subId, body.side,
             v.amount, v.date, body.description || null, body.reference || null,
             req.user?.id || null]
        );
        const openingId = ins.rows[0].id;

        const { voucherId, voucherNumber } = await _postVoucher(client, {
            side: body.side, amount: v.amount, date: v.date,
            description: body.description, reference: body.reference,
            target, userId: req.user?.id, openingId,
        });

        await client.query(
            `UPDATE opening_balances SET voucher_id = $1 WHERE id = $2`,
            [voucherId, openingId]
        );

        await client.query('COMMIT');
        return res.status(201).json({ data: { id: openingId, voucher_id: voucherId, voucher_number: voucherNumber } });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') {
            return res.status(409).json({ error: 'يوجد رصيد افتتاحي مسجل لهذا الحساب بالفعل. عدّل الرصيد الموجود بدلًا من إنشاء جديد.' });
        }
        console.error('[OpeningBalances] POST / error:', err.message);
        return res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error.' });
    } finally {
        client.release();
    }
});

// =============================================================================
// PUT /api/opening-balances/:id
// Edit a posted opening balance. Immutability rule: the old voucher is marked
// 'reversed' and a fresh balanced voucher is posted in the same transaction.
// =============================================================================
router.put('/:id', restrictEdit, async (req, res) => {
    const body = req.body || {};
    const v = _validateFields(body);
    if (v.error) return res.status(400).json({ error: v.error });

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const cur = await client.query(
            `SELECT * FROM opening_balances WHERE id = $1 FOR UPDATE`, [req.params.id]
        );
        if (!cur.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'الرصيد الافتتاحي غير موجود.' });
        }
        const row = cur.rows[0];
        if (row.status !== 'posted') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'لا يمكن تعديل رصيد ملغى.' });
        }

        // Account/sub-ledger are fixed; re-derive target label for the new voucher.
        const target = await _resolveTarget(client, {
            account_kind:   row.sub_account_type || 'account',
            account_id:     row.account_id,
            sub_account_id: row.sub_account_id,
        });

        // 1. Reverse the old voucher (kept for audit; excluded from all reports).
        if (row.voucher_id) {
            await client.query(
                `UPDATE accounting_vouchers SET status = 'reversed' WHERE id = $1`,
                [row.voucher_id]
            );
        }

        // 2. Post the new voucher and update the registry row.
        const { voucherId, voucherNumber } = await _postVoucher(client, {
            side: body.side, amount: v.amount, date: v.date,
            description: body.description, reference: body.reference,
            target, userId: req.user?.id, openingId: row.id,
        });

        await client.query(
            `UPDATE opening_balances
             SET side = $1, amount = $2, balance_date = $3, description = $4,
                 reference = $5, voucher_id = $6, updated_at = NOW()
             WHERE id = $7`,
            [body.side, v.amount, v.date, body.description || null,
             body.reference || null, voucherId, row.id]
        );

        await client.query('COMMIT');
        return res.json({ data: { id: row.id, voucher_id: voucherId, voucher_number: voucherNumber } });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[OpeningBalances] PUT /:id error:', err.message);
        return res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error.' });
    } finally {
        client.release();
    }
});

// =============================================================================
// DELETE /api/opening-balances/:id
// Cancel a posted opening balance: voucher → 'reversed', row → 'cancelled'.
// =============================================================================
router.delete('/:id', restrictDelete, async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const cur = await client.query(
            `SELECT id, voucher_id, status FROM opening_balances WHERE id = $1 FOR UPDATE`,
            [req.params.id]
        );
        if (!cur.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'الرصيد الافتتاحي غير موجود.' });
        }
        if (cur.rows[0].status !== 'posted') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'الرصيد ملغى مسبقًا.' });
        }

        if (cur.rows[0].voucher_id) {
            await client.query(
                `UPDATE accounting_vouchers SET status = 'reversed' WHERE id = $1`,
                [cur.rows[0].voucher_id]
            );
        }
        await client.query(
            `UPDATE opening_balances SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
            [cur.rows[0].id]
        );

        await client.query('COMMIT');
        return res.json({ data: { id: cur.rows[0].id } });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[OpeningBalances] DELETE /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    } finally {
        client.release();
    }
});

module.exports = router;
