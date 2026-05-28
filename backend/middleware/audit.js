'use strict';

const db = require('../db');

// =============================================================================
// Audit Middleware
// Logs important actions to audit_logs table
// =============================================================================

/**
 * Create audit log middleware
 * @param {string} action - Action type (CREATE, UPDATE, DELETE, etc.)
 * @param {string} entityType - Entity type (order, invoice, etc.)
 * @returns {Function} Express middleware
 */
const audit = (action, entityType) => {
    return async (req, res, next) => {
        // Store original json method
        const originalJson = res.json.bind(res);
        
        // Override json method to log after successful response
        res.json = async (data) => {
            // Only log successful operations (status < 400) and if user is authenticated
            if (res.statusCode < 400 && req.user) {
                try {
                    // Extract entity ID from response data or request params
                    const entityId = data?.data?.id || data?.id || req.params.id || null;
                    
                    // Get IP address
                    const ipAddress = req.ip || req.connection.remoteAddress || null;
                    
                    // Get user agent
                    const userAgent = req.get('user-agent') || null;
                    
                    // Log to audit_logs table (fire and forget - don't block response)
                    setImmediate(async () => {
                        try {
                            await db.query(
                                `INSERT INTO audit_logs 
                                 (user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
                                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                                [
                                    req.user.id,
                                    action,
                                    entityType,
                                    entityId,
                                    JSON.stringify(req.body),
                                    ipAddress,
                                    userAgent
                                ]
                            );
                        } catch (err) {
                            // Log error but don't fail the request
                            console.error('[Audit] Failed to log action:', err.message);
                        }
                    });
                } catch (err) {
                    // Silently fail - audit logging should never break the app
                    console.error('[Audit] Error in audit middleware:', err.message);
                }
            }
            
            // Call original json method
            originalJson(data);
        };
        
        next();
    };
};

/**
 * Log a custom audit entry
 * @param {Object} params - Audit log parameters
 */
const logAudit = async ({ userId, action, entityType, entityId, oldValues, newValues, ipAddress, userAgent }) => {
    try {
        await db.query(
            `INSERT INTO audit_logs 
             (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                userId,
                action,
                entityType,
                entityId,
                oldValues ? JSON.stringify(oldValues) : null,
                newValues ? JSON.stringify(newValues) : null,
                ipAddress,
                userAgent
            ]
        );
    } catch (err) {
        console.error('[Audit] Failed to log custom audit:', err.message);
    }
};

module.exports = {
    audit,
    logAudit
};
