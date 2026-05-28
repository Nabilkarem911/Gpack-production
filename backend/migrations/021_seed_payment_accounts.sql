-- Migration: seed example cash boxes and bank accounts as child accounts
-- These will appear dynamically in quotation & production order payment dropdowns.

-- Cash boxes (children of 1100 Cash on Hand)
INSERT INTO accounts (code, name, account_type, parent_id, location) VALUES
    ('1110', 'الصندوق الرئيسي', 'asset', (SELECT id FROM accounts WHERE code = '1100'), 'المكتب الرئيسي'),
    ('1120', 'صندوق فرع جدة', 'asset', (SELECT id FROM accounts WHERE code = '1100'), 'فرع جدة'),
    ('1130', 'صندوق فرع الرياض', 'asset', (SELECT id FROM accounts WHERE code = '1100'), 'فرع الرياض')
ON CONFLICT (code) DO NOTHING;

-- Bank accounts (children of 1200 Bank Accounts)
INSERT INTO accounts (code, name, account_type, parent_id, location) VALUES
    ('1210', 'مصرف الراجحي - الحساب الجاري', 'asset', (SELECT id FROM accounts WHERE code = '1200'), 'الراجحي'),
    ('1220', 'البنك الأهلي - الحساب الجاري', 'asset', (SELECT id FROM accounts WHERE code = '1200'), 'الأهلي'),
    ('1230', 'مصرف الإنماء', 'asset', (SELECT id FROM accounts WHERE code = '1200'), 'الإنماء')
ON CONFLICT (code) DO NOTHING;
