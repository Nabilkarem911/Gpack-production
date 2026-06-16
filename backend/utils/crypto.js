// =============================================================================
// G.PACK 2.0 — Token Encryption / Decryption Utilities (D-005)
// share_token is stored encrypted in DB; a deterministic HMAC hash is used
// for fast indexed lookups without exposing the plaintext token.
// =============================================================================

const crypto = require('crypto');

const SECRET = process.env.SHARE_TOKEN_SECRET || '';

function _ensureSecret() {
    if (!SECRET || SECRET.length < 32) {
        throw new Error('SHARE_TOKEN_SECRET must be set and at least 32 characters long.');
    }
}

/**
 * Encrypt a plaintext token with AES-256-GCM.
 * Format: "iv:authTag:ciphertext" (all hex)
 */
function encryptToken(plaintext) {
    _ensureSecret();
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(SECRET, 'salt', 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt an AES-256-GCM token.
 */
function decryptToken(ciphertext) {
    _ensureSecret();
    const [ivHex, authTagHex, encrypted] = ciphertext.split(':');
    if (!ivHex || !authTagHex || !encrypted) {
        throw new Error('Invalid encrypted token format.');
    }
    const key = crypto.scryptSync(SECRET, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/**
 * Deterministic HMAC-SHA256 of the plaintext token.
 * Used for indexed DB lookups without storing plaintext.
 */
function hashToken(plaintext) {
    _ensureSecret();
    return crypto.createHmac('sha256', SECRET).update(plaintext).digest('hex');
}

/**
 * Safely decrypt a share_token field from a DB row.
 * If the value looks encrypted (contains ':') it attempts decryption.
 * On failure or if plaintext, returns the original value.
 */
function decryptShareToken(tokenValue) {
    if (!tokenValue || typeof tokenValue !== 'string') return tokenValue;
    if (!tokenValue.includes(':')) return tokenValue; // plaintext or null
    try {
        return decryptToken(tokenValue);
    } catch (_e) {
        return tokenValue;
    }
}

module.exports = {
    encryptToken,
    decryptToken,
    hashToken,
    decryptShareToken,
};
