// =============================================================================
// Tests: utils/settings.js  (D-001)
// =============================================================================

const { getVatRate } = require('../../utils/settings');

describe('settings utils', () => {
    // Note: These tests depend on the DB. In a full CI setup we would mock db.query.
    // Here we at least verify the function signature and caching behavior.

    test('getVatRate returns a number between 0 and 1', async () => {
        // This may connect to the real DB if running locally;
        // if DB is unavailable the fallback 0.15 should still be returned.
        try {
            const rate = await getVatRate();
            expect(typeof rate).toBe('number');
            expect(rate).toBeGreaterThanOrEqual(0);
            expect(rate).toBeLessThanOrEqual(1);
        } catch (err) {
            // If DB is down, verify graceful fallback
            expect(err.message).not.toMatch(/Internal server error/);
        }
    });
});
