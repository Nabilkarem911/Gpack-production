// =============================================================================
// Tests: middleware/authMiddleware.js  (D-001)
// =============================================================================

const jwt = require('jsonwebtoken');
const { authenticate } = require('../../middleware/authMiddleware');

describe('authenticate middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = { headers: {}, cookies: {} };
        res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        next = jest.fn();
    });

    test('should return 401 when no token in cookie or header', () => {
        authenticate(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: No token provided.' });
        expect(next).not.toHaveBeenCalled();
    });

    test('should return 401 when header does not start with Bearer', () => {
        req.headers['authorization'] = 'Basic abc123';
        authenticate(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: No token provided.' });
        expect(next).not.toHaveBeenCalled();
    });

    test('should return 401 for expired token in header', () => {
        const expiredToken = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '-1s' });
        req.headers['authorization'] = `Bearer ${expiredToken}`;
        authenticate(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Token has expired.' });
        expect(next).not.toHaveBeenCalled();
    });

    test('should return 401 for invalid token signature in header', () => {
        req.headers['authorization'] = 'Bearer invalidtoken.signature.here';
        authenticate(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Invalid token.' });
        expect(next).not.toHaveBeenCalled();
    });

    test('should call next() and attach req.user for valid Bearer token', () => {
        const payload = { id: 1, role: 'admin', permissions: {} };
        const validToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
        req.headers['authorization'] = `Bearer ${validToken}`;
        authenticate(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user).toMatchObject(payload);
    });

    test('should prefer HttpOnly cookie over Authorization header', () => {
        const cookiePayload = { id: 2, role: 'manager', permissions: {} };
        const cookieToken = jwt.sign(cookiePayload, process.env.JWT_SECRET, { expiresIn: '1h' });
        const headerPayload = { id: 1, role: 'admin', permissions: {} };
        const headerToken = jwt.sign(headerPayload, process.env.JWT_SECRET, { expiresIn: '1h' });

        req.cookies = { token: cookieToken };
        req.headers['authorization'] = `Bearer ${headerToken}`;

        authenticate(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user).toMatchObject(cookiePayload);
    });

    test('should fallback to Authorization header when cookie is absent', () => {
        const payload = { id: 3, role: 'sales_rep', permissions: {} };
        const validToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
        req.headers['authorization'] = `Bearer ${validToken}`;

        authenticate(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user).toMatchObject(payload);
    });
});
