'use strict';

// =============================================================================
// Public Supplier Portal — Permanent link for suppliers to view all their
// manufacturer orders and update production statuses.
//
// POST /api/public/supplier-portal/generate       → generate/reuse portal token (auth'd)
// GET  /api/public/supplier-portal/:token         → supplier info + all MOs (no auth)
// GET  /api/public/supplier-portal/:token/orders/:moId → single MO detail with items (no auth)
// PUT  /api/public/supplier-portal/:token/orders/:moId/status → supplier updates MO status (no auth)
//
// Routes are mounted at /api/public in server.js.
// Token is permanent (no expiry) per user request.
// =============================================================================

const express = require('express');
const crypto  = require('crypto');
const db      = require('../db');
const { success } = require('../utils/response');
const { encryptToken, hashToken, hasShareTokenSecret, decryptShareToken } = require('../utils/crypto');
const { ensurePdfThumbnail } = require('../utils/pdf-thumbnail');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// ── Allowed statuses the supplier can set ───────────────────────────────────
const ALLOWED_SUPPLIER_STATUSES = ['pending', 'sent', 'partially_received', 'received', 'cancelled'];

// ── Status labels (Arabic) ───────────────────────────────────────────────────
const STATUS_LABELS = {
    pending:            { label: 'بانتظار الإرسال',  color: 'bg-slate-100 text-slate-600' },
    sent:               { label: 'قيد التصنيع',      color: 'bg-blue-100 text-blue-700' },
    partially_received: { label: 'استلام جزئي',      color: 'bg-amber-100 text-amber-700' },
    received:           { label: 'تم التسليم',        color: 'bg-emerald-100 text-emerald-700' },
    cancelled:          { label: 'ملغي',              color: 'bg-red-100 text-red-600' },
};

// =============================================================================
// POST /api/public/supplier-portal/generate
// Generates (or reuses) a permanent portal token for a supplier.
// Requires authentication.
// Body: { supplier_id } — required
// =============================================================================
router.post('/supplier-portal/generate', authenticate, async (req, res) => {
    const { supplier_id } = req.body;

    if (!supplier_id) {
        return res.status(400).json({ error: 'supplier_id مطلوب.' });
    }

    try {
        const supplierRes = await db.query(
            `SELECT id, company_name, portal_token FROM suppliers WHERE id = $1`,
            [supplier_id]
        );

        if (supplierRes.rowCount === 0) {
            return res.status(404).json({ error: 'المورد غير موجود.' });
        }

        const supplier = supplierRes.rows[0];

        // Reuse existing token if present
        let plainToken = null;
        if (supplier.portal_token) {
            plainToken = decryptShareToken(supplier.portal_token);
        }

        if (!plainToken) {
            // Generate new permanent token
            plainToken = crypto.randomBytes(32).toString('hex');

            let storedToken = plainToken;
            let tokenHash;
            try {
                storedToken = encryptToken(plainToken);
                tokenHash   = hashToken(plainToken);
            } catch (cryptoErr) {
                console.error('[SupplierPortal] Crypto error:', cryptoErr.message);
                tokenHash   = crypto.createHmac('sha256', plainToken).digest('hex');
                storedToken = plainToken;
            }

            await db.query(
                `UPDATE suppliers SET portal_token = $1, portal_token_hash = $2 WHERE id = $3`,
                [storedToken, tokenHash, supplier_id]
            );
        }

        const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const portalUrl = `${baseUrl}/public-supplier-portal.html?token=${plainToken}`;

        return success(res, {
            token: plainToken,
            portal_url: portalUrl,
            supplier_name: supplier.company_name,
        });
    } catch (err) {
        console.error('[SupplierPortal] generate error:', err.message);
        const needsSecret = !hasShareTokenSecret();
        const message = needsSecret
            ? 'تعذّر إنشاء رابط البوابة. تأكد من إعداد SHARE_TOKEN_SECRET في ملف .env'
            : `تعذّر إنشاء رابط البوابة: ${err.message}`;
        return res.status(500).json({ error: message });
    }
});

// =============================================================================
// Helper: resolve supplier from token
// Returns supplier row or null
// =============================================================================
async function _resolveSupplierFromToken(token) {
    let tokenHash = null;
    try { tokenHash = hashToken(token); } catch (_e) { /* SECRET missing — fallback */ }

    let result = null;
    if (tokenHash) {
        result = await db.query(
            `SELECT id, company_name, contact_person, phone, email
             FROM suppliers
             WHERE portal_token_hash = $1 AND status = 'active'`,
            [tokenHash]
        );
    }

    // Fallback: plaintext token
    if (!result || result.rowCount === 0) {
        result = await db.query(
            `SELECT id, company_name, contact_person, phone, email
             FROM suppliers
             WHERE portal_token = $1 AND status = 'active'`,
            [token]
        );
    }

    return result.rowCount > 0 ? result.rows[0] : null;
}

// =============================================================================
// GET /api/public/supplier-portal/:token
// Returns supplier info + list of all manufacturer orders.
// No auth required — token is the credential.
// =============================================================================
router.get('/supplier-portal/:token', async (req, res) => {
    const { token } = req.params;

    try {
        const supplier = await _resolveSupplierFromToken(token);
        if (!supplier) {
            return res.status(404).json({ error: 'الرابط غير صالح.' });
        }

        // Update last accessed
        await db.query(
            `UPDATE suppliers SET portal_last_accessed = NOW() WHERE id = $1`,
            [supplier.id]
        );

        // Fetch all manufacturer orders for this supplier
        const ordersRes = await db.query(
            `SELECT
                mo.id,
                mo.mo_number,
                mo.status,
                mo.expected_delivery_date,
                mo.created_at AS order_date,
                mo.notes,
                o.order_number,
                c.name AS client_name,
                COUNT(moi.id)::int AS item_count,
                COALESCE(SUM(moi.mo_quantity), 0)::numeric AS total_qty
             FROM manufacturer_orders mo
             LEFT JOIN orders o ON o.id = mo.order_id
             LEFT JOIN clients c ON c.id = o.client_id
             LEFT JOIN manufacturer_order_items moi ON moi.manufacturer_order_id = mo.id
             WHERE mo.manufacturer_id = $1
             GROUP BY mo.id, o.order_number, c.name
             ORDER BY mo.created_at DESC`,
            [supplier.id]
        );

        // Enrich with status labels
        const orders = ordersRes.rows.map(mo => ({
            ...mo,
            status_label: STATUS_LABELS[mo.status]?.label || mo.status,
            status_color: STATUS_LABELS[mo.status]?.color || 'bg-slate-100 text-slate-600',
        }));

        return success(res, {
            supplier: {
                id: supplier.id,
                company_name: supplier.company_name,
                contact_person: supplier.contact_person,
                phone: supplier.phone,
                email: supplier.email,
            },
            orders,
        });
    } catch (err) {
        console.error('[SupplierPortal] GET list error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/public/supplier-portal/:token/orders/:moId
// Returns full detail of a single manufacturer order with items and design files.
// No auth required.
// =============================================================================
router.get('/supplier-portal/:token/orders/:moId', async (req, res) => {
    const { token, moId } = req.params;

    try {
        const supplier = await _resolveSupplierFromToken(token);
        if (!supplier) {
            return res.status(404).json({ error: 'الرابط غير صالح.' });
        }

        // Verify the MO belongs to this supplier
        const moRes = await db.query(
            `SELECT
                mo.id,
                mo.mo_number,
                mo.status,
                mo.expected_delivery_date,
                mo.created_at AS order_date,
                mo.notes,
                o.order_number,
                o.client_id,
                c.name AS client_name
             FROM manufacturer_orders mo
             LEFT JOIN orders o ON o.id = mo.order_id
             LEFT JOIN clients c ON c.id = o.client_id
             WHERE mo.id = $1 AND mo.manufacturer_id = $2`,
            [moId, supplier.id]
        );

        if (moRes.rowCount === 0) {
            return res.status(404).json({ error: 'أمر التشغيل غير موجود أو لا يتبع هذا المورد.' });
        }

        const mo = moRes.rows[0];
        mo.status_label = STATUS_LABELS[mo.status]?.label || mo.status;
        mo.status_color = STATUS_LABELS[mo.status]?.color || 'bg-slate-100 text-slate-600';

        // Fetch items with design files
        const itemsRes = await db.query(
            `SELECT
                moi.id,
                moi.mo_quantity,
                moi.design_status,
                moi.design_id,
                moi.pantone_color,
                moi.pantone_colors,
                pv.size_name,
                p.name AS product_name,
                u.name AS unit_name,
                cd.design_name,
                cdf.file_path AS design_thumbnail,
                COALESCE(df.files, '[]'::json) AS design_files
             FROM manufacturer_order_items moi
             JOIN order_items oi ON oi.id = moi.order_item_id
             LEFT JOIN product_variants pv ON pv.id = oi.variant_id
             LEFT JOIN products p ON p.id = pv.product_id
             LEFT JOIN units u ON u.id = pv.unit_id
             LEFT JOIN client_designs cd ON cd.id = moi.design_id
             LEFT JOIN LATERAL (
                SELECT file_path FROM client_design_files
                WHERE design_id = moi.design_id AND file_type = 'thumbnail'
                ORDER BY uploaded_at DESC LIMIT 1
             ) cdf ON true
             LEFT JOIN LATERAL (
                SELECT json_agg(
                    json_build_object(
                        'id', cdfx.id,
                        'path', cdfx.file_path,
                        'name', cdfx.original_name,
                        'file_type', cdfx.file_type,
                        'size', cdfx.file_size,
                        'mime_type', cdfx.mime_type,
                        'uploaded_at', cdfx.uploaded_at
                    ) ORDER BY cdfx.uploaded_at ASC
                ) AS files
                FROM client_design_files cdfx
                WHERE cdfx.design_id = moi.design_id
                  AND cdfx.file_type <> 'thumbnail'
             ) df ON true
             WHERE moi.manufacturer_order_id = $1
             ORDER BY moi.id ASC`,
            [moId]
        );

        const items = itemsRes.rows;

        // Enrich pantone_colors with hex_value and color_name
        if (mo.client_id) {
            const allCodes = new Set();
            for (const item of items) {
                const codes = Array.isArray(item.pantone_colors) && item.pantone_colors.length
                    ? item.pantone_colors
                    : (item.pantone_color ? [item.pantone_color] : []);
                codes.forEach(c => allCodes.add(c));
            }
            if (allCodes.size > 0) {
                const pantoneRes = await db.query(
                    `SELECT color_code, color_name, hex_value FROM client_pantone_colors
                     WHERE client_id = $1 AND color_code = ANY($2::text[])`,
                    [mo.client_id, Array.from(allCodes)]
                );
                const pantoneMap = {};
                for (const row of pantoneRes.rows) {
                    pantoneMap[row.color_code] = row;
                }
                for (const item of items) {
                    const codes = Array.isArray(item.pantone_colors) && item.pantone_colors.length
                        ? item.pantone_colors
                        : (item.pantone_color ? [item.pantone_color] : []);
                    item.pantone_colors_details = codes.map(c => ({
                        code: c,
                        name: pantoneMap[c]?.color_name || null,
                        hex: pantoneMap[c]?.hex_value || null
                    }));
                }
            }
        }

        // Generate PDF thumbnails for design files
        await Promise.all(items.map(async (item) => {
            if (item.design_thumbnail) {
                const generated = await ensurePdfThumbnail(item.design_thumbnail);
                if (generated) item.design_thumbnail_image = generated;
            }
            const files = Array.isArray(item.design_files) ? item.design_files : [];
            await Promise.all(files.map(async (f) => {
                if (f.path) {
                    const generated = await ensurePdfThumbnail(f.path);
                    if (generated) f.preview_image = generated;
                }
            }));
        }));

        return success(res, { order: mo, items });
    } catch (err) {
        console.error('[SupplierPortal] GET order detail error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// PUT /api/public/supplier-portal/:token/orders/:moId/status
// Supplier updates the production status of a manufacturer order.
// No auth required — token is the credential.
// Body: { status, notes } — status must be one of ALLOWED_SUPPLIER_STATUSES
// =============================================================================
router.put('/supplier-portal/:token/orders/:moId/status', async (req, res) => {
    const { token, moId } = req.params;
    const { status, notes } = req.body;

    if (!status || !ALLOWED_SUPPLIER_STATUSES.includes(status)) {
        return res.status(400).json({
            error: `الحالة غير صالحة. الحالات المسموحة: ${ALLOWED_SUPPLIER_STATUSES.join(', ')}`
        });
    }

    try {
        const supplier = await _resolveSupplierFromToken(token);
        if (!supplier) {
            return res.status(404).json({ error: 'الرابط غير صالح.' });
        }

        // Verify MO belongs to this supplier and get current status
        const moRes = await db.query(
            `SELECT id, status, mo_number FROM manufacturer_orders
             WHERE id = $1 AND manufacturer_id = $2`,
            [moId, supplier.id]
        );

        if (moRes.rowCount === 0) {
            return res.status(404).json({ error: 'أمر التشغيل غير موجود أو لا يتبع هذا المورد.' });
        }

        const mo = moRes.rows[0];
        const oldStatus = mo.status;

        if (oldStatus === status) {
            return res.status(200).json({ message: 'الحالة لم تتغير.', status });
        }

        // Update status
        await db.query(
            `UPDATE manufacturer_orders SET status = $1, updated_at = NOW() WHERE id = $2`,
            [status, moId]
        );

        // Auto-update parent order status if needed
        if (mo.order_id) {
            const orderRes = await db.query(
                `SELECT status FROM orders WHERE id = $1`,
                [mo.order_id]
            );
            if (orderRes.rows.length > 0) {
                const currentOrderStatus = orderRes.rows[0].status;
                if (['production', 'processing', 'completed'].includes(currentOrderStatus)) {
                    const mosRes = await db.query(
                        `SELECT status FROM manufacturer_orders WHERE order_id = $1`,
                        [mo.order_id]
                    );
                    if (mosRes.rows.length > 0) {
                        const moStatuses = mosRes.rows.map(r => r.status);
                        const allReceived = moStatuses.every(s => s === 'received');
                        const anySentOrBeyond = moStatuses.some(s => ['sent', 'partially_received', 'received'].includes(s));

                        let newOrderStatus = null;
                        if (currentOrderStatus === 'production' && anySentOrBeyond) {
                            newOrderStatus = 'processing';
                        } else if (currentOrderStatus === 'processing' && allReceived) {
                            newOrderStatus = 'completed';
                        } else if (currentOrderStatus === 'completed' && !allReceived && anySentOrBeyond) {
                            newOrderStatus = 'processing';
                        }

                        if (newOrderStatus && newOrderStatus !== currentOrderStatus) {
                            await db.query(
                                `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`,
                                [newOrderStatus, mo.order_id]
                            );
                            console.log(`[SupplierPortal] Auto-status: Order ${mo.order_id}: ${currentOrderStatus} → ${newOrderStatus}`);
                        }
                    }
                }
            }
        }

        console.log(`[SupplierPortal] MO ${mo.mo_number}: status ${oldStatus} → ${status} by supplier ${supplier.company_name}`);

        return success(res, {
            message: 'تم تحديث الحالة بنجاح.',
            old_status: oldStatus,
            new_status: status,
            status_label: STATUS_LABELS[status]?.label || status,
        });
    } catch (err) {
        console.error('[SupplierPortal] PUT status error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
