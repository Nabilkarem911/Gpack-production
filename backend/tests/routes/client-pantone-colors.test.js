'use strict';

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

const clientId     = '11111111-1111-4111-8111-111111111111';
const colorId      = '22222222-2222-4222-8222-222222222222';
const otherColorId = '33333333-3333-4333-8333-333333333333';
const userId       = '44444444-4444-4444-8444-444444444444';

const mockQuery = jest.fn();

jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
const pantoneRoutes = require('../../routes/client_pantone_colors');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/client-pantone-colors', pantoneRoutes);
    return app;
}

function authToken(role = 'admin') {
    return jwt.sign({ id: userId, role, token_version: 0 }, process.env.JWT_SECRET);
}

const auth = (req) => req.set('Authorization', `Bearer ${authToken()}`);

function mockAuthUser() {
    return { rows: [{ token_version: 0 }], rowCount: 1 };
}

describe('client pantone colors routes', () => {
    beforeEach(() => {
        mockQuery.mockReset();
    });

    test('GET returns the colors of a client ordered', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM users')) return mockAuthUser();
            if (sql.includes('FROM client_pantone_colors')) {
                return { rows: [
                    { id: colorId, client_id: clientId, color_code: 'Pantone 185 C', color_name: 'أحمر', hex_value: '#E03C31', notes: null, sort_order: 0 },
                ], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        });

        const res = await auth(request(buildApp()).get(`/api/client-pantone-colors?client_id=${clientId}`));

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].color_code).toBe('Pantone 185 C');
    });

    test('POST creates a new color', async () => {
        const created = { id: colorId, client_id: clientId, color_code: 'Pantone 185 C', color_name: 'أحمر', hex_value: '#E03C31', notes: 'للشعار', sort_order: 0 };
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM users')) return mockAuthUser();
            if (sql.includes('SELECT id FROM client_pantone_colors')) return { rows: [], rowCount: 0 };
            if (sql.includes('INSERT INTO client_pantone_colors')) return { rows: [created], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        });

        const res = await auth(request(buildApp()).post('/api/client-pantone-colors'))
            .send({ client_id: clientId, color_code: 'Pantone 185 C', color_name: 'أحمر', hex_value: '#E03C31', notes: 'للشعار' });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.color_code).toBe('Pantone 185 C');

        const insertCall = mockQuery.mock.calls.find(c => c[0].includes('INSERT INTO client_pantone_colors'));
        expect(insertCall[1]).toEqual([clientId, 'Pantone 185 C', 'أحمر', '#E03C31', 'للشعار', 0]);
    });

    test('POST rejects a duplicate color_code for the same client', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM users')) return mockAuthUser();
            if (sql.includes('SELECT id FROM client_pantone_colors')) return { rows: [{ id: otherColorId }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        });

        const res = await auth(request(buildApp()).post('/api/client-pantone-colors'))
            .send({ client_id: clientId, color_code: 'Pantone 185 C' });

        expect(res.status).toBe(409);
    });

    test('PATCH updates only the provided fields', async () => {
        const updated = { id: colorId, client_id: clientId, color_code: 'Pantone 186 C', color_name: 'أحمر داكن', hex_value: '#C8102E', notes: 'للشعار الرئيسي', sort_order: 0 };
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM users')) return mockAuthUser();
            if (sql.includes('id <>')) return { rows: [], rowCount: 0 };
            if (sql.includes('SELECT id, client_id FROM client_pantone_colors')) return { rows: [{ id: colorId, client_id: clientId }], rowCount: 1 };
            if (sql.includes('UPDATE client_pantone_colors')) return { rows: [updated], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        });

        const res = await auth(request(buildApp()).patch(`/api/client-pantone-colors/${colorId}`))
            .send({ color_code: 'Pantone 186 C', color_name: 'أحمر داكن', hex_value: '#C8102E', notes: 'للشعار الرئيسي' });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ color_code: 'Pantone 186 C', color_name: 'أحمر داكن', hex_value: '#C8102E' });

        const updateCall = mockQuery.mock.calls.find(c => c[0].includes('UPDATE client_pantone_colors'));
        expect(updateCall[0]).toContain('color_code = $1');
        expect(updateCall[0]).toContain('color_name = $2');
        expect(updateCall[0]).toContain('hex_value = $3');
        expect(updateCall[0]).toContain('notes = $4');
        expect(updateCall[1]).toEqual(['Pantone 186 C', 'أحمر داكن', '#C8102E', 'للشعار الرئيسي', colorId]);
    });

    test('PATCH allows clearing a field back to null', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM users')) return mockAuthUser();
            if (sql.includes('SELECT id, client_id FROM client_pantone_colors')) return { rows: [{ id: colorId, client_id: clientId }], rowCount: 1 };
            if (sql.includes('UPDATE client_pantone_colors')) {
                return { rows: [{ id: colorId, client_id: clientId, color_code: 'Pantone 185 C', color_name: null, hex_value: '#E03C31', notes: null, sort_order: 0 }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        });

        const res = await auth(request(buildApp()).patch(`/api/client-pantone-colors/${colorId}`))
            .send({ color_name: null, notes: null });

        expect(res.status).toBe(200);
        const updateCall = mockQuery.mock.calls.find(c => c[0].includes('UPDATE client_pantone_colors'));
        expect(updateCall[0]).toContain('color_name = $1');
        expect(updateCall[0]).toContain('notes = $2');
        expect(updateCall[1]).toEqual([null, null, colorId]);
        expect(res.body.data.color_name).toBeNull();
        expect(res.body.data.notes).toBeNull();
    });

    test('PATCH rejects renaming to a color_code that already exists', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM users')) return mockAuthUser();
            if (sql.includes('id <>')) return { rows: [{ id: otherColorId }], rowCount: 1 };
            if (sql.includes('SELECT id, client_id FROM client_pantone_colors')) return { rows: [{ id: colorId, client_id: clientId }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        });

        const res = await auth(request(buildApp()).patch(`/api/client-pantone-colors/${colorId}`))
            .send({ color_code: 'Pantone 186 C' });

        expect(res.status).toBe(409);
    });

    test('PATCH returns 404 for a missing color', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM users')) return mockAuthUser();
            if (sql.includes('SELECT id, client_id FROM client_pantone_colors')) return { rows: [], rowCount: 0 };
            return { rows: [], rowCount: 0 };
        });

        const res = await auth(request(buildApp()).patch(`/api/client-pantone-colors/${colorId}`))
            .send({ color_name: 'أحمر' });

        expect(res.status).toBe(404);
    });

    test('PATCH returns 400 when no fields are provided', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM users')) return mockAuthUser();
            if (sql.includes('SELECT id, client_id FROM client_pantone_colors')) return { rows: [{ id: colorId, client_id: clientId }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        });

        const res = await auth(request(buildApp()).patch(`/api/client-pantone-colors/${colorId}`))
            .send({});

        expect(res.status).toBe(400);
    });

    test('DELETE removes a color', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM users')) return mockAuthUser();
            if (sql.includes('DELETE FROM client_pantone_colors')) return { rows: [{ id: colorId }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        });

        const res = await auth(request(buildApp()).delete(`/api/client-pantone-colors/${colorId}`));

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});
