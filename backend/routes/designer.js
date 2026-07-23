'use strict';

// =============================================================================
// G.PACK 2.0 — Designer Workflow Route (designer.js)
// Handles: assign designer, designer tasks, submit designs, review/approve,
//          file uploads for design briefs and design files.
// =============================================================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const authorize = require('../middleware/authorize');
const { success, error } = require('../utils/response');

// =============================================================================
// File Upload Configuration
// =============================================================================
const UPLOAD_BASE = path.join(__dirname, '../uploads/designs');
if (!fs.existsSync(UPLOAD_BASE)) fs.mkdirSync(UPLOAD_BASE, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const { orderId, itemId } = req.params;
        let dir;
        if (itemId) {
            dir = path.join(UPLOAD_BASE, orderId, 'items', itemId);
        } else {
            dir = path.join(UPLOAD_BASE, orderId, 'brief');
        }
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const name = `design-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
        cb(null, name);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
    fileFilter: (_req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|pdf|ai|psd|eps|svg|webp|tiff|tif|bmp|raw|heic/;
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.test(ext)) {
            cb(null, true);
        } else {
            cb(new Error('نوع الملف غير مدعوم. الأنواع المسموحة: JPG, PNG, GIF, PDF, AI, PSD, EPS, SVG, WEBP, TIFF, BMP, RAW, HEIC'));
        }
    },
});

// =============================================================================
// Helper: validate UUID
// =============================================================================
function isValidUUID(str) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// =============================================================================
// Helper: check if user is assigned designer or admin/manager
// =============================================================================
async function _checkDesignerAccess(orderId, user) {
    if (user.role === 'admin' || user.role === 'super_admin' || user.role === 'manager') return true;
    const result = await db.query('SELECT assigned_designer_id FROM orders WHERE id = $1', [orderId]);
    if (result.rows.length === 0) return false;
    return result.rows[0].assigned_designer_id === user.id;
}

// =============================================================================
// MANAGER ENDPOINTS
// =============================================================================

// ── POST /api/designer/assign ───────────────────────────────────────────────
// Assign a designer to an order with a design brief.
// Body: { order_id, designer_id, design_brief, item_notes: [{item_id, notes}] }
// Files: design_brief_files[] (multipart/form-data)
// =============================================================================
router.post('/assign', authorize(['admin', 'manager', 'super_admin']), upload.array('design_brief_files', 10), async (req, res) => {
    const client = await db.getClient();
    try {
        const { order_id, designer_id, design_brief } = req.body;
        const itemNotesRaw = req.body.item_notes;
        let itemNotes = [];
        try { itemNotes = typeof itemNotesRaw === 'string' ? JSON.parse(itemNotesRaw) : (itemNotesRaw || []); } catch { itemNotes = []; }

        if (!order_id || !designer_id) {
            return res.status(400).json({ error: 'order_id و designer_id مطلوبان' });
        }

        await client.query('BEGIN');

        // Verify order exists and is a quote
        const orderCheck = await client.query('SELECT id, status FROM orders WHERE id = $1', [order_id]);
        if (orderCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'العرض غير موجود' });
        }
        if (orderCheck.rows[0].status !== 'quote') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'يمكن إرسال العروض بحالة "quote" فقط للمصمم' });
        }

        // Verify designer exists
        const designerCheck = await client.query('SELECT id, name FROM users WHERE id = $1 AND status = \'active\'', [designer_id]);
        if (designerCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المصمم غير موجود أو غير نشط' });
        }

        // Build brief files paths
        const briefFiles = (req.files || []).map(f => ({
            filename: f.filename,
            original_name: f.originalname,
            path: `/uploads/designs/${order_id}/brief/${f.filename}`,
            size: f.size,
        }));

        // Update order
        await client.query(
            `UPDATE orders SET
                design_status = 'pending',
                assigned_designer_id = $1,
                design_brief = $2,
                design_brief_files = $3,
                design_sent_at = NOW()
             WHERE id = $4`,
            [designer_id, design_brief || null, JSON.stringify(briefFiles), order_id]
        );

        // Update all items to pending + set item-level notes
        await client.query(
            `UPDATE order_items SET design_status = 'pending' WHERE order_id = $1`,
            [order_id]
        );

        // Set per-item notes if provided
        for (const item of itemNotes) {
            if (item.item_id && item.notes) {
                await client.query(
                    `UPDATE order_items SET design_notes = $1 WHERE id = $2 AND order_id = $3`,
                    [item.notes, item.item_id, order_id]
                );
            }
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `تم إرسال العرض للمصمم: ${designerCheck.rows[0].name}`,
            designer_name: designerCheck.rows[0].name,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Designer] Assign error:', err.message);
        res.status(500).json({ error: 'فشل في إرسال العرض للمصمم' });
    } finally {
        client.release();
    }
});

// ── PUT /api/designer/review/:orderId/item/:itemId ──────────────────────────
// Manager reviews a design item: approve or request revision.
// Body: { action: 'approve'|'revision', revision_notes? }
// =============================================================================
router.put('/review/:orderId/item/:itemId', authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    const client = await db.getClient();
    try {
        const { orderId, itemId } = req.params;
        const { action, revision_notes } = req.body;

        if (!action || !['approve', 'revision'].includes(action)) {
            return res.status(400).json({ error: 'action يجب أن تكون approve أو revision' });
        }

        await client.query('BEGIN');

        // Verify item exists and belongs to order
        const itemCheck = await client.query(
            'SELECT id, design_status FROM order_items WHERE id = $1 AND order_id = $2',
            [itemId, orderId]
        );
        if (itemCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'الصنف غير موجود' });
        }

        if (action === 'approve') {
            await client.query(
                `UPDATE order_items SET design_status = 'approved' WHERE id = $1`,
                [itemId]
            );
        } else {
            await client.query(
                `UPDATE order_items SET design_status = 'revision', revision_notes = $1 WHERE id = $2`,
                [revision_notes || null, itemId]
            );
        }

        // Check if all items are approved → auto-convert to production
        const pendingItems = await client.query(
            `SELECT COUNT(*) as count FROM order_items
             WHERE order_id = $1 AND design_status != 'approved'`,
            [orderId]
        );

        let autoConverted = false;
        if (parseInt(pendingItems.rows[0].count) === 0) {
            // All items approved → convert to production
            await client.query(
                `UPDATE orders SET status = 'production', design_status = 'completed', design_completed_at = NOW()
                 WHERE id = $1`,
                [orderId]
            );
            autoConverted = true;
        } else {
            // Update order design_status to 'revision' if any item is in revision
            const revisionCount = await client.query(
                `SELECT COUNT(*) as count FROM order_items WHERE order_id = $1 AND design_status = 'revision'`,
                [orderId]
            );
            if (parseInt(revisionCount.rows[0].count) > 0) {
                await client.query(`UPDATE orders SET design_status = 'revision' WHERE id = $1`, [orderId]);
            }
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            message: action === 'approve' ? 'تم اعتماد التصميم' : 'تم طلب تعديل على التصميم',
            auto_converted: autoConverted,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Designer] Review error:', err.message);
        res.status(500).json({ error: 'فشل في مراجعة التصميم' });
    } finally {
        client.release();
    }
});

// ── GET /api/designer/pending-review ────────────────────────────────────────
// Manager: get orders with design_status = 'in_review' (designer completed all items)
// =============================================================================
router.get('/pending-review', authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    try {
        const result = await db.query(
            `SELECT o.id, o.order_number, o.design_status, o.design_sent_at, o.design_completed_at,
                    o.design_brief, o.design_brief_files,
                    c.name as client_name,
                    u.name as designer_name,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_status = 'approved') as approved_count
             FROM orders o
             JOIN clients c ON c.id = o.client_id
             LEFT JOIN users u ON u.id = o.assigned_designer_id
             WHERE o.design_status IN ('in_review', 'revision')
             ORDER BY o.design_completed_at DESC NULLS LAST`,
        );
        res.json({ orders: result.rows });
    } catch (err) {
        console.error('[Designer] Pending review error:', err.message);
        res.status(500).json({ error: 'فشل في تحميل العروض بانتظار المراجعة' });
    }
});

// =============================================================================
// DESIGNER ENDPOINTS
// =============================================================================

// ── GET /api/designer/my-tasks ──────────────────────────────────────────────
// Designer: get orders assigned to me.
// =============================================================================
router.get('/my-tasks', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT o.id, o.order_number, o.design_status, o.design_brief, o.design_brief_files,
                    o.design_sent_at, o.created_at,
                    c.name as client_name,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_status = 'completed') as completed_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_status = 'approved') as approved_count
             FROM orders o
             JOIN clients c ON c.id = o.client_id
             WHERE o.assigned_designer_id = $1
               AND o.design_status IN ('pending', 'in_progress', 'revision')
             ORDER BY o.design_sent_at DESC`,
            [req.user.id]
        );
        res.json({ tasks: result.rows });
    } catch (err) {
        console.error('[Designer] My tasks error:', err.message);
        res.status(500).json({ error: 'فشل في تحميل المهام' });
    }
});

// ── GET /api/designer/task/:orderId ─────────────────────────────────────────
// Designer: get full details of an assigned order including items, client designs, pantone colors.
// =============================================================================
router.get('/task/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;

        const hasAccess = await _checkDesignerAccess(orderId, req.user);
        if (!hasAccess) {
            return res.status(403).json({ error: 'غير مصرح لك بعرض هذا العرض' });
        }

        // Get order
        const orderResult = await db.query(
            `SELECT o.id, o.order_number, o.design_status, o.design_brief, o.design_brief_files,
                    o.design_sent_at, o.client_id, c.name as client_name
             FROM orders o
             JOIN clients c ON c.id = o.client_id
             WHERE o.id = $1`,
            [orderId]
        );
        if (orderResult.rows.length === 0) {
            return res.status(404).json({ error: 'العرض غير موجود' });
        }

        // Get order items with design info
        const itemsResult = await db.query(
            `SELECT oi.id, oi.variant_id, oi.quantity, oi.unit_price,
                    pv.product_name, pv.size,
                    oi.design_notes, oi.design_files, oi.design_status,
                    oi.designer_notes, oi.revision_notes, oi.design_completed_at
             FROM order_items oi
             LEFT JOIN product_variants pv ON pv.id = oi.variant_id
             WHERE oi.order_id = $1
             ORDER BY oi.id ASC`,
            [orderId]
        );

        // Get client pantone colors (if table exists)
        let pantoneColors = [];
        try {
            const pantoneResult = await db.query(
                `SELECT color_name, color_code, hex_code FROM client_pantone_colors WHERE client_id = $1 AND is_active = true`,
                [orderResult.rows[0].client_id]
            );
            pantoneColors = pantoneResult.rows;
        } catch { /* table might not exist — ignore */ }

        // Get client designs (if table exists)
        let clientDesigns = [];
        try {
            const designsResult = await db.query(
                `SELECT id, title, file_path, file_type FROM client_designs WHERE client_id = $1 AND is_active = true`,
                [orderResult.rows[0].client_id]
            );
            clientDesigns = designsResult.rows;
        } catch { /* table might not exist — ignore */ }

        res.json({
            order: orderResult.rows[0],
            items: itemsResult.rows,
            pantone_colors: pantoneColors,
            client_designs: clientDesigns,
        });
    } catch (err) {
        console.error('[Designer] Task detail error:', err.message);
        res.status(500).json({ error: 'فشل في تحميل تفاصيل العرض' });
    }
});

// ── PUT /api/designer/item/:orderId/:itemId/start ───────────────────────────
// Designer: mark an item as in_progress.
// =============================================================================
router.put('/item/:orderId/:itemId/start', async (req, res) => {
    try {
        const { orderId, itemId } = req.params;

        const hasAccess = await _checkDesignerAccess(orderId, req.user);
        if (!hasAccess) {
            return res.status(403).json({ error: 'غير مصرح لك' });
        }

        await db.query(
            `UPDATE order_items SET design_status = 'in_progress' WHERE id = $1 AND order_id = $2`,
            [itemId, orderId]
        );

        // Update order status to in_progress if it was pending
        await db.query(
            `UPDATE orders SET design_status = 'in_progress'
             WHERE id = $1 AND design_status = 'pending'`,
            [orderId]
        );

        res.json({ success: true, message: 'تم بدء التصميم' });
    } catch (err) {
        console.error('[Designer] Start error:', err.message);
        res.status(500).json({ error: 'فشل في بدء التصميم' });
    }
});

// ── PUT /api/designer/item/:orderId/:itemId/submit ──────────────────────────
// Designer: submit design for an item (upload files + notes).
// Body (multipart/form-data): designer_notes, design_files[]
// =============================================================================
router.put('/item/:orderId/:itemId/submit', upload.array('design_files', 10), async (req, res) => {
    const client = await db.getClient();
    try {
        const { orderId, itemId } = req.params;
        const { designer_notes } = req.body;

        const hasAccess = await _checkDesignerAccess(orderId, req.user);
        if (!hasAccess) {
            return res.status(403).json({ error: 'غير مصرح لك' });
        }

        // Get existing design files
        const existingResult = await db.query(
            'SELECT design_files FROM order_items WHERE id = $1 AND order_id = $2',
            [itemId, orderId]
        );
        if (existingResult.rows.length === 0) {
            return res.status(404).json({ error: 'الصنف غير موجود' });
        }

        let existingFiles = [];
        try { existingFiles = existingResult.rows[0].design_files || []; } catch { existingFiles = []; }

        const newFiles = (req.files || []).map(f => ({
            filename: f.filename,
            original_name: f.originalname,
            path: `/uploads/designs/${orderId}/items/${itemId}/${f.filename}`,
            size: f.size,
        }));

        const allFiles = [...(Array.isArray(existingFiles) ? existingFiles : []), ...newFiles];

        await client.query('BEGIN');

        await client.query(
            `UPDATE order_items SET
                design_status = 'completed',
                designer_notes = $1,
                design_files = $2,
                design_completed_at = NOW()
             WHERE id = $3 AND order_id = $4`,
            [designer_notes || null, JSON.stringify(allFiles), itemId, orderId]
        );

        // Check if all items are completed → update order to in_review
        const pendingCount = await client.query(
            `SELECT COUNT(*) as count FROM order_items
             WHERE order_id = $1 AND design_status NOT IN ('completed', 'approved')`,
            [orderId]
        );

        if (parseInt(pendingCount.rows[0].count) === 0) {
            await client.query(
                `UPDATE orders SET design_status = 'in_review' WHERE id = $1`,
                [orderId]
            );
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            message: 'تم تسليم التصميم',
            files_added: newFiles.length,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Designer] Submit error:', err.message);
        res.status(500).json({ error: 'فشل في تسليم التصميم' });
    } finally {
        client.release();
    }
});

// ── GET /api/designer/my-completed ──────────────────────────────────────────
// Designer: get completed tasks (history).
// =============================================================================
router.get('/my-completed', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT o.id, o.order_number, o.design_status, o.design_completed_at,
                    c.name as client_name
             FROM orders o
             JOIN clients c ON c.id = o.client_id
             WHERE o.assigned_designer_id = $1
               AND o.design_status IN ('completed', 'in_review')
             ORDER BY o.design_completed_at DESC NULLS LAST LIMIT 30`,
            [req.user.id]
        );
        res.json({ tasks: result.rows });
    } catch (err) {
        console.error('[Designer] My completed error:', err.message);
        res.status(500).json({ error: 'فشل في تحميل المهام المكتملة' });
    }
});

// =============================================================================
// SHARED ENDPOINTS
// =============================================================================

// ── GET /api/designer/designers-list ────────────────────────────────────────
// Manager: get list of active users with designer role/permission.
// =============================================================================
router.get('/designers-list', authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    try {
        const result = await db.query(
            `SELECT u.id, u.name, u.email, r.role_name
             FROM users u
             LEFT JOIN roles r ON r.id = u.role_id
             WHERE u.status = 'active'
               AND (r.role_name ILIKE '%design%' OR r.permissions::text ILIKE '%designer%')
             ORDER BY u.name`
        );
        // If no designers found by role, return all active users (manager can pick anyone)
        if (result.rows.length === 0) {
            const fallback = await db.query(
                `SELECT u.id, u.name, u.email FROM users u WHERE u.status = 'active' ORDER BY u.name`
            );
            return res.json({ designers: fallback.rows });
        }
        res.json({ designers: result.rows });
    } catch (err) {
        console.error('[Designer] Designers list error:', err.message);
        res.status(500).json({ error: 'فشل في تحميل قائمة المصممين' });
    }
});

module.exports = router;
