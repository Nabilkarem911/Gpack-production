'use strict';

const express = require('express');
const db = require('../db');
const bcrypt = require('bcrypt');
const { success, error: errorResponse, created } = require('../utils/response');
const authorize = require('../middleware/authorize');
const { validateBody, userCreate, userUpdate, roleCreate, roleUpdate, userPermissionsUpdate } = require('../utils/validators');

const router = express.Router();
const restrictToAdmin = authorize(['admin', 'manager', 'super_admin']);

// =============================================================================
// IMPORTANT: All /roles/* routes MUST be defined BEFORE /:id routes to prevent
// Express from matching "roles" as a :id parameter value.
// =============================================================================

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
// POST /api/users/roles
// Create new role
// =============================================================================

router.post('/roles', restrictToAdmin, validateBody(roleCreate), async (req, res) => {
    const { role_name, description, permissions } = req.validatedBody;

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
// PUT /api/users/roles/:id
// Update existing role
// =============================================================================

router.put('/roles/:id', restrictToAdmin, validateBody(roleUpdate), async (req, res) => {
    try {
        const { id } = req.params;
        const { role_name, description, permissions } = req.validatedBody;

        if (!role_name) {
            return errorResponse(res, 'اسم الدور مطلوب', 400);
        }

        const roleCheck = await db.query('SELECT id FROM roles WHERE id = $1', [id]);
        if (roleCheck.rows.length === 0) {
            return errorResponse(res, 'الدور غير موجود', 404);
        }

        const nameCheck = await db.query(
            'SELECT id FROM roles WHERE role_name = $1 AND id != $2',
            [role_name, id]
        );
        if (nameCheck.rows.length > 0) {
            return errorResponse(res, 'اسم الدور موجود بالفعل', 409);
        }

        // Update role (roles table has no updated_at column)
        await db.query(
            `UPDATE roles SET role_name = $1, description = $2, permissions = $3 WHERE id = $4`,
            [role_name, description || '', JSON.stringify(permissions || {}), id]
        );

        // Bump token_version for all users with this role — forces re-login with new permissions
        await db.query(
            `UPDATE users SET token_version = token_version + 1 WHERE role_id = $1`,
            [id]
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

        const roleCheck = await db.query('SELECT role_name FROM roles WHERE id = $1', [id]);
        if (roleCheck.rows.length === 0) {
            return errorResponse(res, 'الدور غير موجود', 404);
        }

        const usersCheck = await db.query(
            'SELECT COUNT(*) as count FROM users WHERE role_id = $1',
            [id]
        );
        if (parseInt(usersCheck.rows[0].count) > 0) {
            return errorResponse(res, 'لا يمكن حذف الدور، يوجد مستخدمون يستخدمونه', 400);
        }

        await db.query('DELETE FROM roles WHERE id = $1', [id]);

        return success(res, { message: 'تم حذف الدور بنجاح' });

    } catch (error) {
        console.error('Delete role error:', error);
        return errorResponse(res, 'فشل في حذف الدور', 500);
    }
});

// =============================================================================
// GET /api/users/list
// Returns minimal user list (id + name only) for dropdowns — any authenticated user
// =============================================================================

router.get('/list', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, name FROM users WHERE status = 'active' ORDER BY name`
        );
        return success(res, result.rows);
    } catch (error) {
        console.error('Get users list error:', error);
        return errorResponse(res, 'فشل في تحميل قائمة المستخدمين', 500);
    }
});

// =============================================================================
// GET /api/users
// Returns all users with their roles
// =============================================================================

router.get('/', restrictToAdmin, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT u.id, u.email, u.phone, u.name, u.status, u.created_at, u.updated_at,
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
// POST /api/users
// Create new user
// =============================================================================

router.post('/', restrictToAdmin, validateBody(userCreate), async (req, res) => {
    const { email, phone, name, password, role_id, status = 'active' } = req.validatedBody;

    if (!name || !password) {
        return errorResponse(res, 'الاسم وكلمة المرور مطلوبة', 400);
    }
    if (!email && !phone) {
        return errorResponse(res, 'البريد الإلكتروني أو رقم الجوال مطلوب', 400);
    }

    try {
        // Check existing by email or phone
        if (email) {
            const existingEmail = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
            if (existingEmail.rows.length > 0) {
                return errorResponse(res, 'البريد الإلكتروني مستخدم بالفعل', 409);
            }
        }
        if (phone) {
            const existingPhone = await db.query('SELECT id FROM users WHERE phone = $1', [phone.trim()]);
            if (existingPhone.rows.length > 0) {
                return errorResponse(res, 'رقم الجوال مستخدم بالفعل', 409);
            }
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await db.query(
            `INSERT INTO users (email, phone, name, password_hash, role_id, status)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, email, phone, name, status, created_at`,
            [email ? email.toLowerCase().trim() : null, phone ? phone.trim() : null, name, hashedPassword, role_id || null, status]
        );

        return created(res, result.rows[0]);
    } catch (error) {
        console.error('Create user error:', error);
        return errorResponse(res, 'فشل في إنشاء المستخدم', 500);
    }
});

// =============================================================================
// PUT /api/users/:id/permissions
// Update user permissions (creates or updates user's role)
// =============================================================================

router.put('/:id/permissions', restrictToAdmin, validateBody(userPermissionsUpdate), async (req, res) => {
    try {
        const { id } = req.params;
        const { permissions } = req.validatedBody;

        if (!permissions || typeof permissions !== 'object') {
            return errorResponse(res, 'الصلاحيات مطلوبة', 400);
        }

        const userCheck = await db.query('SELECT id FROM users WHERE id = $1', [id]);
        if (userCheck.rows.length === 0) {
            return errorResponse(res, 'المستخدم غير موجود', 404);
        }

        const roleName = 'custom_role_' + id.substring(0, 8);
        const description = 'صلاحيات مخصصة للمستخدم';

        const result = await db.withTransaction(async (txClient) => {
            const existingRole = await txClient.query(
                'SELECT id FROM roles WHERE role_name = $1',
                [roleName]
            );

            let roleId;
            if (existingRole.rows.length > 0) {
                await txClient.query(
                    'UPDATE roles SET permissions = $1 WHERE role_name = $2',
                    [JSON.stringify(permissions), roleName]
                );
                roleId = existingRole.rows[0].id;
            } else {
                const roleResult = await txClient.query(
                    `INSERT INTO roles (role_name, description, permissions)
                     VALUES ($1, $2, $3)
                     RETURNING id`,
                    [roleName, description, JSON.stringify(permissions)]
                );
                roleId = roleResult.rows[0].id;
            }

            await txClient.query(
                'UPDATE users SET role_id = $1, token_version = token_version + 1, updated_at = NOW() WHERE id = $2',
                [roleId, id]
            );

            return { roleId };
        });

        return success(res, { message: 'تم تحديث الصلاحيات بنجاح' });

    } catch (error) {
        console.error('Update permissions error:', error);
        return errorResponse(res, 'فشل في تحديث الصلاحيات', 500);
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
            `SELECT u.id, u.email, u.phone, u.name, u.status, u.created_at,
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
// PUT /api/users/:id
// Update user
// =============================================================================

router.put('/:id', restrictToAdmin, validateBody(userUpdate), async (req, res) => {
    const { id } = req.params;
    const { name, email, phone, role_id, status, password } = req.validatedBody;

    try {
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (name) {
            updates.push(`name = $${paramIndex++}`);
            values.push(name);
        }
        if (email !== undefined) {
            updates.push(`email = $${paramIndex++}`);
            values.push(email ? email.toLowerCase().trim() : null);
        }
        if (phone !== undefined) {
            updates.push(`phone = $${paramIndex++}`);
            values.push(phone ? phone.trim() : null);
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

        // Bump token_version if role_id, password, or status changed — invalidates old JWTs
        if (role_id !== undefined || password || status) {
            updates.push(`token_version = token_version + 1`);
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

module.exports = router;
