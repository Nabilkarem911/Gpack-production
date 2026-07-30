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
  1. تحليل سجل الدفعات من `payments` (متأخر ولا ملتزم؟)
  2. متوسط المشتريات الشهرية من `orders` + `invoices`
  3. الرصيد الحالي = `invoices.grand_total - invoices.paid_amount`
  4. مقارنة بـ `clients.credit_limit`
  5. توصية: آمن / احذر / ممنوع
- **الملفات المتأثرة:** `backend/utils/ai-functions.js` (دالة جديدة `getCreditRiskAssessment`)
- **شجرة الارتباطات:**
  - يقرأ من: `clients` (credit_limit, status)
  - يقرأ من: `invoices` (grand_total, paid_amount, invoice_date)
  - يقرأ من: `payments` (amount, payment_date, created_at)
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
  1. مقارنة أسعار الموردين لنفس المنتج من `supplier_pricing`
  2. تحليل جودة التسليم من `purchase_orders` (نسبة التسليم في الموعد)
  3. اقتراح أفضل مورد بناءً على السعر + الجودة
- **الملفات المتأثرة:** `backend/utils/ai-functions.js` (دوال جديدة)
- **شجرة الارتباطات:**
  - يقرأ من: `supplier_pricing` (supplier_id, variant_id, price)
  - يقرأ من: `purchase_orders` + `purchase_order_items` (delivery_date vs expected_date)
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
  - يقرأ من: `orders`, `order_items`, `invoices`, `payments`, `clients`, `products`
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
| `payments` | الدفعات | `order_id` → `orders.id` |
| `warehouse_stock` | المخزون | `client_id` → `clients.id`, `variant_id` → `product_variants.id` |
| `inventory_transactions` | حركات المخزون | `stock_id` → `warehouse_stock.id` |
| `suppliers` | الموردين | — |
| `supplier_pricing` | أسعار الموردين | `supplier_id` → `suppliers.id`, `variant_id` → `product_variants.id` |
| `purchase_orders` | أوامر الشراء | `supplier_id` → `suppliers.id` |
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
| `payments` | add_payment | order_id, amount, payment_method, payment_date |
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
  - يقرأ من: `invoices` + `payments` (كاش متوقع)
  - يقرأ من: `warehouse_stock` + `inventory_transactions` (مخزون)
  - يقرأ من: `production_orders` (إنتاج)
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
| 1 | تحرير البيانات قبل التنفيذ (1.1) | متوسط | عالية |
| 2 | Business Event Bus (6.1) | متوسط | عالية جداً |
| 3 | ذاكرة المحادثة (5.1) | متوسط | عالية جداً |
| 4 | AI Auditor (10.1) | متوسط | عالية جداً |
| 5 | لوحة الصباح التلقائية (8.1) | متوسط | عالية |
| 6 | تحليل تنبؤي للمخزون (2.1) | متوسط | عالية |
| 7 | تقييم مخاطر الائتمان (2.2) | متوسط | عالية |
| 8 | التحليل السببي (7.1) | متوسط | عالية |
| 9 | محرك القرارات (9.1) | متوسط | عالية |
| 10 | تقارير ذكية في الشات (3.1) | متوسط | عالية |
| 11 | تصنيف العملاء (2.3) | متوسط | متوسطة |
| 12 | ذاكرة الأعمال (5.2) | متوسط | متوسطة |
| 13 | التعلم من الشركة (12.1) | عالي | متوسطة |
| 14 | مخطط الأعمال (11.1) | عالي | متوسطة |
| 15 | توقع شامل (13.1) | متوسط | متوسطة |
| 16 | سلاسل إجراءات (1.3) | عالي | متوسطة |
| 17 | قوالب متكررة (2.4) | عالي | متوسطة |
| 18 | تكامل WhatsApp (4.1) | عالي | عالية |
| 19 | مساعد صوتي (4.2) | عالي | متوسطة |
