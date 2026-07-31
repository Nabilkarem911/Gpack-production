# خطة تطوير المساعد الذكي — G.PACK ERP 2.0

## حالة النظام الحالية
- **إجراءات تنفيذية (Actions):** create_quote, convert_quote_to_invoice, add_payment, create_production_order, bulk_update_prices, bulk_create_reorders, create_client, update_order_status, create_task
- **دوال قراءة (Functions):** 40 دالة تشمل المبيعات، المخزون، العملاء، الموردين، المحاسبة، التسعير الذكي، التنبيهات الاستباقية
- **الواجهة:** تم إزالة بطاقة الـ briefing والاقتراحات من الشاشة الافتتاحية

---

## المرحلة 1: تحسينات سريعة (Quick Wins)

### 1.1 تحرير البيانات قبل التنفيذ
- **المشكلة:** المستخدم يقدر يؤكد أو يرفض بس، ما يقدرش يعدّل
- **الحل:** إضافة حقول قابلة للتعديل في بطاقة المراجعة (input fields بدل نص ثابت)
- **الملفات المتأثرة:** `frontend/js/ai-assistant.js` (دالة `_handleProposeAction`)
- **شجرة الارتباطات:** الـ frontend يعدّل `proposeRes.summary` قبل إرسال `action_id` لـ `/execute-action` — لكن التنفيذ بيقرأ من الـ log في الـ DB، فلازم نعدّل الـ proposal في الـ DB قبل التنفيذ
- **الحل التقني:** إضافة endpoint `/api/ai-assistant/update-proposal` يحدّث الـ proposal في `ai_action_log` قبل التنفيذ

### 1.2 سياق الصفحة النشطة
- **المشكلة:** الـ AI بيبعت `context.page` بس مش بيستخدمه بذكاء
- **الحل:** تمرير `entity_id` و `entity_type` من الصفحة الحالية لـ AI
- **الملفات المتأثرة:** `frontend/js/ai-assistant.js` (دالة `_sendMessage`), `backend/routes/ai-assistant.js` (SYSTEM_PROMPT)
- **شجرة الارتباطات:** كل صفحة (quotations, clients, products) تمرّر سياقها عبر `window.aiContext`

### 1.3 سلاسل إجراءات (Workflows)
- **المشكلة:** AI يعمل إجراء واحد في كل مرة
- **الحل:** دعم اقتراح متعدد في رد واحد، وتنفيذ متسلسل
- **الملفات المتأثرة:** `frontend/js/ai-assistant.js` (دالة `_handleProposeAction`), `backend/routes/ai-assistant.js`
- **شجرة الارتباطات:** الـ frontend ينفذ كل `proposed_action` بالترتيب، كل واحد separately عبر `/propose-action` ثم `/execute-action`

---

## المرحلة 2: ذكاء الأعمال (Business Intelligence)

### 2.1 تحليل تنبؤي للمخزون
- **السؤال:** هل للعميل الدائم (VMI) أم العميل الطياري؟
- **الإجابة:** التنبؤ بيكون على **مخزون المستودع** (`warehouse_stock`) — يعني استهلاك العملاء الدائمين اللي لهم مستودع. العميل الطياري ما عندهش مخزون في النظام، فهو ما يدخلش في التنبؤ.
- **المنطق:**
  1. حساب معدل الاستهلاك اليومي من `inventory_transactions` (type = 'dispense') آخر 90 يوم
  2. مقارنة بالمخزون الحالي في `warehouse_stock` للـ `client_id` المحدد
  3. حساب: `الأيام المتبقية = المخزون الحالي / معدل الاستهلاك اليومي`
  4. لو الأيام < 14 → تنبيه + اقتراح طلب شراء
- **الملفات المتأثرة:** `backend/utils/ai-functions.js` (دالة جديدة `getStockForecast`)
- **شجرة الارتباطات:**
  - يقرأ من: `warehouse_stock` (مرتبط بـ `client_id` + `variant_id`)
  - يقرأ من: `inventory_transactions` (مرتبط بـ `stock_id` → `warehouse_stock`)
  - **لا يقرأ من:** `orders` أو `order_items` (لأن التنبؤ بيكون على الاستهلاك الفعلي مش الطلبات)
  - **لا يكتب في:** أي جدول — دالة قراءة فقط

### 2.2 تقييم مخاطر الائتمان
- **المنطق:**
  1. تحليل سجل الدفعات من `client_transactions` (type = 'payment')
  2. متوسط المشتريات الشهرية من `orders` + `invoices`
  3. الرصيد الحالي = `invoices.grand_total - invoices.paid_amount`
  4. مقارنة بـ `clients.credit_limit`
  5. توصية: آمن / احذر / ممنوع
- **الملفات المتأثرة:** `backend/utils/ai-functions.js` (دالة جديدة `getCreditRiskAssessment`)
- **شجرة الارتباطات:**
  - يقرأ من: `clients` (credit_limit, status)
  - يقرأ من: `invoices` (grand_total, paid_amount, invoice_date)
  - يقرأ من: `client_transactions` (amount, type, created_at)
  - **لا يقرأ من:** `warehouse_stock` أو `inventory_transactions`
  - **لا يكتب في:** أي جدول

### 2.3 تصنيف العملاء تلقائياً
- **المنطق:**
  1. VIP: مشتريات > 100k سنة + التزام في الدفع
  2. منتظم: مشتريات متوسطة
  3. معرض للضياع: ما طلبش من 30+ يوم
  4. مخاطر ائتمانية: تأخير في الدفع > 60 يوم
- **الملفات المتأثرة:** `backend/utils/ai-functions.js` (دالة جديدة `getClientSegmentation`)
- **شجرة الارتباطات:**
  - يقرأ من: `orders` (client_id, grand_total, created_at, status)
  - يقرأ من: `invoices` (client_id, grand_total, paid_amount)
  - يقرأ من: `clients` (parent_id — يتخطى الفروع ويعرض الأصل)
  - **لا يكتب في:** أي جدول

### 2.4 قوالب طلبات متكررة
- **المنطق:**
  1. تحليل `orders` لكل عميل — البحث عن أنماط متكررة
  2. لو عميل بطلب نفس المنتجات بنفس الكميات كل X أيام → اقتراح "طلب متكرر"
  3. حفظ القالب في جدول جديد `recurring_order_templates`
- **الملفات المتأثرة:**
  - `backend/utils/ai-functions.js` (دالة `detectRecurringPatterns`)
  - `backend/utils/ai-actions.js` (إجراء `create_recurring_order`)
  - **migration جديدة:** `backend/migrations/058_recurring_orders.sql`
- **شجرة الارتباطات:**
  - يقرأ من: `orders` + `order_items` (آخر 90 يوم)
  - يكتب في: `recurring_order_templates` (جدول جديد)
  - `recurring_order_templates` مرتبط بـ `clients.id` و `products.id`

### 2.5 ذكاء الموردين والشراء
- **المنطق:**
  1. مقارنة أسعار الموردين لنفس المنتج من `purchase_invoice_items` + `purchase_invoices`
  2. تحليل جودة التسليم من `manufacturer_orders` (نسبة التسليم في الموعد)
  3. اقتراح أفضل مورد بناءً على السعر + الجودة
- **الملفات المتأثرة:** `backend/utils/ai-functions.js` (دوال جديدة)
- **شجرة الارتباطات:**
  - يقرأ من: `purchase_invoice_items` + `purchase_invoices` (unit_cost, invoice_date)
  - يقرأ من: `manufacturer_orders` (delivery_date vs expected_date)
  - **لا يكتب في:** أي جدول

---

## المرحلة 3: تقارير ذكية مخصصة

### 3.1 مولد التقارير
- **السؤال:** لو طلب المستخدم تقرير، هل هستلمه إزاي؟
- **الإجابة:** 3 خيارات:
  1. **عرض مباشر في الشات** — التقرير يظهر كرسالة منسقة في المحادثة (جداول + أرقام)
  2. **تحميل PDF** — الـ AI يولّد التقرير ويعرض زر تحميل
  3. **فتح صفحة منفصلة** — التقرير يفتح في صفحة جديدة قابلة للطباعة
- **الخيار الموصى به:** ابدأ بـ **العرض في الشات** (الأبسط)، ثم أضف تحميل PDF لاحقاً
- **المنطق:**
  1. دالة `generateCustomReport` تستقبل: نوع التقرير، الفترة، المقارنة
  2. تجمع البيانات من DB
  3. ترجعها كـ JSON منسق
  4. الـ AI يعرضها كجدول Markdown في الشات
- **الملفات المتأثرة:** `backend/utils/ai-functions.js`, `frontend/js/ai-assistant.js` (render جداول)
- **شجرة الارتباطات:**
  - يقرأ من: `orders`, `order_items`, `invoices`, `client_transactions`, `clients`, `products`
  - **لا يكتب في:** أي جدول

### 3.2 تحليل موسمي
- **المنطق:**
  1. تحليل مبيعات 12 شهر لكل منتج
  2. اكتشاف القمم والأودية
  3. اقتراح زيادة مخزون قبل المواسم
- **الملفات المتأثرة:** `backend/utils/ai-functions.js` (دالة `getSeasonalAnalysis`)
- **شجرة الارتباطات:**
  - يقرأ من: `order_items` + `orders` (آخر 12 شهر)
  - يقرأ من: `warehouse_stock` (المخزون الحالي)
  - **لا يكتب في:** أي جدول

---

## المرحلة 4: تكامل خارجي

### 4.1 تكامل WhatsApp
- **المنطق:**
  1. الـ AI يكتب رسالة للعميل
  2. يعرضها للمستخدم للمراجعة
  3. المستخدم يوافق → ترسل عبر WhatsApp API
- **الملفات المتأثرة:** `backend/utils/ai-actions.js` (إجراء `send_whatsapp`), `backend/routes/ai-assistant.js`
- **شجرة الارتباطات:**
  - يقرأ من: `clients` (phone, name)
  - يقرأ من: `orders` (رقم الطلب، الإجمالي)
  - يكتب في: `whatsapp_messages` (جدول جديد لتسجيل الرسائل المرسلة)
  - **ملاحظة:** يحتاج WhatsApp Business API key

### 4.2 مساعد صوتي للمستودع
- **المنطق:**
  1. أمين المستودع يضغط زر المايك
  2. يحول الصوت لنص عبر Web Speech API
  3. النص يذهب للـ AI
  4. الـ AI ينفذ (استلام، تسليم، جرد)
- **الملفات المتأثرة:** `frontend/js/ai-assistant.js` (إضافة زر ماك), `backend/utils/ai-actions.js`
- **شجرة الارتباطات:** نفس مسار الـ chat الحالي

---

## قواعد صارمة لشجرة الارتباطات

### الجداول المسموح بالقراءة منها (AI Functions)
| الجدول | الغرض | مرتبط بـ |
|--------|-------|----------|
| `clients` | بيانات العملاء | `parent_id` → `clients.id` |
| `products` | المنتجات | — |
| `product_variants` | المقاسات | `product_id` → `products.id` |
| `orders` | الطلبات | `client_id` → `clients.id` |
| `order_items` | أصناف الطلبات | `order_id` → `orders.id`, `variant_id` → `product_variants.id` |
| `invoices` | الفواتير | `client_id` → `clients.id`, `order_id` → `orders.id` |
| `client_transactions` | حركات العملاء | `client_id` → `clients.id`, `order_id` → `orders.id` |
| `warehouse_stock` | المخزون | `client_id` → `clients.id`, `variant_id` → `product_variants.id` |
| `inventory_transactions` | حركات المخزون | `stock_id` → `warehouse_stock.id` |
| `suppliers` | الموردين | — |
| `purchase_invoice_items` | أصناف فواتير الشراء | `purchase_invoice_id` → `purchase_invoices.id`, `variant_id` → `product_variants.id` |
| `purchase_invoices` | فواتير الشراء | `supplier_id` → `suppliers.id` |
| `delivery_notes` | سندات التسليم | `order_id` → `orders.id`, `client_id` → `clients.id` |
| `tasks` | المهام | `assigned_to` → `users.id` |
| `ai_chat_history` | سجل المحادثة | `user_id` → `users.id` |
| `ai_action_log` | سجل الإجراءات | `user_id` → `users.id` |

### الجداول المسموح بالكتابة فيها (AI Actions فقط)
| الجدول | الإجراء | الحقول المسموحة |
|--------|---------|------------------|
| `clients` | create_client | name, phone, email, address, tax_id, contact_person, city, commercial_register, credit_limit, parent_id, status, created_by |
| `orders` | create_quote, create_production_order | client_id, status, order_number, internal_notes, created_by |
| `order_items` | (مع create_quote) | order_id, variant_id, quantity, unit_price, line_total |
| `client_transactions` | add_payment | client_id, order_id, type, amount, payment_method, description |
| `tasks` | create_task | title, description, assigned_to, created_by, due_date, status, priority |
| `ai_action_log` | (تلقائي) | user_id, action_type, proposal, status, result |

### محظورات صارمة
- **لا يكتب الـ AI في:** `warehouse_stock`, `inventory_transactions`, `accounting_vouchers`, `accounting_voucher_lines`, `invoices`
- **لا يحذف الـ AI من:** أي جدول إطلاقاً
- **لا يعدّل الـ AI:** `product_variants.cost_price` أو `product_variants.selling_price` مباشرة (يستخدم `bulk_update_prices` action)

---

## ترتيب التنفيذ المقترح
1. **تحرير البيانات قبل التنفيذ** (1.1) — قيمة عالية، مجهود متوسط
2. **تحليل تنبؤي للمخزون** (2.1) — قيمة عالية، مجهود متوسط
3. **تقييم مخاطر الائتمان** (2.2) — قيمة عالية، مجهود متوسط
4. **تقارير ذكية في الشات** (3.1) — قيمة عالية، مجهود متوسط
5. **تصنيف العملاء** (2.3) — قيمة متوسطة، مجهود متوسط
6. **سلاسل إجراءات** (1.3) — قيمة عالية، مجهود عالي
7. **قوالب متكررة** (2.4) — قيمة متوسطة، مجهود عالي
8. **ذكاء الموردين** (2.5) — قيمة متوسطة، مجهود متوسط
9. **تحليل موسمي** (3.2) — قيمة متوسطة، مجهود متوسط
10. **تكامل WhatsApp** (4.1) — قيمة عالية، مجهود عالي
11. **مساعد صوتي** (4.2) — قيمة متوسطة، مجهود عالي

---

## ملاحظات تقنية
- كل دالة جديدة في `ai-functions.js` يجب أن تكون **قراءة فقط** (SELECT)
- كل إجراء جديد في `ai-actions.js` يجب أن يستخدم `db.withTransaction`
- كل migration جديد يجب أن يكون **idempotent** (CREATE TABLE IF NOT EXISTS)
- تحديث الـ SYSTEM_PROMPT في كل مرة نضيف دالة أو إجراء جديد
- تحديث cache-buster في `frontend/index.html` بعد كل تعديل على `ai-assistant.js`

---

## المرحلة 5: محرك الذاكرة والسياق (Memory + Context Engine)

### 5.1 ذاكرة المحادثة (Conversation Memory)
- **المشكلة:** كل رسالة مستقلة، الـ AI مش فاكر إيه اللي اتقال قبل كده
- **الحل:** ربط الرسائل في `ai_chat_history` بـ `conversation_id` + تلخيص السياق
- **المنطق:**
  1. كل محادثة تاخد `conversation_id` (UUID)
  2. كل 5 رسائل، الـ AI يولّد ملخص سياقي ويخزنه في `conversation_context`
  3. عند كل رسالة جديدة، نمرّر آخر ملخص + آخر 3 رسائل
  4. الـ AI يقدر يقول "العرض اللي اتكلّم عنه قبل كده" ويربطه بالـ order_id
- **الملفات المتأثرة:**
  - `backend/routes/ai-assistant.js` (chat endpoint)
  - `backend/migrations/059_conversation_context.sql` (إضافة `conversation_id` و `context_summary`)
- **شجرة الارتباطات:**
  - يقرأ من: `ai_chat_history` (conversation_id, context_summary)
  - يكتب في: `ai_chat_history` (conversation_id), `conversation_context` (جدول جديد)
  - `conversation_context` مرتبط بـ `conversation_id` و `user_id` → `users.id`

### 5.2 ذاكرة الأعمال (Business Memory)
- **المنطق:** الـ AI يتذكر العميل اللي بتكلم عنه، الطلب اللي شغّال عليه، المنتج اللي بتسأل عنه
- **الحل:** تخزين `active_context` في `ai_chat_history` يحتوي: `{ client_id, order_id, product_id }`
- **شجرة الارتباطات:**
  - يقرأ من: `ai_chat_history` (active_context JSON)
  - يكتب في: `ai_chat_history` (active_context)
  - مرتبط بـ: `clients.id`, `orders.id`, `products.id` (مراجع اختيارية)

---

## المرحلة 6: محرك الأحداث (Business Event Bus) ⭐⭐⭐⭐⭐

### 6.1 جدول الأحداث الموحد
- **الفكرة:** كل حاجة تحصل في الشركة تتحول لـ Event موحد في جدول واحد
- **المنطق:**
  1. إنشاء جدول `business_events`
  2. إضافة triggers أو app-level hooks تسجّل الأحداث
  3. الـ AI يقرأ الأحداث ويربطها ببعض
- **أنواع الأحداث:**
  - `quote_created` — عرض سعر جديد
  - `quote_converted` — تحويل لفاتورة
  - `payment_received` — دفعة مستلمة
  - `payment_overdue` — دفعة متأخرة
  - `stock_low` — مخزون منخفض
  - `stock_out` — نفاد مخزون
  - `production_started` — بدء إنتاج
  - `production_completed` — اكتمال إنتاج
  - `production_delayed` — تأخير إنتاج
  - `client_inactive` — عميل خامل
  - `price_changed` — تغيير سعر
  - `supplier_price_changed` — تغيير سعر مورد
  - `delivery_completed` — تسليم مكتمل
  - `delivery_delayed` — تأخير تسليم
- **الملفات المتأثرة:**
  - `backend/migrations/060_business_events.sql`
  - `backend/utils/event-bus.js` (وحدة جديدة)
  - كل routes تضيف `eventBus.emit()` بعد العمليات الحرجة
- **شجرة الارتباطات:**
  - `business_events` مرتبط بـ: `entity_type` (client/order/product/invoice/supplier) + `entity_id`
  - `business_events.created_by` → `users.id`
  - **لا يكتب الـ AI مباشرة في هذا الجدول** — يقرأ منه فقط
  - الـ routes هي اللي تكتب فيه عبر `eventBus.emit()`

### 6.2 تسلسل زمني للشركة (Company Timeline)
- **المنطق:** دالة `getCompanyTimeline` ترجع آخر N حدث في الشركة
- **شجرة الارتباطات:**
  - يقرأ من: `business_events` (آخر 50 حدث)
  - يقرأ من: `clients`, `orders`, `products` (أسماء بدل أرقام)
  - **لا يكتب في:** أي جدول

---

## المرحلة 7: التحليل السببي (Root Cause Analysis)

### 7.1 ليه حصل كده؟
- **المنطق:** لما تسأل "ليه المبيعات قلت؟" الـ AI:
  1. يقارن مبيعات هذا الشهر بالشهر اللي فات
  2. يحدد العملاء اللي وقفوا
  3. يحدد المنتجات اللي نفدت
  4. يحدد تأخيرات الإنتاج
  5. يربط الأحداث ببعض ويعطي تفسير
- **الملفات المتأثرة:** `backend/utils/ai-functions.js` (دالة `getRootCauseAnalysis`)
- **شجرة الارتباطات:**
  - يقرأ من: `orders` + `order_items` (مقارنة شهرية)
  - يقرأ من: `business_events` (أحداث الشهر)
  - يقرأ من: `warehouse_stock` (نفاد مخزون)
  - يقرأ من: `production_orders` (تأخيرات)
  - **لا يكتب في:** أي جدول

---

## المرحلة 8: الوضع المستقل (Autonomous Mode)

### 8.1 لوحة الصباح التلقائية
- **المنطق:** كل صباح الـ AI يبعت تلقائياً:
  - عملاء متأخرين
  - منتجات هتخلص
  - عروض أسعار متأخرة
  - تغيرات أسعار الموردين
  - فواتير متأخرة
  - الإنتاج مقابل المخطط
- **التنفيذ:**
  1. Cron job في الـ backend يفحص كل صباح 8 صباحاً
  2. يولّد ملخص ويسجّله في `ai_briefings`
  3. الـ frontend يعرضه لما المستخدم يفتح الـ AI (بدون ما يغطي الشاشة — زر صغير في الـ header)
- **الملفات المتأثرة:**
  - `backend/utils/ai-briefing.js` (وحدة جديدة)
  - `backend/migrations/061_ai_briefings.sql`
  - `frontend/js/ai-assistant.js` (عرض زر تنبيه بدل بطاقة كاملة)
- **شجرة الارتباطات:**
  - يقرأ من: `business_events` (آخر 24 ساعة)
  - يقرأ من: `invoices` (متأخرة), `warehouse_stock` (منخفض), `orders` (pending)
  - يكتب في: `ai_briefings` (جدول جديد — ملخص يومي)
  - `ai_briefings.user_id` → `users.id`

---

## المرحلة 9: محرك القرارات (Decision Engine)

### 9.1 مساعد القرارات
- **المنطق:** بدل ما يجيب بيانات بس، يقول القرار
- **مثال:** العميل طلب خصم 10% → الـ AI يحسب:
  1. الربح الحالي
  2. تكلفة الإنتاج
  3. تاريخ العميل (حجم تعاملاته)
  4. الحد الأدنى للربح
  5. يقول: "أنصح بخصم 7% لأن العميل حجمه كبير والهامش يسمح"
- **الملفات المتأثرة:** `backend/utils/ai-functions.js` (دالة `getDiscountDecision`)
- **شجرة الارتباطات:**
  - يقرأ من: `order_items` + `product_variants` (cost_price)
  - يقرأ من: `orders` (تاريخ العميل)
  - يقرأ من: `clients` (credit_limit, status)
  - **لا يكتب في:** أي جدول

---

## المرحلة 10: مدقق الشركة (AI Auditor)

### 10.1 مراجعة يومية تلقائية
- **المنطق:** الـ AI يفحص الشركة ويكتشف:
  - فاتورة ناقصة (order بدون invoice)
  - سعر غلط (selling_price < cost_price)
  - منتج بيتباع بخسارة
  - موظف ناسي task
  - عميل المفروض يتكلم معاه (خامل 30+ يوم)
  - مخزون غير منطقي (stock سالب أو كبير جداً)
  - بيانات مكررة (عميلين بنفس الاسم/الهاتف)
- **الملفات المتأثرة:** `backend/utils/ai-functions.js` (دالة `getAuditReport`)
- **شجرة الارتباطات:**
  - يقرأ من: `orders` + `invoices` (فواتير ناقصة)
  - يقرأ من: `product_variants` (selling_price < cost_price)
  - يقرأ من: `order_items` + `product_variants` (بيع بخسارة)
  - يقرأ من: `tasks` (مهام متأخرة)
  - يقرأ من: `clients` + `orders` (عملاء خاملين)
  - يقرأ من: `warehouse_stock` (مخزون غير منطقي)
  - يقرأ من: `clients` (بيانات مكررة)
  - **لا يكتب في:** أي جدول

---

## المرحلة 11: مخطط الأعمال (AI Planner)

### 11.1 تخطيط متعدد الخطوات
- **المنطق:** تقول "عايز أزود المبيعات مليون" → الـ AI:
  1. يحلل الوضع الحالي
  2. يولّد خطة متعددة الخطوات
  3. يسأل "أبدأ؟"
  4. ينفذ خطوة بخطوة مع موافقة على كل خطوة
- **الملفات المتأثرة:** `backend/utils/ai-functions.js` (دالة `generateBusinessPlan`)
- **شجرة الارتباطات:**
  - يقرأ من: كل الجداول (تحليل شامل)
  - يكتب في: `ai_action_plans` (جدول جديد — خطة متعددة الخطوات)
  - `ai_action_plans` مرتبط بـ `user_id` → `users.id`
  - كل خطوة في الخطة مرتبطة بـ `ai_action_log`

---

## المرحلة 12: التعلم من الشركة (Learning Layer)

### 12.1 نموذج تفضيلات المستخدم
- **المنطق:** الـ AI يتعلم من قرارات المستخدم:
  - كل مرة توافق على خصم 5% → يسجّل
  - كل مرة تختار مورد معين → يسجّل
  - كل مرة ترفض اقتراح → يسجّل
  - بعد فترة: "أنت بتفضل خصم 5-7% للعملاء الكبار"
- **الملفات المتأثرة:**
  - `backend/migrations/062_user_preferences.sql`
  - `backend/utils/ai-learning.js` (وحدة جديدة)
- **شجرة الارتباطات:**
  - يقرأ من: `ai_action_log` (القرارات السابقة)
  - يكتب في: `user_preferences` (جدول جديد)
  - `user_preferences.user_id` → `users.id`

---

## المرحلة 13: التوقع الشامل (Business Forecast)

### 13.1 توقع 3 شهور قدام
- **المنطق:** بدل توقع المخزون بس، توقع:
  - الإيرادات المتوقعة
  - الأرباح المتوقعة
  - الكاش المتوقع
  - المخزون المتوقع
  - الإنتاج المتوقع
- **الملفات المتأثرة:** `backend/utils/ai-functions.js` (دالة `getBusinessForecast`)
- **شجرة الارتباطات:**
  - يقرأ من: `orders` (آخر 12 شهر — اتجاه)
  - يقرأ من: `invoices` + `client_transactions` (كاش متوقع)
  - يقرأ من: `warehouse_stock` + `inventory_transactions` (مخزون)
  - يقرأ من: `manufacturer_orders` (إنتاج)
  - **لا يكتب في:** أي جدول

---

## المراحل المتقدمة (مستقبلاً)

### Phase 14: Digital Twin — محاكاة الشركة
- محتاج simulation engine كامل — مجهود عالي جداً
- **لا ينفذ الآن**

### Phase 15: Multi-Agent System — وكلاء متخصصون
- Sales Agent, Production Agent, Inventory Agent, Accounting Agent, CEO Agent
- تعقيد معماري كبير — **لا ينفذ الآن**

### Phase 16: Computer Vision — رؤية كمبيوتر
- تصوير المنتج → فحص الجودة
- تصوير المخزن → عد الكراتين
- محتاج ML models — **لا ينفذ الآن**

### Phase 17: Knowledge Graph — شجرة المعرفة
- بدل جداول منفصلة، graph كامل للعلاقات
- تغيير معماري ضخم — **لا ينفذ الآن**

### Phase 18: AI CEO — مدير الشركة الذكي
- تتويج كل المراحل السابقة
- **لا ينفذ الآن**

---

## ترتيب التنفيذ المحدّث (الواقعي)

| الأولوية | الميزة | المجهود | القيمة |
|----------|--------|---------|--------|
| 1 | Business Event Bus (6.1) | متوسط | عالية جداً |
| 2 | AI Auditor (10.1) | متوسط | عالية جداً |
| 3 | Action Policies (20.1) | متوسط | عالية جداً |
| 4 | ذاكرة المحادثة (5.1) | متوسط | عالية جداً |
| 5 | Explainability (22.1) | متوسط | عالية جداً |
| 6 | تحرير البيانات قبل التنفيذ (1.1) | متوسط | عالية |
| 7 | محرك القرارات + Confidence (9.1 + 21.1) | متوسط | عالية |
| 8 | Recommendation Feedback (24.1) | متوسط | عالية |
| 9 | لوحة الصباح التلقائية (8.1) | متوسط | عالية |
| 10 | AI Skills / Workflows (19.1) | متوسط | عالية |
| 11 | تحليل تنبؤي للمخزون (2.1) | متوسط | عالية |
| 12 | تقييم مخاطر الائتمان (2.2) | متوسط | عالية |
| 13 | التحليل السببي (7.1) | متوسط | عالية |
| 14 | تقارير ذكية في الشات (3.1) | متوسط | عالية |
| 15 | AI Metrics Dashboard (30.1) | متوسط | عالية |
| 16 | Prompt Versioning (28.1) | متوسط | متوسطة |
| 17 | KPI Engine (25.1) | متوسط | متوسطة |
| 18 | تصنيف العملاء (2.3) | متوسط | متوسطة |
| 19 | ذاكرة الأعمال (5.2) | متوسط | متوسطة |
| 20 | Timeline Replay (27.1) | متوسط | متوسطة |
| 21 | Goal Engine (23.1) | عالي | عالية |
| 22 | التعلم من الشركة (12.1) | عالي | متوسطة |
| 23 | مخطط الأعمال (11.1) | عالي | متوسطة |
| 24 | توقع شامل (13.1) | متوسط | متوسطة |
| 25 | سلاسل إجراءات (1.3) | عالي | متوسطة |
| 26 | قوالب متكررة (2.4) | عالي | متوسطة |
| 27 | AI Sandbox (26.1) | عالي | متوسطة |
| 28 | Feature Flags (29.1) | متوسط | متوسطة |
| 29 | تكامل WhatsApp (4.1) | عالي | عالية |
| 30 | مساعد صوتي (4.2) | عالي | متوسطة |

---

## المرحلة 19: مهارات الـ AI (AI Skills / Workflows)

### 19.1 Skills جاهزة بدل اختراع الخطوات كل مرة
- **المشكلة:** الـ AI كل مرة يخترع الخطوات من الصفر — عرضة للأخطاء
- **الحل:** Skills جاهزة = Workflows محددة مسبقاً
- **أمثلة Skills:**
  - `new_client_journey`: إنشاء عميل → عرض سعر → Task متابعة → Event
  - `recover_lost_client`: تحديد عميل خامل → اقتراح عرض خاص → Task اتصال
  - `negotiate_discount`: تحليل الهامش → اقتراح خصم → عرض الأسباب
  - `reorder_routine`: فحص مخزون → طلب شراء → Task متابعة تسليم
- **الملفات المتأثرة:**
  - `backend/utils/ai-skills.js` (وحدة جديدة)
  - `backend/migrations/063_ai_skills.sql` (جدول `ai_skills`)
- **شجرة الارتباطات:**
  - يقرأ من: `ai_skills` (تعريف Skill)
  - يكتب في: `ai_skill_executions` (سجل تنفيذ Skill)
  - كل Skill مرتبطة بـ `ai_action_log` (الخطوات الفردية)

---

## المرحلة 20: سياسات الإجراءات (Action Policies) ⭐⭐⭐⭐⭐

### 20.1 قواعد عمل صارمة لكل إجراء
- **المشكلة:** الـ AI حر يفعل أي شيء — ممكن يعمل حماقات
- **الحل:** كل Action له Policy تُفحص قبل التنفيذ
- **أمثلة Policies:**
  - `bulk_update_prices`: لو أكتر من 15 منتج → لازم موافقة مدير
  - `create_quote`: لو خصم > 20% → ارفض
  - `create_quote`: لو client.credit_limit متجاوز → مينفعش
  - `add_payment`: لو المبلغ > الرصيد المتبقي → ارفض
  - `create_production_order`: لو مخزون المادة الخام غير كافي → تحذير
- **التنفيذ:**
  1. جدول `action_policies` يخزن القواعد (JSON conditions)
  2. قبل `execute()`، يفحص الـ policies
  3. لو policy فشلت → يرجع `blocked` مع السبب
  4. لو policy تحتاج موافقة → يرجع `pending_approval`
- **الملفات المتأثرة:**
  - `backend/utils/ai-policies.js` (وحدة جديدة)
  - `backend/migrations/064_action_policies.sql`
  - `backend/utils/ai-actions.js` (إضافة فحص policy قبل execute)
- **شجرة الارتباطات:**
  - يقرأ من: `action_policies` (القواعد)
  - يقرأ من: `clients` (credit_limit), `orders` (خصم), `warehouse_stock` (مخزون)
  - يكتب في: `ai_action_log` (status = 'blocked' أو 'pending_approval')
  - **لا يكتب في:** أي جدول بيانات إذا فشلت Policy

---

## المرحلة 21: محرك الثقة (Confidence Engine)

### 21.1 درجة ثقة لكل قرار
- **المنطق:** كل رد يطلع بدرجة ثقة (0-100%)
  - > 80%: قرار واثق
  - 60-80%: قرار مع تحفظ
  - < 60%: "محتاج بيانات أكتر"
- **كيفية الحساب:**
  - جودة البيانات (هل cost_price موجود؟ هل تاريخ العميل كافي؟)
  - عدد النقاط المرجعية (لو 3 طلبات سابقة → ثقة عالية. لو 0 → ثقة منخفضة)
  - تطابق النمط (هل السعر المقترح قريب من السوق؟)
- **الملفات المتأثرة:** `backend/utils/ai-functions.js` (إضافة `confidence` field في كل دالة تحليلية)
- **شجرة الارتباطات:** لا يكتب — يقرأ من نفس جداول الدالة الأم

---

## المرحلة 22: الشفافية والتفسير (Explainability) ⭐⭐⭐⭐⭐

### 22.1 زر "ليه؟" لكل قرار
- **المشكلة:** الـ AI بيقول القرار بس مش بيقول ليه
- **الحل:** كل قرار/توصية يبقى معاه `explanation` يحتوي:
  - البيانات اللي استند عليها
  - الحسابات
  - السبب المنطقي
- **مثال:**
  ```
  أنصح بخصم 7%
  ليه؟
  - العميل اشترى 250 ألف السنة دي
  - بيدفع في معاده (0 تأخير)
  - هامش الربح الحالي 31%
  - الخصم هيخلي الهامش 25%
  - الحد الأدنى المقبول 20%
  → لذلك أوصي بالموافقة
  ```
- **التنفيذ:**
  1. كل دالة تحليلية ترجع `explanation` array من الأسباب
  2. الـ frontend يعرض زر "ليه؟" يفتح الـ explanation
- **الملفات المتأثرة:**
  - `backend/utils/ai-functions.js` (إضافة explanation لكل دالة)
  - `frontend/js/ai-assistant.js` (زر "ليه؟" في بطاقة القرار)
- **شجرة الارتباطات:** لا يكتب — يقرأ من نفس جداول الدالة الأم

---

## المرحلة 23: محرك الأهداف (Goal Engine) ⭐⭐⭐⭐⭐⭐

### 23.1 أهداف بدل أوامر
- **المنطق:** بدل "اعمل كذا"، تقول "قلل الديون" أو "زود الأرباح 20%"
  1. الـ AI يحلل الوضع الحالي
  2. يحدد KPIs المرتبطة بالهدف
  3. يقيس التقدم يومياً
  4. يقترح خطوات لتقريب المسافة
- **التنفيذ:**
  1. جدول `ai_goals` يخزن الأهداف (type, target_value, current_value, deadline)
  2. Cron job يومي يقيس التقدم
  3. الـ AI يقترح إجراءات لتقريب الفجوة
- **الملفات المتأثرة:**
  - `backend/utils/ai-goals.js` (وحدة جديدة)
  - `backend/migrations/065_ai_goals.sql`
- **شجرة الارتباطات:**
  - يقرأ من: `orders`, `invoices`, `client_transactions` (قياس التقدم)
  - يكتب في: `ai_goals` (current_value, last_measured)
  - `ai_goals.user_id` → `users.id`

---

## المرحلة 24: تغذية الاقتراحات (Recommendation Feedback)

### 24.1 👍👎 تحت كل اقتراح
- **المنطق:**
  1. كل اقتراح يظهر تحته زرين: 👍 (موافق) و 👎 (مش موافق)
  2. لو 👎 → الـ AI يسأل "ليه؟" ويتعلم
  3. تسجيل الردود في `ai_feedback`
- **الملفات المتأثرة:**
  - `frontend/js/ai-assistant.js` (إضافة أزرار 👍👎)
  - `backend/migrations/066_ai_feedback.sql`
  - `backend/routes/ai-assistant.js` (endpoint `/feedback`)
- **شجرة الارتباطات:**
  - يقرأ من: `ai_feedback` (للتعلم)
  - يكتب في: `ai_feedback` (user_id, message_id, rating, reason)
  - `ai_feedback.user_id` → `users.id`

---

## المرحلة 25: محرك مؤشرات الأداء (KPI Engine)

### 25.1 مراقبة KPIs وتنبيه عند الانحراف
- **KPIs المراقبة:**
  - Revenue (الإيرادات)
  - Profit (الأرباح)
  - Collection (تحصيل الديون)
  - Production (الإنتاج)
  - Waste (الهدر)
  - Inventory Turnover (معدل دوران المخزون)
  - Delivery SLA (التسليم في الموعد)
- **المنطق:** كل KPI له target و actual. لو الانحراف > 15% → تنبيه
- **الملفات المتأثرة:** `backend/utils/ai-functions.js` (دالة `getKPIStatus`)
- **شجرة الارتباطات:**
  - يقرأ من: `orders`, `invoices`, `client_transactions`, `warehouse_stock`, `manufacturer_orders`, `delivery_notes`
  - **لا يكتب في:** أي جدول

---

## المرحلة 26: بيئة المحاكاة (AI Sandbox)

### 26.1 تجربة الإجراءات قبل التنفيذ
- **المنطق:** أي Action يجربه في sandbox قبل التنفيذ
  - "لو رفعت الأسعار 5%؟" → يحاكي ويقول الأثر المتوقع
  - "لو فقدنا العميل ده؟" → يحسب الخسارة
- **التنفيذ:**
  1. دالة `simulateAction` تستقبل Action type + args
  2. تحسب الأثر المتوقع بدون كتابة في DB
  3. ترجع: الأثر على المبيعات، الأرباح، المخزون
- **الملفات المتأثرة:** `backend/utils/ai-functions.js` (دالة `simulateAction`)
- **شجرة الارتباطات:**
  - يقرأ من: نفس جداول الـ Action المراد محاكاته
  - **لا يكتب في:** أي جدول — قراءة فقط

---

## المرحلة 27: إعادة عرض الزمن (Timeline Replay)

### 27.1 "وريني الأسبوع اللي فات"
- **المنطق:** مبني على Business Event Bus
  1. يقرأ أحداث فترة محددة
  2. يعرضها زمنياً (يوم بيوم)
  3. يشرح كل حدث وربطه بالأحداث الأخرى
- **الملفات المتأثرة:** `backend/utils/ai-functions.js` (دالة `getTimelineReplay`)
- **شجرة الارتباطات:**
  - يقرأ من: `business_events` (الفترة المحددة)
  - يقرأ من: `clients`, `orders`, `products` (أسماء)
  - **لا يكتب في:** أي جدول

---

## المرحلة 28: إصدارات الـ Prompt (Prompt Versioning)

### 28.1 تسجيل كل تعديل في SYSTEM_PROMPT
- **المنطق:**
  1. كل تعديل على SYSTEM_PROMPT يتسجل في `ai_prompt_versions`
  2. يحفظ: version, prompt_text, changed_by, created_at, notes
  3. يقدر يرجع لأي نسخة سابقة
  4. يقارن أداء النسخ (نسبة نجاح Actions)
- **الملفات المتأثرة:**
  - `backend/migrations/067_ai_prompt_versions.sql`
  - `backend/routes/ai-assistant.js` (تسجيل تلقائي عند تغيير PROMPT)
- **شجرة الارتباطات:**
  - يقرأ من: `ai_prompt_versions`
  - يكتب في: `ai_prompt_versions` (تلقائي عند تغيير PROMPT)

---

## المرحلة 29: مفاتيح الميزات (Feature Flags)

### 29.1 تفعيل/تعطيل الميزات بدون Deploy
- **المنطق:**
  1. جدول `feature_flags` يخزن: flag_name, enabled, description
  2. الـ backend يفحص الـ flags قبل تنفيذ الميزة
  3. الـ frontend يفحص الـ flags قبل عرض الميزة
- **الملفات المتأثرة:**
  - `backend/migrations/068_feature_flags.sql`
  - `backend/utils/feature-flags.js` (وحدة جديدة)
- **شجرة الارتباطات:**
  - يقرأ من: `feature_flags`
  - يكتب في: `feature_flags` (admin فقط)

---

## المرحلة 30: لوحة أداء الـ AI (AI Metrics Dashboard)

### 30.1 قياس أداء المساعد الذكي
- **المؤشرات:**
  - عدد المحادثات
  - نسبة نجاح الـ Actions
  - عدد الاقتراحات المقبولة vs المرفوضة
  - متوسط زمن الرد
  - أكثر Functions استخداماً
  - أكثر Errors
  - أكثر Prompts فعالية
- **الملفات المتأثرة:**
  - `backend/utils/ai-functions.js` (دالة `getAIMetrics`)
  - `frontend/js/views/ai-metrics.js` (صفحة جديدة)
- **شجرة الارتباطات:**
  - يقرأ من: `ai_chat_history`, `ai_action_log`, `ai_feedback`
  - **لا يكتب في:** أي جدول

---

## المرحلة 31: ضمانات عدم الكسر والاختبارات (Safety & Testing) ⭐⭐⭐⭐⭐⭐⭐

### 31.1 قواعد عدم الكسر (Non-Breaking Rules)

#### قواعد صارمة لكل تعديل:
1. **لا تحذف column من جدول موجود** — أضف الجديد، لو محتاج تشيل قديم خليه deprecated لمدة ثم احذفه
2. **لا تغير نوع column موجود** — أضف column جديد بدل ما تغير القديم
3. **لا تغير اسم دالة موجودة** — أضف دالة جديدة، القديمة تظل تعمل
4. **لا تغير signature دالة موجودة** — لو محتاج parameter جديد، خليه optional
5. **كل migration جديد يجب أن يكون idempotent** — `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`
6. **كل migration جديد يجب أن يكون reversible** — اكتب UP و DOWN scripts
7. **لا تعدّل API endpoint موجود** — أضف endpoint جديد بدل ما تغير القديم
8. **لا تغير شكل JSON response موجود** — أضف fields جديدة، ما تشيلش fields قديمة

#### قواعد الـ AI خاصة:
1. **كل دالة AI جديدة يجب أن تعمل بدون أخطاء لو DB فارغ** — ترجع `[]` أو `null` مش `throw`
2. **كل إجراء AI جديد يجب أن يستخدم transaction** — `BEGIN` / `COMMIT` / `ROLLBACK`
3. **كل إجراء AI جديد يجب أن يكون idempotent** — لو اتنفذ مرتين، النتيجة تكون نفس النتيجة
4. **الـ AI ما يكتبش في جدول بدون `created_by`** — كل write يسجل منفّذه
5. **الـ AI ما يحذفش أي صف** — أبداً، تحت أي ظرف

### 31.2 اختبارات الـ AI Functions (Read-Only)

#### ملفات الاختبار:
- `backend/tests/ai-functions.test.js` — اختبار كل دالة قراءة
- `backend/tests/ai-actions.test.js` — اختبار كل إجراء تنفيذي
- `backend/tests/ai-policies.test.js` — اختبار سياسات الإجراءات
- `backend/tests/ai-assistant-route.test.js` — اختبار الـ API endpoints

#### ماذا نختبر لكل دالة قراءة:
1. **ترجع data صحيحة** — لو فيه بيانات، ترجعها بشكل صحيح
2. **ترجع `[]` لو مفيش بيانات** — ما تـthrowش error
3. **تحترم role-based access** — sales_rep ما يشوفش بيانات مستخدم تاني
4. **ترجع JSON صالح** — ما ترجعش undefined أو null في مكان مفروض فيه object
5. **تتعامل مع قيم null في DB** — لو cost_price = null، ما تـcrash

#### مثال اختبار دالة:
```javascript
describe('getSmartQuoteSuggestions', () => {
    test('returns valid suggestion when data exists', async () => {
        const result = await getSmartQuoteSuggestions({ client_id: '...', product_name: '...' }, user);
        expect(result).toHaveProperty('suggested_price');
        expect(result).toHaveProperty('confidence');
        expect(typeof result.suggested_price).toBe('number');
    });

    test('returns empty when product not found', async () => {
        const result = await getSmartQuoteSuggestions({ client_id: '...', product_name: 'غير موجود' }, user);
        expect(result.suggested_price).toBeNull();
        expect(result.error).toContain('غير موجود');
    });

    test('handles null cost_price gracefully', async () => {
        // product with cost_price = null
        const result = await getSmartQuoteSuggestions({ client_id: '...', product_name: '...' }, user);
        expect(result.cost_price).toBe(0);
        expect(result.confidence).toBeLessThan(60);
    });

    test('respects sales_rep scope', async () => {
        const result = await getSmartQuoteSuggestions({ client_id: 'other_rep_client' }, salesRepUser);
        expect(result.error).toContain('غير مصرح');
    });
});
```

### 31.3 اختبارات الـ AI Actions (Write)

#### ماذا نختبر لكل إجراء:
1. **propose() يرجع valid=false لو بيانات ناقصة** — ما يعملش execute
2. **propose() يرجع valid=true لو بيانات كاملة** — ويرجع summary صحيح
3. **execute() ينشئ السجل الصحيح** — يتأكد إن الـ INSERT حصل
4. **execute() idempotent** — لو اتنفذ مرتين، ما ينشئش سجلين
5. **execute() rollback لو فيه خطأ** — ما يترك partial data
6. **policy check قبل execute** — لو policy فشلت، ما ينفذش

#### مثال اختبار إجراء:
```javascript
describe('create_client action', () => {
    test('propose rejects missing name', async () => {
        const result = await create_client.propose({ phone: '0582...', city: 'كفر الشيخ' }, managerUser);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('الاسم');
    });

    test('propose accepts complete data', async () => {
        const result = await create_client.propose({
            name: 'مطعم كاريزما', contact_person: 'نبيل', phone: '0582...', city: 'كفر الشيخ'
        }, managerUser);
        expect(result.valid).toBe(true);
        expect(result.summary.name).toBe('مطعم كاريزما');
    });

    test('execute creates client in DB', async () => {
        const proposal = { name: 'مطعم كاريزما', phone: '0582...', ... };
        const result = await create_client.execute(proposal, managerUser);
        expect(result.client_name).toBe('مطعم كاريزما');
        // Verify in DB
        const dbCheck = await pool.query('SELECT * FROM clients WHERE name = $1', ['مطعم كاريزما']);
        expect(dbCheck.rows.length).toBe(1);
    });

    test('execute is idempotent — duplicate name rejected', async () => {
        // First execution
        await create_client.execute(proposal, managerUser);
        // Second execution with same name
        const result = await create_client.execute(proposal, managerUser);
        expect(result.success).toBe(false);
        expect(result.error).toContain('موجود');
    });

    test('sales_rep cannot execute', async () => {
        const result = await create_client.execute(proposal, salesRepUser);
        expect(result.success).toBe(false);
        expect(result.error).toContain('صلاحية');
    });
});
```

### 31.4 اختبارات الـ API Endpoints

#### ماذا نختبر:
1. **`POST /api/ai-assistant/chat`** — يرجع reply + proposed actions
2. **`POST /api/ai-assistant/propose-action`** — يرجع valid + summary + action_id
3. **`POST /api/ai-assistant/execute-action`** — يرجع success + result
4. **`GET /api/ai-assistant/health`** — يرجع status
5. **Role-based access** — sales_rep ما يقدرش يـexecute

#### مثال:
```javascript
describe('POST /api/ai-assistant/propose-action', () => {
    test('manager can propose', async () => {
        const res = await request(app)
            .post('/api/ai-assistant/propose-action')
            .set('Authorization', `Bearer ${managerToken}`)
            .send({ action_type: 'create_client', args: { name: '...' } });
        expect(res.status).toBe(200);
        expect(res.body.valid).toBe(true);
    });

    test('sales_rep cannot propose write actions', async () => {
        const res = await request(app)
            .post('/api/ai-assistant/propose-action')
            .set('Authorization', `Bearer ${salesRepToken}`)
            .send({ action_type: 'create_client', args: { name: '...' } });
        expect(res.status).toBe(403);
    });
});
```

### 31.5 اختبارات الـ Migrations

#### قواعد:
1. **كل migration جديد له اختبار** — يتأكد إن الجدول اتعمل صح
2. **اختبار idempotency** — شغل الـ migration مرتين، ما يـcrash
3. **اختبار rollback** — شغل DOWN script، يتأكد إن الجدول اتمسح صح
4. **اختبار البيانات الموجودة** — بعد migration، البيانات القديمة تفضل زي ما هي

#### مثال:
```javascript
describe('060_business_events migration', () => {
    test('creates business_events table', async () => {
        const res = await pool.query("SELECT EXISTS (SELECT FROM pg_tables WHERE tablename = 'business_events')");
        expect(res.rows[0].exists).toBe(true);
    });

    test('is idempotent — running twice does not crash', async () => {
        await runMigration('060_business_events.sql');
        await runMigration('060_business_events.sql'); // should not throw
    });

    test('has required columns', async () => {
        const res = await pool.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'business_events'
        `);
        const columns = res.rows.map(r => r.column_name);
        expect(columns).toContain('id');
        expect(columns).toContain('event_type');
        expect(columns).toContain('entity_type');
        expect(columns).toContain('entity_id');
        expect(columns).toContain('created_at');
    });
});
```

### 31.6 اختبارات الـ Frontend

#### ماذا نختبر:
1. **بطاقة المراجعة تعرض البيانات صحيحة** — لكل action_type
2. **زر "تأكيد التنفيذ" يرسل action_id صحيح**
3. **رسالة النجاح تعرض التفاصيل**
4. **رسالة الخطأ تعرض السبب**
5. **أزرار 👍👎 ترسل feedback**
6. **زر "ليه؟" يعرض explanation**

#### الأداة:
- استخدام **Playwright** أو **Cypress** لاختبار E2E
- ملف: `frontend/tests/ai-assistant.spec.js`

### 31.7 استراتيجية الـ Rollback

#### لو حصل كسر بعد deploy:
1. **DB Rollback:** كل migration له DOWN script
   ```bash
   npm run migrate:down -- --file=060_business_events.sql
   ```
2. **Code Rollback:** `git revert <commit>` — يرجع الكود للنسخة السابقة
3. **AI-specific Rollback:** لو إجراء AI عمل مشكلة:
   - الـ `ai_action_log` يسجل كل إجراء
   - لو إجراء عمل write غلط، نقدر نحدد الصف المتأثر ونعدّله يدوياً
   - لو migration أضاف column غلط، DOWN script يشيله

#### Rollback Plan لكل مرحلة:
| المرحلة | Rollback |
|---------|----------|
| Event Bus (6) | DROP TABLE business_events + إزالة eventBus.emit() من routes |
| Memory (5) | DROP TABLE conversation_context + إزالة conversation_id |
| Auditor (10) | إزالة دالة getAuditReport من FUNCTION_MAP |
| Policies (20) | DROP TABLE action_policies + إزالة policyCheck من execute |
| Explainability (22) | إزالة explanation field من الدوال (backward compatible) |

### 31.8 Pre-Deployment Checklist

#### قبل كل deploy:
- [ ] `npm test` يعدّي بدون أخطاء
- [ ] `npm run migrate:up` يعدّي بدون أخطاء
- [ ] الـ AI health check يرجع `enabled: true`
- [ ] لا يوجد console.error في الـ logs
- [ ] لا يوجد unhandled promise rejection
- [ ] كل الـ endpoints القديمة تفضل شغالة
- [ ] كل الـ functions القديمة تفضل شغالة
- [ ] الـ frontend يفتح بدون أخطاء في console
- [ ] cache-buster محدّث في index.html
- [ ] git push نجح

### 31.9 مراقبة مستمرة بعد Deploy

#### لو حصل خطأ بعد deploy:
1. **Log monitoring:** فحص `backend-1.log` كل ساعة أول 24 ساعة
2. **Error rate:** لو > 5% من الطلبات ترجع 500 → rollback فوري
3. **AI error rate:** لو > 10% من محادثات الـ AI ترجع error → rollback الـ prompt
4. **User feedback:** لو فيه شكاوى من المستخدمين → تحقيق فوري

### 31.10 ترتيب تنفيذ الاختبارات

| الأولوية | الاختبار | المدة |
|----------|---------|-------|
| 1 | اختبارات الـ AI Actions الموجودة (create_client, create_quote, etc.) | فوري |
| 2 | اختبارات الـ AI Functions الموجودة (getSmartQuoteSuggestions, etc.) | فوري |
| 3 | اختبارات الـ API endpoints (chat, propose, execute) | فوري |
| 4 | اختبارات الـ migrations الجديدة (مع كل migration جديد) | مع كل مرحلة |
| 5 | اختبارات الـ frontend (Playwright) | بعد Phase 1-5 |
| 6 | اختبارات الـ policies (مع Phase 20) | مع Phase 20 |
| 7 | اختبارات الـ explainability (مع Phase 22) | مع Phase 22 |

### 31.11 ملفات الاختبار المطلوبة

```
backend/tests/
├── ai-functions.test.js          — كل دوال القراءة
├── ai-actions.test.js            — كل الإجراءات التنفيذية
├── ai-policies.test.js           — سياسات الإجراءات
├── ai-assistant-route.test.js    — API endpoints
├── migrations.test.js            — كل الـ migrations
├── helpers/
│   ├── test-db.js                — إعداد DB اختبار
│   ├── test-data.js              — بيانات اختبار جاهزة
│   └── mock-user.js              — مستخدمين وهميين (manager, sales_rep)
└── jest.config.js                — إعدادات Jest

frontend/tests/
├── ai-assistant.spec.js          — اختبار E2E للواجهة
└── playwright.config.js          — إعدادات Playwright
```
