'use strict';

const express  = require('express');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const db       = require('../db');
const { success } = require('../utils/response');
const { encryptToken, hashToken } = require('../utils/crypto');
const router   = express.Router();

// =============================================================================
// Public Quotation Portal — NO authentication required on these routes.
// Routes are mounted at /api/public in server.js.
//
// POST /api/public/quotations/:id/share        → generate share token (auth'd)
// GET  /api/public/quotation/:token            → client views the quote
// POST /api/public/quotation/:token/respond    → client approves/rejects + upload
// =============================================================================

// ── Upload config for deposit receipts ──────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'receipts');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename:    (_req, file, cb) => {
        const ext  = path.extname(file.originalname).toLowerCase();
        const name = `receipt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
        cb(null, name);
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (_req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.pdf', '.webp'];
        if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
        else cb(new Error('نوع الملف غير مسموح. الأنواع المقبولة: JPG, PNG, PDF'));
    },
});

// =============================================================================
// POST /api/public/quotations/:id/share
// Generates a share token for a quote. Requires authentication (internal call).
// Body: { expires_days } — default 7 days
// =============================================================================
router.post('/quotations/:id/share', require('../middleware/authMiddleware').authenticate, async (req, res) => {
    const { id } = req.params;
    const expiresDays = parseInt(req.body.expires_days || 7);

    try {
        const check = await db.query(
            `SELECT id, order_number, status FROM orders WHERE id = $1`,
            [id]
        );
        if (check.rowCount === 0) return res.status(404).json({ error: 'العرض غير موجود.' });
        if (check.rows[0].status !== 'quote') return res.status(400).json({ error: 'يمكن مشاركة عروض الأسعار فقط.' });

        const plainToken = crypto.randomBytes(32).toString('hex');
        const expiresAt  = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000);

        let storedToken = plainToken;
        let tokenHash;
        try {
            storedToken = encryptToken(plainToken);
            tokenHash   = hashToken(plainToken);
        } catch (cryptoErr) {
            console.error('[PublicQuotation] Crypto error (SHARE_TOKEN_SECRET missing or invalid):', cryptoErr.message);
            const hmac = crypto.createHmac('sha256', plainToken).digest('hex');
            tokenHash   = hmac;
            storedToken = plainToken;
        }

        await db.query(
            `UPDATE orders SET share_token = $1, share_token_hash = $2, token_expires_at = $3, updated_at = NOW() WHERE id = $4`,
            [storedToken, tokenHash, expiresAt, id]
        );

        return success(res, { token: plainToken, expires_at: expiresAt });
    } catch (err) {
        console.error('[PublicQuotation] share error:', err.message);
        return res.status(500).json({ error: 'تعذّر إنشاء رابط المشاركة. تأكد من إعداد SHARE_TOKEN_SECRET في ملف .env' });
    }
});

// =============================================================================
// GET /api/public/quotation/:token
// Returns full quote data for the client portal — NO auth required.
// =============================================================================
router.get('/quotation/:token', async (req, res) => {
    const { token } = req.params;
    try {
        let tokenHash = null;
        try { tokenHash = hashToken(token); } catch (_e) { /* SECRET missing — fallback to plaintext */ }

        let result = null;
        if (tokenHash) {
            result = await db.query(
                `SELECT
                    o.id, o.order_number, o.order_date, o.valid_until, o.status,
                    o.subtotal, o.tax_rate, o.tax_amount, o.grand_total,
                    o.client_notes, o.terms_conditions, o.custom_terms,
                    o.down_payment_required,
                    o.client_response, o.rejection_reason, o.responded_at,
                    o.token_expires_at,
                    c.name  AS client_name,
                    c.phone AS client_phone,
                    c.email AS client_email
                 FROM orders o
                 LEFT JOIN clients c ON c.id = o.client_id
                 WHERE o.share_token_hash = $1`,
                [tokenHash]
            );
        }

        // Backward-compatible fallback: plaintext token stored before migration or when SECRET was missing
        if (!result || result.rowCount === 0) {
            result = await db.query(
                `SELECT
                    o.id, o.order_number, o.order_date, o.valid_until, o.status,
                    o.subtotal, o.tax_rate, o.tax_amount, o.grand_total,
                    o.client_notes, o.terms_conditions, o.custom_terms,
                    o.down_payment_required,
                    o.client_response, o.rejection_reason, o.responded_at,
                    o.token_expires_at,
                    c.name  AS client_name,
                    c.phone AS client_phone,
                    c.email AS client_email
                 FROM orders o
                 LEFT JOIN clients c ON c.id = o.client_id
                 WHERE o.share_token = $1`,
                [token]
            );
        }

        if (result.rowCount === 0) return res.status(404).json({ error: 'الرابط غير صالح.' });

        const order = result.rows[0];
        if (new Date(order.token_expires_at) < new Date()) {
            return res.status(410).json({ error: 'انتهت صلاحية هذا الرابط.' });
        }

        // Fetch order items
        const itemsRes = await db.query(
            `SELECT
                oi.id, oi.quantity, oi.unit_price, oi.discount_percent,
                oi.discount_amount, oi.line_total, oi.notes,
                pv.size_name, pv.sku,
                p.name AS product_name,
                p.description AS product_description
             FROM order_items oi
             JOIN product_variants pv ON pv.id = oi.variant_id
             JOIN products p          ON p.id  = pv.product_id
             WHERE oi.order_id = $1
             ORDER BY oi.created_at ASC`,
            [order.id]
        );

        return success(res, { order, items: itemsRes.rows });
    } catch (err) {
        console.error('[PublicQuotation] GET error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/public/quotation/:token/respond
// Client submits approval/rejection. Optionally uploads deposit receipt.
// Body (multipart/form-data): response ('approved'|'rejected'), reason (if rejected)
// File field: receipt
// =============================================================================
router.post('/quotation/:token/respond', upload.single('receipt'), async (req, res) => {
    const { token } = req.params;
    const { response, reason } = req.body;

    if (!['approved', 'rejected'].includes(response)) {
        return res.status(400).json({ error: 'الرد يجب أن يكون approved أو rejected.' });
    }
    if (response === 'rejected' && !reason?.trim()) {
        return res.status(400).json({ error: 'يرجى كتابة سبب الرفض.' });
    }

    try {
        let tokenHash = null;
        try { tokenHash = hashToken(token); } catch (_e) { /* SECRET missing */ }

        let result = null;
        if (tokenHash) {
            result = await db.query(
                `SELECT id, status, client_response, token_expires_at FROM orders WHERE share_token_hash = $1`,
                [tokenHash]
            );
        }
        // Backward-compatible fallback
        if (!result || result.rowCount === 0) {
            result = await db.query(
                `SELECT id, status, client_response, token_expires_at FROM orders WHERE share_token = $1`,
                [token]
            );
        }
        if (result.rowCount === 0) return res.status(404).json({ error: 'الرابط غير صالح.' });

        const order = result.rows[0];
        if (new Date(order.token_expires_at) < new Date()) {
            return res.status(410).json({ error: 'انتهت صلاحية هذا الرابط.' });
        }
        if (order.client_response) {
            return res.status(409).json({ error: 'تم تسجيل ردك مسبقاً على هذا العرض.' });
        }

        const receiptPath = req.file ? `/uploads/receipts/${req.file.filename}` : null;

        await db.query(
            `UPDATE orders
             SET client_response  = $1,
                 rejection_reason = $2,
                 deposit_receipt  = $3,
                 responded_at     = NOW(),
                 updated_at       = NOW()
             WHERE id = $4`,
            [response, reason || null, receiptPath, order.id]
        );

        return success(res, { message: response === 'approved' ? 'شكراً! تم تسجيل موافقتك بنجاح.' : 'تم تسجيل ردك بنجاح.' });
    } catch (err) {
        console.error('[PublicQuotation] respond error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
