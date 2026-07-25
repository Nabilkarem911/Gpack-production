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
const { encryptToken, hashToken, hasShareTokenSecret, decryptShareToken } = require('../utils/crypto');

// =============================================================================
// File Upload Configuration
// =============================================================================
const UPLOAD_BASE = path.join(__dirname, '../uploads/designs');
if (!fs.existsSync(UPLOAD_BASE)) fs.mkdirSync(UPLOAD_BASE, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const orderId = req.params.orderId || req.body.order_id || 'unassigned';
        const itemId = req.params.itemId;
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
    // Check order-level assignment (legacy)
    const orderResult = await db.query('SELECT assigned_designer_id FROM orders WHERE id = $1', [orderId]);
    if (orderResult.rows.length === 0) return false;
    if (orderResult.rows[0].assigned_designer_id === user.id) return true;
    // Check item-level assignment (new per-item)
    const itemResult = await db.query(
        'SELECT 1 FROM order_items WHERE order_id = $1 AND assigned_designer_id = $2 LIMIT 1',
        [orderId, user.id]
    );
    return itemResult.rows.length > 0;
}

// =============================================================================
// Helper: recalculate order-level design_status from item-level statuses
// Rules:
//   - All items approved → 'completed'
//   - Any item in revision → 'revision'
//   - All items completed or approved (no pending/in_progress/revision) → 'in_review'
//   - Any item in_progress or completed → 'in_progress'
//   - All items pending → 'pending'
//   - If client_review was set (sent to client), keep 'client_review'
// =============================================================================
async function _recalcOrderDesignStatus(client, orderId) {
    const counts = await client.query(
        `SELECT
            COUNT(*) FILTER (WHERE design_status = 'pending') as pending,
            COUNT(*) FILTER (WHERE design_status = 'in_progress') as in_progress,
            COUNT(*) FILTER (WHERE design_status = 'completed') as completed,
            COUNT(*) FILTER (WHERE design_status = 'approved') as approved,
            COUNT(*) FILTER (WHERE design_status = 'revision') as revision,
            COUNT(*) as total
         FROM order_items WHERE order_id = $1`,
        [orderId]
    );
    const c = counts.rows[0];
    const pending = parseInt(c.pending);
    const inProgress = parseInt(c.in_progress);
    const completed = parseInt(c.completed);
    const approved = parseInt(c.approved);
    const revision = parseInt(c.revision);
    const total = parseInt(c.total);

    let newStatus;
    if (approved === total) {
        newStatus = 'completed';
    } else if (revision > 0) {
        newStatus = 'revision';
    } else if (pending === 0 && inProgress === 0 && revision === 0) {
        newStatus = 'in_review';
    } else if (inProgress > 0 || completed > 0 || approved > 0) {
        newStatus = 'in_progress';
    } else {
        newStatus = 'pending';
    }

    // Don't override client_review or completed if already set by other flows
    const current = await client.query('SELECT design_status, design_client_status FROM orders WHERE id = $1', [orderId]);
    if (current.rows.length > 0) {
        const cur = current.rows[0].design_status;
        const clientStatus = current.rows[0].design_client_status;
        // If sent to client and not all approved, keep client_review
        if (clientStatus === 'sent' && newStatus !== 'completed') {
            newStatus = 'client_review';
        }
    }

    await client.query('UPDATE orders SET design_status = $1 WHERE id = $2', [newStatus, orderId]);
    return newStatus;
}

// =============================================================================
// MANAGER ENDPOINTS
// =============================================================================

// ── POST /api/designer/assign ───────────────────────────────────────────────
// Assign designer(s) to order items with per-item notes and files.
// Body (multipart/form-data):
//   order_id, design_brief (general brief)
//   item_assignments: JSON string [{item_id, designer_id, notes}] — per-item designer
//   OR designer_id (legacy: assign all items to one designer)
//   item_notes: JSON string [{item_id, notes}] — legacy per-item notes
// Files: design_brief_files[] (order-level), item_files_<item_id>[] (per-item)
// =============================================================================
router.post('/assign', authorize(['admin', 'manager', 'super_admin']), upload.any(), async (req, res) => {
    const client = await db.getClient();
    try {
        const { order_id, design_brief } = req.body;
        const itemAssignmentsRaw = req.body.item_assignments;
        let itemAssignments = [];
        try { itemAssignments = typeof itemAssignmentsRaw === 'string' ? JSON.parse(itemAssignmentsRaw) : (itemAssignmentsRaw || []); } catch { itemAssignments = []; }

        // Legacy support: if designer_id provided and no item_assignments, assign all items to that designer
        const legacyDesignerId = req.body.designer_id;
        if (itemAssignments.length === 0 && legacyDesignerId) {
            // Fetch all order items and assign them to the legacy designer
            const itemsResult = await db.query('SELECT id FROM order_items WHERE order_id = $1', [order_id]);
            itemAssignments = itemsResult.rows.map(it => ({
                item_id: it.id,
                designer_id: parseInt(legacyDesignerId),
                notes: null,
            }));
        }

        // Also merge legacy item_notes into item_assignments
        const itemNotesRaw = req.body.item_notes;
        let itemNotes = [];
        try { itemNotes = typeof itemNotesRaw === 'string' ? JSON.parse(itemNotesRaw) : (itemNotesRaw || []); } catch { itemNotes = []; }
        if (itemNotes.length > 0) {
            const notesMap = {};
            for (const n of itemNotes) { if (n.item_id) notesMap[n.item_id] = n.notes; }
            for (const ia of itemAssignments) {
                if (notesMap[ia.item_id] && !ia.notes) ia.notes = notesMap[ia.item_id];
            }
        }

        if (!order_id || itemAssignments.length === 0) {
            return res.status(400).json({ error: 'order_id و item_assignments (أو designer_id) مطلوبان' });
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

        // Verify all designers exist
        const designerIds = [...new Set(itemAssignments.map(ia => ia.designer_id))];
        for (const did of designerIds) {
            const designerCheck = await client.query('SELECT id, name FROM users WHERE id = $1 AND status = \'active\'', [did]);
            if (designerCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: `المصمم رقم ${did} غير موجود أو غير نشط` });
            }
        }

        // Separate order-level brief files from per-item files
        const allFiles = req.files || [];
        const briefFiles = allFiles
            .filter(f => f.fieldname === 'design_brief_files')
            .map(f => ({
                filename: f.filename,
                original_name: f.originalname,
                path: `/uploads/designs/${order_id}/brief/${f.filename}`,
                size: f.size,
            }));

        // Group per-item files by item_id
        const itemFilesMap = {};
        for (const f of allFiles) {
            const match = f.fieldname.match(/^item_files_(.+)$/);
            if (match) {
                const itemId = match[1];
                if (!itemFilesMap[itemId]) itemFilesMap[itemId] = [];
                itemFilesMap[itemId].push({
                    filename: f.filename,
                    original_name: f.originalname,
                    path: `/uploads/designs/${order_id}/items/${itemId}/${f.filename}`,
                    size: f.size,
                });
            }
        }

        // Set order-level design status and brief (use first designer as order-level assigned_designer_id for backward compat)
        const firstDesignerId = itemAssignments[0].designer_id;
        await client.query(
            `UPDATE orders SET
                design_status = 'pending',
                assigned_designer_id = $1,
                design_brief = $2,
                design_brief_files = $3,
                design_sent_at = NOW()
             WHERE id = $4`,
            [firstDesignerId, design_brief || null, JSON.stringify(briefFiles), order_id]
        );

        // Update ALL items to pending first (reset)
        await client.query(
            `UPDATE order_items SET design_status = 'pending' WHERE order_id = $1`,
            [order_id]
        );

        // Set per-item designer_id, notes, and brief files
        for (const ia of itemAssignments) {
            if (!ia.item_id || !ia.designer_id) continue;

            await client.query(
                `UPDATE order_items SET
                    assigned_designer_id = $1,
                    design_notes = COALESCE($2, design_notes)
                 WHERE id = $3 AND order_id = $4`,
                [ia.designer_id, ia.notes || null, ia.item_id, order_id]
            );

            // Set per-item brief files if any
            if (itemFilesMap[ia.item_id]) {
                await client.query(
                    `UPDATE order_items SET design_brief_files = $1 WHERE id = $2 AND order_id = $3`,
                    [JSON.stringify(itemFilesMap[ia.item_id]), ia.item_id, order_id]
                );
            }
        }

        // Recalculate order-level design_status
        await _recalcOrderDesignStatus(client, order_id);

        await client.query('COMMIT');

        // Get designer names for response
        const designerNames = [];
        for (const did of designerIds) {
            const dr = await db.query('SELECT name FROM users WHERE id = $1', [did]);
            if (dr.rows.length > 0) designerNames.push(dr.rows[0].name);
        }

        res.json({
            success: true,
            message: `تم إرسال ${itemAssignments.length} صنف للمصمم: ${designerNames.join('، ')}`,
            designer_names: designerNames,
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
            // Recalculate order-level design_status from item statuses
            await _recalcOrderDesignStatus(client, orderId);
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
        const isAdmin = ['admin', 'super_admin', 'manager'].includes(req.user.role) ||
                        (req.user.permissions && req.user.permissions.all_access === true);

        if (isAdmin) {
            const { designer_id } = req.query;
            const params = [];
            let paramIdx = 1;
            let filterClause = '';

            if (designer_id) {
                params.push(designer_id);
                filterClause = `AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.assigned_designer_id = $${paramIdx++})`;
            }

            const result = await db.query(
                `SELECT o.id, o.order_number, o.design_status, o.design_brief, o.design_brief_files,
                        o.design_sent_at, o.created_at, o.design_client_status,
                        c.name as client_name,
                        u.name as designer_name,
                        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count,
                        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_status = 'pending') as pending_count,
                        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_status = 'in_progress') as in_progress_count,
                        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_status = 'completed') as completed_count,
                        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_status = 'approved') as approved_count,
                        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_status = 'revision') as revision_count,
                        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_files IS NOT NULL AND design_files != '[]'::jsonb) as designed_count
                 FROM orders o
                 JOIN clients c ON c.id = o.client_id
                 LEFT JOIN users u ON u.id = o.assigned_designer_id
                 WHERE o.design_status IN ('pending', 'in_progress', 'revision', 'client_review', 'in_review')
                   ${filterClause}
                 ORDER BY o.design_sent_at DESC`,
                params
            );
            return res.json({ tasks: result.rows });
        }

        // Designer: see only orders where I have items assigned to me
        const result = await db.query(
            `SELECT o.id, o.order_number, o.design_status, o.design_brief, o.design_brief_files,
                    o.design_sent_at, o.created_at,
                    c.name as client_name,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND assigned_designer_id = $1) as item_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND assigned_designer_id = $1 AND design_status = 'pending') as pending_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND assigned_designer_id = $1 AND design_status = 'in_progress') as in_progress_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND assigned_designer_id = $1 AND design_status = 'completed') as completed_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND assigned_designer_id = $1 AND design_status = 'approved') as approved_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND assigned_designer_id = $1 AND design_status = 'revision') as revision_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND assigned_designer_id = $1 AND design_files IS NOT NULL AND design_files != '[]'::jsonb) as designed_count
             FROM orders o
             JOIN clients c ON c.id = o.client_id
             WHERE EXISTS (
                 SELECT 1 FROM order_items oi
                 WHERE oi.order_id = o.id AND oi.assigned_designer_id = $1
             )
               AND o.design_status IN ('pending', 'in_progress', 'revision', 'in_review')
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
                    o.design_sent_at, o.client_id, c.name as client_name,
                    o.design_client_status, o.design_share_token, o.design_share_token_hash,
                    o.design_sent_to_client_at
             FROM orders o
             JOIN clients c ON c.id = o.client_id
             WHERE o.id = $1`,
            [orderId]
        );
        if (orderResult.rows.length === 0) {
            return res.status(404).json({ error: 'العرض غير موجود' });
        }

        // Decrypt share token for frontend URL construction
        const orderData = orderResult.rows[0];
        if (orderData.design_share_token) {
            try {
                orderData.design_share_token = decryptShareToken(orderData.design_share_token);
            } catch {
                // If decryption fails, it might be stored as plain text (old data)
                // Keep as-is
            }
        }

        // Get order items with design info
        // For designers (non-admin), only return items assigned to them
        const isManager = ['admin', 'super_admin', 'manager'].includes(req.user.role);
        const designerFilter = isManager ? '' : 'AND oi.assigned_designer_id = $2';
        const itemsParams = isManager ? [orderId] : [orderId, req.user.id];

        const itemsResult = await db.query(
            `SELECT oi.id, oi.variant_id, oi.quantity, oi.unit_price,
                    p.name AS product_name, pv.size_name AS size,
                    oi.design_notes, oi.design_files, oi.design_status,
                    oi.designer_notes, oi.revision_notes, oi.design_completed_at,
                    oi.client_design_status, oi.client_revision_notes, oi.client_approved_at,
                    oi.client_revision_files, oi.design_brief_files, oi.assigned_designer_id
             FROM order_items oi
             LEFT JOIN product_variants pv ON pv.id = oi.variant_id
             LEFT JOIN products p ON p.id = pv.product_id
             WHERE oi.order_id = $1 ${designerFilter}
             ORDER BY oi.id ASC`,
            itemsParams
        );

        // Auto-deduplicate design_files (fix for old data with appended duplicates)
        for (const item of itemsResult.rows) {
            if (item.design_files && Array.isArray(item.design_files) && item.design_files.length > 1) {
                const seen = new Set();
                const unique = item.design_files.filter(f => {
                    const key = f.original_name || f.path || f.filename || JSON.stringify(f);
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                if (unique.length < item.design_files.length) {
                    console.log(`[Designer] Deduplicating design_files for item ${item.id}: ${item.design_files.length} → ${unique.length}`);
                    await db.query(
                        `UPDATE order_items SET design_files = $1 WHERE id = $2`,
                        [JSON.stringify(unique), item.id]
                    );
                    item.design_files = unique;
                }
            }
        }

        // Get client pantone colors (if table exists)
        let pantoneColors = [];
        try {
            const pantoneResult = await db.query(
                `SELECT color_name, color_code, hex_value FROM client_pantone_colors WHERE client_id = $1`,
                [orderResult.rows[0].client_id]
            );
            pantoneColors = pantoneResult.rows;
        } catch { /* table might not exist — ignore */ }

        // Get client designs (if table exists)
        let clientDesigns = [];
        try {
            const designsResult = await db.query(
                `SELECT id, design_name, description FROM client_designs WHERE client_id = $1 AND is_active = true`,
                [orderResult.rows[0].client_id]
            );
            clientDesigns = designsResult.rows;
        } catch { /* table might not exist — ignore */ }

        // Get approval record if client approved
        let approvalData = null;
        // Also check partially_approved for approval data
        if (orderData.design_client_status === 'approved' || orderData.design_client_status === 'partially_approved') {
            try {
                const approvalRes = await db.query(
                    `SELECT signer_name, signature_image, approval_pdf_path,
                            client_ip, device_info, approved_at
                     FROM design_approvals WHERE order_id = $1`,
                    [orderId]
                );
                if (approvalRes.rows.length > 0) {
                    approvalData = approvalRes.rows[0];
                }
            } catch { /* table might not exist */ }
        }

        res.json({
            order: orderData,
            items: itemsResult.rows,
            pantone_colors: pantoneColors,
            client_designs: clientDesigns,
            approval: approvalData,
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
    const client = await db.getClient();
    try {
        const { orderId, itemId } = req.params;

        const hasAccess = await _checkDesignerAccess(orderId, req.user);
        if (!hasAccess) {
            return res.status(403).json({ error: 'غير مصرح لك' });
        }

        await client.query('BEGIN');
        await client.query(
            `UPDATE order_items SET design_status = 'in_progress' WHERE id = $1 AND order_id = $2`,
            [itemId, orderId]
        );

        // Recalculate order-level design_status from item statuses
        await _recalcOrderDesignStatus(client, orderId);
        await client.query('COMMIT');

        res.json({ success: true, message: 'تم بدء التصميم' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Designer] Start error:', err.message);
        res.status(500).json({ error: 'فشل في بدء التصميم' });
    } finally {
        client.release();
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

        // Get existing design files and current status
        const existingResult = await db.query(
            'SELECT design_files, design_status FROM order_items WHERE id = $1 AND order_id = $2',
            [itemId, orderId]
        );
        if (existingResult.rows.length === 0) {
            return res.status(404).json({ error: 'الصنف غير موجود' });
        }

        const currentStatus = existingResult.rows[0].design_status;
        const isResubmit = currentStatus === 'revision';

        const newFiles = (req.files || []).map(f => ({
            filename: f.filename,
            original_name: f.originalname,
            path: `/uploads/designs/${orderId}/items/${itemId}/${f.filename}`,
            size: f.size,
        }));

        // On resubmit (after revision): replace files entirely. On first submit: use new files only.
        const allFiles = isResubmit ? newFiles : [
            ...(Array.isArray(existingResult.rows[0].design_files) ? existingResult.rows[0].design_files : []),
            ...newFiles
        ];

        await client.query('BEGIN');

        await client.query(
            `UPDATE order_items SET
                design_status = 'completed',
                designer_notes = $1,
                design_files = $2,
                design_completed_at = NOW(),
                client_design_status = NULL,
                client_revision_notes = NULL,
                client_revision_files = NULL,
                client_approved_at = NULL
             WHERE id = $3 AND order_id = $4`,
            [designer_notes || null, JSON.stringify(allFiles), itemId, orderId]
        );

        // Recalculate order-level design_status from item statuses
        await _recalcOrderDesignStatus(client, orderId);

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
        const isAdmin = ['admin', 'super_admin', 'manager'].includes(req.user.role) ||
                        (req.user.permissions && req.user.permissions.all_access === true);

        if (isAdmin) {
            const result = await db.query(
                `SELECT o.id, o.order_number, o.design_status, o.design_completed_at,
                        c.name as client_name,
                        u.name as designer_name
                 FROM orders o
                 JOIN clients c ON c.id = o.client_id
                 LEFT JOIN users u ON u.id = o.assigned_designer_id
                 WHERE o.assigned_designer_id IS NOT NULL
                   AND o.design_status IN ('completed', 'in_review')
                 ORDER BY o.design_completed_at DESC NULLS LAST LIMIT 30`
            );
            return res.json({ tasks: result.rows });
        }

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

// =============================================================================
// CLIENT DESIGN REVIEW — Send to client + public view + client response
// =============================================================================

// ── POST /api/designer/send-to-client/:orderId ──────────────────────────────
// Manager: send approved designs to client via a secure share link.
// Generates a design_share_token, sets design_status = 'client_review'.
// Returns the share URL.
// =============================================================================
router.post('/send-to-client/:orderId', authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    const { orderId } = req.params;
    try {
        // Verify order exists and designs are ready
        const orderRes = await db.query(
            `SELECT id, order_number, status, design_status, client_id FROM orders WHERE id = $1`,
            [orderId]
        );
        if (orderRes.rows.length === 0) {
            return res.status(404).json({ error: 'العرض غير موجود' });
        }
        const order = orderRes.rows[0];

        // Allow sending at any point: in_progress (partial), in_review (all done), revision, or client_review (re-send)
        if (!['in_progress', 'in_review', 'revision', 'client_review'].includes(order.design_status)) {
            return res.status(400).json({
                error: 'لا يمكن إرسال التصاميم في الحالة الحالية: ' + (order.design_status || 'غير محدد')
            });
        }

        // Check that at least one item has design_files
        const itemsWithDesigns = await db.query(
            `SELECT COUNT(*) as count FROM order_items
             WHERE order_id = $1 AND design_files IS NOT NULL AND design_files != '[]'::jsonb`,
            [orderId]
        );
        if (parseInt(itemsWithDesigns.rows[0].count) === 0) {
            return res.status(400).json({ error: 'لا توجد تصاميم مرفوعة لعرضها على العميل' });
        }

        // Reuse existing token if already sent before (so link doesn't change)
        let plainToken, storedToken, tokenHash, shareUrl;
        const existingToken = await db.query(
            `SELECT design_share_token FROM orders WHERE id = $1`, [orderId]
        );

        if (existingToken.rows[0]?.design_share_token) {
            // Re-sending: decrypt the stored token to get plain token
            const storedTok = existingToken.rows[0].design_share_token;
            try {
                plainToken = decryptShareToken(storedTok);
            } catch {
                // If decryption fails, it might be stored as plain text (old data)
                plainToken = storedTok;
            }
            storedToken = storedTok; // keep same stored value
            try { tokenHash = hashToken(plainToken); } catch { tokenHash = crypto.createHmac('sha256', plainToken).digest('hex'); }
            shareUrl = `${req.protocol}://${req.get('host')}/public-design.html?token=${plainToken}`;
        } else {
            // New send: generate fresh token
            plainToken = crypto.randomBytes(32).toString('hex');
            storedToken = plainToken;
            try {
                storedToken = encryptToken(plainToken);
                tokenHash = hashToken(plainToken);
            } catch (cryptoErr) {
                console.error('[Designer] Crypto error:', cryptoErr.message);
                tokenHash = crypto.createHmac('sha256', plainToken).digest('hex');
                storedToken = plainToken;
            }
            shareUrl = `${req.protocol}://${req.get('host')}/public-design.html?token=${plainToken}`;
        }

        // 30-day expiry
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        // Check if there are still items WITHOUT design_files
        const noDesignCount = await db.query(
            `SELECT COUNT(*) as count FROM order_items
             WHERE order_id = $1
               AND (design_files IS NULL OR design_files = '[]'::jsonb)`,
            [orderId]
        );
        const hasUndesignedItems = parseInt(noDesignCount.rows[0].count) > 0;

        // Only set design_status to 'client_review' if ALL items have designs
        // Otherwise keep 'in_progress' so designer can still see and work on remaining items
        const newDesignStatus = hasUndesignedItems ? 'in_progress' : 'client_review';

        await db.query(
            `UPDATE orders SET
                design_share_token = $1,
                design_share_token_hash = $2,
                design_token_expires_at = $3,
                design_sent_to_client_at = NOW(),
                design_client_status = 'sent',
                design_status = $4
             WHERE id = $5`,
            [storedToken, tokenHash, expiresAt, newDesignStatus, orderId]
        );

        // Only reset client response on items that DON'T have design_files yet
        // (keep already-responded items intact so partial approvals persist)
        await db.query(
            `UPDATE order_items SET
                client_design_status = NULL,
                client_revision_notes = NULL,
                client_revision_files = NULL,
                client_approved_at = NULL
             WHERE order_id = $1
               AND (design_files IS NULL OR design_files = '[]'::jsonb)`,
            [orderId]
        );

        // Log activity: sent to client
        try {
            await db.query(
                `INSERT INTO design_activity_log (order_id, event_type, event_details, actor)
                 VALUES ($1, 'sent_to_client', $2, 'manager')`,
                [orderId, JSON.stringify({ share_url: shareUrl, expires_at: expiresAt })]
            );
        } catch (logErr) {
            console.error('[Designer] Activity log error:', logErr.message);
        }

        console.log(`[Designer] Sent to client — order ${order.order_number}, URL: ${shareUrl}`);

        res.json({
            success: true,
            message: 'تم إنشاء رابط مراجعة التصميم للعميل',
            share_url: shareUrl,
            expires_at: expiresAt,
        });
    } catch (err) {
        console.error('[Designer] Send-to-client error:', err.message);
        res.status(500).json({ error: 'فشل في إنشاء رابط المراجعة' });
    }
});

// ── GET /api/designer/client-view/:token ────────────────────────────────────
// Public (no auth): client views design files for all items in the order.
// =============================================================================
router.get('/client-view/:token', async (req, res) => {
    const { token } = req.params;
    try {
        // Lookup by hash first, then plaintext fallback
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

        // Check expiry
        if (order.design_token_expires_at && new Date(order.design_token_expires_at) < new Date()) {
            return res.status(410).json({ error: 'انتهت صلاحية هذا الرابط' });
        }

        // Get items with design files
        const itemsRes = await db.query(
            `SELECT oi.id, oi.variant_id, oi.quantity,
                    p.name AS product_name, pv.size_name,
                    oi.design_files, oi.designer_notes,
                    oi.client_design_status, oi.client_revision_notes
             FROM order_items oi
             LEFT JOIN product_variants pv ON pv.id = oi.variant_id
             LEFT JOIN products p ON p.id = pv.product_id
             WHERE oi.order_id = $1
             ORDER BY oi.id ASC`,
            [order.id]
        );

        // Filter out items with no design files
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
        console.error('[Designer] Client-view error:', err.message);
        res.status(500).json({ error: 'فشل في تحميل التصاميم' });
    }
});

// ── POST /api/designer/client-response/:token ───────────────────────────────
// Public (no auth): client submits approval or revision request per item.
// Body: { items: [{ item_id, action: 'approve'|'revision', notes? }] }
// =============================================================================
router.post('/client-response/:token', async (req, res) => {
    const { token } = req.params;
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'يجب تقديم رد لصنف واحد على الأقل' });
    }

    const client = await db.getClient();
    try {
        // Lookup order by token
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

        // Determine overall status
        if (revisionCount > 0) {
            // Client requested revisions → back to designer
            await client.query(
                `UPDATE orders SET design_client_status = 'revision_requested', design_status = 'revision'
                 WHERE id = $1`,
                [order.id]
            );
            // Set items with revision to design_status = 'revision' so designer sees them
            await client.query(
                `UPDATE order_items SET design_status = 'revision'
                 WHERE order_id = $1 AND client_design_status = 'revision_requested'`,
                [order.id]
            );
        } else if (approvedCount > 0 && revisionCount === 0) {
            // All submitted items approved
            // Check if ALL order items with design files are approved
            const pendingRes = await client.query(
                `SELECT COUNT(*) as count FROM order_items
                 WHERE order_id = $1
                   AND design_files IS NOT NULL AND design_files != '[]'::jsonb
                   AND client_design_status != 'approved'`,
                [order.id]
            );
            if (parseInt(pendingRes.rows[0].count) === 0) {
                // All approved → convert to production
                await client.query(
                    `UPDATE orders SET
                        design_client_status = 'approved',
                        design_status = 'completed',
                        design_completed_at = NOW(),
                        status = 'production'
                     WHERE id = $1`,
                    [order.id]
                );
                // Save approved designs to client_designs
                const allItemsRes = await client.query(
                    `SELECT oi.variant_id, oi.design_files, oi.order_id
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
                    // Get next design_number
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
                    // Insert files
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
                // Some items not yet responded
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
        console.error('[Designer] Client-response error:', err.message);
        res.status(500).json({ error: 'فشل في تسجيل رد العميل' });
    } finally {
        client.release();
    }
});

// ── GET /api/designer/approval/:orderId ─────────────────────────────────────
// Manager: fetch approval record (signature, PDF path, device info, IP).
// =============================================================================
router.get('/approval/:orderId', authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    const { orderId } = req.params;
    try {
        const result = await db.query(
            `SELECT da.*, c.name as client_name
             FROM design_approvals da
             LEFT JOIN clients c ON c.id = da.client_id
             WHERE da.order_id = $1`,
            [orderId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'لا يوجد سجل اعتماد لهذا الطلب' });
        }

        res.json({ success: true, approval: result.rows[0] });
    } catch (err) {
        console.error('[Designer] Approval fetch error:', err.message);
        res.status(500).json({ error: 'فشل في جلب سجل الاعتماد' });
    }
});

// ── GET /api/designer/activity-log/:orderId ──────────────────────────────────
// Manager: fetch activity timeline for an order.
// =============================================================================
router.get('/activity-log/:orderId', authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    const { orderId } = req.params;
    try {
        const result = await db.query(
            `SELECT event_type, event_details, actor, client_ip, user_agent, created_at
             FROM design_activity_log
             WHERE order_id = $1
             ORDER BY created_at ASC`,
            [orderId]
        );

        res.json({ success: true, activities: result.rows });
    } catch (err) {
        console.error('[Designer] Activity log fetch error:', err.message);
        res.status(500).json({ error: 'فشل في جلب سجل النشاط' });
    }
});

module.exports = router;
