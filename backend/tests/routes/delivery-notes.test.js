'use strict';

const request = require('supertest');
const express = require('express');

const deliveryNoteId = '11111111-1111-4111-8111-111111111111';
const dispatchId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const variantId = '44444444-4444-4444-8444-444444444444';
const clientId = '55555555-5555-4555-8555-555555555555';
const stockId = '66666666-6666-4666-8666-666666666666';

const mockClientQuery = jest.fn();
const mockClient = {
    query: (...args) => mockClientQuery(...args),
    release: jest.fn(),
};
const mockPoolQuery = jest.fn(async () => ({ rowCount: 1, rows: [] }));
let pinnedSourceStockId = null;

jest.mock('../../db', () => ({
    withTransaction: async (callback) => callback(mockClient),
    pool: { query: (...args) => mockPoolQuery(...args) },
}));
jest.mock('../../middleware/authorize', () => () => (_req, _res, next) => next());
jest.mock('../../utils/event-bus', () => ({ emit: jest.fn() }));

const deliveryNoteRoutes = require('../../routes/delivery-notes');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { id: '77777777-7777-4777-8777-777777777777', role: 'admin' };
        next();
    });
    app.use('/api/delivery-notes', deliveryNoteRoutes);
    return app;
}

describe('delivery note dispatch stock lookup', () => {
    beforeEach(() => {
        pinnedSourceStockId = null;
        mockClientQuery.mockReset();
        mockPoolQuery.mockClear();
        mockClient.release.mockReset();

        mockClientQuery.mockImplementation(async (sql) => {
            if (sql.includes('SELECT dn.*')) {
                return {
                    rowCount: 1,
                    rows: [{
                        id: deliveryNoteId,
                        client_id: clientId,
                        order_id: null,
                        warehouse_id: null,
                        note_number: 1001,
                    }],
                };
            }
            if (sql.includes('MAX(dispatch_number)')) {
                return { rowCount: 1, rows: [{ next_num: 1 }] };
            }
            if (sql.includes('INSERT INTO delivery_note_dispatches')) {
                return { rowCount: 1, rows: [{ id: dispatchId, dispatch_number: 1 }] };
            }
            if (sql.includes('SELECT requested_qty, delivered_qty FROM delivery_note_items WHERE id')) {
                return { rowCount: 1, rows: [{ requested_qty: 2, delivered_qty: 0 }] };
            }
            if (sql.includes('SELECT dni.order_item_id')) {
                return { rowCount: 1, rows: [{ order_item_id: null, source_stock_id: pinnedSourceStockId, variant_id: variantId }] };
            }
            if (sql.includes('SELECT ws.id, ws.quantity, ws.reserved_qty')) {
                return { rowCount: 1, rows: [{ id: stockId, quantity: 5, reserved_qty: 0 }] };
            }
            if (sql.includes('SELECT requested_qty, delivered_qty FROM delivery_note_items')) {
                return { rowCount: 1, rows: [{ requested_qty: 2, delivered_qty: 2 }] };
            }
            return { rowCount: 1, rows: [] };
        });
    });

    test('finds client stock using the item variant when no source stock is pinned', async () => {
        const response = await request(buildApp())
            .post(`/api/delivery-notes/${deliveryNoteId}/dispatch`)
            .send({ items: [{ item_id: itemId, quantity: 2 }] });

        expect(response.status).toBe(200);
        expect(response.body.data).toEqual({
            status: 'completed',
            dispatch_id: dispatchId,
            dispatch_number: 1,
        });

        const stockLookup = mockClientQuery.mock.calls.find(([sql]) => sql.includes('SELECT ws.id, ws.quantity, ws.reserved_qty'));
        expect(stockLookup).toBeDefined();
        expect(stockLookup[1]).toEqual([variantId, null, null, clientId]);
    });

    test('uses the pinned stock row while still matching the item variant', async () => {
        pinnedSourceStockId = stockId;

        const response = await request(buildApp())
            .post(`/api/delivery-notes/${deliveryNoteId}/dispatch`)
            .send({ items: [{ item_id: itemId, quantity: 2 }] });

        expect(response.status).toBe(200);
        const stockLookup = mockClientQuery.mock.calls.find(([sql]) => sql.includes('SELECT ws.id, ws.quantity, ws.reserved_qty'));
        expect(stockLookup[1]).toEqual([variantId, stockId, null, clientId]);
    });
});
