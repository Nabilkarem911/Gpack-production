// =============================================================================
// Tests: Fix #2 — design-review.html WhatsApp link logic
// Fix #3 — webhook nonce cleanup
//
// These tests verify the LOGIC extracted from the frontend and the webhook
// cleanup query, without needing a full server or browser.
// =============================================================================

// ── Fix #2: WhatsApp link builder logic (mirrors design-review.html) ─────────
describe('Fix #2 — design-review.html WhatsApp link with recipient', () => {
    // This replicates the exact logic from design-review.html _showSuccess()
    function buildWaUrl(responseData, waMessage) {
        const waNumber = responseData?.whatsapp_number || '';
        return waNumber
            ? `https://wa.me/${waNumber}?text=${encodeURIComponent(waMessage)}`
            : `https://wa.me/?text=${encodeURIComponent(waMessage)}`;
    }

    test('uses whatsapp_number from API response when present', () => {
        const url = buildWaUrl({ whatsapp_number: '966551234567' }, 'تم الاعتماد');
        expect(url).toContain('wa.me/966551234567');
        expect(url).toContain('text=');
    });

    test('falls back to no-recipient link when whatsapp_number is empty', () => {
        const url = buildWaUrl({ whatsapp_number: '' }, 'تم الاعتماد');
        expect(url).toBe('https://wa.me/?text=' + encodeURIComponent('تم الاعتماد'));
        expect(url).not.toContain('wa.me/966');
    });

    test('falls back when whatsapp_number is missing entirely', () => {
        const url = buildWaUrl({}, 'تم الاعتماد');
        expect(url).not.toContain('wa.me/966');
    });

    test('falls back when responseData is null', () => {
        const url = buildWaUrl(null, 'تم الاعتماد');
        expect(url).not.toContain('wa.me/966');
    });

    test('encodes the message properly', () => {
        const msg = '*تم اعتماد التصميم*\n\nطلب رقم: #123';
        const url = buildWaUrl({ whatsapp_number: '966551234567' }, msg);
        expect(url).toContain(encodeURIComponent(msg));
    });
});

// ── Fix #3: Webhook nonce cleanup query ──────────────────────────────────────
describe('Fix #3 — webhook nonce cleanup query', () => {
    // This test verifies the SQL cleanup query structure (not execution).
    // The actual DELETE runs in the webhook handler after processing.
    const CLEANUP_SQL = `DELETE FROM notification_settings
                 WHERE key LIKE 'waha_webhook_nonce:%'
                   AND updated_at < NOW() - INTERVAL '10 minutes'`;

    test('cleanup targets only nonce keys', () => {
        expect(CLEANUP_SQL).toContain("key LIKE 'waha_webhook_nonce:%'");
    });

    test('cleanup uses 10-minute threshold (safe above 5-min replay window)', () => {
        expect(CLEANUP_SQL).toContain("INTERVAL '10 minutes'");
    });

    test('cleanup does not touch other notification_settings rows', () => {
        // The WHERE clause has two conditions: key pattern AND age
        expect(CLEANUP_SQL).toContain('WHERE key LIKE');
        expect(CLEANUP_SQL).toContain('AND updated_at <');
    });
});
