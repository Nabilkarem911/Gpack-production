-- Migration 043: Add token_version column to users table
-- Used to invalidate JWT tokens when role permissions are updated.
-- When a role's permissions change, token_version is incremented for all
-- users with that role, forcing them to re-login with updated permissions.

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
