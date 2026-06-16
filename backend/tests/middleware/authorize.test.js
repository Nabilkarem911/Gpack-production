// =============================================================================
// Tests: middleware/authorize.js  (D-001)
// =============================================================================

const authorize = require('../../middleware/authorize');

describe('authorize middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = { user: null };
        res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        next = jest.fn();
    });

    test('should return 401 when req.user is missing', () => {
        const middleware = authorize('orders', 'view');
        middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: User context missing.' });
        expect(next).not.toHaveBeenCalled();
    });

    test('super_admin should bypass all checks', () => {
        req.user = { id: 1, role: 'super_admin', permissions: {} };
        const middleware = authorize('orders', 'delete');
        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('admin should bypass all checks', () => {
        req.user = { id: 1, role: 'admin', permissions: {} };
        const middleware = authorize('orders', 'delete');
        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('all_access flag should bypass checks', () => {
        req.user = { id: 1, role: 'manager', permissions: { all_access: true } };
        const middleware = authorize('invoices', 'create');
        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('role-only check: allowed role passes', () => {
        req.user = { id: 1, role: 'manager', permissions: {} };
        const middleware = authorize(['admin', 'manager']);
        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('role-only check: disallowed role returns 403', () => {
        req.user = { id: 1, role: 'sales_rep', permissions: {} };
        const middleware = authorize(['admin', 'manager']);
        middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: Insufficient role permissions.' });
        expect(next).not.toHaveBeenCalled();
    });

    test('resource permission (object format): allowed action passes', () => {
        req.user = { id: 1, role: 'sales_rep', permissions: { orders: { view: true } } };
        const middleware = authorize('orders', 'view');
        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('resource permission (object format): denied action returns 403', () => {
        req.user = { id: 1, role: 'sales_rep', permissions: { orders: { view: true } } };
        const middleware = authorize('orders', 'delete');
        middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('resource permission (array format): allowed action passes', () => {
        req.user = { id: 1, role: 'sales_rep', permissions: { orders: ['view', 'create'] } };
        const middleware = authorize('orders', 'create');
        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('resource permission (array format): denied action returns 403', () => {
        req.user = { id: 1, role: 'sales_rep', permissions: { orders: ['view'] } };
        const middleware = authorize('orders', 'create');
        middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('resource permission (boolean format): true passes', () => {
        req.user = { id: 1, role: 'sales_rep', permissions: { orders: true } };
        const middleware = authorize('orders', 'view');
        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('resource permission (boolean format): false returns 403', () => {
        req.user = { id: 1, role: 'sales_rep', permissions: { orders: false } };
        const middleware = authorize('orders', 'view');
        middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('unknown resource returns 403', () => {
        req.user = { id: 1, role: 'sales_rep', permissions: { orders: { view: true } } };
        const middleware = authorize('invoices', 'view');
        middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
    });
});
