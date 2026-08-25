'use strict';

const express  = require('express');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const db       = require('../db');
const { success } = require('../utils/response');
const { encryptToken, hashToken, hasShareTokenSecret } = require('../utils/crypto');
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

const APPROVAL_UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'quotation-approvals');
if (!fs.existsSync(APPROVAL_UPLOADS_DIR)) fs.mkdirSync(APPROVAL_UPLOADS_DIR, { recursive: true });

function saveQuotationSignature(signature, orderId, revision) {
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(signature || '');
    if (!match) throw Object.assign(new Error('التوقيع غير صالح. يرجى التوقيع داخل الحقل المخصص.'), { statusCode: 400 });

    const buffer = Buffer.from(match[2], 'base64');
    const isPng = buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    const isJpeg = buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
    if (buffer.length < 50 || buffer.length > 2 * 1024 * 1024 || (match[1] === 'png' ? !isPng : !isJpeg)) {
        throw Object.assign(new Error('التوقيع غير صالح.'), { statusCode: 400 });
    }

    const extension = match[1] === 'jpeg' ? 'jpg' : 'png';
    const filename = `quotation-${orderId}-v${revision}-${crypto.randomBytes(8).toString('hex')}.${extension}`;
    fs.writeFileSync(path.join(APPROVAL_UPLOADS_DIR, filename), buffer, { flag: 'wx' });
    return {
        path: `/uploads/quotation-approvals/${filename}`,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    };
}

// =============================================================================
// POST /api/public/quotations/:id/share
// Generates a share token for a quote. Requires authentication (internal call).
// Body: { expires_days } — default 45 days
// =============================================================================
router.post('/quotations/:id/share', require('../middleware/authMiddleware').authenticate, async (req, res) => {
    const { id } = req.params;
    const expiresDays = 45;

    try {
        const check = await db.query(
            `SELECT id, order_number, status FROM orders WHERE id = $1`,
            [id]
        );
        if (check.rowCount === 0) return res.status(404).json({ error: 'العرض غير موجود.' });
        if (!['quote', 'production'].includes(check.rows[0].status)) {
            return res.status(400).json({ error: 'لا يمكن مشاركة هذا الطلب في حالته الحالية.' });
        }

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

        try {
            await db.query(
                `UPDATE orders SET share_token = $1, share_token_hash = $2, token_expires_at = $3, updated_at = NOW() WHERE id = $4`,
                [storedToken, tokenHash, expiresAt, id]
            );
        } catch (dbErr) {
            const missingHashColumn = dbErr?.code === '42703' || /share_token_hash/i.test(dbErr?.message || '');
            if (missingHashColumn) {
                console.warn('[PublicQuotation] share_token_hash column missing — falling back to plaintext column only. Please run migrations.');
                await db.query(
                    `UPDATE orders SET share_token = $1, token_expires_at = $2, updated_at = NOW() WHERE id = $3`,
                    [storedToken, expiresAt, id]
                );
            } else {
                throw dbErr;
            }
        }

        return success(res, { token: plainToken, expires_at: expiresAt });
    } catch (err) {
        console.error('[PublicQuotation] share error:', err.message);
        const needsSecret = !hasShareTokenSecret();
        const message = needsSecret
            ? 'تعذّر إنشاء رابط المشاركة. تأكد من إعداد SHARE_TOKEN_SECRET في ملف .env'
            : `تعذّر إنشاء رابط المشاركة: ${err.message}`;
        return res.status(500).json({ error: message });
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
                    o.token_expires_at, o.quotation_revision,
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
                    o.token_expires_at, o.quotation_revision,
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

        const approvalResult = await db.query(
            `SELECT signer_name, signature_path, signature_sha256, approved_at
             FROM quotation_approvals
             WHERE order_id = $1 AND quotation_revision = $2
             LIMIT 1`,
            [order.id, order.quotation_revision || 1]
        );
        order.quotation_approval = approvalResult.rows[0] || null;

        // Fetch order items
        const itemsRes = await db.query(
            `SELECT
                oi.id, oi.quantity, oi.unit_price, oi.discount_percent,
                oi.discount_amount, oi.line_total, oi.notes,
                pv.size_name, pv.sku,
                p.name AS product_name,
                p.description AS product_description,
                u.name AS unit_name,
                u.abbreviation AS unit_abbreviation
             FROM order_items oi
             JOIN product_variants pv ON pv.id = oi.variant_id
             JOIN products p          ON p.id  = pv.product_id
             LEFT JOIN units u        ON u.id  = pv.unit_id
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
    const { response, reason, signature, device_info } = req.body;

    if (!['approved', 'rejected'].includes(response)) {
        return res.status(400).json({ error: 'الرد يجب أن يكون approved أو rejected.' });
    }
    if (response === 'rejected' && !reason?.trim()) {
        return res.status(400).json({ error: 'يرجى كتابة سبب الرفض.' });
    }
    if (response === 'approved' && !signature) {
        return res.status(400).json({ error: 'التوقيع مطلوب لاعتماد عرض السعر.' });
    }

    let client;
    let savedApprovalPath = null;
    try {
        client = await db.getClient();
        await client.query('BEGIN');

        let tokenHash = null;
        try { tokenHash = hashToken(token); } catch (_e) { /* SECRET missing */ }

        let result = null;
        if (tokenHash) {
            result = await client.query(
                `SELECT o.id, o.status, o.client_response, o.token_expires_at,
                        o.quotation_revision, o.client_id, o.order_number, c.name AS client_name
                 FROM orders o LEFT JOIN clients c ON c.id = o.client_id
                 WHERE o.share_token_hash = $1 FOR UPDATE OF o`,
                [tokenHash]
            );
        }
        if (!result || result.rowCount === 0) {
            result = await client.query(
                `SELECT o.id, o.status, o.client_response, o.token_expires_at,
                        o.quotation_revision, o.client_id, o.order_number, c.name AS client_name
                 FROM orders o LEFT JOIN clients c ON c.id = o.client_id
                 WHERE o.share_token = $1 FOR UPDATE OF o`,
                [token]
            );
        }
        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'الرابط غير صالح.' });
        }

        const order = result.rows[0];
        if (order.status !== 'quote') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'تم تحويل عرض السعر إلى أمر تشغيل ولا يمكن تعديل الرد.' });
        }
        const signerName = (order.client_name || 'العميل').trim();
        if (new Date(order.token_expires_at) < new Date()) {
            await client.query('ROLLBACK');
            return res.status(410).json({ error: 'انتهت صلاحية هذا الرابط.' });
        }
        if (order.client_response) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'تم تسجيل ردك مسبقاً على هذا العرض.' });
        }

        const receiptPath = req.file ? `/uploads/receipts/${req.file.filename}` : null;
        let approval = null;
        if (response === 'approved') {
            approval = saveQuotationSignature(signature, order.id, order.quotation_revision);
            savedApprovalPath = approval.path;
        }

        await client.query(
            `UPDATE orders
             SET client_response  = $1,
                 rejection_reason = $2,
                 deposit_receipt  = $3,
                 responded_at     = NOW(),
                 updated_at       = NOW()
             WHERE id = $4 AND client_response IS NULL`,
            [response, reason || null, receiptPath, order.id]
        );

        if (response === 'approved') {
            await client.query(
                `INSERT INTO quotation_approvals
                    (order_id, quotation_revision, client_id, client_name, order_number,
                     signer_name, signature_path, signature_sha256, declaration_text,
                     client_ip, user_agent, device_info)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [order.id, order.quotation_revision, order.client_id, order.client_name,
                 order.order_number, signerName, approval.path, approval.sha256,
                 'أقر العميل بموافقته على عرض السعر والبيانات والبنود الموضحة به.',
                 req.ip || null, req.get('user-agent') || null, device_info || null]
            );
        }

        await client.query('COMMIT');
        return success(res, { message: response === 'approved' ? 'شكراً! تم تسجيل موافقتك وتوقيعك بنجاح.' : 'تم تسجيل ردك بنجاح.' });
    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        if (savedApprovalPath) {
            try { fs.unlinkSync(path.join(APPROVAL_UPLOADS_DIR, path.basename(savedApprovalPath))); } catch (_cleanupErr) {}
        }
        if (req.file?.path) {
            try { fs.unlinkSync(req.file.path); } catch (_cleanupErr) {}
        }
        console.error('[PublicQuotation] respond error:', err.message);
        if (err.code === '23505') return res.status(409).json({ error: 'تم تسجيل اعتماد هذا العرض مسبقاً.' });
        return res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error.' });
    } finally {
        if (client) client.release();
    }
});

module.exports = router;
