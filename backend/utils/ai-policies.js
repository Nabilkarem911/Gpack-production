// backend/utils/ai-policies.js
// Action Policies — business rules enforced before AI executes any write action
// Every policy is a JS expression evaluated against { proposal, user, args }
// block = stop execution, warn = show warning but allow

const db = require('../db');

/**
 * Check all active policies for a given action_type.
 * @param {string} actionType — e.g. 'create_quote', 'create_client'
 * @param {Object} proposal — the proposal returned by action.propose()
 * @param {Object} user — { id, role, permissions }
 * @param {Object} args — original args from the AI
 * @returns {Object} { passed: boolean, blocks: Array, warnings: Array }
 */
async function checkPolicies(actionType, proposal, user, args) {
    const res = await db.query(
        `SELECT rule_name, rule_condition, severity, message
         FROM action_policies
         WHERE action_type = $1 AND is_active = true
         ORDER BY id`,
        [actionType]
    );

    const blocks = [];
    const warnings = [];

    for (const rule of res.rows) {
        try {
            // Evaluate the rule condition safely
            // We use Function constructor (not eval) for scoped evaluation
            const fn = new Function('proposal', 'user', 'args', 'Math', 'Array', 'parseFloat', 'parseInt',
                `"use strict"; return (${rule.rule_condition});`
            );
            const passed = fn(proposal, user, args, Math, Array, parseFloat, parseInt);

            if (!passed) {
                if (rule.severity === 'block') {
                    blocks.push({
                        rule_name: rule.rule_name,
                        message: rule.message,
                    });
                } else {
                    warnings.push({
                        rule_name: rule.rule_name,
                        message: rule.message,
                    });
                }
            }
        } catch (err) {
            // If rule evaluation fails, treat as warning (don't block on broken rules)
            console.error(`[ai-policies] Rule "${rule.rule_name}" evaluation failed:`, err.message);
            warnings.push({
                rule_name: rule.rule_name,
                message: `تعذر التحقق من القاعدة: ${rule.message}`,
            });
        }
    }

    return {
        passed: blocks.length === 0,
        blocks,
        warnings,
    };
}

/**
 * Get all policies (for admin UI).
 */
async function getAllPolicies() {
    const res = await db.query(
        `SELECT * FROM action_policies ORDER BY action_type, id`
    );
    return res.rows;
}

/**
 * Toggle a policy active/inactive.
 */
async function togglePolicy(policyId, isActive) {
    const res = await db.query(
        `UPDATE action_policies SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [isActive, policyId]
    );
    return res.rows[0] || null;
}

module.exports = {
    checkPolicies,
    getAllPolicies,
    togglePolicy,
};
