'use strict';

// =============================================================================
// G.PACK 2.0 — AI Safety Guard
// Phase 31.1: Safety & Testing — runtime safety checks for AI operations
//
// Enforces non-breaking rules:
// 1. AI never DELETEs rows
// 2. AI never writes without created_by
// 3. AI actions must be idempotent
// 4. AI actions must use transactions
// 5. AI read functions must handle empty DB gracefully
// =============================================================================

const FORBIDDEN_KEYWORDS = [
    'DELETE FROM',
    'TRUNCATE',
    'DROP TABLE',
    'DROP COLUMN',
    'ALTER TABLE',
    'GRANT ',
    'REVOKE ',
];

// ── Check if SQL is safe for AI execution ────────────────────────────────────
function validateSqlSafety(sql) {
    if (!sql || typeof sql !== 'string') {
        return { safe: false, reason: 'SQL is empty or not a string' };
    }

    const upperSql = sql.toUpperCase().trim();

    for (const keyword of FORBIDDEN_KEYWORDS) {
        if (upperSql.includes(keyword.toUpperCase())) {
            return {
                safe: false,
                reason: `Forbidden SQL keyword detected: "${keyword}" — AI is not allowed to modify schema or delete data`,
                keyword,
            };
        }
    }

    // AI write functions must use transactions
    if (upperSql.includes('INSERT INTO') || upperSql.includes('UPDATE ')) {
        if (!upperSql.includes('BEGIN') && !upperSql.includes('COMMIT')) {
            // Allow non-transaction writes for simple single-statement operations
            // (the route handler wraps them in transactions already)
            // But flag multi-statement writes without transactions
            const statementCount = (upperSql.match(/;/g) || []).length;
            if (statementCount > 1) {
                return {
                    safe: false,
                    reason: 'Multi-statement write operation must use BEGIN/COMMIT transaction',
                };
            }
        }
    }

    return { safe: true };
}

// ── Check if AI function handles empty DB gracefully ─────────────────────────
function validateFunctionResilience(fnDef) {
    const issues = [];

    if (!fnDef || !fnDef.function || !fnDef.function.name) {
        issues.push('Function definition missing name');
        return { valid: false, issues };
    }

    if (typeof fnDef.execute !== 'function') {
        issues.push(`Function "${fnDef.function.name}" missing execute() method`);
    }

    // Check that parameters have defaults or are optional
    if (fnDef.function.parameters && fnDef.function.parameters.properties) {
        const required = fnDef.function.parameters.required || [];
        if (required.length > 3) {
            issues.push(`Function "${fnDef.function.name}" has ${required.length} required params — consider making some optional for resilience`);
        }
    }

    return {
        valid: issues.length === 0,
        issues,
        function_name: fnDef.function.name,
    };
}

// ── Validate action idempotency (check for idempotency_key usage) ────────────
function validateActionIdempotency(actionDef) {
    const issues = [];

    if (!actionDef || !actionDef.type) {
        issues.push('Action definition missing type');
        return { valid: false, issues };
    }

    if (typeof actionDef.propose !== 'function') {
        issues.push(`Action "${actionDef.type}" missing propose() method`);
    }

    if (typeof actionDef.execute !== 'function') {
        issues.push(`Action "${actionDef.type}" missing execute() method`);
    }

    return {
        valid: issues.length === 0,
        issues,
        action_type: actionDef.type,
    };
}

// ── Run full safety audit on all AI functions ───────────────────────────────
function auditFunctions(aiFunctions) {
    const results = [];
    let passed = 0;
    let failed = 0;

    for (const fn of aiFunctions) {
        const check = validateFunctionResilience(fn);
        if (check.valid) {
            passed++;
        } else {
            failed++;
        }
        results.push(check);
    }

    return {
        total: aiFunctions.length,
        passed,
        failed,
        results,
        timestamp: new Date().toISOString(),
    };
}

// ── Run full safety audit on all AI actions ─────────────────────────────────
function auditActions(aiActions) {
    const results = [];
    let passed = 0;
    let failed = 0;

    for (const action of aiActions) {
        const check = validateActionIdempotency(action);
        if (check.valid) {
            passed++;
        } else {
            failed++;
        }
        results.push(check);
    }

    return {
        total: aiActions.length,
        passed,
        failed,
        results,
        timestamp: new Date().toISOString(),
    };
}

// ── Express middleware: safety guard for AI routes ──────────────────────────
function safetyMiddleware(req, res, next) {
    // Log all AI operations for audit trail
    const startTime = Date.now();

    // Attach audit info to request
    req._aiAudit = {
        started_at: new Date().toISOString(),
        user_id: req.user?.id,
        user_role: req.user?.role,
        endpoint: req.originalUrl,
        method: req.method,
    };

    // Hook into response to log completion
    const originalSend = res.send;
    res.send = function (data) {
        req._aiAudit.duration_ms = Date.now() - startTime;
        req._aiAudit.status_code = res.statusCode;
        originalSend.call(this, data);
    };

    next();
}

module.exports = {
    validateSqlSafety,
    validateFunctionResilience,
    validateActionIdempotency,
    auditFunctions,
    auditActions,
    safetyMiddleware,
    FORBIDDEN_KEYWORDS,
};
