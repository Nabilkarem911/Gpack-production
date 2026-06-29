'use strict';

const express = require('express');
const db = require('../db');
const authorize = require('../middleware/authorize');
const { validateBody, productCreate, productUpdate, variantCreate, variantUpdate } = require('../utils/validators');

const router = express.Router();

// All routes are protected by the authenticate middleware mounted in server.js.
// SCHEMA RULE: products and product_variants are GENERAL — never tied to a client_id.
// Client-specific inventory lives exclusively in warehouse_stock.

// View permission: 'products', 'inventory', or 'warehouses' view can access
// (inventory.js and warehouses pages fetch products for dropdowns)
router.use((req, res, next) => {
    const perms = req.user && req.user.permissions;
    const role  = req.user && req.user.role;
    if (role === 'super_admin' || role === 'admin') return next();
    if (perms && perms.all_access === true) return next();
    const _hasView = (key) => perms && perms[key] && (perms[key].view === true || perms[key] === true || (Array.isArray(perms[key]) && perms[key].includes('view')));
    if (_hasView('products') || _hasView('inventory') || _hasView('warehouses') || _hasView('vmi_dispatch') || _hasView('receiving')) return next();
    return res.status(403).json({ error: 'Forbidden: No view permission on products.' });
});

// Write/Delete permissions: only admin/manager/super_admin (enforced via authorize role check)
const restrictWrite = authorize(['admin', 'manager', 'super_admin']);

// =============================================================================
// GET /api/products
// Returns all products. Optionally includes their variants.
// Query params:
//   ?include_variants=true  — join variants into a nested array
//   ?category_id=<uuid>     — filter by category
//   ?search=<string>        — filter by name or SKU
//   ?status=active|inactive — filter by status (default: all)
// =============================================================================

router.get('/', async (req, res) => {
    try {
        const { include_variants, category_id, search, status } = req.query;

        const conditions = [];
        const params     = [];

        if (category_id) {
            params.push(category_id);
            conditions.push(`p.category_id = $${params.length}`);
        }

        if (search) {
            params.push(`%${search}%`);
            conditions.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`);
        }

        if (status) {
            params.push(status);
            conditions.push(`p.status = $${params.length}`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const productsResult = await db.query(
            `SELECT
                p.id,
                p.name,
                p.description,
                p.category_id,
                c.name   AS category_name,
                p.sku,
                p.barcode,
                p.status,
                p.created_by,
                u.name   AS created_by_name,
                p.created_at,
                p.updated_at
             FROM products p
             LEFT JOIN categories c ON c.id = p.category_id
             LEFT JOIN users u ON u.id = p.created_by
             ${whereClause}
             ORDER BY p.created_at DESC`,
            params
        );

        const products = productsResult.rows;

        // If variants are requested, fetch them all in one query and map by product_id
        if (include_variants === 'true' && products.length > 0) {
            const productIds = products.map(p => p.id);

            const variantsResult = await db.query(
                `SELECT
                    pv.id,
                    pv.product_id,
                    pv.size_name,
                    pv.sku,
                    pv.barcode,
                    pv.unit_id,
                    u.name        AS unit_name,
                    u.abbreviation AS unit_abbreviation,
                    pv.selling_price,
                    pv.cost_price,
                    pv.min_stock_level,
                    pv.max_stock_level,
                    pv.weight,
                    pv.dimensions,
                    pv.status,
                    pv.created_at
                 FROM product_variants pv
                 LEFT JOIN units u ON u.id = pv.unit_id
                 WHERE pv.product_id = ANY($1::uuid[])
                 ORDER BY pv.created_at ASC`,
                [productIds]
            );

            // Group variants by product_id for O(n) mapping
            const variantsByProduct = {};
            variantsResult.rows.forEach(v => {
                if (!variantsByProduct[v.product_id]) {
                    variantsByProduct[v.product_id] = [];
                }
                variantsByProduct[v.product_id].push(v);
            });

            products.forEach(p => {
                p.variants = variantsByProduct[p.id] || [];
            });
        }

        return res.status(200).json({ data: products });
    } catch (err) {
        console.error('[Products] GET / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/products/movements
// Returns inventory movements (receipts from suppliers + dispatches to clients).
// Query params:
//   ?search=<string>       — filter by product name or size_name
//   ?category_id=<uuid>    — filter by product category
//   ?variant_id=<uuid>     — filter by specific variant
//   ?type=receipt|dispense — filter by movement type
//   ?from=<date>           — from date (ISO)
//   ?to=<date>             — to date (ISO)
//   ?limit=<n>             — default 200
//   ?offset=<n>            — default 0
// =============================================================================

router.get('/movements', async (req, res) => {
    try {
        const { search, category_id, variant_id, type, client_id, supplier_id, from, to } = req.query;
        const limit  = Math.min(parseInt(req.query.limit  || '200', 10), 500);
        const offset = parseInt(req.query.offset || '0', 10);

        const conditions = [];
        const params = [];

        if (type) {
            params.push(type);
            conditions.push(`it.transaction_type = $${params.length}`);
        }
        if (variant_id) {
            params.push(variant_id);
            conditions.push(`it.variant_id = $${params.length}`);
        }
        if (category_id) {
            params.push(category_id);
            conditions.push(`p.category_id = $${params.length}`);
        }
        if (search) {
            params.push(`%${search}%`);
            const idx = params.length;
            conditions.push(`(p.name ILIKE $${idx} OR pv.size_name ILIKE $${idx})`);
        }
        if (client_id) {
            params.push(client_id);
            conditions.push(`(
                (it.transaction_type = 'dispense' AND (
                    dn_c.id = $${params.length}
                    OR it.client_id = $${params.length}
                ))
            )`);
        }
        if (supplier_id) {
            params.push(supplier_id);
            conditions.push(`(it.transaction_type = 'receipt' AND mo.manufacturer_id = $${params.length})`);
        }
        if (from) {
            params.push(from);
            conditions.push(`it.created_at >= $${params.length}`);
        }
        if (to) {
            params.push(to);
            conditions.push(`it.created_at <= $${params.length}::date + interval '1 day'`);
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const countRes = await db.query(
            `SELECT COUNT(*)::int AS total
             FROM inventory_transactions it
             JOIN product_variants pv ON pv.id = it.variant_id
             JOIN products p ON p.id = pv.product_id
             LEFT JOIN categories cat ON cat.id = p.category_id
             LEFT JOIN manufacturer_orders mo
                ON mo.id = it.reference_id AND it.reference_type = 'manufacturer_order'
             LEFT JOIN delivery_notes dn
                ON dn.id = it.reference_id AND it.reference_type = 'delivery_note'
             LEFT JOIN clients dn_c ON dn_c.id = dn.client_id
             ${where}`,
            params
        );
        const total = countRes.rows[0]?.total || 0;

        params.push(limit);
        const limitIdx = params.length;
        params.push(offset);
        const offsetIdx = params.length;

        const result = await db.query(
            `SELECT
                it.id,
                it.transaction_type,
                it.quantity,
                it.created_at,
                it.notes,
                it.reference_type,
                it.reference_id,
                p.id          AS product_id,
                p.name        AS product_name,
                pv.id         AS variant_id,
                pv.size_name,
                pv.cost_price,
                pv.selling_price,
                cat.name      AS category_name,
                wf.name       AS warehouse_from_name,
                wt.name       AS warehouse_to_name,
                c.id          AS client_id,
                c.name        AS client_name,
                mo.mo_number,
                mo.manufacturer_id AS mo_supplier_id,
                moi_cost.unit_cost AS mo_unit_cost,
                s.company_name     AS supplier_name,
                dn.note_number AS delivery_note_number,
                dn.delivery_date,
                dn_c.name      AS dn_client_name,
                oi.unit_price  AS sale_unit_price
             FROM inventory_transactions it
             JOIN product_variants pv ON pv.id = it.variant_id
             JOIN products p          ON p.id  = pv.product_id
             LEFT JOIN categories cat ON cat.id = p.category_id
             LEFT JOIN warehouses wf  ON wf.id  = it.warehouse_from
             LEFT JOIN warehouses wt  ON wt.id  = it.warehouse_to
             LEFT JOIN clients c      ON c.id   = it.client_id
             LEFT JOIN manufacturer_orders mo
                ON mo.id = it.reference_id AND it.reference_type = 'manufacturer_order'
             LEFT JOIN LATERAL (
                SELECT unit_cost FROM manufacturer_order_items
                WHERE manufacturer_order_id = mo.id AND variant_id = pv.id
                LIMIT 1
             ) moi_cost ON true
             LEFT JOIN suppliers s ON s.id = mo.manufacturer_id
             LEFT JOIN delivery_notes dn
                ON dn.id = it.reference_id AND it.reference_type = 'delivery_note'
             LEFT JOIN clients dn_c ON dn_c.id = dn.client_id
             LEFT JOIN delivery_note_items dni
                ON dni.delivery_note_id = dn.id AND dni.variant_id = pv.id
             LEFT JOIN order_items oi
                ON oi.id = dni.order_item_id
             ${where}
             ORDER BY it.created_at DESC
             LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
            params
        );

        return res.status(200).json({ data: result.rows, total, limit, offset });

    } catch (err) {
        console.error('[Products] GET /movements error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/products/:id
// Returns a single product with all its variants.
// =============================================================================

router.get('/:id', async (req, res) => {
    try {
        const productResult = await db.query(
            `SELECT
                p.id,
                p.name,
                p.description,
                p.category_id,
                c.name   AS category_name,
                p.sku,
                p.barcode,
                p.status,
                p.created_by,
                u.name   AS created_by_name,
                p.created_at,
                p.updated_at
             FROM products p
             LEFT JOIN categories c ON c.id = p.category_id
             LEFT JOIN users u ON u.id = p.created_by
             WHERE p.id = $1
             LIMIT 1`,
            [req.params.id]
        );

        if (productResult.rowCount === 0) {
            return res.status(404).json({ error: 'المنتج غير موجود.' });
        }

        const product = productResult.rows[0];

        const variantsResult = await db.query(
            `SELECT
                pv.id,
                pv.product_id,
                pv.size_name,
                pv.sku,
                pv.barcode,
                pv.unit_id,
                u.name         AS unit_name,
                u.abbreviation AS unit_abbreviation,
                pv.selling_price,
                pv.cost_price,
                pv.min_stock_level,
                pv.max_stock_level,
                pv.weight,
                pv.dimensions,
                pv.status,
                pv.created_at
             FROM product_variants pv
             LEFT JOIN units u ON u.id = pv.unit_id
             WHERE pv.product_id = $1
             ORDER BY pv.created_at ASC`,
            [product.id]
        );

        product.variants = variantsResult.rows;

        return res.status(200).json({ data: product });
    } catch (err) {
        console.error('[Products] GET /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/products
// Creates a new product and optionally its variants in a single transaction.
// Body:
//   { name, description, category_id, sku, barcode, status,
//     variants: [{ size_name, sku, unit_id, selling_price, cost_price,
//                  min_stock_level, max_stock_level, weight, dimensions }] }
//
// SCHEMA RULE: No client_id anywhere in this route.
// =============================================================================

router.post('/', restrictWrite, validateBody(productCreate), async (req, res) => {
    const { name, description, category_id, sku, barcode, status, variants } = req.validatedBody;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'اسم المنتج مطلوب.' });
    }

    try {
        const result = await db.withTransaction(async (client) => {
            // Insert the parent product
            const productInsert = await client.query(
                `INSERT INTO products (name, description, category_id, sku, barcode, status, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`,
                [
                    name.trim(),
                    description || null,
                    category_id || null,
                    sku || null,
                    barcode || null,
                    status || 'active',
                    req.user?.id || null,
                ]
            );

            const product = productInsert.rows[0];
            product.variants = [];

            // Insert variants if provided
            if (Array.isArray(variants) && variants.length > 0) {
                for (const v of variants) {
                    if (!v.size_name || !v.size_name.trim()) {
                        throw new Error('كل متغير يجب أن يحتوي على اسم مقاس.');
                    }

                    const variantInsert = await client.query(
                        `INSERT INTO product_variants
                            (product_id, size_name, sku, barcode, unit_id,
                             selling_price, cost_price, min_stock_level,
                             max_stock_level, weight, dimensions, status)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                         RETURNING *`,
                        [
                            product.id,
                            v.size_name.trim(),
                            v.sku || null,
                            v.barcode || null,
                            v.unit_id || null,
                            parseFloat(v.selling_price) || 0,
                            parseFloat(v.cost_price) || 0,
                            parseInt(v.min_stock_level, 10) || 0,
                            v.max_stock_level ? parseInt(v.max_stock_level, 10) : null,
                            v.weight ? parseFloat(v.weight) : null,
                            v.dimensions || null,
                            v.status || 'active',
                        ]
                    );

                    product.variants.push(variantInsert.rows[0]);
                }
            }

            return product;
        });

        return res.status(201).json({ data: result });
    } catch (err) {
        console.error('[Products] POST / error:', err.message);
        if (err.code === '23505') {
            return res.status(409).json({ error: 'رمز SKU مستخدم مسبقاً. يرجى اختيار رمز فريد.' });
        }
        return res.status(500).json({ error: err.message || 'Internal server error.' });
    }
});

// =============================================================================
// PUT /api/products/:id
// Updates a product's core fields (not variants — managed separately).
// =============================================================================

router.put('/:id', restrictWrite, validateBody(productUpdate), async (req, res) => {
    const { id } = req.params;
    const { name, description, category_id, sku, barcode, status } = req.validatedBody;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'اسم المنتج مطلوب.' });
    }

    try {
        const result = await db.query(
            `UPDATE products SET
                name        = $1,
                description = $2,
                category_id = $3,
                sku         = $4,
                barcode     = $5,
                status      = $6,
                updated_at  = NOW()
             WHERE id = $7
             RETURNING *`,
            [
                name.trim(),
                description || null,
                category_id || null,
                sku || null,
                barcode || null,
                status || 'active',
                id,
            ]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'المنتج غير موجود.' });
        }

        return res.status(200).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Products] PUT /:id error:', err.message);
        if (err.code === '23505') {
            return res.status(409).json({ error: 'رمز SKU مستخدم مسبقاً.' });
        }
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/products/:id/variants
// Adds a new variant to an existing product.
// SCHEMA RULE: No client_id — variants are general.
// =============================================================================

router.post('/:id/variants', restrictWrite, validateBody(variantCreate), async (req, res) => {
    const { id } = req.params;
    const { size_name, sku, barcode, unit_id, selling_price, cost_price,
            min_stock_level, max_stock_level, weight, dimensions, status } = req.validatedBody;

    if (!size_name || !size_name.trim()) {
        return res.status(400).json({ error: 'اسم المقاس مطلوب.' });
    }

    try {
        // Verify the parent product exists
        const productCheck = await db.query('SELECT id FROM products WHERE id = $1 LIMIT 1', [id]);
        if (productCheck.rowCount === 0) {
            return res.status(404).json({ error: 'المنتج غير موجود.' });
        }

        const result = await db.query(
            `INSERT INTO product_variants
                (product_id, size_name, sku, barcode, unit_id,
                 selling_price, cost_price, min_stock_level,
                 max_stock_level, weight, dimensions, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [
                id,
                size_name.trim(),
                sku || null,
                barcode || null,
                unit_id || null,
                parseFloat(selling_price) || 0,
                parseFloat(cost_price) || 0,
                parseInt(min_stock_level, 10) || 0,
                max_stock_level ? parseInt(max_stock_level, 10) : null,
                weight ? parseFloat(weight) : null,
                dimensions || null,
                status || 'active',
            ]
        );

        return res.status(201).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Products] POST /:id/variants error:', err.message);
        if (err.code === '23505') {
            return res.status(409).json({ error: 'رمز SKU للمتغير مستخدم مسبقاً.' });
        }
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// PUT /api/products/:id/variants/:variantId
// Updates a single variant.
// =============================================================================

router.put('/:id/variants/:variantId', restrictWrite, validateBody(variantUpdate), async (req, res) => {
    const { variantId } = req.params;
    const { size_name, sku, barcode, unit_id, selling_price, cost_price,
            min_stock_level, max_stock_level, weight, dimensions, status } = req.validatedBody;

    if (!size_name || !size_name.trim()) {
        return res.status(400).json({ error: 'اسم المقاس مطلوب.' });
    }

    try {
        const result = await db.query(
            `UPDATE product_variants SET
                size_name       = $1,
                sku             = $2,
                barcode         = $3,
                unit_id         = $4,
                selling_price   = $5,
                cost_price      = $6,
                min_stock_level = $7,
                max_stock_level = $8,
                weight          = $9,
                dimensions      = $10,
                status          = $11,
                updated_at      = NOW()
             WHERE id = $12
             RETURNING *`,
            [
                size_name.trim(),
                sku || null,
                barcode || null,
                unit_id || null,
                parseFloat(selling_price) || 0,
                parseFloat(cost_price) || 0,
                parseInt(min_stock_level, 10) || 0,
                max_stock_level ? parseInt(max_stock_level, 10) : null,
                weight ? parseFloat(weight) : null,
                dimensions || null,
                status || 'active',
                variantId,
            ]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'المتغير غير موجود.' });
        }

        return res.status(200).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Products] PUT /:id/variants/:variantId error:', err.message);
        if (err.code === '23505') {
            return res.status(409).json({ error: 'رمز SKU للمتغير مستخدم مسبقاً.' });
        }
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// DELETE /api/products/:id/variants/:variantId
// Soft-deletes a variant by setting status = 'inactive'.
// If the variant has warehouse_stock or order_items entries (FK), catch 23503
// and return a 400 with an Arabic error message.
// =============================================================================

router.delete('/:id/variants/:variantId', restrictWrite, async (req, res) => {
    const { variantId } = req.params;

    try {
        const result = await db.query(
            `UPDATE product_variants
             SET status     = 'inactive',
                 updated_at = NOW()
             WHERE id = $1
             RETURNING id`,
            [variantId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'المتغير غير موجود.' });
        }

        return res.status(200).json({ message: 'تم تعطيل المتغير بنجاح.' });
    } catch (err) {
        console.error('[Products] DELETE /:id/variants/:variantId error:', err.message);
        if (err.code === '23503') {
            return res.status(400).json({ error: 'لا يمكن حذف هذا الصنف لارتباطه بحركات مخزنية أو فواتير.' });
        }
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
