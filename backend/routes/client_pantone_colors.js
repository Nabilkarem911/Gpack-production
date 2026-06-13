'use strict';
// =============================================================================
// G.PACK 2.0 — Client Pantone Colors Routes
// Endpoints: GET / POST / DELETE per client
// =============================================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate } = require('../middleware/authMiddleware');
const { success, error, created } = require('../utils/response');

// ── Auto-create table if not exists (idempotent) ──────────────────────────────
async function ensureTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS client_pantone_colors (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
            color_code  VARCHAR(50)  NOT NULL,
            color_name  VARCHAR(100),
            hex_value   VARCHAR(7),
            notes       TEXT,
            sort_order  INT DEFAULT 0,
            created_at  TIMESTAMP DEFAULT NOW()
        )
    `);
    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_pantone_client ON client_pantone_colors(client_id)
    `);
}
ensureTable().catch(e => console.error('[PantoneColors] Table init error:', e.message));

// ── GET /api/client-pantone-colors?client_id=xxx ─────────────────────────────
router.get('/', authenticate, async (req, res) => {
    try {
        const { client_id } = req.query;
        if (!client_id) return error(res, 'client_id is required', 400);

        // Ownership check for sales_rep
        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep) {
            const clientCheck = await db.query(
                'SELECT created_by FROM clients WHERE id = $1 LIMIT 1',
                [client_id]
            );
            if (!clientCheck.rows.length || clientCheck.rows[0].created_by !== req.user.id) {
                return error(res, 'غير مصرح لك بعرض ألوان هذا العميل.', 403);
            }
        }

        const result = await db.query(
            `SELECT * FROM client_pantone_colors
             WHERE client_id = $1
             ORDER BY sort_order ASC, created_at ASC`,
            [client_id]
        );
        return success(res, result.rows);
    } catch (err) {
        console.error('[PantoneColors] GET error:', err.message);
        return error(res, err.message, 500);
    }
});

// ── POST /api/client-pantone-colors ──────────────────────────────────────────
// Body: { client_id, color_code, color_name, hex_value, notes, sort_order }
router.post('/', authenticate, async (req, res) => {
    try {
        const { client_id, color_code, color_name, hex_value, notes, sort_order } = req.body;
        if (!client_id || !color_code) return error(res, 'client_id and color_code are required', 400);

        // Ownership check for sales_rep
        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep) {
            const clientCheck = await db.query(
                'SELECT created_by FROM clients WHERE id = $1 LIMIT 1',
                [client_id]
            );
            if (!clientCheck.rows.length || clientCheck.rows[0].created_by !== req.user.id) {
                return error(res, 'غير مصرح لك بإضافة ألوان لهذا العميل.', 403);
            }
        }

        // Prevent duplicate color_code per client
        const dup = await db.query(
            `SELECT id FROM client_pantone_colors WHERE client_id = $1 AND color_code = $2`,
            [client_id, color_code.trim()]
        );
        if (dup.rowCount > 0) return error(res, 'هذا الكود موجود مسبقاً لهذا العميل', 409);

        const result = await db.query(
            `INSERT INTO client_pantone_colors
             (client_id, color_code, color_name, hex_value, notes, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6)
             RETURNING *`,
            [client_id, color_code.trim(), color_name || null, hex_value || null, notes || null, sort_order || 0]
        );
        return created(res, result.rows[0], 'تم إضافة اللون بنجاح');
    } catch (err) {
        console.error('[PantoneColors] POST error:', err.message);
        return error(res, err.message, 500);
    }
});

// ── PATCH /api/client-pantone-colors/:id ─────────────────────────────────────
router.patch('/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { color_code, color_name, hex_value, notes, sort_order } = req.body;

        // Ownership check for sales_rep
        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep) {
            const colorCheck = await db.query(
                'SELECT client_id FROM client_pantone_colors WHERE id = $1 LIMIT 1',
                [id]
            );
            if (colorCheck.rows.length) {
                const clientCheck = await db.query(
                    'SELECT created_by FROM clients WHERE id = $1 LIMIT 1',
                    [colorCheck.rows[0].client_id]
                );
                if (!clientCheck.rows.length || clientCheck.rows[0].created_by !== req.user.id) {
                    return error(res, 'غير مصرح لك بتعديل هذا اللون.', 403);
                }
            }
        }

        const result = await db.query(
            `UPDATE client_pantone_colors
             SET color_code  = COALESCE($1, color_code),
                 color_name  = COALESCE($2, color_name),
                 hex_value   = COALESCE($3, hex_value),
                 notes       = COALESCE($4, notes),
                 sort_order  = COALESCE($5, sort_order)
             WHERE id = $6
             RETURNING *`,
            [color_code || null, color_name || null, hex_value || null, notes || null,
             sort_order !== undefined ? sort_order : null, id]
        );
        if (result.rowCount === 0) return error(res, 'اللون غير موجود', 404);
        return res.status(200).json({ success: true, data: result.rows[0], message: 'تم التحديث بنجاح' });
    } catch (err) {
        console.error('[PantoneColors] PATCH error:', err.message);
        return error(res, err.message, 500);
    }
});

// ── DELETE /api/client-pantone-colors/:id ────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;

        // Ownership check for sales_rep
        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep) {
            const colorCheck = await db.query(
                'SELECT client_id FROM client_pantone_colors WHERE id = $1 LIMIT 1',
                [id]
            );
            if (colorCheck.rows.length) {
                const clientCheck = await db.query(
                    'SELECT created_by FROM clients WHERE id = $1 LIMIT 1',
                    [colorCheck.rows[0].client_id]
                );
                if (!clientCheck.rows.length || clientCheck.rows[0].created_by !== req.user.id) {
                    return error(res, 'غير مصرح لك بحذف هذا اللون.', 403);
                }
            }
        }

        const result = await db.query(
            `DELETE FROM client_pantone_colors WHERE id = $1 RETURNING id`,
            [id]
        );
        if (result.rowCount === 0) return error(res, 'اللون غير موجود', 404);
        return res.status(200).json({ success: true, data: { id }, message: 'تم حذف اللون بنجاح' });
    } catch (err) {
        console.error('[PantoneColors] DELETE error:', err.message);
        return error(res, err.message, 500);
    }
});

module.exports = router;
