'use strict';

// =============================================================================
// G.PACK 2.0 — Audit Trail Middleware
// Records all CUD (Create, Update, Delete) operations into audit_logs table.
// Usage:
//   const audit = require('../middleware/audit');
//   await audit.log(req, 'orders', recordId, 'CREATE', null, newOrder);
// =============================================================================

const db = require('../db');

/**
 * Log an operation to the audit trail.
 * @param {Object}  req       - Express request object (contains user, ip, user-agent)
 * @param {string}  tableName - Database table affected (e.g. 'orders', 'invoices')
 * @param {number}  recordId  - Primary key of the affected record
 * @param {string}  action    - 'CREATE', 'UPDATE', or 'DELETE'
 * @param {Object|null} oldData - Previous state of the record (null for CREATE)
 * @param {Object|null} newData - New state of the record (null for DELETE)
 */
async function _logAudit(req, tableName, recordId, action, oldData = null, newData = null) {
    try {
        const userId = req.user?.id || null;
        const userName = req.user?.name || req.user?.username || null;
        const ipAddress = req.ip || req.connection?.remoteAddress || null;
        const userAgent = req.headers?.['user-agent'] || null;

        await db.query(`
            INSERT INTO audit_logs (table_name, record_id, action, old_data, new_data, user_id, user_name, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
            tableName, recordId, action,
            oldData ? JSON.stringify(oldData) : null,
            newData ? JSON.stringify(newData) : null,
            userId, userName, ipAddress, userAgent,
        ]);
    } catch (err) {
        // Audit should never break the main operation — log and move on
        console.error(`[Audit] Failed to log ${action} on ${tableName}#${recordId}:`, err.message);
    }
}

/**
 * Higher-order function: wraps a handler function with automatic audit logging.
 * Captures old_data before and new_data after the operation.
 * @param {string}   tableName - The database table
 * @param {string}   action    - 'CREATE', 'UPDATE', 'DELETE'
 * @param {Function} fetchOld  - async (req) => old record data (null for CREATE)
 * @param {Function} fetchNew  - async (req) => new record data (null for DELETE)
 * @param {Function} getRecordId - async (req) => the record PK
 * @param {Function} handler   - the route handler (req, res, next) => response
 */
function _auditWrapper(tableName, action, fetchOld, fetchNew, getRecordId, handler) {
    return async (req, res, next) => {
        try {
            // Capture old data before the operation (for UPDATE/DELETE)
            const oldData = fetchOld ? await fetchOld(req) : null;

            // Proceed with the original handler
            await handler(req, res, next);

            // Only log if the response was successful (2xx)
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const recordId = getRecordId ? await getRecordId(req) : null;
                const newData = fetchNew ? await fetchNew(req) : null;
                await _logAudit(req, tableName, recordId, action, oldData, newData);
            }
        } catch (err) {
            console.error(`[AuditWrapper] Error in ${action} on ${tableName}:`, err.message);
            next(err);
        }
    };
}

module.exports = {
    log: _logAudit,
    wrap: _auditWrapper,
};