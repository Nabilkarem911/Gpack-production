// =============================================================================
// Tests: utils/settings.js  (D-001)
// =============================================================================

jest.mock('../../db', () => ({
    query: jest.fn(),
    pool: { end: jest.fn() },
}));

const { getVatRate, invalidateCache } = require('../../utils/settings');
const { query } = require('../../db');

describe('settings utils', () => {
    afterEach(() => {
        jest.clearAllMocks();
        invalidateCache('vat_rate');
    });

    test('getVatRate returns a number between 0 and 1', async () => {
        query.mockResolvedValueOnce({ rows: [{ value: '0.15', data_type: 'number' }] });

        const rate = await getVatRate();

        expect(typeof rate).toBe('number');
        expect(rate).toBeGreaterThanOrEqual(0);
        expect(rate).toBeLessThanOrEqual(1);
    });

    test('getVatRate falls back to default on db error', async () => {
        query.mockRejectedValueOnce(new Error('DB unavailable'));

        const rate = await getVatRate();

        expect(typeof rate).toBe('number');
        expect(rate).toBeGreaterThanOrEqual(0);
        expect(rate).toBeLessThanOrEqual(1);
    });
});
