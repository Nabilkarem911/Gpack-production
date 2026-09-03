// =============================================================================
// Tests: routes/design-requests.js
// Targets: token stability, version approval validation, single-item constraint.
// =============================================================================

const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');

const mockQuery = jest.fn();
const mockRelease = jest.fn();

jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
    getClient: jest.fn(() => Promise.resolve({
        query: (...args) => mockQuery(...args),
        release: mockRelease,
    })),
}));

jest.mock('../../middleware/authMiddleware', () => ({
    authenticate: jest.fn((req, res, next) => {
        req.user = { id: '11111111-1111-1111-1111-111111111111', role: 'admin', name: 'Test Manager' };
        next();
    }),
}));

jest.mock('../../utils/crypto', () => ({
    encryptToken: jest.fn((t) => `enc-${t}`),
    decryptShareToken: jest.fn((t) => (t || '').replace(/^enc-/, '')),
}));

const designRequestRoutes = require('../../routes/design-requests');

function makeHash(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function makeRequest(overrides = {}) {
    const clientToken = 'client-token-1';
    const designerToken = 'designer-token-1';
    return {
        id: '00000000-0000-0000-0000-000000000001',
        request_number: 1,
        item_name: 'Test Item',
        item_size: null,
        brief: null,
        status: 'waiting_design',
        client_id: '22222222-2222-2222-2222-222222222222',
        designer_id: '33333333-3333-3333-3333-333333333333',
        client_name: 'Test Client',
        designer_name: 'Test Designer',
        client_token_hash: makeHash(clientToken),
        designer_token_hash: makeHash(designerToken),
        client_token_encrypted: `enc-${clientToken}`,
        designer_token_encrypted: `enc-${designerToken}`,
        converted_quotation_id: null,
        selected_product_id: null,
        created_at: '2026-09-02T00:00:00.000Z',
        started_at: null,
        approved_at: null,
        ...overrides,
    };
}

function makeItem(overrides = {}) {
    return {
        id: '44444444-4444-4444-4444-444444444444',
        request_id: '00000000-0000-0000-0000-000000000001',
        variant_id: null,
        product_name: 'Test Item',
        size_name: null,
        notes: null,
        attachments: '[]',
        sort_order: 0,
        status: 'client_review',
        current_version_id: '55555555-5555-5555-5555-555555555555',
        approved_version_id: null,
        approved_at: null,
        ...overrides,
    };
}

function makeVersion(overrides = {}) {
    return {
        id: '55555555-5555-5555-5555-555555555555',
        request_id: '00000000-0000-0000-0000-000000000001',
        item_id: '44444444-4444-4444-4444-444444444444',
        version_number: 1,
        status: 'pending',
        ...overrides,
    };
}

describe('Design Requests', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use('/api/design-requests', designRequestRoutes);
        app.use('/api/public/design-requests', designRequestRoutes);
        mockQuery.mockReset();
        mockRelease.mockReset();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /api/design-requests/designer/my-requests', () => {
        test('does not regenerate public tokens when token columns are present', async () => {
            const req = makeRequest();

            mockQuery.mockImplementation((sql) => {
                if (sql.includes('FROM design_requests dr JOIN clients c ON c.id')) {
                    return Promise.resolve({ rows: [req] });
                }
                return Promise.resolve({ rows: [] });
            });

            const res = await request(app)
                .get('/api/design-requests/designer/my-requests');

            expect(res.status).toBe(200);
            expect(res.body.requests).toHaveLength(1);
            expect(res.body.requests[0].designer_link).toContain('designer-token-1');

            // ensureShareTokens should not have run an UPDATE because tokens were present
            const tokenUpdateCalls = mockQuery.mock.calls.filter(([sql]) =>
                sql.includes('UPDATE design_requests SET client_token_hash')
            );
            expect(tokenUpdateCalls).toHaveLength(0);
        });
    });

    describe('POST /api/design-requests/:id/items', () => {
        test('rejects a second item with 409 instead of 500', async () => {
            const req = makeRequest();

            mockQuery.mockImplementation((sql, params) => {
                if (sql.includes('FROM design_requests dr JOIN clients c ON c.id')) {
                    return Promise.resolve({ rows: [req] });
                }
                if (sql.includes('SELECT COUNT(*)::int AS count FROM design_request_items WHERE request_id=$1')) {
                    return Promise.resolve({ rows: [{ count: 1 }] });
                }
                if (sql === 'BEGIN' || sql === 'ROLLBACK') {
                    return Promise.resolve({ rows: [] });
                }
                return Promise.resolve({ rows: [] });
            });

            const res = await request(app)
                .post('/api/design-requests/00000000-0000-0000-0000-000000000001/items')
                .send({ product_name: 'Second Item' });

            expect(res.status).toBe(409);
            expect(res.body.error).toBe('كل طلب تصميم يخص صنفًا واحدًا');
        });

        test('returns 409 on unique constraint violation (concurrent insert)', async () => {
            const req = makeRequest();
            const constraintError = new Error('duplicate key value violates unique constraint');
            constraintError.code = '23505';

            mockQuery.mockImplementation((sql, params) => {
                if (sql.includes('FROM design_requests dr JOIN clients c ON c.id')) {
                    return Promise.resolve({ rows: [req] });
                }
                if (sql.includes('SELECT COUNT(*)::int AS count FROM design_request_items WHERE request_id=$1')) {
                    return Promise.resolve({ rows: [{ count: 0 }] });
                }
                if (sql.includes('SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM design_request_items')) {
                    return Promise.resolve({ rows: [{ next: 1 }] });
                }
                if (sql.includes('INSERT INTO design_request_items')) {
                    return Promise.reject(constraintError);
                }
                if (sql === 'BEGIN' || sql === 'ROLLBACK') {
                    return Promise.resolve({ rows: [] });
                }
                return Promise.resolve({ rows: [] });
            });

            const res = await request(app)
                .post('/api/design-requests/00000000-0000-0000-0000-000000000001/items')
                .send({ product_name: 'First Item' });

            expect(res.status).toBe(409);
            expect(res.body.error).toMatch(/duplicate key|كل طلب تصميم/i);
        });
    });

    describe('POST /api/public/design-requests/:token/respond', () => {
        const clientToken = 'client-token-1';
        const tokenHash = makeHash(clientToken);

        function setupRespondScenario({ versionStatus = 'pending', targetVersion = null, overrideVersion = null } = {}) {
            const req = makeRequest({ client_token_hash: tokenHash, designer_token_hash: makeHash('designer-token-1') });
            const item = makeItem({ current_version_id: '55555555-5555-5555-5555-555555555555' });
            const version = makeVersion({ id: '55555555-5555-5555-5555-555555555555', status: versionStatus });

            mockQuery.mockImplementation((sql, params) => {
                if (sql.includes('SELECT id FROM design_requests WHERE client_token_hash=$1 FOR UPDATE')) {
                    return Promise.resolve({ rows: [req] });
                }
                if (sql.includes('SELECT id, current_version_id FROM design_request_items WHERE id=$1 AND request_id=$2 FOR UPDATE')) {
                    return Promise.resolve({ rows: [item] });
                }
                if (sql.includes('SELECT id, status FROM design_request_versions WHERE id=$1 AND item_id=$2 AND request_id=$3 FOR UPDATE')) {
                    const lookupId = params[0];
                    const lookupItemId = params[1];
                    const v = (overrideVersion && overrideVersion.id === lookupId) ? overrideVersion : version;
                    if (v.id === lookupId && v.item_id === lookupItemId && v.request_id === req.id) {
                        return Promise.resolve({ rows: [v] });
                    }
                    return Promise.resolve({ rows: [] });
                }
                if (sql.includes('UPDATE design_request_items SET status')) {
                    return Promise.resolve({ rows: [] });
                }
                if (sql.includes('UPDATE design_request_versions SET status')) {
                    return Promise.resolve({ rows: [] });
                }
                if (sql.includes('INSERT INTO design_request_revisions')) {
                    return Promise.resolve({ rows: [] });
                }
                if (sql.includes('SELECT status, COUNT(*)::int AS count FROM design_request_items WHERE request_id=$1 GROUP BY status')) {
                    const statusAfter = targetVersion || item.current_version_id;
                    const rowStatus = versionStatus === 'pending' ? 'approved' : 'revision_requested';
                    return Promise.resolve({ rows: [{ status: rowStatus, count: 1 }] });
                }
                if (sql.includes('UPDATE design_requests SET status=$1::varchar')) {
                    return Promise.resolve({ rows: [] });
                }
                if (sql === 'BEGIN' || sql === 'COMMIT') {
                    return Promise.resolve({ rows: [] });
                }
                return Promise.resolve({ rows: [] });
            });
        }

        test('approves the current pending version successfully', async () => {
            setupRespondScenario({ versionStatus: 'pending' });

            const res = await request(app)
                .post(`/api/public/design-requests/${clientToken}/respond`)
                .send({
                    action: 'approve',
                    item_id: '44444444-4444-4444-4444-444444444444',
                    version_id: '55555555-5555-5555-5555-555555555555',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        test('rejects approval of an old version that is not current', async () => {
            const oldVersion = makeVersion({
                id: '66666666-6666-6666-6666-666666666666',
                version_number: 0,
                status: 'superseded',
            });
            setupRespondScenario({ overrideVersion: oldVersion });

            const res = await request(app)
                .post(`/api/public/design-requests/${clientToken}/respond`)
                .send({
                    action: 'approve',
                    item_id: '44444444-4444-4444-4444-444444444444',
                    version_id: '66666666-6666-6666-6666-666666666666',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/الإصدار الحالي|الإصدار غير موجود/i);
        });

        test('rejects approval of a version belonging to a different item', async () => {
            const otherItemVersion = makeVersion({
                id: '77777777-7777-7777-7777-777777777777',
                item_id: '88888888-8888-8888-8888-888888888888',
                request_id: '00000000-0000-0000-0000-000000000001',
                status: 'pending',
            });
            setupRespondScenario({ overrideVersion: otherItemVersion });

            const res = await request(app)
                .post(`/api/public/design-requests/${clientToken}/respond`)
                .send({
                    action: 'approve',
                    item_id: '44444444-4444-4444-4444-444444444444',
                    version_id: '77777777-7777-7777-7777-777777777777',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/الإصدار غير موجود|لا ينتمي/i);
        });

        test('rejects approval of a superseded or already approved version', async () => {
            const staleVersion = makeVersion({ status: 'approved' });
            setupRespondScenario({ overrideVersion: staleVersion });

            const res = await request(app)
                .post(`/api/public/design-requests/${clientToken}/respond`)
                .send({
                    action: 'approve',
                    item_id: '44444444-4444-4444-4444-444444444444',
                    version_id: '55555555-5555-5555-5555-555555555555',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/إصدار معالج|معالج أو ملغي/i);
        });
    });

    describe('POST /api/design-requests/:id/convert', () => {
        const targetVariant = { id: 'c79542ee-a4a3-44b8-9c16-c34b7c148b59', product_id: '8fcbbd11-ed2c-45d5-96b9-e3eac3b3faab', product_name: 'Test Product', size_name: '10x10' };

        function setupConvertScenario(requestOverrides = {}) {
            const req = makeRequest({ status: 'approved', converted_quotation_id: null, ...requestOverrides });
            const item = makeItem({ approved_version_id: '55555555-5555-5555-5555-555555555555' });
            const version = makeVersion({ id: '55555555-5555-5555-5555-555555555555', status: 'approved', file: { path: '/uploads/design-requests/00000000-0000-0000-0000-000000000001/file.png', original_name: 'file.png', mime_type: 'image/png', size: 100 } });
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
            jest.spyOn(fs, 'copyFileSync').mockImplementation(() => {});

            mockQuery.mockImplementation((sql, params) => {
                if (sql === 'BEGIN' || sql === 'COMMIT' || sql.includes('pg_advisory_xact_lock')) return Promise.resolve({ rows: [] });
                if (sql.includes('SELECT * FROM design_requests WHERE id=$1 FOR UPDATE')) return Promise.resolve({ rows: [req] });
                if (sql.includes('SELECT id, variant_id, product_name, size_name, approved_version_id FROM design_request_items WHERE request_id=$1 FOR UPDATE')) return Promise.resolve({ rows: [item] });
                if (sql.includes('SELECT id, file FROM design_request_versions WHERE id=$1 FOR UPDATE')) return Promise.resolve({ rows: [version] });
                if (sql.includes('FROM product_variants pv JOIN products p')) return Promise.resolve({ rows: [targetVariant] });
                if (sql.includes('INSERT INTO orders')) return Promise.resolve({ rows: [{ id: '99999999-9999-9999-9999-999999999999', order_number: 1001 }] });
                if (sql.includes('INSERT INTO order_items')) return Promise.resolve({ rows: [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }] });
                if (sql.includes('SELECT COALESCE(MAX(design_number),0)+1')) return Promise.resolve({ rows: [{ number: 1 }] });
                if (sql.includes('INSERT INTO client_designs')) return Promise.resolve({ rows: [{ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }] });
                if (sql.includes('INSERT INTO client_design_files')) return Promise.resolve({ rows: [] });
                if (sql.includes('UPDATE order_items SET design_id')) return Promise.resolve({ rows: [] });
                if (sql.includes('UPDATE design_request_items SET variant_id')) return Promise.resolve({ rows: [] });
                if (sql.includes('UPDATE design_requests SET selected_product_id')) return Promise.resolve({ rows: [] });
                if (sql.includes('INSERT INTO design_request_messages')) return Promise.resolve({ rows: [] });
                return Promise.resolve({ rows: [] });
            });
        }

        test('converts approved design to quotation and client design', async () => {
            setupConvertScenario();
            const res = await request(app)
                .post('/api/design-requests/00000000-0000-0000-0000-000000000001/convert')
                .send({ variant_id: targetVariant.id, quantity: 10, unit_price: 100 });

            expect(res.status).toBe(201);
            expect(res.body.quotation.order_number).toBe(1001);
            expect(res.body.design_id).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
            expect(res.body.product.id).toBe(targetVariant.id);
            expect(fs.copyFileSync).toHaveBeenCalled();
        });

        test('rejects invalid quantity and price', async () => {
            setupConvertScenario();
            const res = await request(app)
                .post('/api/design-requests/00000000-0000-0000-0000-000000000001/convert')
                .send({ variant_id: targetVariant.id, quantity: 'abc', unit_price: -5 });

            expect(res.status).toBe(400);
        });

        test('rejects conversion when request not approved', async () => {
            setupConvertScenario({ status: 'waiting_design' });
            const res = await request(app)
                .post('/api/design-requests/00000000-0000-0000-0000-000000000001/convert')
                .send({ variant_id: targetVariant.id, quantity: 10, unit_price: 100 });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/design-requests', () => {
        function setupCreateScenario({ withVariant = true } = {}) {
            mockQuery.mockImplementation((sql, params) => {
                if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
                if (sql.includes('FROM product_variants pv JOIN products p')) {
                    return Promise.resolve({ rows: [{ id: params[0], product_name: 'تيشيرت', size_name: 'أوفر سايز' }] });
                }
                if (sql.includes('INSERT INTO design_requests')) {
                    return Promise.resolve({ rows: [{ id: '00000000-0000-0000-0000-000000000001', request_number: 42 }] });
                }
                if (sql.includes('INSERT INTO design_request_items')) return Promise.resolve({ rows: [] });
                return Promise.resolve({ rows: [] });
            });
            return withVariant
                ? [{ variant_id: 'c79542ee-a4a3-44b8-9c16-c34b7c148b59', notes: 'اختبار' }]
                : [{ product_name: 'تصميم مفتوح', size_name: 'A4', notes: 'اختبار' }];
        }

        test('derives item_name and item_size from catalog when only variant_id is sent', async () => {
            const items = setupCreateScenario({ withVariant: true });

            const res = await request(app)
                .post('/api/design-requests')
                .set('Content-Type', 'application/json')
                .send({ client_id: '22222222-2222-2222-2222-222222222222', designer_id: '33333333-3333-3333-3333-333333333333', items });

            expect(res.status).toBe(201);
            const requestInsert = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO design_requests'));
            expect(requestInsert).toBeTruthy();
            // item_name is the 3rd param, item_size the 4th
            expect(requestInsert[1][2]).toBe('تيشيرت');
            expect(requestInsert[1][3]).toBe('أوفر سايز');
            const itemInsert = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO design_request_items'));
            expect(itemInsert[1][2]).toBe('تيشيرت');
            expect(itemInsert[1][3]).toBe('أوفر سايز');
        });

        test('uses supplied product_name and size_name for open-ended items', async () => {
            const items = setupCreateScenario({ withVariant: false });

            const res = await request(app)
                .post('/api/design-requests')
                .set('Content-Type', 'application/json')
                .send({ client_id: '22222222-2222-2222-2222-222222222222', designer_id: '33333333-3333-3333-3333-333333333333', items });

            expect(res.status).toBe(201);
            const requestInsert = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO design_requests'));
            expect(requestInsert[1][2]).toBe('تصميم مفتوح');
            expect(requestInsert[1][3]).toBe('A4');
        });

        test('rejects missing client, designer, or items', async () => {
            const res = await request(app)
                .post('/api/design-requests')
                .set('Content-Type', 'application/json')
                .send({ client_id: '22222222-2222-2222-2222-222222222222' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/العميل والمصمم وصنف/);
        });

        test('rejects more than one item', async () => {
            const res = await request(app)
                .post('/api/design-requests')
                .set('Content-Type', 'application/json')
                .send({ client_id: '22222222-2222-2222-2222-222222222222', designer_id: '33333333-3333-3333-3333-333333333333', items: [{ product_name: 'A' }, { product_name: 'B' }] });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/صنف/);
        });
    });

    describe('GET /api/design-requests/:id fallback', () => {
        test('fills empty item_name and null item_size from design_request_items', async () => {
            const req = makeRequest({ item_name: '', item_size: null });
            const item = makeItem({ product_name: 'تيشيرت', size_name: 'أوفر سايز' });

            mockQuery.mockImplementation((sql, params) => {
                if (sql.includes('FROM design_requests dr JOIN clients c ON c.id = dr.client_id JOIN users u ON u.id = dr.designer_id WHERE dr.id = $1')) return Promise.resolve({ rows: [req] });
                if (sql.includes('SELECT id, sender_type, sender_id, sender_name, message, attachment, is_internal, created_at FROM design_request_messages')) return Promise.resolve({ rows: [] });
                if (sql.includes('SELECT * FROM design_request_versions WHERE request_id = $1')) return Promise.resolve({ rows: [] });
                if (sql.includes('SELECT * FROM design_request_revisions WHERE request_id = $1')) return Promise.resolve({ rows: [] });
                if (sql.includes('SELECT id, variant_id, product_name, size_name, notes, attachments, sort_order, status, current_version_id, approved_version_id, approved_at FROM design_request_items WHERE request_id = $1')) return Promise.resolve({ rows: [item] });
                return Promise.resolve({ rows: [] });
            });

            const res = await request(app)
                .get('/api/design-requests/00000000-0000-0000-0000-000000000001');

            expect(res.status).toBe(200);
            expect(res.body.request.item_name).toBe('تيشيرت');
            expect(res.body.request.item_size).toBe('أوفر سايز');
        });
    });

    describe('GET /api/design-requests list fallback', () => {
        test('fills empty item_name and item_size from design_request_items without duplication or field leakage', async () => {
            const req = makeRequest({
                item_name: '',
                item_size: null,
                client_token_encrypted: 'enc-client-token-1',
                designer_token_encrypted: 'enc-designer-token-1',
                converted_quotation_id: '99999999-9999-9999-9999-999999999999',
                selected_product_id: '88888888-8888-8888-8888-888888888888',
            });

            mockQuery.mockImplementation((sql, params) => {
                if (sql.includes('LEFT JOIN LATERAL') || sql.includes('FROM design_requests dr JOIN clients c')) return Promise.resolve({
                    rows: [{
                        ...req,
                        item_product_name: 'تيشيرت',
                        item_size_name: 'أوفر سايز',
                    }],
                });
                return Promise.resolve({ rows: [] });
            });

            const res = await request(app)
                .get('/api/design-requests');

            expect(res.status).toBe(200);
            expect(res.body.requests).toHaveLength(1);
            expect(res.body.requests[0].item_name).toBe('تيشيرت');
            expect(res.body.requests[0].item_size).toBe('أوفر سايز');
            expect(res.body.requests[0].converted_quotation_id).toBeUndefined();
            expect(res.body.requests[0].selected_product_id).toBeUndefined();
            expect(res.body.requests[0].is_converted).toBe(true);
        });

        test('does not duplicate rows when a request has multiple items', async () => {
            const req = makeRequest({ client_token_encrypted: 'enc-client-token-1', designer_token_encrypted: 'enc-designer-token-1' });

            mockQuery.mockImplementation((sql, params) => {
                if (sql.includes('LEFT JOIN LATERAL') || sql.includes('FROM design_requests dr JOIN clients c')) return Promise.resolve({ rows: [{ ...req, item_product_name: 'تيشيرت', item_size_name: 'L' }] });
                return Promise.resolve({ rows: [] });
            });

            const res = await request(app)
                .get('/api/design-requests');

            expect(res.status).toBe(200);
            expect(res.body.requests).toHaveLength(1);
        });
    });

    describe('Field leakage', () => {
        test('public list does not expose converted_quotation_id or selected_product_id', async () => {
            const req = makeRequest({ converted_quotation_id: '99999999-9999-9999-9999-999999999999', selected_product_id: '88888888-8888-8888-8888-888888888888' });
            mockQuery.mockImplementation((sql) => {
                if (sql.includes('FROM design_requests dr JOIN clients c ON c.id')) return Promise.resolve({ rows: [req] });
                return Promise.resolve({ rows: [] });
            });

            const res = await request(app)
                .get('/api/design-requests/designer/my-requests');

            expect(res.status).toBe(200);
            expect(res.body.requests[0].converted_quotation_id).toBeUndefined();
            expect(res.body.requests[0].selected_product_id).toBeUndefined();
            expect(res.body.requests[0].is_converted).toBe(true);
        });

        test('manager detail exposes converted_quotation_id and selected_product_id', async () => {
            const req = makeRequest({ status: 'approved', converted_quotation_id: '99999999-9999-9999-9999-999999999999', selected_product_id: '88888888-8888-8888-8888-888888888888' });
            mockQuery.mockImplementation((sql, params) => {
                if (sql.includes('FROM design_requests dr JOIN clients c ON c.id = dr.client_id JOIN users u ON u.id = dr.designer_id WHERE dr.id = $1')) return Promise.resolve({ rows: [req] });
                if (sql.includes('SELECT id, sender_type, sender_id, sender_name, message, attachment, is_internal, created_at FROM design_request_messages')) return Promise.resolve({ rows: [] });
                if (sql.includes('SELECT * FROM design_request_versions WHERE request_id = $1')) return Promise.resolve({ rows: [] });
                if (sql.includes('SELECT * FROM design_request_revisions WHERE request_id = $1')) return Promise.resolve({ rows: [] });
                if (sql.includes('SELECT id, variant_id, product_name, size_name, notes, attachments, sort_order, status, current_version_id, approved_version_id, approved_at FROM design_request_items WHERE request_id = $1')) return Promise.resolve({ rows: [] });
                return Promise.resolve({ rows: [] });
            });

            const res = await request(app)
                .get('/api/design-requests/00000000-0000-0000-0000-000000000001');

            expect(res.status).toBe(200);
            expect(res.body.converted_quotation_id).toBe('99999999-9999-9999-9999-999999999999');
            expect(res.body.selected_product_id).toBe('88888888-8888-8888-8888-888888888888');
            expect(res.body.request.converted_quotation_id).toBeUndefined();
        });
    });
});
