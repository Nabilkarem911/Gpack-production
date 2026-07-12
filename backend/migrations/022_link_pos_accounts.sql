-- Migration: link existing POS terminals to settlement bank accounts
UPDATE pos_terminals SET account_id = (SELECT id FROM accounts WHERE code = '1210') WHERE code = 'POS_MAIN';
UPDATE pos_terminals SET account_id = (SELECT id FROM accounts WHERE code = '1210') WHERE code = 'POS_WH';
