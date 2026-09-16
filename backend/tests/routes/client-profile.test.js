'use strict';

const request = require('supertest');
const express = require('express');

const clientId = '11111111-1111-4111-8111-111111111111';
const quoteId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const mockQuery = jest.fn();

jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
const clientsRoutes = require('../../routes/clients');

function buildApp() {
    const app = express();
    app.use((req, _res, next) => { req.user = { id: 'admin', role: 'admin' }; next(); });
    app.use('/api/clients', clientsRoutes);
    return app;
}

describe('client profile order and quotation separation', () => {
    beforeEach(() => {
        mockQuery.mockImplementation(async sql => {
            if (sql.includes('FROM clients c')) return { rows: [{ id: clientId, name: 'عميل الاختبار', created_by: 'admin' }] };
            if (sql.includes('FROM clients WHERE parent_id')) return { rows: [] };
            if (sql.includes('FROM orders o')) return { rows: [
                { id: quoteId, order_number: 101, status: 'quote', order_date: '2026-09-01', grand_total: '1000', paid_amount: '0', item_count: 2 },
                { id: orderId, order_number: 102, status: 'confirmed', order_date: '2026-09-02', grand_total: '2000', paid_amount: '500', item_count: 3 },
            ] };
            if (sql.includes('FROM invoices i')) return { rows: [] };
            if (sql.includes('FROM client_transactions ct')) return { rows: [] };
            if (sql.includes('FROM client_designs cd')) return { rows: [] };
            if (sql.includes('WITH order_stats')) return { rows: [{
                total_orders: 1, quote_count: 1, active_count: 1, total_value: 0, total_paid: 0, total_remaining: 0,
            }] };
            return { rows: [] };
        });
    });

    test('returns actual orders separately from all client quotations', async () => {
        const response = await request(buildApp()).get(`/api/clients/${clientId}/profile`);

        expect(response.status).toBe(200);
        expect(response.body.data.orders).toHaveLength(1);
        expect(response.body.data.orders[0]).toMatchObject({ id: orderId, status: 'confirmed' });
        expect(response.body.data.quotes).toHaveLength(1);
        expect(response.body.data.quotes[0]).toMatchObject({ id: quoteId, status: 'quote' });
        expect(response.body.data.orders.some(order => order.status === 'quote')).toBe(false);
        expect(response.body.data.quotes.some(order => order.status !== 'quote')).toBe(false);
    });
});
