'use strict';

// =============================================================================
// G.PACK 2.0 — Notification Service
// Unified entry point for all notifications in the ERP.
//
// Architecture:
//   ERP Code → NotificationService → Channel (WhatsApp / Email / SMS / Push)
//                                      └── WhatsAppService → WAHA Provider
//
// To add a new channel (e.g., Email), add a method here and create the service.
// To change WhatsApp provider (e.g., WAHA → Meta Cloud API), only change
// whatsapp-service.js. Zero changes elsewhere in the ERP.
// =============================================================================

const db = require('../db');
const crypto = require('crypto');
const WhatsApp = require('./whatsapp-service');
const TemplateEngine = require('./template-engine');

// ── Generate idempotency key ────────────────────────────────────────────────
// SHA256 of (entity_type + entity_id + message_type + recipient)
// Prevents the same message being enqueued/delivered multiple times on retry.
function _idempotencyKey({ entity_type, entity_id, message_type, recipient }) {
    const raw = `${entity_type || ''}:${entity_id || ''}:${message_type || ''}:${recipient || ''}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
}

// ── Enqueue a notification ──────────────────────────────────────────────────
// This is the main method the ERP calls. It saves to notification_queue
// and the worker picks it up asynchronously.
// Idempotency: if the same message (same entity+event+recipient) is already
// queued or sent, the INSERT fails on the unique constraint and we return
// the existing ID — no duplicate delivery.
async function enqueue({ channel, recipient, recipient_name, recipient_role,
                         message_type, subject, body, attachments,
                         entity_type, entity_id, metadata, priority, correlation_id, session }) {
    const idempotencyKey = _idempotencyKey({ entity_type, entity_id, message_type, recipient });

    try {
        const result = await db.query(
            `INSERT INTO notification_queue
                (channel, recipient, recipient_name, recipient_role,
                 message_type, subject, body, attachments,
                 entity_type, entity_id, metadata, idempotency_key, priority, correlation_id, session)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             RETURNING id`,
            [
                channel || 'whatsapp',
                recipient,
                recipient_name || null,
                recipient_role || null,
                message_type,
                subject || null,
                body,
                attachments ? JSON.stringify(attachments) : null,
                entity_type || null,
                entity_id || null,
                metadata ? JSON.stringify(metadata) : null,
                idempotencyKey,
                priority || 'normal',
                correlation_id || null,
                session || 'default',
            ]
        );
        return result.rows[0].id;
    } catch (err) {
        // Unique constraint violation — message already queued/sent
        if (err.code === '23505') {
            const existing = await db.query(
                `SELECT id FROM notification_queue WHERE idempotency_key = $1`,
                [idempotencyKey]
            );
            if (existing.rows.length > 0) {
                return existing.rows[0].id;
            }
        }
        throw err;
    }
}

// ── In-app notification (Notification Center bell icon) ─────────────────────
async function notifyInApp({ user_id, target_role, category, icon, title, body, link,
                              priority, entity_type, entity_id, metadata, correlation_id }) {
    await db.query(
        `INSERT INTO notifications
            (user_id, target_role, category, icon, title, body, link,
             priority, entity_type, entity_id, metadata, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
            user_id || null,
            target_role || null,
            category || 'system',
            icon || 'fa-bell',
            title,
            body || null,
            link || null,
            priority || 'normal',
            entity_type || null,
            entity_id || null,
            metadata ? JSON.stringify(metadata) : null,
            correlation_id || null,
        ]
    );
}

// ── Generate correlation ID ──────────────────────────────────────────────────
// Format: APR-YYYYMMDD-XXXX (unique per approval event)
function generateCorrelationId(prefix = 'EVT') {
    const date = new Date();
    const ymd = date.getFullYear().toString() +
        String(date.getMonth() + 1).padStart(2, '0') +
        String(date.getDate()).padStart(2, '0');
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${ymd}-${rand}`;
}

// ── Get admin recipients from DB (not env var) ──────────────────────────────
async function getAdminRecipients() {
    try {
        const result = await db.query(
            `SELECT value FROM notification_settings WHERE key = 'admin_whatsapp_recipients'`
        );
        if (result.rows.length > 0) {
            let val = result.rows[0].value;
            if (typeof val === 'string') { try { val = JSON.parse(val); } catch { val = []; } }
            if (Array.isArray(val)) return val;
        }
    } catch { }
    // Fallback to env var if DB has no recipients
    const envChatId = process.env.WAHA_ADMIN_CHAT_ID;
    if (envChatId) return [{ name: 'الإدارة', phone: envChatId }];
    return [];
}

// ── Write outbox event (same transaction as business operation) ─────────────
// This ensures no message is lost even if the server crashes mid-approval.
async function writeOutboxEvent({ event_type, entity_type, entity_id, correlation_id, payload, session }, client) {
    const queryFn = client ? client.query.bind(client) : db.query;
    await queryFn(
        `INSERT INTO notification_outbox
            (event_type, entity_type, entity_id, correlation_id, payload, session)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [event_type, entity_type, entity_id, correlation_id, JSON.stringify(payload), session || 'default']
    );
}

// ── Convenience: Design Approved ────────────────────────────────────────────
// Enqueues 3 WhatsApp messages (client, admin, designer) + in-app notifications.
// Called from approval-service.js after package generation.
// Uses correlation_id to link all related records.
async function notifyDesignApproved(data) {
    const {
        item_id, order_id, order_number, client_name, client_phone,
        product_name, size_name, signer_name, certificate_number,
        approved_at, verify_url, pdf_path, cert_image_path,
        design_image_path, designer_phone, designer_name,
    } = data;

    // Generate correlation ID for this approval event
    const correlationId = data.correlation_id || generateCorrelationId('APR');

    const dateStr = new Date(approved_at).toLocaleDateString('en-GB');
    const timeStr = new Date(approved_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    // 1. Message to Client (PDF + image, NO ZIP — WhatsApp compresses files)
    if (client_phone) {
        const chatId = WhatsApp.normalizePhone(client_phone);
        const tpl = await TemplateEngine.render('design_approved_client', 'ar', {
            client_name: client_name || '',
            certificate_number,
            product_name: product_name || '—',
            approved_date: dateStr,
            verify_url: verify_url,
        });
        const clientBody = tpl ? tpl.body :
            `السلام عليكم ${client_name || ''}\n\nنعتز بثقتكم في G.PACK\n\nتم اعتماد تصميمكم بنجاح ✅\n\n📦 المنتج: ${product_name || '—'}\n📋 رقم الاعتماد: ${certificate_number}\n📅 تاريخ الاعتماد: ${dateStr}\n\n📎 مرفق لكم:\n• صورة التصميم المعتمد\n• شهادة الاعتماد\n• ملف PDF التفصيلي\n\nللتحقق من صحة الاعتماد:\n${verify_url}\n\nشكراً لتعاملكم معنا 🌹`;
        const clientSubject = tpl ? tpl.subject : `اعتماد تصميم — ${certificate_number}`;

        const clientAttachments = [];
        if (design_image_path) clientAttachments.push({ type: 'image', path: design_image_path, caption: `صورة التصميم المعتمد — ${product_name || ''}` });
        if (cert_image_path) clientAttachments.push({ type: 'image', path: cert_image_path, caption: `شهادة الاعتماد — ${certificate_number}` });
        if (pdf_path) clientAttachments.push({ type: 'file', path: pdf_path, caption: `اعتماد التصميم — ${certificate_number}` });

        await enqueue({
            channel: 'whatsapp',
            recipient: chatId,
            recipient_name: client_name,
            recipient_role: 'client',
            message_type: 'design_approved_client',
            subject: clientSubject,
            body: clientBody,
            attachments: clientAttachments,
            entity_type: 'order_item',
            entity_id: item_id,
            metadata: { certificate_number, order_number },
            priority: 'high',
            correlation_id: correlationId,
        });
    }

    // 2. Message to Management (from DB, not env var) — includes ZIP
    const adminRecipients = await getAdminRecipients();
    for (const admin of adminRecipients) {
        const adminPhone = admin.phone || admin.chat_id;
        if (!adminPhone) continue;
        const adminChatId = WhatsApp.normalizePhone(adminPhone);
        const adminTpl = await TemplateEngine.render('design_approved_admin', 'ar', {
            certificate_number,
            client_name,
            product_name: product_name || '—',
            signer_name: signer_name || '—',
            approved_time: timeStr,
            correlation_id: correlationId,
        });
        const adminBody = adminTpl ? adminTpl.body :
            `📢 تم اعتماد تصميم جديد\n\n👤 العميل: ${client_name}\n📦 المنتج: ${product_name || '—'}\n✍️ المعتمد: ${signer_name || '—'}\n⏰ وقت الاعتماد: ${timeStr}\n📋 رقم الاعتماد: ${certificate_number}\n\n📎 مرفق: ملف PDF + شهادة الاعتماد`;
        const adminSubject = adminTpl ? adminTpl.subject : `اعتماد تصميم — ${certificate_number}`;

        const adminAttachments = [];
        if (design_image_path) adminAttachments.push({ type: 'image', path: design_image_path, caption: `صورة التصميم — ${product_name || ''}` });
        if (pdf_path) adminAttachments.push({ type: 'file', path: pdf_path, caption: `اعتماد التصميم — ${certificate_number}` });
        if (cert_image_path) adminAttachments.push({ type: 'image', path: cert_image_path, caption: `شهادة الاعتماد — ${certificate_number}` });

        await enqueue({
            channel: 'whatsapp',
            recipient: adminChatId,
            recipient_name: admin.name || 'الإدارة',
            recipient_role: 'admin',
            message_type: 'design_approved_admin',
            subject: adminSubject,
            body: adminBody,
            attachments: adminAttachments,
            entity_type: 'order_item',
            entity_id: item_id,
            metadata: { certificate_number, order_number },
            priority: 'high',
            correlation_id: correlationId,
        });
    }

    // 3. In-app notifications for ERP users (designer gets in-app only, NOT WhatsApp)
    await notifyInApp({
        target_role: 'manager',
        category: 'approval',
        icon: 'fa-circle-check',
        title: `تم اعتماد تصميم — ${certificate_number}`,
        body: `العميل: ${client_name} | المنتج: ${product_name || '—'} | المعتمد: ${signer_name || '—'}`,
        link: `/orders/${order_id}`,
        priority: 'high',
        entity_type: 'order_item',
        entity_id: item_id,
        metadata: { certificate_number, order_number, client_name },
        correlation_id: correlationId,
    });

    await notifyInApp({
        target_role: 'designer',
        category: 'approval',
        icon: 'fa-circle-check',
        title: `🎉 تم اعتماد تصميمك — Offer #${order_number}`,
        body: `${product_name || '—'} — العميل اعتمد التصميم`,
        link: `/designer`,
        priority: 'normal',
        entity_type: 'order_item',
        entity_id: item_id,
        metadata: { certificate_number, order_number },
        correlation_id: correlationId,
    });

    return correlationId;
}

// ── Convenience: Design Sent to Client ──────────────────────────────────────
async function notifyDesignSentToClient(data) {
    const { item_id, order_id, order_number, client_name, client_phone, share_url } = data;

    if (client_phone) {
        const chatId = WhatsApp.normalizePhone(client_phone);
        const body =
            `مرحباً ${client_name}\n\n` +
            `تم إرسال تصميم لمراجعتك.\n` +
            `رقم العرض: #${order_number}\n\n` +
            `يرجى مراجعة التصميم عبر الرابط التالي:\n${share_url}`;

        await enqueue({
            channel: 'whatsapp',
            recipient: chatId,
            recipient_name: client_name,
            recipient_role: 'client',
            message_type: 'design_sent_to_client',
            body,
            entity_type: 'order_item',
            entity_id: item_id,
            metadata: { order_number, share_url },
        });
    }

    await notifyInApp({
        target_role: 'manager',
        category: 'design',
        icon: 'fa-paper-plane',
        title: `تم إرسال التصميم للعميل — Offer #${order_number}`,
        body: `العميل: ${client_name}`,
        link: `/orders/${order_id}`,
        entity_type: 'order_item',
        entity_id: item_id,
    });
}

// ── Convenience: Client Opened Link ─────────────────────────────────────────
async function notifyClientOpenedLink(data) {
    const { item_id, order_id, order_number, client_name, event_type } = data;

    const eventLabels = {
        'link_opened': 'فتح العميل رابط المراجعة',
        'design_viewed': 'شاهد العميل التصميم',
        'file_downloaded': 'حمّل العميل ملف',
        'signature_captured': 'وقع العميل',
        'item_approved': 'اعتمد العميل التصميم',
        'item_revision_requested': 'طلب العميل تعديلات',
    };

    const label = eventLabels[event_type] || event_type;

    await notifyInApp({
        target_role: 'manager',
        category: 'design',
        icon: event_type === 'item_approved' ? 'fa-circle-check' : 'fa-eye',
        title: label,
        body: `العميل: ${client_name} | Offer #${order_number}`,
        link: `/orders/${order_id}`,
        priority: event_type === 'item_approved' ? 'high' : 'normal',
        entity_type: 'order_item',
        entity_id: item_id,
        metadata: { event_type, order_number },
    });
}

// =============================================================================
// Internal WhatsApp Notifications (second number)
// Operational alerts: manager pricing, warehouse receipts, release orders.
// Feature-flagged. All disabled by default.
// =============================================================================

async function _getSetting(key) {
    try {
        const result = await db.query(
            `SELECT value FROM notification_settings WHERE key = $1`,
            [key]
        );
        if (result.rows.length === 0) return null;
        let val = result.rows[0].value;
        // JSONB is already parsed by pg; only try JSON.parse for legacy text values.
        // If parse fails, keep the original string so phone numbers are not lost.
        if (typeof val === 'string') {
            try { val = JSON.parse(val); } catch { /* keep original string */ }
        }
        return val;
    } catch (err) {
        console.error(`[NotificationService] Setting read error (${key}):`, err.message);
        return null;
    }
}

async function _isInternalWhatsAppEnabled() {
    const enabled = await _getSetting('internal_whatsapp_enabled');
    return enabled === true || enabled === 'true';
}

// ── Convenience: Quotation needs pricing ─────────────────────────────────────
async function notifyQuotationNeedsPricing({ order_id, order_number, client_name, unpriced_count }) {
    if (!await _isInternalWhatsAppEnabled()) return null;
    const phone = await _getSetting('manager_whatsapp_phone');
    if (!phone) return null;

    const body =
        `📋 عرض سعر بحاجة تسعير\n\n` +
        `رقم العرض: #${order_number}\n` +
        `العميل: ${client_name || '—'}\n` +
        `أصناف بدون سعر: ${unpriced_count}\n\n` +
        `يرجى المراجعة وتحديد الأسعار.`;

    const id = await enqueue({
        channel: 'whatsapp',
        recipient: WhatsApp.ensureChatId(phone),
        recipient_name: 'المدير',
        recipient_role: 'manager',
        message_type: 'quotation_needs_pricing',
        body,
        entity_type: 'order',
        entity_id: order_id,
        metadata: { order_number, unpriced_count, client_name },
        priority: 'high',
        session: 'internal',
    });

    await notifyInApp({
        target_role: 'manager',
        category: 'quotation',
        icon: 'fa-tags',
        title: `عرض سعر #${order_number} بحاجة تسعير`,
        body: `العميل: ${client_name || '—'} | ${unpriced_count} صنف بدون سعر`,
        link: `/quotations`,
        priority: 'high',
        entity_type: 'order',
        entity_id: order_id,
    });

    return id;
}

// ── Convenience: Direct receipt created ──────────────────────────────────────
async function notifyDirectReceiptCreated({ receipt_id, receipt_number, item_count, received_by_name, warehouse_name }) {
    if (!await _isInternalWhatsAppEnabled()) return null;
    const phone = await _getSetting('manager_whatsapp_phone');
    if (!phone) return null;

    const body =
        `📦 استلام بضاعة مؤقت\n\n` +
        `رقم الاستلام: #${receipt_number}\n` +
        `عدد الأصناف: ${item_count}\n` +
        `استلمها: ${received_by_name || 'أمين المستودع'}\n` +
        `المستودع: ${warehouse_name || '—'}\n\n` +
        `بانتظار مراجعتك وتحويلها لفاتورة شراء.`;

    const id = await enqueue({
        channel: 'whatsapp',
        recipient: WhatsApp.ensureChatId(phone),
        recipient_name: 'المدير',
        recipient_role: 'manager',
        message_type: 'direct_receipt_created',
        body,
        entity_type: 'direct_receipt',
        entity_id: receipt_id,
        metadata: { receipt_number, item_count, warehouse_name },
        priority: 'normal',
        session: 'internal',
    });

    await notifyInApp({
        target_role: 'manager',
        category: 'warehouse',
        icon: 'fa-warehouse',
        title: `استلام مؤقت #${receipt_number} بانتظار المراجعة`,
        body: `${item_count} صنف | استلمها: ${received_by_name || '—'}`,
        link: `/direct-receipts`,
        priority: 'normal',
        entity_type: 'direct_receipt',
        entity_id: receipt_id,
    });

    return id;
}

// ── Convenience: Release order created ───────────────────────────────────────
async function notifyReleaseOrderCreated({ order_id, order_number, client_name, items_summary, warehouse_name }) {
    if (!await _isInternalWhatsAppEnabled()) return null;
    const phone = await _getSetting('warehouse_keeper_whatsapp_phone');
    if (!phone) return null;

    const body =
        `📤 أمر فسح بضاعة\n\n` +
        `رقم الأمر: #${order_number}\n` +
        `العميل: ${client_name || '—'}\n` +
        `المستودع: ${warehouse_name || '—'}\n\n` +
        `الأصناف:\n${items_summary}\n\n` +
        `يرجى الاستلام وتجهيز البضاعة للإفراج.`;

    const id = await enqueue({
        channel: 'whatsapp',
        recipient: WhatsApp.ensureChatId(phone),
        recipient_name: 'أمين المستودع',
        recipient_role: 'warehouse_keeper',
        message_type: 'release_order_created',
        body,
        entity_type: 'order',
        entity_id: order_id,
        metadata: { order_number, client_name, warehouse_name },
        priority: 'high',
        session: 'internal',
    });

    await notifyInApp({
        target_role: 'warehouse_keeper',
        category: 'warehouse',
        icon: 'fa-truck',
        title: `أمر فسح #${order_number} — ${client_name || '—'}`,
        body: items_summary,
        link: `/orders/${order_id}`,
        priority: 'high',
        entity_type: 'order',
        entity_id: order_id,
    });

    return id;
}

// ── Convenience: WhatsApp Failed ────────────────────────────────────────────
async function notifyWhatsAppFailed(data) {
    const { queue_id, recipient, recipient_name, error, message_type } = data;

    await notifyInApp({
        target_role: 'manager',
        category: 'whatsapp',
        icon: 'fa-triangle-exclamation',
        title: `فشل إرسال واتساب — ${recipient_name || recipient}`,
        body: `النوع: ${message_type} | الخطأ: ${error}`,
        link: `/whatsapp-center`,
        priority: 'high',
        metadata: { queue_id, recipient, error },
    });
}

module.exports = {
    enqueue,
    notifyInApp,
    notifyDesignApproved,
    notifyDesignSentToClient,
    notifyClientOpenedLink,
    notifyWhatsAppFailed,
    notifyQuotationNeedsPricing,
    notifyDirectReceiptCreated,
    notifyReleaseOrderCreated,
    generateCorrelationId,
    getAdminRecipients,
    writeOutboxEvent,
    WhatsApp, // Expose for worker
};
