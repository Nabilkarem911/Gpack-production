-- Fix: review_token_used column missing from order_items
-- Migration 056 was marked applied but column doesn't exist in production DB
ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS review_token_used BOOLEAN DEFAULT false;
