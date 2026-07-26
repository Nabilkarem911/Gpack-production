-- Migration 067: Update WhatsApp notification templates to be professional
-- The old templates were unprofessional and hard to read.

-- Client template: professional, warm, includes all key info
UPDATE notification_templates SET
    body = 'السلام عليكم {{client_name}}\n\nنعتز بثقتكم في G.PACK\n\nتم اعتماد تصميمكم بنجاح ✅\n\n📦 المنتج: {{product_name}}\n📋 رقم الاعتماد: {{certificate_number}}\n📅 تاريخ الاعتماد: {{approved_date}}\n\n📎 مرفق لكم:\n• صورة التصميم المعتمد\n• شهادة الاعتماد\n• ملف PDF التفصيلي\n\nللتحقق من صحة الاعتماد:\n{{verify_url}}\n\nشكراً لتعاملكم معنا 🌹',
    variables = '["client_name","product_name","certificate_number","approved_date","verify_url"]'
WHERE code = 'design_approved_client' AND lang = 'ar';

-- If template doesn't exist (ON CONFLICT DO NOTHING in 060), insert it
INSERT INTO notification_templates (code, version, lang, subject, body, variables)
SELECT 'design_approved_client', 1, 'ar',
    'اعتماد تصميم — {{certificate_number}}',
    'السلام عليكم {{client_name}}\n\nنعتز بثقتكم في G.PACK\n\nتم اعتماد تصميمكم بنجاح ✅\n\n📦 المنتج: {{product_name}}\n📋 رقم الاعتماد: {{certificate_number}}\n📅 تاريخ الاعتماد: {{approved_date}}\n\n📎 مرفق لكم:\n• صورة التصميم المعتمد\n• شهادة الاعتماد\n• ملف PDF التفصيلي\n\nللتحقق من صحة الاعتماد:\n{{verify_url}}\n\nشكراً لتعاملكم معنا 🌹',
    '["client_name","product_name","certificate_number","approved_date","verify_url"]'
WHERE NOT EXISTS (SELECT 1 FROM notification_templates WHERE code = 'design_approved_client' AND lang = 'ar');

-- Admin template: professional, includes signer and correlation
UPDATE notification_templates SET
    body = '📢 تم اعتماد تصميم جديد\n\n👤 العميل: {{client_name}}\n📦 المنتج: {{product_name}}\n✍️ المعتمد: {{signer_name}}\n⏰ وقت الاعتماد: {{approved_time}}\n📋 رقم الاعتماد: {{certificate_number}}\n\n📎 مرفق: ملف PDF + شهادة الاعتماد + حزمة كاملة (ZIP)',
    variables = '["certificate_number","client_name","product_name","signer_name","approved_time","correlation_id"]'
WHERE code = 'design_approved_admin' AND lang = 'ar';

INSERT INTO notification_templates (code, version, lang, subject, body, variables)
SELECT 'design_approved_admin', 1, 'ar',
    'اعتماد تصميم — {{certificate_number}}',
    '📢 تم اعتماد تصميم جديد\n\n👤 العميل: {{client_name}}\n📦 المنتج: {{product_name}}\n✍️ المعتمد: {{signer_name}}\n⏰ وقت الاعتماد: {{approved_time}}\n📋 رقم الاعتماد: {{certificate_number}}\n\n📎 مرفق: ملف PDF + شهادة الاعتماد + حزمة كاملة (ZIP)',
    '["certificate_number","client_name","product_name","signer_name","approved_time","correlation_id"]'
WHERE NOT EXISTS (SELECT 1 FROM notification_templates WHERE code = 'design_approved_admin' AND lang = 'ar');
