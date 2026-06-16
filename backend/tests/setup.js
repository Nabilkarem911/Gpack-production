// =============================================================================
// G.PACK 2.0 — Jest Test Setup
// =============================================================================

// Ensure JWT_SECRET is set for tests
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-min-32-characters-long';
process.env.SHARE_TOKEN_SECRET = process.env.SHARE_TOKEN_SECRET || 'test-share-token-secret-min-32-chars';
