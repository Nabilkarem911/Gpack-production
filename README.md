# G.PACK ERP 2.0

نظام إدارة متكامل للمستودعات والمبيعات والتصنيع — مبني على Node.js + Express + PostgreSQL + Docker.

نظام VMI (Vendor-Managed Inventory) مع قدرات Franchise، سير عمل تصميم كامل (Design Workflow)، نظام إشعارات WhatsApp تلقائي، ومساعد ذكي (AI Assistant).

---

## ✨ الخصائص الرئيسية

### الإدارة والمبيعات
- **إدارة العملاء (Clients)** — مع تسلسل Franchise (Parent/Branch)
- **إدارة المنتجات (Products)** — منتجات ومتغيرات (Variants) عامة غير مرتبطة بعميل
- **المخزون (Inventory)** — مرتبط بـ `client_id` للسماح بصرف من Parent إلى Branch
- **عروض الأسعار (Quotations)** — تحويل تلقائي إلى أمر إنتاج
- **الفواتير (Sales Invoices)** — مع مشاركة عامة عبر رمز مشفّر
- **أوامر الإنتاج (Production Orders)** — مع سير عمل كامل

### التصنيع والموردين
- **أوامر التصنيع (Manufacturer Orders)** — مع رابط عام للموردين + PDF
- **الفواتير المجمّعة (Consolidated Purchase Invoices)** — دمج عدة أوامر تصنيع في فاتورة واحدة
- **استلام مباشر (Direct Receipts)** — استلام مؤقت + مراجعة مدير + تحويل لفاتورة شراء
- **بوابة الموردين (Supplier Portal)** — رابط دائم لكل مورد لعرض كل أوامره وتحديث الحالات

### سير عمل التصميم (Design Workflow)
- **تخصيص مصمم لكل صنف** — مصمم مختلف لكل item في نفس الطلب
- **State Machine كامل** — `waiting_design` → `in_progress` → `manager_review` → `client_review` → `approved`
- **مراجعة العميل العامة** — رابط مشفّر للعميل لمراجعة التصميم وطلب تعديلات
- **الاعتماد الإلكتروني (Design Approvals)** — توقيع إلكتروني + شهادة اعتماد + QR + PDF
- **سجل نشاط غير قابل للتعديل (Immutable Activity Log)** — منع UPDATE/DELETE عبر triggers
- **إصدارات التصميم (Design Versioning)** — تتبع دورات التعديل

### الإشعارات (Notification System)
- **طابور إشعارات (Notification Queue)** — مع إعادة محاولة تلقائية (Exponential Backoff)
- **مراسلة WhatsApp تلقائية** — عبر WAHA عند اعتماد التصميم وإرسال للعميل
- **مركز إشعارات داخلي (Notification Center)** — إشعارات داخل التطبيق لكل مستخدم
- **Dead Letter Queue** — للرسائل الفاشلة نهائياً
- **Outbox Pattern** — ضمان عدم فقدان أي رسالة حتى لو السيرفر توقف
- **قوالب إشعارات (Templates)** — قوالب عربية قابلة للتخصيص

### المساعد الذكي (AI Assistant)
- **محادثة ذكية** — مع تذكر سياق المحادثة (Conversation Context)
- **اقتراح إجراءات (Action Proposals)** — إنشاء عروض، تحويل طلبات، إضافة دفعات
- **تنفيذ جماعي (Batch Execute)** — تنفيذ عدة إجراءات دفعة واحدة
- **سياسات إجراءات (Action Policies)** — قواعد عمل تُطبق قبل تنفيذ أي إجراء
- **ملخص يومي (Morning Briefing)** — ملخص تلقائي يومي للمستخدم
- **تقييم الاقتراحات (Feedback)** — أزرار 👍/👎 تحت كل رد
- **ميزة Flags** — تفعيل/تعطيل ميزات AI لكل بيئة
- **أهداف عمل (Goals Engine)** — تتبع أهداف العمل و progress
- **تنبؤ بالطلب (Demand Forecasting)** — خدمة Python FastAPI منفصلة

### المحاسبة (Accounting)
- **قيود مجلة (Journal Entries)** — نظام قيد مزدوج (Double-Entry)
- **قيود غير قابلة للتعديل (Immutable Vouchers)** — التعديل يتطلب Revert & Recreate
- **حسابات (Chart of Accounts)** — مع تصنيف هرمي
- **كاش بوكس (Cash Boxes)** و **POS Terminals**
- **مدفوعات (Payment Vouchers)**

### إدارة المهام (Tasks)
- **مهام ومهام فرعية (Tasks & Subtasks)**
- **تعليقات (Comments)** و **إشعارات (Notifications)**
- **تخصيص وتتبع**

### تقارير ولوحات تحكم
- **Dashboard** — مؤشرات أداء رئيسية
- **Business Events** — سجل موحد لكل أنشطة الشركة
- **حركة المنتجات (Product Movements)**
- **كشف حساب (Account Statement)**

---

## 📋 المتطلبات

- Docker (إصدار 20+ على VPS / Docker Desktop محلياً)
- Git
- VPS بـ Ubuntu 20+ (للإنتاج)
- Dokploy مُثبّت على الـ VPS (للإنتاج)

---

## 🔧 متغيرات البيئة (.env)

انسخ `.env.example` إلى `.env` واملأ القيم التالية:

### أساسية (مطلوبة)

| المتغير | الوصف | مثال |
|---------|-------|-------|
| `DATABASE_HOST` | Dokploy Internal Host للداتابيز | `gpackerp-gpackerppostgres-u0f2ho` |
| `DATABASE_PORT` | منفذ قاعدة البيانات | `5432` |
| `DATABASE_NAME` | اسم قاعدة البيانات | `erp_gpack` |
| `DATABASE_USER` | مستخدم قاعدة البيانات | `postgres` |
| `DATABASE_PASSWORD` | كلمة سر قاعدة البيانات | `AS123df456` |
| `JWT_SECRET` | مفتاح تشفير JWT (32 حرف على الأقل) | `MySuperSecretJWTKey2024GpackERP!!` |
| `SHARE_TOKEN_SECRET` | مفتاح تشفير روابط المشاركة (32 حرف على الأقل) | `MyShareTokenSecret2024GpackERP!!` |
| `CORS_ORIGIN` | رابط الدومين (للإنتاج) | `https://gpack.yourdomain.com` |
| `BASE_URL` | الرابط الأساسي للروابط العامة | `https://erp.gpacksa.com` |
| `NODE_ENV` | بيئة التشغيل | `production` |

### ذكاء اصطناعي (اختياري)

| المتغير | الوصف | افتراضي |
|---------|-------|---------|
| `OPENAI_API_KEY` | مفتاح OpenAI أو أي مزود متوافق | — |
| `OPENAI_MODEL` | اسم النموذج | `gpt-4o-mini` |
| `OPENAI_BASE_URL` | رابط الـ API (يدعم OpenRouter, Groq, Ollama, إلخ) | `https://api.openai.com/v1` |
| `AI_ASSISTANT_ENABLED` | تفعيل/تعطيل المساعد الذكي | `true` |
| `VOICE_PROVIDER` | مزود التعرف الصوتي (`whisper` أو `vosk`) | `whisper` |

### WhatsApp (اختياري)

| المتغير | الوصف | افتراضي |
|---------|-------|---------|
| `WHATSAPP_PROVIDER` | المزود (`waha`, `meta`, `twilio`, `evolution`) | `waha` |
| `WAHA_URL` | رابط خادم WAHA | — |
| `WAHA_SESSION` | اسم الجلسة | `default` |
| `WAHA_API_KEY` | مفتاح WAHA (إن وجد) | — |
| `WAHA_ADMIN_CHAT_ID` | معرف الأدمن للإشعارات | — |
| `WAHA_WEBHOOK_SECRET` | سر الـ Webhook | — |
| `WHATSAPP_NUMBER` | رقم الواتساب الظاهر للعملاء | — |

### إضافية

| المتغير | الوصف | افتراضي |
|---------|-------|---------|
| `CACHEBUST` | رقم لبناء الـ frontend (زد للتحديث) | `1` |
| `LOG_LEVEL` | مستوى السجلات | `info` |

---

## 🚀 التشغيل المحلي (Development)

```bash
# 1. انسخ المشروع
git clone https://github.com/Nabilkarem911/Gpack-production.git
cd Gpack-production

# 2. أنشئ ملف البيئة
cp .env.example .env
# عدّل القيم في .env

# 3. شغّل المشروع
docker-compose up -d --build
```

الموقع يفتح على: **http://localhost**
الـ API على: **http://localhost:3003/api**

---

## 🌐 التثبيت على VPS باستخدام Dokploy

### الخطوة 1: تجهيز الـ VPS

```bash
# سجّل دخول على VPS عبر SSH
ssh root@your-vps-ip

# ثبّت Docker لو مش مثبّت
curl -fsSL https://get.docker.com | sh

# ثبّت Dokploy
# اتبع التعليمات الرسمية على https://dokploy.com/docs
```

### الخطوة 2: إنشاء Database Service (PostgreSQL)

1. افتح لوحة Dokploy: `http://your-vps-ip:3000`
2. اضغط **Databases** → **New Database** → اختر **PostgreSQL**
3. سمّه `Gpack-ERP-Postgres`
4. بعد الإنشاء، ادخل على الداتابيز وانسخ **Internal Credentials**:
   - **Internal Host:** `gpackerp-gpackerppostgres-u0f2ho` (مثال)
   - **User:** `postgres`
   - **Database Name:** `erp_gpack`
   - **Password:** كلمة السر اللي اخترتها
   - **Internal Port:** `5432`

> **مهم:** الداتابيز دي منفصلة عن الـ Application. البيانات محفوظة حتى لو مسحت الـ Application.

### الخطوة 3: إنشاء Application Service

1. في Dokploy → **New Project** → سمّه `gpack-erp`
2. اختر نوع المشروع: **Docker Compose**
3. اربطه بـ GitHub repo: `Nabilkarem911/Gpack-production` (فرع `main`)

### الخطوة 4: إضافة متغيرات البيئة

في خانة **Environment Variables** أضف (استخدم بيانات الداتابيز من الخطوة 2):

```env
DATABASE_HOST=gpackerp-gpackerppostgres-u0f2ho
DATABASE_NAME=erp_gpack
DATABASE_USER=postgres
DATABASE_PASSWORD=AS123df456
JWT_SECRET=MySuperSecretJWTKey2024GpackERP!!
SHARE_TOKEN_SECRET=MyShareTokenSecret2024GpackERP!!
CORS_ORIGIN=https://gpack.yourdomain.com
NODE_ENV=production
```

> **مهم:** استخدم كلمات سر قوية وفريدة لـ `JWT_SECRET` و `SHARE_TOKEN_SECRET`. لا تستخدم القيم المذكورة أعلاه في الإنتاج.

### الخطوة 5: ربط الدومين (Domain)

1. في إعدادات الدومين (DNS) لمزود الخدمة:
   - أضف **A Record** يشير إلى IP الـ VPS
   - مثال: `gpack.yourdomain.com → A → your-vps-ip`

2. في Dokploy → إعدادات المشروع → **Domains**:
   - أضف الدومين: `gpack.yourdomain.com`
   - فعّل **SSL/TLS** (Let's Encrypt تلقائي)

3. عدّل `CORS_ORIGIN` في متغيرات البيئة ليكون:
   ```
   CORS_ORIGIN=https://gpack.yourdomain.com
   ```

### الخطوة 6: Deploy

1. اضغط **Deploy**
2. انتظر حتى يكتمل البناء (أول مرة ياخذ 3-5 دقائق)
3. افتح `https://gpack.yourdomain.com`

---

## 🗄️ إدارة قاعدة البيانات على Dokploy

### الداتابيز (Dokploy-managed PostgreSQL)

الداتابيز تعمل كـ Database Service منفصل في Dokploy. البيانات محفوظة ومستقلة عن الـ Application — حتى لو مسحت الـ Application أو عملت redeploy، الداتابيز لا تتأثر.

**للنسخ الاحتياطي (Backup):**
```bash
# سجّل دخول على VPS عبر SSH
# استخدم بيانات الداتابيز من Dokploy
docker exec <dokploy_postgres_container> pg_dump -U postgres erp_gpack > backup_$(date +%Y%m%d).sql
```

**لاستعادة نسخة احتياطية (Restore):**
```bash
docker cp backup_20260622.sql <dokploy_postgres_container>:/tmp/backup.sql
docker exec <dokploy_postgres_container> psql -U postgres erp_gpack -f /tmp/backup.sql
```

> استبدل `<dokploy_postgres_container>` باسم container الداتابيز من Dokploy (تجده في تبويب Logs أو General).

### الـ Migrations (تلقائية بالكامل)

- عند تشغيل الـ backend، الـ migration runner بيشتغل تلقائياً **قبل** بدء الـ Express server.
- ملف `000_init_schema.sql` بيُنشئ كل الجداول والبيانات الأولية (admin user، accounts، cash boxes، POS terminals).
- بعدها، كل ملفات `.sql` في `backend/migrations/` (70+ ملف) تشتغل بالترتيب الرقمي.
- **تتبع تلقائي:** جدول `schema_migrations` يسجّل كل ملف تم تطبيقه — الملفات المطبّقة تتخطى تلقائياً.
- **Dollar-Quote Aware:** الـ splitter بيتعامل صح مع `DO $$ ... $$` blocks و `$tag$ ... $tag$` و single-quoted strings.
- **آمن للإنتاج:** لو الـ migration سجل في `schema_migrations`، يتخطى تماماً — لا يُعاد تطبيقه.
- **آمن للاستضافة الجديدة:** على database جديد، كل الـ migrations تشتغل من الصفر وتُنشئ الـ schema كامل.
- **Idempotent:** كل ملف يستخدم `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` — آمن لإعادة التشغيل.
- **لا تحتاج تنفيذ `init.sql` يدوياً** — الـ backend بيعمل كل حاجة تلقائياً.

---

## 🔄 التحديث بعد كل تعديل

```bash
# محلياً
git add .
git commit -m "وصف التعديل"
git push origin main
```

ثم في Dokploy:
1. اضغط **Redeploy** على المشروع
2. البيانات (الداتابيز) لا تُمس — محفوظة في volume
3. الـ migrations الجديدة تشتغل تلقائياً

---

## 🔐 بيانات الدخول الافتراضية

| الحقل | القيمة |
|-------|--------|
| البريد | `admin@gpack.com` |
| كلمة السر | `password` |

> **مهم:** غيّر كلمة السر فوراً بعد أول تسجيل دخول من صفحة الإعدادات.

---

## 🏗️ هيكل المشروع

```
├── backend/              # Node.js + Express API
│   ├── migrations/       # SQL migrations (تلقائية عند الـ startup)
│   ├── routes/           # API routes
│   ├── middleware/       # auth, authorize, audit
│   ├── utils/            # validators, crypto, settings, response
│   ├── db.js             # PostgreSQL connection pool
│   └── server.js         # Entry point
├── frontend/             # Vanilla JS + HTML + Tailwind CSS (SPA)
│   ├── views/            # HTML views (33 صفحة)
│   ├── js/               # Core modules + view controllers
│   │   ├── api.js        # Centralized API layer
│   │   ├── auth.js       # Authentication module
│   │   ├── layout.js     # SPA router + sidebar
│   │   └── app.js        # Bootstrap
│   └── index.html        # Main HTML
├── database/             # init.sql (نسخة مرجعية — الـ migrations تلقائية)
├── nginx/                # إعدادات الـ reverse proxy + security headers
├── ai-service/           # Python FastAPI (demand forecasting + RFM + voice)
├── mcp-server/           # MCP server (AI-to-DB bridge)
├── docker-compose.yml    # تعريف الـ services
├── .env.example          # نموذج متغيرات البيئة
└── README.md
```

---

## 📦 الـ Services

| Service | الوصف | Port |
|---------|-------|------|
| **PostgreSQL** | قاعدة بيانات (Dokploy-managed) | 5432 (داخلي) |
| `backend` | Node.js Express API + Migration Runner | 3000 (داخلي) |
| `notification-worker` | معالج طابور الإشعارات (WhatsApp/Email) | — |
| `frontend` | Nginx يقدّم الـ SPA + reverse proxy | 80 |
| `ai-service` | Python FastAPI (تنبؤ + RFM + تعرف صوتي) | 8000 (داخلي) |
| `mcp-server` | MCP server (AI-to-DB bridge) | 3001 (داخلي) |

> **PostgreSQL** يتم إنشاؤها كـ Database Service منفصل في Dokploy، وليست جزءاً من `docker-compose.yml`.
>
> **notification-worker** يستخدم نفس صورة الـ backend لكن يشغل `services/notification-worker.js` — يبدأ تلقائياً بعد الـ backend.

---

## 🛠️ استكشاف الأخطاء (Troubleshooting)

### المشروع مش بيفتح بعد الـ deploy
```bash
# افحص حالة الـ containers
docker ps

# افحص logs الـ backend
docker logs gpack_backend --tail 50

# افحص logs الـ postgres
docker logs gpack_postgres --tail 50
```

### الداتابيز مش بتشتغل
```bash
# تأكد إن container الداتابيز شغال على Dokploy
docker ps | grep postgres

# افحص logs الداتابيز
docker logs <dokploy_postgres_container> --tail 50
```

### الـ migrations مش بتشتغل
```bash
# أعد تشغيل الـ backend (بيشتغل migrations تلقائياً عند الـ startup)
docker-compose restart backend

# أو شغل migration يدوي
docker exec gpack_backend node scripts/run-migration.js backend/migrations/000_init_schema.sql
```

### نسيت كلمة سر الأدمن
```bash
# إعادة تعيين كلمة السر عبر SQL على Dokploy database
docker exec <dokploy_postgres_container> psql -U postgres erp_gpack -c \
"UPDATE users SET password_hash = '\$2b\$12\$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi' WHERE email = 'admin@gpack.com';"
```

---

## 📝 ملاحظات مهمة

- **الـ Migrations تلقائية بالكامل:** 70+ ملف `.sql` في `backend/migrations/` تشتغل تلقائياً عند الـ startup. جدول `schema_migrations` يمنع إعادة التطبيق. الـ splitter بيتعامل صح مع `DO $$ ... $$` blocks.
- **البيانات محفوظة:** الـ redeploy لا يمسح الداتابيز (محفوظة في Dokploy Database Service منفصل).
- **SSL تلقائي:** Dokploy يفعّل Let's Encrypt تلقائياً عند ربط الدومين.
- **النسخ الاحتياطي:** اعمل backup يدوي قبل أي تحديث كبير عبر أوامر `pg_dump`.
- **الأمان:** استخدم كلمات سر قوية وفريدة لكل من `JWT_SECRET` و `SHARE_TOKEN_SECRET` و `DATABASE_PASSWORD`.
- **البيع لعملاء جدد:** النظام جاهز للتثبيت على سيرفر جديد — `docker compose up -d` والـ migrations تشتغل تلقائياً وتُنشئ كل شيء من الصفر.
- **بيانات الدخول الافتراضية:** `admin@gpack.com` / `password` — غيّرها فوراً بعد أول تسجيل دخول.
