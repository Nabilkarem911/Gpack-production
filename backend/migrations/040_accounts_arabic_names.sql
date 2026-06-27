-- Migration 040: Update account names from English to Arabic
-- Updates existing seed accounts to Arabic names
UPDATE accounts SET name = 'الأصول المتداولة' WHERE code = '1000';
UPDATE accounts SET name = 'النقدية بالصندوق' WHERE code = '1100';
UPDATE accounts SET name = 'الحسابات البنكية' WHERE code = '1200';
UPDATE accounts SET name = 'الذمم المدينة (العملاء)' WHERE code = '1300';
UPDATE accounts SET name = 'المخزون' WHERE code = '1400';
UPDATE accounts SET name = 'الخصوم المتداولة' WHERE code = '2000';
UPDATE accounts SET name = 'الذمم الدائنة (الموردون)' WHERE code = '2100';
UPDATE accounts SET name = 'ضريبة القيمة المضافة' WHERE code = '2200';
UPDATE accounts SET name = 'حقوق الملكية' WHERE code = '3000';
UPDATE accounts SET name = 'رأس المال' WHERE code = '3100';
UPDATE accounts SET name = 'الأرباح المرحّلة' WHERE code = '3200';
UPDATE accounts SET name = 'الإيرادات' WHERE code = '4000';
UPDATE accounts SET name = 'إيرادات المبيعات' WHERE code = '4100';
UPDATE accounts SET name = 'إيرادات الخدمات' WHERE code = '4200';
UPDATE accounts SET name = 'تكلفة البضاعة المباعة' WHERE code = '5000';
UPDATE accounts SET name = 'تكلفة المواد المباشرة' WHERE code = '5100';
UPDATE accounts SET name = 'تكلفة التصنيع' WHERE code = '5200';
UPDATE accounts SET name = 'المصاريف التشغيلية' WHERE code = '6000';
UPDATE accounts SET name = 'الشحن واللوجستيات' WHERE code = '6100';
UPDATE accounts SET name = 'الرسوم الإدارية' WHERE code = '6200';
UPDATE accounts SET name = 'الرواتب والأجور' WHERE code = '6300';
