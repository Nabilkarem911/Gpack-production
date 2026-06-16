// =============================================================================
// Tests: utils/crypto.js  (D-001, D-005)
// =============================================================================

const { encryptToken, decryptToken, hashToken, decryptShareToken } = require('../../utils/crypto');

describe('crypto utils', () => {
    const plainToken = 'abc123def456';

    test('encrypt + decrypt roundtrip', () => {
        const encrypted = encryptToken(plainToken);
        expect(encrypted).toContain(':');
        const decrypted = decryptToken(encrypted);
        expect(decrypted).toBe(plainToken);
    });

    test('hashToken is deterministic', () => {
        const h1 = hashToken(plainToken);
        const h2 = hashToken(plainToken);
        expect(h1).toBe(h2);
        expect(h1).toHaveLength(64); // SHA-256 hex
    });

    test('hashToken of different tokens differs', () => {
        const h1 = hashToken('token-a');
        const h2 = hashToken('token-b');
        expect(h1).not.toBe(h2);
    });

    test('decryptShareToken returns plaintext for non-encrypted value', () => {
        expect(decryptShareToken(plainToken)).toBe(plainToken);
        expect(decryptShareToken(null)).toBeNull();
        expect(decryptShareToken(undefined)).toBeUndefined();
    });

    test('decryptShareToken decrypts encrypted token', () => {
        const encrypted = encryptToken(plainToken);
        expect(decryptShareToken(encrypted)).toBe(plainToken);
    });

    test('decryptShareToken gracefully handles garbage', () => {
        expect(decryptShareToken('bad::format')).toBe('bad::format');
    });
});
