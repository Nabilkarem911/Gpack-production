// backend/utils/event-bus.js
// Business Event Bus — unified event logging for all company activities
// Every critical business operation emits an event here

const { pool } = require('../db');

/**
 * Emit a business event.
 * Non-blocking — errors are logged but never crash the caller.
 *
 * @param {Object} params
 * @param {string} params.event_type   — e.g. 'quote_created', 'payment_received'
 * @param {string} params.entity_type  — 'client' | 'order' | 'product' | 'invoice' | 'supplier' | 'payment' | 'delivery' | 'production' | 'task'
 * @param {string|null} params.entity_id   — UUID of the related entity
 * @param {string|null} params.entity_name — human-readable name
 * @param {string} params.severity      — 'info' | 'warning' | 'critical'
 * @param {string|null} params.description — Arabic description of the event
 * @param {Object|null} params.metadata — additional context (amounts, quantities, etc.)
 * @param {string|null} params.created_by — user UUID
 */
async function emit({ event_type, entity_type, entity_id = null, entity_name = null, severity = 'info', description = null, metadata = null, created_by = null }) {
    try {
        await pool.query(
            `INSERT INTO business_events
                (event_type, entity_type, entity_id, entity_name, severity, description, metadata, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [event_type, entity_type, entity_id, entity_name, severity, description, metadata ? JSON.stringify(metadata) : null, created_by]
        );
    } catch (err) {
        // Never crash the caller — event bus is non-critical
        console.error('[event-bus] Failed to emit event:', event_type, err.message);
    }
}

/**
 * Emit a batch of events in a single transaction.
 * @param {Array} events — array of emit() params
 * @param {string|null} userId — created_by for all events
 */
async function emitBatch(events, userId = null) {
    if (!events || events.length === 0) return;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const ev of events) {
            await client.query(
                `INSERT INTO business_events
                    (event_type, entity_type, entity_id, entity_name, severity, description, metadata, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    ev.event_type,
                    ev.entity_type,
                    ev.entity_id || null,
                    ev.entity_name || null,
                    ev.severity || 'info',
                    ev.description || null,
                    ev.metadata ? JSON.stringify(ev.metadata) : null,
                    ev.created_by || userId
                ]
            );
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[event-bus] Batch emit failed:', err.message);
    } finally {
        client.release();
    }
}

/**
 * Get recent events with optional filters.
 * @param {Object} filters
 * @param {number} filters.limit — max events to return (default 50)
 * @param {string|null} filters.event_type — filter by type
 * @param {string|null} filters.entity_type — filter by entity type
 * @param {string|null} filters.severity — filter by severity
 * @param {number|null} filters.hours — only events from last N hours
 */
async function getRecent({ limit = 50, event_type = null, entity_type = null, severity = null, hours = null } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (event_type) { params.push(event_type); conditions.push(`event_type = $${idx++}`); }
    if (entity_type) { params.push(entity_type); conditions.push(`entity_type = $${idx++}`); }
    if (severity) { params.push(severity); conditions.push(`severity = $${idx++}`); }
    if (hours) { params.push(hours); conditions.push(`created_at >= NOW() - INTERVAL '${parseInt(hours)} hours'`); }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(limit);

    const res = await pool.query(
        `SELECT id, event_type, entity_type, entity_id, entity_name, severity, description, metadata, created_at
         FROM business_events
         ${where}
         ORDER BY created_at DESC
         LIMIT $${idx}`,
        params
    );
    return res.rows;
}

module.exports = {
    emit,
    emitBatch,
    getRecent,
};
