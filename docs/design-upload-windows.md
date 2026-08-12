# حصر نوافذ رفع التصميم في G.PACK 2.0

هذا الملف يحصر كل النوافذ (Modals/Pages) في الموقع التي من خلالها يتم رفع تصميم أو ملفات تصميم.

---

## 1. عرض السعر (Quotations) — رفع تصميم جديد

- **الملف**: `frontend/views/quotations.html` — Modal `#design-upload-modal`
- **الـ JS**: `frontend/js/views/quotations.js` — دالة `window.uploadDesign()`
- **الـ API**: `POST /api/client-designs` (FormData: thumbnail, pdf, source, design_name, client_id, variant_id)
- **الوصف**: من صفحة عرض السعر، يضغط "رفع تصميم جديد" فيفتح نافذة لرفع ملف تصميم (صورة/PDF/AI/PSD/EPS/SVG) مع اسم تصميم اختياري. يتم ربط التصميم بالعميل والـ variant.

## 2. عرض السعر (Quotations) — معرض التصاميم (Design Gallery)

- **الملف**: `frontend/views/quotations.html` — Modal `#design-gallery-modal`
- **الـ JS**: `frontend/js/views/quotations.js` — دالة `window.openDesignGallery()` و `window.openDesignUploadFromGallery()`
- **الوصف**: نافذة لاستعراض التصاميم الموجودة للعميل واختيار تصميم لربطه بصف العرض، مع زر "رفع تصميم جديد" يفتح نافذة الرفع (#design-upload-modal).

## 3. عرض السعر (Quotations) — إرسال للمصمم (Send to Designer)

- **الملف**: ديناميكي في `frontend/js/views/quotations.js` — دالة `window.openSendToDesignerModal()`
- **الـ API**: `POST /api/designer/send` (FormData: design_brief, design_brief_files, item_assignments, item_files_{itemId})
- **الوصف**: نافذة إسناد عناصر العرض لمصممين، مع رفع:
  - ملفات مرجعية عامة (`#std-brief-files`)
  - ملفات مرجعية لكل صنف على حدة (`.std-item-files`)

## 4. أوامر الإنتاج (Production Orders) — رفع تصميم جديد

- **الملف**: `frontend/views/production_orders.html` — Modal `#po-design-upload-modal`
- **الـ JS**: `frontend/js/views/production_orders_new.js` — دالة `window.poView._openDesignUpload()` و `window.poView._uploadDesign()`
- **الـ API**: `POST /api/client-designs` (FormData: design_name, client_id, variant_id, thumbnail)
- **الوصف**: من نافذة إسناد أمر الإنتاج، يضغط "رفع جديد" لرفع تصميم جديد يربط بالعميل والـ variant.

## 5. أوامر الإنتاج (Production Orders) — اختيار تصميم (Design Selector)

- **الملف**: `frontend/views/production_orders.html` — Modal `#po-design-selector-modal`
- **الـ JS**: `frontend/js/views/production_orders_new.js` — دالة `window.poView._openDesignSelector()`
- **الوصف**: نافذة لاستعراض واختيار تصميم موجود من معرض التصاميم. لا يوجد رفع مباشر فيها، لكن فيها زر يفتح نافذة الرفع (#po-design-upload-modal).

## 6. صفحة المصمم (Designer) — تسليم التصميم

- **الملف**: `frontend/views/designer.html` — Modal `#designer-task-modal`
- **الـ JS**: `frontend/js/views/designer.js` — دالة تسليم التصميم (FormData: designer_notes, design_files)
- **الـ API**: `PUT /api/designer/tasks/:taskId/submit` (FormData)
- **الوصف**: المصمم يرفع ملفات التصميم النهائية لكل صنف في المهمة المسندة إليه، مع ملاحظات.

## 7. ملف العميل (Client Profile) — استبدال ملفات التصميم

- **الملف**: `frontend/views/client-profile.html` — Modal `#cp-replace-design-modal`
- **الـ JS**: `frontend/js/views/client-profile.js` — دالة `window._cpSubmitReplaceDesign()`
- **الـ API**: `POST /api/client-designs/:designId/replace` (FormData: thumbnail, pdf, ai, psd, source)
- **الوصف**: من تبويب "التصاميم" في ملف العميل، يضغط "استبدال الملفات" لرفع ملفات جديدة بدل القديمة لنفس التصميم.

## 8. صفحة مراجعة التصميم للعميل (Public Design Review)

- **الملف**: `frontend/public-design.html`
- **الـ API**: `POST /api/public/design/respond/:token` (FormData: items, signature, signer_name, rejection_reasons, client_files)
- **الوصف**: صفحة عامة يصل إليها العميل عبر رابط آمن. يمكنه رفع ملفات توضح التعديلات المطلوبة عند الرفض (`#client-files-input`).

---

## نوافذ رفع ملفات أخرى (ليست تصميم)

- **عرض السعر للعميل (public-quotation.html)**: رفع إيصال دفع (`#receipt-input`) — ليس تصميم.
- **الاستلام المؤقت (direct-receipts)**: رفع صور منتج/فاتورة — ليس تصميم.
- **verify.html**: عرض فقط — لا يوجد رفع.
- **public-manufacturer-order.html**: عرض فقط — لا يوجد رفع.

---

## الخلاصة

| # | النافذة | الصفحة | API |
|---|---------|--------|-----|
| 1 | رفع تصميم جديد (عرض السعر) | quotations | `POST /api/client-designs` |
| 2 | معرض التصاميم (عرض السعر) | quotations | (يفتح #1) |
| 3 | إرسال للمصمم (ملفات مرجعية) | quotations | `POST /api/designer/send` |
| 4 | رفع تصميم جديد (أمر الإنتاج) | production_orders | `POST /api/client-designs` |
| 5 | اختيار تصميم (أمر الإنتاج) | production_orders | (يفتح #4) |
| 6 | تسليم التصميم (المصمم) | designer | `PUT /api/designer/tasks/:id/submit` |
| 7 | استبدال ملفات تصميم (ملف العميل) | client-profile | `POST /api/client-designs/:id/replace` |
| 8 | رفع ملفات تعديل (مراجعة العميل) | public-design | `POST /api/public/design/respond/:token` |
