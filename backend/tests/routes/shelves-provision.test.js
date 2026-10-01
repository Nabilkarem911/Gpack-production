'use strict';

// =============================================================================
// GET /api/inventory/shelves — lazy shelf provisioning.
// A warehouse with zero shelf rows (non-'main' types were never seeded by
// migration 098) must get its 324 shelves generated on first read, so the
// shelf pickers in receiving/direct-receipts/production modals never render
// an empty dropdown for a valid warehouse.
// =============================================================================

const request = require('supertest');
const express = require('express');

const WH = 'a1000000-0000-4000-8000-000000000001';

const mockQuery = jest.fn();

jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
    getClient: jest.fn(async () => ({ query: mockQuery, release: jest.fn() })),
    pool: { query: (...args) => mockQuery(...args) },
}));
jest.mock('../../middleware/authMiddleware', () => ({
    authenticate: (req, _res, next) => {
        req.user = { id: 'u1', role: 'admin', permissions: {} };
        next();
    },
}));
jest.mock('../../middleware/authorize', () => () => (_req, _res, next) => next());

const shelfRoutes = require('../../routes/shelves');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 'u1', role: 'admin', permissions: {} }; next(); });
    app.use('/api/inventory', shelfRoutes);
    return app;
}

const SHELVES_SELECT = /FROM warehouse_shelves ws/;
const PROVISION      = /INSERT INTO warehouse_shelves/;
const UNASSIGNED     = /FROM warehouse_stock ws/;

function mockWithShelves(shelfRows) {
    mockQuery.mockImplementation(async (sql) => {
        if (UNASSIGNED.test(sql))  return { rowCount: 0, rows: [] };
        if (PROVISION.test(sql))   return { rowCount: 0, rows: [] };
        if (SHELVES_SELECT.test(sql)) return { rowCount: shelfRows.length, rows: shelfRows };
        throw new Error(`Unexpected query: ${sql}`);
    });
}

describe('GET /api/inventory/shelves — lazy provision', () => {
    beforeEach(() => mockQuery.mockReset());

    test('provisions the 324 shelves when a valid warehouse has none', async () => {
        let shelfReads = 0;
        mockQuery.mockImplementation(async (sql) => {
            if (UNASSIGNED.test(sql)) return { rowCount: 0, rows: [] };
            if (PROVISION.test(sql))  return { rowCount: 324, rows: [] };
            if (SHELVES_SELECT.test(sql)) {
                shelfReads++;
                // empty on first read → populated after provisioning
                const rows = shelfReads === 1 ? [] : [{ id: 'sh1', code: 'A1-01', zone: 'A', floor: 1, slot: 1, status: 'active', occupancy_pct: null, occupancy_updated_at: null, items_count: '0', total_qty: '0' }];
                return { rowCount: rows.length, rows };
            }
            throw new Error(`Unexpected query: ${sql}`);
        });

        const res = await request(buildApp()).get(`/api/inventory/shelves?warehouse_id=${WH}`);
        expect(res.status).toBe(200);
        expect(res.body.data.shelves).toHaveLength(1);
        expect(res.body.data.shelves[0].code).toBe('A1-01');
        // provision INSERT ran exactly once between the two shelf reads
        expect(mockQuery.mock.calls.filter(([sql]) => PROVISION.test(sql))).toHaveLength(1);
        expect(shelfReads).toBe(2);
    });

    test('does not re-provision a warehouse that already has shelves', async () => {
        mockWithShelves([{ id: 'sh1', code: 'A1-01', zone: 'A', floor: 1, slot: 1, status: 'active', occupancy_pct: null, occupancy_updated_at: null, items_count: '2', total_qty: '5' }]);
        const res = await request(buildApp()).get(`/api/inventory/shelves?warehouse_id=${WH}`);
        expect(res.status).toBe(200);
        expect(mockQuery.mock.calls.filter(([sql]) => PROVISION.test(sql))).toHaveLength(0);
    });

    test('unknown warehouse stays an empty grid (FK-safe, no insert attempted twice)', async () => {
        mockWithShelves([]);
        const res = await request(buildApp()).get(`/api/inventory/shelves?warehouse_id=${WH}`);
        expect(res.status).toBe(200);
        expect(res.body.data.shelves).toEqual([]);
        // provision was attempted once; the WHERE EXISTS guard made it a no-op
        expect(mockQuery.mock.calls.filter(([sql]) => PROVISION.test(sql))).toHaveLength(1);
    });
});
