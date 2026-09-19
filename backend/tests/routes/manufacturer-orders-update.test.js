'use strict';

const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
const mockClientQuery = jest.fn();
jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
    withTransaction: async (cb) => cb({ query: (...args) => mockClientQuery(...args) }),
}));

const manufacturerOrderRoutes = require('../../routes/manufacturer_orders');

const MO_ID = '11111111-1111-4111-8111-111111111111';
const MOI_ID = '55555555-5555-4555-8555-555555555555';
const ORDER_ITEM_ID = '66666666-6666-4666-8666-666666666666';
const DESIGN_ID = '77777777-7777-4777-8777-777777777777';
const VARIANT_ID = '88888888-8888-4888-8888-888888888888';

function buildApp(user = { id: 'admin-id', role: 'admin' }) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/api/manufacturer-orders', manufacturerOrderRoutes);
    return app;
}

function mockUpdateFlow({ status = 'sent', itemUpdateRowCount = 1 } = {}) {
    mockClientQuery.mockImplementation(async (sql) => {
        if (sql.includes('FROM manufacturer_orders WHERE id = $1 FOR UPDATE')) {
            return { rows: [{ status }] };
        }
        if (sql.includes('UPDATE manufacturer_orders')) {
            return { rows: [{ id: MO_ID, status }] };
        }
        if (sql.includes('UPDATE manufacturer_order_items')) {
            return { rowCount: itemUpdateRowCount, rows: itemUpdateRowCount ? [{ order_item_id: ORDER_ITEM_ID }] : [] };
        }
        if (sql.includes('FROM order_items WHERE id = $1')) {
            return { rows: [{ variant_id: VARIANT_ID }] };
        }
        if (sql.includes('FROM manufacturer_order_items')) {
            return { rows: [{ id: MOI_ID, order_item_id: ORDER_ITEM_ID }] };
        }
        return { rows: [], rowCount: 0 };
    });
}

describe('PATCH /api/manufacturer-orders/:id', () => {
    beforeEach(() => {
        mockQuery.mockClear();
        mockClientQuery.mockReset();
    });

    test('updates item pantone/design in place on a sent MO without touching the share token', async () => {
        mockUpdateFlow({ status: 'sent' });

        const response = await request(buildApp())
            .patch(`/api/manufacturer-orders/${MO_ID}`)
            .send({
                notes: 'ملاحظة جديدة',
                items: [{
                    id: MOI_ID,
                    design_status: 'reprint',
                    design_id: DESIGN_ID,
                    pantone_colors: ['PMS 185 C', 'PMS 286 C'],
                    pantone_color: 'PMS 185 C',
                }],
            });

        expect(response.status).toBe(200);
        expect(response.body.data.id).toBe(MO_ID);
        expect(response.body.data.items).toHaveLength(1);

        const sqlCalls = mockClientQuery.mock.calls.map(([sql]) => sql);
        // Items updated in place — never deleted/recreated
        expect(sqlCalls.some(sql => sql.includes('DELETE FROM manufacturer_order_items'))).toBe(false);
        expect(sqlCalls.some(sql => sql.includes('INSERT INTO manufacturer_order_items'))).toBe(false);
        // Share token/link untouched
        expect(sqlCalls.some(sql => sql.includes('share_token'))).toBe(false);
        expect(sqlCalls.some(sql => sql.includes('token_expires_at'))).toBe(false);

        const itemUpdate = mockClientQuery.mock.calls.find(([sql]) => sql.includes('UPDATE manufacturer_order_items'));
        expect(itemUpdate[0]).toContain('WHERE id =');
        expect(itemUpdate[0]).toContain('manufacturer_order_id =');
        expect(itemUpdate[1]).toContain('reprint');
        expect(itemUpdate[1]).toContain(DESIGN_ID);
        expect(itemUpdate[1]).toContain('PMS 185 C');
        expect(itemUpdate[1][itemUpdate[1].length - 1]).toBe(MO_ID);
    });

    test('still supports header-only updates (backward compatible)', async () => {
        mockUpdateFlow({ status: 'pending' });

        const response = await request(buildApp())
            .patch(`/api/manufacturer-orders/${MO_ID}`)
            .send({ expected_delivery: '2026-03-01', notes: 'x' });

        expect(response.status).toBe(200);
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('UPDATE manufacturer_order_items'))).toBe(false);
    });

    test('blocks updates once the MO is received or cancelled', async () => {
        for (const status of ['received', 'cancelled']) {
            mockUpdateFlow({ status });
            const response = await request(buildApp())
                .patch(`/api/manufacturer-orders/${MO_ID}`)
                .send({ items: [{ id: MOI_ID, pantone_colors: ['PMS 185 C'] }] });
            expect(response.status).toBe(400);
            expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('UPDATE manufacturer_order_items'))).toBe(false);
        }
    });

    test('rejects an item that does not belong to the MO', async () => {
        mockUpdateFlow({ status: 'sent', itemUpdateRowCount: 0 });

        const response = await request(buildApp())
            .patch(`/api/manufacturer-orders/${MO_ID}`)
            .send({ items: [{ id: MOI_ID, pantone_colors: ['PMS 185 C'] }] });

        expect(response.status).toBe(400);
    });

    test('returns 404 for a missing MO', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql.includes('FOR UPDATE')) return { rows: [], rowCount: 0 };
            return { rows: [], rowCount: 0 };
        });

        const response = await request(buildApp())
            .patch(`/api/manufacturer-orders/${MO_ID}`)
            .send({ notes: 'x' });

        expect(response.status).toBe(404);
    });

    test('requires edit permission', async () => {
        const response = await request(buildApp({
            id: 'warehouse-user',
            role: 'warehouse',
            permissions: {},
        })).patch(`/api/manufacturer-orders/${MO_ID}`).send({ notes: 'x' });

        expect(response.status).toBe(403);
    });
});
