'use strict';

const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const authenticate = require('../middleware/authMiddleware').authenticate;
const authorize = require('../middleware/authorize');

const router = express.Router();
const uploadRoot = path.join(__dirname, '../uploads/design-requests');
fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
        const requestId = req.params.id || req.body.request_id || 'temp';
        const dir = path.join(uploadRoot, requestId);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = /\.(jpg|jpeg|png|gif|webp|pdf|ai|psd|eps|svg|tif|tiff|doc|docx|xls|xlsx|mp3|wav|m4a|ogg|webm)$/i;
        cb(allowed.test(path.extname(file.originalname)) ? null : new Error('نوع الملف غير مدعوم'), allowed.test(path.extname(file.originalname)));
    },
});

function token() { return crypto.randomBytes(32).toString('hex'); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function fileData(file) {
    return file ? { path: `/uploads/design-requests/${path.basename(path.dirname(file.path))}/${file.filename}`, original_name: file.originalname, mime_type: file.mimetype, size: file.size } : null;
}
function publicRequest(row) {
    return { id: row.id, request_number: `DES-${String(row.request_number).padStart(5, '0')}`, item_name: row.item_name, item_size: row.item_size, brief: row.brief, status: row.status, client_name: row.client_name, designer_name: row.designer_name, created_at: row.created_at, started_at: row.started_at, approved_at: row.approved_at };
}
async function requestById(id) {
    const result = await db.query(`SELECT dr.*, c.name AS client_name, u.name AS designer_name FROM design_requests dr JOIN clients c ON c.id = dr.client_id JOIN users u ON u.id = dr.designer_id WHERE dr.id = $1`, [id]);
    return result.rows[0];
}
async function details(request, includeInternal) {
    const [messages, versions, revisions] = await Promise.all([
        db.query(`SELECT id, sender_type, sender_id, sender_name, message, attachment, is_internal, created_at FROM design_request_messages WHERE request_id = $1 ${includeInternal ? '' : 'AND is_internal = FALSE'} ORDER BY created_at`, [request.id]),
        db.query(`SELECT * FROM design_request_versions WHERE request_id = $1 ORDER BY version_number DESC`, [request.id]),
        db.query(`SELECT * FROM design_request_revisions WHERE request_id = $1 ORDER BY created_at DESC`, [request.id]),
    ]);
    return { request: publicRequest(request), messages: messages.rows, versions: versions.rows, revisions: revisions.rows };
}

// Management list and creation. Creation is deliberately separate from quotations.
router.get('/', authenticate, authorize(['admin', 'manager', 'super_admin']), async (_req, res) => {
    try {
        const result = await db.query(`SELECT dr.*, c.name AS client_name, u.name AS designer_name FROM design_requests dr JOIN clients c ON c.id = dr.client_id JOIN users u ON u.id = dr.designer_id ORDER BY dr.created_at DESC`);
        res.json({ requests: result.rows.map(publicRequest) });
    } catch (err) { console.error('[DesignRequests] list:', err.message); res.status(500).json({ error: 'فشل تحميل طلبات التصميم' }); }
});

router.post('/', authenticate, authorize(['admin', 'manager', 'super_admin']), upload.array('brief_files', 10), async (req, res) => {
    const { client_id, designer_id, item_name, item_size, brief } = req.body;
    if (!client_id || !designer_id || !item_name) return res.status(400).json({ error: 'العميل والمصمم واسم الصنف مطلوبة' });
    const client = await db.getClient();
    const clientToken = token();
    const designerToken = token();
    try {
        await client.query('BEGIN');
        const result = await client.query(`INSERT INTO design_requests (client_id, designer_id, item_name, item_size, brief, client_token_hash, designer_token_hash, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, request_number`, [client_id, designer_id, item_name.trim(), item_size || null, brief || null, hash(clientToken), hash(designerToken), req.user.id]);
        const requestId = result.rows[0].id;
        for (const file of req.files || []) await client.query(`INSERT INTO design_request_messages (request_id, sender_type, sender_id, sender_name, attachment) VALUES ($1,'manager',$2,$3,$4)`, [requestId, req.user.id, req.user.name || 'المدير', JSON.stringify(fileData(file))]);
        await client.query('COMMIT');
        res.status(201).json({ request: result.rows[0], client_token: clientToken, designer_token: designerToken });
    } catch (err) { await client.query('ROLLBACK'); console.error('[DesignRequests] create:', err.message); res.status(500).json({ error: 'فشل إنشاء طلب التصميم' }); } finally { client.release(); }
});

router.get('/:id([0-9a-fA-F-]{36})', authenticate, async (req, res) => {
    try { const request = await requestById(req.params.id); if (!request) return res.status(404).json({ error: 'طلب التصميم غير موجود' }); if (!['admin', 'manager', 'super_admin'].includes(req.user.role) && request.designer_id !== req.user.id) return res.status(403).json({ error: 'غير مصرح لك' }); res.json(await details(request, true)); } catch (err) { res.status(500).json({ error: 'فشل تحميل الطلب' }); }
});

router.put('/:id([0-9a-fA-F-]{36})/start', authenticate, async (req, res) => {
    try { const request = await requestById(req.params.id); if (!request || (req.user.role === 'designer' && request.designer_id !== req.user.id)) return res.status(403).json({ error: 'غير مصرح لك' }); if (!['waiting_design', 'revision_requested'].includes(request.status)) return res.status(400).json({ error: 'لا يمكن بدء التنفيذ من الحالة الحالية' }); const result = await db.query(`UPDATE design_requests SET status='in_progress', started_at=COALESCE(started_at,NOW()) WHERE id=$1 RETURNING *`, [req.params.id]); await db.query(`INSERT INTO design_request_messages (request_id,sender_type,sender_id,sender_name,message) VALUES ($1,'system',$2,$3,$4)`, [req.params.id, req.user.id, req.user.name || 'النظام', 'تم بدء تنفيذ التصميم']); res.json({ request: result.rows[0] }); } catch (err) { res.status(500).json({ error: 'فشل بدء التنفيذ' }); }
});

router.post('/:id([0-9a-fA-F-]{36})/message', authenticate, upload.single('attachment'), async (req, res) => {
    try { const request = await requestById(req.params.id); if (!request) return res.status(404).json({ error: 'الطلب غير موجود' }); const allowed = ['admin', 'manager', 'super_admin'].includes(req.user.role) || (req.user.role === 'designer' && request.designer_id === req.user.id); if (!allowed) return res.status(403).json({ error: 'غير مصرح لك' }); if (!req.body.message && !req.file) return res.status(400).json({ error: 'اكتب رسالة أو أرفق ملفًا' }); const senderType = ['admin', 'manager', 'super_admin'].includes(req.user.role) ? 'manager' : 'designer'; const result = await db.query(`INSERT INTO design_request_messages (request_id,sender_type,sender_id,sender_name,message,attachment,is_internal) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [req.params.id, senderType, req.user.id, req.user.name || senderType, req.body.message || null, req.file ? JSON.stringify(fileData(req.file)) : null, req.body.is_internal === 'true' && senderType === 'manager']); res.status(201).json({ message: result.rows[0] }); } catch (err) { res.status(500).json({ error: 'فشل إرسال الرسالة' }); }
});

router.post('/:id([0-9a-fA-F-]{36})/version', authenticate, upload.single('design_file'), async (req, res) => {
    try { const request = await requestById(req.params.id); if (!request || request.designer_id !== req.user.id) return res.status(403).json({ error: 'غير مصرح لك' }); if (!req.file) return res.status(400).json({ error: 'ملف التصميم مطلوب' }); const next = await db.query('SELECT COALESCE(MAX(version_number),0)+1 AS number FROM design_request_versions WHERE request_id=$1', [req.params.id]); const result = await db.query(`INSERT INTO design_request_versions (request_id,version_number,file,designer_notes,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.params.id, next.rows[0].number, JSON.stringify(fileData(req.file)), req.body.designer_notes || null, req.user.id]); await db.query(`UPDATE design_requests SET status='designer_review' WHERE id=$1`, [req.params.id]); res.status(201).json({ version: result.rows[0] }); } catch (err) { res.status(500).json({ error: 'فشل رفع إصدار التصميم' }); }
});

// Public customer token endpoints. The token grants access only to this request.
router.get('/:token', async (req, res) => {
    try { const result = await db.query(`SELECT dr.*, c.name AS client_name, u.name AS designer_name, (dr.designer_token_hash = $1) AS is_designer_link FROM design_requests dr JOIN clients c ON c.id=dr.client_id JOIN users u ON u.id=dr.designer_id WHERE dr.client_token_hash=$1 OR dr.designer_token_hash=$1`, [hash(req.params.token)]); if (!result.rows[0]) return res.status(404).json({ error: 'الرابط غير صالح' }); const response = await details(result.rows[0], result.rows[0].is_designer_link); response.viewer_role = result.rows[0].is_designer_link ? 'designer' : 'client'; res.json(response); } catch (err) { res.status(500).json({ error: 'فشل تحميل طلب التصميم' }); }
});

router.post('/:token/message', upload.single('attachment'), async (req, res) => {
    try { const result = await db.query(`SELECT *, (designer_token_hash = $1) AS is_designer_link FROM design_requests WHERE client_token_hash=$1 OR designer_token_hash=$1`, [hash(req.params.token)]); const request = result.rows[0]; if (!request) return res.status(404).json({ error: 'الرابط غير صالح' }); if (!req.body.message && !req.file) return res.status(400).json({ error: 'اكتب رسالة أو أرفق ملفًا' }); const senderType = request.is_designer_link ? 'designer' : 'client'; const senderName = request.is_designer_link ? 'المصمم' : 'العميل'; const inserted = await db.query(`INSERT INTO design_request_messages (request_id,sender_type,sender_name,message,attachment) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [request.id, senderType, senderName, req.body.message || null, req.file ? JSON.stringify(fileData(req.file)) : null]); res.status(201).json({ message: inserted.rows[0] }); } catch (err) { res.status(500).json({ error: 'فشل إرسال الرسالة' }); }
});

router.put('/:token/start', async (req, res) => {
    try { const result = await db.query(`UPDATE design_requests SET status='in_progress', started_at=COALESCE(started_at,NOW()) WHERE designer_token_hash=$1 AND status IN ('waiting_design','revision_requested') RETURNING *`, [hash(req.params.token)]); if (!result.rows[0]) return res.status(400).json({ error: 'لا يمكن بدء التنفيذ من الحالة الحالية أو الرابط غير صالح' }); await db.query(`INSERT INTO design_request_messages (request_id,sender_type,sender_name,message) VALUES ($1,'system','النظام','تم بدء تنفيذ التصميم')`, [result.rows[0].id]); res.json({ success: true }); } catch (err) { res.status(500).json({ error: 'فشل بدء التنفيذ' }); }
});

router.post('/:token/version', upload.single('design_file'), async (req, res) => {
    try { const request = (await db.query(`SELECT * FROM design_requests WHERE designer_token_hash=$1`, [hash(req.params.token)])).rows[0]; if (!request) return res.status(404).json({ error: 'الرابط غير صالح' }); if (!req.file) return res.status(400).json({ error: 'ملف التصميم مطلوب' }); const next = await db.query('SELECT COALESCE(MAX(version_number),0)+1 AS number FROM design_request_versions WHERE request_id=$1', [request.id]); const version = await db.query(`INSERT INTO design_request_versions (request_id,version_number,file,designer_notes) VALUES ($1,$2,$3,$4) RETURNING *`, [request.id, next.rows[0].number, JSON.stringify(fileData(req.file)), req.body.designer_notes || null]); await db.query(`UPDATE design_requests SET status='designer_review' WHERE id=$1`, [request.id]); res.status(201).json({ version: version.rows[0] }); } catch (err) { res.status(500).json({ error: 'فشل رفع التصميم' }); }
});

router.post('/:token/respond', async (req, res) => {
    const { action, notes } = req.body;
    if (!['approve', 'revision'].includes(action)) return res.status(400).json({ error: 'الإجراء غير صحيح' });
    try { const result = await db.query(`SELECT * FROM design_requests WHERE client_token_hash=$1`, [hash(req.params.token)]); const request = result.rows[0]; if (!request) return res.status(404).json({ error: 'الرابط غير صالح' }); if (action === 'revision') { await db.query(`UPDATE design_requests SET status='revision_requested' WHERE id=$1`, [request.id]); await db.query(`INSERT INTO design_request_revisions (request_id,notes) VALUES ($1,$2)`, [request.id, notes || 'طلب تعديل من العميل']); } else { const version = await db.query(`SELECT id FROM design_request_versions WHERE request_id=$1 ORDER BY version_number DESC LIMIT 1`, [request.id]); if (!version.rows[0]) return res.status(400).json({ error: 'لا يوجد إصدار يمكن اعتماده' }); await db.query(`UPDATE design_request_versions SET status='approved' WHERE id=$1`, [version.rows[0].id]); await db.query(`UPDATE design_request_versions SET status='superseded' WHERE request_id=$1 AND id<>$2 AND status<>'approved'`, [request.id, version.rows[0].id]); await db.query(`UPDATE design_requests SET status='approved', approved_version_id=$2, approved_at=NOW(), completed_at=NOW() WHERE id=$1`, [request.id, version.rows[0].id]); } res.json({ success: true }); } catch (err) { res.status(500).json({ error: 'فشل تسجيل الرد' }); }
});

module.exports = router;
