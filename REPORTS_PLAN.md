# G.PACK 2.0 — صفحة التقارير الشاملة (خطة التنفيذ)

## المعايير الصارمة
- **لا تبسيط** — كل ميزة كاملة وتُختبر قبل الانتقال للتالية
- **لا كسر في الكود** — كل تعديل يجب أن يحافظ على عمل النظام الحالي
- **اختبار كل خاصية** — بعد كل ميزة، تحقق بصرياً + API + console
- **RAW SQL فقط** — عبر `pg` pool، لا ORMs
- **Vanilla JS + Tailwind** — لا React/Vue
- **التزامن** — كل تعديل backend + frontend + sidebar

---

## البنية التقنية المطلوبة

### الملفات الجديدة
| الملف | النوع | الوصف |
|------|------|------|
| `frontend/views/reports.html` | HTML | صفحة التقارير الرئيسية (تبويبات) |
| `frontend/js/views/reports.js` | JS | متحكم صفحة التقارير |
| `backend/routes/reports.js` | Backend | API endpoints للتقارير |

### الملفات المعدلة
| الملف | التعديل |
|------|---------|
| `frontend/js/layout.js` | إضافة `reports` لـ `NAV_ITEMS` |
| `backend/app.js` أو `backend/server.js` | تسجيل route جديد `/api/reports` |

### المكتبات الخارجية (CDN)
| المكتبة | الاستخدام |
|---------|----------|
| Chart.js | رسوم بيانية (line, bar, pie, doughnut) |
| SheetJS (xlsx) | تصدير Excel |
| jsPDF + autotable | تصدير PDF |

---

## تبويبات صفحة التقارير

```
صفحة التقارير
├── 📊 لوحة المؤشرات (KPIs Dashboard)
├── 💰 المالية والأرباح
│   ├── قائمة الدخل (P&L)
│   ├── تحليل الربحية
│   ├── التدفقات النقدية
│   └── ضريبة القيمة المضافة
├── 📈 المبيعات وعروض الأسعار
│   ├── تقرير المبيعات
│   ├── تحليل العروض
│   └── سلوك العملاء
├── 🏭 الإنتاج والموردين
│   ├── أداء الموردين
│   ├── حالة الإنتاج
│   └── زمن دورة الإنتاج
├── 📦 المخزون و VMI
│   ├── قيمة المخزون
│   ├── حركة المخزون
│   └── تنبيهات المخزون
├── 🎨 التصميم والجودة
│   ├── إنتاجية المصمم
│   └── معدل الاعتماد
└── 📋 تقارير مخصصة (مرحلة لاحقة)
```

---

## المرحلة 1 — الأساس والبنية التحتية

### 1.1 إنشاء Backend Route أساسي
**ملف:** `backend/routes/reports.js`
- إنشاء Express router
- Middleware: `authenticate` + `authorize` (صلاحية `reports`)
- Helper functions مشتركة:
  - `_parseDateRange(req)` — تحليل from/to من query params
  - `_formatCurrency(amount)` — تنسيق المبالغ
  - `_safeQuery(client, query, params)` — تنفيذ آمن مع error handling

**تسجيل Route:**
- في `backend/app.js` أو `server.js`: `app.use('/api/reports', require('./routes/reports'))`

**اختبار 1.1:**
- `GET /api/reports/health` → 200 OK
- التحقق من أن الـ route محمي بـ authenticate

### 1.2 إنشاء Frontend View أساسي
**ملف:** `frontend/views/reports.html`
- هيكل الصفحة: Header + Tab Bar + Content Area
- Date Range Picker (اليوم / هذا الأسبوع / هذا الشهر / هذا الربع / هذا العام / مخصص)
- أزرار تصدير (Excel / PDF / طباعة) — مخفية حتى تحميل البيانات
- منطقة عرض البيانات (جداول + رسوم بيانية)

**ملف:** `frontend/js/views/reports.js`
- IIFE closure (مثل باقي views)
- State: `_activeTab`, `_dateRange`, `_data`
- `_init()` — تهيئة الصفحة وتحميل أول تبويب
- `_switchTab(tabName)` — تبديل التبويبات
- `_loadData()` — تحميل البيانات حسب التبويب النشط
- `_renderKPIs()` / `_renderChart()` / `_renderTable()`
- `_exportExcel()` / `_exportPDF()` / `_printReport()`

### 1.3 إضافة للـ Sidebar
**ملف:** `frontend/js/layout.js`
- إضافة قسم جديد "التقارير" في `NAV_ITEMS`
- `{ view: 'reports', label: 'التقارير', icon: 'fa-chart-pie', permission: 'reports' }`
- وضعه قبل قسم "الإدارة"

**اختبار 1.3:**
- ظهور "التقارير" في الـ sidebar
- النقر عليها يفتح صفحة فارغة بالهيكل
- التحقق من صلاحية الوصول

---

## المرحلة 2 — لوحة المؤشرات (KPIs Dashboard)

### 2.1 Backend: `GET /api/reports/kpis`
**ملف:** `backend/routes/reports.js`

**Query params:** `?from=YYYY-MM-DD&to=YYYY-MM-DD`

**SQL Queries مطلوبة:**

```sql
-- 1. إجمالي المبيعات (orders بـ status != quote/draft/cancelled)
SELECT COALESCE(SUM(grand_total), 0) AS total_sales
FROM orders
WHERE status NOT IN ('quote', 'draft', 'cancelled')
  AND order_date BETWEEN $1 AND $2;

-- 2. أوامر التشغيل النشطة (count + value)
SELECT COUNT(*) AS active_count, COALESCE(SUM(grand_total), 0) AS active_value
FROM orders
WHERE status IN ('production', 'processing')
  AND order_date BETWEEN $1 AND $2;

-- 3. مستحقات العملاء (grand_total - paid_amount)
SELECT COALESCE(SUM(grand_total - paid_amount), 0) AS outstanding
FROM orders
WHERE status NOT IN ('quote', 'draft', 'cancelled')
  AND grand_total IS NOT NULL
  AND (grand_total - paid_amount) > 0;

-- 4. متوسط زمن التسليم (من order_date إلى delivered_at في delivery_notes)
SELECT AVG(EXTRACT(EPOCH FROM (dn.delivered_at - o.order_date)) / 86400)::numeric(10,1) AS avg_delivery_days
FROM delivery_notes dn
JOIN orders o ON o.id = dn.order_id
WHERE dn.status = 'completed'
  AND dn.delivered_at IS NOT NULL
  AND o.order_date BETWEEN $1 AND $2;

-- 5. معدل اكتمال الإنتاج
SELECT
  COUNT(*) FILTER (WHERE status = 'completed') AS completed,
  COUNT(*) FILTER (WHERE status IN ('production', 'processing')) AS in_progress,
  COUNT(*) AS total
FROM orders
WHERE status NOT IN ('quote', 'draft', 'cancelled')
  AND order_date BETWEEN $1 AND $2;

-- 6. قيمة المخزون الحالي
SELECT COALESCE(SUM(ws.quantity * pv.cost_price), 0) AS stock_value
FROM warehouse_stock ws
JOIN product_variants pv ON pv.id = ws.variant_id
WHERE ws.quantity > 0;

-- 7. عدد العروض المحولة (quote → confirmed/production)
SELECT
  COUNT(*) FILTER (WHERE status = 'quote') AS total_quotes,
  COUNT(*) FILTER (WHERE status IN ('confirmed', 'production', 'processing', 'completed', 'delivered')) AS converted
FROM orders
WHERE order_date BETWEEN $1 AND $2;

-- 8. إجمالي التحصيلات (receipt_vouchers)
SELECT COALESCE(SUM(amount), 0) AS total_collected
FROM receipt_vouchers
WHERE receipt_date BETWEEN $1 AND $2;

-- 9. إجمالي المدفوعات للموردين (payment_vouchers)
SELECT COALESCE(SUM(amount), 0) AS total_paid
FROM payment_vouchers
WHERE payment_date BETWEEN $1 AND $2;
```

**Response shape:**
```json
{
  "data": {
    "total_sales": 125000.00,
    "active_orders_count": 15,
    "active_orders_value": 45000.00,
    "outstanding_receivables": 32000.00,
    "avg_delivery_days": 7.5,
    "production_completion_rate": 65.0,
    "stock_value": 89000.00,
    "quote_conversion_rate": 42.0,
    "total_collected": 95000.00,
    "total_paid_to_suppliers": 67000.00
  }
}
```

### 2.2 Frontend: عرض KPIs
**ملف:** `frontend/js/views/reports.js`

- 8 بطاقات KPI في grid (4×2 على desktop, 2×4 على tablet, 1×8 على mobile)
- كل بطاقة: أيقونة + قيمة + label + trend indicator (أخضر/أحمر)
- تحميل البيانات عند فتح الصفحة + عند تغيير Date Range
- Chart.js: doughnut chart لتوزيع حالة الإنتاج

**اختبار 2.2:**
- فتح صفحة التقارير → KPIs تُحمّل تلقائياً
- تغيير Date Range → KPIs تتحدث
- التحقق من القيم مقابل DB مباشرة
- التحقق من responsive (mobile/tablet/desktop)

---

## المرحلة 3 — المالية والأرباح

### 3.1 قائمة الدخل (P&L Statement)
**Backend:** `GET /api/reports/profit-loss?from=&to=`

```sql
-- الإيرادات
SELECT COALESCE(SUM(o.grand_total - o.tax_amount), 0) AS revenue
FROM orders o
WHERE o.status NOT IN ('quote', 'draft', 'cancelled')
  AND o.order_date BETWEEN $1 AND $2
  AND o.grand_total IS NOT NULL;

-- تكلفة البضاعة المباعة (COGS) — من manufacturer_orders
SELECT COALESCE(SUM(moi.total_cost), 0) AS cogs
FROM manufacturer_order_items moi
JOIN manufacturer_orders mo ON mo.id = moi.manufacturer_order_id
WHERE mo.status NOT IN ('cancelled')
  AND mo.created_at BETWEEN $1 AND $2;

-- مصاريف إضافية (invoice_expenses)
SELECT COALESCE(SUM(amount), 0) AS additional_expenses
FROM invoice_expenses ie
JOIN invoices i ON i.id = ie.invoice_id
WHERE i.invoice_date BETWEEN $1 AND $2;

-- ضريبة القيمة المضافة المحصلة
SELECT COALESCE(SUM(tax_amount), 0) AS vat_collected
FROM orders
WHERE status NOT IN ('quote', 'draft', 'cancelled')
  AND order_date BETWEEN $1 AND $2
  AND tax_amount IS NOT NULL;

-- ضريبة القيمة المضافة المدفوعة
SELECT COALESCE(SUM(tax_amount), 0) AS vat_paid
FROM purchase_invoices
WHERE invoice_date BETWEEN $1 AND $2;
```

**Response:**
```json
{
  "data": {
    "revenue": 100000,
    "cogs": 60000,
    "gross_profit": 40000,
    "gross_margin_pct": 40.0,
    "additional_expenses": 5000,
    "net_profit": 35000,
    "net_margin_pct": 35.0,
    "vat_collected": 15000,
    "vat_paid": 9000,
    "vat_net": 6000
  }
}
```

**Frontend:**
- جدول P&L مرتب هرمياً (الإيرادات → COGS → إجمالي الربح → مصاريف → صافي الربح)
- مقارنة مع الفترة السابقة (نسبة التغيير ↑/↓)
- Chart.js: bar chart مقارنة الإيرادات vs COGS vs صافي الربح

**اختبار 3.1:**
- التحقق من الإيرادات مقابل `orders` table
- التحقق من COGS مقابل `manufacturer_order_items`
- التحقق من حساب الهوامش (gross_profit = revenue - cogs)
- التحقق من VAT (collected - paid)

### 3.2 تحليل الربحية
**Backend:** `GET /api/reports/profitability?from=&to=&group_by=order|client|product|supplier`

```sql
-- الربح لكل أمر
SELECT
  o.id, o.order_number,
  o.client_id, c.name AS client_name,
  COALESCE(o.grand_total - o.tax_amount, 0) AS revenue,
  COALESCE(cogs.total_cost, 0) AS cogs,
  COALESCE(o.grand_total - o.tax_amount, 0) - COALESCE(cogs.total_cost, 0) AS gross_profit,
  CASE
    WHEN o.grand_total IS NULL OR o.grand_total = 0 THEN 0
    ELSE ROUND(((o.grand_total - o.tax_amount - COALESCE(cogs.total_cost, 0)) / NULLIF(o.grand_total - o.tax_amount, 0)) * 100, 1)
  END AS margin_pct
FROM orders o
LEFT JOIN clients c ON c.id = o.client_id
LEFT JOIN (
  SELECT mo.order_id, SUM(moi.total_cost) AS total_cost
  FROM manufacturer_orders mo
  JOIN manufacturer_order_items moi ON moi.manufacturer_order_id = mo.id
  WHERE mo.status NOT IN ('cancelled')
  GROUP BY mo.order_id
) cogs ON cogs.order_id = o.id
WHERE o.status NOT IN ('quote', 'draft', 'cancelled')
  AND o.order_date BETWEEN $1 AND $2
ORDER BY gross_profit DESC;
```

**Frontend:**
- فلتر group_by: أمر / عميل / منتج / مورد
- جدول قابل للفرز (انقر على عمود للفرز)
- صفوف خاسرة (margin < 0) بخلفية حمراء
- Chart.js: bar chart لأعلى 10 أرباح

**اختبار 3.2:**
- التحقق من حساب الربح لأمر معين يدوياً
- التحقق من الفرز
- التحقق من تمييز الأوامر الخاسرة

### 3.3 التدفقات النقدية (Cash Flow)
**Backend:** `GET /api/reports/cash-flow?from=&to=`

```sql
-- نقد داخل (تحصيلات)
SELECT 'inflow' AS direction, rv.receipt_date AS date, rv.amount, rv.payment_method, c.name AS client_name
FROM receipt_vouchers rv
LEFT JOIN clients c ON c.id = rv.client_id
WHERE rv.receipt_date BETWEEN $1 AND $2
UNION ALL
-- نقد خارج (مدفوعات)
SELECT 'outflow' AS direction, pv.payment_date AS date, pv.amount, pv.payment_method, s.company_name AS supplier_name
FROM payment_vouchers pv
LEFT JOIN suppliers s ON s.id = pv.supplier_id
WHERE pv.payment_date BETWEEN $1 AND $2
ORDER BY date DESC;
```

**Frontend:**
- جدول زمني للحركات (داخل/خارج)
- Chart.js: line chart للتدفق التراكمي
- ملخص: إجمالي داخل + إجمالي خارج + صافي

**اختبار 3.3:**
- التحقق من المجاميع مقابل receipt_vouchers و payment_vouchers
- التحقق من الترتيب الزمني

### 3.4 تقرير ضريبة القيمة المضافة
**Backend:** `GET /api/reports/vat?from=&to=`

```sql
-- VAT محصلة من المبيعات
SELECT
  'sales' AS source,
  o.order_number AS doc_number,
  o.order_date AS doc_date,
  c.name AS party_name,
  o.subtotal,
  o.tax_amount,
  o.grand_total
FROM orders o
JOIN clients c ON c.id = o.client_id
WHERE o.status NOT IN ('quote', 'draft', 'cancelled')
  AND o.tax_amount IS NOT NULL
  AND o.order_date BETWEEN $1 AND $2

UNION ALL

-- VAT مدفوعة للمشتريات
SELECT
  'purchases' AS source,
  pi.invoice_number::text AS doc_number,
  pi.invoice_date AS doc_date,
  s.company_name AS party_name,
  pi.subtotal,
  pi.tax_amount,
  pi.grand_total
FROM purchase_invoices pi
JOIN suppliers s ON s.id = pi.supplier_id
WHERE pi.tax_amount IS NOT NULL
  AND pi.invoice_date BETWEEN $1 AND $2
ORDER BY doc_date;
```

**Frontend:**
- جدولين: المبيعات (VAT محصلة) + المشتريات (VAT مدفوعة)
- ملخص: إجمالي محصلة + إجمالي مدفوعة = صافي المستحق للهيئة
- زر تصدير PDF (مهم للتقديم الضريبي)

**اختبار 3.4:**
- التحقق من VAT محصلة مقابل orders
- التحقق من VAT مدفوعة مقابل purchase_invoices
- التحقق من صافي VAT

---

## المرحلة 4 — المبيعات وعروض الأسعار

### 4.1 تقرير المبيعات
**Backend:** `GET /api/reports/sales?from=&to=&group_by=day|week|month|client|product`

```sql
-- المبيعات حسب الشهر
SELECT
  TO_CHAR(o.order_date, 'YYYY-MM') AS period,
  COUNT(*) AS order_count,
  COALESCE(SUM(o.subtotal), 0) AS subtotal,
  COALESCE(SUM(o.tax_amount), 0) AS tax,
  COALESCE(SUM(o.grand_total), 0) AS total
FROM orders o
WHERE o.status NOT IN ('quote', 'draft', 'cancelled')
  AND o.order_date BETWEEN $1 AND $2
GROUP BY TO_CHAR(o.order_date, 'YYYY-MM')
ORDER BY period;

-- المبيعات حسب العميل
SELECT
  c.id, c.name AS client_name,
  COUNT(o.id) AS order_count,
  COALESCE(SUM(o.grand_total), 0) AS total_sales,
  COALESCE(SUM(o.paid_amount), 0) AS total_paid,
  COALESCE(SUM(o.grand_total - o.paid_amount), 0) AS outstanding
FROM clients c
LEFT JOIN orders o ON o.client_id = c.id
  AND o.status NOT IN ('quote', 'draft', 'cancelled')
  AND o.order_date BETWEEN $1 AND $2
GROUP BY c.id, c.name
HAVING COUNT(o.id) > 0
ORDER BY total_sales DESC;

-- المبيعات حسب المنتج
SELECT
  pv.id, p.name AS product_name, pv.size_name AS variant,
  SUM(oi.quantity) AS qty_sold,
  SUM(oi.line_total) AS revenue
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN product_variants pv ON pv.id = oi.variant_id
JOIN products p ON p.id = pv.product_id
WHERE o.status NOT IN ('quote', 'draft', 'cancelled')
  AND o.order_date BETWEEN $1 AND $2
GROUP BY pv.id, p.name, pv.size_name
ORDER BY revenue DESC
LIMIT 50;
```

**Frontend:**
- تبديل group_by (يومي/أسبوعي/شهري/عميل/منتج)
- Chart.js: area chart للزمني، bar chart للعملاء/المنتجات
- جدول تفصيلي قابل للفرز
- مقارنة فترات (هذا الشهر vs الشهر الماضي)

**اختبار 4.1:**
- التحقق من المجاميع
- التحقق من التبديل بين group_by
- التحقق من الرسوم البيانية

### 4.2 تحليل العروض
**Backend:** `GET /api/reports/quotations?from=&to=`

```sql
-- إحصائيات العروض
SELECT
  COUNT(*) AS total_quotes,
  COUNT(*) FILTER (WHERE status = 'quote') AS pending,
  COUNT(*) FILTER (WHERE status = 'quote' AND valid_until < CURRENT_DATE) AS expired,
  COUNT(*) FILTER (WHERE client_response = 'approved') AS approved,
  COUNT(*) FILTER (WHERE client_response = 'rejected') AS rejected,
  COUNT(*) FILTER (WHERE status IN ('confirmed', 'production', 'processing', 'completed', 'delivered')) AS converted,
  COALESCE(AVG(grand_total), 0) AS avg_quote_value,
  COALESCE(AVG(grand_total) FILTER (WHERE status IN ('confirmed', 'production', 'processing', 'completed', 'delivered')), 0) AS avg_converted_value
FROM orders
WHERE order_date BETWEEN $1 AND $2;

-- زمن اتخاذ القرار
SELECT
  AVG(EXTRACT(EPOCH FROM (responded_at - created_at)) / 86400)::numeric(10,1) AS avg_decision_days
FROM orders
WHERE responded_at IS NOT NULL
  AND order_date BETWEEN $1 AND $2;
```

**Frontend:**
- بطاقات إحصائية (إجمالي/معلق/منتهي/موافق/مرفوض/محول)
- Chart.js: funnel chart (عروض → موافق → محول)
- جدول العروض المنتهية بدون رد

**اختبار 4.2:**
- التحقق من العدد الإجمالي للعروض
- التحقق من معدل التحويل

### 4.3 سلوك العملاء
**Backend:** `GET /api/reports/client-behavior?from=&to=`

```sql
-- أفضل العملاء
SELECT
  c.id, c.name,
  COUNT(DISTINCT o.id) AS order_count,
  COALESCE(SUM(o.grand_total), 0) AS total_spent,
  COALESCE(AVG(o.grand_total), 0) AS avg_order_value,
  MIN(o.order_date) AS first_order,
  MAX(o.order_date) AS last_order
FROM clients c
JOIN orders o ON o.client_id = c.id
WHERE o.status NOT IN ('quote', 'draft', 'cancelled')
  AND o.order_date BETWEEN $1 AND $2
GROUP BY c.id, c.name
ORDER BY total_spent DESC
LIMIT 20;

-- عملاء غير نشطين
SELECT c.id, c.name, c.phone, MAX(o.order_date) AS last_order_date,
  EXTRACT(DAY FROM NOW() - MAX(o.order_date))::int AS days_inactive
FROM clients c
LEFT JOIN orders o ON o.client_id = c.id
  AND o.status NOT IN ('quote', 'draft', 'cancelled')
WHERE c.status = 'active'
GROUP BY c.id, c.name, c.phone
HAVING MAX(o.order_date) IS NULL OR MAX(o.order_date) < NOW() - INTERVAL '90 days'
ORDER BY days_inactive DESC;
```

**Frontend:**
- جدول أفضل 20 عميل
- جدول العملاء غير النشطين (90+ يوم)
- Chart.js: bar chart لأعلى العملاء

**اختبار 4.3:**
- التحقق من ترتيب العملاء
- التحقق من حساب days_inactive

---

## المرحلة 5 — الإنتاج والموردين

### 5.1 أداء الموردين
**Backend:** `GET /api/reports/supplier-performance?from=&to=`

```sql
SELECT
  s.id, s.company_name,
  COUNT(mo.id) AS total_orders,
  COUNT(mo.id) FILTER (WHERE mo.status = 'received') AS completed,
  COUNT(mo.id) FILTER (WHERE mo.status = 'sent') AS in_production,
  COUNT(mo.id) FILTER (WHERE mo.status = 'partially_received') AS partial,
  COALESCE(SUM(mo.total_cost), 0) AS total_cost,
  COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(mo.updated_at, NOW()) - mo.created_at)) / 86400)::numeric(10,1), 0) AS avg_lead_time_days
FROM suppliers s
LEFT JOIN manufacturer_orders mo ON mo.manufacturer_id = s.id
  AND mo.status NOT IN ('cancelled')
  AND mo.created_at BETWEEN $1 AND $2
GROUP BY s.id, s.company_name
HAVING COUNT(mo.id) > 0
ORDER BY total_orders DESC;
```

**Frontend:**
- جدول أداء الموردين (عدد أوامر / مكتمل / جاري / متوسط زمن التسليم)
- Chart.js: bar chart مقارنة الموردين
- تحديد الموردين المتأخرين (avg_lead_time > threshold)

**اختبار 5.1:**
- التحقق من عدد أوامر كل مورد
- التحقق من متوسط زمن التسليم

### 5.2 حالة الإنتاج
**Backend:** `GET /api/reports/production-status?from=&to=`

```sql
SELECT
  status,
  COUNT(*) AS count,
  COALESCE(SUM(grand_total), 0) AS value
FROM orders
WHERE status NOT IN ('quote', 'draft', 'cancelled')
  AND order_date BETWEEN $1 AND $2
GROUP BY status
ORDER BY count DESC;
```

**Frontend:**
- Chart.js: doughnut chart لتوزيع الحالات
- جدول تفصيلي لكل حالة

### 5.3 زمن دورة الإنتاج
**Backend:** `GET /api/reports/production-cycle?from=&to=`

```sql
-- زمن من تأكيد الأمر حتى التسليم النهائي
SELECT
  o.order_number,
  o.order_date,
  MIN(dn.delivered_at) AS first_delivery,
  MAX(dn.delivered_at) AS last_delivery,
  EXTRACT(EPOCH FROM (MAX(dn.delivered_at) - o.order_date)) / 86400 AS total_cycle_days
FROM orders o
JOIN delivery_notes dn ON dn.order_id = o.id
WHERE dn.status = 'completed'
  AND dn.delivered_at IS NOT NULL
  AND o.order_date BETWEEN $1 AND $2
GROUP BY o.order_number, o.order_date
ORDER BY total_cycle_days DESC;
```

**Frontend:**
- جدول زمن دورة كل أمر
- متوسط + أطول + أقصر زمن
- Chart.js: bar chart

---

## المرحلة 6 — المخزون و VMI

### 6.1 قيمة المخزون
**Backend:** `GET /api/reports/stock-value`

```sql
SELECT
  w.id, w.name AS warehouse_name,
  c.name AS client_name,
  COUNT(ws.id) AS sku_count,
  COALESCE(SUM(ws.quantity), 0) AS total_qty,
  COALESCE(SUM(ws.quantity * pv.cost_price), 0) AS cost_value,
  COALESCE(SUM(ws.quantity * pv.selling_price), 0) AS retail_value
FROM warehouse_stock ws
JOIN warehouses w ON w.id = ws.warehouse_id
LEFT JOIN clients c ON c.id = ws.client_id
JOIN product_variants pv ON pv.id = ws.variant_id
WHERE ws.quantity > 0
GROUP BY w.id, w.name, c.name
ORDER BY cost_value DESC;
```

### 6.2 حركة المخزون
**Backend:** `GET /api/reports/stock-movement?from=&to=`

```sql
SELECT
  transaction_type,
  COUNT(*) AS count,
  COALESCE(SUM(quantity), 0) AS total_qty
FROM inventory_transactions
WHERE created_at BETWEEN $1 AND $2
GROUP BY transaction_type
ORDER BY total_qty DESC;
```

### 6.3 تنبيهات المخزون
**Backend:** `GET /api/reports/stock-alerts`

```sql
-- مخزون أقل من الحد الأدنى
SELECT
  p.name, pv.size_name, w.name AS warehouse_name,
  ws.quantity, pv.min_stock_level,
  CASE WHEN ws.quantity = 0 THEN 'out' ELSE 'low' END AS alert_type
FROM warehouse_stock ws
JOIN product_variants pv ON pv.id = ws.variant_id
JOIN products p ON p.id = pv.product_id
JOIN warehouses w ON w.id = ws.warehouse_id
WHERE ws.quantity <= pv.min_stock_level
  AND pv.min_stock_level > 0
ORDER BY alert_type, p.name;

-- مخزون راكد (لم يتحرك منذ 90 يوم)
SELECT
  p.name, pv.size_name, w.name AS warehouse_name,
  ws.quantity, ws.last_updated,
  EXTRACT(DAY FROM NOW() - ws.last_updated)::int AS days_idle
FROM warehouse_stock ws
JOIN product_variants pv ON pv.id = ws.variant_id
JOIN products p ON p.id = pv.product_id
JOIN warehouses w ON w.id = ws.warehouse_id
WHERE ws.quantity > 0
  AND ws.last_updated < NOW() - INTERVAL '90 days'
ORDER BY days_idle DESC;
```

---

## المرحلة 7 — التصميم والجودة

### 7.1 إنتاجية المصمم
**Backend:** `GET /api/reports/designer-productivity?from=&to=`

```sql
SELECT
  u.name AS designer_name,
  COUNT(cd.id) AS total_designs,
  COUNT(cd.id) FILTER (WHERE cd.status = 'approved') AS approved,
  COUNT(cd.id) FILTER (WHERE cd.status = 'in_progress') AS in_progress,
  COUNT(cd.id) FILTER (WHERE cd.status = 'revision') AS revisions,
  COALESCE(AVG(EXTRACT(EPOCH FROM (cd.updated_at - cd.created_at)) / 86400)::numeric(10,1), 0) AS avg_completion_days
FROM client_designs cd
JOIN users u ON u.id = cd.created_by
WHERE cd.created_at BETWEEN $1 AND $2
GROUP BY u.name
ORDER BY total_designs DESC;
```

### 7.2 معدل اعتماد التصميم
**Backend:** `GET /api/reports/design-approval?from=&to=`

```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE design_status = 'completed') AS approved,
  COUNT(*) FILTER (WHERE design_status = 'client_revision') AS client_revisions,
  COUNT(*) FILTER (WHERE design_status = 'manager_review') AS manager_reviews,
  COUNT(*) FILTER (WHERE design_status = 'in_progress') AS in_progress,
  COUNT(*) FILTER (WHERE design_status = 'waiting_design') AS waiting
FROM order_items
WHERE design_status != 'new'
  AND created_at BETWEEN $1 AND $2;
```

---

## المرحلة 8 — تصدير وطباعة

### 8.1 تصدير Excel
- استخدام SheetJS (xlsx) — CDN
- `_exportExcel(data, filename)` — تحويل JSON إلى workbook
- كل تبويب يصدّر بياناته الحالية

### 8.2 تصدير PDF
- استخدام jsPDF + jspdf-autotable — CDN
- `_exportPDF(title, data, columns)` — إنشاء PDF مع جدول
- دعم RTL (direction: rtl) في PDF

### 8.3 طباعة
- `window.print()` مع `@media print` CSS مخصص
- إخفاء الـ sidebar والـ tabs عند الطباعة
- عرض البيانات فقط بتنسيق نظيف

**اختبار 8.x:**
- تصدير Excel وفتح الملف — التحقق من البيانات
- تصدير PDF وفتح الملف — التحقق من RTL
- طباعة — التحقق من التنسيق

---

## ترتيب التنفيذ النهائي

| # | المهمة | المدة التقديرية | الاعتماد على |
|---|-------|---------------|-------------|
| 1 | البنية الأساسية (route + view + sidebar) | — | لا شيء |
| 2 | KPIs Dashboard | — | 1 |
| 3 | قائمة الدخل (P&L) | — | 1 |
| 4 | تحليل الربحية | — | 1 |
| 5 | التدفقات النقدية | — | 1 |
| 6 | تقرير VAT | — | 1 |
| 7 | تقرير المبيعات | — | 1 |
| 8 | تحليل العروض | — | 1 |
| 9 | سلوك العملاء | — | 1 |
| 10 | أداء الموردين | — | 1 |
| 11 | حالة الإنتاج | — | 1 |
| 12 | زمن دورة الإنتاج | — | 1 |
| 13 | قيمة المخزون | — | 1 |
| 14 | حركة المخزون | — | 1 |
| 15 | تنبيهات المخزون | — | 1 |
| 16 | إنتاجية المصمم | — | 1 |
| 17 | معدل اعتماد التصميم | — | 1 |
| 18 | تصدير Excel | — | 2-17 |
| 19 | تصدير PDF | — | 2-17 |
| 20 | طباعة | — | 2-17 |

---

## قواعد الاختبار لكل ميزة

1. **Backend:** تنفيذ SQL query مباشرة في psql ومقارنة النتائج مع API response
2. **Frontend:** فتح الـ console والتحقق من عدم وجود errors
3. **Responsive:** اختبار على 3 أحجام شاشة (mobile 375px / tablet 768px / desktop 1280px)
4. **Edge cases:** فترة بدون بيانات / فترة طويلة جداً / بيانات صفرية
5. **Permissions:** التحقق من أن المستخدم بدون صلاحية `reports` لا يصل للصفحة
6. **لا كسر:** التأكد من أن باقي صفحات النظام تعمل بعد كل تعديل
