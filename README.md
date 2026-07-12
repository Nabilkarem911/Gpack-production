# G.PACK ERP 2.0

نظام إدارة المستودعات والمبيعات — مبني على Node.js + Express + PostgreSQL + Docker.

---

## 📋 المتطلبات

- Docker (إصدار 20+ على VPS / Docker Desktop محلياً)
- Git
- VPS بـ Ubuntu 20+ (للإنتاج)
- Dokploy مُثبّت على الـ VPS

---

## 🔧 متغيرات البيئة (.env)

انسخ `.env.example` إلى `.env` واملأ القيم التالية:

| المتغير | الوصف | مثال |
|---------|-------|-------|
| `DATABASE_HOST` | Dokploy Internal Host للداتابيز | `gpackerp-gpackerppostgres-u0f2ho` |
| `DATABASE_NAME` | اسم قاعدة البيانات | `erp_gpack` |
| `DATABASE_USER` | مستخدم قاعدة البيانات | `postgres` |
| `DATABASE_PASSWORD` | كلمة سر قاعدة البيانات | `AS123df456` |
| `JWT_SECRET` | مفتاح تشفير JWT (32 حرف على الأقل) | `MySuperSecretJWTKey2024GpackERP!!` |
| `SHARE_TOKEN_SECRET` | مفتاح تشفير روابط المشاركة (32 حرف على الأقل) | `MyShareTokenSecret2024GpackERP!!` |
| `CORS_ORIGIN` | رابط الدومين (للإنتاج) | `https://gpack.yourdomain.com` |
| `NODE_ENV` | بيئة التشغيل | `production` |

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

### الـ Migrations (تلقائية)

- عند أول تشغيل للـ backend، الـ migration runner بيشتغل تلقائياً.
- ملف `000_init_schema.sql` (نسخة من `init.sql`) بيُنشئ كل الجداول والبيانات الأولية.
- بعدها، أي ملف `.sql` جديد في `backend/migrations/` يشتغل تلقائياً عند كل restart بترتيب رقمي.
- الـ migrations آمنة (idempotent) — تستخدم `IF NOT EXISTS` فلا تتكرر.
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
| كلمة السر | `Admin@2024!` |

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
│   ├── views/            # HTML views (27 صفحة)
│   ├── js/               # Core modules + view controllers
│   │   ├── api.js        # Centralized API layer
│   │   ├── auth.js       # Authentication module
│   │   ├── layout.js     # SPA router + sidebar
│   │   └── app.js        # Bootstrap
│   └── index.html        # Main HTML
├── database/             # init.sql (يُنفّذ مرة واحدة عند أول تشغيل)
├── nginx/                # إعدادات الـ reverse proxy + security headers
├── ai-service/           # Python AI service (demand forecasting)
├── mcp-server/           # MCP server
├── docker-compose.yml    # تعريف الـ services
├── .env.example          # نموذج متغيرات البيئة
└── README.md
```

---

## 📦 الـ Services

| Service | الوصف | Port |
|---------|-------|------|
| **PostgreSQL** | قاعدة بيانات (Dokploy-managed) | 5432 (داخلي) |
| `backend` | Node.js Express API | 3003 → 3000 |
| `frontend` | Nginx يقدّم الـ SPA + reverse proxy | 80 |
| `ai-service` | خدمة الذكاء الاصطناعي (Python) | 3004 → 8000 |
| `mcp-server` | MCP server | 3001 |

> **PostgreSQL** يتم إنشاؤها كـ Database Service منفصل في Dokploy، وليست جزءاً من `docker-compose.yml`.

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

- **الـ Migrations تلقائية:** أي ملف `.sql` في `backend/migrations/` يشتغل تلقائياً عند الـ startup بترتيب رقمي (بدءاً من `000_init_schema.sql`).
- **البيانات محفوظة:** الـ redeploy لا يمسح الداتابيز (محفوظة في Dokploy Database Service منفصل).
- **SSL تلقائي:** Dokploy يفعّل Let's Encrypt تلقائياً عند ربط الدومين.
- **النسخ الاحتياطي:** اعمل backup يدوي قبل أي تحديث كبير عبر أوامر `pg_dump`.
- **الأمان:** استخدم كلمات سر قوية وفريدة لكل من `JWT_SECRET` و `SHARE_TOKEN_SECRET` و `DATABASE_PASSWORD`.
