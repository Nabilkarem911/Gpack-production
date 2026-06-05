'use strict';

// =============================================================================
// Authorization Middleware
// Reads permissions from req.user.permissions (JSONB from roles table).
// Falls back to legacy hardcoded list if permissions JSON is empty.
// Supports CRUD: view | create | edit | delete
// =============================================================================

const ROLE_PERMISSIONS = {
    super_admin: ['all'],
    admin: ['all'],
    sales_manager: ['orders', 'clients', 'products', 'inventory', 'invoices', 'reports', 'quotations'],
    sales_rep: ['orders', 'clients', 'products', 'invoices', 'quotations'],
    inventory_manager: ['inventory', 'products', 'warehouses', 'delivery-notes', 'vmi'],
    accountant: ['invoices', 'accounting', 'reports', 'account-statement', 'receipt-vouchers', 'payment-vouchers'],
    viewer: ['reports'],
};

const MODULE_ACTION_MAP = {
    'quotations': 'quotations',
    'orders': 'orders',
    'clients': 'clients',
    'products': 'products',
    'inventory': 'inventory',
    'warehouses': 'warehouses',
    'invoices': 'invoices',
    'accounting': 'accounting',
    'reports': 'reports',
    'tasks': 'tasks',
    'users': 'users',
    'settings': 'settings',
    'delivery-notes': 'delivery-notes',
    'vmi': 'vmi',
    'receipt-vouchers': 'receipt-vouchers',
    'payment-vouchers': 'payment-vouchers',
};

function _hasPermission(userPermissions, moduleName, action) {
    if (!userPermissions) return false;
    // super_admin bypass
    if (userPermissions.all_access === true) return true;
    const mod = userPermissions[moduleName];
    if (!mod) return false;
    return mod[action] === true;
}

function _legacyCheck(userRole, permission) {
    const perms = ROLE_PERMISSIONS[userRole] || [];
    return perms.includes('all') || perms.includes(permission);
}

/**
 * Authorize middleware — checks module + action in permissions JSONB.
 * @param {string} moduleName — e.g. 'quotations', 'orders'
 * @param {string} action — 'view' | 'create' | 'edit' | 'delete' (default: 'view')
 */
const authorize = (moduleName, action = 'view') => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
        }

        const userPermissions = req.user.permissions || {};

        // If dynamic permissions exist (non-empty JSONB), use them
        if (Object.keys(userPermissions).length > 0 && userPermissions.all_access !== undefined) {
            if (_hasPermission(userPermissions, moduleName, action)) {
                return next();
            }
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Insufficient permissions to access this resource',
                required_module: moduleName,
                required_action: action,
                user_role: req.user.role
            });
        }

        // Fallback to legacy hardcoded list for backward compatibility
        if (_legacyCheck(req.user.role, moduleName)) {
            return next();
        }

        return res.status(403).json({
            error: 'Forbidden',
            message: 'Insufficient permissions to access this resource',
            required_module: moduleName,
            required_action: action,
            user_role: req.user.role
        });
    };
};

/**
 * Check if user has view permission on ANY of the listed modules.
 * @param {string[]} modules — Array of module names
 */
const authorizeAny = (modules) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
        }

        const userPermissions = req.user.permissions || {};

        if (Object.keys(userPermissions).length > 0 && userPermissions.all_access !== undefined) {
            if (userPermissions.all_access === true) return next();
            const hasAny = modules.some(m => _hasPermission(userPermissions, m, 'view'));
            if (hasAny) return next();
        } else {
            // Legacy fallback
            const perms = ROLE_PERMISSIONS[req.user.role] || [];
            if (perms.includes('all') || modules.some(m => perms.includes(m))) return next();
        }

        return res.status(403).json({
            error: 'Forbidden',
            message: 'Insufficient permissions to access this resource',
            required_modules: modules,
            user_role: req.user.role
        });
    };
};

/**
 * Require admin or super_admin (role name check).
 */
const requireAdmin = () => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
        }

        const userPermissions = req.user.permissions || {};
        if (userPermissions.all_access === true) return next();

        if (['super_admin', 'admin'].includes(req.user.role)) {
            return next();
        }

        return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
    };
};

module.exports = { authorize, authorizeAny, requireAdmin, ROLE_PERMISSIONS };
