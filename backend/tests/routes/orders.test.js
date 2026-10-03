// =============================================================================
// Tests: routes/orders.js  (Zod validation integration)
// =============================================================================

const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();
const mockRelease = jest.fn();
const mockWriteOutboxEvent = jest.fn();
jest.mock('../../services/notification-service', () => ({
    writeOutboxEvent: (...args) => mockWriteOutboxEvent(...args),
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

describe('Orders Routes — Zod Validation', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        // Simulate req.user as the authenticate middleware would
        app.use((req, res, next) => {
            req.user = { id: 1, role: 'admin', permissions: {} };
            next();
        });
        app.use('/api/orders', orderRoutes);
        mockQuery.mockClear();
        mockRelease.mockClear();
        mockWriteOutboxEvent.mockClear();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('POST / should reject missing client_id (Zod)', async () => {
        const res = await request(app)
            .post('/api/orders')
            .send({
                items: [{ variant_id: '550e8400-e29b-41d4-a716-446655440000', quantity: 10 }],
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Validation failed');
        expect(res.body.field).toBe('client_id');
    });

    test('POST / should reject empty items array (Zod)', async () => {
        const res = await request(app)
            .post('/api/orders')
            .send({
                client_id: '550e8400-e29b-41d4-a716-446655440000',
                items: [],
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Validation failed');
        expect(res.body.message).toMatch(/at least one item/i);
    });

    test('POST / should reject invalid item quantity (Zod)', async () => {
        const res = await request(app)
            .post('/api/orders')
            .send({
                client_id: '550e8400-e29b-41d4-a716-446655440000',
                items: [{ variant_id: '550e8400-e29b-41d4-a716-446655440000', quantity: -5 }],
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Validation failed');
        expect(res.body.field).toMatch(/items/);
    });

    test('POST / should reject invalid date format (Zod)', async () => {
        const res = await request(app)
            .post('/api/orders')
            .send({
                client_id: '550e8400-e29b-41d4-a716-446655440000',
                order_date: '16-06-2026',
                items: [{ variant_id: '550e8400-e29b-41d4-a716-446655440000', quantity: 10 }],
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Validation failed');
        expect(res.body.field).toMatch(/order_date/);
    });

    test('converting a quotation queues one manager notification with client and products', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM orders') && sql.includes('FOR UPDATE')) {
                return { rowCount: 1, rows: [{
                    id: 'order-1', order_number: 123, status: 'quote', client_id: 'client-1',
                    grand_total: '1000', paid_amount: '0', created_by: 1,
                }] };
            }
            if (sql.includes('SELECT name FROM clients')) {
                return { rowCount: 1, rows: [{ name: 'عميل الاختبار' }] };
            }
            if (sql.includes("UPDATE orders\n                 SET status")) return { rowCount: 1, rows: [] };
            if (sql.includes('FROM notification_settings')) {
                return { rows: [
                    { key: 'internal_whatsapp_enabled', value: true },
                    { key: 'manager_whatsapp_phone', value: '0550000000' },
                ] };
            }
            if (sql.includes('FROM order_items oi')) {
                return { rows: [{ product_name: 'منتج أول' }, { product_name: 'منتج ثان' }] };
            }
            return { rowCount: 1, rows: [] };
        });

        const res = await request(app)
            .post('/api/orders/order-1/convert-to-production')
            .send({});

        expect(res.status).toBe(200);
        expect(mockWriteOutboxEvent).toHaveBeenCalledWith(expect.objectContaining({
            event_type: 'quotation_converted_to_production',
            entity_type: 'order',
            entity_id: 'order-1',
            payload: expect.objectContaining({
                order_number: 123,
                client_name: 'عميل الاختبار',
                products: ['منتج أول', 'منتج ثان'],
            }),
            session: 'internal',
        }), expect.anything());
    });

    test('converting a quotation records the down payment voucher on the chosen payment_date', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM orders') && sql.includes('FOR UPDATE')) {
                return { rowCount: 1, rows: [{
                    id: 'order-1', order_number: 123, status: 'quote', client_id: 'client-1',
                    grand_total: '1000', paid_amount: '0', created_by: 1,
                }] };
            }
            if (sql.includes('SELECT name FROM clients')) {
                return { rowCount: 1, rows: [{ name: 'عميل الاختبار' }] };
            }
            if (sql.includes("FROM accounts WHERE code = '1300'")) {
                return { rowCount: 1, rows: [{ id: 'ar-1' }] };
            }
            if (sql.includes('FROM accounts WHERE code = $1')) {
                return { rowCount: 1, rows: [{ id: 'bank-acc-1' }] };
            }
            if (sql.includes('INSERT INTO accounting_vouchers')) {
                return { rowCount: 1, rows: [{ id: 'v-1', voucher_number: 900 }] };
            }
            if (sql.includes('FROM notification_settings')) return { rows: [] };
            return { rowCount: 1, rows: [] };
        });

        const res = await request(app)
            .post('/api/orders/order-1/convert-to-production')
            .send({
                down_payment_amount: 500,
                payment_method: 'bank_transfer',
                bank_account: 'snb',
                bank_ref: 'TRF-1',
                payment_date: '2026-09-15',
            });

        expect(res.status).toBe(200);

        const voucherInsert = mockQuery.mock.calls.find(([sql]) =>
            sql.includes('INSERT INTO accounting_vouchers'));
        expect(voucherInsert).toBeDefined();
        expect(voucherInsert[0]).toContain('COALESCE($5::date, CURRENT_DATE)');
        expect(voucherInsert[1][4]).toBe('2026-09-15');

        const txInsert = mockQuery.mock.calls.find(([sql]) =>
            sql.includes('INSERT INTO client_transactions'));
        expect(txInsert).toBeDefined();
        expect(txInsert[1][6]).toBe('2026-09-15');
    });

    test('converting a quotation without payment_date falls back to CURRENT_DATE', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM orders') && sql.includes('FOR UPDATE')) {
                return { rowCount: 1, rows: [{
                    id: 'order-1', order_number: 123, status: 'quote', client_id: 'client-1',
                    grand_total: '1000', paid_amount: '0', created_by: 1,
                }] };
            }
            if (sql.includes('SELECT name FROM clients')) {
                return { rowCount: 1, rows: [{ name: 'عميل الاختبار' }] };
            }
            if (sql.includes("FROM accounts WHERE code = '1300'")) {
                return { rowCount: 1, rows: [{ id: 'ar-1' }] };
            }
            if (sql.includes('FROM accounts WHERE code = $1')) {
                return { rowCount: 1, rows: [{ id: 'cash-acc-1' }] };
            }
            if (sql.includes('INSERT INTO accounting_vouchers')) {
                return { rowCount: 1, rows: [{ id: 'v-1', voucher_number: 901 }] };
            }
            if (sql.includes('FROM notification_settings')) return { rows: [] };
            return { rowCount: 1, rows: [] };
        });

        const res = await request(app)
            .post('/api/orders/order-1/convert-to-production')
            .send({ down_payment_amount: 100, payment_method: 'cash', cash_box: 'main' });

        expect(res.status).toBe(200);
        const voucherInsert = mockQuery.mock.calls.find(([sql]) =>
            sql.includes('INSERT INTO accounting_vouchers'));
        expect(voucherInsert[1][4]).toBeNull();
    });

    test('converting a quotation rejects an invalid payment_date format', async () => {
        const res = await request(app)
            .post('/api/orders/order-1/convert-to-production')
            .send({
                down_payment_amount: 100,
                payment_method: 'cash',
                cash_box: 'main',
                payment_date: '15-09-2026',
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Validation failed');
        expect(res.body.field).toMatch(/payment_date/);
    });

    test('GET / exposes has_final_invoice derived from valid final invoice statuses', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [
            { id: 'o1', status: 'completed', has_final_invoice: true,  total_count: 2 },
            { id: 'o2', status: 'delivered', has_final_invoice: false, total_count: 2 },
        ] });

        const res = await request(app).get('/api/orders?statuses=completed,delivered');

        expect(res.status).toBe(200);
        const sql = mockQuery.mock.calls[0][0];
        expect(sql).toContain('has_final_invoice');
        expect(sql).toContain("'issued', 'paid', 'overdue', 'archived'");
        expect(sql).not.toContain("inv.status = 'final'");
        expect(res.body.data[0].has_final_invoice).toBe(true);
        expect(res.body.data[1].has_final_invoice).toBe(false);
    });

    test('GET /ready-for-invoice excludes orders having a final-status invoice', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ total: 1 }] })
            .mockResolvedValueOnce({ rows: [{ id: 'o1', order_number: 7, status: 'delivered' }] });

        const res = await request(app).get('/api/orders/ready-for-invoice');

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
        for (const call of mockQuery.mock.calls) {
            expect(call[0]).toContain("'issued', 'paid', 'overdue', 'archived'");
            expect(call[0]).not.toContain("inv.status = 'final'");
            expect(call[0]).not.toContain("status = 'final'");
        }
        // delivered orders without a final invoice are eligible for invoicing
        expect(mockQuery.mock.calls[0][0]).toContain("'delivered'");
    });

    test('POST /:id/invoice issues a final invoice for a delivered order', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('system_settings')) return { rows: [] };
            if (sql.includes('FOR UPDATE')) {
                return { rowCount: 1, rows: [{ id: 'o1', order_number: 1, client_id: 'c1', status: 'delivered', grand_total: '0' }] };
            }
            if (sql.includes('FROM invoices') && sql.includes("status = 'issued'")) return { rowCount: 0, rows: [] };
            if (sql.includes('FROM order_items oi')) return { rowCount: 1, rows: [{ received: '10', product_name: 'P', size_name: 'M' }] };
            if (sql.includes('INSERT INTO invoices')) return { rowCount: 1, rows: [{ id: 'inv1', invoice_number: 42 }] };
            if (sql.includes('INSERT INTO invoice_items')) return { rowCount: 1, rows: [] };
            if (sql.includes('UPDATE orders')) return { rowCount: 1, rows: [] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app)
            .post('/api/orders/o1/invoice')
            .send({ type: 'final', items: [{ order_item_id: '660e8400-e29b-41d4-a716-446655440000', variant_id: '550e8400-e29b-41d4-a716-446655440000', qty: 2, unit_price: 100 }] });

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ invoice_id: 'inv1', invoice_number: 42 });
        const itemInsert = mockQuery.mock.calls.find(([sql, params]) =>
            sql.includes('INSERT INTO invoice_items') && !sql.includes('is_extra'));
        expect(itemInsert[0]).toContain('order_item_id');
        expect(itemInsert[1]).toContain('660e8400-e29b-41d4-a716-446655440000');
    });

    test('POST /:id/invoice stores extra free-text items on a proforma invoice', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('system_settings')) return { rows: [] };
            if (sql.includes('FOR UPDATE')) {
                return { rowCount: 1, rows: [{ id: 'o1', order_number: 1, client_id: 'c1', status: 'production', grand_total: '0' }] };
            }
            if (sql.includes('FROM invoices') && sql.includes("status = 'draft'")) return { rowCount: 0, rows: [] };
            if (sql.includes('INSERT INTO invoices')) return { rowCount: 1, rows: [{ id: 'inv1', invoice_number: 50 }] };
            if (sql.includes('INSERT INTO invoice_items')) return { rowCount: 1, rows: [] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app)
            .post('/api/orders/o1/invoice')
            .send({ type: 'proforma', items: [
                { variant_id: '550e8400-e29b-41d4-a716-446655440000', qty: 2, unit_price: 100 },
                { item_name: 'كلايش', qty: 4, unit_price: 250, is_extra: true },
            ] });

        expect(res.status).toBe(201);
        const extraInsert = mockQuery.mock.calls.find(([sql, params]) =>
            sql.includes('INSERT INTO invoice_items') && sql.includes('is_extra'));
        expect(extraInsert).toBeDefined();
        expect(extraInsert[1]).toContain('كلايش');
        expect(extraInsert[1][0]).toBe('inv1');
    });

    test('POST /:id/invoice copies proforma extra items into the final invoice', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('system_settings')) return { rows: [] };
            if (sql.includes('FOR UPDATE')) {
                return { rowCount: 1, rows: [{ id: 'o1', order_number: 1, client_id: 'c1', status: 'delivered', grand_total: '0' }] };
            }
            if (sql.includes('FROM invoices') && sql.includes("status = 'issued'")) return { rowCount: 0, rows: [] };
            if (sql.includes('FROM invoice_items ii') && sql.includes('JOIN invoices pi')) {
                return { rowCount: 1, rows: [{ item_name: 'كلايش', quantity: '4', unit_price: '250', discount_percent: '0' }] };
            }
            if (sql.includes('FROM order_items oi')) return { rowCount: 1, rows: [{ received: '10', product_name: 'P', size_name: 'M' }] };
            if (sql.includes('INSERT INTO invoices')) return { rowCount: 1, rows: [{ id: 'inv2', invoice_number: 51 }] };
            if (sql.includes('INSERT INTO invoice_items')) return { rowCount: 1, rows: [] };
            if (sql.includes('UPDATE orders')) return { rowCount: 1, rows: [] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app)
            .post('/api/orders/o1/invoice')
            .send({ type: 'final', items: [{ variant_id: '550e8400-e29b-41d4-a716-446655440000', qty: 2, unit_price: 100 }] });

        expect(res.status).toBe(201);
        const carriedInsert = mockQuery.mock.calls.find(([sql, params]) =>
            sql.includes('INSERT INTO invoice_items') && sql.includes('TRUE') && params.includes('كلايش'));
        expect(carriedInsert).toBeDefined();
        expect(carriedInsert[1][0]).toBe('inv2');
    });

    test('POST /:id/invoice rejects extra items submitted directly on a final invoice', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('system_settings')) return { rows: [] };
            if (sql.includes('FOR UPDATE')) {
                return { rowCount: 1, rows: [{ id: 'o1', order_number: 1, client_id: 'c1', status: 'delivered', grand_total: '0' }] };
            }
            if (sql.includes('FROM invoices') && sql.includes("status = 'issued'")) return { rowCount: 0, rows: [] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app)
            .post('/api/orders/o1/invoice')
            .send({ type: 'final', items: [{ item_name: 'كلايش', qty: 1, unit_price: 100, is_extra: true }] });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('الأولية');
        expect(mockQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO invoice_items'))).toBe(false);
    });

    test('POST /:id/invoice rejects extra items without a name on proforma', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('system_settings')) return { rows: [] };
            if (sql.includes('FOR UPDATE')) {
                return { rowCount: 1, rows: [{ id: 'o1', order_number: 1, client_id: 'c1', status: 'production', grand_total: '0' }] };
            }
            if (sql.includes('FROM invoices') && sql.includes("status = 'draft'")) return { rowCount: 0, rows: [] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app)
            .post('/api/orders/o1/invoice')
            .send({ type: 'proforma', items: [{ item_name: '  ', qty: 1, unit_price: 100, is_extra: true }] });

        expect(res.status).toBe(400);
        expect(mockQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO invoice_items'))).toBe(false);
    });

    test('POST /:id/invoice still rejects non-production statuses like quote', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('system_settings')) return { rows: [] };
            if (sql.includes('FOR UPDATE')) {
                return { rowCount: 1, rows: [{ id: 'o1', order_number: 1, client_id: 'c1', status: 'quote', grand_total: '0' }] };
            }
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app)
            .post('/api/orders/o1/invoice')
            .send({ type: 'final', items: [{ variant_id: '550e8400-e29b-41d4-a716-446655440000', qty: 1, unit_price: 10 }] });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('فاتورة');
    });

    test('GET /:id includes direct receipt supplier and source metadata', async () => {
        mockQuery
            .mockResolvedValueOnce({ rowCount: 1, rows: [{
                id: '550e8400-e29b-41d4-a716-446655440000',
                order_number: 1001,
                status: 'production',
                client_id: '660e8400-e29b-41d4-a716-446655440000',
                client_name: 'Test Client',
                direct_receipt_id: '770e8400-e29b-41d4-a716-446655440000',
                direct_receipt_supplier_name: 'Test Supplier',
                direct_receipt_number: 12,
                direct_receipt_purchase_invoice_number: 2001,
            }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const res = await request(app)
            .get('/api/orders/550e8400-e29b-41d4-a716-446655440000');

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            direct_receipt_supplier_name: 'Test Supplier',
            direct_receipt_number: 12,
            direct_receipt_purchase_invoice_number: 2001,
        });
        expect(mockQuery.mock.calls[0][0]).toContain('direct_receipt_supplier_name');
        // Hub needs closure + final-invoice state to offer "move to completed"
        expect(mockQuery.mock.calls[0][0]).toContain('closed_without_invoice');
        expect(mockQuery.mock.calls[0][0]).toContain('has_final_invoice');
        // Items must expose delivered_qty so remaining = received - delivered
        expect(mockQuery.mock.calls[2][0]).toContain('oi.delivered_qty');
    });

    // ── closed_without_invoice (move to Completed without a final invoice) ────

    test('PATCH /:id/closure marks a delivered order closed without invoice', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('SELECT id, status FROM orders')) {
                return { rowCount: 1, rows: [{ id: 'o1', status: 'delivered' }] };
            }
            if (sql.includes('closed_without_invoice = $1')) {
                return { rowCount: 1, rows: [{ id: 'o1', status: 'delivered', closed_without_invoice: true, closed_at: 'now' }] };
            }
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app)
            .patch('/api/orders/o1/closure')
            .send({ closed: true });

        expect(res.status).toBe(200);
        expect(res.body.data.closed_without_invoice).toBe(true);
        const update = mockQuery.mock.calls.find(([sql]) => sql.includes('closed_without_invoice = $1'));
        expect(update).toBeDefined();
        expect(update[1][0]).toBe(true);
    });

    test('PATCH /:id/closure rejects closing an order still in production', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('SELECT id, status FROM orders')) {
                return { rowCount: 1, rows: [{ id: 'o1', status: 'production' }] };
            }
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app)
            .patch('/api/orders/o1/closure')
            .send({ closed: true });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('بدون فاتورة');
        expect(mockQuery.mock.calls.some(([sql]) => sql.includes('closed_without_invoice = $1'))).toBe(false);
    });

    test('PATCH /:id/closure reopens a closed order back to awaiting invoice', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('SELECT id, status FROM orders')) {
                return { rowCount: 1, rows: [{ id: 'o1', status: 'completed' }] };
            }
            if (sql.includes('closed_without_invoice = $1')) {
                return { rowCount: 1, rows: [{ id: 'o1', status: 'completed', closed_without_invoice: false, closed_at: null }] };
            }
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app)
            .patch('/api/orders/o1/closure')
            .send({ closed: false });

        expect(res.status).toBe(200);
        expect(res.body.data.closed_without_invoice).toBe(false);
        const update = mockQuery.mock.calls.find(([sql]) => sql.includes('closed_without_invoice = $1'));
        expect(update[1][0]).toBe(false);
    });

    test('PATCH /:id/closure requires the closed flag (Zod)', async () => {
        const res = await request(app)
            .patch('/api/orders/o1/closure')
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Validation failed');
    });

    test('PATCH /:id/closure returns 404 for a missing order', async () => {
        mockQuery.mockImplementation(async () => ({ rowCount: 0, rows: [] }));

        const res = await request(app)
            .patch('/api/orders/o-missing/closure')
            .send({ closed: true });

        expect(res.status).toBe(404);
        expect(mockQuery.mock.calls.some(([sql]) => sql.includes('closed_without_invoice = $1'))).toBe(false);
    });

    test('GET /ready-for-invoice also excludes orders closed without invoice', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ total: 0 }] })
            .mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/orders/ready-for-invoice');

        expect(res.status).toBe(200);
        for (const call of mockQuery.mock.calls) {
            expect(call[0]).toContain('closed_without_invoice');
        }
    });

    test('POST /:id/invoice issuing a final invoice clears closed_without_invoice', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('system_settings')) return { rows: [] };
            if (sql.includes('FOR UPDATE')) {
                return { rowCount: 1, rows: [{ id: 'o1', order_number: 1, client_id: 'c1', status: 'delivered', grand_total: '0' }] };
            }
            if (sql.includes('FROM invoices') && sql.includes("status = 'issued'")) return { rowCount: 0, rows: [] };
            if (sql.includes('FROM order_items oi')) return { rowCount: 1, rows: [{ received: '10', product_name: 'P', size_name: 'M' }] };
            if (sql.includes('INSERT INTO invoices')) return { rowCount: 1, rows: [{ id: 'inv1', invoice_number: 42 }] };
            if (sql.includes('INSERT INTO invoice_items')) return { rowCount: 1, rows: [] };
            if (sql.includes('UPDATE orders')) return { rowCount: 1, rows: [] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app)
            .post('/api/orders/o1/invoice')
            .send({ type: 'final', items: [{ variant_id: '550e8400-e29b-41d4-a716-446655440000', qty: 2, unit_price: 100 }] });

        expect(res.status).toBe(201);
        const orderUpdate = mockQuery.mock.calls.find(([sql]) =>
            sql.includes('UPDATE orders') && sql.includes('closed_without_invoice = FALSE'));
        expect(orderUpdate).toBeDefined();
    });
});

describe('Orders — POST /:id/payment receipt voucher', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.user = { id: 1, role: 'admin', permissions: {} };
            next();
        });
        app.use('/api/orders', orderRoutes);
        mockQuery.mockClear();
    });

    function mockOrder(paid = '0', total = '1000') {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM orders') && sql.includes('FOR UPDATE')) {
                return { rowCount: 1, rows: [{
                    id: 'o-1', order_number: 55, client_id: 'client-1',
                    grand_total: total, paid_amount: paid, status: 'production',
                }] };
            }
            if (sql.includes("code = '1300'")) return { rowCount: 1, rows: [{ id: 'ar-1' }] };
            if (sql.includes("code = '4300'")) return { rowCount: 1, rows: [{ id: 'disc-1' }] };
            if (sql.includes('FROM accounts WHERE code = $1')) return { rowCount: 1, rows: [{ id: 'cash-1' }] };
            if (sql.includes('INSERT INTO accounting_vouchers')) return { rowCount: 1, rows: [{ id: 'v-9', voucher_number: 77 }] };
            if (sql.includes('INSERT INTO client_transactions')) return { rowCount: 1, rows: [{ id: 'ct-1', document_number: 'D-1' }] };
            return { rowCount: 1, rows: [] };
        });
    }

    test('records a posted receipt voucher: DR cash / CR AR(client), ct linked', async () => {
        mockOrder('0', '1000');
        const res = await request(app)
            .post('/api/orders/o-1/payment')
            .send({ amount: 400, payment_method: 'cash', cash_box: '1110', payment_date: '2026-09-12' });
        expect(res.status).toBe(201);

        const v = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO accounting_vouchers'));
        expect(v[0]).toContain("'receipt'");
        expect(v[0]).toContain('COALESCE($5::date, CURRENT_DATE)');
        expect(v[1][1]).toBe(400);          // total_amount
        expect(v[1][4]).toBe('2026-09-12'); // voucher_date

        const lines = mockQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO accounting_voucher_lines'));
        expect(lines.length).toBe(2); // DR cash 400 / CR AR 400 (no discount line)
        expect(lines.some(([, p]) => p[1] === 'cash-1' && p[2] === 400)).toBe(true);
        expect(lines.some(([, p]) => p[1] === 'ar-1' && p[2] === 400 && p[3] === 'client-1')).toBe(true);

        const ct = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO client_transactions'));
        expect(ct[0]).toContain('linked_voucher_id');
        expect(ct[1]).toContain('v-9');
        expect(ct[1][6]).toBe('2026-09-12'); // created_at param
    });

    test('payment + discount posts a balanced 3-line voucher on 4300', async () => {
        mockOrder('600', '1000');
        const res = await request(app)
            .post('/api/orders/o-1/payment')
            .send({ amount: 350, discount_amount: 50, payment_method: 'cash', cash_box: '1110' });
        expect(res.status).toBe(201);

        const lines = mockQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO accounting_voucher_lines'));
        expect(lines.length).toBe(3);
        expect(lines.some(([, p]) => p[1] === 'disc-1' && p[2] === 50)).toBe(true);
    });

    test('rejects payment exceeding the remaining balance', async () => {
        mockOrder('600', '1000'); // remaining 400
        const res = await request(app)
            .post('/api/orders/o-1/payment')
            .send({ amount: 401, payment_method: 'cash', cash_box: '1110' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/تتجاوز المتبقي/);
    });

    test('rejects payment without a resolvable receiving account', async () => {
        mockOrder('0', '1000');
        const res = await request(app)
            .post('/api/orders/o-1/payment')
            .send({ amount: 100, payment_method: 'cash' }); // no cash_box
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/حساب الصندوق\/البنك/);
    });
});
