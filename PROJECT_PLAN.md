# G.PACK 2.0 — خطة التطوير (محدّثة 2026-05-17)

---

## الحالة الكاملة للنظام

### ✅ مكتمل وشغّال

| الصفحة | الملف | الـ Backend | ملاحظات |
|--------|-------|------------|---------|
| لوحة التحكم | dashboard.html | dashboard.js | ✅ |
| العملاء + ملف العميل | clients / client-profile | clients.js | ✅ |
| الموردين + ملف المورد | suppliers / supplier-profile | suppliers.js | ✅ |
| المنتجات + حركات الأصناف | products / product-movements | products.js | ✅ |
| عروض الأسعار | quotations.html | - | ✅ |
| أوامر التشغيل | production_orders.html | orders.js | ✅ |
| فواتير المبيعات | sales-invoices + detail | invoices.js | ✅ موجود ومفعّل |
| فواتير المشتريات | purchase-invoices.html | purchase-invoices.js | ✅ موجود ومفعّل |
| المستودعات + المخزون | warehouses.html | inventory.js | ✅ |
| سندات صرف VMI | vmi-dispatch.html | vmi.js | ✅ |
| كشف الحساب | account-statement.html | account-statement.js | ✅ |
| سندات القبض | receipt-voucher.html | receipt-vouchers.js | ✅ + طباعة |
| سندات الصرف | payment-voucher.html | payment-vouchers.js | ✅ + طباعة |
| المستخدمون | users.html | users.js | ✅ |
| الإعدادات | settings.html | - | ✅ |

---

## الأولويات المتبقية (مرتبة)

### 🔴 الأولوية 1 — طباعة فواتير المبيعات والمشتريات
> **السبب:** الفواتير موجودة لكن بدون طباعة — أهم وظيفة يومية

| # | المهمة | الحالة |
|---|--------|--------|
| P1.1 | طباعة فاتورة مبيعات من sales-invoice-detail.js | ✅ |
| P1.2 | طباعة فاتورة مشتريات من purchase-invoices.js | ✅ |

---

### 🟡 الأولوية 2 — مرتجع المبيعات
> **السبب:** يعتمد على وجود الفاتورة (موجودة ✅)

| # | المهمة | الحالة |
|---|--------|--------|
| P2.1 | Backend: جدول + API مرتجع المبيعات | ⏳ |
| P2.2 | Frontend: sales-returns.html + JS | ⏳ |
| P2.3 | تأثير المرتجع على المخزون والحسابات | ⏳ |

---

### 🟡 الأولوية 3 — مرتجع المشتريات
> **السبب:** يعتمد على وجود فاتورة المشتريات (موجودة ✅)

| # | المهمة | الحالة |
|---|--------|--------|
| P3.1 | Backend: جدول + API مرتجع المشتريات | ⏳ |
| P3.2 | Frontend: purchase-returns.html + JS | ⏳ |

---

### 🟢 الأولوية 4 — قيد اليومية + الدليل المحاسبي
> **السبب:** أداة تقارير ومحاسبة — لا تعتمد على شيء آخر لكن أقل إلحاحاً

| # | المهمة | الحالة |
|---|--------|--------|
| P4.1 | Backend: API قيود يومية يدوية | ⏳ |
| P4.2 | Frontend: journal-entry.html + JS | ⏳ |
| P4.3 | Frontend: chart-of-accounts.html + JS (شجرة الحسابات) | ⏳ |

---

### 🔵 الأولوية 5 — سندات الاستلام والتسليم (VMI متقدم)
> **السبب:** مكمّل لدورة المستودع — الأقل إلحاحاً حالياً

| # | المهمة | الحالة |
|---|--------|--------|
| P5.1 | سندات الاستلام VMI (receipt-vouchers.html) | ⏳ |
| P5.2 | سندات التسليم (delivery-vouchers.html) | ⏳ |

---

## آخر تحديث
**التاريخ:** 2026-05-17
**الحالة الحالية:** جاري تنفيذ الأولوية 1 — طباعة الفواتير