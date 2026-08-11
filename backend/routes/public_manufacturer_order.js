'use strict';

// =============================================================================
// Public Manufacturer Order Sharing — Supplier Portal
//
// POST /api/public/manufacturer-orders/:id/share        → generate share token (auth'd)
// GET  /api/public/manufacturer-order/:token            → supplier views the order (no auth)
// POST /api/public/manufacturer-orders/:id/share/revoke → revoke token (auth'd)
//
// Routes are mounted at /api/public in server.js.
// =============================================================================

const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const db      = require('../db');
const { success } = require('../utils/response');
const { encryptToken, hashToken, hasShareTokenSecret } = require('../utils/crypto');
const { ensurePdfThumbnail } = require('../utils/pdf-thumbnail');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// ── Helper: decode original_name stored as percent-encoded or Latin-1 mojibake
function _safeDecodeFileName(name) {
    if (!name || typeof name !== 'string') return name;
    if (/^[\x00-\x7F]*$/.test(name)) return name;

    // Plain percent-encoded
    if (name.includes('%')) {
        try { return decodeURIComponent(name); } catch (e) { /* ignore */ }
    }

    // Latin-1 mojibake of UTF-8 bytes (all chars <= 255)
    const isLatin1 = [...name].every(c => c.charCodeAt(0) <= 255);
    if (isLatin1) {
        try {
            const decoded = decodeURIComponent(escape(name));
            // Only accept if it produced fewer unusual Latin-1 characters
            if (decoded && decoded.length > 0) return decoded;
        } catch (e) { /* ignore */ }
    }

    return name;
}

// ── Helper: build a formatted WhatsApp message for the supplier ──────────────
function _buildWhatsAppMessage(mo, items, shareUrl) {
    const lines = [];
    lines.push('🏭 أمر تشغيل جديد — G.PACK');
    lines.push('━━━━━━━━━━━━━━━');
    lines.push(`👤 العميل: ${mo.client_name || '—'}`);
    lines.push(`📋 الطلب: #${mo.order_number || mo.mo_number}`);
    const anyReprint = items.some(i => i.design_status === 'redesign' || i.design_status === 'reprint');
    lines.push(`🔄 الحالة: ${anyReprint ? 'إعادة طباعة' : 'تصميم جديد'}`);
    lines.push('━━━━━━━━━━━━━━━');
    lines.push('📦 الأصناف:');
    for (const i of items) {
        const qty = parseInt(i.mo_quantity || 0);
        lines.push(`• ${i.product_name || '—'} ${i.size_name || ''} — ${qty.toLocaleString('en-US')} ${i.unit_name || 'قطعة'}`);
    }
    lines.push('━━━━━━━━━━━━━━━');
    lines.push(`🔗 رابط التصاميم والتفاصيل:`);
    lines.push(shareUrl);
    return lines.join('\n');
}

// =============================================================================
// POST /api/public/manufacturer-orders/:id/share
// Generates (or reuses) a share token. Requires authentication.
// Body: { expires_days } — default 90 days
// =============================================================================
router.post('/manufacturer-orders/:id/share', authenticate, async (req, res) => {
    const { id } = req.params;
    const expiresDays = parseInt(req.body.expires_days || 90);

    try {
        // Load MO + client name + order_number for WhatsApp message
        const moRes = await db.query(
            `SELECT mo.id, mo.mo_number, mo.share_token, mo.token_expires_at,
                    mo.order_id,
                    s.company_name AS supplier_name,
                    o.order_number
             FROM manufacturer_orders mo
             LEFT JOIN suppliers s ON s.id = mo.manufacturer_id
             LEFT JOIN orders o ON o.id = mo.order_id
             WHERE mo.id = $1`,
            [id]
        );
        if (moRes.rowCount === 0) {
            return res.status(404).json({ error: 'أمر التشغيل غير موجود.' });
        }

        const mo = moRes.rows[0];

        // Reuse existing token if still valid
        let plainToken = null;
        if (mo.share_token && mo.token_expires_at && new Date(mo.token_expires_at) > new Date()) {
            // Try to decrypt; if it fails (old plaintext), use as-is
            try {
                const { decryptShareToken } = require('../utils/crypto');
                plainToken = decryptShareToken(mo.share_token);
            } catch {
                plainToken = mo.share_token;
            }
        }

        if (!plainToken) {
            // Generate new token
            plainToken = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000);

            let storedToken = plainToken;
            let tokenHash;
            try {
                storedToken = encryptToken(plainToken);
                tokenHash   = hashToken(plainToken);
            } catch (cryptoErr) {
                console.error('[PublicMO] Crypto error:', cryptoErr.message);
                tokenHash   = crypto.createHmac('sha256', plainToken).digest('hex');
                storedToken = plainToken;
            }

            await db.query(
                `UPDATE manufacturer_orders
                 SET share_token = $1, share_token_hash = $2, token_expires_at = $3
                 WHERE id = $4`,
                [storedToken, tokenHash, expiresAt, id]
            );

            mo.token_expires_at = expiresAt;
        }

        // Build share URL
        const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const shareUrl = `${baseUrl}/public-manufacturer-order.html?token=${plainToken}`;

        // Load items for WhatsApp message
        const itemsRes = await db.query(
            `SELECT moi.id, moi.mo_quantity, moi.design_status,
                    p.name AS product_name,
                    pv.size_name,
                    u.name AS unit_name,
                    o.order_number
             FROM manufacturer_order_items moi
             JOIN order_items oi ON oi.id = moi.order_item_id
             LEFT JOIN product_variants pv ON pv.id = oi.variant_id
             LEFT JOIN products p ON p.id = pv.product_id
             LEFT JOIN units u ON u.id = pv.unit_id
             LEFT JOIN orders o ON o.id = moi.manufacturer_order_id
             WHERE moi.manufacturer_order_id = $1
             ORDER BY moi.id ASC`,
            [id]
        );

        // Get client name from the order
        let clientName = '—';
        if (mo.order_id) {
            const clientRes = await db.query(
                `SELECT c.name FROM orders o JOIN clients c ON c.id = o.client_id WHERE o.id = $1`,
                [mo.order_id]
            );
            if (clientRes.rowCount > 0) clientName = clientRes.rows[0].name;
        }

        const moForMsg = { ...mo, client_name: clientName };
        const whatsappMsg = _buildWhatsAppMessage(moForMsg, itemsRes.rows, shareUrl);

        return success(res, {
            token: plainToken,
            share_url: shareUrl,
            expires_at: mo.token_expires_at,
            whatsapp_message: whatsappMsg,
            whatsapp_url: `https://wa.me/?text=${encodeURIComponent(whatsappMsg)}`
        });
    } catch (err) {
        console.error('[PublicMO] share error:', err.message);
        const needsSecret = !hasShareTokenSecret();
        const message = needsSecret
            ? 'تعذّر إنشاء رابط المشاركة. تأكد من إعداد SHARE_TOKEN_SECRET في ملف .env'
            : `تعذّر إنشاء رابط المشاركة: ${err.message}`;
        return res.status(500).json({ error: message });
    }
});

// =============================================================================
// POST /api/public/manufacturer-orders/:id/share/revoke
// Revokes the share token. Requires authentication.
// =============================================================================
router.post('/manufacturer-orders/:id/share/revoke', authenticate, async (req, res) => {
    const { id } = req.params;
    try {
        await db.query(
            `UPDATE manufacturer_orders
             SET share_token = NULL, share_token_hash = NULL, token_expires_at = NULL
             WHERE id = $1`,
            [id]
        );
        return success(res, { message: 'تم إلغاء رابط المشاركة.' });
    } catch (err) {
        console.error('[PublicMO] revoke error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/public/manufacturer-order/:token
// Returns full MO data for the supplier portal — NO auth required.
// =============================================================================
router.get('/manufacturer-order/:token', async (req, res) => {
    const { token } = req.params;
    try {
        let tokenHash = null;
        try { tokenHash = hashToken(token); } catch (_e) { /* SECRET missing — fallback */ }

        let result = null;
        if (tokenHash) {
            result = await db.query(
                `SELECT mo.id, mo.mo_number, mo.status, mo.notes,
                        mo.token_expires_at, mo.expected_delivery_date,
                        mo.order_id,
                        s.company_name AS supplier_name,
                        s.contact_person AS supplier_contact,
                        s.phone AS supplier_phone,
                        o.order_number
                 FROM manufacturer_orders mo
                 LEFT JOIN suppliers s ON s.id = mo.manufacturer_id
                 LEFT JOIN orders o ON o.id = mo.order_id
                 WHERE mo.share_token_hash = $1`,
                [tokenHash]
            );
        }

        // Fallback: plaintext token
        if (!result || result.rowCount === 0) {
            result = await db.query(
                `SELECT mo.id, mo.mo_number, mo.status, mo.notes,
                        mo.token_expires_at, mo.expected_delivery_date,
                        mo.order_id,
                        s.company_name AS supplier_name,
                        s.contact_person AS supplier_contact,
                        s.phone AS supplier_phone,
                        o.order_number
                 FROM manufacturer_orders mo
                 LEFT JOIN suppliers s ON s.id = mo.manufacturer_id
                 LEFT JOIN orders o ON o.id = mo.order_id
                 WHERE mo.share_token = $1`,
                [token]
            );
        }

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'الرابط غير صالح.' });
        }

        const mo = result.rows[0];
        if (mo.token_expires_at && new Date(mo.token_expires_at) < new Date()) {
            return res.status(410).json({ error: 'انتهت صلاحية هذا الرابط.' });
        }

        // Get client name
        let clientName = '—';
        if (mo.order_id) {
            const clientRes = await db.query(
                `SELECT c.name FROM orders o JOIN clients c ON c.id = o.client_id WHERE o.id = $1`,
                [mo.order_id]
            );
            if (clientRes.rowCount > 0) clientName = clientRes.rows[0].name;
        }
        mo.client_name = clientName;

        // Fetch items with design files
        const itemsResult = await db.query(
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
            [mo.id]
        );

        const items = itemsResult.rows;

        // Generate PDF thumbnails for all design files
        items.forEach(item => {
            if (item.design_name) {
                item.design_name = _safeDecodeFileName(item.design_name);
            }
            const files = Array.isArray(item.design_files) ? item.design_files : [];
            files.forEach(f => {
                if (f.name) f.name = _safeDecodeFileName(f.name);
                if (f.original_name) f.original_name = _safeDecodeFileName(f.original_name);
            });
        });

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
        console.error('[PublicMO] GET error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
