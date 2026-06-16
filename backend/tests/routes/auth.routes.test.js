// =============================================================================
// Tests: routes/auth.js  (Integration via Supertest)
// =============================================================================

const request = require('supertest');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Mock db before requiring the route
const mockQuery = jest.fn();
const mockRelease = jest.fn();
jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
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

const authRoutes = require('../../routes/auth');

describe('Auth Routes', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use('/api/auth', authRoutes);
        mockQuery.mockClear();
        mockRelease.mockClear();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/auth/login', () => {
        test('should reject invalid email format (Zod validation)', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ email: 'not-an-email', password: 'secret123' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Validation failed');
        });

        test('should reject missing password (Zod validation)', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ email: 'admin@test.com' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Validation failed');
        });

        test('should return 401 for unknown user', async () => {
            mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

            const res = await request(app)
                .post('/api/auth/login')
                .send({ email: 'unknown@test.com', password: 'secret123' });

            expect(res.status).toBe(401);
            expect(res.body.error).toBe('Invalid email or password.');
        });

        test('should return 403 for inactive user', async () => {
            mockQuery.mockResolvedValueOnce({
                rowCount: 1,
                rows: [{
                    id: 1,
                    email: 'inactive@test.com',
                    password_hash: 'hash',
                    name: 'Inactive',
                    status: 'suspended',
                    role_id: 2,
                    role: 'sales_rep',
                    permissions: {},
                }],
            });

            const res = await request(app)
                .post('/api/auth/login')
                .send({ email: 'inactive@test.com', password: 'secret123' });

            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/inactive/i);
        });

        test('should return 401 for wrong password', async () => {
            const hashed = await bcrypt.hash('correct', 10);
            mockQuery.mockResolvedValueOnce({
                rowCount: 1,
                rows: [{
                    id: 1,
                    email: 'admin@test.com',
                    password_hash: hashed,
                    name: 'Admin',
                    status: 'active',
                    role_id: 1,
                    role: 'super_admin',
                    permissions: { all_access: true },
                }],
            });

            const res = await request(app)
                .post('/api/auth/login')
                .send({ email: 'admin@test.com', password: 'wrongpassword' });

            expect(res.status).toBe(401);
            expect(res.body.error).toBe('Invalid email or password.');
        });

        test('should login successfully, set HttpOnly cookie, and return token + user', async () => {
            const hashed = await bcrypt.hash('secret123', 10);
            mockQuery.mockResolvedValueOnce({
                rowCount: 1,
                rows: [{
                    id: 1,
                    email: 'admin@test.com',
                    password_hash: hashed,
                    name: 'Admin User',
                    status: 'active',
                    role_id: 1,
                    role: 'super_admin',
                    permissions: { all_access: true },
                }],
            });

            const res = await request(app)
                .post('/api/auth/login')
                .send({ email: 'admin@test.com', password: 'secret123' });

            expect(res.status).toBe(200);
            expect(res.body.user).toMatchObject({
                id: 1,
                email: 'admin@test.com',
                name: 'Admin User',
                role: 'super_admin',
            });
            expect(res.body.token).toBeDefined();

            // Assert HttpOnly cookie is set
            const cookies = res.headers['set-cookie'];
            expect(cookies).toBeDefined();
            expect(cookies.some(c => c.includes('token='))).toBe(true);
            expect(cookies.some(c => c.includes('HttpOnly'))).toBe(true);
        });
    });

    describe('POST /api/auth/logout', () => {
        test('should clear the token cookie and return success', async () => {
            const validToken = jwt.sign(
                { id: 1, role: 'admin', permissions: {} },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            const res = await request(app)
                .post('/api/auth/logout')
                .set('Cookie', `token=${validToken}`);

            expect(res.status).toBe(200);
            expect(res.body.message).toMatch(/logged out/i);

            const cookies = res.headers['set-cookie'];
            expect(cookies).toBeDefined();
            expect(cookies.some(c => c.includes('token=;'))).toBe(true);
        });
    });
});
