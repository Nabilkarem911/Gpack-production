'use strict';

// =============================================================================
// G.PACK 2.0 — Public Design Review Route (public-design.js)
// No auth required. Client views designs and submits approval/revision.
// Handles: signature capture, IP/device logging, PDF generation, activity log.
// =============================================================================

const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const { encryptToken, hashToken, hasShareTokenSecret } = require('../utils/crypto');

// =============================================================================
// File Upload Configuration (client revision files)
// =============================================================================
const UPLOAD_BASE = path.join(__dirname, '../uploads/designs');
if (!fs.existsSync(UPLOAD_BASE)) fs.mkdirSync(UPLOAD_BASE, { recursive: true });

const clientUploadStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        // Save to temp dir first — we don't know order ID until we look up the token
        const dir = path.join(UPLOAD_BASE, 'temp-client-revision');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const name = `client-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
        cb(null, name);
    },
});

const clientUpload = multer({
    storage: clientUploadStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
    fileFilter: (_req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|pdf|webp|bmp|heic/;
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.test(ext)) {
            cb(null, true);
        } else {
            cb(new Error('نوع الملف غير مدعوم. الأنواع المسموحة: JPG, PNG, GIF, PDF, WEBP, BMP, HEIC'));
        }
    },
});

// Helper: lookup order by token (hash first, plaintext fallback)
async function _findOrderByToken(client, token) {
    let orderRes = null;
    try {
        const tokenHash = hashToken(token);
        orderRes = await client.query(
            `SELECT id, order_number, design_client_status, client_id FROM orders WHERE design_share_token_hash = $1`,
            [tokenHash]
        );
    } catch { /* SECRET missing */ }

    if (!orderRes || orderRes.rows.length === 0) {
        orderRes = await client.query(
            `SELECT id, order_number, design_client_status, client_id FROM orders WHERE design_share_token = $1`,
            [token]
        );
    }
    return orderRes.rows.length > 0 ? orderRes.rows[0] : null;
}

// Helper: log activity (INSERT only, immutable table)
async function _logActivity(client, orderId, eventType, actor, ip, userAgent, details) {
    try {
        await client.query(
            `INSERT INTO design_activity_log (order_id, event_type, event_details, actor, client_ip, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [orderId, eventType, JSON.stringify(details || {}), actor, ip || null, userAgent || null]
        );
    } catch (err) {
        console.error('[PublicDesign] Activity log error:', err.message);
    }
}

// Helper: generate approval PDF using pdfkit
function _generateApprovalPDF(orderData, signatureBase64, outputPath) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const stream = fs.createWriteStream(outputPath);
        doc.pipe(stream);

        // Header — G.PACK logo text
        doc.fontSize(24).fillColor('#4f46e5').text('G.PACK', { align: 'center' });
        doc.fontSize(10).fillColor('#94a3b8').text('حلول التعبئة والتغليف — ينبع، المملكة العربية السعودية', { align: 'center' });
        doc.moveDown(1);

        // Title
        doc.fontSize(18).fillColor('#1e293b').text('Design Approval Certificate', { align: 'center' });
        doc.fontSize(14).fillColor('#475569').text('شهادة اعتماد التصميم', { align: 'center' });
        doc.moveDown(2);

        // Order info
        doc.fontSize(11).fillColor('#334155');
        doc.text(`Order Number / رقم الطلب: #${orderData.order_number}`, 50);
        doc.text(`Client / العميل: ${orderData.client_name}`, 50);
        doc.text(`Date / التاريخ: ${new Date().toLocaleString('en-GB')}`, 50);
        doc.text(`IP Address: ${orderData.client_ip}`, 50);
        doc.text(`Device: ${orderData.device_info}`, 50);
        doc.moveDown(1);

        // Separator
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cbd5e1').lineWidth(1).stroke();
        doc.moveDown(1);

        // Items
        doc.fontSize(12).fillColor('#1e293b').text('Approved Items / الأصناف المعتمدة:', 50);
        doc.moveDown(0.5);
        orderData.items.forEach((item, idx) => {
            doc.fontSize(10).fillColor('#475569');
            doc.text(`${idx + 1}. ${item.product_name || 'Item'} ${item.size_name ? '— ' + item.size_name : ''} (Qty: ${item.quantity})`, 70);
        });
        doc.moveDown(1);

        // Separator
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cbd5e1').lineWidth(1).stroke();
        doc.moveDown(1);

        // Signature
        doc.fontSize(12).fillColor('#1e293b').text('Approved By / تم الاعتماد بواسطة:', 50);
        doc.moveDown(0.5);
        doc.fontSize(11).fillColor('#334155').text(`Name: ${orderData.signer_name}`, 50);
        doc.moveDown(1);

        // Embed signature image
        if (signatureBase64) {
            try {
                const sigBuffer = Buffer.from(signatureBase64.split(',')[1], 'base64');
                doc.image(sigBuffer, 50, doc.y, { width: 200, height: 70 });
                doc.moveDown(4);
            } catch (e) {
                doc.text('[Signature image]', 50);
            }
        }

        doc.moveDown(1);
        doc.fontSize(9).fillColor('#94a3b8').text(`Approved at: ${new Date().toISOString()}`, 50);
        doc.text(`IP: ${orderData.client_ip} | Device: ${orderData.device_info}`, 50);

        doc.moveDown(2);
        // Approved stamp
        doc.fontSize(16).fillColor('#059669').text('APPROVED', { align: 'center' });
        doc.fontSize(9).fillColor('#94a3b8').text('G.PACK Design Approval System', { align: 'center' });

        doc.end();

        stream.on('finish', () => resolve(outputPath));
        stream.on('error', reject);
    });
}

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
                        o.design_status, c.name as client_name
                 FROM orders o
                 JOIN clients c ON c.id = o.client_id
                 WHERE o.design_share_token_hash = $1`,
                [tokenHash]
            );
        } catch { /* hashToken may throw if SECRET missing */ }

        if (!orderRes || orderRes.rows.length === 0) {
            orderRes = await db.query(
                `SELECT o.id, o.order_number, o.design_token_expires_at, o.design_client_status,
                        o.design_status, c.name as client_name
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

        // Auto-reset stale client revision responses when the order has moved
        // past client_review (designer resubmitted, manager reviewing, etc).
        // If an item has revision_requested but the order is no longer waiting
        // for client review, that response is stale and should be cleared.
        if (order.design_status !== 'client_review' && order.design_status !== 'completed') {
            const staleRes = await db.query(
                `UPDATE order_items SET
                    client_design_status = NULL,
                    client_revision_notes = NULL,
                    client_revision_files = NULL,
                    client_approved_at = NULL
                 WHERE order_id = $1
                   AND client_design_status = 'revision_requested'
                 RETURNING id`,
                [order.id]
            );
            if (staleRes.rows.length > 0) {
                console.log(`[PublicDesign] Auto-reset ${staleRes.rows.length} stale revision items for order ${order.id}`);
            }
        }

        // Also reset if manager re-sent to client (design_client_status='sent')
        // but items still have old revision_requested from previous round
        if (order.design_client_status === 'sent' && order.design_status === 'client_review') {
            const staleRes = await db.query(
                `UPDATE order_items SET
                    client_design_status = NULL,
                    client_revision_notes = NULL,
                    client_revision_files = NULL,
                    client_approved_at = NULL
                 WHERE order_id = $1
                   AND client_design_status = 'revision_requested'
                 RETURNING id`,
                [order.id]
            );
            if (staleRes.rows.length > 0) {
                console.log(`[PublicDesign] Auto-reset ${staleRes.rows.length} stale revision items on re-send for order ${order.id}`);
            }
        }

        const itemsRes = await db.query(
            `SELECT oi.id, oi.variant_id, oi.quantity,
                    p.name AS product_name, pv.size_name,
                    oi.design_files, oi.designer_notes,
                    oi.client_design_status, oi.client_revision_notes, oi.client_revision_files
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
            // Deduplicate by path
            if (files.length > 1) {
                const seen = new Set();
                const unique = files.filter(f => {
                    const key = f.original_name || f.path || f.filename || JSON.stringify(f);
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                if (unique.length < files.length) {
                    console.log(`[PublicDesign] Deduplicating design_files for item ${item.id}: ${files.length} → ${unique.length}`);
                    item.design_files = unique;
                    // Also fix in DB
                    db.query(`UPDATE order_items SET design_files = $1 WHERE id = $2`,
                        [JSON.stringify(unique), item.id]).catch(() => {});
                }
            }
            return files.length > 0;
        });

        // Fetch approval record if client already approved
        let approvalData = null;
        if (order.design_client_status === 'approved' || order.design_client_status === 'partially_approved') {
            const approvalRes = await db.query(
                `SELECT signer_name, signature_image, approval_pdf_path,
                        client_ip, device_info, approved_at
                 FROM design_approvals WHERE order_id = $1`,
                [order.id]
            );
            if (approvalRes.rows.length > 0) {
                approvalData = approvalRes.rows[0];
            }
        }

        res.json({
            order_number: order.order_number,
            client_name: order.client_name,
            design_client_status: order.design_client_status,
            approval: approvalData,
            items: items.map(item => ({
                id: item.id,
                product_name: item.product_name,
                size_name: item.size_name,
                quantity: item.quantity,
                designer_notes: item.designer_notes,
                design_files: item.design_files,
                client_design_status: item.client_design_status,
                client_revision_notes: item.client_revision_notes,
                client_revision_files: item.client_revision_files,
            })),
        });
    } catch (err) {
        console.error('[PublicDesign] View error:', err.message);
        res.status(500).json({ error: 'فشل في تحميل التصاميم' });
    }
});

// ── POST /api/public/design/respond/:token ──────────────────────────────────
// Public: client submits approval or revision request per item.
// Body: {
//   items: [{ item_id, action: 'approve'|'revision', notes? }],
//   signature?: base64 PNG (canvas signature),
//   signer_name?: string,
//   rejection_reasons?: string[],
//   device_info?: string,
// }
// =============================================================================
router.post('/respond/:token', clientUpload.array('client_files', 10), async (req, res) => {
    const { token } = req.params;
    let { items, signature, signer_name, rejection_reasons, device_info } = req.body;

    // Parse items if sent as JSON string (multipart form)
    if (typeof items === 'string') {
        try { items = JSON.parse(items); } catch { items = null; }
    }
    if (typeof rejection_reasons === 'string') {
        try { rejection_reasons = JSON.parse(rejection_reasons); } catch { rejection_reasons = []; }
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'يجب تقديم رد لصنف واحد على الأقل' });
    }

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';

    const client = await db.getClient();
    try {
        const order = await _findOrderByToken(client, token);
        if (!order) {
            return res.status(404).json({ error: 'الرابط غير صالح' });
        }

        await client.query('BEGIN');

        // Move uploaded files from temp dir to order-specific dir
        const targetDir = path.join(UPLOAD_BASE, order.id, 'client-revision');
        fs.mkdirSync(targetDir, { recursive: true });
        const clientFiles = (req.files || []).map(f => {
            const oldPath = path.join(UPLOAD_BASE, 'temp-client-revision', f.filename);
            const newPath = path.join(targetDir, f.filename);
            try {
                fs.renameSync(oldPath, newPath);
            } catch (e) {
                console.error('[PublicDesign] File move error:', e.message);
            }
            return {
                filename: f.filename,
                original_name: f.originalname,
                path: `/uploads/designs/${order.id}/client-revision/${f.filename}`,
                size: f.size,
            };
        });

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
                     SET client_design_status = 'revision_requested',
                         client_revision_notes = $1,
                         client_revision_files = $2
                     WHERE id = $3 AND order_id = $4`,
                    [item.notes || null, JSON.stringify(clientFiles), item.item_id, order.id]
                );
                revisionCount++;
            }
        }

        const allApprove = approvedCount > 0 && revisionCount === 0;

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

            // Log rejection activity
            await _logActivity(client, order.id, 'revision_requested', 'client', clientIp, userAgent, {
                reasons: rejection_reasons || [],
                item_count: revisionCount,
            });

        } else if (allApprove) {
            const pendingRes = await client.query(
                `SELECT COUNT(*) as count FROM order_items
                 WHERE order_id = $1
                   AND design_files IS NOT NULL AND design_files != '[]'::jsonb
                   AND client_design_status != 'approved'`,
                [order.id]
            );

            // Check if there are items WITHOUT design_files yet (not yet designed)
            const noDesignRes = await client.query(
                `SELECT COUNT(*) as count FROM order_items
                 WHERE order_id = $1
                   AND (design_files IS NULL OR design_files = '[]'::jsonb)`,
                [order.id]
            );
            const hasUndesignedItems = parseInt(noDesignRes.rows[0].count) > 0;

            if (parseInt(pendingRes.rows[0].count) === 0 && !hasUndesignedItems) {
                // ALL items designed AND approved → mark as confirmed (awaiting deposit)
                // Manager will set deposit amount and convert to production via existing flow
                await client.query(
                    `UPDATE orders SET
                        design_client_status = 'approved',
                        design_status = 'completed',
                        design_completed_at = NOW(),
                        status = 'confirmed'
                     WHERE id = $1`,
                    [order.id]
                );

                // Get client_name for PDF
                const clientNameRes = await client.query(
                    `SELECT c.name as client_name FROM orders o JOIN clients c ON c.id = o.client_id WHERE o.id = $1`,
                    [order.id]
                );
                const clientName = clientNameRes.rows[0]?.client_name || '';

                // Get items for PDF
                const allItemsRes = await client.query(
                    `SELECT oi.variant_id, oi.design_files, oi.quantity,
                            p.name AS product_name, pv.size_name
                     FROM order_items oi
                     LEFT JOIN product_variants pv ON pv.id = oi.variant_id
                     LEFT JOIN products p ON p.id = pv.product_id
                     WHERE oi.order_id = $1
                       AND oi.design_files IS NOT NULL AND oi.design_files != '[]'::jsonb`,
                    [order.id]
                );

                // Save to client_designs
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

                // Generate approval PDF
                let pdfPath = null;
                try {
                    const uploadDir = path.join(__dirname, '../uploads/designs', order.id, 'approval');
                    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
                    const pdfFileName = `approval_${Date.now()}.pdf`;
                    const fullPath = path.join(uploadDir, pdfFileName);
                    const pdfData = {
                        order_number: order.order_number,
                        client_name: clientName,
                        client_ip: clientIp,
                        device_info: device_info || '',
                        signer_name: signer_name || '',
                        items: allItemsRes.rows.map(r => ({
                            product_name: r.product_name,
                            size_name: r.size_name,
                            quantity: r.quantity,
                        })),
                    };
                    await _generateApprovalPDF(pdfData, signature, fullPath);
                    pdfPath = `/uploads/designs/${order.id}/approval/${pdfFileName}`;
                    console.log('[PublicDesign] Approval PDF generated:', pdfPath);
                } catch (pdfErr) {
                    console.error('[PublicDesign] PDF generation error:', pdfErr.message);
                }

                // Save approval record
                try {
                    await client.query(
                        `INSERT INTO design_approvals
                            (order_id, client_id, client_name, order_number,
                             signature_image, signer_name, client_ip, user_agent, device_info,
                             approval_pdf_path)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                         ON CONFLICT (order_id) DO UPDATE SET
                            signature_image = EXCLUDED.signature_image,
                            signer_name = EXCLUDED.signer_name,
                            client_ip = EXCLUDED.client_ip,
                            user_agent = EXCLUDED.user_agent,
                            device_info = EXCLUDED.device_info,
                            approval_pdf_path = EXCLUDED.approval_pdf_path,
                            approved_at = NOW()`,
                        [order.id, clientId, clientName, order.order_number,
                         signature || null, signer_name || null, clientIp, userAgent,
                         device_info || null, pdfPath]
                    );
                } catch (approvalErr) {
                    console.error('[PublicDesign] Approval save error:', approvalErr.message);
                }

                // Log approval activity
                await _logActivity(client, order.id, 'approved', 'client', clientIp, userAgent, {
                    signer_name: signer_name,
                    pdf_path: pdfPath,
                });
                await _logActivity(client, order.id, 'pdf_generated', 'system', null, null, {
                    pdf_path: pdfPath,
                });

            } else {
                // Partial approval: all designed items approved, but some items don't have designs yet
                // Keep order in client_review so manager can add more designs and re-send
                await client.query(
                    `UPDATE orders SET design_client_status = 'partially_approved' WHERE id = $1`,
                    [order.id]
                );

                // Log partial approval activity
                await _logActivity(client, order.id, 'approved', 'client', clientIp, userAgent, {
                    signer_name: signer_name,
                    partial: true,
                    designed_items: allItemsRes.rows.length,
                    total_items: (await client.query(`SELECT COUNT(*) as c FROM order_items WHERE order_id = $1`, [order.id])).rows[0].c,
                });
            }
        }

        await client.query('COMMIT');

        let message;
        if (revisionCount > 0) {
            message = `تم تسجيل طلب التعديل على ${revisionCount} صنف. سيتم إرسالها للمصمم للمراجعة.`;
        } else {
            message = `تم تسجيل موافقة العميل على ${approvedCount} صنف.`;
        }

        // Return whatsapp number (from env or empty)
        const whatsappNumber = process.env.WHATSAPP_NUMBER || '';

        res.json({
            success: true,
            message,
            approved_count: approvedCount,
            revision_count: revisionCount,
            whatsapp_number: whatsappNumber,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[PublicDesign] Respond error:', err.message);
        res.status(500).json({ error: 'فشل في تسجيل رد العميل' });
    } finally {
        client.release();
    }
});

// ── POST /api/public/design/activity/:token ─────────────────────────────────
// Public: log client activity (link_opened, design_viewed, whatsapp_opened, etc.)
// Body: { event_type: string, details?: object }
// =============================================================================
router.post('/activity/:token', async (req, res) => {
    const { token } = req.params;
    const { event_type, details } = req.body;

    if (!event_type) return res.status(400).json({ error: 'event_type required' });

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';

    try {
        const order = await _findOrderByToken(db, token);
        if (!order) return res.status(404).json({ error: 'invalid token' });

        await _logActivity(db, order.id, event_type, 'client', clientIp, userAgent, details);

        res.json({ success: true });
    } catch (err) {
        console.error('[PublicDesign] Activity error:', err.message);
        res.status(500).json({ error: 'failed to log activity' });
    }
});

module.exports = router;
