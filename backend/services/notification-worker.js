'use strict';

// =============================================================================
// G.PACK 2.0 — Notification Worker
// Background worker that processes the notification_queue.
// - Polls every 15 seconds for pending notifications
// - Exponential backoff: 1m → 5m → 15m → 1h → 4h
// - Max 5 attempts, then marked as 'failed'
// - Notifies ERP managers on failure
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
    console.log('[NotificationWorker] Starting — polling every 15s');
    _intervalId = setInterval(_processQueue, POLL_INTERVAL_MS);
    // Process immediately on start
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

// ── Process pending queue items ─────────────────────────────────────────────
async function _processQueue() {
    if (_polling) return;
    _polling = true;

    try {
        // Claim up to 10 pending items whose next_attempt_at has passed
        const claimRes = await db.query(
            `UPDATE notification_queue
             SET status = 'processing',
                 updated_at = NOW()
             WHERE id IN (
                 SELECT id FROM notification_queue
                 WHERE status = 'pending'
                   AND next_attempt_at <= NOW()
                 ORDER BY next_attempt_at ASC
                 LIMIT 10
                 FOR UPDATE SKIP LOCKED
             )
             RETURNING id, channel, recipient, recipient_name, recipient_role,
                       message_type, subject, body, attachments, attempts,
                       entity_type, entity_id, metadata`,
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
        if (item.channel === 'whatsapp') {
            await _sendWhatsApp(item);
        } else if (item.channel === 'email') {
            // Future: EmailService.send(...)
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
                 updated_at = NOW()
             WHERE id = $2`,
            [attemptNum, item.id]
        );
        console.log(`[NotificationWorker] Sent ${item.message_type} to ${item.recipient_name || item.recipient} (attempt ${attemptNum})`);

    } catch (err) {
        console.error(`[NotificationWorker] Failed ${item.message_type} to ${item.recipient} (attempt ${attemptNum}):`, err.message);

        const maxAttempts = 5;

        if (attemptNum >= maxAttempts) {
            // Mark as failed permanently
            await db.query(
                `UPDATE notification_queue
                 SET status = 'failed',
                     attempts = $1,
                     last_error = $2,
                     last_attempt_at = NOW(),
                     updated_at = NOW()
                 WHERE id = $3`,
                [attemptNum, err.message, item.id]
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
                     updated_at = NOW()
                 WHERE id = $4`,
                [attemptNum, err.message, nextAttempt, item.id]
            );

            console.log(`[NotificationWorker] Retry scheduled for ${item.recipient} in ${backoffMin}m (attempt ${attemptNum + 1}/${maxAttempts})`);
        }
    }
}

// ── Send WhatsApp message (text + attachments) ──────────────────────────────
async function _sendWhatsApp(item) {
    if (!WhatsApp.isConfigured()) {
        throw new Error('WhatsApp not configured (WAHA_URL not set)');
    }

    // Send text message
    if (item.body) {
        await WhatsApp.sendText(item.recipient, item.body);
    }

    // Send attachments
    let attachments = item.attachments;
    if (typeof attachments === 'string') {
        try { attachments = JSON.parse(attachments); } catch { attachments = []; }
    }

    if (Array.isArray(attachments)) {
        for (const att of attachments) {
            if (att.type === 'image') {
                await WhatsApp.sendImage(item.recipient, att.path, att.caption || '');
            } else if (att.type === 'file') {
                await WhatsApp.sendFile(item.recipient, att.path, att.caption || '');
            }
        }
    }
}

module.exports = { start, stop };
