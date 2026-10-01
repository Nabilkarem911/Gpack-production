'use strict';

// =============================================================================
// Shelf-sync strictness tests — verify that a failed shelf deduction ABORTS
// the transaction instead of warn-and-continuing, that missing stock rows
// block reversals, and that legacy fallbacks refuse ambiguous restores.
// =============================================================================

const request = require('supertest');
const express = require('express');

const WH    = 'a1000000-0000-4000-8000-000000000001';
const STK   = 'b2000000-0000-4000-8000-000000000001';
const STK2  = 'b3000000-0000-4000-8000-000000000001';
const VAR   = 'c4000000-0000-4000-8000-000000000001';
const VOUCH = 'd5000000-0000-4000-8000-000000000001';
const SUPP  = 'e6000000-0000-4000-8000-000000000001';
const MO    = 'f7000000-0000-4000-8000-000000000001';
const SES   = 'f8000000-0000-4000-8000-000000000001';
const SESI  = 'f9000000-0000-4000-8000-000000000001';
const MOI   = 'f1100000-0000-4000-8000-000000000001';
const ORD   = 'f2200000-0000-4000-8000-000000000001';
const ACC1  = 'f3300000-0000-4000-8000-000000000001';
const ACC2  = 'f4400000-0000-4000-8000-000000000001';

const mockClientQuery = jest.fn();
const mockClient = {
    query: (...args) => mockClientQuery(...args),
    release: jest.fn(),
};
const mockPoolQuery = jest.fn(async () => ({ rowCount: 0, rows: [] }));

jest.mock('../../db', () => ({
    withTransaction: async (callback) => callback(mockClient),
    getClient: async () => mockClient,
    query: (...args) => mockPoolQuery(...args),
    pool: { query: (...args) => mockPoolQuery(...args) },
}));
jest.mock('../../middleware/authorize', () => () => (_req, _res, next) => next());
jest.mock('../../utils/event-bus', () => ({ emit: jest.fn() }));
jest.mock('../../services/shelf-service', () => ({
    deductFromStock: jest.fn(async () => 0),
    reversePlacements: jest.fn(async () => 0),
    restorePicks: jest.fn(async () => ({ count: 0, stockAdds: [] })),
    placeOnShelf: jest.fn(),
    logUnassignedPick: jest.fn(),
}));

const shelfService = require('../../services/shelf-service');
const inventoryRoutes = require('../../routes/inventory');
const receivingVoucherRoutes = require('../../routes/receiving-vouchers');
const purchaseReturnRoutes = require('../../routes/purchase-returns');
const manufacturerOrderRoutes = require('../../routes/manufacturer_orders');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { id: '77777777-7777-4777-8777-777777777777', role: 'admin' };
        next();
    });
    app.use('/api/inventory', inventoryRoutes);
    app.use('/api/receiving-vouchers', receivingVoucherRoutes);
    app.use('/api/purchase-returns', purchaseReturnRoutes);
    app.use('/api/manufacturer-orders', manufacturerOrderRoutes);
    return app;
}

const shelfConflict = () => Object.assign(
    new Error('تعارض في رصيد الرفوف — الكمية المطلوبة تتجاوز المتاح فعليًا.'),
    { statusCode: 409 }
);

const callsWith = (needle) =>
    mockClientQuery.mock.calls.filter(([sql]) => String(sql).includes(needle));

beforeEach(() => {
    mockClientQuery.mockReset();
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValue({ rowCount: 0, rows: [] });
    mockClient.release.mockReset();
    shelfService.deductFromStock.mockReset().mockResolvedValue(0);
    shelfService.reversePlacements.mockReset().mockResolvedValue(0);
});

describe('inventory stock/adjust — shelf-sync failure aborts', () => {
    test('single decrease: deductFromStock failure → error response, no stock update', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql.includes('SELECT id FROM warehouse_stock WHERE id = $1 FOR UPDATE')) {
                return { rowCount: 1, rows: [{ id: STK }] };
            }
            return { rowCount: 0, rows: [] };
        });
        shelfService.deductFromStock.mockRejectedValue(shelfConflict());

        const res = await request(buildApp())
            .post('/api/inventory/stock/adjust')
            .send({ stock_id: STK, adjustment: -5, reason: 'تلف' });

        expect(res.status).toBe(409);
        expect(res.body.error).toContain('تعارض في رصيد الرفوف');
        expect(callsWith('UPDATE warehouse_stock')).toHaveLength(0);
    });

    test('batch decrease: deductFromStock failure → error response, no stock update', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql.includes('SELECT client_id FROM warehouses')) {
                return { rowCount: 1, rows: [{ client_id: null }] };
            }
            if (sql.includes('FROM warehouse_stock') && sql.includes('FOR UPDATE')) {
                return { rowCount: 1, rows: [{ id: STK }] };
            }
            return { rowCount: 0, rows: [] };
        });
        shelfService.deductFromStock.mockRejectedValue(shelfConflict());

        const res = await request(buildApp())
            .post('/api/inventory/stock/adjust')
            .send({
                items: [{ warehouse_id: WH, variant_id: VAR, quantity: 5, adjustment_type: 'decrease' }],
                reason: 'تلف',
            });

        expect(res.status).toBe(409);
        expect(callsWith('UPDATE warehouse_stock')).toHaveLength(0);
    });
});

describe('receiving-vouchers void — confident stock-row resolution', () => {
    function setupVoucher(candidates, { pinned = false } = {}) {
        mockPoolQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM receiving_vouchers WHERE id')) {
                return { rowCount: 1, rows: [{ id: VOUCH, status: 'completed' }] };
            }
            return { rowCount: 0, rows: [] };
        });
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql.includes('SELECT warehouse_id FROM receiving_vouchers')) {
                return { rowCount: 1, rows: [{ warehouse_id: WH }] };
            }
            if (sql.includes('FROM receiving_voucher_items')) {
                return {
                    rowCount: 1,
                    rows: [{ variant_id: VAR, quantity: 5, warehouse_stock_id: pinned ? STK : null }],
                };
            }
            if (sql.includes('FROM warehouse_stock') && sql.includes('FOR UPDATE')) {
                return { rowCount: candidates.length, rows: candidates };
            }
            return { rowCount: 0, rows: [] };
        });
    }

    test('ambiguous legacy item (multiple candidates) → 409, no void', async () => {
        setupVoucher([{ id: STK, quantity: 10 }, { id: STK2, quantity: 8 }]);

        const res = await request(buildApp()).delete(`/api/receiving-vouchers/${VOUCH}`);

        expect(res.status).toBe(409);
        expect(res.body.error).toContain('تعذّر تحديد سجل المخزون الأصلي');
        expect(callsWith('COMMIT')).toHaveLength(0);
        expect(callsWith("SET status = 'voided'")).toHaveLength(0);
    });

    test('missing stock row → 409, no void', async () => {
        setupVoucher([]);

        const res = await request(buildApp()).delete(`/api/receiving-vouchers/${VOUCH}`);

        expect(res.status).toBe(409);
        expect(res.body.error).toContain('سجل المخزون المرتبط بالبند غير موجود');
        expect(callsWith("SET status = 'voided'")).toHaveLength(0);
    });

    test('single legacy candidate → void proceeds and commits', async () => {
        setupVoucher([{ id: STK, quantity: 10 }]);

        const res = await request(buildApp()).delete(`/api/receiving-vouchers/${VOUCH}`);

        expect(res.status).toBe(200);
        expect(shelfService.deductFromStock).toHaveBeenCalledWith(
            mockClient,
            expect.objectContaining({ stockId: STK, quantity: 5 })
        );
        expect(callsWith('COMMIT')).toHaveLength(1);
    });

    test('deductFromStock failure → void aborted, voucher not voided', async () => {
        setupVoucher([{ id: STK, quantity: 10 }]);
        shelfService.deductFromStock.mockRejectedValue(shelfConflict());

        const res = await request(buildApp()).delete(`/api/receiving-vouchers/${VOUCH}`);

        expect(res.status).toBe(409);
        expect(callsWith("SET status = 'voided'")).toHaveLength(0);
        expect(callsWith('COMMIT')).toHaveLength(0);
    });
});

describe('purchase-returns — insufficient stock guard', () => {
    function setupReturn(stockRows) {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql.includes("nextval('purchase_return_number_seq')")) {
                return { rowCount: 1, rows: [{ next: 7 }] };
            }
            if (sql.includes('INSERT INTO purchase_returns')) {
                return { rowCount: 1, rows: [{ id: 'pr-1', return_number: 7 }] };
            }
            if (sql.includes('FROM warehouse_stock ws') && sql.includes('ws.variant_id')) {
                return { rowCount: stockRows.length, rows: stockRows };
            }
            if (sql.includes('FROM accounts WHERE code IN')) {
                return { rowCount: 2, rows: [{ id: ACC1, code: '1400' }, { id: ACC2, code: '2100' }] };
            }
            if (sql.includes('INSERT INTO accounting_vouchers')) {
                return { rowCount: 1, rows: [{ id: 'v-1', voucher_number: 42 }] };
            }
            return { rowCount: 0, rows: [] };
        });
    }

    test('return larger than available stock → 400, rolled back', async () => {
        setupReturn([{ id: STK, quantity: 3, warehouse_id: WH, client_id: null }]);

        const res = await request(buildApp())
            .post('/api/purchase-returns')
            .send({
                return_date: '2025-01-01',
                supplier_id: SUPP,
                items: [{ variant_id: VAR, quantity: 5, unit_cost: 10 }],
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('تتجاوز المخزون المتاح');
        expect(callsWith('COMMIT')).toHaveLength(0);
    });

    test('sufficient stock → return commits', async () => {
        setupReturn([{ id: STK, quantity: 10, warehouse_id: WH, client_id: null }]);

        const res = await request(buildApp())
            .post('/api/purchase-returns')
            .send({
                return_date: '2025-01-01',
                supplier_id: SUPP,
                items: [{ variant_id: VAR, quantity: 5, unit_cost: 10 }],
            });

        expect(res.status).toBe(201);
        expect(callsWith('COMMIT')).toHaveLength(1);
    });

    test('deductFromStock failure → return aborted', async () => {
        setupReturn([{ id: STK, quantity: 10, warehouse_id: WH, client_id: null }]);
        shelfService.deductFromStock.mockRejectedValue(shelfConflict());

        const res = await request(buildApp())
            .post('/api/purchase-returns')
            .send({
                return_date: '2025-01-01',
                supplier_id: SUPP,
                items: [{ variant_id: VAR, quantity: 5, unit_cost: 10 }],
            });

        expect(res.status).toBe(409);
        expect(callsWith('COMMIT')).toHaveLength(0);
    });
});

describe('purchase-returns void — confident restore only', () => {
    function setupVoid({ loggedRows, candidates }) {
        mockPoolQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM purchase_returns WHERE id')) {
                return { rowCount: 1, rows: [{ id: 'pr-9', status: 'completed' }] };
            }
            return { rowCount: 0, rows: [] };
        });
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM purchase_return_items')) {
                return {
                    rowCount: 1,
                    rows: [{ variant_id: VAR, quantity: 5, warehouse_id: WH }],
                };
            }
            if (sql.includes('FROM inventory_transactions') && sql.includes("reference_type = 'purchase_return'")) {
                return { rowCount: loggedRows.length, rows: loggedRows };
            }
            if (sql.includes('FROM warehouse_stock') && sql.includes('FOR UPDATE')) {
                return { rowCount: candidates.length, rows: candidates };
            }
            return { rowCount: 0, rows: [] };
        });
    }

    test('legacy void with multiple candidates → 409, no restore', async () => {
        setupVoid({ loggedRows: [], candidates: [{ id: STK }, { id: STK2 }] });

        const res = await request(buildApp()).delete('/api/purchase-returns/pr-9');

        expect(res.status).toBe(409);
        expect(res.body.error).toContain('تعذّر تحديد سجل المخزون الأصلي');
        expect(callsWith("SET status = 'voided'")).toHaveLength(0);
        expect(callsWith('COMMIT')).toHaveLength(0);
    });

    test('legacy void with exactly one candidate → restores and commits', async () => {
        setupVoid({ loggedRows: [], candidates: [{ id: STK }] });

        const res = await request(buildApp()).delete('/api/purchase-returns/pr-9');

        expect(res.status).toBe(200);
        expect(callsWith('UPDATE warehouse_stock SET quantity = quantity +')).toHaveLength(1);
        expect(callsWith('COMMIT')).toHaveLength(1);
    });

    test('logged movements → restores exact rows regardless of candidates', async () => {
        setupVoid({
            loggedRows: [{ stock_id: STK, variant_id: VAR, quantity: 5 }],
            candidates: [],
        });

        const res = await request(buildApp()).delete('/api/purchase-returns/pr-9');

        expect(res.status).toBe(200);
        expect(callsWith('UPDATE warehouse_stock SET quantity = quantity +')).toHaveLength(1);
    });
});

describe('manufacturer-orders receipt reversal — missing stock row blocks', () => {
    test('no stock row for the session item → error, no void', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM manufacturer_orders mo') && sql.includes('JOIN orders o')) {
                return {
                    rowCount: 1,
                    rows: [{ id: MO, mo_number: 'MO-1', order_id: ORD, client_id: null, order_status: 'production', status: 'received' }],
                };
            }
            if (sql.includes('FROM mo_receipt_sessions WHERE')) {
                return { rowCount: 1, rows: [{ id: SES, session_number: 1, status: 'active', warehouse_id: WH }] };
            }
            if (sql.includes('FROM mo_receipt_session_items si')) {
                return {
                    rowCount: 1,
                    rows: [{ id: SESI, quantity: 5, manufacturer_order_item_id: MOI, variant_id: VAR, order_item_id: null }],
                };
            }
            if (sql.includes('FROM warehouse_stock') && sql.includes('WHERE warehouse_id')) {
                return { rowCount: 0, rows: [] };
            }
            return { rowCount: 0, rows: [] };
        });

        const res = await request(buildApp())
            .delete(`/api/manufacturer-orders/${MO}/receipts/${SES}`);

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('سجل المخزون المرتبط بالصنف غير موجود');
        expect(callsWith("status = 'reversed'")).toHaveLength(0);
    });
});
