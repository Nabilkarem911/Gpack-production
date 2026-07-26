'use strict';

// =============================================================================
// G.PACK 2.0 — Designer Workflow Route (designer.js)
// Item-level design state machine with workflow validation + audit trail.
//
// State Machine:
//   waiting_design → in_progress → manager_review → client_review → approved
//                                         ↓                ↓
//                                   client_revision   client_revision
//                                         ↓
//                                    in_progress (rework)
//
// Source of truth: order_items.design_status
// Summary field:   orders.design_status (derived, for dashboard only)
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
// WORKFLOW DEFINITION — Design State Machine
// =============================================================================
const DESIGN_WORKFLOW = {
    waiting_design: {
        allowed: [
            { to: 'in_progress', roles: ['designer', 'admin', 'super_admin', 'manager'] },
        ],
    },
    in_progress: {
        allowed: [
            { to: 'manager_review', roles: ['designer', 'admin', 'super_admin', 'manager'], requires: 'files_or_notes' },
        ],
    },
    manager_review: {
        allowed: [
            { to: 'client_review', roles: ['admin', 'super_admin', 'manager'] },
            { to: 'client_revision', roles: ['admin', 'super_admin', 'manager'], requires: 'notes' },
        ],
    },
    client_review: {
        allowed: [
            { to: 'approved', roles: ['client', 'admin', 'super_admin', 'manager'] },
            { to: 'client_revision', roles: ['client', 'admin', 'super_admin', 'manager'], requires: 'notes' },
        ],
    },
    client_revision: {
        allowed: [
            { to: 'in_progress', roles: ['designer', 'admin', 'super_admin', 'manager'] },
        ],
    },
    approved: {
        allowed: [],
    },
};

// ── canTransition: validate state transition + role ──────────────────────────
function canTransition(fromState, toState, userRole) {
    const def = DESIGN_WORKFLOW[fromState];
    if (!def) return { ok: false, error: `حالة غير معروفة: ${fromState}` };
    const rule = def.allowed.find(a => a.to === toState);
    if (!rule) return { ok: false, error: `انتقال غير مسموح من ${fromState} إلى ${toState}` };
    if (!rule.roles.includes(userRole)) {
        return { ok: false, error: `دورك (${userRole}) غير مخول للانتقال من ${fromState} إلى ${toState}` };
    }
    return { ok: true, rule };
}

// ── _logTransition: write to workflow_history ───────────────────────────────
async function _logTransition(client, entityType, entityId, workflow, fromState, toState, actorId, actorRole, notes, metadata, transitionReason) {
    try {
        await client.query(
            `INSERT INTO workflow_history (entity_type, entity_id, workflow, from_state, to_state, actor_id, actor_role, notes, metadata, transition_reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [entityType, entityId, workflow, fromState || null, toState, actorId || null, actorRole || null, notes || null, JSON.stringify(metadata || {}), transitionReason || null]
        );
    } catch (err) {
        console.error('[Designer] Log transition error:', err.message);
    }
}

// =============================================================================
// File Upload Configuration
// =============================================================================
const UPLOAD_BASE = path.join(__dirname, '../uploads/designs');
if (!fs.existsSync(UPLOAD_BASE)) fs.mkdirSync(UPLOAD_BASE, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const orderId = req.params.orderId || req.body.order_id || 'unassigned';
        let itemId = req.params.itemId;
        if (!itemId) {
            const match = file.fieldname.match(/^item_files_(.+)$/);
            if (match) itemId = match[1];
        }
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
    limits: { fileSize: 200 * 1024 * 1024 },
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
    const orderResult = await db.query('SELECT assigned_designer_id FROM orders WHERE id = $1', [orderId]);
    if (orderResult.rows.length === 0) return false;
    if (orderResult.rows[0].assigned_designer_id === user.id) return true;
    const itemResult = await db.query(
        'SELECT 1 FROM order_items WHERE order_id = $1 AND assigned_designer_id = $2 LIMIT 1',
        [orderId, user.id]
    );
    return itemResult.rows.length > 0;
}

// =============================================================================
// Helper: recalculate order-level design_status from item-level statuses
// =============================================================================
async function _recalcOrderDesignStatus(client, orderId) {
    const counts = await client.query(
        `SELECT
            COUNT(*) FILTER (WHERE design_status = 'waiting_design') as waiting,
            COUNT(*) FILTER (WHERE design_status = 'in_progress') as in_progress,
            COUNT(*) FILTER (WHERE design_status = 'manager_review') as manager_review,
            COUNT(*) FILTER (WHERE design_status = 'client_review') as client_review,
            COUNT(*) FILTER (WHERE design_status = 'approved') as approved,
            COUNT(*) FILTER (WHERE design_status = 'client_revision') as client_revision,
            COUNT(*) as total
         FROM order_items WHERE order_id = $1`,
        [orderId]
    );
    const c = counts.rows[0];
    const waiting = parseInt(c.waiting);
    const inProgress = parseInt(c.in_progress);
    const mgrReview = parseInt(c.manager_review);
    const clientReview = parseInt(c.client_review);
    const approved = parseInt(c.approved);
    const clientRevision = parseInt(c.client_revision);
    const total = parseInt(c.total);

    let newStatus;
    if (approved === total) {
        newStatus = 'completed';
    } else if (clientRevision > 0) {
        newStatus = 'client_revision';
    } else if (clientReview > 0) {
        newStatus = 'client_review';
    } else if (waiting === 0 && inProgress === 0 && clientRevision === 0) {
        newStatus = 'manager_review';
    } else if (inProgress > 0 || mgrReview > 0 || approved > 0) {
        newStatus = 'in_progress';
    } else {
        newStatus = 'waiting_design';
    }

    await client.query('UPDATE orders SET design_status = $1 WHERE id = $2', [newStatus, orderId]);
    return newStatus;
}

// =============================================================================
// MANAGER ENDPOINTS
// =============================================================================

// ── POST /api/designer/assign ───────────────────────────────────────────────
router.post('/assign', authorize(['admin', 'manager', 'super_admin']), upload.any(), async (req, res) => {
    const client = await db.getClient();
    try {
        const { order_id, design_brief } = req.body;
        const itemAssignmentsRaw = req.body.item_assignments;
        let itemAssignments = [];
        try { itemAssignments = typeof itemAssignmentsRaw === 'string' ? JSON.parse(itemAssignmentsRaw) : (itemAssignmentsRaw || []); } catch { itemAssignments = []; }

        const legacyDesignerId = req.body.designer_id;
        if (itemAssignments.length === 0 && legacyDesignerId) {
            const itemsResult = await db.query('SELECT id FROM order_items WHERE order_id = $1', [order_id]);
            itemAssignments = itemsResult.rows.map(it => ({
                item_id: it.id,
                designer_id: legacyDesignerId,
                notes: null,
            }));
        }

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

        const orderCheck = await client.query('SELECT id, status FROM orders WHERE id = $1', [order_id]);
        if (orderCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'العرض غير موجود' });
        }
        if (orderCheck.rows[0].status !== 'quote') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'يمكن إرسال العروض بحالة "quote" فقط للمصمم' });
        }

        const designerIds = [...new Set(itemAssignments.map(ia => ia.designer_id))];
        for (const did of designerIds) {
            const designerCheck = await client.query('SELECT id, name FROM users WHERE id = $1 AND status = \'active\'', [did]);
            if (designerCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: `المصمم رقم ${did} غير موجود أو غير نشط` });
            }
        }

        const allFiles = req.files || [];
        const briefFiles = allFiles
            .filter(f => f.fieldname === 'design_brief_files')
            .map(f => ({
                filename: f.filename,
                original_name: f.originalname,
                path: `/uploads/designs/${order_id}/brief/${f.filename}`,
                size: f.size,
            }));

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

        const firstDesignerId = itemAssignments[0].designer_id;
        await client.query(
            `UPDATE orders SET
                design_status = 'waiting_design',
                assigned_designer_id = $1,
                design_brief = $2,
                design_brief_files = $3,
                design_sent_at = NOW()
             WHERE id = $4`,
            [firstDesignerId, design_brief || null, JSON.stringify(briefFiles), order_id]
        );

        await client.query(
            `UPDATE order_items SET design_status = 'waiting_design' WHERE order_id = $1`,
            [order_id]
        );

        for (const ia of itemAssignments) {
            if (!ia.item_id || !ia.designer_id) continue;

            const curItem = await client.query('SELECT design_status FROM order_items WHERE id = $1 AND order_id = $2', [ia.item_id, order_id]);
            const curStatus = curItem.rows.length > 0 ? curItem.rows[0].design_status : null;

            await client.query(
                `UPDATE order_items SET
                    assigned_designer_id = $1,
                    design_notes = COALESCE($2, design_notes)
                 WHERE id = $3 AND order_id = $4`,
                [ia.designer_id, ia.notes || null, ia.item_id, order_id]
            );

            if (itemFilesMap[ia.item_id]) {
                await client.query(
                    `UPDATE order_items SET design_brief_files = $1 WHERE id = $2 AND order_id = $3`,
                    [JSON.stringify(itemFilesMap[ia.item_id]), ia.item_id, order_id]
                );
            }

            await _logTransition(client, 'order_item', ia.item_id, 'design', curStatus, 'waiting_design',
                req.user.id, req.user.role, ia.notes || 'Assigned to designer', { designer_id: ia.designer_id }, 'designer_assigned');
        }

        await _recalcOrderDesignStatus(client, order_id);
        await client.query('COMMIT');

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
// Manager reviews a design item: approve (→ client_review) or request revision (→ client_revision).
router.put('/review/:orderId/item/:itemId', authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    const client = await db.getClient();
    try {
        const { orderId, itemId } = req.params;
        const { action, revision_notes } = req.body;

        if (!action || !['approve', 'revision'].includes(action)) {
            return res.status(400).json({ error: 'action يجب أن تكون approve أو revision' });
        }

        await client.query('BEGIN');

        const itemCheck = await client.query(
            'SELECT id, design_status FROM order_items WHERE id = $1 AND order_id = $2',
            [itemId, orderId]
        );
        if (itemCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'الصنف غير موجود' });
        }

        const curStatus = itemCheck.rows[0].design_status;
        const newStatus = action === 'approve' ? 'client_review' : 'client_revision';

        const transition = canTransition(curStatus, newStatus, req.user.role);
        if (!transition.ok) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: transition.error });
        }

        if (action === 'approve') {
            await client.query(
                `UPDATE order_items SET design_status = 'client_review' WHERE id = $1`,
                [itemId]
            );
            await _logTransition(client, 'order_item', itemId, 'design', curStatus, 'client_review',
                req.user.id, req.user.role, 'Manager approved — ready for client review', null, 'manager_approved');
        } else {
            if (!revision_notes) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'ملاحظات التعديل مطلوبة' });
            }
            await client.query(
                `UPDATE order_items SET design_status = 'client_revision', revision_notes = $1 WHERE id = $2`,
                [revision_notes, itemId]
            );
            await _logTransition(client, 'order_item', itemId, 'design', curStatus, 'client_revision',
                req.user.id, req.user.role, revision_notes, { action: 'revision' }, 'manager_rejected');
        }

        await _recalcOrderDesignStatus(client, orderId);
        await client.query('COMMIT');

        res.json({
            success: true,
            message: action === 'approve' ? 'تم اعتماد التصميم — جاهز لمراجعة العميل' : 'تم طلب تعديل على التصميم',
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
// Manager: get orders that have items in manager_review status.
router.get('/pending-review', authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    try {
        const result = await db.query(
            `SELECT o.id, o.order_number, o.design_status, o.design_sent_at, o.design_completed_at,
                    o.design_brief, o.design_brief_files,
                    c.name as client_name,
                    u.name as designer_name,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_status = 'manager_review') as manager_review_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_status = 'approved') as approved_count
             FROM orders o
             JOIN clients c ON c.id = o.client_id
             LEFT JOIN users u ON u.id = o.assigned_designer_id
             WHERE EXISTS (
                 SELECT 1 FROM order_items oi
                 WHERE oi.order_id = o.id AND oi.design_status = 'manager_review'
             )
             ORDER BY o.design_sent_at DESC NULLS LAST`,
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
// Designer: get orders that have items assigned to me.
// No order-level design_status filter — purely item-level counts.
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
                        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_status = 'waiting_design') as waiting_count,
                        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_status = 'in_progress') as in_progress_count,
                        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_status = 'manager_review') as manager_review_count,
                        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_status = 'client_review') as client_review_count,
                        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_status = 'approved') as approved_count,
                        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_status = 'client_revision') as client_revision_count,
                        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND design_files IS NOT NULL AND design_files != '[]'::jsonb) as designed_count
                 FROM orders o
                 JOIN clients c ON c.id = o.client_id
                 LEFT JOIN users u ON u.id = o.assigned_designer_id
                 WHERE o.status = 'quote'
                   AND EXISTS (
                       SELECT 1 FROM order_items oi
                       WHERE oi.order_id = o.id
                         AND oi.design_status IS NOT NULL
                         AND oi.design_status != 'approved'
                   )
                   ${filterClause}
                 ORDER BY o.design_sent_at DESC NULLS LAST`,
                params
            );
            return res.json({ tasks: result.rows });
        }

        const result = await db.query(
            `SELECT o.id, o.order_number, o.design_status, o.design_brief, o.design_brief_files,
                    o.design_sent_at, o.created_at,
                    c.name as client_name,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND assigned_designer_id = $1) as item_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND assigned_designer_id = $1 AND design_status = 'waiting_design') as waiting_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND assigned_designer_id = $1 AND design_status = 'in_progress') as in_progress_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND assigned_designer_id = $1 AND design_status = 'manager_review') as manager_review_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND assigned_designer_id = $1 AND design_status = 'client_review') as client_review_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND assigned_designer_id = $1 AND design_status = 'approved') as approved_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND assigned_designer_id = $1 AND design_status = 'client_revision') as client_revision_count,
                    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND assigned_designer_id = $1 AND design_files IS NOT NULL AND design_files != '[]'::jsonb) as designed_count
             FROM orders o
             JOIN clients c ON c.id = o.client_id
             WHERE EXISTS (
                 SELECT 1 FROM order_items oi
                 WHERE oi.order_id = o.id AND oi.assigned_designer_id = $1
                   AND oi.design_status IS NOT NULL
                   AND oi.design_status != 'approved'
             )
             ORDER BY o.design_sent_at DESC NULLS LAST`,
            [req.user.id]
        );
        res.json({ tasks: result.rows });
    } catch (err) {
        console.error('[Designer] My tasks error:', err.message);
        res.status(500).json({ error: 'فشل في تحميل المهام' });
    }
});

// ── GET /api/designer/task/:orderId ─────────────────────────────────────────
// Designer: get full details of an assigned order including items.
// Query param: ?status=waiting_design — filter items by design_status (context-aware modal)
router.get('/task/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const statusFilter = req.query.status || null;

        const hasAccess = await _checkDesignerAccess(orderId, req.user);
        if (!hasAccess) {
            return res.status(403).json({ error: 'غير مصرح لك بعرض هذا العرض' });
        }

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

        const orderData = orderResult.rows[0];
        if (orderData.design_share_token) {
            try {
                orderData.design_share_token = decryptShareToken(orderData.design_share_token);
            } catch { }
        }

        const isManager = ['admin', 'super_admin', 'manager'].includes(req.user.role);

        let statusCondition = '';
        const itemsParams = [orderId];
        let paramIdx = 2;

        if (!isManager) {
            statusCondition += `AND oi.assigned_designer_id = $${paramIdx++}`;
            itemsParams.push(req.user.id);
        }

        if (statusFilter) {
            statusCondition += ` AND oi.design_status = $${paramIdx++}`;
            itemsParams.push(statusFilter);
        }

        const itemsResult = await db.query(
            `SELECT oi.id, oi.variant_id, oi.quantity, oi.unit_price,
                    p.name AS product_name, pv.size_name AS size,
                    oi.design_notes, oi.design_files, oi.design_status,
                    oi.designer_notes, oi.revision_notes, oi.design_completed_at,
                    oi.client_design_status, oi.client_revision_notes, oi.client_approved_at,
                    oi.client_revision_files, oi.design_brief_files, oi.assigned_designer_id,
                    oi.review_token_hash, oi.review_token_expires_at, oi.review_sent_at,
                    oi.design_version
             FROM order_items oi
             LEFT JOIN product_variants pv ON pv.id = oi.variant_id
             LEFT JOIN products p ON p.id = pv.product_id
             WHERE oi.order_id = $1 ${statusCondition}
             ORDER BY oi.id ASC`,
            itemsParams
        );

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
                    await db.query(
                        `UPDATE order_items SET design_files = $1 WHERE id = $2`,
                        [JSON.stringify(unique), item.id]
                    );
                    item.design_files = unique;
                }
            }
        }

        let pantoneColors = [];
        try {
            const pantoneRes = await db.query(
                `SELECT cp.* FROM client_pantone_colors cp
                 WHERE cp.client_id = $1
                 ORDER BY cp.created_at DESC LIMIT 10`,
                [orderData.client_id]
            );
            pantoneColors = pantoneRes.rows;
        } catch { }

        let history = [];
        try {
            const itemIds = itemsResult.rows.map(i => i.id);
            if (itemIds.length > 0) {
                const historyRes = await db.query(
                    `SELECT wh.*, u.name as actor_name
                     FROM workflow_history wh
                     LEFT JOIN users u ON u.id = wh.actor_id
                     WHERE wh.entity_type = 'order_item' AND wh.entity_id = ANY($1::uuid[])
                     ORDER BY wh.changed_at ASC`,
                    [itemIds]
                );
                history = historyRes.rows;
            }
        } catch { }

        res.json({
            order: orderData,
            items: itemsResult.rows,
            pantone_colors: pantoneColors,
            workflow_history: history,
        });
    } catch (err) {
        console.error('[Designer] Task detail error:', err.message);
        res.status(500).json({ error: 'فشل في تحميل تفاصيل العرض' });
    }
});

// ── PUT /api/designer/item/:orderId/:itemId/start ───────────────────────────
router.put('/item/:orderId/:itemId/start', async (req, res) => {
    const client = await db.getClient();
    try {
        const { orderId, itemId } = req.params;

        const hasAccess = await _checkDesignerAccess(orderId, req.user);
        if (!hasAccess) {
            return res.status(403).json({ error: 'غير مصرح لك' });
        }

        await client.query('BEGIN');

        const itemRes = await client.query(
            'SELECT design_status FROM order_items WHERE id = $1 AND order_id = $2',
            [itemId, orderId]
        );
        if (itemRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'الصنف غير موجود' });
        }

        const curStatus = itemRes.rows[0].design_status;
        const transition = canTransition(curStatus, 'in_progress', req.user.role);
        if (!transition.ok) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: transition.error });
        }

        await client.query(
            `UPDATE order_items SET design_status = 'in_progress' WHERE id = $1 AND order_id = $2`,
            [itemId, orderId]
        );

        const startReason = curStatus === 'client_revision' ? 'rework_started' : 'designer_started';
        await _logTransition(client, 'order_item', itemId, 'design', curStatus, 'in_progress',
            req.user.id, req.user.role, 'Designer started work', null, startReason);

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
router.put('/item/:orderId/:itemId/submit', upload.array('design_files', 10), async (req, res) => {
    const client = await db.getClient();
    try {
        const { orderId, itemId } = req.params;
        const { designer_notes } = req.body;

        const hasAccess = await _checkDesignerAccess(orderId, req.user);
        if (!hasAccess) {
            return res.status(403).json({ error: 'غير مصرح لك' });
        }

        const existingResult = await db.query(
            'SELECT design_files, design_status, design_version FROM order_items WHERE id = $1 AND order_id = $2',
            [itemId, orderId]
        );
        if (existingResult.rows.length === 0) {
            return res.status(404).json({ error: 'الصنف غير موجود' });
        }

        const curStatus = existingResult.rows[0].design_status;
        const transition = canTransition(curStatus, 'manager_review', req.user.role);
        if (!transition.ok) {
            return res.status(400).json({ error: transition.error });
        }

        const newFiles = (req.files || []).map(f => ({
            filename: f.filename,
            original_name: f.originalname,
            path: `/uploads/designs/${orderId}/items/${itemId}/${f.filename}`,
            size: f.size,
        }));

        const isResubmit = curStatus === 'client_revision';
        const designVersion = isResubmit ? (parseInt(existingResult.rows[0].design_version) || 0) + 1 : (parseInt(existingResult.rows[0].design_version) || 0);
        const allFiles = isResubmit ? newFiles : [
            ...(Array.isArray(existingResult.rows[0].design_files) ? existingResult.rows[0].design_files : []),
            ...newFiles
        ];

        if (allFiles.length === 0 && !designer_notes) {
            return res.status(400).json({ error: 'يجب رفع ملف أو كتابة ملاحظات على الأقل' });
        }

        await client.query('BEGIN');

        await client.query(
            `UPDATE order_items SET
                design_status = 'manager_review',
                designer_notes = $1,
                design_files = $2,
                design_completed_at = NOW(),
                design_version = $3,
                client_design_status = NULL,
                client_revision_notes = NULL,
                client_revision_files = NULL,
                client_approved_at = NULL
             WHERE id = $4 AND order_id = $5`,
            [designer_notes || null, JSON.stringify(allFiles), designVersion, itemId, orderId]
        );

        await _logTransition(client, 'order_item', itemId, 'design', curStatus, 'manager_review',
            req.user.id, req.user.role, designer_notes || 'Designer submitted design',
            { files_count: newFiles.length, design_version: designVersion },
            isResubmit ? 'designer_resubmitted' : 'designer_submitted');

        await _recalcOrderDesignStatus(client, orderId);
        await client.query('COMMIT');

        res.json({
            success: true,
            message: 'تم تسليم التصميم — في انتظار مراجعة المدير',
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
                   AND o.design_status = 'completed'
                 ORDER BY o.design_completed_at DESC NULLS LAST LIMIT 30`
            );
            return res.json({ tasks: result.rows });
        }

        const result = await db.query(
            `SELECT o.id, o.order_number, o.design_status, o.design_completed_at,
                    c.name as client_name
             FROM orders o
             JOIN clients c ON c.id = o.client_id
             WHERE EXISTS (
                 SELECT 1 FROM order_items oi
                 WHERE oi.order_id = o.id AND oi.assigned_designer_id = $1
                   AND oi.design_status = 'approved'
             )
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
// ITEM-LEVEL CLIENT REVIEW
// =============================================================================

// ── POST /api/designer/item/:orderId/:itemId/send-to-client ─────────────────
router.post('/item/:orderId/:itemId/send-to-client', authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    const client = await db.getClient();
    try {
        const { orderId, itemId } = req.params;

        await client.query('BEGIN');

        const itemRes = await client.query(
            `SELECT oi.id, oi.design_status, oi.design_files, o.order_number, c.name as client_name
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN clients c ON c.id = o.client_id
             WHERE oi.id = $1 AND oi.order_id = $2`,
            [itemId, orderId]
        );
        if (itemRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'الصنف غير موجود' });
        }

        const item = itemRes.rows[0];
        const curStatus = item.design_status;
        const transition = canTransition(curStatus, 'client_review', req.user.role);
        if (!transition.ok) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: transition.error });
        }

        const hasFiles = item.design_files && Array.isArray(item.design_files) && item.design_files.length > 0;
        if (!hasFiles) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'لا يوجد تصميم مرفوع لهذا الصنف' });
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        let tokenHash;
        try {
            tokenHash = hashToken(rawToken);
        } catch {
            tokenHash = crypto.createHmac('sha256', rawToken).digest('hex');
        }

        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await client.query(
            `UPDATE order_items SET
                design_status = 'client_review',
                review_token_hash = $1,
                review_token_expires_at = $2,
                review_sent_at = NOW(),
                client_design_status = 'sent'
             WHERE id = $3 AND order_id = $4`,
            [tokenHash, expiresAt, itemId, orderId]
        );

        await _logTransition(client, 'order_item', itemId, 'design', curStatus, 'client_review',
            req.user.id, req.user.role, 'Sent to client for review',
            { order_number: item.order_number, expires_at: expiresAt }, 'sent_to_client');

        await _recalcOrderDesignStatus(client, orderId);
        await client.query('COMMIT');

        const shareUrl = `${req.protocol}://${req.get('host')}/design-review/${rawToken}`;

        try {
            await db.query(
                `INSERT INTO design_activity_log (order_id, event_type, event_details, actor)
                 VALUES ($1, 'item_sent_to_client', $2, 'manager')`,
                [orderId, JSON.stringify({ item_id: itemId, share_url: shareUrl, expires_at: expiresAt })]
            );
        } catch { }

        res.json({
            success: true,
            message: 'تم إنشاء رابط مراجعة التصميم للعميل',
            share_url: shareUrl,
            expires_at: expiresAt,
            item_id: itemId,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Designer] Item send-to-client error:', err.message);
        res.status(500).json({ error: 'فشل في إنشاء رابط المراجعة' });
    } finally {
        client.release();
    }
});

// ── GET /api/designer/item/:orderId/:itemId/review-link ─────────────────────
// Returns the current review link status for an item (without exposing the raw token).
router.get('/item/:orderId/:itemId/review-link', authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    try {
        const { orderId, itemId } = req.params;
        const result = await db.query(
            `SELECT design_status, review_token_hash, review_token_expires_at, review_sent_at
             FROM order_items WHERE id = $1 AND order_id = $2`,
            [itemId, orderId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'الصنف غير موجود' });
        }
        const item = result.rows[0];
        const hasToken = !!item.review_token_hash;
        const isExpired = item.review_token_expires_at && new Date(item.review_token_expires_at) < new Date();
        res.json({
            has_token: hasToken,
            is_expired: isExpired,
            review_sent_at: item.review_sent_at,
            expires_at: item.review_token_expires_at,
            design_status: item.design_status,
        });
    } catch (err) {
        console.error('[Designer] Review link info error:', err.message);
        res.status(500).json({ error: 'فشل في جلب معلومات الرابط' });
    }
});

// ── POST /api/designer/item/:orderId/:itemId/resend-review ──────────────────
// Resend review link: if token still valid, regenerate URL from existing hash is impossible
// (we only store hash, not plaintext). So we always generate a new token + hash.
// Old token is invalidated by overwriting review_token_hash.
router.post('/item/:orderId/:itemId/resend-review', authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    const client = await db.getClient();
    try {
        const { orderId, itemId } = req.params;

        await client.query('BEGIN');

        const itemRes = await client.query(
            `SELECT id, design_status, review_token_expires_at
             FROM order_items WHERE id = $1 AND order_id = $2`,
            [itemId, orderId]
        );
        if (itemRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'الصنف غير موجود' });
        }

        const item = itemRes.rows[0];
        if (!['client_review', 'manager_review'].includes(item.design_status)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'لا يمكن إرسال رابط مراجعة في هذه الحالة' });
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        let tokenHash;
        try {
            tokenHash = hashToken(rawToken);
        } catch {
            tokenHash = crypto.createHmac('sha256', rawToken).digest('hex');
        }

        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await client.query(
            `UPDATE order_items SET
                review_token_hash = $1,
                review_token_expires_at = $2,
                review_sent_at = NOW(),
                design_status = 'client_review',
                client_design_status = 'sent'
             WHERE id = $3 AND order_id = $4`,
            [tokenHash, expiresAt, itemId, orderId]
        );

        await _logTransition(client, 'order_item', itemId, 'design', item.design_status, 'client_review',
            req.user.id, req.user.role, 'Resent review link to client',
            { expires_at: expiresAt, previous_status: item.design_status }, 'sent_to_client');

        await _recalcOrderDesignStatus(client, orderId);
        await client.query('COMMIT');

        const shareUrl = `${req.protocol}://${req.get('host')}/design-review/${rawToken}`;

        res.json({
            success: true,
            message: 'تم إعادة إرسال رابط المراجعة للعميل',
            share_url: shareUrl,
            expires_at: expiresAt,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Designer] Resend review error:', err.message);
        res.status(500).json({ error: 'فشل في إعادة إرسال الرابط' });
    } finally {
        client.release();
    }
});

// ── GET /api/designer/item-history/:itemId ──────────────────────────────────
router.get('/item-history/:itemId', async (req, res) => {
    try {
        const { itemId } = req.params;
        const result = await db.query(
            `SELECT wh.*, u.name as actor_name
             FROM workflow_history wh
             LEFT JOIN users u ON u.id = wh.actor_id
             WHERE wh.entity_type = 'order_item' AND wh.entity_id = $1
             ORDER BY wh.changed_at ASC`,
            [itemId]
        );
        res.json({ success: true, history: result.rows });
    } catch (err) {
        console.error('[Designer] Item history error:', err.message);
        res.status(500).json({ error: 'فشل في تحميل سجل الحالة' });
    }
});

// =============================================================================
// LEGACY ORDER-LEVEL CLIENT REVIEW (backward compat)
// =============================================================================

// ── POST /api/designer/send-to-client/:orderId ──────────────────────────────
router.post('/send-to-client/:orderId', authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    const { orderId } = req.params;
    try {
        const orderRes = await db.query(
            `SELECT id, order_number, status, design_status, client_id FROM orders WHERE id = $1`,
            [orderId]
        );
        if (orderRes.rows.length === 0) {
            return res.status(404).json({ error: 'العرض غير موجود' });
        }
        const order = orderRes.rows[0];

        if (!['in_progress', 'manager_review', 'client_revision', 'client_review'].includes(order.design_status)) {
            return res.status(400).json({
                error: 'لا يمكن إرسال التصاميم في الحالة الحالية: ' + (order.design_status || 'غير محدد')
            });
        }

        const itemsWithDesigns = await db.query(
            `SELECT COUNT(*) as count FROM order_items
             WHERE order_id = $1 AND design_files IS NOT NULL AND design_files != '[]'::jsonb`,
            [orderId]
        );
        if (parseInt(itemsWithDesigns.rows[0].count) === 0) {
            return res.status(400).json({ error: 'لا توجد تصاميم مرفوعة لعرضها على العميل' });
        }

        let plainToken, storedToken, tokenHash, shareUrl;
        const existingToken = await db.query(
            `SELECT design_share_token FROM orders WHERE id = $1`, [orderId]
        );

        if (existingToken.rows[0]?.design_share_token) {
            const storedTok = existingToken.rows[0].design_share_token;
            try {
                plainToken = decryptShareToken(storedTok);
            } catch {
                plainToken = storedTok;
            }
            storedToken = storedTok;
            try { tokenHash = hashToken(plainToken); } catch { tokenHash = crypto.createHmac('sha256', plainToken).digest('hex'); }
            shareUrl = `${req.protocol}://${req.get('host')}/public-design.html?token=${plainToken}`;
        } else {
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

        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        const noDesignCount = await db.query(
            `SELECT COUNT(*) as count FROM order_items
             WHERE order_id = $1
               AND (design_files IS NULL OR design_files = '[]'::jsonb)`,
            [orderId]
        );
        const hasUndesignedItems = parseInt(noDesignCount.rows[0].count) > 0;
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

        try {
            await db.query(
                `INSERT INTO design_activity_log (order_id, event_type, event_details, actor)
                 VALUES ($1, 'sent_to_client', $2, 'manager')`,
                [orderId, JSON.stringify({ share_url: shareUrl, expires_at: expiresAt })]
            );
        } catch { }

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
router.get('/client-view/:token', async (req, res) => {
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
        } catch { }

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
router.post('/client-response/:token', async (req, res) => {
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
        } catch { }

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

            const itemCheck = await client.query(
                'SELECT design_status FROM order_items WHERE id = $1 AND order_id = $2',
                [item.item_id, order.id]
            );
            if (itemCheck.rows.length === 0) continue;
            const curStatus = itemCheck.rows[0].design_status;

            if (item.action === 'approve') {
                const transition = canTransition(curStatus, 'approved', 'client');
                if (!transition.ok) continue;

                await client.query(
                    `UPDATE order_items
                     SET client_design_status = 'approved', client_approved_at = NOW(),
                         design_status = 'approved'
                     WHERE id = $1 AND order_id = $2`,
                    [item.item_id, order.id]
                );
                await _logTransition(client, 'order_item', item.item_id, 'design', curStatus, 'approved',
                    null, 'client', 'Client approved design', null, 'client_approved');
                approvedCount++;
            } else if (item.action === 'revision') {
                const transition = canTransition(curStatus, 'client_revision', 'client');
                if (!transition.ok) continue;

                await client.query(
                    `UPDATE order_items
                     SET client_design_status = 'revision_requested',
                         client_revision_notes = $1,
                         design_status = 'client_revision'
                     WHERE id = $2 AND order_id = $3`,
                    [item.notes || null, item.item_id, order.id]
                );
                await _logTransition(client, 'order_item', item.item_id, 'design', curStatus, 'client_revision',
                    null, 'client', item.notes || 'Client requested revision', null, 'client_requested_change');
                revisionCount++;
            }
        }

        await _recalcOrderDesignStatus(client, order.id);

        if (revisionCount === 0 && approvedCount > 0) {
            const pendingRes = await client.query(
                `SELECT COUNT(*) as count FROM order_items
                 WHERE order_id = $1 AND design_status != 'approved'`,
                [order.id]
            );
            if (parseInt(pendingRes.rows[0].count) === 0) {
                await client.query(
                    `UPDATE orders SET
                        design_client_status = 'approved',
                        design_status = 'completed',
                        design_completed_at = NOW()
                     WHERE id = $1`,
                    [order.id]
                );

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
