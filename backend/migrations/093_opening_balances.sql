-- =============================================================================
-- Migration 093: Opening Balances (الأرصدة الافتتاحية)
--
-- 1) Contra account '3300 — الأرصدة الافتتاحية' under equity parent '3000'.
--    Every opening balance posts a balanced 2-line voucher: the target account
--    line + the opposite leg on 3300.
-- 2) opening_balances registry table — tracks which account/sub-account already
--    has a posted opening balance and which voucher it produced.
--    Partial unique indexes prevent duplicates for POSTED rows only:
--      - (account_id)                     when no sub-account
--      - (account_id, sub_account_id)     when a client/supplier sub-ledger
--    Cancelled rows keep history but free the slot for a re-entry.
-- =============================================================================

INSERT INTO accounts (code, name, account_type, parent_id)
SELECT '3300', 'الأرصدة الافتتاحية', 'equity', id FROM accounts WHERE code = '3000'
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS opening_balances (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id       UUID NOT NULL REFERENCES accounts(id),
    sub_account_type VARCHAR(50),                 -- 'client' | 'supplier' | NULL
    sub_account_id   UUID,                        -- clients.id / suppliers.id
    side             VARCHAR(10) NOT NULL CHECK (side IN ('debit', 'credit')),
    amount           DECIMAL(15,2) NOT NULL CHECK (amount > 0),
    balance_date     DATE NOT NULL,
    description      TEXT,
    reference        VARCHAR(200),
    voucher_id       UUID REFERENCES accounting_vouchers(id),
    status           VARCHAR(20) NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
    created_by       UUID REFERENCES users(id),
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- One POSTED opening balance per plain account (no sub-ledger)
CREATE UNIQUE INDEX IF NOT EXISTS opening_balances_account_uq
    ON opening_balances (account_id)
    WHERE status = 'posted' AND sub_account_id IS NULL;

-- One POSTED opening balance per sub-ledger on a control account
CREATE UNIQUE INDEX IF NOT EXISTS opening_balances_sub_uq
    ON opening_balances (account_id, sub_account_id)
    WHERE status = 'posted' AND sub_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS opening_balances_account_idx ON opening_balances (account_id);
CREATE INDEX IF NOT EXISTS opening_balances_status_idx  ON opening_balances (status);
