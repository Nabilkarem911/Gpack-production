-- =============================================================================
-- G.PACK 2.0 — Migration 056: Item-Level Design Approval System
-- Adds item-level signature, verification hash, and approval certificate support.
-- Extends design_approvals to support per-item approvals (not just per-order).
-- =============================================================================

-- Add item-level columns to design_approvals
ALTER TABLE design_approvals
    ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES order_items(id) ON DELETE CASCADE;

-- Remove the UNIQUE(order_id) constraint to allow multiple item-level approvals
ALTER TABLE design_approvals
    DROP CONSTRAINT IF EXISTS design_approvals_order_id_key;

-- Add verification hash for public verification pages
ALTER TABLE design_approvals
    ADD COLUMN IF NOT EXISTS verification_hash VARCHAR(64) UNIQUE;

-- Add approval certificate number (e.g., APP-20260726-0016)
ALTER TABLE design_approvals
    ADD COLUMN IF NOT EXISTS certificate_number VARCHAR(30) UNIQUE;

-- Add declaration text that was shown to the client
ALTER TABLE design_approvals
    ADD COLUMN IF NOT EXISTS declaration_text TEXT;

-- Add signature file path and hash (signature stored as file, not base64 in DB)
ALTER TABLE design_approvals
    ADD COLUMN IF NOT EXISTS signature_path VARCHAR(500),
    ADD COLUMN IF NOT EXISTS signature_sha256 VARCHAR(64);

-- Add approval image path (compact image with QR)
ALTER TABLE design_approvals
    ADD COLUMN IF NOT EXISTS approval_image_path VARCHAR(500);

-- Add approval PDF path
ALTER TABLE design_approvals
    ADD COLUMN IF NOT EXISTS approval_pdf_path VARCHAR(500);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_design_approvals_item ON design_approvals(item_id);
CREATE INDEX IF NOT EXISTS idx_design_approvals_verification ON design_approvals(verification_hash);
CREATE INDEX IF NOT EXISTS idx_design_approvals_certificate ON design_approvals(certificate_number);

-- Add item-level audit columns to order_items
ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS approval_certificate_number VARCHAR(30),
    ADD COLUMN IF NOT EXISTS approval_verification_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS review_token_used BOOLEAN DEFAULT false;
