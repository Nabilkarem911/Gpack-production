'use strict';

// =============================================================================
// G.PACK 2.0 — System Settings Utility
// Reads configuration keys from system_settings table with in-memory caching.
// =============================================================================

const db = require('../db');

const cache = new Map();
const CACHE_TTL_MS = 60_000; // 1 minute

async function getSetting(key, defaultValue = null) {
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) {
        return cached.value;
    }

    try {
        const result = await db.query(
            'SELECT value, data_type FROM system_settings WHERE key = $1',
            [key]
        );
        if (result.rows.length === 0) {
            return defaultValue;
        }
        const row = result.rows[0];
        let value = row.value;
        if (row.data_type === 'number') {
            value = parseFloat(value);
        } else if (row.data_type === 'boolean') {
            value = value === 'true' || value === '1';
        } else if (row.data_type === 'json') {
            value = JSON.parse(value);
        }
        cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
        return value;
    } catch (err) {
        console.error('[Settings] Failed to read setting:', key, err.message);
        return defaultValue;
    }
}

async function getVatRate() {
    return getSetting('vat_rate', 0.15);
}

function invalidateCache(key) {
    cache.delete(key);
}

module.exports = {
    getSetting,
    getVatRate,
    invalidateCache,
};
