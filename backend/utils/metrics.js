'use strict';

// =============================================================================
// G.PACK 2.0 — Metrics (Prometheus-style)
// Exposes /api/metrics endpoint with key operational metrics.
// No external dependencies — pure Node.js implementation.
// =============================================================================

const db = require('../db');

// In-memory counters (reset on restart — for persistence, use DB)
const _counters = {
    worker_jobs_total: 0,
    worker_jobs_success: 0,
    worker_jobs_failed: 0,
    worker_jobs_retried: 0,
    worker_jobs_dlq: 0,
    approvals_total: 0,
    approval_packages_generated: 0,
    approval_package_failures: 0,
    notifications_sent: 0,
    notifications_failed: 0,
    waha_requests_total: 0,
    waha_requests_failed: 0,
};

const _histograms = {
    approval_duration_ms: [],
    pdf_generation_ms: [],
    zip_creation_ms: [],
    waha_latency_ms: [],
};

function inc(name, value = 1) {
    if (_counters.hasOwnProperty(name)) {
        _counters[name] += value;
    }
}

function observe(name, valueMs) {
    if (_histograms.hasOwnProperty(name)) {
        _histograms[name].push(valueMs);
        if (_histograms[name].length > 1000) {
            _histograms[name].shift(); // rolling window
        }
    }
}

function _percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * p);
    return sorted[idx] || 0;
}

async function collectMetrics() {
    // DB-based metrics
    let queuePending = 0, queueProcessing = 0, queueFailed = 0, dlqCount = 0;
    let outboxPending = 0;
    let approvalsReady = 0, approvalsPending = 0;

    try {
        const qRes = await db.query(`
            SELECT
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
            FROM notification_queue
        `);
        if (qRes.rows[0]) {
            queuePending = parseInt(qRes.rows[0].pending) || 0;
            queueProcessing = parseInt(qRes.rows[0].processing) || 0;
            queueFailed = parseInt(qRes.rows[0].failed) || 0;
        }

        const dlqRes = await db.query(`SELECT COUNT(*) AS count FROM notification_dead_queue`);
        dlqCount = parseInt(dlqRes.rows[0]?.count) || 0;

        const obRes = await db.query(`SELECT COUNT(*) AS count FROM notification_outbox WHERE status = 'pending'`);
        outboxPending = parseInt(obRes.rows[0]?.count) || 0;

        const apRes = await db.query(`
            SELECT
                SUM(CASE WHEN package_state = 'ready' THEN 1 ELSE 0 END) AS ready,
                SUM(CASE WHEN package_state NOT IN ('ready', 'notified') THEN 1 ELSE 0 END) AS pending
            FROM design_approvals
        `);
        if (apRes.rows[0]) {
            approvalsReady = parseInt(apRes.rows[0].ready) || 0;
            approvalsPending = parseInt(apRes.rows[0].pending) || 0;
        }
    } catch (e) {
        // DB might be temporarily unavailable
    }

    // Build Prometheus-style text output
    const lines = [];

    // Counters
    for (const [name, value] of Object.entries(_counters)) {
        lines.push(`# TYPE ${name} counter`);
        lines.push(`${name} ${value}`);
    }

    // DB gauges
    const gauges = {
        queue_pending: queuePending,
        queue_processing: queueProcessing,
        queue_failed: queueFailed,
        dlq_count: dlqCount,
        outbox_pending: outboxPending,
        approvals_ready: approvalsReady,
        approvals_pending: approvalsPending,
    };
    for (const [name, value] of Object.entries(gauges)) {
        lines.push(`# TYPE ${name} gauge`);
        lines.push(`${name} ${value}`);
    }

    // Histograms (summary stats)
    for (const [name, values] of Object.entries(_histograms)) {
        if (values.length === 0) continue;
        lines.push(`# TYPE ${name} summary`);
        lines.push(`${name}_count ${values.length}`);
        lines.push(`${name}_avg ${Math.round(values.reduce((a, b) => a + b, 0) / values.length)}`);
        lines.push(`${name}_p50 ${_percentile(values, 0.5)}`);
        lines.push(`${name}_p95 ${_percentile(values, 0.95)}`);
        lines.push(`${name}_p99 ${_percentile(values, 0.99)}`);
        lines.push(`${name}_max ${Math.max(...values)}`);
    }

    return lines.join('\n');
}

module.exports = {
    inc,
    observe,
    collectMetrics,
    _counters,
};
