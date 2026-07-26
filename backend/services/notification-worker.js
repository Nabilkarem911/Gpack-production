'use strict';

// =============================================================================
// G.PACK 2.0 — Notification Worker (Standalone Process)
// Run as: node services/notification-worker.js
// OR via docker-compose service: notification-worker
//
// Features:
//   - Priority-based processing (HIGH → NORMAL → LOW)
//   - Exponential backoff: 1m → 5m → 15m → 1h → 4h, max 5 attempts
//   - Idempotency via DB unique constraint (no duplicate delivery)
//   - Attachment fallback: PDF fails → image → text only (never all fail)
//   - Retry history tracked in JSONB column
//   - Notifies ERP managers on permanent failure
// =============================================================================

const db = require('../db');
const WhatsApp = require('./whatsapp-service');
const NotificationService = require('./notification-service');

const POLL_INTERVAL_MS = 15000; // 15 seconds
const BACKOFF_MINUTES = [1, 5, 15, 60, 240]; // 1m, 5m, 15m, 1h, 4h

let _polling = false;
let _intervalId = null;

// ── Start the worker ────────────────────────────────────────────────────────
function start() {
    if (_intervalId) return;
    console.log('[NotificationWorker] Starting — polling every 15s (priority-based)');
    _intervalId = setInterval(_processQueue, POLL_INTERVAL_MS);
    _processQueue();
}

// ── Stop the worker ─────────────────────────────────────────────────────────
function stop() {
    if (_intervalId) {
        clearInterval(_intervalId);
        _intervalId = null;
        console.log('[NotificationWorker] Stopped');
    }
}

// ── Process pending queue items (priority-based) ────────────────────────────
async function _processQueue() {
    if (_polling) return;
    _polling = true;

    try {
        // Claim up to 10 pending items — HIGH priority first, then by next_attempt_at
        const claimRes = await db.query(
            `UPDATE notification_queue
             SET status = 'processing',
                 updated_at = NOW()
             WHERE id IN (
                 SELECT id FROM notification_queue
                 WHERE status = 'pending'
                   AND next_attempt_at <= NOW()
                 ORDER BY
                     CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                     next_attempt_at ASC
                 LIMIT 10
                 FOR UPDATE SKIP LOCKED
             )
             RETURNING id, channel, recipient, recipient_name, recipient_role,
                       message_type, subject, body, attachments, attempts,
                       entity_type, entity_id, metadata, priority, idempotency_key`,
        );

        if (claimRes.rows.length === 0) return;

        for (const item of claimRes.rows) {
            await _processItem(item);
        }
    } catch (err) {
        console.error('[NotificationWorker] Queue processing error:', err.message);
    } finally {
        _polling = false;
    }
}

// ── Process a single queue item ─────────────────────────────────────────────
async function _processItem(item) {
    const attemptNum = item.attempts + 1;

    try {
        let result = null;
        if (item.channel === 'whatsapp') {
            result = await _sendWhatsApp(item);
        } else if (item.channel === 'email') {
            throw new Error('Email channel not implemented yet');
        } else {
            throw new Error(`Unknown channel: ${item.channel}`);
        }

        // Success
        await db.query(
            `UPDATE notification_queue
             SET status = 'sent',
                 attempts = $1,
                 last_attempt_at = NOW(),
                 sent_at = NOW(),
                 waha_message_id = $2,
                 waha_status = 'sent',
                 updated_at = NOW()
             WHERE id = $3`,
            [attemptNum, result?.id || result?.messageId || null, item.id]
        );
        console.log(`[NotificationWorker] Sent ${item.message_type} to ${item.recipient_name || item.recipient} (attempt ${attemptNum}, priority: ${item.priority})`);

    } catch (err) {
        console.error(`[NotificationWorker] Failed ${item.message_type} to ${item.recipient} (attempt ${attemptNum}):`, err.message);

        const maxAttempts = 5;

        // Append to retry history
        const retryEntry = JSON.stringify({
            attempt: attemptNum,
            error: err.message,
            timestamp: new Date().toISOString(),
        });

        if (attemptNum >= maxAttempts) {
            // Mark as failed permanently
            await db.query(
                `UPDATE notification_queue
                 SET status = 'failed',
                     attempts = $1,
                     last_error = $2,
                     last_attempt_at = NOW(),
                     retry_history = COALESCE(retry_history, '[]') || $3::jsonb,
                     updated_at = NOW()
                 WHERE id = $4`,
                [attemptNum, err.message, retryEntry, item.id]
            );

            // Notify ERP managers about the failure
            try {
                await NotificationService.notifyWhatsAppFailed({
                    queue_id: item.id,
                    recipient: item.recipient,
                    recipient_name: item.recipient_name,
                    error: err.message,
                    message_type: item.message_type,
                });
            } catch { }
        } else {
            // Schedule retry with exponential backoff
            const backoffMin = BACKOFF_MINUTES[attemptNum - 1] || 60;
            const nextAttempt = new Date(Date.now() + backoffMin * 60 * 1000);

            await db.query(
                `UPDATE notification_queue
                 SET status = 'pending',
                     attempts = $1,
                     last_error = $2,
                     last_attempt_at = NOW(),
                     next_attempt_at = $3,
                     retry_history = COALESCE(retry_history, '[]') || $4::jsonb,
                     updated_at = NOW()
                 WHERE id = $5`,
                [attemptNum, err.message, nextAttempt, retryEntry, item.id]
            );

            console.log(`[NotificationWorker] Retry scheduled for ${item.recipient} in ${backoffMin}m (attempt ${attemptNum + 1}/${maxAttempts})`);
        }
    }
}

// ── Send WhatsApp message with attachment fallback ──────────────────────────
// Text always sends first. Then each attachment is tried independently.
// If PDF fails → image still sends → if image fails → text already sent.
// The overall result is success if text sent, even if some attachments failed.
async function _sendWhatsApp(item) {
    if (!WhatsApp.isConfigured()) {
        throw new Error('WhatsApp not configured (WAHA_URL not set)');
    }

    let textSent = false;
    let attachmentErrors = [];

    // 1. Send text message (always try first — if this fails, retry whole message)
    if (item.body) {
        try {
            await WhatsApp.sendText(item.recipient, item.body);
            textSent = true;
        } catch (err) {
            throw new Error(`Text send failed: ${err.message}`);
        }
    }

    // 2. Send attachments independently (fallback — one failure doesn't block others)
    let attachments = item.attachments;
    if (typeof attachments === 'string') {
        try { attachments = JSON.parse(attachments); } catch { attachments = []; }
    }

    if (Array.isArray(attachments)) {
        for (const att of attachments) {
            try {
                if (att.type === 'image') {
                    await WhatsApp.sendImage(item.recipient, att.path, att.caption || '');
                } else if (att.type === 'file') {
                    await WhatsApp.sendFile(item.recipient, att.path, att.caption || '');
                }
            } catch (err) {
                attachmentErrors.push({ type: att.type, path: att.path, error: err.message });
                console.warn(`[NotificationWorker] Attachment failed (${att.type}): ${err.message} — text already sent, continuing`);
            }
        }
    }

    // If text was sent but some attachments failed, log but don't fail the whole message
    if (attachmentErrors.length > 0 && textSent) {
        console.warn(`[NotificationWorker] ${item.message_type} to ${item.recipient}: text sent, ${attachmentErrors.length} attachment(s) failed`);
    }

    return { id: null, attachmentErrors };
}

// ── CLI entry point (when run as standalone process) ────────────────────────
if (require.main === module) {
    console.log('[NotificationWorker] Running as standalone process (PID:', process.pid, ')');

    const shutdown = (signal) => {
        console.log(`[NotificationWorker] ${signal} received, shutting down...`);
        stop();
        setTimeout(() => process.exit(0), 1000);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    start();
}

module.exports = { start, stop };
