'use strict';

// =============================================================================
// G.PACK 2.0 — Public Design Review Route (public-design.js)
// No auth required. Client views designs and submits approval/revision.
// =============================================================================

const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');
const { encryptToken, hashToken, hasShareTokenSecret } = require('../utils/crypto');

// ── GET /api/public/design/view/:token ──────────────────────────────────────
// Public: client views design files for all items in the order.
// =============================================================================
router.get('/view/:token', async (req, res) => {
    const { token } = req.params;
    try {
        let orderRes = null;
        try {
            const tokenHash = hashToken(token);
            orderRes = await db.query(
                `SELECT o.id, o.order_number, o.design_token_expires_at, o.design_client_status,
                        c.name as client_name
                 FROM orders o
                 JOIN clients c ON c.id = o.client_id
                 WHERE o.design_share_token_hash = $1`,
                [tokenHash]
            );
        } catch { /* hashToken may throw if SECRET missing */ }

        if (!orderRes || orderRes.rows.length === 0) {
            orderRes = await db.query(
                `SELECT o.id, o.order_number, o.design_token_expires_at, o.design_client_status,
                        c.name as client_name
                 FROM orders o
                 JOIN clients c ON c.id = o.client_id
                 WHERE o.design_share_token = $1`,
                [token]
            );
        }

        if (orderRes.rows.length === 0) {
            return res.status(404).json({ error: 'الرابط غير صالح أو منتهي الصلاحية' });
        }

        const order = orderRes.rows[0];

        if (order.design_token_expires_at && new Date(order.design_token_expires_at) < new Date()) {
            return res.status(410).json({ error: 'انتهت صلاحية هذا الرابط' });
        }

        const itemsRes = await db.query(
            `SELECT oi.id, oi.variant_id, oi.quantity,
                    pv.product_name, pv.size_name,
                    oi.design_files, oi.designer_notes,
                    oi.client_design_status, oi.client_revision_notes
             FROM order_items oi
             LEFT JOIN product_variants pv ON pv.id = oi.variant_id
             WHERE oi.order_id = $1
             ORDER BY oi.id ASC`,
            [order.id]
        );

        const items = itemsRes.rows.filter(item => {
            if (!item.design_files) return false;
            const files = Array.isArray(item.design_files) ? item.design_files : [];
            return files.length > 0;
        });

        res.json({
            order_number: order.order_number,
            client_name: order.client_name,
            design_client_status: order.design_client_status,
            items: items.map(item => ({
                id: item.id,
                product_name: item.product_name,
                size_name: item.size_name,
                quantity: item.quantity,
                designer_notes: item.designer_notes,
                design_files: item.design_files,
                client_design_status: item.client_design_status,
                client_revision_notes: item.client_revision_notes,
            })),
        });
    } catch (err) {
        console.error('[PublicDesign] View error:', err.message);
        res.status(500).json({ error: 'فشل في تحميل التصاميم' });
    }
});

// ── POST /api/public/design/respond/:token ──────────────────────────────────
// Public: client submits approval or revision request per item.
// Body: { items: [{ item_id, action: 'approve'|'revision', notes? }] }
// =============================================================================
router.post('/respond/:token', async (req, res) => {
    const { token } = req.params;
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'يجب تقديم رد لصنف واحد على الأقل' });
    }

    const client = await db.getClient();
    try {
        let orderRes = null;
        try {
            const tokenHash = hashToken(token);
            orderRes = await client.query(
                `SELECT id, order_number, design_client_status FROM orders WHERE design_share_token_hash = $1`,
                [tokenHash]
            );
        } catch { /* SECRET missing */ }

        if (!orderRes || orderRes.rows.length === 0) {
            orderRes = await client.query(
                `SELECT id, order_number, design_client_status FROM orders WHERE design_share_token = $1`,
                [token]
            );
        }

        if (orderRes.rows.length === 0) {
            return res.status(404).json({ error: 'الرابط غير صالح' });
        }

        const order = orderRes.rows[0];

        await client.query('BEGIN');

        let approvedCount = 0;
        let revisionCount = 0;

        for (const item of items) {
            if (!item.item_id || !item.action) continue;

            if (item.action === 'approve') {
                await client.query(
                    `UPDATE order_items
                     SET client_design_status = 'approved', client_approved_at = NOW()
                     WHERE id = $1 AND order_id = $2`,
                    [item.item_id, order.id]
                );
                approvedCount++;
            } else if (item.action === 'revision') {
                await client.query(
                    `UPDATE order_items
                     SET client_design_status = 'revision_requested', client_revision_notes = $1
                     WHERE id = $2 AND order_id = $3`,
                    [item.notes || null, item.item_id, order.id]
                );
                revisionCount++;
            }
        }

        if (revisionCount > 0) {
            await client.query(
                `UPDATE orders SET design_client_status = 'revision_requested', design_status = 'revision'
                 WHERE id = $1`,
                [order.id]
            );
            await client.query(
                `UPDATE order_items SET design_status = 'revision'
                 WHERE order_id = $1 AND client_design_status = 'revision_requested'`,
                [order.id]
            );
        } else if (approvedCount > 0 && revisionCount === 0) {
            const pendingRes = await client.query(
                `SELECT COUNT(*) as count FROM order_items
                 WHERE order_id = $1
                   AND design_files IS NOT NULL AND design_files != '[]'::jsonb
                   AND client_design_status != 'approved'`,
                [order.id]
            );
            if (parseInt(pendingRes.rows[0].count) === 0) {
                // All approved → convert to production + save to client_designs
                await client.query(
                    `UPDATE orders SET
                        design_client_status = 'approved',
                        design_status = 'completed',
                        design_completed_at = NOW(),
                        status = 'production'
                     WHERE id = $1`,
                    [order.id]
                );
                const allItemsRes = await client.query(
                    `SELECT oi.variant_id, oi.design_files
                     FROM order_items oi
                     WHERE oi.order_id = $1
                       AND oi.design_files IS NOT NULL AND oi.design_files != '[]'::jsonb`,
                    [order.id]
                );
                const clientIdRes = await client.query(
                    `SELECT client_id FROM orders WHERE id = $1`, [order.id]
                );
                const clientId = clientIdRes.rows[0]?.client_id;
                for (const item of allItemsRes.rows) {
                    if (!item.variant_id) continue;
                    const dnRes = await client.query(
                        `SELECT COALESCE(MAX(design_number), 0) + 1 AS next
                         FROM client_designs WHERE client_id = $1 AND variant_id = $2`,
                        [clientId, item.variant_id]
                    );
                    const designNumber = dnRes.rows[0].next;
                    const designName = `تصميم معتمد — طلب #${order.order_number}`;
                    const designIns = await client.query(
                        `INSERT INTO client_designs (client_id, variant_id, design_number, design_name, is_active)
                         VALUES ($1, $2, $3, $4, true) RETURNING id`,
                        [clientId, item.variant_id, designNumber, designName]
                    );
                    const designId = designIns.rows[0].id;
                    const files = Array.isArray(item.design_files) ? item.design_files : [];
                    for (const f of files) {
                        await client.query(
                            `INSERT INTO client_design_files (design_id, file_type, file_path, original_name)
                             VALUES ($1, $2, $3, $4)`,
                            [designId, 'design', f.path, f.original_name || f.filename]
                        );
                    }
                }
            } else {
                await client.query(
                    `UPDATE orders SET design_client_status = 'sent' WHERE id = $1`,
                    [order.id]
                );
            }
        }

        await client.query('COMMIT');

        let message;
        if (revisionCount > 0) {
            message = `تم تسجيل طلب التعديل على ${revisionCount} صنف. سيتم إرسالها للمصمم للمراجعة.`;
        } else {
            message = `تم تسجيل موافقة العميل على ${approvedCount} صنف.`;
        }

        res.json({ success: true, message, approved_count: approvedCount, revision_count: revisionCount });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[PublicDesign] Respond error:', err.message);
        res.status(500).json({ error: 'فشل في تسجيل رد العميل' });
    } finally {
        client.release();
    }
});

module.exports = router;
