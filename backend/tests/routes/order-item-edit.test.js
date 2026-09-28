'use strict';

const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
const mockClientQuery = jest.fn();
jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
    withTransaction: async (cb) => cb({ query: (...args) => mockClientQuery(...args) }),
    getClient: jest.fn(() => Promise.resolve({
        query: (...args) => mockClientQuery(...args),
        release: jest.fn(),
    })),
}));

const orderRoutes = require('../../routes/orders');

const ORDER_ID   = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ITEM_ID    = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MO_ID      = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MOI_ID     = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OLD_VAR    = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const NEW_VAR    = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function buildApp(user = { id: 'admin-id', role: 'admin' }) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/api/orders', orderRoutes);
    return app;
}

// Routes the mocked SQL traffic for the PATCH /:id/items/:itemId flow.
function mockEditFlow({
    orderStatus = 'production',
    grandTotal = 500,
    itemQty = 100,
    whReceived = 0,
    released = 0,
    delivered = 0,
    moItems = [{ id: MOI_ID, mo_quantity: 100, received_qty: 0, manufacturer_order_id: MO_ID, mo_status: 'sent', mo_number: 42 }],
    activeSessions = 0,
    openPurchaseInvoices = 0,
    deliveryNoteRefs = 0,
    invoiceRefs = 0,
    variantExists = true,
    itemExists = true,
} = {}) {
    const orderRow = { id: ORDER_ID, order_number: 1001, status: orderStatus, client_id: 'client-1', grand_total: grandTotal };
    const itemRow = {
        id: ITEM_ID, variant_id: OLD_VAR, quantity: itemQty, unit_price: 5,
        wh_received_qty: whReceived, released_qty: released, delivered_qty: delivered,
        design_id: null, notes: 'old note',
    };

    mockClientQuery.mockImplementation(async (sql) => {
        if (sql.includes('FROM orders WHERE id = $1 FOR UPDATE')) {
            const rows = orderStatus === null ? [] : [orderRow];
            return { rows, rowCount: rows.length };
        }
        if (sql.includes('FROM order_items WHERE id = $1 AND order_id = $2 FOR UPDATE')) {
            const rows = itemExists ? [itemRow] : [];
            return { rows, rowCount: rows.length };
        }
        if (sql.includes('FROM manufacturer_order_items moi')) {
            return { rows: moItems, rowCount: moItems.length };
        }
        if (sql.includes('FROM mo_receipt_sessions')) {
            return { rows: activeSessions ? [{ '?column?': 1 }] : [], rowCount: activeSessions };
        }
        if (sql.includes('FROM purchase_invoices')) {
            return { rows: openPurchaseInvoices ? [{ '?column?': 1 }] : [], rowCount: openPurchaseInvoices };
        }
        if (sql.includes('FROM delivery_note_items')) {
            return { rows: deliveryNoteRefs ? [{ '?column?': 1 }] : [], rowCount: deliveryNoteRefs };
        }
        if (sql.includes('FROM invoice_items')) {
            return { rows: invoiceRefs ? [{ '?column?': 1 }] : [], rowCount: invoiceRefs };
        }
        if (sql.includes('FROM product_variants pv JOIN products')) {
            return { rows: [
                { id: OLD_VAR, product_name: 'كوب ورقي', size_name: '8oz' },
                { id: NEW_VAR, product_name: 'كوب ورقي', size_name: '12oz' },
            ] };
        }
        if (sql.includes('FROM product_variants WHERE id = $1')) {
            return { rows: variantExists ? [{ id: NEW_VAR }] : [], rowCount: variantExists ? 1 : 0 };
        }
        if (sql.includes('manufacturer_po_qty')) {
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes('UPDATE order_items')) {
            return { rows: [{ ...itemRow, variant_id: NEW_VAR }], rowCount: 1 };
        }
        if (sql.includes('UPDATE manufacturer_order_items')) {
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO order_notes')) {
            return { rows: [{ id: 'note-1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    });
}

const sqlCalls = () => mockClientQuery.mock.calls.map(([sql]) => sql);

// Any write against the manufacturer_orders row itself would churn the
// supplier share token — assert none happen.
function expectMORowUntouched() {
    const calls = sqlCalls();
    expect(calls.some(s => /UPDATE\s+manufacturer_orders\s/i.test(s))).toBe(false);
    expect(calls.some(s => /DELETE\s+FROM\s+manufacturer_orders/i.test(s))).toBe(false);
    expect(calls.some(s => /INSERT\s+INTO\s+manufacturer_orders/i.test(s))).toBe(false);
    expect(calls.some(s => s.includes('share_token'))).toBe(false);
    expect(calls.some(s => s.includes('token_expires_at'))).toBe(false);
}

function expectItemRowNotRecreated() {
    const calls = sqlCalls();
    expect(calls.some(s => /DELETE\s+FROM\s+order_items/i.test(s))).toBe(false);
    expect(calls.some(s => /INSERT\s+INTO\s+order_items/i.test(s))).toBe(false);
}

describe('PATCH /api/orders/:id/items/:itemId', () => {
    beforeEach(() => {
        mockQuery.mockClear();
        mockClientQuery.mockReset();
    });

    test('changes variant in place on a production order — MO row and share link untouched', async () => {
        mockEditFlow({ orderStatus: 'production' });

        const res = await request(buildApp())
            .patch(`/api/orders/${ORDER_ID}/items/${ITEM_ID}`)
            .send({ variant_id: NEW_VAR });

        expect(res.status).toBe(200);
        expect(res.body.data.item.variant_id).toBe(NEW_VAR);

        const updateCall = mockClientQuery.mock.calls.find(([sql]) => /UPDATE\s+order_items\s+SET/.test(sql) && !sql.includes('manufacturer_po_qty'));
        expect(updateCall).toBeTruthy();
        expect(updateCall[1]).toContain(NEW_VAR);
        expect(updateCall[1][updateCall[1].length - 1]).toBe(ITEM_ID);

        expectItemRowNotRecreated();
        expectMORowUntouched();

        // Audit note written
        expect(sqlCalls().some(s => s.includes('INSERT INTO order_notes'))).toBe(true);
    });

    test('works the same when the MO is sent — same link keeps serving live data', async () => {
        mockEditFlow({ orderStatus: 'processing', moItems: [{ id: MOI_ID, mo_quantity: 100, received_qty: 0, manufacturer_order_id: MO_ID, mo_status: 'sent', mo_number: 42 }] });

        const res = await request(buildApp())
            .patch(`/api/orders/${ORDER_ID}/items/${ITEM_ID}`)
            .send({ variant_id: NEW_VAR });

        expect(res.status).toBe(200);
        expectMORowUntouched();
    });

    test('scales MO quantities proportionally when quantity changes on a VMI (unpriced) order', async () => {
        mockEditFlow({
            grandTotal: null,
            moItems: [
                { id: MOI_ID, mo_quantity: 600, received_qty: 0, manufacturer_order_id: MO_ID, mo_status: 'sent', mo_number: 42 },
                { id: 'moi-2', mo_quantity: 400, received_qty: 0, manufacturer_order_id: MO_ID, mo_status: 'pending', mo_number: 42 },
            ],
        });

        const res = await request(buildApp())
            .patch(`/api/orders/${ORDER_ID}/items/${ITEM_ID}`)
            .send({ quantity: 80 });

        expect(res.status).toBe(200);
        const moUpdates = mockClientQuery.mock.calls.filter(([sql]) => sql.includes('UPDATE manufacturer_order_items SET mo_quantity'));
        expect(moUpdates).toHaveLength(2);
        // 600 * 80/100 = 480 ; 400 * 80/100 = 320
        expect(moUpdates[0][1][0]).toBe(480);
        expect(moUpdates[1][1][0]).toBe(320);
        // manufacturer_po_qty resynced from linked items
        expect(sqlCalls().some(s => s.includes('UPDATE order_items') && s.includes('manufacturer_po_qty'))).toBe(true);
        expectMORowUntouched();
        expectItemRowNotRecreated();
    });

    test('blocks quantity change on a priced order — requires client re-approval', async () => {
        mockEditFlow({ grandTotal: 500 });

        const res = await request(buildApp())
            .patch(`/api/orders/${ORDER_ID}/items/${ITEM_ID}`)
            .send({ quantity: 80 });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('TOTAL_CHANGE_REQUIRES_REAPPROVAL');
        expect(sqlCalls().some(s => /UPDATE\s+order_items\s+SET/.test(s))).toBe(false);
        expectMORowUntouched();
    });

    test('blocks when the item already has received/released/delivered quantities', async () => {
        for (const field of ['whReceived', 'released', 'delivered']) {
            mockEditFlow({ [field]: 5 });
            const res = await request(buildApp())
                .patch(`/api/orders/${ORDER_ID}/items/${ITEM_ID}`)
                .send({ variant_id: NEW_VAR });
            expect(res.status).toBe(400);
        }
    });

    test('blocks when a linked MO item has received_qty > 0', async () => {
        mockEditFlow({ moItems: [{ id: MOI_ID, mo_quantity: 100, received_qty: 3, manufacturer_order_id: MO_ID, mo_status: 'partially_received', mo_number: 42 }] });

        const res = await request(buildApp())
            .patch(`/api/orders/${ORDER_ID}/items/${ITEM_ID}`)
            .send({ variant_id: NEW_VAR });

        expect(res.status).toBe(400);
        expectMORowUntouched();
    });

    test('blocks when an active receipt session exists', async () => {
        mockEditFlow({ activeSessions: 1 });
        const res = await request(buildApp())
            .patch(`/api/orders/${ORDER_ID}/items/${ITEM_ID}`)
            .send({ variant_id: NEW_VAR });
        expect(res.status).toBe(400);
    });

    test('blocks when a non-cancelled purchase invoice exists for the MO', async () => {
        mockEditFlow({ openPurchaseInvoices: 1 });
        const res = await request(buildApp())
            .patch(`/api/orders/${ORDER_ID}/items/${ITEM_ID}`)
            .send({ variant_id: NEW_VAR });
        expect(res.status).toBe(400);
    });

    test('blocks when the item is referenced by a delivery note', async () => {
        mockEditFlow({ deliveryNoteRefs: 1 });
        const res = await request(buildApp())
            .patch(`/api/orders/${ORDER_ID}/items/${ITEM_ID}`)
            .send({ variant_id: NEW_VAR });
        expect(res.status).toBe(400);
    });

    test('blocks when the item is referenced by a sales invoice', async () => {
        mockEditFlow({ invoiceRefs: 1 });
        const res = await request(buildApp())
            .patch(`/api/orders/${ORDER_ID}/items/${ITEM_ID}`)
            .send({ variant_id: NEW_VAR });
        expect(res.status).toBe(400);
    });

    test('rejects orders outside production/processing', async () => {
        mockEditFlow({ orderStatus: 'quote' });
        const res = await request(buildApp())
            .patch(`/api/orders/${ORDER_ID}/items/${ITEM_ID}`)
            .send({ variant_id: NEW_VAR });
        expect(res.status).toBe(400);
    });

    test('returns 404 when the item does not belong to the order', async () => {
        mockEditFlow({ itemExists: false });
        const res = await request(buildApp())
            .patch(`/api/orders/${ORDER_ID}/items/${ITEM_ID}`)
            .send({ variant_id: NEW_VAR });
        expect(res.status).toBe(404);
    });

    test('rejects an unknown variant', async () => {
        mockEditFlow({ variantExists: false });
        const res = await request(buildApp())
            .patch(`/api/orders/${ORDER_ID}/items/${ITEM_ID}`)
            .send({ variant_id: NEW_VAR });
        expect(res.status).toBe(404);
    });

    test('rejects empty payloads', async () => {
        mockEditFlow({});
        const res = await request(buildApp())
            .patch(`/api/orders/${ORDER_ID}/items/${ITEM_ID}`)
            .send({});
        expect(res.status).toBe(400);
    });

    test('requires quotations edit permission', async () => {
        const res = await request(buildApp({ id: 'u1', role: 'warehouse', permissions: {} }))
            .patch(`/api/orders/${ORDER_ID}/items/${ITEM_ID}`)
            .send({ variant_id: NEW_VAR });
        expect(res.status).toBe(403);
    });
});
