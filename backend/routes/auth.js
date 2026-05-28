'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// =============================================================================
// POST /api/auth/login
// Authenticates a user by email and password.
// Returns a signed JWT and full user+role info on success.
// bcrypt.compare() prevents timing attacks on password comparison.
// =============================================================================

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const result = await db.query(
      `SELECT
         u.id,
         u.email,
         u.password_hash,
         u.name,
         u.status,
         r.id         AS role_id,
         r.role_name  AS role,
         r.permissions
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.email = $1
       LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is inactive or suspended. Contact your administrator.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const payload = {
      id: user.id,
      email: user.email,
      name: user.name,
      role_id: user.role_id,
      role: user.role,
      permissions: user.permissions,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '8h',
      issuer: 'gpack-2.0',
    });

    return res.status(200).json({
      token,
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
// POST /api/auth/logout
// Stateless JWT — client discards the token.
// Included for API completeness and frontend consistency.
// =============================================================================

router.post('/logout', authenticate, (req, res) => {
  return res.status(200).json({ message: 'Logged out successfully.' });
});

module.exports = router;
