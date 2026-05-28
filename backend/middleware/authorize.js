'use strict';

// =============================================================================
// Authorization Middleware
// Role-based access control for API endpoints
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

/**
 * Authorization middleware factory
 * @param {string} permission - Required permission to access the route
 * @returns {Function} Express middleware
 */
const authorize = (permission) => {
    return (req, res, next) => {
        // Check if user is authenticated
        if (!req.user) {
            return res.status(401).json({ 
                error: 'Unauthorized',
                message: 'Authentication required' 
            });
        }

        const userRole = req.user.role;
        
        // Get permissions for user role
        const permissions = ROLE_PERMISSIONS[userRole] || [];
        
        // Check if user has 'all' permissions or the specific permission
        if (permissions.includes('all') || permissions.includes(permission)) {
            return next();
        }

        // User doesn't have required permission
        return res.status(403).json({ 
            error: 'Forbidden',
            message: 'Insufficient permissions to access this resource',
            required_permission: permission,
            user_role: userRole
        });
    };
};

/**
 * Check if user has any of the specified permissions
 * @param {string[]} permissions - Array of permissions
 * @returns {Function} Express middleware
 */
const authorizeAny = (permissions) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                error: 'Unauthorized',
                message: 'Authentication required' 
            });
        }

        const userRole = req.user.role;
        const userPermissions = ROLE_PERMISSIONS[userRole] || [];
        
        // Check if user has 'all' permissions or any of the specified permissions
        if (userPermissions.includes('all') || 
            permissions.some(perm => userPermissions.includes(perm))) {
            return next();
        }

        return res.status(403).json({ 
            error: 'Forbidden',
            message: 'Insufficient permissions to access this resource',
            required_permissions: permissions,
            user_role: userRole
        });
    };
};

/**
 * Check if user is admin or super_admin
 * @returns {Function} Express middleware
 */
const requireAdmin = () => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                error: 'Unauthorized',
                message: 'Authentication required' 
            });
        }

        if (['super_admin', 'admin'].includes(req.user.role)) {
            return next();
        }

        return res.status(403).json({ 
            error: 'Forbidden',
            message: 'Admin access required'
        });
    };
};

module.exports = {
    authorize,
    authorizeAny,
    requireAdmin,
    ROLE_PERMISSIONS
};
