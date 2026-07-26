'use strict';

// =============================================================================
// G.PACK 2.0 — Approval Service
// Background processing for design approvals:
//   1. Generate certificate image (1080×1350)
//   2. Generate PDF (with QR, signature, declaration)
//   3. Build Approval Package (metadata.json + audit.json)
//   4. Send WhatsApp notifications via WAHA (if configured)
// All async — does NOT block the approval response.
// =============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const NotificationService = require('./notification-service');
const WhatsApp = require('./whatsapp-service');

const UPLOAD_BASE = path.join(__dirname, '../uploads/designs');
const db = require('../db');

// ── Main: process approval in background ────────────────────────────────────
async function processApproval(approvalData) {
    const { item_id, order_id, order_number, client_name, product_name, size_name,
            signer_name, certificate_number, verification_hash,
            signature_path, declaration_text, approved_at, client_ip } = approvalData;

    console.log(`[ApprovalService] Processing approval ${certificate_number} for item ${item_id}`);

    // Create approval package directory
    const approvedDate = new Date(approved_at);
    const year = approvedDate.getFullYear();
    const month = String(approvedDate.getMonth() + 1).padStart(2, '0');
    const day = String(approvedDate.getDate()).padStart(2, '0');
    const pkgDir = path.join(UPLOAD_BASE, 'approvals', `${year}`, `${month}`, `${day}`, `item-${item_id}`);
    fs.mkdirSync(pkgDir, { recursive: true });

    const baseUrl = process.env.BASE_URL || 'https://erp.gpacksa.com';
    const verifyUrl = `${baseUrl}/verify/${certificate_number}`;

    // Fetch client phone, designer phone, and admin chat ID from DB
    let client_phone = null;
    let designer_phone = null;
    let designer_name = null;
    let design_files = null;

    try {
        const infoRes = await db.query(
            `SELECT c.phone AS client_phone,
                    u.phone AS designer_phone,
                    u.name AS designer_name,
                    oi.design_files
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN clients c ON c.id = o.client_id
             LEFT JOIN users u ON u.id = oi.designer_id
             WHERE oi.id = $1`,
            [item_id]
        );
        if (infoRes.rows.length > 0) {
            client_phone = infoRes.rows[0].client_phone;
            designer_phone = infoRes.rows[0].designer_phone;
            designer_name = infoRes.rows[0].designer_name;
            design_files = infoRes.rows[0].design_files;
        }
    } catch (e) {
        console.error('[ApprovalService] Info fetch error:', e.message);
    }

    try {
        // 1. Generate QR Code
        const qrBuffer = await QRCode.toBuffer(verifyUrl, {
            width: 300,
            margin: 1,
            color: { dark: '#1e3a5f', light: '#ffffff' },
        });
        const qrPath = path.join(pkgDir, 'qr.png');
        fs.writeFileSync(qrPath, qrBuffer);

        // 2. Generate certificate image (1080×1350)
        const certImagePath = await _generateCertificateImage({
            pkgDir, certificate_number, client_name, product_name, size_name,
            signer_name, approved_at: approvedDate,
            signature_path, qrBuffer, verifyUrl,
        });

        // 3. Generate PDF
        const pdfPath = await _generatePDF({
            pkgDir, certificate_number, order_number, client_name, product_name, size_name,
            signer_name, approved_at: approvedDate,
            signature_path, qrPath, verifyUrl, declaration_text,
        });

        // 4. Copy signature to package
        let sigPkgPath = null;
        if (signature_path) {
            const sigSrc = path.join(UPLOAD_BASE, signature_path.replace('/uploads/designs/', ''));
            sigPkgPath = path.join(pkgDir, 'signature.png');
            try { fs.copyFileSync(sigSrc, sigPkgPath); } catch { }
        }

        // 4b. Copy design preview (first image file) to package
        let designPreviewPath = null;
        if (design_files) {
            let files = design_files;
            if (typeof files === 'string') { try { files = JSON.parse(files); } catch { files = []; } }
            if (Array.isArray(files)) {
                const firstImage = files.find(f => {
                    const ext = (f.filename || f.name || f.path || '').split('.').pop().toLowerCase();
                    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
                });
                if (firstImage) {
                    const srcPath = firstImage.path || firstImage.url || firstImage;
                    const fullSrc = srcPath.startsWith('/') ? path.join(__dirname, '..', srcPath) : path.join(UPLOAD_BASE, srcPath);
                    try {
                        if (fs.existsSync(fullSrc)) {
                            designPreviewPath = path.join(pkgDir, 'design-preview.jpg');
                            // If it's already jpg, copy; otherwise load and re-save as jpg
                            const ext = fullSrc.split('.').pop().toLowerCase();
                            if (ext === 'jpg' || ext === 'jpeg') {
                                fs.copyFileSync(fullSrc, designPreviewPath);
                            } else {
                                const img = await loadImage(fullSrc);
                                const c = createCanvas(img.width, img.height);
                                c.getContext('2d').drawImage(img, 0, 0);
                                fs.writeFileSync(designPreviewPath, c.toBuffer('image/jpeg', { quality: 0.9 }));
                            }
                        }
                    } catch (e) {
                        console.error('[ApprovalService] Design preview error:', e.message);
                    }
                }
            }
        }

        // 5. Generate metadata.json
        const metadata = {
            certificate_number,
            verification_hash,
            order_number,
            client_name,
            product_name,
            size_name,
            signer_name,
            approved_at: approvedDate.toISOString(),
            client_ip,
            declaration_text,
            verify_url: verifyUrl,
            files: {
                certificate_image: 'certificate.jpg',
                approval_pdf: 'approval.pdf',
                signature: sigPkgPath ? 'signature.png' : null,
                design_preview: designPreviewPath ? 'design-preview.jpg' : null,
                qr: 'qr.png',
            },
        };
        fs.writeFileSync(path.join(pkgDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

        // 6. Generate audit.json from activity log
        try {
            const auditRes = await db.query(
                `SELECT event_type, event_details, actor, client_ip, user_agent, created_at
                 FROM design_activity_log
                 WHERE order_id = $1 AND (item_id = $2 OR item_id IS NULL)
                 ORDER BY created_at ASC`,
                [order_id, item_id]
            );
            const auditData = auditRes.rows.map(r => ({
                timestamp: r.created_at,
                event: r.event_type,
                actor: r.actor,
                ip: r.client_ip,
                user_agent: r.user_agent,
                details: r.event_details ? JSON.parse(r.event_details) : null,
            }));
            fs.writeFileSync(path.join(pkgDir, 'audit.json'), JSON.stringify({
                certificate_number,
                item_id,
                order_id,
                total_events: auditData.length,
                events: auditData,
            }, null, 2));
        } catch (e) {
            console.error('[ApprovalService] Audit log error:', e.message);
        }

        // 7. Update DB with file paths
        const certRelPath = `/uploads/designs/approvals/${year}/${month}/${day}/item-${item_id}/certificate.jpg`;
        const pdfRelPath = `/uploads/designs/approvals/${year}/${month}/${day}/item-${item_id}/approval.pdf`;
        await db.query(
            `UPDATE design_approvals SET
                approval_image_path = $1,
                approval_pdf_path = $2
             WHERE item_id = $3`,
            [certRelPath, pdfRelPath, item_id]
        );

        // 8. Log activity
        try {
            await db.query(
                `INSERT INTO design_activity_log (order_id, item_id, event_type, event_details, actor)
                 VALUES ($1, $2, 'approval_package_generated', $3, 'system')`,
                [order_id, item_id, JSON.stringify({ pdf: pdfRelPath, image: certRelPath })]
            );
        } catch { }

        // 9. Create ZIP archive of the approval package
        const zipPath = path.join(pkgDir, '..', `item-${item_id}.zip`);
        try {
            await new Promise((resolve, reject) => {
                const output = fs.createWriteStream(zipPath);
                const archive = archiver('zip', { zlib: { level: 9 } });
                output.on('close', resolve);
                output.on('error', reject);
                archive.on('error', reject);
                archive.pipe(output);
                archive.directory(pkgDir, false);
                archive.finalize();
            });
            console.log(`[ApprovalService] ZIP created: ${zipPath}`);
        } catch (e) {
            console.error('[ApprovalService] ZIP creation skipped:', e.message);
        }

        // 10. Write outbox event (Outbox Pattern — guarantees no message loss)
        // The outbox event is picked up by the notification worker which calls
        // notifyDesignApproved with the correlation_id.
        const certAbsPath = path.join(UPLOAD_BASE, 'approvals', `${year}`, `${month}`, `${day}`, `item-${item_id}`, 'certificate.jpg');
        const pdfAbsPath = path.join(UPLOAD_BASE, 'approvals', `${year}`, `${month}`, `${day}`, `item-${item_id}`, 'approval.pdf');

        const correlationId = NotificationService.generateCorrelationId('APR');

        await NotificationService.writeOutboxEvent({
            event_type: 'design_approved',
            entity_type: 'order_item',
            entity_id: item_id,
            correlation_id: correlationId,
            payload: {
                item_id, order_id, order_number,
                client_name, client_phone,
                product_name, size_name,
                signer_name, certificate_number,
                approved_at: approvedDate,
                verify_url: verifyUrl,
                pdf_path: pdfAbsPath,
                cert_image_path: certAbsPath,
                designer_phone, designer_name,
                correlation_id: correlationId,
            },
        });

        console.log(`[ApprovalService] Approval ${certificate_number} processed — outbox event written (correlation: ${correlationId})`);
    } catch (err) {
        console.error('[ApprovalService] Processing error:', err.message);
    }
}

// ── Generate certificate image (1080×1350) ──────────────────────────────────
async function _generateCertificateImage(data) {
    const W = 1080, H = 1350;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Background — white
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Top banner — brand gradient
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#1e3a5f');
    grad.addColorStop(1, '#2d5a87');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, 140);

    // GPACK logo text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('G.PACK', W / 2, 70);
    ctx.font = '20px Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('نظام اعتماد التصاميم', W / 2, 105);

    // Checkmark circle
    ctx.beginPath();
    ctx.arc(W / 2, 260, 60, 0, Math.PI * 2);
    ctx.fillStyle = '#10b981';
    ctx.fill();
    ctx.strokeStyle = '#059669';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Checkmark
    ctx.beginPath();
    ctx.moveTo(W / 2 - 25, 260);
    ctx.lineTo(W / 2 - 5, 280);
    ctx.lineTo(W / 2 + 30, 235);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Title
    ctx.fillStyle = '#1e3a5f';
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('تم اعتماد التصميم', W / 2, 380);

    // Info fields
    const fields = [
        { label: 'العميل', value: data.client_name || '—' },
        { label: 'المنتج', value: data.product_name || '—' },
        { label: 'رقم العرض', value: `#${data.order_number}` },
        { label: 'الموقّع', value: data.signer_name || '—' },
        { label: 'التاريخ', value: new Date(data.approved_at).toLocaleDateString('ar-SA') },
        { label: 'وقت الاعتماد', value: new Date(data.approved_at).toLocaleTimeString('ar-SA') },
        { label: 'رقم الاعتماد', value: data.certificate_number },
    ];

    ctx.textAlign = 'right';
    let y = 460;
    for (const f of fields) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '22px Arial';
        ctx.fillText(f.label, W / 2 + 200, y);

        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(f.value, W / 2 - 200, y);
        ctx.textAlign = 'right';
        y += 55;
    }

    // Signature
    if (data.signature_path) {
        try {
            const sigSrc = path.join(UPLOAD_BASE, data.signature_path.replace('/uploads/designs/', ''));
            if (fs.existsSync(sigSrc)) {
                const sigImg = await loadImage(sigSrc);
                ctx.fillStyle = '#f8fafc';
                ctx.fillRect(W / 2 - 150, y + 10, 300, 100);
                ctx.strokeStyle = '#e2e8f0';
                ctx.lineWidth = 1;
                ctx.strokeRect(W / 2 - 150, y + 10, 300, 100);
                ctx.drawImage(sigImg, W / 2 - 130, y + 20, 260, 80);
                ctx.fillStyle = '#94a3b8';
                ctx.font = '18px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('التوقيع', W / 2, y + 135);
            }
        } catch { }
    }

    // QR Code
    try {
        const qrImg = await loadImage(data.qrBuffer);
        const qrSize = 140;
        const qrX = W / 2 - qrSize / 2;
        const qrY = H - 220;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(qrX - 10, qrY - 10, qrSize + 20, qrSize + 20);
        ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

        ctx.fillStyle = '#64748b';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('امسح للتحقق', W / 2, H - 65);
    } catch { }

    // Footer
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('G.PACK — حلول التعبئة والتغليف | شهادة اعتماد إلكترونية', W / 2, H - 30);

    // Save as JPEG
    const imagePath = path.join(data.pkgDir, 'certificate.jpg');
    const jpegBuffer = canvas.toBuffer('image/jpeg', { quality: 0.92 });
    fs.writeFileSync(imagePath, jpegBuffer);

    return imagePath;
}

// ── Generate PDF ─────────────────────────────────────────────────────────────
async function _generatePDF(data) {
    return new Promise((resolve, reject) => {
        const pdfPath = path.join(data.pkgDir, 'approval.pdf');
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const stream = fs.createWriteStream(pdfPath);
        doc.pipe(stream);

        // Header — brand bar
        doc.rect(0, 0, doc.page.width, 80).fill('#1e3a5f');
        doc.fillColor('#ffffff').fontSize(28).font('Helvetica-Bold');
        doc.text('G.PACK', 50, 25);
        doc.fontSize(12).font('Helvetica');
        doc.text('Digital Design Approval Certificate', 50, 55);

        // Certificate number
        doc.fillColor('#1e3a5f').fontSize(16).font('Helvetica-Bold');
        doc.text(`Certificate: ${data.certificate_number}`, 50, 110);

        // Info table
        doc.font('Helvetica').fontSize(11).fillColor('#475569');
        let y = 150;
        const rows = [
            ['Order #', `#${data.order_number}`],
            ['Client', data.client_name || '—'],
            ['Product', data.product_name || '—'],
            ['Size', data.size_name || '—'],
            ['Signer', data.signer_name || '—'],
            ['Date', new Date(data.approved_at).toLocaleString('en-GB')],
            ['Verify URL', data.verifyUrl],
        ];
        for (const [label, value] of rows) {
            doc.fillColor('#94a3b8').text(label, 50, y);
            doc.fillColor('#1e293b').font('Helvetica-Bold').text(value, 200, y);
            doc.font('Helvetica');
            y += 25;
        }

        // Declaration
        y += 20;
        doc.fillColor('#1e3a5f').font('Helvetica-Bold').fontSize(12).text('Declaration', 50, y);
        y += 20;
        doc.fillColor('#475569').font('Helvetica').fontSize(10).text(data.declaration_text || '', 50, y, { width: 500 });
        y += 60;

        // Signature
        if (data.signature_path) {
            try {
                const sigSrc = path.join(UPLOAD_BASE, data.signature_path.replace('/uploads/designs/', ''));
                if (fs.existsSync(sigSrc)) {
                    doc.text('Signature:', 50, y);
                    doc.image(sigSrc, 200, y - 10, { fit: [200, 80] });
                    y += 90;
                }
            } catch { }
        }

        // QR Code
        try {
            if (fs.existsSync(data.qrPath)) {
                doc.image(data.qrPath, 50, y, { fit: [120, 120] });
                doc.fillColor('#64748b').fontSize(9).text('Scan to verify', 50, y + 125);
            }
        } catch { }

        // Footer
        doc.fillColor('#cbd5e1').fontSize(8).text(
            'G.PACK — Digital Design Approval System | This document is electronically signed and verified.',
            50, doc.page.height - 40, { width: 500, align: 'center' }
        );

        doc.end();
        stream.on('finish', () => resolve(pdfPath));
        stream.on('error', reject);
    });
}

// ── _sendWhatsAppNotification removed — now handled by NotificationService ──

module.exports = { processApproval };
