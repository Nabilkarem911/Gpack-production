'use strict';

const {
    createProductionOrderFromReceipt,
    revertDirectReceiptToReview,
} = require('../../services/direct-receipt-order-service');

const receiptId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const invoiceId = '33333333-3333-4333-8333-333333333333';
const clientId = '44444444-4444-4444-8444-444444444444';
const variantId = '55555555-5555-4555-8555-555555555555';
const warehouseId = '66666666-6666-4666-8666-666666666666';
const userId = '77777777-7777-4777-8777-777777777777';

function makeClient(handler) {
    const calls = [];
    return {
        calls,
        query: jest.fn(async (sql, params) => {
            calls.push({ sql, params });
            return handler(sql, params);
        }),
    };
}

describe('direct receipt production order service', () => {
    test('creates one VMI production order with zero financial values', async () => {
        const client = makeClient((sql) => {
            if (sql.includes('SELECT production_order_id')) return { rowCount: 1, rows: [{ production_order_id: null }] };
            if (sql.includes('INSERT INTO orders')) return { rowCount: 1, rows: [{ id: orderId, order_number: 1001, client_id: clientId, status: 'production' }] };
            if (sql.includes('INSERT INTO order_items')) return { rowCount: 1, rows: [{ id: 'item-id', variant_id: variantId, quantity: 4, unit_price: 0, wh_received_qty: 4 }] };
            return { rowCount: 1, rows: [] };
        });

        const result = await createProductionOrderFromReceipt(client, {
            receiptId,
            receiptNumber: 12,
            userId,
            items: [{ variant_id: variantId, client_id: clientId, confirmed_quantity: 4 }],
        });

        expect(result.id).toBe(orderId);
        const orderInsert = client.calls.find(call => call.sql.includes('INSERT INTO orders'));
        expect(orderInsert.sql).toContain('(client_id, status, order_number, internal_notes)');
        expect(orderInsert.sql).not.toContain('grand_total');
        expect(orderInsert.params.slice(0, 2)).toEqual([clientId, 'production']);
        const itemInsert = client.calls.find(call => call.sql.includes('INSERT INTO order_items'));
        expect(itemInsert.sql).toContain('wh_received_qty');
        expect(itemInsert.params.slice(0, 4)).toEqual([orderId, variantId, 4, 4]);
    });

    test('is idempotent when the receipt already has a generated order', async () => {
        const client = makeClient((sql) => {
            if (sql.includes('SELECT production_order_id')) return { rowCount: 1, rows: [{ production_order_id: orderId }] };
            if (sql.includes('SELECT id, order_number, status')) return { rowCount: 1, rows: [{ id: orderId, order_number: 1001, status: 'production' }] };
            throw new Error(`Unexpected query: ${sql}`);
        });

        const result = await createProductionOrderFromReceipt(client, {
            receiptId,
            receiptNumber: 12,
            userId,
            items: [{ variant_id: variantId, client_id: clientId, confirmed_quantity: 4 }],
        });

        expect(result.id).toBe(orderId);
        expect(client.calls.some(call => call.sql.includes('INSERT INTO orders'))).toBe(false);
    });

    test('reverses stock using warehouse, variant, and exact client', async () => {
        const client = makeClient((sql) => {
            if (sql.includes('FROM direct_receipts')) return { rowCount: 1, rows: [{
                receipt_number: 12, status: 'converted', warehouse_id: warehouseId,
                purchase_invoice_id: invoiceId, production_order_id: orderId,
            }] };
            if (sql.includes('FROM orders WHERE')) return { rowCount: 1, rows: [{ id: orderId, status: 'production' }] };
            if (sql.includes('FROM client_transactions')) return { rowCount: 0, rows: [] };
            if (sql.includes('FROM invoices WHERE')) return { rowCount: 0, rows: [] };
            if (sql.includes('FROM delivery_notes')) return { rowCount: 0, rows: [] };
            if (sql.includes('COALESCE(released_qty')) return { rowCount: 0, rows: [] };
            if (sql.includes('FROM purchase_invoices')) return { rowCount: 1, rows: [{ status: 'draft', paid_amount: 0 }] };
            if (sql.includes('transaction_type IN')) return { rowCount: 0, rows: [] };
            if (sql.includes('FROM inventory_transactions')) return { rowCount: 1, rows: [{
                stock_id: 'stock-id', variant_id: variantId, quantity: '4',
                warehouse_to: warehouseId, client_id: clientId,
                created_at: new Date('2026-01-01T00:00:00Z'),
            }] };
            if (sql.includes('FROM warehouse_stock')) return { rowCount: 1, rows: [{ id: 'stock-id', quantity: '10', reserved_qty: 0 }] };
            if (sql.includes('transaction_type IN')) return { rowCount: 0, rows: [] };
            return { rowCount: 1, rows: [] };
        });

        await revertDirectReceiptToReview(client, { receiptId, userId });

        const stockLookup = client.calls.find(call => call.sql.includes('FROM warehouse_stock'));
        expect(stockLookup.params).toEqual([warehouseId, variantId, clientId]);
        expect(client.calls.some(call => call.sql.includes("transaction_type, quantity") && call.sql.includes("'reversal'"))).toBe(true);
        expect(client.calls.some(call => call.sql.includes("SET status = 'pending_review'"))).toBe(true);
    });

    test.each([
        ['a sales invoice', 'FROM invoices WHERE', 'توجد فاتورة مبيعات'],
        ['a delivery note', 'FROM delivery_notes', 'يوجد سند تسليم'],
        ['released or delivered quantities', 'COALESCE(released_qty', 'تم صرف أو تسليم'],
    ])('blocks reversal when %s exists', async (_name, blockedQuery, expectedMessage) => {
        const client = makeClient((sql) => {
            if (sql.includes('FROM direct_receipts')) return { rowCount: 1, rows: [{
                receipt_number: 12, status: 'converted', warehouse_id: warehouseId,
                purchase_invoice_id: invoiceId, production_order_id: orderId,
            }] };
            if (sql.includes('FROM orders WHERE')) return { rowCount: 1, rows: [{ id: orderId, status: 'production' }] };
            if (sql.includes(blockedQuery)) return { rowCount: 1, rows: [{ id: 'blocked-id' }] };
            if (sql.includes('FROM client_transactions') || sql.includes('FROM invoices WHERE') ||
                sql.includes('FROM delivery_notes') || sql.includes('COALESCE(released_qty')) {
                return { rowCount: 0, rows: [] };
            }
            throw new Error(`Unexpected query: ${sql}`);
        });

        await expect(revertDirectReceiptToReview(client, { receiptId, userId }))
            .rejects.toThrow(expectedMessage);
        expect(client.calls.some(call => call.sql.includes('UPDATE warehouse_stock'))).toBe(false);
    });

    test('blocks reversal when stock was dispensed or consumed', async () => {
        const client = makeClient((sql) => {
            if (sql.includes('FROM direct_receipts')) return { rowCount: 1, rows: [{
                receipt_number: 12, status: 'converted', warehouse_id: warehouseId,
                purchase_invoice_id: invoiceId, production_order_id: orderId,
            }] };
            if (sql.includes('FROM orders WHERE')) return { rowCount: 1, rows: [{ id: orderId, status: 'production' }] };
            if (sql.includes('FROM client_transactions') || sql.includes('FROM invoices WHERE') ||
                sql.includes('FROM delivery_notes') || sql.includes('COALESCE(released_qty')) {
                return { rowCount: 0, rows: [] };
            }
            if (sql.includes('FROM purchase_invoices')) return { rowCount: 1, rows: [{ status: 'draft', paid_amount: 0 }] };
            if (sql.includes('FROM inventory_transactions') && sql.includes("transaction_type = 'receipt'")) {
                return { rowCount: 1, rows: [{
                    stock_id: 'stock-id', variant_id: variantId, quantity: '4',
                    warehouse_to: warehouseId, client_id: clientId,
                    created_at: new Date('2026-01-01T00:00:00Z'),
                }] };
            }
            if (sql.includes('FROM warehouse_stock')) return { rowCount: 1, rows: [{ id: 'stock-id', quantity: '10', reserved_qty: 0 }] };
            if (sql.includes('transaction_type IN')) return { rowCount: 1, rows: [{ id: 'dispense-id' }] };
            throw new Error(`Unexpected query: ${sql}`);
        });

        await expect(revertDirectReceiptToReview(client, { receiptId, userId }))
            .rejects.toThrow('تم صرف أو استهلاك');
        expect(client.calls.some(call => call.sql.includes('UPDATE warehouse_stock'))).toBe(false);
    });

    test('blocks reversal when a client payment exists', async () => {
        const client = makeClient((sql) => {
            if (sql.includes('FROM direct_receipts')) return { rowCount: 1, rows: [{
                receipt_number: 12, status: 'converted', warehouse_id: warehouseId,
                purchase_invoice_id: invoiceId, production_order_id: orderId,
            }] };
            if (sql.includes('FROM orders WHERE')) return { rowCount: 1, rows: [{ id: orderId, status: 'production' }] };
            if (sql.includes('FROM client_transactions')) return { rowCount: 1, rows: [{ id: 'payment-id' }] };
            throw new Error(`Unexpected query: ${sql}`);
        });

        await expect(revertDirectReceiptToReview(client, { receiptId, userId }))
            .rejects.toThrow('توجد دفعة');
        expect(client.calls.some(call => call.sql.includes('UPDATE warehouse_stock'))).toBe(false);
    });
});
