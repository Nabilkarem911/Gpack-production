---
description: Checklist for creating new view pages in G.PACK ERP
---

# ✅ قائمة التحقق عند إنشاء صفحة جديدة

## خطوات إلزامية (MUST DO)

### 1. Backend (إذا لزم الأمر)
- [ ] إنشاء/تحديث Routes في `backend/routes/`
- [ ] إضافة endpoint في `backend/server.js`
- [ ] التحقق من وجود الجداول في قاعدة البيانات

### 2. Frontend HTML
- [ ] إنشاء ملف HTML في `frontend/views/[view_name].html`
- [ ] استخدام Tailwind CSS + RTL
- [ ] إضافة cache buster في script tag (مثال: `?v=20260503v`)

### 3. Frontend JS
- [ ] إنشاء ملف JS في `frontend/js/views/[view_name].js`
- [ ] تنفيذ دالة `init[ViewName]View()`
- [ ] التعامل مع `apiFetch` للبيانات
- [ ] معالجة الأخطاء والـ toasts

### 4. القائمة الجانبية (CRITICAL - مهم جداً)
- [ ] **إضافة item في `frontend/js/layout.js` → `NAV_ITEMS`**
- [ ] التأكد من الـ `view` يطابق اسم ملف HTML
- [ ] اختيار أيقونة مناسبة (Font Awesome)
- [ ] تحديد الصلاحيات (permission) أو null للجميع

### 5. البناء والاختبار
- [ ] تحديث cache buster
- [ ] `docker compose up -d --build`
- [ ] التحقق من ظهور القائمة في الشريط الجانبي
- [ ] اختبار التنقل بين الصفحات

---

## أمثلة

### إضافة عنصر في NAV_ITEMS:
```javascript
{ view: 'production_orders', label: 'أوامر التشغيل', icon: 'fa-industry', permission: null }
```

### أقسام القائمة الجانبية الحالية:
- **الرئيسية**: dashboard
- **المبيعات**: clients, products, quotations, production_orders
- **المستودع**: inventory
- **الإدارة**: users, settings

---

## ⚠️ أخطاء شائعة

1. **نسيان إضافة القائمة الجانبية** ← الصفحة تكون موجودة لكن لا يمكن الوصول لها
2. **عدم تطابق اسم view مع اسم ملف HTML** ← خطأ 404 في SPA
3. **نسيان cache buster** ← المستخدمين يرون النسخة القديمة
4. **عدم إضافة endpoint في server.js** ← Backend لا يستجيب
