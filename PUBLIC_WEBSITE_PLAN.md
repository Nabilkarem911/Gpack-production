# G.PACK — خطة الموقع الخارجي العام (باك اند منفصل)

> **تاريخ الإنشاء:** 2026-05-03  
> **آخر تحديث:** 2026-05-03  
> **الحالة:** خطة مستقبلية — لا تُنفذ إلا بعد اكتمال نظام الإنتاج الحالي  
> **المعمارية:** نظامين منفصلين تماماً — باك اند مستقل + داتابيز مستقلة + Internal API للربط  
> **قاعدة:** هذا الملف للتخطيط فقط — لم يتم تعديل أي كود أو جدول بناءً عليه

---

## ١. الفكرة العامة

بناء **نظام موقع خارجي مستقل بالكامل** عن نظام الإنتاج الحالي:

- **باك اند منفصل** (Express Server #2 على Port 3001)
- **داتابيز منفصلة** (PostgreSQL: `gpack_website`)
- **فرونت اند منفصل** (مجلد `website/`)
- **داشبورد إدارة الموقع منفصل** (مجلد `website-admin/`)

نظام الإنتاج الحالي **لا يتغير نهائياً**. فقط يقرأ من الموقع عن طريق Internal API.

---

## ٢. المعمارية — نظامين منفصلين

### ٢.١ نظام الإنتاج (الحالي — لا يُعدّل)

| العنصر | التفاصيل |
|--------|----------|
| Express Server | Port 3000 |
| Database | `gpack_erp` (PostgreSQL) |
| Frontend | `frontend/` (الداشبورد الحالي) |
| من يستخدمه | الموظفين فقط |
| المسؤول عنه | مدير الإنتاج / مدير المبيعات |

### ٢.٢ نظام الموقع الخارجي (الجديد)

| العنصر | التفاصيل |
|--------|----------|
| Express Server | Port 3001 |
| Database | `gpack_website` (PostgreSQL منفصل) |
| Frontend (عام) | `website/` (الموقع اللي يشوفه الزائر) |
| Frontend (إدارة) | `website-admin/` (داشبورد إدارة الموقع) |
| من يستخدمه | مدير الموقع (الإدارة) + الزوار (الموقع العام) |
| المسؤول عنه | الشخص المسؤول عن الموقع — مالوش دخل بنظام الإنتاج |

### ٢.٣ الربط بين النظامين — Internal API

نظام الإنتاج يقرأ من الموقع عن طريق HTTP calls داخلية:

```
نظام الإنتاج (Port 3000)
   │
   │  HTTP GET http://web-backend:3001/api/internal/rfqs
   │  HTTP GET http://web-backend:3001/api/internal/rfqs/:id
   │  HTTP GET http://web-backend:3001/api/internal/leads/:id
   │
   ▼
نظام الموقع (Port 3001)
   │
   │  يرد بالبيانات (JSON)
   │
   └── الاتصال داخلي فقط (Docker network) — مش مكشوف للإنترنت
```

**متى نظام الإنتاج يحتاج يقرأ؟**
- لما الموظف يحول RFQ لأوردر → يسحب بيانات العميل والأصناف من الموقع
- لما يظهر إشعار عرض سعر جديد → يقرأ العدد من Internal API

---

## ٣. التدفق الكامل

```
الخطوة 1: مدير الموقع (من داشبورد الموقع — website-admin)
   → يسجل دخول بحساب خاص بالموقع (مش حساب نظام الإنتاج)
   → يضيف صفحات (من نحن، خدمات، إلخ) ويحط محتوى وصور
   → يضيف أصناف في الكتالوج (اسم + صور + وصف + مواصفات) — بدون سعر
   → يتحكم في كل شيء في الموقع

الخطوة 2: الزائر (من الموقع الخارجي — website)
   → يتصفح الصفحات
   → يدخل الكتالوج ويشوف الأصناف
   → يختار أصناف + يحدد كميات
   → يملأ بياناته (اسم، شركة، تليفون، إيميل)
   → يرسل طلب عرض سعر (RFQ)

الخطوة 3: مدير الموقع (من داشبورد الموقع)
   → يشوف طلبات عروض الأسعار الواردة
   → يبلّغ فريق المبيعات في نظام الإنتاج

الخطوة 4: فريق المبيعات (من داشبورد الإنتاج الحالي)
   → يشوف إشعار: طلب عرض سعر جديد (عن طريق Internal API)
   → يسحب بيانات الطلب من الموقع
   → يسعّر الأصناف
   → يطبع PDF عرض السعر ويبعته للعميل
   → لو العميل وافق → يحول RFQ لأوردر في نظام الإنتاج

الخطوة 5: الدورة العادية في نظام الإنتاج
   → أوردر → إنتاج → استلام → تسليم → فاتورة
```

---

## ٤. الجداول — داتابيز `gpack_website` (منفصلة)

### ٤.١ المستخدمين (خاصين بالموقع فقط)

```sql
-- مستخدمي إدارة الموقع (منفصلين عن users في نظام الإنتاج)
CREATE TABLE web_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'admin',         -- admin, editor
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### ٤.٢ إدارة المحتوى (CMS)

```sql
CREATE TABLE cms_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    meta_description TEXT,
    is_published BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0,
    show_in_navbar BOOLEAN DEFAULT true,
    created_by UUID REFERENCES web_users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cms_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID REFERENCES cms_pages(id) ON DELETE CASCADE,
    section_type VARCHAR(50) NOT NULL,
    title VARCHAR(255),
    content TEXT,
    media JSONB DEFAULT '[]',
    settings JSONB DEFAULT '{}',
    sort_order INTEGER DEFAULT 0,
    is_visible BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cms_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### ٤.٣ كتالوج العرض

```sql
CREATE TABLE catalog_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    image TEXT,
    parent_id UUID REFERENCES catalog_categories(id),
    sort_order INTEGER DEFAULT 0,
    is_visible BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE catalog_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES catalog_categories(id),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    images JSONB DEFAULT '[]',
    specifications JSONB DEFAULT '{}',
    is_visible BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_by UUID REFERENCES web_users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### ٤.٤ طلبات عروض الأسعار (RFQ)

```sql
CREATE SEQUENCE rfq_number_seq START WITH 6001 INCREMENT BY 1;

CREATE TABLE public_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    city VARCHAR(100),
    notes TEXT,
    status VARCHAR(20) DEFAULT 'new',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public_rfqs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfq_number INTEGER UNIQUE NOT NULL DEFAULT nextval('rfq_number_seq'),
    lead_id UUID REFERENCES public_leads(id),
    status VARCHAR(30) DEFAULT 'pending',
    -- pending, viewed, priced, sent, accepted, converted, rejected
    internal_notes TEXT,
    total_estimate DECIMAL(15,2),
    tax_amount DECIMAL(15,2),
    grand_total DECIMAL(15,2),
    priced_by UUID REFERENCES web_users(id),
    priced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public_rfq_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfq_id UUID REFERENCES public_rfqs(id) ON DELETE CASCADE,
    catalog_item_id UUID REFERENCES catalog_items(id),
    quantity DECIMAL(15,3) NOT NULL,
    custom_specs TEXT,
    quoted_price DECIMAL(15,2),
    line_total DECIMAL(15,2) GENERATED ALWAYS AS (
        quantity * COALESCE(quoted_price, 0)
    ) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## ٥. الـ API — باك اند الموقع (Port 3001)

### ٥.١ API عامة (بدون JWT) — الموقع الخارجي

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/api/public/settings` | إعدادات الموقع (لوجو، ألوان، سوشيال) |
| GET | `/api/public/pages` | قائمة الصفحات المنشورة (للنافبار) |
| GET | `/api/public/pages/:slug` | محتوى صفحة + أقسامها |
| GET | `/api/public/catalog/categories` | تصنيفات الكتالوج |
| GET | `/api/public/catalog` | أصناف الكتالوج (مع فلتر) |
| GET | `/api/public/catalog/:slug` | تفاصيل صنف |
| POST | `/api/public/rfq` | إرسال طلب عرض سعر |

### ٥.٢ API محمية (JWT خاص بالموقع) — داشبورد إدارة الموقع

| Method | Endpoint | الوصف |
|--------|----------|-------|
| POST | `/api/auth/login` | تسجيل دخول مدير الموقع |
| GET | `/api/auth/me` | بيانات المستخدم الحالي |
| CRUD | `/api/cms/pages` | إدارة الصفحات |
| CRUD | `/api/cms/pages/:id/sections` | إدارة الأقسام |
| PUT | `/api/cms/settings` | إعدادات الموقع |
| CRUD | `/api/catalog/categories` | إدارة التصنيفات |
| CRUD | `/api/catalog/items` | إدارة الأصناف |
| GET | `/api/rfqs` | قائمة عروض الأسعار الواردة |
| GET | `/api/rfqs/:id` | تفاصيل طلب |
| PUT | `/api/rfqs/:id/price` | تسعير الأصناف |
| PUT | `/api/rfqs/:id/status` | تغيير الحالة |
| GET | `/api/leads` | العملاء المحتملين |
| POST | `/api/uploads` | رفع صور |

### ٥.٣ Internal API (بدون JWT — Docker network فقط)

هذه المسارات **لا تُكشف للإنترنت** — فقط نظام الإنتاج يستدعيها داخلياً:

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/api/internal/rfqs/pending-count` | عدد الطلبات الجديدة (للإشعارات) |
| GET | `/api/internal/rfqs` | قائمة الطلبات |
| GET | `/api/internal/rfqs/:id` | تفاصيل طلب + أصناف + بيانات العميل |
| GET | `/api/internal/leads/:id` | بيانات عميل محتمل |
| PUT | `/api/internal/rfqs/:id/mark-converted` | تعليم الطلب كـ "محوّل" |

---

## ٦. هيكل الملفات — المشروع الجديد

```
📁 gpack-website/                         ← مشروع منفصل تماماً
│
├── 📁 web-backend/                       ← Express Server #2
│   ├── server.js                         ← Entry point (Port 3001)
│   ├── db.js                             ← PostgreSQL pool (gpack_website)
│   ├── package.json
│   ├── Dockerfile
│   ├── .env
│   ├── 📁 middleware/
│   │   └── authMiddleware.js             ← JWT خاص بالموقع
│   ├── 📁 routes/
│   │   ├── auth.js                       ← لوجين مدير الموقع
│   │   ├── public.js                     ← API عامة (صفحات + كتالوج + RFQ)
│   │   ├── cms.js                        ← إدارة المحتوى (محمي)
│   │   ├── catalog.js                    ← إدارة الكتالوج (محمي)
│   │   ├── rfqs.js                       ← عروض الأسعار (محمي)
│   │   ├── leads.js                      ← العملاء المحتملين (محمي)
│   │   ├── uploads.js                    ← رفع الصور (محمي)
│   │   └── internal.js                   ← Internal API (Docker فقط)
│   └── 📁 uploads/                       ← مجلد الصور
│       ├── catalog/
│       ├── pages/
│       └── settings/
│
├── 📁 website/                           ← الموقع العام (اللي يشوفه الزائر)
│   ├── index.html                        ← الصفحة الرئيسية
│   ├── page.html                         ← صفحة ديناميكية
│   ├── catalog.html                      ← الكتالوج
│   ├── item.html                         ← تفاصيل صنف
│   ├── rfq.html                          ← طلب عرض سعر
│   ├── 📁 css/
│   │   └── site.css
│   └── 📁 js/
│       ├── site-router.js
│       ├── site-api.js                   ← اتصال بـ /api/public/*
│       ├── catalog.js
│       └── rfq.js
│
├── 📁 website-admin/                     ← داشبورد إدارة الموقع
│   ├── index.html                        ← SPA shell
│   ├── login.html
│   ├── 📁 views/
│   │   ├── dashboard.html                ← ملخص (عدد طلبات جديدة، إلخ)
│   │   ├── pages.html                    ← إدارة الصفحات
│   │   ├── sections.html                 ← إدارة الأقسام
│   │   ├── catalog-categories.html       ← تصنيفات الكتالوج
│   │   ├── catalog-items.html            ← أصناف الكتالوج
│   │   ├── rfqs.html                     ← عروض الأسعار الواردة
│   │   ├── leads.html                    ← العملاء المحتملين
│   │   └── settings.html                ← إعدادات الموقع
│   └── 📁 js/
│       ├── app.js
│       ├── api.js                        ← اتصال بـ /api/*
│       ├── auth.js
│       └── 📁 views/
│           ├── dashboard.js
│           ├── pages.js
│           ├── catalog.js
│           ├── rfqs.js
│           └── settings.js
│
├── 📁 database/
│   └── init.sql                          ← Schema الداتابيز gpack_website
│
├── docker-compose.yml                    ← Docker Compose للموقع
└── 📁 nginx/
    └── nginx.conf                        ← Nginx للموقع
```

---

## ٧. Docker Compose — المشروع الجديد

```yaml
# docker-compose.yml (gpack-website)
version: '3.8'

services:
  web-db:
    image: postgres:14
    environment:
      POSTGRES_DB: gpack_website
      POSTGRES_USER: gpack_web
      POSTGRES_PASSWORD: ${WEB_DB_PASSWORD}
    volumes:
      - web_db_data:/var/lib/postgresql/data
      - ./database/init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5433:5432"

  web-backend:
    build: ./web-backend
    environment:
      PORT: 3001
      DB_HOST: web-db
      DB_PORT: 5432
      DB_NAME: gpack_website
      DB_USER: gpack_web
      DB_PASSWORD: ${WEB_DB_PASSWORD}
      JWT_SECRET: ${WEB_JWT_SECRET}
    depends_on:
      - web-db
    ports:
      - "3001:3001"
    volumes:
      - uploads_data:/app/uploads

  web-nginx:
    image: nginx:alpine
    ports:
      - "8080:80"
    volumes:
      - ./website:/usr/share/nginx/website
      - ./website-admin:/usr/share/nginx/website-admin
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf
      - uploads_data:/app/uploads
    depends_on:
      - web-backend

volumes:
  web_db_data:
  uploads_data:
```

---

## ٨. Nginx — توجيه الطلبات للموقع

```nginx
# nginx.conf (gpack-website)

# الموقع العام
server {
    listen 80;

    # الموقع الخارجي (الصفحة الرئيسية)
    location / {
        root /usr/share/nginx/website;
        try_files $uri $uri/ /index.html;
    }

    # داشبورد إدارة الموقع
    location /admin {
        alias /usr/share/nginx/website-admin;
        try_files $uri $uri/ /admin/index.html;
    }

    # الصور المرفوعة
    location /uploads {
        alias /app/uploads;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # API الموقع
    location /api {
        proxy_pass http://web-backend:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## ٩. الربط مع نظام الإنتاج الحالي

### ما يُضاف لنظام الإنتاج (تعديلات بسيطة فقط)

| الملف | التعديل |
|-------|---------|
| `docker-compose.yml` | إضافة `web-backend` في `networks` المشتركة |
| `backend/routes/orders.js` أو ملف جديد | endpoint يستدعي Internal API لسحب RFQ |
| `frontend/js/layout.js` | إشعار بسيط بعدد الطلبات الجديدة (اختياري) |

### كيف نظام الإنتاج يستدعي Internal API

```javascript
// في نظام الإنتاج — عند تحويل RFQ لأوردر
const axios = require('axios'); // أو fetch

const WEB_API = process.env.WEB_INTERNAL_API || 'http://web-backend:3001';

// سحب تفاصيل طلب عرض سعر
async function fetchRFQ(rfqId) {
    const res = await axios.get(`${WEB_API}/api/internal/rfqs/${rfqId}`);
    return res.data;
    // { rfq: {...}, lead: {...}, items: [...] }
}

// تعليم الطلب كمحوّل
async function markRFQConverted(rfqId, orderId) {
    await axios.put(`${WEB_API}/api/internal/rfqs/${rfqId}/mark-converted`, {
        converted_order_id: orderId
    });
}
```

### Docker Network المشتركة

```yaml
# في docker-compose.yml لنظام الإنتاج — إضافة:
networks:
  gpack-internal:
    external: true

# في docker-compose.yml للموقع — إضافة:
networks:
  gpack-internal:
    driver: bridge
```

---

## ١٠. أنواع الأقسام (Section Types) في الـ CMS

| النوع | الوصف | الحقول |
|-------|-------|--------|
| `hero` | بانر رئيسي كبير | عنوان، وصف، صورة خلفية، زر CTA |
| `text` | فقرة نصية | عنوان اختياري، محتوى نصي |
| `image_grid` | شبكة صور | مصفوفة صور (2، 3، أو 4 أعمدة) |
| `features` | قائمة ميزات | مصفوفة {أيقونة، عنوان، وصف} |
| `cta` | دعوة للإجراء | عنوان، وصف، نص الزر، رابط |
| `testimonials` | آراء العملاء | مصفوفة {اسم، شركة، تعليق، صورة} |
| `gallery` | معرض صور | مصفوفة صور مع lightbox |
| `video` | فيديو | رابط يوتيوب أو ملف فيديو |
| `stats` | أرقام وإحصائيات | مصفوفة {رقم، وصف} |
| `team` | فريق العمل | مصفوفة {اسم، منصب، صورة} |

---

## ١١. مراحل التنفيذ

### المرحلة A — البنية التحتية
1. إنشاء مجلد `gpack-website/` منفصل
2. إنشاء `docker-compose.yml` + `Dockerfile` + `nginx.conf`
3. إنشاء داتابيز `gpack_website` + ملف `init.sql`
4. إنشاء `web-backend/server.js` + `db.js` + JWT middleware
5. إنشاء حساب admin أولي

### المرحلة B — API الموقع
1. `/api/auth/*` — تسجيل دخول مدير الموقع
2. `/api/public/*` — API عامة (صفحات + كتالوج + RFQ)
3. `/api/cms/*` — إدارة المحتوى
4. `/api/catalog/*` — إدارة الكتالوج
5. `/api/rfqs/*` — عروض الأسعار الواردة
6. `/api/uploads` — رفع الصور
7. `/api/internal/*` — Internal API لنظام الإنتاج

### المرحلة C — داشبورد إدارة الموقع (website-admin)
1. صفحة اللوجين
2. صفحة الداشبورد (ملخص)
3. إدارة الصفحات + الأقسام (drag & drop)
4. إعدادات الموقع (لوجو، ألوان، سوشيال)
5. إدارة الكتالوج (تصنيفات + أصناف)
6. عروض الأسعار الواردة + تسعير
7. العملاء المحتملين

### المرحلة D — الموقع الخارجي (website)
1. الصفحة الرئيسية
2. عارض الصفحات الديناميكية
3. الكتالوج (فلترة بالتصنيف)
4. تفاصيل صنف
5. نموذج طلب عرض سعر
6. تصميم responsive + حديث

### المرحلة E — الربط مع نظام الإنتاج
1. إنشاء Docker network مشتركة
2. إضافة Internal API call في نظام الإنتاج
3. إشعارات في داشبورد الإنتاج (اختياري)
4. تحويل RFQ → أوردر في نظام الإنتاج

---

## ١٢. اعتبارات أمنية

| النقطة | الحل |
|--------|------|
| API عامة بدون JWT | Rate limiting على `/api/public/*` |
| رفع صور | التحقق من نوع الملف + حجم أقصى (5MB) |
| طلبات RFQ | Rate limiting (5 طلبات/ساعة/IP) |
| Internal API | Docker network فقط — مش مكشوف للإنترنت |
| JWT الموقع | منفصل عن JWT الإنتاج — secret مختلف |
| CORS | تحديد الـ origin المسموح |
| XSS | تنظيف المحتوى قبل الحفظ |
| SQL Injection | Parameterized queries |

---

## ١٣. ملخص

- **نظامين منفصلين تماماً** — كل واحد له باك اند + داتابيز + فرونت اند
- **8 جداول** في داتابيز `gpack_website` + 1 sequence
- **8 ملفات routes** في باك اند الموقع
- **8 صفحات** في داشبورد إدارة الموقع
- **5 صفحات** في الموقع الخارجي العام
- **Internal API** للربط بين النظامين (Docker network)
- **لا يتم تعديل نظام الإنتاج الحالي** إلا إضافات بسيطة للربط
- **التقنيات:** Vanilla JS + Tailwind + Express + PostgreSQL + Docker

> **⚠️ لا تبدأ التنفيذ إلا بعد اكتمال نظام الإنتاج الحالي بالكامل.**

---

*نهاية الخطة*
