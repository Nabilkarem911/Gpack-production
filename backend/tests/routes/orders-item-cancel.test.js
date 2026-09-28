// =============================================================================
// Tests: POST /api/orders/:id/items/:itemId/cancel + /restore
// Soft-cancel of order items during production/processing.
// =============================================================================

const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();
const mockRelease = jest.fn();
jest.mock('../../services/notification-service', () => ({
    writeOutboxEvent: jest.fn(),
    generateCorrelationId: jest.fn(() => 'QTP-test'),
}));
jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
    withTransaction: async callback => callback({ query: (...args) => mockQuery(...args) }),
    pool: {
        connect: jest.fn(() => Promise.resolve({
            query: (...args) => mockQuery(...args),
            release: mockRelease,
        })),
    },
    getClient: jest.fn(() => Promise.resolve({
        query: (...args) => mockQuery(...args),
        release: mockRelease,
    })),
}));

const orderRoutes = require('../../routes/orders');

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID  = '22222222-2222-4222-8222-222222222222';
const ITEM_ID2 = '33333333-3333-4333-8333-333333333333';

const baseOrder = { id: ORDER_ID, order_number: 5001, status: 'production', subtotal: '300', tax_rate: '0.15' };
const baseItem  = {
    id: ITEM_ID, order_id: ORDER_ID, variant_id: 'var-1', quantity: '10', unit_price: '30',
    manufacturer_po_qty: '0', wh_received_qty: '0', released_qty: '0', delivered_qty: '0',
    cancelled_at: null,
};

/**
 * Mock implementation for the cancel endpoint's query sequence.
 * `overrides` lets each test flip one guard result.
 */
function mockCancelSequence(overrides = {}) {
    const state = {
        order:   overrides.order   || baseOrder,
        item:    overrides.item    || baseItem,
        moItems: overrides.moItems || [],      // manufacturer_order_items rows
        dnItems: overrides.dnItems || [],      // delivery_note_items rows
        invoice: 'invoice' in overrides ? overrides.invoice : null,
        activeCount: overrides.activeCount ?? 2,
        draftRemaining: overrides.draftRemaining ?? 1,
    };
    const calls = [];
    mockQuery.mockImplementation(async (sql, params) => {
        calls.push(sql);
        if (sql.includes('FROM orders') && sql.includes('FOR UPDATE')) {
            return { rowCount: state.order ? 1 : 0, rows: state.order ? [state.order] : [] };
        }
        if (sql.includes('FROM order_items') && sql.includes('FOR UPDATE')) {
            return { rowCount: state.item ? 1 : 0, rows: state.item ? [state.item] : [] };
        }
        if (sql.includes('FROM manufacturer_order_items')) {
            return { rowCount: state.moItems.length, rows: state.moItems };
        }
        if (sql.includes('FROM delivery_note_items')) {
            return { rowCount: state.dnItems.length, rows: state.dnItems };
        }
        if (sql.includes('FROM invoice_items ii') && sql.includes('JOIN invoices')) {
            return { rowCount: state.invoice ? 1 : 0, rows: state.invoice ? [state.invoice] : [] };
        }
        if (sql.includes('COUNT(*)::int AS c FROM order_items')) {
            return { rowCount: 1, rows: [{ c: state.activeCount }] };
        }
        if (sql.includes('DELETE FROM invoice_items')) {
            return { rowCount: 1, rows: [] };
        }
        if (sql.includes('COUNT(*)::int AS c FROM invoice_items')) {
            return { rowCount: 1, rows: [{ c: state.draftRemaining }] };
        }
        if (sql.includes('product_name')) {
            return { rowCount: 1, rows: [{ product_name: 'صنف تجريبي', size_name: 'L' }] };
        }
        if (sql.includes('COALESCE(SUM(quantity * unit_price')) {
            return { rowCount: 1, rows: [{ subtotal: '200' }] };
        }
        return { rowCount: 1, rows: [] };
    });
    return calls;
}

describe('POST /api/orders/:id/items/:itemId/cancel', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.user = { id: 'user-1', name: 'مدير', role: 'admin', permissions: {} };
            next();
        });
        app.use('/api/orders', orderRoutes);
        mockQuery.mockReset();
        mockRelease.mockClear();
    });

    test('cancels an unassigned item: sets cancelled_at and returns success', async () => {
        const calls = mockCancelSequence();
        const res = await request(app)
            .post(`/api/orders/${ORDER_ID}/items/${ITEM_ID}/cancel`)
            .send({ reason: 'العميل كنسل الصنف' });

        expect(res.status).toBe(200);
        expect(res.body.data.item_id).toBe(ITEM_ID);
        expect(calls.some(s => s.includes('SET cancelled_at = NOW()'))).toBe(true);
        expect(calls.some(s => s.includes('INSERT INTO order_notes'))).toBe(true);
    });

    test('rejects when the order is not in production/processing', async () => {
        mockCancelSequence({ order: { ...baseOrder, status: 'quote' } });
        const res = await request(app)
            .post(`/api/orders/${ORDER_ID}/items/${ITEM_ID}/cancel`)
            .send({ reason: 'سبب' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/الإنتاج/);
    });

    test('rejects an already-cancelled item', async () => {
        mockCancelSequence({ item: { ...baseItem, cancelled_at: '2026-09-01T00:00:00Z' } });
        const res = await request(app)
            .post(`/api/orders/${ORDER_ID}/items/${ITEM_ID}/cancel`)
            .send({ reason: 'سبب' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/ملغي بالفعل/);
    });

    test('rejects an item assigned to a manufacturer order (manufacturer_po_qty > 0)', async () => {
        mockCancelSequence({ item: { ...baseItem, manufacturer_po_qty: '5' } });
        const res = await request(app)
            .post(`/api/orders/${ORDER_ID}/items/${ITEM_ID}/cancel`)
            .send({ reason: 'سبب' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/أمر مورد/);
    });

    test('rejects an item with received goods (wh_received_qty > 0)', async () => {
        mockCancelSequence({ item: { ...baseItem, wh_received_qty: '3' } });
        const res = await request(app)
            .post(`/api/orders/${ORDER_ID}/items/${ITEM_ID}/cancel`)
            .send({ reason: 'سبب' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/استلام/);
    });

    test('rejects an item linked to manufacturer_order_items even at zero counter', async () => {
        mockCancelSequence({ moItems: [{ order_item_id: ITEM_ID }] });
        const res = await request(app)
            .post(`/api/orders/${ORDER_ID}/items/${ITEM_ID}/cancel`)
            .send({ reason: 'سبب' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/أمر مورد/);
    });

    test('rejects an item linked to a delivery note', async () => {
        mockCancelSequence({ dnItems: [{ order_item_id: ITEM_ID }] });
        const res = await request(app)
            .post(`/api/orders/${ORDER_ID}/items/${ITEM_ID}/cancel`)
            .send({ reason: 'سبب' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/إذن تسليم/);
    });

    test('rejects an item on an issued invoice — issued invoices are never silently edited', async () => {
        mockCancelSequence({
            invoice: { id: 'inv-1', invoice_number: 'INV-77', status: 'issued', tax_rate: '0.15', additional_expenses: '0', discount_amount: '0' },
        });
        const res = await request(app)
            .post(`/api/orders/${ORDER_ID}/items/${ITEM_ID}/cancel`)
            .send({ reason: 'سبب' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/INV-77/);
    });

    test('rejects draft-invoice removal without explicit consent', async () => {
        mockCancelSequence({
            invoice: { id: 'inv-1', invoice_number: 'PI-12', status: 'draft', tax_rate: '0.15', additional_expenses: '0', discount_amount: '0' },
        });
        const res = await request(app)
            .post(`/api/orders/${ORDER_ID}/items/${ITEM_ID}/cancel`)
            .send({ reason: 'سبب' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('DRAFT_INVOICE_LINE');
        expect(res.body.invoice_number).toBe('PI-12');
    });

    test('with consent: removes the line from the draft invoice and recomputes totals', async () => {
        const calls = mockCancelSequence({
            invoice: { id: 'inv-1', invoice_number: 'PI-12', status: 'draft', tax_rate: '0.15', additional_expenses: '0', discount_amount: '0' },
        });
        const res = await request(app)
            .post(`/api/orders/${ORDER_ID}/items/${ITEM_ID}/cancel`)
            .send({ reason: 'سبب', remove_from_draft_invoice: true });

        expect(res.status).toBe(200);
        expect(res.body.data.removed_from_invoice).toBe('PI-12');
        expect(calls.some(s => s.includes('DELETE FROM invoice_items'))).toBe(true);
        expect(calls.some(s => s.includes('UPDATE invoices SET subtotal'))).toBe(true);
        expect(calls.some(s => s.includes('UPDATE client_transactions SET amount'))).toBe(true);
    });

    test('rejects when removing the line would leave the draft invoice empty', async () => {
        mockCancelSequence({
            invoice: { id: 'inv-1', invoice_number: 'PI-12', status: 'draft', tax_rate: '0.15', additional_expenses: '0', discount_amount: '0' },
            draftRemaining: 0,
        });
        const res = await request(app)
            .post(`/api/orders/${ORDER_ID}/items/${ITEM_ID}/cancel`)
            .send({ reason: 'سبب', remove_from_draft_invoice: true });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/فارغة/);
    });

    test('rejects cancelling the last active item in the order', async () => {
        mockCancelSequence({ activeCount: 0 });
        const res = await request(app)
            .post(`/api/orders/${ORDER_ID}/items/${ITEM_ID}/cancel`)
            .send({ reason: 'سبب' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/آخر بند/);
    });

    test('rejects a missing reason (Zod)', async () => {
        mockCancelSequence();
        const res = await request(app)
            .post(`/api/orders/${ORDER_ID}/items/${ITEM_ID}/cancel`)
            .send({});
        expect(res.status).toBe(400);
    });
});

describe('POST /api/orders/:id/items/:itemId/restore', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.user = { id: 'user-1', name: 'مدير', role: 'admin', permissions: {} };
            next();
        });
        app.use('/api/orders', orderRoutes);
        mockQuery.mockReset();
        mockRelease.mockClear();
    });

    test('restores a cancelled item: clears cancelled_at and returns success', async () => {
        const calls = mockCancelSequence({
            item: { ...baseItem, cancelled_at: '2026-09-01T00:00:00Z', cancelled_by: 'user-1', cancellation_reason: 'سبب' },
        });
        const res = await request(app)
            .post(`/api/orders/${ORDER_ID}/items/${ITEM_ID}/restore`)
            .send({});

        expect(res.status).toBe(200);
        expect(res.body.data.item_id).toBe(ITEM_ID);
        expect(calls.some(s => s.includes('SET cancelled_at = NULL'))).toBe(true);
    });

    test('rejects restoring an item that is not cancelled', async () => {
        mockCancelSequence();
        const res = await request(app)
            .post(`/api/orders/${ORDER_ID}/items/${ITEM_ID}/restore`)
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/غير ملغي/);
    });

    test('rejects restoring when the item gained progress meanwhile', async () => {
        mockCancelSequence({
            item: { ...baseItem, cancelled_at: '2026-09-01T00:00:00Z', manufacturer_po_qty: '2' },
        });
        const res = await request(app)
            .post(`/api/orders/${ORDER_ID}/items/${ITEM_ID}/restore`)
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/صفر تقدّم/);
    });

    test('rejects restoring when the item became linked to an invoice meanwhile', async () => {
        mockCancelSequence({
            item: { ...baseItem, cancelled_at: '2026-09-01T00:00:00Z' },
            invoice: { id: 'inv-9', invoice_number: 'INV-99', status: 'draft' },
        });
        const res = await request(app)
            .post(`/api/orders/${ORDER_ID}/items/${ITEM_ID}/restore`)
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/INV-99/);
    });
});
