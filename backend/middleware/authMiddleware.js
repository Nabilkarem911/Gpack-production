'use strict';

const jwt = require('jsonwebtoken');

// =============================================================================
// G.PACK 2.0 - JWT Authentication Middleware
// Verifies the JWT from an HttpOnly cookie first, then falls back to the
// Authorization: Bearer <token> header. Attaches decoded user to req.user.
// =============================================================================

const authenticate = (req, res, next) => {
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
