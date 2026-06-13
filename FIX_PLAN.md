# G.PACK 2.0 - خطة الإصلاح الشاملة (مرحلية)

> **الهدف:** إصلاح جميع المشاكل الحرجة والعالية بشكل تدريجي ومنظم
> **التسلسل:** P0 → P1 → P2 → P3

---

## المرحلة 0: إصلاحات فورية (P0 - Critical)

### [x] 0.1 منع إدخال Financial Fields في أوامر VMI
**السبب:** `orders.js` POST/PUT كان يدخل `subtotal`, `tax_amount`, `grand_total` في كل مرة
**الملف:** `backend/routes/orders.js`
**الإنجاز:** تم إضافة منطق يتحقق من نوع الأمر ويمنع إدخال الحقول المالية لأوامر VMI

### [x] 0.2 ربط Dashboard بـ API حقيقي
**السبب:** Dashboard كان يُعتقد أنه وهمي
**الواقع:** الـ API موجود ويعمل فعلياً (`/api/dashboard/stats`) والـ frontend يستهلكه. تم التحقق من الكود.

---

## المرحلة 1: مشاكل عالية (P1 - High)

### [x] 1.1 توحيد Authorization Middleware
**السبب:** كل route يفحص الصلاحيات يدوياً
**الملف:** `backend/middleware/authorize.js`
**الإنجاز:** تم إنشاء Middleware موحد يدعم الصلاحيات بناءً على الأدوار والموارد.

### [x] 1.2 إضافة Release Order API
**السبب:** لا يمكن فسح المخزون
**الواقع:** الـ API موجود بالفعل في `backend/routes/orders.js` تحت مسار `POST /api/orders/:id/release`.

### [x] 1.3 إصلاح CORS_ORIGIN
**الملف:** `backend/server.js` + `.env.example`
**الإنجاز:** تم تعيين قيمة افتراضية آمنة (`http://localhost`) ومنع استخدام `'*'` في `server.js`.

### [x] 1.4 إضافة CHECK constraint على `orders.status`
**الملف:** `backend/migrations/001_add_orders_status_check.sql`
**الإنجاز:** تم إنشاء ملف Migration لإضافة القيد على قاعدة البيانات.

---

## المرحلة 2: إكمال دورة Delivery + Invoice (P1 - High)

### [x] 2.1 Delivery Notes UI (vmi-dispatch.html)
**الملف:** `frontend/views/vmi-dispatch.html` + `frontend/js/views/vmi-dispatch.js`
**الواقع:** الـ Frontend موجود فعلياً (سندات التسليم) مع Backend كامل (`backend/routes/delivery-notes.js`) يشمل إنشاء/تعديل/تأكيد/ديسباتش وحذف.

### [x] 2.2 Sales Invoices UI (sales-invoices.html + sales-invoice-detail.html)
**الملف:** `frontend/views/sales-invoices.html` + `frontend/views/sales-invoice-detail.html` + `backend/routes/invoices.js`
**الواقع:** الواجهة والـ API موجودان — GET/POST مع أصناف وعملاء.

### [x] 2.3 Auto-generate Invoice من Order
**الملف:** `backend/routes/orders.js` + `backend/routes/invoices.js`
**الواقع:** `POST /api/orders/:id/invoice` ينشئ فاتورة من الأمر مباشرة مع حساب الضريبة والتكاليف.

---

## المرحلة 3: مشاكل متوسطة (P2 - Medium)

### [x] 3.1 إضافة API Versioning
**الملف:** `backend/server.js`
**الإنجاز:** تم إضافة دالة `_mountRoute()` لتسجيل كل route تحت `/api` و `/api/v1/` معاً للتوافق العكسي

### [x] 3.2 إضافة Audit Trail
**الملف:** `backend/migrations/002_add_audit_logs.sql` + `backend/middleware/audit.js`
**الإنجاز:** تم إنشاء جدول `audit_logs` في قاعدة البيانات و Middleware (`audit.log` و `audit.wrap`) لتسجيل CUD operations تلقائياً

### [x] 3.3 إصلاح Stock Adjustment (Inventory Transactions)
**الملف:** `backend/routes/inventory.js`
**الإنجاز:** تم إصلاح `transaction_type` في batch adjustment (كان 'receipt' ثابت، الآن يتغير حسب نوع التعديل) وإصلاح `available_qty` ليكون `quantity - reserved_qty` بدلاً من `quantity`.

### [x] 3.4 إضافة Invoice Statuses API
**الملف:** `backend/routes/invoices.js`
**الإنجاز:** تم إنشاء `PATCH /api/invoices/:id/status` مع التحقق من الحالات المسموحة وإنشاء إيصال تلقائي عند الدفع

---

## المرحلة 4: مشاكل منخفضة (P3 - Low)

### [x] 4.1 تنظيف Sidebar من العناصر المعلقة
**الملف:** `frontend/js/layout.js`
**الإنجاز:** تم إزالة العناصر المعلقة (`sales-returns`, `receipt-vouchers`, `delivery-vouchers`) من تعريف NAV_ITEMS

### [x] 4.2 إصلاح seed-demo.js
**الملف:** `backend/seed-demo.js`
**الإنجاز:** تم إضافة جلب `admin@gpack.com` user ID وتمريره كـ `created_by` عند إدخال المنتجات

### [x] 4.3 إضافة `created_by` في GET endpoints الناقصة
**الملف:** `backend/routes/products.js`
**الإنجاز:** تم إنشاء migration (`003_add_products_created_by.sql`) لإضافة العمود، وتحديث `GET /api/products` و `GET /api/products/:id` و `POST /api/products` ليشمل `created_by` مع `LEFT JOIN users` لجلب الاسم

---

## المرحلة 5: تحسينات (Enhancements)

### [ ] 5.1 إضافة Dashboard Real API
**الملف:** `backend/routes/dashboard.js`
**الحل:** API يعيد إحصائيات حقيقية من DB (إجمالي المبيعات، عدد الأوامر، المخزون المنخفض، إلخ)

### [ ] 5.2 إعدادات SSL/TLS لـ Nginx
**الملف:** `nginx/nginx.conf`
**الحل:** إضافة HTTPS مع Let's Encrypt

### [ ] 5.3 Backup Automation
**الملف:** `docker-compose.yml` + Script في `/backups`
**الحل:** Script آلي لأخذ نسخة احتياطية يومية من PostgreSQL

---

## الجدول الزمني المقترح

| المرحلة | الوقت المقدر | الأولوية |
|---------|-------------|----------|
| 0 - إصلاحات فورية | يوم واحد | 🔴 فوري |
| 1 - مشاكل عالية | 2-3 أيام | 🟡 عاجل |
| 2 - Delivery + Invoice | 3-5 أيام | 🟡 عاجل |
| 3 - مشاكل متوسطة | 2-3 أيام | 🟢 مهم |
| 4 - مشاكل منخفضة | يوم واحد | ⚪ تحسين |
| 5 - تحسينات | 2-3 أيام | 🔵 إضافي |

---

> ملاحظة: سيتم تنفيذ هذه الخطة خطوة بخطوة، كل خطوة سيتم عرضها للموافقة والاختبار قبل الانتقال للتي تليها.