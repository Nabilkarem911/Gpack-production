'use strict';

const express = require('express');
const db = require('../db');
const authorize = require('../middleware/authorize');
const { ensurePdfThumbnail } = require('../utils/pdf-thumbnail');

const router = express.Router();
const canView = authorize('production_orders', 'view');

router.use(canView);

router.get('/', async (req, res) => {
    const search = String(req.query.search || '').trim();
    const params = [];
    const conditions = [];

    if (search) {
        params.push(`%${search}%`);
        conditions.push(`(
            pt.template_code ILIKE $1
            OR p.name ILIKE $1
            OR pv.size_name ILIKE $1
        )`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
        const result = await db.query(
            `SELECT
                pt.id,
                pt.template_code,
                pt.variant_id,
                p.id AS product_id,
                p.name AS product_name,
                pv.size_name,
                COALESCE((
                    SELECT COUNT(*)::int
                    FROM client_designs cd
                    WHERE cd.variant_id = pv.id
                ), 0) AS design_count,
                COALESCE((
                    SELECT COUNT(DISTINCT cd.client_id)::int
                    FROM client_designs cd
                    WHERE cd.variant_id = pv.id
                ), 0) AS client_count,
                COALESCE((
                    SELECT COUNT(DISTINCT mo.manufacturer_id)::int
                    FROM manufacturer_order_items moi
                    JOIN manufacturer_orders mo ON mo.id = moi.manufacturer_order_id
                    JOIN order_items oi ON oi.id = moi.order_item_id
                    JOIN client_designs cd ON cd.id = moi.design_id AND cd.variant_id = pv.id
                    WHERE oi.variant_id = pv.id
                ), 0) AS supplier_count,
                COALESCE((
                    SELECT COUNT(DISTINCT mo.id)::int
                    FROM manufacturer_order_items moi
                    JOIN manufacturer_orders mo ON mo.id = moi.manufacturer_order_id
                    JOIN order_items oi ON oi.id = moi.order_item_id
                    JOIN client_designs cd ON cd.id = moi.design_id AND cd.variant_id = pv.id
                    WHERE oi.variant_id = pv.id
                ), 0) AS order_count,
                (
                    SELECT MIN(moi.created_at)
                    FROM manufacturer_order_items moi
                    JOIN manufacturer_orders mo ON mo.id = moi.manufacturer_order_id
                    JOIN order_items oi ON oi.id = moi.order_item_id
                    JOIN client_designs cd ON cd.id = moi.design_id AND cd.variant_id = pv.id
                    WHERE oi.variant_id = pv.id
                ) AS first_used_at,
                (
                    SELECT MAX(moi.created_at)
                    FROM manufacturer_order_items moi
                    JOIN manufacturer_orders mo ON mo.id = moi.manufacturer_order_id
                    JOIN order_items oi ON oi.id = moi.order_item_id
                    JOIN client_designs cd ON cd.id = moi.design_id AND cd.variant_id = pv.id
                    WHERE oi.variant_id = pv.id
                ) AS last_used_at,
                COALESCE((
                    SELECT COUNT(*)::int
                    FROM manufacturer_order_items moi
                    JOIN manufacturer_orders mo ON mo.id = moi.manufacturer_order_id
                    JOIN order_items oi ON oi.id = moi.order_item_id
                    LEFT JOIN client_designs cd ON cd.id = moi.design_id
                    WHERE oi.variant_id = pv.id
                      AND moi.design_id IS NOT NULL
                      AND cd.id IS NULL
                ), 0) AS missing_design_count
             FROM print_templates pt
             JOIN product_variants pv ON pv.id = pt.variant_id
             JOIN products p ON p.id = pv.product_id
             ${where}
             ORDER BY pt.template_code ASC`,
            params
        );

        return res.json({ data: result.rows, count: result.rows.length });
    } catch (err) {
        console.error('[PrintTemplates] List error:', err.message);
        return res.status(500).json({ error: 'فشل تحميل قوالب الطباعة.' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const templateResult = await db.query(
            `SELECT pt.id, pt.template_code, pt.variant_id,
                    p.id AS product_id, p.name AS product_name, pv.size_name,
                    pv.sku AS variant_sku
             FROM print_templates pt
             JOIN product_variants pv ON pv.id = pt.variant_id
             JOIN products p ON p.id = pv.product_id
             WHERE pt.id = $1`,
            [req.params.id]
        );

        if (templateResult.rowCount === 0) {
            return res.status(404).json({ error: 'قالب الطباعة غير موجود.' });
        }

        const template = templateResult.rows[0];
        const designsResult = await db.query(
            `SELECT
                cd.id,
                cd.client_id,
                c.name AS client_name,
                cd.design_number,
                cd.design_name,
                cd.description,
                cd.is_active,
                cd.created_at,
                COALESCE(files.files, '[]'::json) AS files,
                COALESCE(design_usage.usage, '[]'::json) AS usage,
                design_usage.first_used_at,
                design_usage.last_used_at
             FROM client_designs cd
             LEFT JOIN clients c ON c.id = cd.client_id
             LEFT JOIN LATERAL (
                 SELECT json_agg(json_build_object(
                     'id', cdf.id,
                     'type', cdf.file_type,
                     'path', cdf.file_path,
                     'name', cdf.original_name,
                     'size', cdf.file_size,
                     'mime_type', cdf.mime_type,
                     'uploaded_at', cdf.uploaded_at
                 ) ORDER BY cdf.uploaded_at ASC) AS files
                 FROM client_design_files cdf
                 WHERE cdf.design_id = cd.id
             ) files ON true
             LEFT JOIN LATERAL (
                 SELECT
                     json_agg(json_build_object(
                         'manufacturer_order_item_id', moi.id,
                         'manufacturer_order_id', mo.id,
                         'order_number', o.order_number,
                         'supplier_id', mo.manufacturer_id,
                         'supplier_name', s.company_name,
                         'client_id', o.client_id,
                         'client_name', assigned_client.name,
                         'used_at', moi.created_at
                     ) ORDER BY moi.created_at DESC) AS usage,
                     MIN(moi.created_at) AS first_used_at,
                     MAX(moi.created_at) AS last_used_at
                 FROM manufacturer_order_items moi
                 JOIN manufacturer_orders mo ON mo.id = moi.manufacturer_order_id
                 JOIN order_items oi ON oi.id = moi.order_item_id
                 JOIN orders o ON o.id = mo.order_id
                 LEFT JOIN suppliers s ON s.id = mo.manufacturer_id
                 LEFT JOIN clients assigned_client ON assigned_client.id = o.client_id
                 WHERE moi.design_id = cd.id
                   AND oi.variant_id = $1
             ) design_usage ON true
             WHERE cd.variant_id = $1
             ORDER BY cd.design_number ASC, cd.created_at ASC`,
            [template.variant_id]
        );

        const designs = await Promise.all(designsResult.rows.map(async design => {
            const files = Array.isArray(design.files) ? design.files : [];
            const processedFiles = await Promise.all(files.map(async file => {
                const previewPath = file.type === 'pdf'
                    ? await ensurePdfThumbnail(file.path)
                    : null;
                return { ...file, preview_path: previewPath };
            }));
            return { ...design, files: processedFiles };
        }));

        const missingResult = await db.query(
            `SELECT moi.id AS manufacturer_order_item_id,
                    moi.design_id,
                    mo.id AS manufacturer_order_id,
                    mo.manufacturer_id AS supplier_id,
                    s.company_name AS supplier_name,
                    o.order_number,
                    o.client_id,
                    c.name AS client_name,
                    moi.created_at
             FROM manufacturer_order_items moi
             JOIN manufacturer_orders mo ON mo.id = moi.manufacturer_order_id
             JOIN order_items oi ON oi.id = moi.order_item_id
             JOIN orders o ON o.id = mo.order_id
             LEFT JOIN clients c ON c.id = o.client_id
             LEFT JOIN suppliers s ON s.id = mo.manufacturer_id
             LEFT JOIN client_designs cd ON cd.id = moi.design_id
             WHERE oi.variant_id = $1
               AND moi.design_id IS NOT NULL
               AND cd.id IS NULL
             ORDER BY moi.created_at DESC`,
            [template.variant_id]
        );

        return res.json({
            data: {
                ...template,
                designs,
                missing_design_links: missingResult.rows,
            },
        });
    } catch (err) {
        console.error('[PrintTemplates] Details error:', err.message);
        return res.status(500).json({ error: 'فشل تحميل تفاصيل قالب الطباعة.' });
    }
});

module.exports = router;
