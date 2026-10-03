-- Migration: add a contra-revenue account for allowed discounts (خصومات مسموحة)
-- Used as the debit leg when an order payment includes discount_amount,
-- so the receipt voucher stays balanced: DR cash + DR 4300 / CR 1300.

INSERT INTO accounts (code, name, account_type, parent_id) VALUES
    ('4300', 'خصومات مسموحة', 'revenue', (SELECT id FROM accounts WHERE code = '4000'))
ON CONFLICT (code) DO NOTHING;
