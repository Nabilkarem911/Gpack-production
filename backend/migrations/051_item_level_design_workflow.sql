-- =============================================================================
-- Migration 051: Item-Level Design Workflow
-- Adds per-item brief files and ensures item-level design status drives the workflow.
-- =============================================================================

-- Add design_brief_files to order_items for per-item reference files from manager
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS design_brief_files JSONB DEFAULT NULL;

-- Add designer_notes column if not exists (for designer's notes per item)
-- (This may already exist from migration 048, but adding IF NOT EXISTS for safety)
