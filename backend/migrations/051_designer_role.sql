-- =============================================================================
-- Migration 051: Add Designer Role
-- Creates a dedicated role for designers with access to the designer page
-- and related design workflow features.
-- =============================================================================

INSERT INTO roles (role_name, permissions, description)
VALUES (
    'designer',
    '{
        "designer": {"view": true, "create": true, "edit": true},
        "quotations": {"view": true, "edit": true},
        "dashboard": {"view": true},
        "data_scope": "personal_only"
    }',
    'Designer role — can view assigned design tasks, upload design files, and submit work for approval.'
)
ON CONFLICT (role_name) DO UPDATE
SET permissions = EXCLUDED.permissions,
    description = EXCLUDED.description;

-- =============================================================================
-- Also update any existing roles that have all_access to ensure they can
-- see designer page (they already can via all_access, but this ensures
-- the designer permission key exists for any future checks).
-- =============================================================================

-- Update super_admin to include designer permission explicitly (optional, for clarity)
UPDATE roles
SET permissions = permissions || '{"designer": {"view": true, "create": true, "edit": true}}'::jsonb
WHERE role_name = 'super_admin'
  AND NOT (permissions ? 'designer');
