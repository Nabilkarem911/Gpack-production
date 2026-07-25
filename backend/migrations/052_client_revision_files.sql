-- =============================================================================
-- Migration 052: Add client_revision_files column to order_items
-- Allows clients to upload files (screenshots, annotations) when requesting
-- design revisions through the public design review page.
-- =============================================================================

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS client_revision_files JSONB DEFAULT NULL;
