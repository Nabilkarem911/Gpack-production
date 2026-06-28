'use strict';

// =============================================================================
// G.PACK 2.0 — Journal Entries Route
// /api/journal-entries
// Stores manual double-entry journal vouchers in accounting_vouchers
// =============================================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const authorize = require('../middleware/authorize');

router.use(authorize('journal_entry', 'view'));
const restrictWrite  = authorize('journal_entry', 'create');
const restrictDelete = authorize('journal_entry', 'delete');

// =============================================================================
// GET /api/journal-entries
// List all manual journal vouchers (voucher_type = 'journal')
// =============================================================================
router.get('/', async (req, res) => {
    try {
        const { search, date_from, date_to, limit = 50, offset = 0 } = req.query;

        let where  = [`av.voucher_type = 'journal'`];
        const params = [];

        if (search) {
            params.push(`%${search}%`);
            where.push(`(av.description ILIKE $${params.length} OR av.voucher_number::text ILIKE $${params.length})`);
        }
        if (date_from) {
            params.push(date_from);
            where.push(`av.voucher_date >= $${params.length}`);
        }
        if (date_to) {
            params.push(date_to);
            where.push(`av.voucher_date <= $${params.length}`);
        }

        // Count
        const countRes = await db.query(
            `SELECT COUNT(*)::int AS total FROM accounting_vouchers av WHERE ${where.join(' AND ')}`,
            params
        );

        params.push(parseInt(limit));
        params.push(parseInt(offset));

        const rows = await db.query(`
            SELECT
                av.id, av.voucher_number, av.voucher_date, av.description,
                av.total_amount, av.status, av.created_at,
                u.name AS created_by_name
            FROM accounting_vouchers av
            LEFT JOIN users u ON u.id = av.created_by
            WHERE ${where.join(' AND ')}
            ORDER BY av.voucher_date DESC, av.voucher_number DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);

        return res.json({ data: rows.rows, total: countRes.rows[0].total });
    } catch (err) {
        console.error('[JournalEntries] GET / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/journal-entries/:id
// Single journal entry with lines
// =============================================================================
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const vRes = await db.query(`
            SELECT av.id, av.voucher_number, av.voucher_date, av.description,
                   av.total_amount, av.status, av.created_at,
                   u.name AS created_by_name
            FROM accounting_vouchers av
            LEFT JOIN users u ON u.id = av.created_by
            WHERE av.id = $1 AND av.voucher_type = 'journal'
        `, [id]);

        if (!vRes.rows.length) return res.status(404).json({ error: 'Journal entry not found.' });

        const linesRes = await db.query(`
            SELECT avl.id, avl.debit, avl.credit, avl.description,
                   avl.account_id, avl.sub_account_type, avl.sub_account_id,
                   a.code AS account_code, a.name AS account_name, a.account_type,
                   CASE
                       WHEN avl.sub_account_type = 'client'   THEN c.name
                       WHEN avl.sub_account_type = 'supplier' THEN s.company_name
                   END AS sub_account_name
            FROM accounting_voucher_lines avl
            JOIN accounts a   ON a.id = avl.account_id
            LEFT JOIN clients   c ON c.id = avl.sub_account_id AND avl.sub_account_type = 'client'
            LEFT JOIN suppliers s ON s.id = avl.sub_account_id AND avl.sub_account_type = 'supplier'
            WHERE avl.voucher_id = $1
            ORDER BY avl.id
        `, [id]);

        return res.json({ data: { voucher: vRes.rows[0], lines: linesRes.rows } });
    } catch (err) {
        console.error('[JournalEntries] GET /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/journal-entries
// Create a new manual journal entry
// Body: { voucher_date, description, lines: [{ account_id, debit, credit, description }] }
// Rules:
//   - Minimum 2 lines
//   - SUM(debit) must equal SUM(credit)
//   - Each line: either debit > 0 OR credit > 0, not both, not zero
// =============================================================================
router.post('/', restrictWrite, async (req, res) => {
    const { voucher_date, description, lines } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!voucher_date)              return res.status(400).json({ error: 'تاريخ القيد مطلوب.' });
    if (!Array.isArray(lines) || lines.length < 2)
        return res.status(400).json({ error: 'القيد يجب أن يحتوي على سطرين على الأقل.' });

    let totalDebit  = 0;
    let totalCredit = 0;

    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const d = parseFloat(l.debit  || 0);
        const c = parseFloat(l.credit || 0);

        if (!l.account_id)            return res.status(400).json({ error: `السطر ${i + 1}: الحساب مطلوب.` });
        if (d < 0 || c < 0)           return res.status(400).json({ error: `السطر ${i + 1}: القيم يجب أن تكون موجبة.` });
        if (d === 0 && c === 0)        return res.status(400).json({ error: `السطر ${i + 1}: يجب إدخال مدين أو دائن.` });
        if (d > 0 && c > 0)            return res.status(400).json({ error: `السطر ${i + 1}: لا يمكن أن يكون مدين ودائن في نفس السطر.` });

        totalDebit  += d;
        totalCredit += c;
    }

    // Round to 2 decimals to avoid floating point issues
    totalDebit  = Math.round(totalDebit  * 100) / 100;
    totalCredit = Math.round(totalCredit * 100) / 100;

    if (totalDebit !== totalCredit) {
        return res.status(400).json({
            error: `القيد غير متوازن — إجمالي المدين (${totalDebit}) ≠ إجمالي الدائن (${totalCredit}).`
        });
    }

    // ── Insert inside transaction ──────────────────────────────────────────────
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // 1. Insert the voucher header
        const vRes = await client.query(`
            INSERT INTO accounting_vouchers
                (voucher_type, voucher_date, description, total_amount, status, created_by)
            VALUES ('journal', $1, $2, $3, 'posted', $4)
            RETURNING *
        `, [voucher_date, description || null, totalDebit, req.user?.id || null]);

        const voucherId = vRes.rows[0].id;

        // 2. Insert lines
        for (const l of lines) {
            await client.query(`
                INSERT INTO accounting_voucher_lines
                    (voucher_id, account_id, debit, credit, description, sub_account_type, sub_account_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                voucherId,
                l.account_id,
                parseFloat(l.debit  || 0),
                parseFloat(l.credit || 0),
                l.description       || null,
                l.sub_account_type  || null,
                l.sub_account_id    || null,
            ]);
        }

        await client.query('COMMIT');

        return res.status(201).json({ data: vRes.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[JournalEntries] POST / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    } finally {
        client.release();
    }
});

// =============================================================================
// DELETE /api/journal-entries/:id
// Soft-delete by setting status = 'reversed' (accounting immutability rule)
// =============================================================================
router.delete('/:id', restrictDelete, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(`
            UPDATE accounting_vouchers
            SET status = 'reversed'
            WHERE id = $1 AND voucher_type = 'journal' AND status = 'posted'
            RETURNING id, voucher_number
        `, [id]);

        if (!result.rows.length)
            return res.status(404).json({ error: 'القيد غير موجود أو تم عكسه مسبقاً.' });

        return res.json({ data: result.rows[0] });
    } catch (err) {
        console.error('[JournalEntries] DELETE /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
