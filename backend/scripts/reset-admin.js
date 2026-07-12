'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const bcrypt = require('bcrypt');
const db = require('../db');

// =============================================================================
// G.PACK 2.0 - Admin Password Reset Utility
// Generates a real bcrypt hash and writes it to the database.
// Run once from inside the backend container or directly via node.
//
// Usage:
//   docker exec -it gpack_backend node scripts/reset-admin.js
//   -- OR locally --
//   node backend/scripts/reset-admin.js
// =============================================================================

const ADMIN_EMAIL   = 'admin@gpack.com';
const ADMIN_PASSWORD = 'Admin@2024!';
const SALT_ROUNDS    = 12;

async function resetAdminPassword() {
    console.log('[Reset] Generating bcrypt hash...');

    const hash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);

    console.log(`[Reset] Hash generated: ${hash}`);
    console.log(`[Reset] Updating password for: ${ADMIN_EMAIL}`);

    const result = await db.query(
        'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2',
        [hash, ADMIN_EMAIL]
    );

    if (result.rowCount === 0) {
        console.error('[Reset] ERROR: No user found with email:', ADMIN_EMAIL);
        console.error('[Reset] Ensure init.sql ran correctly and the user exists.');
        process.exit(1);
    }

    console.log('[Reset] ✅ Admin password updated successfully.');
    console.log(`[Reset] Email:    ${ADMIN_EMAIL}`);
    console.log(`[Reset] Password: ${ADMIN_PASSWORD}`);
    console.log('[Reset] ⚠️  Change this password immediately after first login.');
    process.exit(0);
}

resetAdminPassword().catch((err) => {
    console.error('[Reset] Fatal error:', err.message);
    process.exit(1);
});
