'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authenticate } = require('../middleware/authMiddleware');
const { loginBody, changePasswordBody, validateBody } = require('../utils/validators');

const router = express.Router();

// =============================================================================
// POST /api/auth/login
// Authenticates a user by email and password.
// Returns a signed JWT and full user+role info on success.
// bcrypt.compare() prevents timing attacks on password comparison.
// =============================================================================

router.post('/login', validateBody(loginBody), async (req, res) => {
  const { identifier, password } = req.validatedBody;

  try {
    // Check if identifier looks like an email or phone
    const isEmail = identifier.includes('@');
    const lookupValue = isEmail ? identifier.toLowerCase().trim() : identifier.trim();

    const result = await db.query(
      `SELECT
         u.id,
         u.email,
         u.phone,
         u.password_hash,
         u.name,
         u.status,
         u.token_version,
         r.id         AS role_id,
         r.role_name  AS role,
         r.permissions
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE ${isEmail ? 'u.email' : 'u.phone'} = $1
       LIMIT 1`,
      [lookupValue]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid email/phone or password.' });
    }

    const user = result.rows[0];

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is inactive or suspended. Contact your administrator.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email/phone or password.' });
    }

    const payload = {
      id: user.id,
      email: user.email,
      name: user.name,
      role_id: user.role_id,
      role: user.role,
      permissions: user.permissions,
      token_version: user.token_version || 0,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '8h',
      issuer: 'gpack-2.0',
    });

    // Set JWT as an HttpOnly cookie (prevents XSS token theft)
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,         // HTTPS only in production
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: 8 * 60 * 60 * 1000,   // 8 hours
    });

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role_id: user.role_id,
        role: user.role,
        permissions: user.permissions,
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// =============================================================================
// GET /api/auth/me
// Returns the authenticated user's details from the database.
// Validates that the user still exists and is active (guards against revoked access).
// Requires: Authorization: Bearer <token>
// =============================================================================

router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         u.id,
         u.email,
         u.phone,
         u.name,
         u.status,
         u.created_at,
         r.id         AS role_id,
         r.role_name  AS role,
         r.permissions
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1
       LIMIT 1`,
      [req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = result.rows[0];

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is inactive or suspended.' });
    }

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        role_id: user.role_id,
        role: user.role,
        permissions: user.permissions,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error('[Auth] /me error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// =============================================================================
// POST /api/auth/change-password
// Allows the authenticated user to change their own password.
// Requires: current_password, new_password
// =============================================================================

router.post('/change-password', authenticate, validateBody(changePasswordBody), async (req, res) => {
  try {
    const { current_password, new_password } = req.validatedBody;

    const userRes = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (userRes.rowCount === 0) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const valid = await bcrypt.compare(current_password, userRes.rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password_hash = $1, token_version = token_version + 1, updated_at = NOW() WHERE id = $2', [hashedPassword, req.user.id]);

    return res.status(200).json({ message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (err) {
    console.error('[Auth] change-password error:', err.message);
    return res.status(500).json({ error: 'فشل في تغيير كلمة المرور' });
  }
});

// =============================================================================
// POST /api/auth/logout
// Stateless JWT — client discards the token.
// Included for API completeness and frontend consistency.
// =============================================================================

router.post('/logout', authenticate, (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  res.clearCookie('token', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
  });
  return res.status(200).json({ message: 'Logged out successfully.' });
});

module.exports = router;
