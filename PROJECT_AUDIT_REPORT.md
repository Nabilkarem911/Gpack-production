# 🔍 تقرير تدقيق المشروع والهندسة المعمارية

**المشروع:** G.PACK 2.0 ERP System  
**تاريخ التدقيق:** 2026-06-14  
**المدقق:** Staff Software Architect / Security Auditor  
**النطاق:** كامل المشروع (Backend + Frontend + AI Service + Infrastructure)

---

## 1. 🏗️ الهندسة المعمارية وخريطة الموديولات

### 1.1 نظرة عامة على البنية

المشروع بنظام **Monolithic Multi-Container** يتكون من 4 خدمات رئيسية:

```
┌─────────────────────────────────────────────────────────────────┐
│                          العميل (Browser)                        │
│  Vanilla JS SPA + Tailwind CSS + Chart.js (frontend/js/views)   │
└───────────────────────────┬───────────────────────────────────────┘
                            │ HTTP/80
┌───────────────────────────▼───────────────────────────────────────┐
│              Nginx (frontend container :80)                     │
│  - Static files: /usr/share/nginx/html                            │
│  - Reverse proxy: /api/* → backend:3000                           │
│  - Reverse proxy: /uploads/* → backend:3000                       │
└───────────────────────────┬───────────────────────────────────────┘
                            │ Internal Docker Network
    ┌───────────────────────┼───────────────────────┐
    │                       │                       │
┌───▼────────┐    ┌───────▼────────┐    ┌────────▼─────────┐
│  Backend   │    │   AI Service   │    │   MCP Server     │
│  Express   │    │   FastAPI      │    │   (unclear)      │
│  port 3000 │    │   port 8000    │    │   port 3001      │
└───┬────────┘    └────────────────┘    └──────────────────┘
    │
    │ Raw SQL (pg pool)
┌───▼────────┐
│ PostgreSQL │
│  port 5432 │
└────────────┘
```

### 1.2 الفلسفة التصميمية

- **Frontend:** Vanilla JavaScript SPA (بدون React/Vue) — يعتمد على `innerHTML` وتحميل الـ views ديناميكياً.
- **Backend:** Express.js + Raw PostgreSQL Queries (pg pool) — بدون ORM.
- **Database:** PostgreSQL 14+ مع نظام migrations يدوي عبر ملفات `.sql`.
- **AI Service:** Python FastAPI يتصل مباشرة بقاعدة البيانات (read-only).
- **Auth:** JWT Stateless (localStorage) مع Role-Based Access Control (RBAC).

### 1.3 الموديولات الرئيسية (Backend Routes — 32 ملف)

| الموديول | الوصف | الحماية |
|---|---|---|
| `auth.js` | تسجيل الدخول / JWT / me / logout | `loginLimiter` |
| `users.js` | CRUD المستخدمين والأدوار | `restrictToAdmin` |
| `clients.js` | عملاء + الفروع (parent_id) | `authenticate` + role checks |
| `orders.js` | الطلبات + عروض الأسعار + VMI | `authenticate` + data scoping |
| `invoices.js` | فواتير المبيعات | `authenticate` (some missing `authorize`) |
| `products.js` | منتجات + variants | `authenticate` |
| `inventory.js` | warehouse_stock + movements | `authenticate` |
| `manufacturer_orders.js` | أوامر التصنيع (69KB — أضخم ملف) | `authenticate` |
| `manufacturer_print.js` | طباعة PDF (pdfkit) | `authenticate` (missing module) |
| `suppliers.js` | الموردين + فواتير المشتريات | `authenticate` + `authorize` (partial) |
| `vmi.js` | VMI Dispatch + stock | `authenticate` + `authorize` (dispatch only) |
| `public_quotation.js` | بوابة العميل العامة | `publicLimiter` (no auth for view) |
| `public-invoice.js` | فاتورة عامة (no auth) | `publicLimiter` |
| `public-statement.js` | كشف حساب عام (no auth) | `publicLimiter` |
| `forecast.js` | AI Forecasting proxy | `authenticate` |
| `dashboard.js` | إحصائيات لوحة التحكم | `authenticate` |
| `tasks.js` | نظام المهام | `authenticate` + role filtering |
| `accounts.js` | شجرة الحسابات | `authorize` (router-level) |
| `journal-entries.js` | القيود المحاسبية | `authorize` (router-level) |
| `receipt-vouchers.js` | سندات القبض | `authorize` (router-level) |
| `payment-vouchers.js` | سندات الصرف | `authorize` (router-level) |
| `receiving-vouchers.js` | سندات الاستلام | `authorize` (router-level) |
| `purchase-invoices.js` | فواتير المشتريات | `authenticate` + `authorize` |
| `purchase-returns.js` | مرتجع المشتريات | `authorize` (router-level) |
| `delivery-notes.js` | سندات التسليم | `authorize` (router-level) |
| `account-statement.js` | كشف حساب العميل/المورد | `authenticate` + `authorize` |
| `client_designs.js` | تصاميم العملاء + upload | `authenticate` (no `authorize`) |
| `client_pantone_colors.js` | ألوان Pantone | `authenticate` (no `authorize`) |
| `client_items.js` | منتجات العميل | `authenticate` (no `authorize`) |
| `categories.js` | التصنيفات | **لا يوجد auth أو authorize** |
| `units.js` | وحدات القياس | **لا يوجد auth أو authorize** |
| `terms.js` | البنود القياسية | **لا يوجد auth أو authorize** |

### 1.4 التكوينات والأدوات

| الملف | الوضع الحالي | الملاحظات |
|---|---|---|
| `docker-compose.yml` | ✅ يعمل | يفتقر إلى `networks` صريحة؛ `version` obsolete |
| `backend/Dockerfile` | ⚠️ | `npm install --omit=dev` لكن volume mount يستبدل `/app` في development |
| `ai-service/Dockerfile` | ✅ | Python 3.11 slim + Uvicorn |
| `nginx/nginx.conf` | ✅ | reverse proxy صحيح لكن يفتقر إلى rate limit عند nginx |
| `.env.example` | ✅ | يذكر ضرورة `CORS_ORIGIN` في الإنتاج |
| `package.json` | ✅ | `express-rate-limit` موجود لكن لا يستخدم بشكل كامل |
| `tests/` | ❌ فارغ | لا يوجد اختبارات unit/integration/e2e |

---

## 2. 🔐 تدقيق الأمان والموثوقية وحالات الحافة

### 2.1 ثغرات أمنية حرجة (Critical)

#### 🔴 C-001: SQL Injection في `account-statement.js`

**الملف:** `backend/routes/account-statement.js`  
**الأسطر:** 66, 86, 113, 122, 195, 216, 241, 249  
**الوصف:** يتم بناء `dateFilter` كـ String ثم إدخاله في الاستعلام عبر `.replace(/date/g, 'i.invoice_date')`.

```javascript
// خطير جداً — يتيح حقن SQL مباشر
${dateFilter.replace(/date/g, 'i.invoice_date')}
```

على الرغم من أن `from` و `to` يُدفعان كـ parameterized queries في المصفوفة، إلا أن `dateFilter` نفسه يُبنى عبر string concatenation ويُحقن مباشرة في النص SQL. لو تم تعديل الكود مستقبلاً بشكل خاطئ أو إعادة استخدام الدالة، يصبح الباب مفتوحاً.

**التصنيف:** 🔴 Critical

#### 🔴 C-002: Public Endpoints تكشف بيانات حساسة بدون حماية كافية

**الملفات:**
- `public-invoice.js` — `/api/public/invoice/:id` يعيد فاتورة كاملة (items + expenses + client data) بمجرد UUID.
- `public-statement.js` — `/api/public/client-statement/:clientId` يعيد كل فواتير العميل وسندات القبض.

**الوصف:** الرابط العام `/api/public/invoice/:id` يعيد بيانات الفاتورة بمجرد معرف UUID قابل للتخمين (UUID v4 صعب لكن ليس مستحيلاً). لا يوجد token أو pin أو rate limiting إضافي للبيانات المالية الحساسة.

**التصنيف:** 🔴 Critical

#### 🔴 C-003: Endpoints بدون Authorization Middleware

**الملفات:** `categories.js`, `units.js`, `terms.js`, `client_designs.js`, `client_pantone_colors.js`, `client_items.js`  
**الوصف:** هذه الملفات تحتوي على `authenticate` في `server.js` لكنها **لا تستخدم `authorize`**. أي مستخدم مسجل دخول (حتى warehouse_keeper أو sales_rep) يمكنه:
- إنشاء/تعديل/حذف تصنيفات (`categories.js`)
- إنشاء/تعديل/حذف وحدات قياس (`units.js`)
- إنشاء/تعديل/حذف بنود قياسية (`terms.js`)
- رفع/حذف تصاميم العملاء (`client_designs.js`)

**التصنيف:** 🔴 Critical

#### 🔴 C-004: JWT مخزن في localStorage

**الملف:** `frontend/js/api.js` + `frontend/js/auth.js`  
**الوصف:** يتم تخزين JWT في `localStorage` (`gpack_token`). أي XSS Script Injection يمكنه قراءة التوكن وإرساله للمهاجم. لا يوجد `HttpOnly` cookie.

**التصنيف:** 🔴 Critical

### 2.2 ثغرات أمنية خطيرة (High)

#### 🟠 H-001: Endpoint Migration عام بدون مصادقة

**الملف:** `server.js` السطر 191-202  
**الوصف:** `/api/migrate-tax-rate` endpoint عام يُنفذ `ALTER TABLE` مباشرة بدون أي مصادقة.

#### 🟠 H-002: File Upload — Path Traversal Potential

**الملف:** `client_designs.js` السطر 26-35  
```javascript
const clientDir = path.join(UPLOAD_BASE, client_id);
const designDir = path.join(clientDir, design_id || 'temp');
fs.mkdirSync(designDir, { recursive: true });
```

لو تم تمرير `client_id` أو `design_id` يحتوي على `../` يمكن الوصول لمسارات خارج المجلد المخصص. `multer` يُنفذ `fs.mkdirSync` مباشرة بهذه القيم.

#### 🟠 H-003: CORS قابل للإعداد الخاطئ

**الملف:** `server.js` السطر 136-141  
```javascript
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost',
  credentials: true,
}));
```

لو نسي المسؤول وضع `CORS_ORIGIN` في الإنتاج، يعود للقيمة الافتراضية `http://localhost` وهي آمنة. لكن تعليق الملف يحذر فقط — لا يوجد validation عند startup.

#### 🟠 H-004: Error Messages تُرسل للعميل بدون تصفية

**الملفات:** عدة ملفات (مثلاً `vmi.js` 39, `public-invoice.js` 61)  
**الوصف:** بعض المسارات ترجع `err.message` مباشرة للعميل (`res.status(500).json({ error: err.message })`) مما قد يكشف معلومات داخلية.

#### 🟠 H-005: Missing Security Headers

**الوصف:** لا يوجد `helmet` middleware. لا توجد headers مثل:
- `Content-Security-Policy`
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Strict-Transport-Security`

### 2.3 مشاكل موثوقية وحالات الحافة

#### 🟡 R-001: DB Pool Error يقتل العملية

**الملف:** `backend/db.js` السطر 26-29  
```javascript
pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err.message);
  process.exit(1); // ❌ يقتل الحاوية بالكامل بدون محاولة إعادة اتصال
});
```

#### 🟡 R-002: Frontend JS files مفقودة

**الملفات المفقودة:**
- `frontend/js/views/orders.js` (ENOENT في فحص syntax)
- `frontend/js/views/invoices.js` (ENOENT في فحص syntax)

هذا يعني أن صفحتي الطلبات والفواتير قد لا تعمل بشكل صحيح.

#### 🟡 R-003: Module Missing — `pdfkit`

**الملف:** `manufacturer_print.js` يستورد `pdfkit` لكنه غير مثبت في `package.json`. تم تثبيته لاحقاً لكن قد يتسبب في فشل تحميل الموديول عند بدء التشغيل.

#### 🟡 R-004: Double-Submission Protection مفقودة

**الوصف:** لا يوجد CSRF token أو idempotency key. المستخدم يمكنه الضغط على زر "حفظ" مرتين وإنشاء سجل مكرر. المستخدم القواعد تذكر "MUST prevent double-submissions" لكنها غير مطبقة في معظم المسارات.

#### 🟡 R-005: Transactions بدون Timeout

**الوصف:** لا يوجد timeout على الاستعلامات الفردية (`statement_timeout` في PostgreSQL غير مضبوط). استعلامات التقارير الثقيلة قد تعلق indefinitely.

#### 🟡 R-006: Memory Leaks في Frontend

**الملف:** `frontend/js/api.js` السطر 55-59  
```javascript
setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(2rem)';
    setTimeout(() => toast.remove(), 300);
}, 4500);
```

لو تم إنشاء آلاف الـ toasts بدون إزالتها (على سبيل المثال في loop سريع) يمكن أن تتراكم في DOM. ليست critical لكنها anti-pattern.

---

## 3. 🛑 أخطاء حرجة، أنماط مضادة، وديون تقنية

### 3.1 الأخطاء الحرجة المؤكدة

| # | الخطأ | الموقع | التأثير |
|---|-------|--------|---------|
| B-001 | `manufacturer_print.js` يستورد `pdfkit` غير المثبت | `manufacturer_print.js:3` | فشل تشغيل الـ route — 500 error |
| B-002 | `orders.js` و `invoices.js` مفقودان من `frontend/js/views/` | `frontend/js/views/` | 404 عند محاولة الوصول للصفحات |
| B-003 | `client_designs.js` يستخدم `req.body.client_id` لبناء مسار الملف بدون تطهير | `client_designs.js:30-31` | Path Traversal |
| B-004 | `public-statement.js` يستخدم `LIKE '%' || (SELECT name...) || '%'` — Subquery في كل صف | `public-statement.js:63` | أداء كارثي مع العملاء الكثيرين |
| B-005 | AI service يفتقر إلى connection pool — يفتح/يغلق connection في كل request | `ai-service/main.py:34-62` | Performance degradation + connection exhaustion |

### 3.2 الأنماط المضادة (Anti-Patterns)

#### AP-001: God File

**الملف:** `manufacturer_orders.js` (69,867 بايت = ~1,700 سطر)  
**الملف:** `orders.js` (69,549 بايت = ~1,666 سطر)  
**الملف:** `quotations.html` (80,670 بايت — HTML view ضخم)  
**الوصف:** ملفات بأحجام ضخمة جداً تحتوي على عشرات الـ endpoints. يصعب الصيانة والاختبار.

#### AP-002: Inconsistent Response Format

**الوصف:** بعض الملفات تستخدم `utils/response.js` (`success()`, `error()`) وبعضها ترجع `res.json()` مباشرة. مثلاً:
- `invoices.js` يستخدم `res.json({ data: ... })`
- `orders.js` يستخدم `success(res, ...)` أو `res.json()`
- `account-statement.js` يستخدم `res.json()` مباشرة

#### AP-003: No Input Validation Library

**الوصف:** لا يوجد Joi/Zod/Express-Validator. كل route يتحقق يدوياً من `req.body` مما يؤدي إلى:
- تكرار الكود
- احتمالية نسيان التحقق
- صعوبة الصيانة

#### AP-004: Frontend `var` instead of IIFE/Module Pattern

**الوصف:** معظم ملفات frontend تستخدم `var` لتجنب إعادة التصريح (`var forecastView = { ... }`) بدلاً من استخدام ES modules أو IIFE. هذا anti-pattern يؤدي إلى تلوث الـ global scope.

#### AP-005: Hardcoded VAT Rate

**الملف:** `orders.js` السطر 13  
```javascript
const VAT_RATE = 0.15;
```
مثبت في الكود — يجب أن يكون في جدول الإعدادات (`settings` table).

### 3.3 الديون التقنية

| # | الدين | الموقع | الأولوية |
|---|-------|--------|---------|
| D-001 | لا يوجد unit tests / integration tests | `tests/` فارغ | 🔴 عالية |
| D-002 | لا يوجد API documentation (Swagger/OpenAPI) | — | 🟠 متوسطة |
| D-003 | لا يوجد health checks للـ AI Service | docker-compose | 🟡 منخفضة |
| D-004 | Migration system بدون checksum أو down-migrations | `server.js:19-86` | 🟠 متوسطة |
| D-005 | `share_token` في `orders` table — بدون encryption | قاعدة البيانات | 🟠 متوسطة |
| D-006 | `public-client-statement.js` يفك تشفير base64 يدوياً | `public-client-statement.js:34` | 🟡 منخفضة |
| D-007 | Backend Dockerfile يستخدم `COPY . .` — ينسخ كل شيء | `backend/Dockerfile` | 🟡 منخفضة |

---

## 4. 📈 تقييم الصحة الهيكلية (0-100)

| البُعد | الدرجة | التبرير |
|--------|--------|---------|
| **جودة الكود** | 55/100 | Raw SQL نظيف مع parameterized queries في الغالب، لكن God files ضخمة، وعدم استخدام validator library، وتباين في style. |
| **الأمان** | 35/100 | SQL injection موجود، JWT في localStorage، public endpoints تعرض بيانات مالية، missing authorization على ~8 routes، لا يوجد helmet. |
| **القابلية للتوسع** | 50/100 | Dockerized لكن backend monolith ضخم. AI service منفصل جيداً. لا يوجد caching (Redis) أو read replicas. File upload يعتمد على disk. |
| **قابلية الاختبار** | 20/100 | `tests/` فارغ تماماً. God files تجعل الـ unit testing شبه مستحيل. لا يوجد dependency injection. |
| **المجموع** | **40/100** | المشروع يعمل وظيفياً لكنه يحتاج إلى إعادة هيكلة أمنية وإضافة tests قبل الانتقال للإنتاج الحقيقي. |

---

## 5. 🗺️ خارطة التنفيذ وقائمة الإجراءات

### المرحلة 1: إصلاحات أمنية حرجة (أسبوع 1)

- [ ] **C-001:** إصلاح SQL Injection في `account-statement.js` — استبدال string concatenation بـ parameterized queries فقط.
- [ ] **C-003:** إضافة `authorize` middleware لجميع ملفات الـ routes المفقودة (`categories.js`, `units.js`, `terms.js`, `client_designs.js`, `client_pantone_colors.js`, `client_items.js`).
- [ ] **C-002:** حماية Public Endpoints بـ token فريد (مثل `public_quotation.js`) لـ `public-invoice.js` و `public-statement.js`.
- [ ] **H-001:** إزالة `/api/migrate-tax-rate` أو حمايته بـ `authorize(['super_admin'])`.
- [ ] **H-002:** تطهير `client_id` و `design_id` في `client_designs.js` عبر `path.normalize` + whitelist.
- [ ] **H-005:** تثبيت وتفعيل `helmet` middleware في `server.js`.
- [ ] **H-004:** مراجعة جميع `catch` blocks — عدم إرجاع `err.message` أو `err.stack` للعميل أبداً.

### المرحلة 2: تحسين الموثوقية والأداء (أسبوع 2)

- [ ] **R-001:** إزالة `process.exit(1)` من `pool.on('error')` واستبداله بـ reconnection logic.
- [ ] **B-004:** إعادة كتابة `public-statement.js` لاستخدام `client_id` index بدلاً من `LIKE '%name%'`.
- [ ] **B-005:** إضافة connection pooling في `ai-service/main.py` (pg pool أو connection reuse).
- [ ] **R-005:** إضافة `statement_timeout` في `db.js` (`query_timeout: 30000`).
- [ ] **AP-005:** نقل `VAT_RATE` إلى جدول `system_settings`.
- [ ] **D-007:** تحسين `backend/Dockerfile` — استخدام `.dockerignore` فعّال (حالياً 37 بايت فقط!).

### المرحلة 3: إعادة الهيكلة والاختبارات (أسبوع 3-4)

- [ ] **D-001:** إعداد Jest + Supertest وكتابة unit tests للـ middleware (auth, authorize) + integration tests لـ 5 routes رئيسية.
- [ ] **AP-003:** تثبيت Zod أو Joi وإنشاء validation schemas مشتركة لجميع الموديولات.
- [ ] **AP-001:** تقسيم `manufacturer_orders.js` و `orders.js` إلى ملفات أصغر (مثلاً `orders-list.js`, `orders-create.js`, `orders-details.js`).
- [ ] **C-004:** (اختياري متقدم) الانتقال من localStorage JWT إلى `HttpOnly` cookie + refresh token mechanism.
- [ ] **D-003:** إضافة health check endpoint لـ AI service في docker-compose (`healthcheck` block).
- [ ] **B-002:** إنشاء `frontend/js/views/orders.js` و `frontend/js/views/invoices.js` المفقودين أو إزالة روابطهم من الـ navigation.

### المرحلة 4: تحسينات إنتاجية (أسبوع 5+)

- [ ] إضافة Redis للـ caching (_sessions_, _rate limiting_, _dashboard stats_).
- [ ] إعداد log aggregation (Winston أو Pino بدلاً من `console.log`).
- [ ] إضافة Swagger/OpenAPI docs (`swagger-ui-express`).
- [ ] إعداد `nodemailer` أو خدمة إشعارات للتنبيهات.
- [ ] إضافة database indexes audit — التأكد من وجود indexes على `client_id`, `order_date`, `status`, `role_id`.
- [ ] إعداد CI/CD pipeline (GitHub Actions) مع automated testing.

---

## ملخص تنفيذي

G.PACK 2.0 مشروع ERP وظيفي ومتكامل يغطي مجالاً معقداً (VMI + Franchise + Accounting). البنية العامة منطقية والـ Raw SQL محكوم بشكل جيد في معظم المسارات. **لكن المشروع يحتوي على ثغرات أمنية حرجة (SQL Injection + Missing Authorization + JWT في localStorage + Public Data Exposure) تجعله غير جاهز للإنتاج الحقيقي قبل إصلاحها.**

**الأولوية القصوى:**
1. إصلاح SQL Injection في `account-statement.js`
2. إضافة `authorize` middleware لجميع المسارات
3. حماية Public Endpoints
4. إضافة helmet + security headers
5. كتابة الاختبارات (Jest)

**التقييم النهائي: 40/100** — يحتاج إلى أسبوعين من العمل المكثف على الأمان قبل الإنتاج.
