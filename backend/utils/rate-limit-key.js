'use strict';

const jwt = require('jsonwebtoken');

function rateLimitKey(req) {
    const token = req.cookies?.token || req.headers?.authorization?.replace(/^Bearer\s+/i, '');
    if (token) {
        try {
            const payload = jwt.verify(token, process.env.JWT_SECRET);
            const userId = payload?.id || payload?.sub;
            if (userId) return `user:${userId}`;
        } catch (_err) {
            // Invalid or expired tokens remain rate-limited by IP.
        }
    }
    return `ip:${req.ip}`;
}

module.exports = { rateLimitKey };
