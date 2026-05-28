-- Migration: Fix parent_id for child accounts that were inserted without parent
-- Cash boxes (children of 1100)
UPDATE accounts
SET parent_id = (SELECT id FROM accounts WHERE code = '1100' LIMIT 1)
WHERE code IN ('1110', '1120', '1130')
  AND parent_id IS NULL;

-- Bank accounts (children of 1200)
UPDATE accounts
SET parent_id = (SELECT id FROM accounts WHERE code = '1200' LIMIT 1)
WHERE code IN ('1210', '1220', '1230')
  AND parent_id IS NULL;

-- Also add location if missing
UPDATE accounts SET location = 'المكتب الرئيسي' WHERE code = '1110' AND location IS NULL;
UPDATE accounts SET location = 'فرع جدة'        WHERE code = '1120' AND location IS NULL;
UPDATE accounts SET location = 'فرع الرياض'     WHERE code = '1130' AND location IS NULL;
UPDATE accounts SET location = 'الراجحي'         WHERE code = '1210' AND location IS NULL;
UPDATE accounts SET location = 'الأهلي'          WHERE code = '1220' AND location IS NULL;
UPDATE accounts SET location = 'الإنماء'         WHERE code = '1230' AND location IS NULL;
