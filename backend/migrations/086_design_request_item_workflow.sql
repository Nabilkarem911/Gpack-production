-- Per-item design workflow for multi-item design requests.
ALTER TABLE design_request_messages
    ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES design_request_items(id) ON DELETE SET NULL;

ALTER TABLE design_request_versions
    ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES design_request_items(id) ON DELETE CASCADE;

ALTER TABLE design_request_revisions
    ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES design_request_items(id) ON DELETE CASCADE;

ALTER TABLE design_request_items
    ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'waiting_design',
    ADD COLUMN IF NOT EXISTS current_version_id UUID,
    ADD COLUMN IF NOT EXISTS approved_version_id UUID,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'design_request_items_status_check') THEN
        ALTER TABLE design_request_items
            ADD CONSTRAINT design_request_items_status_check
            CHECK (status IN ('waiting_design', 'in_progress', 'client_review', 'revision_requested', 'approved'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'design_request_items_current_version_fk') THEN
        ALTER TABLE design_request_items
            ADD CONSTRAINT design_request_items_current_version_fk
            FOREIGN KEY (current_version_id) REFERENCES design_request_versions(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'design_request_items_approved_version_fk') THEN
        ALTER TABLE design_request_items
            ADD CONSTRAINT design_request_items_approved_version_fk
            FOREIGN KEY (approved_version_id) REFERENCES design_request_versions(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_design_request_messages_item ON design_request_messages(item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_design_request_versions_item ON design_request_versions(request_id, item_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_design_request_revisions_item ON design_request_revisions(request_id, item_id, created_at DESC);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'design_request_versions_request_id_version_number_key') THEN
        ALTER TABLE design_request_versions DROP CONSTRAINT design_request_versions_request_id_version_number_key;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_design_request_versions_item_number
    ON design_request_versions(request_id, item_id, version_number)
    WHERE item_id IS NOT NULL;

-- Safely backfill legacy requests only when they contain exactly one item.
UPDATE design_request_versions v
SET item_id = i.id
FROM design_request_items i
WHERE v.item_id IS NULL
  AND i.request_id = v.request_id
  AND (SELECT COUNT(*) FROM design_request_items i2 WHERE i2.request_id = v.request_id) = 1;

UPDATE design_request_revisions r
SET item_id = i.id
FROM design_request_items i
WHERE r.item_id IS NULL
  AND i.request_id = r.request_id
  AND (SELECT COUNT(*) FROM design_request_items i2 WHERE i2.request_id = r.request_id) = 1;

UPDATE design_request_items i
SET current_version_id = latest.id,
    status = CASE WHEN latest.status = 'approved' THEN 'approved' ELSE 'client_review' END,
    approved_version_id = CASE WHEN latest.status = 'approved' THEN latest.id ELSE NULL END,
    approved_at = CASE WHEN latest.status = 'approved' THEN latest.created_at ELSE NULL END
FROM LATERAL (
    SELECT v.id, v.status, v.created_at
    FROM design_request_versions v
    WHERE v.item_id = i.id
    ORDER BY v.version_number DESC
    LIMIT 1
) latest;
