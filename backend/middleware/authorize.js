'use strict';

/**
 * G.PACK 2.0 - Role-Based Authorization Middleware
 *
 * Verifies if the authenticated user (from req.user) has the required
 * permissions or role for a specific route.
 *
 * Supports TWO permission shapes for backward compatibility:
 *   Object (new):  { "orders": { "view": true, "create": true }, "all_access": true }
 *   Array  (legacy): { "orders": ["view", "create"] }
 *
 * Usage:
 *   router.get('/orders', authenticate, authorize('orders', 'view'), (req, res) => { ... });
 *   router.post('/orders', authenticate, authorize('orders', 'create'), (req, res) => { ... });
 *   router.put('/orders/:id', authenticate, authorize('orders', 'edit'), (req, res) => { ... });
 *   router.delete('/orders/:id', authenticate, authorize(['admin', 'manager']), (req, res) => { ... });
 */

const authorize = (resourceOrRoles, action) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: User context missing.' });
    }

    const { role, permissions } = req.user;

    // 1. Super Admin / Admin bypass — full access to everything
    if (role === 'super_admin' || role === 'admin') {
      return next();
    }

    // 2. all_access flag bypass
    if (permissions && permissions.all_access === true) {
      return next();
    }

    // 3. Check by Role (if action is not provided, first arg is treated as array of roles)
    if (!action) {
      const allowedRoles = Array.isArray(resourceOrRoles) ? resourceOrRoles : [resourceOrRoles];
      if (allowedRoles.includes(role)) {
        return next();
      }
      return res.status(403).json({ error: 'Forbidden: Insufficient role permissions.' });
    }

    // 4. Check by Resource Permission
    const resource = resourceOrRoles;
    if (permissions && permissions[resource]) {
      const perms = permissions[resource];

      // A) New CRUD Object format: { "orders": { "view": true, "create": true } }
      if (typeof perms === 'object' && !Array.isArray(perms)) {
        if (perms[action] === true) {
          return next();
        }
      }

      // B) Legacy Array format: { "orders": ["view", "create"] }
      if (Array.isArray(perms) && perms.includes(action)) {
        return next();
      }

      // C) Legacy Boolean format: { "orders": true }
      if (typeof perms === 'boolean' && perms === true) {
        return next();
      }
    }

    // 5. Default deny
    return res.status(403).json({ error: `Forbidden: No ${action} permission on ${resource}.` });
  };
};

module.exports = authorize;