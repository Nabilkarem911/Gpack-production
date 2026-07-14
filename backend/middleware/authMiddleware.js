'use strict';

const jwt = require('jsonwebtoken');
const db = require('../db');

// Lightweight in-memory cache for token_version checks (TTL: 30s)
const _tvCache = new Map();
const _TV_TTL = 30000;

const authenticate = async (req, res, next) => {
  // Prefer HttpOnly cookie (secure against XSS)
  let token = req.cookies?.token;

  // Fallback to Authorization header (backward-compat for external/mobile clients)
  if (!token) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verify token_version against DB (invalidates stale tokens after permission changes)
    const cached = _tvCache.get(decoded.id);
    let dbVersion;
    if (cached && (Date.now() - cached.ts) < _TV_TTL) {
      dbVersion = cached.val;
    } else {
      const r = await db.query('SELECT token_version FROM users WHERE id = $1', [decoded.id]);
      if (r.rowCount === 0) {
        return res.status(401).json({ error: 'Unauthorized: User not found.' });
      }
      dbVersion = r.rows[0].token_version || 0;
      _tvCache.set(decoded.id, { val: dbVersion, ts: Date.now() });
    }

    if ((decoded.token_version || 0) !== dbVersion) {
      return res.status(401).json({ error: 'Session expired due to permission changes. Please login again.' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Unauthorized: Token has expired.' });
    }
    return res.status(401).json({ error: 'Unauthorized: Invalid token.' });
  }
};

module.exports = { authenticate };
