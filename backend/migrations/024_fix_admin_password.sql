-- Migration 024: Fix admin user password hash
-- Resets admin@gpack.com password to: password
-- Hash: bcrypt 12 rounds of 'password'
-- IMPORTANT: Change this password immediately after login via the UI.
UPDATE users
SET password_hash = '$2b$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    email = 'admin@gpack.com'
WHERE role_id = (SELECT id FROM roles WHERE role_name = 'super_admin' LIMIT 1)
  AND email IN ('admin@gpack.com', 'admin@gpacksa.com');
