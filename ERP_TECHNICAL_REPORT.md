# تقرير إصلاحات ERP — مخصص للـ Technical Agent

## معلومات المشروع

| العنصر | القيمة |
|--------|--------|
| **اسم المشروع** | G.PACK ERP 2.0 |
| **الرابط** | `https://erp.gpacksa.com` |
| **السيرفر** | `187.127.76.226` |
| **SSH** | `ssh -i .ssh_key root@187.127.76.226` |
| **Dokploy Project** | `Gpack-ERP` (ID: `VhWEL3oc4ZY0Vid1iFczZ`) |
| **Dokploy App ID** | `5wTpIj4iHq0HSqEK93EnQ` |
| **Dokploy Env ID** | `GAai2diupDOsp1oH_6N8o` |
| **Postgres ID** | `L3984jk5QtNkFWohlcznw` |
| **docker-compose path** | `/etc/dokploy/compose/gpackerp-gpackerp-4wwbpk/code/docker-compose.yml` |
| **Container names** | `gpackerp-gpackerp-4wwbpk-frontend-1`, `gpackerp-gpackerp-4wwbpk-backend-1`, `gpackerp-gpackerp-4wwbpk-ai-service-1`, `gpackerp-gpackerp-4wwbpk-mcp-server-1` |
| **Container IP (current)** | `10.0.1.3` (frontend), يتغير عند كل deploy |
| **Frontend port** | `80` (nginx داخل container) |
| **Backend port** | `3000` |
| **AI Service port** | `8000` |
| **MCP Server port** | `3001` |

---

## البنية المعمارية

```
Internet → Cloudflare (proxy, SSL, WAF) → Traefik (port 80/443) → nginx (frontend container, port 80) → static files + /api/ proxy to backend (port 3000)
```

- **Frontend**: SPA (HTML + Tailwind CSS + vanilla JS modules: `api.js`, `auth.js`, `layout.js`, `app.js`)
- **Backend**: Node.js API على port 3000
- **Database**: PostgreSQL
- **AI Service**: Python service على port 8000
- **MCP Server**: على port 3001
- **Web Server داخل container**: nginx/1.31.2

---

## إصلاحات السيرفر (تمت بالفعل ✅)

تم تنفيذ الإصلاحات التالية على السيرفر و Cloudflare:

1. ✅ Traefik: redirect-to-https على `erp.gpacksa.com`
2. ✅ Traefik: health check على frontend container (`wget --spider http://localhost:80/`)
3. ✅ Cloudflare: تفعيل proxy (Orange Cloud) على `erp.gpacksa.com`
4. ✅ Cloudflare: SSL mode = Full (strict)
5. ✅ Cloudflare: HSTS (max-age=31536000, includeSubDomains, preload)
6. ✅ Cloudflare: Min TLS = 1.2
7. ✅ Cloudflare: WAF Managed Ruleset
8. ✅ Cloudflare: Minify (CSS + JS + HTML)
9. ✅ Cloudflare: Page Rule (Always Use HTTPS)
10. ✅ Cloudflare: DMARC = p=quarantine
11. ✅ docker-compose: health check متضاف للـ frontend service

---

## إصلاحات الكود (تمت بالفعل ✅)

### #12 — إصلاح `/api/auth/login` بيرجع 500 Internal Server Error

**الحالة**: تم الإصلاح ✅

**السبب الجذري (سابقاً)**: كان الـ endpoint يرجع 500 بسبب مشاكل في environment variables أو missing dependencies.

**الوضع الحالي**: الكود سليم في `backend/routes/auth.js`:
- bcrypt.compare للتحقق من كلمة المرور
- JWT.sign باستخدام `process.env.JWT_SECRET`
- cookie-parser مُفعّل في `server.js`
- Zod validation على login body عبر `validateBody(loginBody)`
- HttpOnly cookie يُضبط تلقائياً بعد تسجيل الدخول

---

### #13 — Rate Limiting على `/api/auth/login`

**الحالة**: تم الإصلاح ✅

**الوضع الحالي**: `backend/server.js` يحتوي على:
```javascript
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 دقيقة
  max: 50,                     // 50 محاولة (مرفوعة من 10 للتطوير)
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' }
});
_mountRoute('/auth', loginLimiter);  // مُطبّق على كل /api/auth/*
```

كذلك يوجد rate limiter عام:
```javascript
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,   // دقيقة
  max: 200,               // 200 request لكل IP
});
_mountRoute('/', apiLimiter);
```

---

### #14 — Input Validation لكل POST routes

**الحالة**: تم ✅

**الوضع الحالي**: `backend/utils/validators.js` يحتوي على Zod schemas لـ:
- `loginBody` — مُطبّق في `auth.js`
- `clientCreate` — مُطبّق في `clients.js`
- `orderCreate` — مُطبّق في `orders.js`
- `invoiceCreate` — مُطبّق في `invoices.js`
- `receiptVoucherCreate` + `voucherCancel` — مُطبّق في `receipt-vouchers.js`
- `productCreate` + `productUpdate` + `variantCreate` + `variantUpdate` — مُطبّق في `products.js`
- `categoryCreate` + `categoryUpdate` — مُطبّق في `categories.js`
- `unitCreate` + `unitUpdate` — مُطبّق في `units.js`
- `deliveryNoteCreate` + `deliveryNoteDispatch` — مُطبّق في `delivery-notes.js`
- `manufacturerOrderCreate` + `StatusUpdate` + `Update` + `Receive` + `Pricing` — مُطبّق في `manufacturer_orders.js`
- `paymentVoucherCreate` + `voucherCancel` — مُطبّق في `payment-vouchers.js`
- `journalEntryCreate` — مُطبّق في `journal-entries.js`
- `taskCreate` + `taskUpdate` + `subtaskCreate` + `subtaskUpdate` + `taskCommentCreate` — مُطبّق في `tasks.js`
- `userCreate` + `userUpdate` + `roleCreate` + `roleUpdate` — مُطبّق في `users.js`
- `supplierCreate` + `supplierUpdate` — مُطبّق في `suppliers.js`
- `receivingVoucherCreate` — مُطبّق في `receiving-vouchers.js`
- `purchaseInvoiceCreate` — مُطبّق في `purchase-invoices.js`
- `purchaseReturnCreate` — مُطبّق في `purchase-returns.js`
- `termsCreate` + `termsUpdate` — مُطبّق في `terms.js`

كل POST/PUT/PATCH routes الآن تستخدم `validateBody()` middleware.

---

### #15 — `unsafe-eval` في CSP Header

**الحالة**: يُحتفظ به مؤقتاً ⚠️

**السبب**: Tailwind CDN JIT mode يتطلب `unsafe-eval`. الحل الدائم هو build Tailwind locally بدلاً من CDN، لكن هذا يتطلب build step في الـ Dockerfile.

**الوضع الحالي**: `nginx/nginx.conf` يحتوي على CSP مع `unsafe-eval` و `unsafe-inline` في `script-src`. تم تنظيف باقي الـ CSP.

---

### #16 — إخفاء إصدار nginx

**الحالة**: تم الإصلاح ✅

**الوضع الحالي**: `nginx/nginx.conf` يحتوي على `server_tokens off;`.

---

### #17 — HSTS header في nginx

**الحالة**: تم الإصلاح ✅

**الوضع الحالي**: `nginx/nginx.conf` يحتوي على:
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

---

### #18 — ضغط JS files (Minification)

**الحالة**: تم ✅

**الوضع الحالي**:
- `nginx/nginx.conf` به gzip compression مُفعّل
- `frontend/Dockerfile` أصبح multi-stage: stage 1 يستخدم `terser` لـ minify كل JS files، stage 2 ينسخ النتيجة لـ nginx

```dockerfile
FROM node:alpine AS builder
RUN npm install -g terser@5
COPY ./frontend /build/frontend
RUN find /build/frontend/js -name "*.js" -type f | while read f; do \
      terser --compress --mangle --output "$f" "$f" || true; \
    done

FROM nginx:alpine
COPY --from=builder /build/frontend/ /usr/share/nginx/html/
```

---

### #19 — ضغط صورة اللوجو

**الحالة**: لم يتم ❌

**الحجم الحالي**: 796KB — حجم كبير جداً.

**الحل المطلوب**: تحويل اللوجو لـ WebP أو SVG، أو ضغط الـ PNG لـ ~50KB.

---

### #20 — التخلص من localStorage للـ Token

**الحالة**: تم الإصلاح ✅

**الوضع الحالي**:
- **Backend** (`backend/routes/auth.js`): JWT يُضبط كـ HttpOnly cookie مع `secure: true` و `sameSite: strict` في production. لا يُرجع token في response body.
- **Middleware** (`backend/middleware/authMiddleware.js`): يقرأ token من HttpOnly cookie أولاً، ثم fallback لـ Authorization header (للـ external clients).
- **Frontend** (`frontend/js/api.js`): `credentials: 'include'` مُفعّل. لا يقرأ token من localStorage.
- **Frontend** (`frontend/js/auth.js`): لا يخزن token في localStorage. يعتمد على `/api/auth/me` (cookie) لاستعادة الجلسة.
- **Logout**: backend يمسح الـ cookie، frontend يمسح `gpack_user` فقط (بيانات غير حساسة).

---

### #21 — إصلاح `robots.txt` بيرجع HTML

**الحالة**: تم الإصلاح ✅

**الوضع الحالي**:
- `frontend/robots.txt` تم إنشاؤه:
```
User-agent: *
Disallow: /api/
Allow: /
```
- `nginx/nginx.conf` تم إضافة rule مخصصة:
```nginx
location = /robots.txt {
    try_files $uri =404;
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    expires -1;
}
```

---

### إصلاحات إضافية (تمت بالفعل ✅)

#### Health check في docker-compose.yml

**الحالة**: تم الإصلاح ✅

`docker-compose.yml` الآن يحتوي على health check للـ frontend:
```yaml
healthcheck:
  test: ["CMD-SHELL", "wget --spider -q http://localhost:80/ || exit 1"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 10s
```

#### Helmet CSP conflict

**الحالة**: تم الإصلاح ✅

`backend/server.js` تم تعطيل CSP و HSTS من helmet (nginx يتولى ذلك):
```javascript
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  hsts: false,
}));
```

#### Static asset caching في nginx

**الحالة**: تم الإصلاح ✅

`nginx/nginx.conf` تم إضافة caching للصور والخطوط:
```nginx
location ~* \.(png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    expires 30d;
    add_header Cache-Control "public, max-age=2592000";
}
```

---

## ملاحظات إضافية للـ Technical Agent

### مشكلة الـ deploy و IP المتغير

عند كل deploy جديد لـ ERP عبر Dokploy:
1. الـ container القديم بيتوقف وواحد جديد بيبدأ
2. الـ container الجديد بياخد IP داخلي جديد (مثلاً `10.0.1.3` → `10.0.1.7`)
3. ملف Traefik `/etc/dokploy/traefik/dynamic/erp-gpacksa-custom.yml` بيحتاج update بالـ IP الجديد
4. لو الـ IP اتغير والمف ما اتحدثش، الموقع هيقع

**الحل المقترح**:
- **الخيار 1 (أفضل)**: إضافة domain `erp.gpacksa.com` من لوحة Dokploy نفسها (مش يدوي) — Dokploy هيدير الـ router تلقائياً
- **الخيار 2**: إضافة post-deploy script يعمل update لـ IP في ملف Traefik
- **الخيار 3**: استخدام Docker service name بدلاً من IP في Traefik config (لو الـ container على نفس الـ network)

### الـ docker-compose الحالي

الـ docker-compose الحالي موجود في:
```
/etc/dokploy/compose/gpackerp-gpackerp-4wwbpk/code/docker-compose.yml
```

وتم تعديله بالفعل لإضافة health check للـ frontend. الـ labels الموجودة في الـ docker-compose بتاعة الـ frontend container مش بيقرأها Traefik لأن Traefik مضبط على `swarmMode: true` والـ ERP مش swarm service (docker-compose عادي).

### ملفات Traefik المهمة

| الملف | الوصف |
|------|--------|
| `/etc/dokploy/traefik/traefik.yml` | الإعدادات الرئيسية |
| `/etc/dokploy/traefik/dynamic/erp-gpacksa-custom.yml` | router + service لـ erp.gpacksa.com |
| `/etc/dokploy/traefik/dynamic/gpackerp-frontend.yml` | router + service لـ sslip.io subdomain |
| `/etc/dokploy/traefik/dynamic/middlewares.yml` | middlewares مشتركة (redirect-to-https) |

### أمر إعادة تشغيل Traefik (لو لزم)
```bash
docker service update --force traefik.1.fl9y4kkqkxif5wrbiuh192l6b
```

### أمر فحص الـ logs
```bash
# Backend logs
docker logs gpackerp-gpackerp-4wwbpk-backend-1 --tail 100 -f

# Frontend (nginx) logs
docker logs gpackerp-gpackerp-4wwbpk-frontend-1 --tail 100 -f

# Traefik logs
docker service logs traefik.1.fl9y4kkqkxif5wrbiuh192l6b --tail 100
```

### أوامر فحص سريعة
```bash
# Health check
curl -s https://erp.gpacksa.com/api/health -k

# Login test
curl -s -X POST https://erp.gpacksa.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@gpacksa.com","password":"test"}' -k

# Headers check
curl -s -I https://erp.gpacksa.com -k

# HTTP redirect check
curl -s -I http://erp.gpacksa.com
```

---

## أولويات الإصلاح

| الأولوية | رقم الإصلاح | الوصف | الحالة |
|----------|------------|--------|--------|
| 🔴 حرج | #12 | إصلاح `/api/auth/login` 500 error | ✅ تم |
| 🟡 أمني | #13 | Rate limiting على login | ✅ تم |
| 🟡 أمني | #14 | Input validation | ✅ تم |
| 🟡 أمني | #15 | إزالة unsafe-eval من CSP | ⚠️ مؤقت (Tailwind CDN) |
| 🟡 أمني | #17 | HSTS في nginx | ✅ تم |
| 🟡 أمني | #20 | إزالة localStorage token | ✅ تم |
| 🟢 أداء | #18 | Minify JS files | ✅ تم (terser + gzip) |
| 🟢 أداء | #19 | ضغط اللوجو | ❌ لم يتم |
| 🟢 أمني | #16 | إخفاء إصدار nginx | ✅ تم |
| 🟢 SEO | #21 | إصلاح robots.txt | ✅ تم |
| 🟢 بنية | — | Health check في docker-compose | ✅ تم |
| 🟢 أمني | — | Helmet CSP conflict | ✅ تم |

---

## تقرير الحالة الحالية (بعد كل الإصلاحات)

| الفحص | النتيجة |
|-------|---------|
| `https://erp.gpacksa.com` | ✅ 200 OK |
| `http://erp.gpacksa.com` | ✅ 301 → HTTPS |
| `https://erp.gpacksa.com/api/health` | ✅ 200, db_connected: true |
| `POST /api/auth/login` | ✅ 200, HttpOnly cookie set |
| `POST /api/auth/logout` | ✅ 200, cookie cleared |
| `GET /api/auth/me` | ✅ 200, cookie-based auth |
| Cloudflare Proxy | ✅ مفعّل (IP مخفي) |
| HSTS (Cloudflare + nginx) | ✅ مفعّل |
| SSL | ✅ Full (strict) |
| WAF | ✅ Managed Ruleset |
| Minify | ✅ CSS + JS + HTML (Cloudflare) |
| Gzip (nginx) | ✅ مفعّل |
| Min TLS | ✅ 1.2 |
| DMARC | ✅ p=quarantine |
| Page Rule HTTPS | ✅ مفعّل |
| Health check (docker) | ✅ مفعّل (frontend) |
| server_tokens | ✅ off |
| robots.txt | ✅ يُرجع TXT صحيح |
| Rate limiting (login) | ✅ 50/15min |
| Rate limiting (API) | ✅ 200/min |
| Input validation | ✅ شامل (كل endpoints) |
| localStorage token | ✅ تمت إزالته |
| Helmet CSP conflict | ✅ تم حله |
| Static asset caching | ✅ 30 يوم |
| JS minification | ✅ terser build step |
