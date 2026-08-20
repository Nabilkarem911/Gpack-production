-- Migration 041: Fix chart of accounts hierarchy roots
-- Root groups are 1000/2000/3000/4000/5000/6000.
-- Their immediate children must hang under them so the tree view renders correctly.

UPDATE accounts
SET parent_id = (SELECT id FROM accounts WHERE code = '1000' LIMIT 1)
WHERE code IN ('1100', '1200', '1300', '1400')
  AND parent_id IS NULL;

UPDATE accounts
SET parent_id = (SELECT id FROM accounts WHERE code = '2000' LIMIT 1)
WHERE code IN ('2100', '2200')
  AND parent_id IS NULL;

UPDATE accounts
SET parent_id = (SELECT id FROM accounts WHERE code = '3000' LIMIT 1)
WHERE code IN ('3100', '3200')
  AND parent_id IS NULL;

UPDATE accounts
SET parent_id = (SELECT id FROM accounts WHERE code = '4000' LIMIT 1)
WHERE code IN ('4100', '4200')
  AND parent_id IS NULL;

UPDATE accounts
SET parent_id = (SELECT id FROM accounts WHERE code = '5000' LIMIT 1)
WHERE code IN ('5100', '5200')
  AND parent_id IS NULL;

UPDATE accounts
SET parent_id = (SELECT id FROM accounts WHERE code = '6000' LIMIT 1)
WHERE code IN ('6100', '6200', '6300')
  AND parent_id IS NULL;

-- Keep existing sub-account fixes idempotent for common cash/bank children.
UPDATE accounts
SET parent_id = (SELECT id FROM accounts WHERE code = '1100' LIMIT 1)
WHERE code IN ('1110', '1120', '1130')
  AND parent_id IS NULL;

UPDATE accounts
SET parent_id = (SELECT id FROM accounts WHERE code = '1200' LIMIT 1)
WHERE code IN ('1210', '1220', '1230')
  AND parent_id IS NULL;
