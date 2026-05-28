'use strict';

const jwt = require('jsonwebtoken');

// =============================================================================
// G.PACK 2.0 - JWT Authentication Middleware
// Verifies the Authorization: Bearer <token> header on protected routes.
// Attaches the decoded user payload to req.user for downstream handlers.
// =============================================================================

const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided.' });
  }

  const token = authHeader.split(' ')[1];

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
