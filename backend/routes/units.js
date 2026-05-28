'use strict';

const express = require('express');
const db      = require('../db');
const router  = express.Router();

// =============================================================================
// GET /api/units
// Returns all measurement units ordered by name.
// =============================================================================
router.get('/', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, name, abbreviation, base_unit_id, conversion_factor, created_at
             FROM units
             ORDER BY name ASC`
        );
        return res.status(200).json({ data: result.rows });
    } catch (err) {
        console.error('[Units] GET / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/units
// Creates a new unit.
// =============================================================================
router.post('/', async (req, res) => {
    const { name, abbreviation, base_unit_id, conversion_factor } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'اسم الوحدة مطلوب.' });
    }
    try {
        const result = await db.query(
            `INSERT INTO units (name, abbreviation, base_unit_id, conversion_factor)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [
                name.trim(),
                abbreviation || null,
                base_unit_id || null,
                parseFloat(conversion_factor) || 1,
            ]
        );
        return res.status(201).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Units] POST / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// PUT /api/units/:id
// Updates name and abbreviation of a unit.
// =============================================================================
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, abbreviation } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'اسم الوحدة مطلوب.' });
    }

    try {
        const result = await db.query(
            `UPDATE units
             SET name = $1, abbreviation = $2
             WHERE id = $3
             RETURNING *`,
            [name.trim(), abbreviation || null, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'الوحدة غير موجودة.' });
        }

        return res.status(200).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Units] PUT /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// DELETE /api/units/:id
// Deletes a unit. Blocked if linked to product variants (FK violation).
// =============================================================================
router.delete('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await db.query(
            'DELETE FROM units WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'الوحدة غير موجودة.' });
        }

        return res.status(200).json({ message: 'تم حذف الوحدة بنجاح.' });
    } catch (err) {
        console.error('[Units] DELETE /:id error:', err.message);
        if (err.code === '23503') {
            return res.status(400).json({ error: 'لا يمكن حذف هذه الوحدة لارتباطها بمنتجات.' });
        }
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
