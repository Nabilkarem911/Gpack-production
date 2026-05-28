'use strict';

const express = require('express');
const db = require('../db');
const bcrypt = require('bcrypt');
const { success, error: errorResponse, created, noContent } = require('../utils/response');

const router = express.Router();

// =============================================================================
// GET /api/users
// Returns all users with their roles
// =============================================================================

router.get('/', async (req, res) => {
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
        return errorResponse(res, 'فشل في تحميل المستخدمين' });
    }
});

// =============================================================================
// GET /api/users/roles
// Returns all available roles
// =============================================================================

router.get('/roles', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id, role_name, description, permissions FROM roles ORDER BY role_name'
        );
        return success(res, result.rows);
    } catch (error) {
        console.error('Get roles error:', error);
        return errorResponse(res, 'فشل في تحميل الأدوار' });
    }
});

// =============================================================================
// GET /api/users/:id
// Returns single user details
// =============================================================================

router.get('/:id', async (req, res) => {
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
            return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Get user error:', error);
        return errorResponse(res, 'فشل في تحميل بيانات المستخدم' });
    }
});

// =============================================================================
// POST /api/users
// Create new user
// =============================================================================

router.post('/', async (req, res) => {
    const { email, name, password, role_id, status = 'active' } = req.body;

    if (!email || !name || !password) {
         return badRequest(res, 'البريد والاسم وكلمة المرور مطلوبة' });
    }

    try {
        // Check if email exists
        const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return conflict(res, 'البريد الإلكتروني مستخدم بالفعل' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await db.query(
            `INSERT INTO users (email, name, password_hash, role_id, status)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, email, name, status, created_at`,
            [email, name, hashedPassword, role_id || null, status]
        );

        return created(res, result.rows[0] });
    } catch (error) {
        console.error('Create user error:', error);
        return errorResponse(res, 'فشل في إنشاء المستخدم' });
    }
});

// =============================================================================
// PUT /api/users/:id
// Update user
// =============================================================================

router.put('/:id', async (req, res) => {
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
             return badRequest(res, 'لا يوجد بيانات للتحديث' });
        }

        values.push(id);
        const result = await db.query(
            `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
             WHERE id = $${paramIndex}
             RETURNING id, email, name, status, updated_at`,
            values
        );

        if (result.rows.length === 0) {
            return notFound(res, 'المستخدم غير موجود' });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Update user error:', error);
        return errorResponse(res, 'فشل في تحديث المستخدم' });
    }
});

// =============================================================================
// DELETE /api/users/:id
// Delete user (soft delete by setting inactive)
// =============================================================================

router.delete('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Prevent deleting yourself
        if (req.user && req.user.id === id) {
             return badRequest(res, 'لا يمكنك حذف حسابك الخاص' });
        }

        const result = await db.query(
            `UPDATE users SET status = 'inactive', updated_at = NOW()
             WHERE id = $1
             RETURNING id`,
            [id]
        );

        if (result.rows.length === 0) {
            return notFound(res, 'المستخدم غير موجود' });
        }

        res.json({ success: true, message: 'تم تعطيل المستخدم بنجاح' });
    } catch (error) {
        console.error('Delete user error:', error);
        return errorResponse(res, 'فشل في حذف المستخدم' });
    }
});

// =============================================================================
// POST /api/users/roles
// Create new role
// =============================================================================

router.post('/roles', async (req, res) => {
    const { role_name, description, permissions } = req.body;

    if (!role_name) {
         return badRequest(res, 'اسم الدور مطلوب' });
    }

    try {
        const result = await db.query(
            `INSERT INTO roles (role_name, description, permissions)
             VALUES ($1, $2, $3)
             RETURNING id, role_name, description`,
            [role_name, description || '', JSON.stringify(permissions || {})]
        );

        return created(res, result.rows[0] });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ success: false, error: 'اسم الدور موجود بالفعل' });
        }
        console.error('Create role error:', error);
        return errorResponse(res, 'فشل في إنشاء الدور' });
    }
});

// =============================================================================
// PUT /api/users/:id/permissions
// Update user permissions (creates or updates user's role)
// =============================================================================

router.put('/:id/permissions', async (req, res) => {
    try {
        const { id } = req.params;
        const { permissions } = req.body;

        if (!permissions || typeof permissions !== 'object') {
            return res.status(400).json({ 
                success: false, 
                error: 'الصلاحيات مطلوبة' 
            });
        }

        // Check if user exists
        const userCheck = await db.query('SELECT id FROM users WHERE id = $1', [id]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'المستخدم غير موجود' 
            });
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

        res.json({ 
            success: true, 
            message: 'تم تحديث الصلاحيات بنجاح' 
        });

    } catch (error) {
        console.error('Update permissions error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'فشل في تحديث الصلاحيات' 
        });
    }
});

// =============================================================================
// PUT /api/users/roles/:id
// Update existing role
// =============================================================================

router.put('/roles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { role_name, description, permissions } = req.body;

        if (!role_name) {
            return res.status(400).json({ 
                success: false, 
                error: 'اسم الدور مطلوب' 
            });
        }

        // Check if role exists
        const roleCheck = await db.query('SELECT id FROM roles WHERE id = $1', [id]);
        if (roleCheck.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'الدور غير موجود' 
            });
        }

        // Check if role name conflicts with other roles
        const nameCheck = await db.query(
            'SELECT id FROM roles WHERE role_name = $1 AND id != $2',
            [role_name, id]
        );
        if (nameCheck.rows.length > 0) {
            return res.status(409).json({ 
                success: false, 
                error: 'اسم الدور موجود بالفعل' 
            });
        }

        // Update role
        await db.query(
            `UPDATE roles 
             SET role_name = $1, description = $2, permissions = $3, updated_at = NOW()
             WHERE id = $4`,
            [role_name, description || '', JSON.stringify(permissions || {}), id]
        );

        res.json({ 
            success: true, 
            message: 'تم تحديث الدور بنجاح' 
        });

    } catch (error) {
        console.error('Update role error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'فشل في تحديث الدور' 
        });
    }
});

// =============================================================================
// DELETE /api/users/roles/:id
// Delete role (only if no users are assigned)
// =============================================================================

router.delete('/roles/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Check if role exists
        const roleCheck = await db.query('SELECT role_name FROM roles WHERE id = $1', [id]);
        if (roleCheck.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'الدور غير موجود' 
            });
        }

        // Check if users are using this role
        const usersCheck = await db.query(
            'SELECT COUNT(*) as count FROM users WHERE role_id = $1',
            [id]
        );
        if (parseInt(usersCheck.rows[0].count) > 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'لا يمكن حذف الدور، يوجد مستخدمون يستخدمونه' 
            });
        }

        // Delete role
        await db.query('DELETE FROM roles WHERE id = $1', [id]);

        res.json({ 
            success: true, 
            message: 'تم حذف الدور بنجاح' 
        });

    } catch (error) {
        console.error('Delete role error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'فشل في حذف الدور' 
        });
    }
});

module.exports = router;
