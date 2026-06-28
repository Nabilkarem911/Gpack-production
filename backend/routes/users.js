'use strict';

const express = require('express');
const db = require('../db');
const bcrypt = require('bcrypt');
const { success, error: errorResponse, created } = require('../utils/response');
const authorize = require('../middleware/authorize');

const router = express.Router();
const restrictToAdmin = authorize(['admin', 'manager', 'super_admin']);

// =============================================================================
// GET /api/users
// Returns all users with their roles
// =============================================================================

router.get('/', restrictToAdmin, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT u.id, u.email, u.name, u.status, u.created_at, u.updated_at,
                    r.id as role_id, r.role_name, r.description as role_description, r.permissions
             FROM users u
             LEFT JOIN roles r ON u.role_id = r.id
             ORDER BY u.created_at DESC`
        );
        return success(res, result.rows);
    } catch (error) {
        console.error('Get users error:', error);
        return errorResponse(res, 'فشل في تحميل المستخدمين', 500);
    }
});

// =============================================================================
// GET /api/users/roles
// Returns all available roles
// =============================================================================

router.get('/roles', restrictToAdmin, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id, role_name, description, permissions FROM roles ORDER BY role_name'
        );
        return success(res, result.rows);
    } catch (error) {
        console.error('Get roles error:', error);
        return errorResponse(res, 'فشل في تحميل الأدوار', 500);
    }
});

// =============================================================================
// GET /api/users/:id
// Returns single user details
// =============================================================================

router.get('/:id', restrictToAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            `SELECT u.id, u.email, u.name, u.status, u.created_at,
                    r.id as role_id, r.role_name
             FROM users u
             LEFT JOIN roles r ON u.role_id = r.id
             WHERE u.id = $1`,
            [id]
        );
        if (result.rows.length === 0) {
            return errorResponse(res, 'المستخدم غير موجود', 404);
        }
        return success(res, result.rows[0]);
    } catch (error) {
        console.error('Get user error:', error);
        return errorResponse(res, 'فشل في تحميل بيانات المستخدم', 500);
    }
});

// =============================================================================
// POST /api/users
// Create new user
// =============================================================================

router.post('/', restrictToAdmin, async (req, res) => {
    const { email, name, password, role_id, status = 'active' } = req.body;

    if (!email || !name || !password) {
        return errorResponse(res, 'البريد والاسم وكلمة المرور مطلوبة', 400);
    }

    try {
        // Check if email exists
        const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return errorResponse(res, 'البريد الإلكتروني مستخدم بالفعل', 409);
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await db.query(
            `INSERT INTO users (email, name, password_hash, role_id, status)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, email, name, status, created_at`,
            [email, name, hashedPassword, role_id || null, status]
        );

        return created(res, result.rows[0]);
    } catch (error) {
        console.error('Create user error:', error);
        return errorResponse(res, 'فشل في إنشاء المستخدم', 500);
    }
});

// =============================================================================
// PUT /api/users/:id
// Update user
// =============================================================================

router.put('/:id', restrictToAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, email, role_id, status, password } = req.body;

    try {
        // Build dynamic update
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (name) {
            updates.push(`name = $${paramIndex++}`);
            values.push(name);
        }
        if (email) {
            updates.push(`email = $${paramIndex++}`);
            values.push(email);
        }
        if (role_id !== undefined) {
            updates.push(`role_id = $${paramIndex++}`);
            values.push(role_id || null);
        }
        if (status) {
            updates.push(`status = $${paramIndex++}`);
            values.push(status);
        }
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            updates.push(`password_hash = $${paramIndex++}`);
            values.push(hashedPassword);
        }

        if (updates.length === 0) {
            return errorResponse(res, 'لا يوجد بيانات للتحديث', 400);
        }

        values.push(id);
        const result = await db.query(
            `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
             WHERE id = $${paramIndex}
             RETURNING id, email, name, status, updated_at`,
            values
        );

        if (result.rows.length === 0) {
            return errorResponse(res, 'المستخدم غير موجود', 404);
        }

        return success(res, result.rows[0]);
    } catch (error) {
        console.error('Update user error:', error);
        return errorResponse(res, 'فشل في تحديث المستخدم', 500);
    }
});

// =============================================================================
// DELETE /api/users/:id
// Delete user (soft delete by setting inactive)
// =============================================================================

router.delete('/:id', restrictToAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        // Prevent deleting yourself
        if (req.user && req.user.id === id) {
            return errorResponse(res, 'لا يمكنك حذف حسابك الخاص', 400);
        }

        const result = await db.query(
            `UPDATE users SET status = 'inactive', updated_at = NOW()
             WHERE id = $1
             RETURNING id`,
            [id]
        );

        if (result.rows.length === 0) {
            return errorResponse(res, 'المستخدم غير موجود', 404);
        }

        return success(res, { message: 'تم تعطيل المستخدم بنجاح' });
    } catch (error) {
        console.error('Delete user error:', error);
        return errorResponse(res, 'فشل في حذف المستخدم', 500);
    }
});

// =============================================================================
// POST /api/users/roles
// Create new role
// =============================================================================

router.post('/roles', restrictToAdmin, async (req, res) => {
    const { role_name, description, permissions } = req.body;

    if (!role_name) {
        return errorResponse(res, 'اسم الدور مطلوب', 400);
    }

    try {
        const result = await db.query(
            `INSERT INTO roles (role_name, description, permissions)
             VALUES ($1, $2, $3)
             RETURNING id, role_name, description`,
            [role_name, description || '', JSON.stringify(permissions || {})]
        );

        return created(res, result.rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            return errorResponse(res, 'اسم الدور موجود بالفعل', 409);
        }
        console.error('Create role error:', error);
        return errorResponse(res, 'فشل في إنشاء الدور', 500);
    }
});

// =============================================================================
// PUT /api/users/:id/permissions
// Update user permissions (creates or updates user's role)
// =============================================================================

router.put('/:id/permissions', restrictToAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { permissions } = req.body;

        if (!permissions || typeof permissions !== 'object') {
            return errorResponse(res, 'الصلاحيات مطلوبة', 400);
        }

        // Check if user exists
        const userCheck = await db.query('SELECT id FROM users WHERE id = $1', [id]);
        if (userCheck.rows.length === 0) {
            return errorResponse(res, 'المستخدم غير موجود', 404);
        }

        // Create a new role for this user with specific permissions
        const roleName = 'custom_role_' + id.substring(0, 8);
        const description = 'صلاحيات مخصصة للمستخدم';

        // Check if custom role already exists
        const existingRole = await db.query(
            'SELECT id FROM roles WHERE role_name = $1',
            [roleName]
        );

        let roleId;
        if (existingRole.rows.length > 0) {
            // Update existing role
            await db.query(
                'UPDATE roles SET permissions = $1 WHERE role_name = $2',
                [JSON.stringify(permissions), roleName]
            );
            roleId = existingRole.rows[0].id;
        } else {
            // Create new role
            const roleResult = await db.query(
                `INSERT INTO roles (role_name, description, permissions)
                 VALUES ($1, $2, $3)
                 RETURNING id`,
                [roleName, description, JSON.stringify(permissions)]
            );
            roleId = roleResult.rows[0].id;
        }

        // Update user to use this role
        await db.query(
            'UPDATE users SET role_id = $1, updated_at = NOW() WHERE id = $2',
            [roleId, id]
        );

        return success(res, { message: 'تم تحديث الصلاحيات بنجاح' });

    } catch (error) {
        console.error('Update permissions error:', error);
        return errorResponse(res, 'فشل في تحديث الصلاحيات', 500);
    }
});

// =============================================================================
// PUT /api/users/roles/:id
// Update existing role
// =============================================================================

router.put('/roles/:id', restrictToAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { role_name, description, permissions } = req.body;

        if (!role_name) {
            return errorResponse(res, 'اسم الدور مطلوب', 400);
        }

        // Check if role exists
        const roleCheck = await db.query('SELECT id FROM roles WHERE id = $1', [id]);
        if (roleCheck.rows.length === 0) {
            return errorResponse(res, 'الدور غير موجود', 404);
        }

        // Check if role name conflicts with other roles
        const nameCheck = await db.query(
            'SELECT id FROM roles WHERE role_name = $1 AND id != $2',
            [role_name, id]
        );
        if (nameCheck.rows.length > 0) {
            return errorResponse(res, 'اسم الدور موجود بالفعل', 409);
        }

        // Update role (roles table has no updated_at column)
        await db.query(
            `UPDATE roles 
             SET role_name = $1, description = $2, permissions = $3
             WHERE id = $4`,
            [role_name, description || '', JSON.stringify(permissions || {}), id]
        );

        return success(res, { message: 'تم تحديث الدور بنجاح' });

    } catch (error) {
        console.error('Update role error:', error);
        return errorResponse(res, 'فشل في تحديث الدور', 500);
    }
});

// =============================================================================
// DELETE /api/users/roles/:id
// Delete role (only if no users are assigned)
// =============================================================================

router.delete('/roles/:id', restrictToAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if role exists
        const roleCheck = await db.query('SELECT role_name FROM roles WHERE id = $1', [id]);
        if (roleCheck.rows.length === 0) {
            return errorResponse(res, 'الدور غير موجود', 404);
        }

        // Check if users are using this role
        const usersCheck = await db.query(
            'SELECT COUNT(*) as count FROM users WHERE role_id = $1',
            [id]
        );
        if (parseInt(usersCheck.rows[0].count) > 0) {
            return errorResponse(res, 'لا يمكن حذف الدور، يوجد مستخدمون يستخدمونه', 400);
        }

        // Delete role
        await db.query('DELETE FROM roles WHERE id = $1', [id]);

        return success(res, { message: 'تم حذف الدور بنجاح' });

    } catch (error) {
        console.error('Delete role error:', error);
        return errorResponse(res, 'فشل في حذف الدور', 500);
    }
});

module.exports = router;
