'use strict';

// =============================================================================
// G.PACK 2.0 — Template Engine
// Loads notification templates from DB, renders with variable substitution.
// Templates are versioned and multi-language.
//
// Usage:
//   const TemplateEngine = require('./template-engine');
//   const rendered = await TemplateEngine.render('design_approved_client', 'ar', {
//       certificate_number: 'APP-20260101-AB12',
//       product_name: 'كرتون فاخر',
//       approved_date: '26/07/2026',
//       verify_url: 'https://erp.gpacksa.com/verify/APP-20260101-AB12',
//   });
//   // rendered = { subject: '...', body: '...' }
// =============================================================================

const db = require('../db');

// ── Cache: template code + lang → { subject, body, version } ────────────────
const _cache = new Map();
let _cacheAt = 0;
const CACHE_TTL_MS = 60000; // 1 minute

async function _loadTemplates() {
    if (Date.now() - _cacheAt < CACHE_TTL_MS && _cache.size > 0) return;
    try {
        const result = await db.query(
            `SELECT code, version, lang, subject, body, variables
             FROM notification_templates
             WHERE is_active = true
             ORDER BY version DESC`
        );
        _cache.clear();
        for (const row of result.rows) {
            const key = `${row.code}:${row.lang}`;
            // Keep only the latest version per code+lang
            if (!_cache.has(key)) {
                _cache.set(key, {
                    subject: row.subject,
                    body: row.body,
                    variables: row.variables || [],
                    version: row.version,
                });
            }
        }
        _cacheAt = Date.now();
    } catch (err) {
        console.error('[TemplateEngine] Load error:', err.message);
    }
}

// ── Render a template by code + language ────────────────────────────────────
// Replaces {{variable_name}} placeholders with values from `vars`.
async function render(code, lang = 'ar', vars = {}) {
    await _loadTemplates();

    const key = `${code}:${lang}`;
    let template = _cache.get(key);

    // Fallback to 'ar' if requested language not found
    if (!template && lang !== 'ar') {
        template = _cache.get(`${code}:ar`);
    }

    if (!template) {
        console.warn(`[TemplateEngine] Template not found: ${code}:${lang}`);
        return null;
    }

    let body = template.body.replace(/\\n/g, '\n');
    let subject = (template.subject || '').replace(/\\n/g, '\n');

    // Replace {{var}} placeholders
    for (const [k, v] of Object.entries(vars)) {
        const placeholder = new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g');
        body = body.replace(placeholder, String(v || ''));
        subject = subject.replace(placeholder, String(v || ''));
    }

    return { subject, body, version: template.version };
}

// ── Reload cache (force) ────────────────────────────────────────────────────
function reloadCache() {
    _cache.clear();
    _cacheAt = 0;
}

module.exports = { render, reloadCache };
