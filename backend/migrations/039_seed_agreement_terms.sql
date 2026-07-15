-- Migration: Seed standard agreement terms (بنود الاتفاقية)
-- Inserts the default agreement terms used in quotations.
-- Idempotent: each INSERT uses WHERE NOT EXISTS to avoid duplicates on re-run.

INSERT INTO standard_terms (title, content, is_default, is_active, created_at)
SELECT 'مدة التنفيذ', 'مدة التنفيذ 30 يوم عمل من تاريخ التعميد على التصميم النهائي وتحويل الدفعة كحد أدنى.', true, true, NOW()
WHERE NOT EXISTS (SELECT 1 FROM standard_terms WHERE title = 'مدة التنفيذ');

INSERT INTO standard_terms (title, content, is_default, is_active, created_at)
SELECT 'الكميات الفعلية', 'الكميات المدونة بالاتفاقية غير دقيقة وستظهر الكمية الفعلية بفاتورة المبيعات بعد الانتهاء من الإنتاج وقد تزيد أو تنقص الكميات بهامش 5% تقريباً.', true, true, NOW()
WHERE NOT EXISTS (SELECT 1 FROM standard_terms WHERE title = 'الكميات الفعلية');

INSERT INTO standard_terms (title, content, is_default, is_active, created_at)
SELECT 'صلاحية الاتفاقية', 'صلاحية هذه الاتفاقية 5 أيام من تاريخ إصدارها.', true, true, NOW()
WHERE NOT EXISTS (SELECT 1 FROM standard_terms WHERE title = 'صلاحية الاتفاقية');

INSERT INTO standard_terms (title, content, is_default, is_active, created_at)
SELECT 'تعميد الطلب', 'يتم تعميد الطلب بعد تحويل الدفعة الأولى على حسابنا في البنك الأهلي وإرسال إيصال التحويل والموافقة على البروفات النهائية للعمل.', true, true, NOW()
WHERE NOT EXISTS (SELECT 1 FROM standard_terms WHERE title = 'تعميد الطلب');

INSERT INTO standard_terms (title, content, is_default, is_active, created_at)
SELECT 'إقرار الموافقة', 'تحويل الدفعة الأولى إقرار بموافقة العميل على كامل بنود الاتفاقية.', true, true, NOW()
WHERE NOT EXISTS (SELECT 1 FROM standard_terms WHERE title = 'إقرار الموافقة');

INSERT INTO standard_terms (title, content, is_default, is_active, created_at)
SELECT 'تأخر الدفعة الثانية', 'في حالة عدم دفع الدفعة الثانية خلال 15 يوم من تاريخ صدور الفاتورة فإن المصنع غير مسئول عن البضاعة ولا يحق للعميل استرداد مبلغ الدفعة الأولى.', true, true, NOW()
WHERE NOT EXISTS (SELECT 1 FROM standard_terms WHERE title = 'تأخر الدفعة الثانية');

INSERT INTO standard_terms (title, content, is_default, is_active, created_at)
SELECT 'التخزين والإيجار', 'يلتزم العميل باستلام كامل البضاعة من مستودعاتنا خلال 7 أيام كحد أقصى أو دفع إيجار تخزين وقدره 300 ريال شهرياً للطبلية الواحدة.', true, true, NOW()
WHERE NOT EXISTS (SELECT 1 FROM standard_terms WHERE title = 'التخزين والإيجار');

INSERT INTO standard_terms (title, content, is_default, is_active, created_at)
SELECT 'ألوان الطباعة', 'هناك فروقات بين درجة اللون على شاشة الجوال واللون الفعلي عند الطباعة ويتم اعتماد اللون من خلال كود اللون (pantone) الذي سيتم إرساله بالبروفة قبل الطباعة ويتم تعميدنا به قبل البدء بتنفيذ الطباعة.', true, true, NOW()
WHERE NOT EXISTS (SELECT 1 FROM standard_terms WHERE title = 'ألوان الطباعة');

INSERT INTO standard_terms (title, content, is_default, is_active, created_at)
SELECT 'تكلفة الكلايش', 'الأسعار غير شاملة تكلفة الكلايش ويتم تحديدها بحسب عدد الألوان وتدفع عند أول طباعة فقط.', true, true, NOW()
WHERE NOT EXISTS (SELECT 1 FROM standard_terms WHERE title = 'تكلفة الكلايش');

INSERT INTO standard_terms (title, content, is_default, is_active, created_at)
SELECT 'اعتماد التصاميم', 'بعد اعتماد التصاميم من قبل العميل فإن المصنع غير مسؤول عن أي أخطاء بالعناوين أو أي معلومات أو أي بيانات مطبوعة.', true, true, NOW()
WHERE NOT EXISTS (SELECT 1 FROM standard_terms WHERE title = 'اعتماد التصاميم');

INSERT INTO standard_terms (title, content, is_default, is_active, created_at)
SELECT 'تكلفة الشحن', 'السعر شامل تكاليف الشحن إلى مدينة ينبع وجدة.', true, true, NOW()
WHERE NOT EXISTS (SELECT 1 FROM standard_terms WHERE title = 'تكلفة الشحن');
