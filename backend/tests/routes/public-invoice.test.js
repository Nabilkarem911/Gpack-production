// =============================================================================
// Tests: routes/public-invoice.js  (Integration via Supertest)
// =============================================================================

const request = require('supertest');
const express = require('express');
const { hashToken } = require('../../utils/crypto');

const mockQuery = jest.fn();
jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
}));

const publicInvoiceRoutes = require('../../routes/public-invoice');

describe('Public Invoice Routes', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use('/api/public/invoice', publicInvoiceRoutes);
        mockQuery.mockClear();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('should return 404 for non-existent invoice by hash', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const res = await request(app)
            .get('/api/public/invoice/inv-123')
            .query({ token: 'unknown-token' });

        expect(res.status).toBe(404);
    });

    test('should return invoice when found by token hash', async () => {
        const shareToken = 'abc123def456';
        const tokenHash = hashToken(shareToken);

        mockQuery.mockResolvedValueOnce({
            rows: [{
                id: '550e8400-e29b-41d4-a716-446655440000',
                invoice_number: 1001,
                invoice_date: '2026-06-16',
                due_date: '2026-06-30',
                status: 'unpaid',
                subtotal: '1000.00',
                tax_amount: '150.00',
                grand_total: '1150.00',
                client_name: 'Test Client',
                share_token: null,
                items: [],
            }],
        });

        const res = await request(app)
            .get(`/api/public/invoice/${tokenHash}`)
            .query({ token: shareToken });

        expect(res.status).toBe(200);
        expect(res.body.invoice).toMatchObject({
            invoice_number: 1001,
            client_name: 'Test Client',
        });
    });
});
