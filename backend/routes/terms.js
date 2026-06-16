'use strict';

const express = require('express');
const db      = require('../db');
const authorize = require('../middleware/authorize');

const router = express.Router();

// =============================================================================
// GET /api/terms
// Returns all standard terms, optionally filtered by is_active.
// =============================================================================

router.get('/', async (req, res) => {
    try {
        const { active } = req.query;
        let sql = 'SELECT * FROM standard_terms';
        const params = [];

        if (active === 'true') {
            sql += ' WHERE is_active = true';
        }

        sql += ' ORDER BY is_default DESC, created_at DESC';

        const result = await db.query(sql, params);
        return res.status(200).json({ data: result.rows });
    } catch (err) {
        console.error('[Terms] GET / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/terms/:id
// =============================================================================

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            'SELECT * FROM standard_terms WHERE id = $1 LIMIT 1',
            [id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'البند غير موجود.' });
        }
        return res.status(200).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Terms] GET /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/terms
// Creates a new standard term.
// Body: { title, content, is_default }
// =============================================================================

router.post('/', authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    const { title, content, is_default } = req.body;

    if (!title || !title.trim()) {
        return res.status(400).json({ error: 'عنوان البند مطلوب.' });
    }
    if (!content || !content.trim()) {
        return res.status(400).json({ error: 'محتوى البند مطلوب.' });
    }

    try {
        const result = await db.query(
            `INSERT INTO standard_terms (title, content, is_default)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [title.trim(), content.trim(), is_default || false]
        );

        return res.status(201).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Terms] POST / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// PUT /api/terms/:id
// Updates an existing standard term.
// Body: { title, content, is_default, is_active }
// =============================================================================

router.put('/:id', authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    const { id } = req.params;
    const { title, content, is_default, is_active } = req.body;

    if (!title || !title.trim()) {
        return res.status(400).json({ error: 'عنوان البند مطلوب.' });
    }
    if (!content || !content.trim()) {
        return res.status(400).json({ error: 'محتوى البند مطلوب.' });
    }

    try {
        const result = await db.query(
            `UPDATE standard_terms
             SET title      = $1,
                 content    = $2,
                 is_default = $3,
                 is_active  = $4
             WHERE id = $5
             RETURNING *`,
            [title.trim(), content.trim(), is_default || false, is_active !== false, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'البند غير موجود.' });
        }

        return res.status(200).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Terms] PUT /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// DELETE /api/terms/:id
// =============================================================================

router.delete('/:id', authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            'DELETE FROM standard_terms WHERE id = $1 RETURNING id',
            [id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'البند غير موجود.' });
        }
        return res.status(200).json({ data: { id, deleted: true } });
    } catch (err) {
        console.error('[Terms] DELETE /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
