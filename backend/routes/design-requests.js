'use strict';

const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const authenticate = require('../middleware/authMiddleware').authenticate;
const authorize = require('../middleware/authorize');
const { encryptToken, decryptShareToken } = require('../utils/crypto');

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
        const allowedExtensions = /\.(jpg|jpeg|jpe|png|gif|webp|avif|jfif|heic|heif|pdf|ai|psd|eps|svg|cdr|ind|indd|idml|fig|sketch|xd|tif|tiff|dwg|dxf|zip|rar|7z|doc|docx|xls|xlsx|ppt|pptx|mp3|wav|m4a|ogg|webm)$/i;
        const allowedMimeTypes = /^(image\/(jpeg|png|gif|webp|avif|heic|heif|tiff|bmp)|application\/pdf|audio\/(mpeg|wav|mp4|x-m4a|ogg|webm)|application\/msword|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|application\/vnd\.ms-excel)$/i;
        if (allowedExtensions.test(path.extname(file.originalname)) || allowedMimeTypes.test(file.mimetype || '')) return cb(null, true);
        return cb(new Error('نوع الملف غير مدعوم. ارفع صورة أو PDF أو ملف تصميم أو تسجيل صوتي.'), false);
    },
});

function safeUpload(middleware) {
    return (req, res, next) => middleware(req, res, err => {
        if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'حجم الملف يتجاوز 50 ميجابايت' : err.message || 'فشل رفع الملف' });
        next();
    });
}

function token() { return crypto.randomBytes(32).toString('hex'); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function fileData(file) {
    return file ? { path: `/uploads/design-requests/${path.basename(path.dirname(file.path))}/${file.filename}`, original_name: file.originalname, mime_type: file.mimetype, size: file.size } : null;
}
function moveToRequestFolder(file, requestId) {
    if (!file) return null;
    const targetDir = path.join(uploadRoot, requestId);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, file.filename);
    if (file.path !== targetPath) fs.renameSync(file.path, targetPath);
    file.path = targetPath;
    return fileData(file);
}
function publicRequest(row) {
    return { id: row.id, request_number: `DES-${String(row.request_number).padStart(5, '0')}`, item_name: row.item_name, item_size: row.item_size, brief: row.brief, status: row.status, client_name: row.client_name, designer_name: row.designer_name, created_at: row.created_at, started_at: row.started_at, approved_at: row.approved_at, is_converted: !!row.converted_quotation_id };
}
function copyDesignFile(file, requestId, designId) {
    if (!file || !file.path) throw new Error('ملف التصميم غير متوفر');
    const filename = path.basename(file.path);
    const sourcePath = path.join(__dirname, '..', 'uploads', 'design-requests', requestId, filename);
    if (!fs.existsSync(sourcePath)) throw new Error('ملف التصميم المعتمد غير موجود على القرص');
    const targetDir = path.join(__dirname, '..', 'uploads', 'client-designs', designId);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, filename);
    fs.copyFileSync(sourcePath, targetPath);
    return { ...file, path: `/uploads/client-designs/${designId}/${filename}` };
}
function shareLinks(row) {
    const clientToken = decryptShareToken(row.client_token_encrypted);
    const designerToken = decryptShareToken(row.designer_token_encrypted);
    return clientToken && designerToken ? { client: `/views/public-design-request.html?token=${clientToken}&v=20260901-7`, designer: `/views/public-design-request.html?token=${designerToken}&v=20260901-7` } : null;
}
async function ensureShareTokens(row) {
    if (row.client_token_encrypted && row.designer_token_encrypted) return row;
    const clientToken = token();
    const designerToken = token();
    await db.query(`UPDATE design_requests SET client_token_hash=$1, designer_token_hash=$2, client_token_encrypted=$3, designer_token_encrypted=$4 WHERE id=$5`, [hash(clientToken), hash(designerToken), encryptToken(clientToken), encryptToken(designerToken), row.id]);
    row.client_token_encrypted = encryptToken(clientToken);
    row.designer_token_encrypted = encryptToken(designerToken);
    return row;
}
async function requestById(id) {
    const result = await db.query(`SELECT dr.*, c.name AS client_name, u.name AS designer_name FROM design_requests dr JOIN clients c ON c.id = dr.client_id JOIN users u ON u.id = dr.designer_id WHERE dr.id = $1`, [id]);
    return result.rows[0];
}
async function details(request, includeInternal) {
    const [messages, versions, revisions, items] = await Promise.all([
        db.query(`SELECT id, sender_type, sender_id, sender_name, message, attachment, is_internal, created_at FROM design_request_messages WHERE request_id = $1 ${includeInternal ? '' : 'AND is_internal = FALSE'} ORDER BY created_at`, [request.id]),
        db.query(`SELECT * FROM design_request_versions WHERE request_id = $1 ORDER BY item_id NULLS LAST, version_number DESC`, [request.id]),
        db.query(`SELECT * FROM design_request_revisions WHERE request_id = $1 ORDER BY created_at DESC`, [request.id]),
        db.query(`SELECT id, variant_id, product_name, size_name, notes, attachments, sort_order, status, current_version_id, approved_version_id, approved_at FROM design_request_items WHERE request_id = $1 ORDER BY sort_order`, [request.id]),
    ]);
    const itemRows = items.rows.map(item => ({ ...item, versions: versions.rows.filter(version => String(version.item_id) === String(item.id)), revisions: revisions.rows.filter(revision => String(revision.item_id) === String(item.id)) }));
    return { request: publicRequest(request), messages: messages.rows, versions: versions.rows, revisions: revisions.rows, items: itemRows };
}

async function getOrCreateSingleItem(tx, request) {
    const items = await tx.query(`SELECT id, current_version_id, status FROM design_request_items WHERE request_id=$1 FOR UPDATE`, [request.id]);
    if (items.rows.length === 1) return items.rows[0];
    if (items.rows.length > 1) throw new Error('الطلب يحتوي على أكثر من صنف؛ يجب اختيار الصنف');
    const inserted = await tx.query(`INSERT INTO design_request_items (request_id, variant_id, product_name, size_name, notes, attachments, sort_order, status) VALUES ($1, NULL, $2, $3, $4, $5, 0, 'waiting_design') RETURNING id`, [request.id, request.item_name || 'صنف', request.item_size || null, request.brief || null, JSON.stringify([])]);
    return inserted.rows[0];
}

async function recalcRequestStatus(client, requestId) {
    const result = await client.query(`SELECT status, COUNT(*)::int AS count FROM design_request_items WHERE request_id=$1 GROUP BY status`, [requestId]);
    const counts = Object.fromEntries(result.rows.map(row => [row.status, row.count]));
    const total = result.rows.reduce((sum, row) => sum + row.count, 0);
    const waiting = counts.waiting_design || 0;
    const active = counts.in_progress || 0;
    const reviews = counts.client_review || 0;
    const revisions = counts.revision_requested || 0;
    const approved = counts.approved || 0;
    let next = 'waiting_design';
    if (total === 0) {
        next = 'waiting_design';
    } else if (approved === total) {
        next = 'approved';
    } else if (revisions > 0) {
        next = 'revision_requested';
    } else if (active > 0 || waiting > 0) {
        next = 'in_progress';
    } else if (reviews > 0) {
        next = 'client_review';
    }
    await client.query('UPDATE design_requests SET status=$1::varchar, approved_at=CASE WHEN $1::varchar = \'approved\' THEN COALESCE(approved_at,NOW()) ELSE NULL END WHERE id=$2', [next, requestId]);
    return next;
}

// Independent requests assigned to the logged-in designer.
router.get('/designer/my-requests', authenticate, async (req, res) => {
    try {
        const manager = ['admin', 'manager', 'super_admin'].includes(req.user.role);
        const result = await db.query(`SELECT dr.*, c.name AS client_name, u.name AS designer_name FROM design_requests dr JOIN clients c ON c.id=dr.client_id JOIN users u ON u.id=dr.designer_id WHERE $1 OR dr.designer_id=$2 ORDER BY dr.updated_at DESC`, [manager, req.user.id]);
        for (const row of result.rows) await ensureShareTokens(row);
        res.json({ requests: result.rows.map(row => ({ ...publicRequest(row), designer_link: shareLinks(row)?.designer || null })) });
    } catch (err) { res.status(500).json({ error: 'فشل تحميل طلبات التصميم المستقلة' }); }
});

// Management list and creation. Creation is deliberately separate from quotations.
router.get('/', authenticate, authorize(['admin', 'manager', 'super_admin', 'designer']), async (req, res) => {
    try {
        const isDesigner = req.user.role === 'designer';
        const result = await db.query(`SELECT dr.*, c.name AS client_name, u.name AS designer_name FROM design_requests dr JOIN clients c ON c.id = dr.client_id JOIN users u ON u.id = dr.designer_id ${isDesigner ? 'WHERE dr.designer_id = $1' : ''} ORDER BY dr.created_at DESC`, isDesigner ? [req.user.id] : []);
        if (!isDesigner) for (const row of result.rows) await ensureShareTokens(row);
        res.json({ requests: result.rows.map(row => ({ ...publicRequest(row), ...(isDesigner ? {} : { share_links: shareLinks(row) }) })) });
    } catch (err) { console.error('[DesignRequests] list:', err.message); res.status(500).json({ error: 'فشل تحميل طلبات التصميم' }); }
});

router.post('/', authenticate, authorize(['admin', 'manager', 'super_admin']), safeUpload(upload.any()), async (req, res) => {
    const { client_id, designer_id, item_name, item_size, brief } = req.body;
    let requestedItems = req.body.items;
    if (typeof requestedItems === 'string') { try { requestedItems = JSON.parse(requestedItems); } catch { requestedItems = []; } }
    if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
        if (item_name) requestedItems = [{ variant_id: null, product_name: item_name.trim(), size_name: item_size || null }];
        else requestedItems = [];
    }
    if (!client_id || !designer_id || requestedItems.length === 0) return res.status(400).json({ error: 'العميل والمصمم وصنف واحد على الأقل مطلوبة' });
    if (requestedItems.length > 1) return res.status(400).json({ error: 'كل طلب تصميم يخص صنفًا واحدًا' });
    if (requestedItems.some(item => !item.variant_id && !item.product_name)) return res.status(400).json({ error: 'يجب اختيار صنف أو كتابة اسم التصميم' });
    const client = await db.getClient();
    const clientToken = token();
    const designerToken = token();
    try {
        await client.query('BEGIN');
        const result = await client.query(`INSERT INTO design_requests (client_id, designer_id, item_name, item_size, brief, client_token_hash, designer_token_hash, client_token_encrypted, designer_token_encrypted, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, request_number`, [client_id, designer_id, requestedItems.map(item => item.product_name).join('، '), requestedItems.map(item => item.size_name).filter(Boolean).join('، ') || null, brief || null, hash(clientToken), hash(designerToken), encryptToken(clientToken), encryptToken(designerToken), req.user.id]);
        const requestId = result.rows[0].id;
        for (let index = 0; index < requestedItems.length; index++) {
            const item = requestedItems[index];
            let variantId = item.variant_id || null;
            let productName = item.product_name;
            let sizeName = item.size_name || null;
            if (item.variant_id) {
                const variant = await client.query(`SELECT pv.id, pv.size_name, p.name AS product_name FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE pv.id = $1 AND pv.status = 'active'`, [item.variant_id]);
                if (!variant.rows[0]) throw new Error('أحد الأصناف المختارة غير موجود أو غير نشط');
                variantId = variant.rows[0].id;
                productName = variant.rows[0].product_name;
                sizeName = variant.rows[0].size_name;
            }
            const itemFiles = (req.files || []).filter(file => file.fieldname === `item_files_${index}`).map(file => moveToRequestFolder(file, requestId));
            await client.query(`INSERT INTO design_request_items (request_id, variant_id, product_name, size_name, notes, attachments, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [requestId, variantId, productName, sizeName, item.notes || null, JSON.stringify(itemFiles), index]);
        }
        for (const file of (req.files || []).filter(file => file.fieldname === 'brief_files')) await client.query(`INSERT INTO design_request_messages (request_id, sender_type, sender_id, sender_name, attachment) VALUES ($1,'manager',$2,$3,$4)`, [requestId, req.user.id, req.user.name || 'المدير', JSON.stringify(moveToRequestFolder(file, requestId))]);
        await client.query('COMMIT');
        res.status(201).json({ request: result.rows[0], client_token: clientToken, designer_token: designerToken });
    } catch (err) { await client.query('ROLLBACK'); console.error('[DesignRequests] create:', err.message); res.status(500).json({ error: 'فشل إنشاء طلب التصميم' }); } finally { client.release(); }
});

router.post('/:id([0-9a-fA-F-]{36})/items', authenticate, async (req, res) => {
    try {
        const request = await requestById(req.params.id);
        if (!request) return res.status(404).json({ error: 'طلب التصميم غير موجود' });
        if (['completed', 'cancelled'].includes(request.status)) return res.status(400).json({ error: 'لا يمكن إضافة تصاميم لطلب مغلق' });
        const allowed = ['admin', 'manager', 'super_admin'].includes(req.user.role) || (req.user.role === 'designer' && request.designer_id === req.user.id);
        if (!allowed) return res.status(403).json({ error: 'غير مصرح لك' });
        const { product_name: productName, size_name: sizeName, notes } = req.body;
        if (!productName) return res.status(400).json({ error: 'اسم التصميم مطلوب' });
        const tx = await db.getClient();
        try {
            await tx.query('BEGIN');
            const countRes = await tx.query(`SELECT COUNT(*)::int AS count FROM design_request_items WHERE request_id=$1`, [req.params.id]);
            if (countRes.rows[0].count >= 1) throw new Error('كل طلب تصميم يخص صنفًا واحدًا');
            const orderResult = await tx.query(`SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM design_request_items WHERE request_id=$1`, [req.params.id]);
            await tx.query(`INSERT INTO design_request_items (request_id, variant_id, product_name, size_name, notes, attachments, sort_order, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'waiting_design')`, [req.params.id, null, productName, sizeName || null, notes || null, JSON.stringify([]), orderResult.rows[0].next]);
            await recalcRequestStatus(tx, req.params.id);
            await tx.query('COMMIT');
            res.status(201).json({ success: true });
        } catch (err) { await tx.query('ROLLBACK'); throw err; } finally { tx.release(); }
    } catch (err) { console.error('[DesignRequests] add item:', err.message); const status = err.code === '23505' ? 409 : (err.message === 'كل طلب تصميم يخص صنفًا واحدًا' ? 409 : 500); res.status(status).json({ error: err.message || 'فشل إضافة التصميم' }); }
});

router.get('/:id([0-9a-fA-F-]{36})', authenticate, async (req, res) => {
    try { const request = await requestById(req.params.id); if (!request) return res.status(404).json({ error: 'طلب التصميم غير موجود' }); if (!['admin', 'manager', 'super_admin'].includes(req.user.role) && request.designer_id !== req.user.id) return res.status(403).json({ error: 'غير مصرح لك' }); await ensureShareTokens(request);
        const response = await details(request, true);
        response.share_links = shareLinks(request);
        if (['admin', 'manager', 'super_admin'].includes(req.user.role)) {
            response.converted_quotation_id = request.converted_quotation_id;
            response.selected_product_id = request.selected_product_id;
        }
        res.json(response); } catch (err) { res.status(500).json({ error: 'فشل تحميل الطلب' }); }
});

router.put('/:id([0-9a-fA-F-]{36})/start', authenticate, async (req, res) => {
    try { const request = await requestById(req.params.id); if (!request || (req.user.role === 'designer' && request.designer_id !== req.user.id)) return res.status(403).json({ error: 'غير مصرح لك' }); if (!['waiting_design', 'revision_requested'].includes(request.status)) return res.status(400).json({ error: 'لا يمكن بدء التنفيذ من الحالة الحالية' }); const result = await db.query(`UPDATE design_requests SET status='in_progress', started_at=COALESCE(started_at,NOW()) WHERE id=$1 RETURNING *`, [req.params.id]); await db.query(`INSERT INTO design_request_messages (request_id,sender_type,sender_id,sender_name,message) VALUES ($1,'system',$2,$3,$4)`, [req.params.id, req.user.id, req.user.name || 'النظام', 'تم بدء تنفيذ التصميم']); res.json({ request: result.rows[0] }); } catch (err) { res.status(500).json({ error: 'فشل بدء التنفيذ' }); }
});

router.post('/:id([0-9a-fA-F-]{36})/message', authenticate, safeUpload(upload.single('attachment')), async (req, res) => {
    try { const request = await requestById(req.params.id); if (!request) return res.status(404).json({ error: 'الطلب غير موجود' }); const allowed = ['admin', 'manager', 'super_admin'].includes(req.user.role) || (req.user.role === 'designer' && request.designer_id === req.user.id); if (!allowed) return res.status(403).json({ error: 'غير مصرح لك' }); if (!req.body.message && !req.file) return res.status(400).json({ error: 'اكتب رسالة أو أرفق ملفًا' }); const senderType = ['admin', 'manager', 'super_admin'].includes(req.user.role) ? 'manager' : 'designer'; const itemId = req.body.item_id || null; const result = await db.query(`INSERT INTO design_request_messages (request_id,item_id,sender_type,sender_id,sender_name,message,attachment,is_internal) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [req.params.id, itemId, senderType, req.user.id, req.user.name || senderType, req.body.message || null, req.file ? JSON.stringify(fileData(req.file)) : null, req.body.is_internal === 'true' && senderType === 'manager']); res.status(201).json({ message: result.rows[0] }); } catch (err) { res.status(500).json({ error: 'فشل إرسال الرسالة' }); }
});

router.post('/:id([0-9a-fA-F-]{36})/version', authenticate, safeUpload(upload.single('design_file')), async (req, res) => {
    const tx = await db.getClient();
    try {
        await tx.query('BEGIN');
        const request = (await tx.query('SELECT * FROM design_requests WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!request) throw new Error('طلب التصميم غير موجود');
        const allowed = ['admin', 'manager', 'super_admin'].includes(req.user.role) || request.designer_id === req.user.id;
        if (!allowed) throw new Error('غير مصرح لك');
        if (!['waiting_design', 'in_progress', 'revision_requested'].includes(request.status)) throw new Error('لا يمكن رفع تصميم في الحالة الحالية');
        if (!req.file) throw new Error('ملف التصميم مطلوب');
        let item_id = req.body.item_id || null;
        let item;
        if (item_id) {
            item = (await tx.query('SELECT id FROM design_request_items WHERE id=$1 AND request_id=$2 FOR UPDATE', [item_id, req.params.id])).rows[0];
            if (!item) throw new Error('الصنف غير موجود داخل طلب التصميم');
        } else {
            item = await getOrCreateSingleItem(tx, request);
            item_id = item.id;
        }
        const next = await tx.query('SELECT COALESCE(MAX(version_number),0)+1 AS number FROM design_request_versions WHERE request_id=$1 AND item_id=$2', [req.params.id, item_id]);
        const version = await tx.query(`INSERT INTO design_request_versions (request_id,item_id,version_number,file,designer_notes,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.params.id, item_id, next.rows[0].number, JSON.stringify(fileData(req.file)), req.body.designer_notes || null, req.user.id]);
        await tx.query(`UPDATE design_request_items SET status='client_review', current_version_id=$1 WHERE id=$2`, [version.rows[0].id, item_id]);
        await recalcRequestStatus(tx, req.params.id);
        await tx.query('COMMIT');
        res.status(201).json({ version: version.rows[0] });
    } catch (err) { await tx.query('ROLLBACK'); res.status(400).json({ error: err.message || 'فشل رفع إصدار التصميم' }); } finally { tx.release(); }
});

// Public customer token endpoints. The token grants access only to this request.
router.get('/:token', async (req, res) => {
    try { const result = await db.query(`SELECT dr.*, c.name AS client_name, u.name AS designer_name, (dr.designer_token_hash = $1) AS is_designer_link FROM design_requests dr JOIN clients c ON c.id=dr.client_id JOIN users u ON u.id=dr.designer_id WHERE dr.client_token_hash=$1 OR dr.designer_token_hash=$1`, [hash(req.params.token)]); if (!result.rows[0]) return res.status(404).json({ error: 'الرابط غير صالح' }); const response = await details(result.rows[0], result.rows[0].is_designer_link); response.viewer_role = result.rows[0].is_designer_link ? 'designer' : 'client'; res.json(response); } catch (err) { res.status(500).json({ error: 'فشل تحميل طلب التصميم' }); }
});

router.post('/:token/message', safeUpload(upload.single('attachment')), async (req, res) => {
    try { const result = await db.query(`SELECT *, (designer_token_hash = $1) AS is_designer_link FROM design_requests WHERE client_token_hash=$1 OR designer_token_hash=$1`, [hash(req.params.token)]); const request = result.rows[0]; if (!request) return res.status(404).json({ error: 'الرابط غير صالح' }); if (!req.body.message && !req.file) return res.status(400).json({ error: 'اكتب رسالة أو أرفق ملفًا' }); if (req.file) moveToRequestFolder(req.file, request.id); const senderType = request.is_designer_link ? 'designer' : 'client'; const senderName = request.is_designer_link ? 'المصمم' : 'العميل'; const itemId = req.body.item_id || null; const inserted = await db.query(`INSERT INTO design_request_messages (request_id,item_id,sender_type,sender_name,message,attachment) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [request.id, itemId, senderType, senderName, req.body.message || null, req.file ? JSON.stringify(fileData(req.file)) : null]); res.status(201).json({ message: inserted.rows[0] }); } catch (err) { res.status(500).json({ error: 'فشل إرسال الرسالة' }); }
});

router.put('/:token/start', async (req, res) => {
    try { const result = await db.query(`UPDATE design_requests SET status='in_progress', started_at=COALESCE(started_at,NOW()) WHERE designer_token_hash=$1 AND status IN ('waiting_design','revision_requested') RETURNING *`, [hash(req.params.token)]); if (!result.rows[0]) return res.status(400).json({ error: 'لا يمكن بدء التنفيذ من الحالة الحالية أو الرابط غير صالح' }); await db.query(`INSERT INTO design_request_messages (request_id,sender_type,sender_name,message) VALUES ($1,'system','النظام','تم بدء تنفيذ التصميم')`, [result.rows[0].id]); res.json({ success: true }); } catch (err) { res.status(500).json({ error: 'فشل بدء التنفيذ' }); }
});

router.post('/:token/version', safeUpload(upload.single('design_file')), async (req, res) => {
    const tx = await db.getClient();
    try {
        await tx.query('BEGIN');
        const request = (await tx.query(`SELECT * FROM design_requests WHERE designer_token_hash=$1 FOR UPDATE`, [hash(req.params.token)])).rows[0];
        if (!request) throw new Error('الرابط غير صالح');
        if (!['waiting_design', 'in_progress', 'revision_requested'].includes(request.status)) throw new Error('لا يمكن رفع تصميم في الحالة الحالية');
        if (!req.file) throw new Error('ملف التصميم مطلوب');
        moveToRequestFolder(req.file, request.id);
        let item_id = req.body.item_id || null;
        let item;
        if (item_id) {
            item = (await tx.query('SELECT id FROM design_request_items WHERE id=$1 AND request_id=$2 FOR UPDATE', [item_id, request.id])).rows[0];
            if (!item) throw new Error('الصنف غير موجود داخل طلب التصميم');
        } else {
            item = await getOrCreateSingleItem(tx, request);
            item_id = item.id;
        }
        const next = await tx.query('SELECT COALESCE(MAX(version_number),0)+1 AS number FROM design_request_versions WHERE request_id=$1 AND item_id=$2', [request.id, item_id]);
        const version = await tx.query(`INSERT INTO design_request_versions (request_id,item_id,version_number,file,designer_notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [request.id, item_id, next.rows[0].number, JSON.stringify(fileData(req.file)), req.body.designer_notes || null]);
        await tx.query(`UPDATE design_request_items SET status='client_review', current_version_id=$1 WHERE id=$2`, [version.rows[0].id, item_id]);
        await recalcRequestStatus(tx, request.id);
        await tx.query('COMMIT');
        res.status(201).json({ version: version.rows[0] });
    } catch (err) { await tx.query('ROLLBACK'); res.status(400).json({ error: err.message || 'فشل رفع التصميم' }); } finally { tx.release(); }
});

router.post('/:token/respond', async (req, res) => {
    const { action, notes, item_id, version_id } = req.body;
    if (!['approve', 'revision'].includes(action) || !item_id) return res.status(400).json({ error: 'الصنف والإجراء مطلوبان' });
    const tx = await db.getClient();
    try {
        await tx.query('BEGIN');
        const request = (await tx.query('SELECT id FROM design_requests WHERE client_token_hash=$1 FOR UPDATE', [hash(req.params.token)])).rows[0];
        if (!request) throw new Error('الرابط غير صالح');
        const item = (await tx.query('SELECT id, current_version_id FROM design_request_items WHERE id=$1 AND request_id=$2 FOR UPDATE', [item_id, request.id])).rows[0];
        if (!item) throw new Error('الصنف غير موجود داخل الطلب');
        const targetVersion = version_id || item.current_version_id;
        if (!targetVersion) throw new Error('لا يوجد إصدار لهذا الصنف');
        const version = (await tx.query('SELECT id, status FROM design_request_versions WHERE id=$1 AND item_id=$2 AND request_id=$3 FOR UPDATE', [targetVersion, item.id, request.id])).rows[0];
        if (!version) throw new Error('الإصدار غير موجود أو لا ينتمي لهذا الصنف');
        if (version.id !== item.current_version_id) throw new Error('يمكن الرد على الإصدار الحالي فقط');
        if (!['pending'].includes(version.status)) throw new Error('لا يمكن الرد على إصدار معالج أو ملغي');
        if (action === 'revision') {
            await tx.query(`UPDATE design_request_items SET status='revision_requested' WHERE id=$1`, [item.id]);
            await tx.query(`UPDATE design_request_versions SET status='revision_requested' WHERE id=$1`, [targetVersion]);
            await tx.query(`INSERT INTO design_request_revisions (request_id,item_id,version_id,notes,created_by) VALUES ($1,$2,$3,$4,NULL)`, [request.id, item.id, targetVersion, notes || 'طلب تعديل من العميل']);
        } else {
            await tx.query(`UPDATE design_request_items SET status='approved', approved_version_id=$1, approved_at=NOW() WHERE id=$2`, [targetVersion, item.id]);
            await tx.query(`UPDATE design_request_versions SET status='approved' WHERE id=$1`, [targetVersion]);
        }
        await recalcRequestStatus(tx, request.id);
        await tx.query('COMMIT');
        res.json({ success: true });
    } catch (err) { await tx.query('ROLLBACK'); res.status(400).json({ error: err.message || 'فشل تسجيل الرد' }); } finally { tx.release(); }
});

router.post('/:token/complete', async (req, res) => {
    try {
        const result = await db.query(`SELECT * FROM design_requests WHERE designer_token_hash=$1 FOR UPDATE`, [hash(req.params.token)]);
        const request = result.rows[0];
        if (!request) return res.status(404).json({ error: 'الرابط غير صالح' });
        if (!['approved', 'completed'].includes(request.status)) return res.status(400).json({ error: 'يجب اعتماد كل التصاميم قبل إغلاق الطلب' });
        if (request.status !== 'completed') {
            await db.query(`UPDATE design_requests SET status='completed', completed_at=NOW() WHERE id=$1`, [request.id]);
            await db.query(`INSERT INTO design_request_messages (request_id,sender_type,sender_name,message) VALUES ($1,'system','النظام','تم إغلاق طلب التصميم')`, [request.id]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'فشل إغلاق الطلب' }); }
});

router.post('/:id([0-9a-fA-F-]{36})/convert', authenticate, authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    const { variant_id, quantity, unit_price } = req.body;
    const q = Number(quantity);
    const p = Number(unit_price);
    if (!variant_id || !Number.isFinite(q) || q <= 0 || !Number.isFinite(p) || p < 0) return res.status(400).json({ error: 'الصنف والكمية والسعر مطلوبة بشكل صحيح' });
    const tx = await db.getClient();
    try {
        await tx.query('BEGIN');
        const requestRes = await tx.query('SELECT * FROM design_requests WHERE id=$1 FOR UPDATE', [req.params.id]);
        const request = requestRes.rows[0];
        if (!request || request.status !== 'approved') throw new Error('يجب اعتماد تصميم قبل التحويل');
        if (request.converted_quotation_id) throw new Error('تم تحويل طلب التصميم إلى عرض سعر من قبل');
        const itemRes = await tx.query('SELECT id, variant_id, product_name, size_name, approved_version_id FROM design_request_items WHERE request_id=$1 FOR UPDATE', [req.params.id]);
        const designItem = itemRes.rows[0];
        if (!designItem || !designItem.approved_version_id) throw new Error('يجب اعتماد تصميم قبل التحويل');
        const versionRes = await tx.query('SELECT id, file FROM design_request_versions WHERE id=$1 FOR UPDATE', [designItem.approved_version_id]);
        const version = versionRes.rows[0];
        if (!version || !version.file) throw new Error('الإصدار المعتمد غير موجود');
        const variantRes = await tx.query(`SELECT pv.id, p.id AS product_id, p.name AS product_name, pv.size_name FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE pv.id=$1 AND pv.status='active'`, [variant_id]);
        if (!variantRes.rows[0]) throw new Error('الصنف المختار غير موجود أو غير نشط');
        const order = (await tx.query(`INSERT INTO orders (client_id,status,pricing_status,order_date,valid_until,subtotal,tax_amount,grand_total,client_notes,internal_notes,created_by) VALUES ($1,'quote','pending',CURRENT_DATE,CURRENT_DATE + INTERVAL '45 days',0,0,0,$2,$3,$4) RETURNING id, order_number`, [request.client_id, `طلب تصميم ${designItem.product_name}`, `تم التحويل من ${`DES-${String(request.request_number).padStart(5, '0')}`}`, req.user.id])).rows[0];
        const orderItem = (await tx.query(`INSERT INTO order_items (order_id,variant_id,quantity,unit_price,design_status,notes) VALUES ($1,$2,$3,$4,'approved',$5) RETURNING id`, [order.id, variant_id, q, p, `من طلب التصميم DES-${String(request.request_number).padStart(5, '0')}`])).rows[0];
        const lockHex = hash(`${request.client_id}:${variant_id}`).substring(0, 16);
        const lockId = BigInt('0x' + lockHex) % (2n ** 63n);
        await tx.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockId.toString()]);
        const numberRes = await tx.query(`SELECT COALESCE(MAX(design_number),0)+1 AS number FROM client_designs WHERE client_id=$1 AND variant_id=$2`, [request.client_id, variant_id]);
        const design = (await tx.query(`INSERT INTO client_designs (client_id,variant_id,design_number,design_name,description,is_active) VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id`, [request.client_id, variant_id, numberRes.rows[0].number, designItem.product_name, `تم اعتماد التصميم من طلب ${`DES-${String(request.request_number).padStart(5, '0')}`}`])).rows[0];
        const copiedFile = copyDesignFile(version.file, request.id, design.id);
        await tx.query(`INSERT INTO client_design_files (design_id,file_type,file_path,original_name,file_size,mime_type,uploaded_by) VALUES ($1,'source',$2,$3,$4,$5,$6)`, [design.id, copiedFile.path, copiedFile.original_name, copiedFile.size, copiedFile.mime_type, req.user.id]);
        await tx.query(`UPDATE order_items SET design_id=$1 WHERE id=$2`, [design.id, orderItem.id]);
        await tx.query(`UPDATE design_request_items SET variant_id=$1 WHERE id=$2`, [variant_id, designItem.id]);
        await tx.query(`UPDATE design_requests SET selected_product_id=$2, converted_quotation_id=$3, status='completed', completed_at=NOW() WHERE id=$1`, [request.id, variantRes.rows[0].product_id, order.id]);
        await tx.query(`INSERT INTO design_request_messages (request_id,item_id,sender_type,sender_id,sender_name,message,is_internal) VALUES ($1,$2,'system',$3,'النظام',$4,TRUE)`, [request.id, designItem.id, req.user.id, `تم تحويل الطلب إلى عرض سعر رقم ${order.order_number}`]);
        await tx.query('COMMIT');
        res.status(201).json({ quotation: order, design_id: design.id, product: variantRes.rows[0] });
    } catch (err) { await tx.query('ROLLBACK'); console.error('[DesignRequests] convert:', err.message); res.status(400).json({ error: err.message || 'فشل التحويل' }); } finally { tx.release(); }
});

router.post('/:id([0-9a-fA-F-]{36})/complete', authenticate, async (req, res) => {
    try {
        const request = await requestById(req.params.id);
        if (!request) return res.status(404).json({ error: 'طلب التصميم غير موجود' });
        const allowed = ['admin', 'manager', 'super_admin'].includes(req.user.role) || (req.user.role === 'designer' && request.designer_id === req.user.id);
        if (!allowed) return res.status(403).json({ error: 'غير مصرح لك' });
        if (!['approved', 'completed'].includes(request.status)) return res.status(400).json({ error: 'يجب اعتماد كل التصاميم قبل إغلاق الطلب' });
        if (request.status !== 'completed') {
            await db.query(`UPDATE design_requests SET status='completed', completed_at=NOW() WHERE id=$1`, [req.params.id]);
            await db.query(`INSERT INTO design_request_messages (request_id,sender_type,sender_id,sender_name,message) VALUES ($1,'system',$2,$3,$4)`, [req.params.id, req.user.id, req.user.name || 'النظام', 'تم إغلاق طلب التصميم']);
        }
        res.json({ success: true });
    } catch (err) { console.error('[DesignRequests] complete:', err.message); res.status(500).json({ error: 'فشل إغلاق الطلب' }); }
});

module.exports = router;
