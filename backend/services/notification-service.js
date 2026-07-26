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
const WhatsApp = require('./whatsapp-service');

// ── Enqueue a notification ──────────────────────────────────────────────────
// This is the main method the ERP calls. It saves to notification_queue
// and the worker picks it up asynchronously.
async function enqueue({ channel, recipient, recipient_name, recipient_role,
                         message_type, subject, body, attachments,
                         entity_type, entity_id, metadata }) {
    const result = await db.query(
        `INSERT INTO notification_queue
            (channel, recipient, recipient_name, recipient_role,
             message_type, subject, body, attachments,
             entity_type, entity_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        ]
    );
    return result.rows[0].id;
}

// ── In-app notification (Notification Center bell icon) ─────────────────────
async function notifyInApp({ user_id, target_role, category, icon, title, body, link,
                              priority, entity_type, entity_id, metadata }) {
    await db.query(
        `INSERT INTO notifications
            (user_id, target_role, category, icon, title, body, link,
             priority, entity_type, entity_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
        ]
    );
}

// ── Convenience: Design Approved ────────────────────────────────────────────
// Enqueues 3 WhatsApp messages (client, admin, designer) + in-app notifications.
// Called from approval-service.js after package generation.
async function notifyDesignApproved(data) {
    const {
        item_id, order_id, order_number, client_name, client_phone,
        product_name, size_name, signer_name, certificate_number,
        approved_at, verify_url, pdf_path, cert_image_path,
        designer_phone, designer_name,
        admin_chat_id,
    } = data;

    const dateStr = new Date(approved_at).toLocaleDateString('en-GB');
    const timeStr = new Date(approved_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    // 1. Message to Client
    if (client_phone) {
        const chatId = WhatsApp.normalizePhone(client_phone);
        const clientBody =
            `شكراً لكم.\n\n` +
            `تم تسجيل اعتماد التصميم بنجاح.\n\n` +
            `رقم الاعتماد\n${certificate_number}\n\n` +
            `المنتج\n${product_name || '—'}\n\n` +
            `تاريخ الاعتماد\n${dateStr}\n\n` +
            `يمكنكم التحقق من الاعتماد عبر\n${verify_url}`;

        const clientAttachments = [];
        if (cert_image_path) clientAttachments.push({ type: 'image', path: cert_image_path, caption: `شهادة الاعتماد — ${certificate_number}` });
        if (pdf_path) clientAttachments.push({ type: 'file', path: pdf_path, caption: `اعتماد التصميم — ${certificate_number}` });

        await enqueue({
            channel: 'whatsapp',
            recipient: chatId,
            recipient_name: client_name,
            recipient_role: 'client',
            message_type: 'design_approved_client',
            subject: `اعتماد تصميم — ${certificate_number}`,
            body: clientBody,
            attachments: clientAttachments,
            entity_type: 'order_item',
            entity_id: item_id,
            metadata: { certificate_number, order_number },
        });
    }

    // 2. Message to Management
    if (admin_chat_id) {
        const adminBody =
            `تم اعتماد التصميم\n\n` +
            `العميل\n${client_name}\n\n` +
            `المنتج\n${product_name || '—'}\n\n` +
            `المعتمد\n${signer_name || '—'}\n\n` +
            `وقت الاعتماد\n${timeStr}\n\n` +
            `رقم الاعتماد\n${certificate_number}`;

        const adminAttachments = [];
        if (pdf_path) adminAttachments.push({ type: 'file', path: pdf_path, caption: `اعتماد التصميم — ${certificate_number}` });
        if (cert_image_path) adminAttachments.push({ type: 'image', path: cert_image_path, caption: `شهادة الاعتماد — ${certificate_number}` });

        await enqueue({
            channel: 'whatsapp',
            recipient: admin_chat_id,
            recipient_name: 'الإدارة',
            recipient_role: 'admin',
            message_type: 'design_approved_admin',
            subject: `اعتماد تصميم — ${certificate_number}`,
            body: adminBody,
            attachments: adminAttachments,
            entity_type: 'order_item',
            entity_id: item_id,
            metadata: { certificate_number, order_number },
        });
    }

    // 3. Message to Designer
    if (designer_phone) {
        const chatId = WhatsApp.normalizePhone(designer_phone);
        const designerBody =
            `🎉 تم اعتماد تصميمك\n\n` +
            `Offer #${order_number}\n` +
            `Item\n${product_name || '—'}\n\n` +
            `العميل اعتمد التصميم.`;

        await enqueue({
            channel: 'whatsapp',
            recipient: chatId,
            recipient_name: designer_name || 'المصمم',
            recipient_role: 'designer',
            message_type: 'design_approved_designer',
            subject: `تصميم معتمد — Offer #${order_number}`,
            body: designerBody,
            attachments: [],
            entity_type: 'order_item',
            entity_id: item_id,
            metadata: { certificate_number, order_number },
        });
    }

    // 4. In-app notifications for ERP users
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
    });
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
    WhatsApp, // Expose for worker
};
