// =============================================================================
// G.PACK 2.0 — Jest Configuration (D-001)
// =============================================================================

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-min-32-characters-long';
process.env.SHARE_TOKEN_SECRET = process.env.SHARE_TOKEN_SECRET || 'test-share-token-secret-min-32-chars';

module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.test.js'],
    collectCoverageFrom: [
        'middleware/**/*.js',
        'utils/**/*.js',
        'routes/**/*.js',
        '!**/node_modules/**',
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    verbose: true,
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
};
