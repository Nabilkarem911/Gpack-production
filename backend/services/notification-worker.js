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
const { processApproval } = require('./approval-service');
const CircuitBreaker = require('./circuit-breaker');

const POLL_INTERVAL_MS = 15000; // 15 seconds
const HEALTH_CHECK_INTERVAL_MS = 60000; // 60 seconds
const BACKOFF_MINUTES = [1, 5, 15, 60, 240]; // 1m, 5m, 15m, 1h, 4h

let _polling = false;
let _intervalId = null;
let _healthIntervalId = null;
let _lastHealthStatus = null;

// ── Start the worker ────────────────────────────────────────────────────────
function start() {
    if (_intervalId) return;
    console.log('[NotificationWorker] Starting — polling every 15s (priority-based)');
    _intervalId = setInterval(_processQueue, POLL_INTERVAL_MS);
    _processQueue();

    // Start WAHA health monitor
    _healthIntervalId = setInterval(_wahaHealthCheck, HEALTH_CHECK_INTERVAL_MS);
    _wahaHealthCheck();
}

// ── Stop the worker ─────────────────────────────────────────────────────────
function stop() {
    if (_intervalId) {
        clearInterval(_intervalId);
        _intervalId = null;
    }
    if (_healthIntervalId) {
        clearInterval(_healthIntervalId);
        _healthIntervalId = null;
    }
    console.log('[NotificationWorker] Stopped');
}

// ── WAHA Health Check (heartbeat every 60s) ─────────────────────────────────
async function _wahaHealthCheck() {
    if (!WhatsApp.isConfigured()) return;

    const startTime = Date.now();
    let status = 'disconnected';
    let latencyMs = null;
    let errorMsg = null;

    try {
        const result = await WhatsApp.getSessionStatus();
        latencyMs = Date.now() - startTime;

        if (result && result.connected) {
            status = 'connected';
        } else if (result && result.error) {
            errorMsg = result.error;
        }
    } catch (err) {
        latencyMs = Date.now() - startTime;
        errorMsg = err.message;
    }

    // Log to waha_health_log
    try {
        await db.query(
            `INSERT INTO waha_health_log (status, latency_ms, error) VALUES ($1, $2, $3)`,
            [status, latencyMs, errorMsg]
        );
    } catch { }

    // Fire in-app notification on status change
    if (_lastHealthStatus !== null && _lastHealthStatus !== status) {
        console.log(`[NotificationWorker] WAHA status changed: ${_lastHealthStatus} → ${status}`);
        try {
            await NotificationService.notifyInApp({
                target_role: 'manager',
                category: 'whatsapp',
                icon: status === 'connected' ? 'fa-circle-check' : 'fa-triangle-exclamation',
                title: status === 'connected' ? 'واتساب متصل' : 'واتساب غير متصل',
                body: status === 'connected'
                    ? `استعادة الاتصال بـ WAHA (latency: ${latencyMs}ms)`
                    : `انقطاع اتصال WAHA: ${errorMsg || 'unknown error'}`,
                link: '/whatsapp-center',
                priority: status === 'connected' ? 'normal' : 'high',
            });
        } catch { }
    }
    _lastHealthStatus = status;
}

// ── Process pending queue items (priority-based) ────────────────────────────
async function _processQueue() {
    if (_polling) return;
    _polling = true;

    try {
        // Reclaim stuck items (processing for > 10 minutes = worker crash)
        await _reclaimStuckItems();

        // Claim up to 10 pending items — HIGH priority first, then by next_attempt_at
        // Lease token: each claimed item gets a unique lease_id UUID.
        // Only the worker holding the lease can update the item (prevents double processing).
        const claimRes = await db.query(
            `UPDATE notification_queue
             SET status = 'processing',
                 processing_started_at = NOW(),
                 lease_id = gen_random_uuid(),
                 processing_owner = $1,
                 lease_version = lease_version + 1,
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
             RETURNING id, lease_id, lease_version, channel, recipient, recipient_name, recipient_role,
                       message_type, subject, body, attachments, attempts,
                       entity_type, entity_id, metadata, priority, idempotency_key,
                       correlation_id`,
            [`worker-${process.pid}`]
        );

        if (claimRes.rows.length === 0) {
            // Process outbox events (if any)
            await _processOutbox();
            return;
        }

        for (const item of claimRes.rows) {
            await _processItem(item);
        }

        // Also process outbox after queue items
        await _processOutbox();
    } catch (err) {
        console.error('[NotificationWorker] Queue processing error:', err.message);
    } finally {
        _polling = false;
    }
}

// ── Reclaim stuck items (processing for > 10 minutes) ───────────────────────
// If a worker crashes while processing, the item is stuck in 'processing'.
// This sweeper moves them back to 'pending' so they get retried.
async function _reclaimStuckItems() {
    try {
        const result = await db.query(
            `UPDATE notification_queue
             SET status = 'pending',
                 processing_started_at = NULL,
                 lease_id = NULL,
                 processing_owner = NULL,
                 lease_version = lease_version + 1,
                 last_error = 'Reclaimed: processing timeout (>10min)',
                 updated_at = NOW()
             WHERE status = 'processing'
               AND processing_started_at < NOW() - INTERVAL '10 minutes'
             RETURNING id, message_type, recipient`
        );
        if (result.rows.length > 0) {
            console.log(`[NotificationWorker] Reclaimed ${result.rows.length} stuck item(s)`);
        }
    } catch (err) {
        console.error('[NotificationWorker] Reclaim error:', err.message);
    }
}

// ── Process outbox events ───────────────────────────────────────────────────
// The outbox guarantees no message is lost: the business operation and the
// event are written in the same DB transaction. The worker reads the outbox
// and dispatches to NotificationService methods.
async function _processOutbox() {
    try {
        const events = await db.query(
            `UPDATE notification_outbox
             SET status = 'processing'
             WHERE id IN (
                 SELECT id FROM notification_outbox
                 WHERE status = 'pending'
                 ORDER BY created_at ASC
                 LIMIT 5
                 FOR UPDATE SKIP LOCKED
             )
             RETURNING id, event_type, entity_type, entity_id, correlation_id, payload`
        );

        if (events.rows.length === 0) return;

        for (const evt of events.rows) {
            try {
                let payload = evt.payload;
                if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = {}; } }

                // Dispatch based on event_type
                switch (evt.event_type) {
                    case 'design_approved': {
                        // 1. Generate approval package (PDF, certificate image, ZIP)
                        //    This runs synchronously before notifications so file paths exist.
                        try {
                            await processApproval(payload);
                        } catch (err) {
                            console.error(`[NotificationWorker] processApproval failed for ${evt.correlation_id}:`, err.message);
                            // Continue to notifications even if package generation fails
                            // The approval is already committed in DB; notifications should still go out.
                        }

                        // 2. Fetch generated file paths from DB (processApproval stored them)
                        const apprRes = await db.query(
                            `SELECT approval_image_path, approval_pdf_path FROM design_approvals WHERE item_id = $1 ORDER BY id DESC LIMIT 1`,
                            [payload.item_id]
                        );
                        const pdfPath = apprRes.rows[0]?.approval_pdf_path || null;
                        const certPath = apprRes.rows[0]?.approval_image_path || null;

                        // 3. Send notifications with file paths
                        await NotificationService.notifyDesignApproved({
                            ...payload,
                            pdf_path: pdfPath,
                            cert_image_path: certPath,
                            correlation_id: evt.correlation_id,
                        });
                        break;
                    }
                    case 'design_sent_to_client':
                        await NotificationService.notifyDesignSentToClient({
                            ...payload,
                            correlation_id: evt.correlation_id,
                        });
                        break;
                    default:
                        console.warn(`[NotificationWorker] Unknown outbox event: ${evt.event_type}`);
                }

                await db.query(
                    `UPDATE notification_outbox SET status = 'processed', processed_at = NOW() WHERE id = $1`,
                    [evt.id]
                );
            } catch (err) {
                console.error(`[NotificationWorker] Outbox event ${evt.id} failed:`, err.message);
                await db.query(
                    `UPDATE notification_outbox SET status = 'pending', error = $1 WHERE id = $2`,
                    [err.message, evt.id]
                );
            }
        }
    } catch (err) {
        console.error('[NotificationWorker] Outbox processing error:', err.message);
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

        // Success — only update if we still hold the lease (prevents double processing)
        await db.query(
            `UPDATE notification_queue
             SET status = 'sent',
                 attempts = $1,
                 last_attempt_at = NOW(),
                 sent_at = NOW(),
                 waha_message_id = $2,
                 waha_status = 'sent',
                 lease_id = NULL,
                 processing_owner = NULL,
                 updated_at = NOW()
             WHERE id = $3 AND lease_id = $4`,
            [attemptNum, result?.id || result?.messageId || null, item.id, item.lease_id]
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
            // Move to Dead Letter Queue — only if we hold the lease
            await db.query(
                `INSERT INTO notification_dead_queue
                    (original_id, channel, recipient, recipient_name, recipient_role,
                     message_type, subject, body, attachments, entity_type, entity_id,
                     metadata, idempotency_key, priority, correlation_id,
                     attempts, max_attempts, last_error, retry_history,
                     waha_message_id, waha_status, sent_at, delivered_at)
                 SELECT id, channel, recipient, recipient_name, recipient_role,
                        message_type, subject, body, attachments, entity_type, entity_id,
                        metadata, idempotency_key, priority, correlation_id,
                        $1, max_attempts, $2,
                        COALESCE(retry_history, '[]') || $3::jsonb,
                        waha_message_id, waha_status, sent_at, delivered_at
                 FROM notification_queue WHERE id = $4 AND lease_id = $5`,
                [attemptNum, err.message, retryEntry, item.id, item.lease_id]
            );

            // Delete from main queue (it's now in DLQ)
            await db.query(
                `DELETE FROM notification_queue WHERE id = $1 AND lease_id = $2`,
                [item.id, item.lease_id]
            );

            console.error(`[NotificationWorker] Moved ${item.id} to Dead Letter Queue (failed after ${attemptNum} attempts)`);

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
            // Schedule retry with exponential backoff — only if we hold the lease
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
                     lease_id = NULL,
                     processing_owner = NULL,
                     processing_started_at = NULL,
                     updated_at = NOW()
                 WHERE id = $5 AND lease_id = $6`,
                [attemptNum, err.message, nextAttempt, retryEntry, item.id, item.lease_id]
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

    // Circuit Breaker: fail fast if WAHA is down (no timeout waiting)
    const canSend = await CircuitBreaker.canProceed();
    if (!canSend) {
        throw new Error('Circuit breaker OPEN — WAHA unavailable, message queued for retry');
    }

    let textSent = false;
    let attachmentErrors = [];

    // 1. Send text message (always try first — if this fails, retry whole message)
    if (item.body) {
        try {
            await WhatsApp.sendText(item.recipient, item.body);
            textSent = true;
            await CircuitBreaker.recordSuccess();
        } catch (err) {
            await CircuitBreaker.recordFailure();
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
