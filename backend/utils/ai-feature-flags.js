// backend/utils/ai-feature-flags.js
// Phase 29.1: Feature Flags — toggle AI features on/off
// Cached in memory with 60s TTL

const db = require('../config/db');

let _cache = null;
let _cacheTime = 0;
const TTL_MS = 60 * 1000;

async function _loadFlags() {
    if (_cache && Date.now() - _cacheTime < TTL_MS) return _cache;
    try {
        const res = await db.query('SELECT flag_key, is_enabled, config FROM ai_feature_flags');
        _cache = {};
        for (const row of res.rows) {
            _cache[row.flag_key] = { enabled: row.is_enabled, config: row.config || {} };
        }
        _cacheTime = Date.now();
    } catch (e) {
        // If table doesn't exist, default everything to enabled
        _cache = {};
        _cacheTime = Date.now();
    }
    return _cache;
}

async function isEnabled(flagKey) {
    const flags = await _loadFlags();
    const flag = flags[flagKey];
    if (flag === undefined) return true; // default: enabled
    return flag.enabled;
}

async function getFlagConfig(flagKey) {
    const flags = await _loadFlags();
    const flag = flags[flagKey];
    return flag ? flag.config : {};
}

async function getAllFlags() {
    return await _loadFlags();
}

async function setFlag(flagKey, enabled, userId) {
    await db.query(
        `UPDATE ai_feature_flags SET is_enabled = $1, updated_by = $2, updated_at = NOW() WHERE flag_key = $3`,
        [enabled, userId || null, flagKey]
    );
    _cache = null; // invalidate cache
    return true;
}

function clearCache() {
    _cache = null;
}

module.exports = {
    isEnabled,
    getFlagConfig,
    getAllFlags,
    setFlag,
    clearCache,
};
