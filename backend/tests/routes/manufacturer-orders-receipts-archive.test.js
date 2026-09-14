'use strict';

const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
}));

const manufacturerOrderRoutes = require('../../routes/manufacturer_orders');

const MO_ONE = '11111111-1111-4111-8111-111111111111';
const MO_TWO = '22222222-2222-4222-8222-222222222222';
const SESSION_ONE = '33333333-3333-4333-8333-333333333333';
const SESSION_TWO = '44444444-4444-4444-8444-444444444444';
const ITEM_ONE = '55555555-5555-4555-8555-555555555555';
const ITEM_TWO = '66666666-6666-4666-8666-666666666666';

function buildApp(user = { id: 'admin-id', role: 'admin' }) {
    const app = express();
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/api/manufacturer-orders', manufacturerOrderRoutes);
    return app;
}

function mockArchiveQueries() {
    mockQuery.mockImplementation(async (sql) => {
        if (sql.includes('FROM mo_receipt_sessions s')) {
            return { rows: [
                {
                    id: SESSION_ONE,
                    manufacturer_order_id: MO_ONE,
                    session_number: 2,
                    status: 'reversed',
                    mo_status: 'ordered',
                    subtotal: '100',
                    grand_total: '115',
                },
                {
                    id: SESSION_TWO,
                    manufacturer_order_id: MO_TWO,
                    session_number: 1,
                    status: 'active',
                    mo_status: 'received',
                    subtotal: '50',
                    grand_total: '50',
                },
            ] };
        }
        if (sql.includes('FROM mo_receipt_session_items si')) {
            return { rows: [
                {
                    id: ITEM_ONE,
                    session_id: SESSION_ONE,
                    quantity: '2',
                    mo_quantity: '3',
                    is_final: false,
                    product_name: 'صنف جزئي',
                },
                {
                    id: ITEM_TWO,
                    session_id: SESSION_TWO,
                    quantity: '1',
                    mo_quantity: '1',
                    is_final: false,
                    product_name: 'صنف مكتمل',
                },
            ] };
        }
        if (sql.includes('FROM mo_receipt_session_item_images')) {
            return { rows: [{ session_item_id: ITEM_ONE, id: 'image-1', image_path: '/x.jpg', file_name: 'x.jpg' }] };
        }
        return { rows: [] };
    });
}

describe('GET /api/manufacturer-orders/receipts/archive', () => {
    beforeEach(() => mockQuery.mockReset());

    test('returns all sessions, items, images and completion states in bounded queries', async () => {
        mockArchiveQueries();

        const response = await request(buildApp()).get('/api/manufacturer-orders/receipts/archive');

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(2);
        expect(response.body.data[0]).toMatchObject({
            id: SESSION_ONE,
            receipt_completion_status: 'reversed',
            items: [{ item_completion_status: 'partial', images: [{ id: 'image-1' }] }],
        });
        expect(response.body.data[1]).toMatchObject({
            id: SESSION_TWO,
            receipt_completion_status: 'full',
            items: [{ item_completion_status: 'full', images: [] }],
        });

        const sqlCalls = mockQuery.mock.calls.map(([sql]) => sql);
        expect(sqlCalls.filter(sql => sql.includes('FROM mo_receipt_sessions s'))).toHaveLength(1);
        expect(sqlCalls.filter(sql => sql.includes('FROM mo_receipt_session_items si'))).toHaveLength(1);
        expect(sqlCalls.filter(sql => sql.includes('FROM mo_receipt_session_item_images'))).toHaveLength(1);
        expect(sqlCalls.some(sql => sql.includes('FROM mo_receipt_sessions s') && sql.includes('ANY($1::uuid[])'))).toBe(false);
    });

    test('filters by a valid UUID without creating per-MO requests', async () => {
        mockArchiveQueries();

        const response = await request(buildApp())
            .get(`/api/manufacturer-orders/receipts/archive?mo_ids=${MO_ONE}`);

        expect(response.status).toBe(200);
        const sessionsCall = mockQuery.mock.calls.find(([sql]) => sql.includes('FROM mo_receipt_sessions s'));
        expect(sessionsCall[0]).toContain('ANY($1::uuid[])');
        expect(sessionsCall[1]).toEqual([[MO_ONE]]);
    });

    test('rejects invalid UUID filters before querying the database', async () => {
        const response = await request(buildApp())
            .get('/api/manufacturer-orders/receipts/archive?mo_ids=not-a-uuid');

        expect(response.status).toBe(400);
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test('rejects a mixed valid and invalid UUID filter instead of silently dropping input', async () => {
        const response = await request(buildApp())
            .get(`/api/manufacturer-orders/receipts/archive?mo_ids=${MO_ONE},not-a-uuid`);

        expect(response.status).toBe(400);
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test('rejects UUID-shaped values with invalid hyphen placement', async () => {
        const response = await request(buildApp())
            .get('/api/manufacturer-orders/receipts/archive?mo_ids=111111111111111111111111111111111111');

        expect(response.status).toBe(400);
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test('requires manufacturer-order view permission', async () => {
        const response = await request(buildApp({
            id: 'warehouse-user',
            role: 'warehouse',
            permissions: {},
        })).get('/api/manufacturer-orders/receipts/archive');

        expect(response.status).toBe(403);
    });
});
