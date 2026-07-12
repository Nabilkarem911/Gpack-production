-- =============================================================================
-- 036: Create order_notes table for chat-style notes on production orders
-- =============================================================================

CREATE TABLE IF NOT EXISTS order_notes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id),
    user_name   VARCHAR(255),
    message     TEXT NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_notes_order_id ON order_notes(order_id);
CREATE INDEX IF NOT EXISTS idx_order_notes_created_at ON order_notes(created_at);
