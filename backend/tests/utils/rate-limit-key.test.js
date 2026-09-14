'use strict';

const jwt = require('jsonwebtoken');
const { rateLimitKey } = require('../../utils/rate-limit-key');

const baseRequest = {
    ip: '10.0.0.5',
    headers: {},
    cookies: {},
};

describe('rate limiter key', () => {
    beforeEach(() => {
        process.env.JWT_SECRET = 'rate-limit-test-secret';
    });

    test('uses the authenticated JWT id instead of the proxy IP', () => {
        const token = jwt.sign({ id: 'user-123', token_version: 0 }, process.env.JWT_SECRET);
        expect(rateLimitKey({ ...baseRequest, headers: { authorization: `Bearer ${token}` } }))
            .toBe('user:user-123');
    });

    test('supports JWTs that use sub as the subject', () => {
        const token = jwt.sign({ sub: 'subject-456' }, process.env.JWT_SECRET);
        expect(rateLimitKey({ ...baseRequest, cookies: { token } })).toBe('user:subject-456');
    });

    test('does not trust forged or expired tokens to bypass the IP bucket', () => {
        const forged = jwt.sign({ id: 'attacker-id' }, 'different-secret');
        const expired = jwt.sign({ id: 'expired-id', exp: Math.floor(Date.now() / 1000) - 1 }, process.env.JWT_SECRET);
        expect(rateLimitKey({ ...baseRequest, headers: { authorization: `Bearer ${forged}` } })).toBe('ip:10.0.0.5');
        expect(rateLimitKey({ ...baseRequest, headers: { authorization: `Bearer ${expired}` } })).toBe('ip:10.0.0.5');
    });

    test('uses the IP bucket when no token is provided', () => {
        expect(rateLimitKey(baseRequest)).toBe('ip:10.0.0.5');
    });
});
