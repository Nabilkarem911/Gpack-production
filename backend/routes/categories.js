'use strict';

const express = require('express');
const db      = require('../db');
const authorize = require('../middleware/authorize');
const router  = express.Router();

// View permission: 'products', 'inventory', 'warehouses', 'vmi_dispatch', or 'receiving' can access
// (inventory.js fetches categories for dropdowns)
router.use((req, res, next) => {
    const perms = req.user && req.user.permissions;
    const role  = req.user && req.user.role;
    if (role === 'super_admin' || role === 'admin') return next();
    if (perms && perms.all_access === true) return next();
    const _hasView = (key) => perms && perms[key] && (perms[key].view === true || perms[key] === true || (Array.isArray(perms[key]) && perms[key].includes('view')));
    if (_hasView('products') || _hasView('inventory') || _hasView('warehouses') || _hasView('vmi_dispatch') || _hasView('receiving')) return next();
    return res.status(403).json({ error: 'Forbidden: No view permission on products.' });
});

// =============================================================================
// GET /api/categories
// Returns all categories ordered by name.
// =============================================================================
router.get('/', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, name, parent_id, description, created_at
             FROM categories
             ORDER BY name ASC`
        );
        return res.status(200).json({ data: result.rows });
    } catch (err) {
        console.error('[Categories] GET / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/categories
// Creates a new category.
// =============================================================================
router.post('/', authorize('products', 'create'), async (req, res) => {
    const { name, parent_id, description } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'اسم الفئة مطلوب.' });
    }
    try {
        const result = await db.query(
            `INSERT INTO categories (name, parent_id, description)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [name.trim(), parent_id || null, description || null]
        );
        return res.status(201).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Categories] POST / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// PUT /api/categories/:id
// Updates name and description of a category.
// =============================================================================
router.put('/:id', authorize('products', 'edit'), async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'اسم الفئة مطلوب.' });
    }

    try {
        const result = await db.query(
            `UPDATE categories
             SET name = $1, description = $2
             WHERE id = $3
             RETURNING *`,
            [name.trim(), description || null, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'التصنيف غير موجود.' });
        }

        return res.status(200).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Categories] PUT /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// DELETE /api/categories/:id
// Deletes a category. Blocked if linked to products (FK violation).
// =============================================================================
router.delete('/:id', authorize('products', 'delete'), async (req, res) => {
    const { id } = req.params;

    try {
        const result = await db.query(
            'DELETE FROM categories WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'التصنيف غير موجود.' });
        }

        return res.status(200).json({ message: 'تم حذف التصنيف بنجاح.' });
    } catch (err) {
        console.error('[Categories] DELETE /:id error:', err.message);
        if (err.code === '23503') {
            return res.status(400).json({ error: 'لا يمكن حذف هذا التصنيف لارتباطه بمنتجات.' });
        }
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
