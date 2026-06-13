'use strict';

/**
 * G.PACK 2.0 - Role-Based Authorization Middleware
 * 
 * Verifies if the authenticated user (from req.user) has the required 
 * permissions or role for a specific route.
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

    // 1. Admin bypass - Admin has full access to everything
    if (role === 'admin') {
      return next();
    }

    // 2. Check by Role (if action is not provided, first arg is treated as array of roles)
    if (!action) {
      const allowedRoles = Array.isArray(resourceOrRoles) ? resourceOrRoles : [resourceOrRoles];
      if (allowedRoles.includes(role)) {
        return next();
      }
      return res.status(403).json({ error: 'Forbidden: Insufficient role permissions.' });
    }

    // 3. Check by Resource Permission
    // Permissions is expected to be an object: { "orders": ["view", "create"], "clients": ["view"] }
    const resource = resourceOrRoles;
    if (permissions && permissions[resource] && permissions[resource].includes(action)) {
      return next();
    }

    // 4. Default deny
    return res.status(403).json({ error: `Forbidden: No ${action} permission on ${resource}.` });
  };
};

module.exports = authorize;