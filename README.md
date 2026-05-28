# G.PACK ERP 2.0

نظام إدارة المستودعات والمبيعات — مبني على Node.js + PostgreSQL + Docker.

---

## التشغيل المحلي

### المتطلبات
- Docker Desktop
- Git

### الخطوات

```bash
# 1. انسخ المشروع
git clone https://github.com/Nabilkarem911/Gpack-production.git
cd Gpack-production

# 2. أنشئ ملف البيئة
copy .env.example .env
# عدّل القيم في .env

# 3. شغّل المشروع
docker-compose up -d
```

الموقع يفتح على: **http://localhost**

---

## متغيرات البيئة (.env)

| المتغير | الوصف |
|---------|-------|
| `DB_PASSWORD` | كلمة سر قاعدة البيانات |
| `JWT_SECRET` | مفتاح تشفير JWT (32 حرف على الأقل) |

---

## الرفع على VPS مع Dokploy

1. في Dokploy → **New Project → Docker Compose**
2. اربطه بـ GitHub repo
3. أضف متغيرات البيئة في خانة Environment Variables
4. اضغط **Deploy**

### التحديث بعد كل تعديل

```bash
git add .
git commit -m "وصف التعديل"
git push
```

ثم في Dokploy اضغط **Redeploy** — الداتابيز والبيانات لا تُمس.

---

## هيكل المشروع

```
├── backend/          # Node.js + Express API
│   ├── migrations/   # SQL migrations (تشتغل تلقائياً عند الـ startup)
│   ├── routes/       # API routes
│   └── server.js     # Entry point
├── frontend/         # Vanilla JS + HTML + Tailwind CSS
├── database/         # init.sql (أول مرة فقط)
├── nginx/            # إعدادات الـ reverse proxy
└── docker-compose.yml
```

---

## الـ Migrations

أي ملف `.sql` جديد تضيفه في `backend/migrations/` بيشتغل تلقائياً عند أول startup ولا يتكرر.
