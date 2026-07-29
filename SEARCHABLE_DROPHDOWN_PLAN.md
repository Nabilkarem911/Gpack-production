# الخطة الصارمة: تفعيل البحث والكيبورد في كل المربعات (Selects)

## الهدف
تحويل كل عناصر `<select>` في الموقع إلى مربعات قابلة للبحث (searchable) مع تحكم كامل بالكيبورد (أسهم للتنقل، Enter للاختيار، Escape للإغلاق) — بدون كسر أي كود موجود.

## الوضع الحالي

### أدوات البحث المتاحة الآن:
1. **`SearchableSelect`** (`frontend/js/utils/searchable-select.js`)
   - كلاس عالمي قابل لإعادة الاستخدام
   - يدعم البحث والفلترة
   - **مش يدعم الكيبورد** (Arrow Up/Down, Enter)
   - بيشتغل على container (مش على `<select>` مباشر)

2. **`_makeSearchable()`** (داخل `quotations.js` فقط)
   - بيشتغل على `<select>` مباشر (بيخفيه ويحط input مكانه)
   - **مش يدعم الكيبورد**
   - محلي في quotations.js مش مستخدم في أي صفحة تانية

### المربعات اللي عليها بحث حالياً (7 مربعات فقط):
| الصفحة | المربع | الأداة |
|---|---|---|
| quotations | `quote-client` | `_makeSearchable` |
| quotations | `select.row-category` | `_makeSearchable` |
| quotations | `select.row-product` | `_makeSearchable` |
| quotations | `select.row-variant` | `_makeSearchable` |
| products | `product-unit` | `SearchableSelect` |
| products | `vf-unit` | `SearchableSelect` |
| product-movements | بحث مخصص | `_initSearchDropdown` |

### المربعات اللي مش عليها بحث (~50+ مربع):
موزعة على 15+ صفحة (انظر الحصر في المحادثة).

---

## مخاطر الكسر (Critical Risks)
1. **`onchange` handlers** — كتير من المربعات عليها `onchange="window.xxx()"` لازم تتفرغ بعد الاختيار
2. **Dynamic options** — بعض المربعات بتتعبى ديناميك (AJAX) وممكن تتغير في runtime
3. **`_makeSearchable` في quotations** — بيخفي الـ `<select>` وبيحط input، لو غيرنا الطريقة ممكن نكسر الـ event listeners
4. **Modals** — المربعات جوه modals، لازم الـ dropdown يظهر فوق الـ modal (z-index)
5. **Disabled selects** — بعض المربعات `disabled` ومش لازم تفتح
6. **Hidden selects** — بعض المربعات `hidden` ومش لازم تتعالج

---

## خطة التنفيذ (Phased Approach)

### المرحلة 0: ترقية `SearchableSelect` + إنشاء `_makeSearchable` عالمي
**الهدف:** تحويل الأداة لنسخة عالمية تدعم الكيبورد + تعمل على أي `<select>` بدون كسر

**المطلوب:**
1. ترقية `SearchableSelect` في `searchable-select.js`:
   - إضافة `ArrowDown` / `ArrowUp` للتنقل في القائمة
   - إضافة `Enter` لاختيار العنصر النشط
   - إضافة `Escape` للإغلاق (موجود بالفعل)
   - إضافة `activeIndex` و `_highlightItem()`
   - إضافة scroll تلقائي للعنصر النشط

2. إنشاء دالة عالمية `window.makeSelectSearchable(selectEl, opts)` في ملف جديد `frontend/js/utils/select-search.js`:
   - بتشتغل على أي `<select>` عادي
   - بتخفي الـ `<select>` وبتحط input + dropdown مكانه (نفس فكرة `_makeSearchable`)
   - بتدعم الكيبورد كامل (Arrow/Enter/Escape)
   - بتفرغ `onchange` تلقائياً بعد الاختيار
   - بتدعم `MutationObserver` للـ dynamic options
   - بتتعامل مع `disabled` و `hidden`
   - بترجع `{ refresh(), destroy() }`

3. تحويل `_makeSearchable` في `quotations.js` ليستخدم `window.makeSelectSearchable` (wrapper فقط)

**معايير القبول:**
- الكيبورد شغال (Arrow/Enter/Escape)
- `onchange` بيشتغل بعد الاختيار
- الـ dynamic options بتظهر صح
- الـ disabled/hidden متتعالجش
- الـ z-index صح جوه modals

---

### المرحلة 1: صفحة عروض الأسعار (quotations)
**المربعات المطلوب تحويلها:**
- `quotes-client-filter` (فلتر العميل)
- `qc-parent` (العميل الرئيسي - إضافة سريعة)
- `convert-payment-method` (طريقة الدفع)
- `convert-cash-box` (الصندوق)
- `convert-bank-account` (الحساب البنكي)
- `convert-pos-terminal` (جهاز نقاط البيع)
- `qp-category` (التصنيف - إضافة منتج سريع)
- `qp-unit` (وحدة القياس - إضافة منتج سريع)
- `select.row-design-select` (التصميم - ديناميك لكل صف)

**ملاحظات:**
- `quote-client` و `row-*` عليها `_makeSearchable` بالفعل — هتتحول تلقائياً في المرحلة 0
- `convert-*` مربعات ثابتة (options قليلة) — ممكن نسيبها عادية لو العدد < 5
- `quotes-client-filter` و `qc-parent` — عملاء كتير، لازم searchable

---

### المرحلة 2: صفحة فواتير المبيعات (sales-invoices)
- `si-client` (فلتر العميل)

### المرحلة 3: صفحة فواتير المشتريات (purchase-invoices)
- `pi-inv-has-invoice` (فلتر)
- `pi-arc-status` (فلتر)
- `pi-arc-has-invoice` (فلتر)

### المرحلة 4: صفحة العملاء (clients)
- `client-status` (حالة العميل)

### المرحلة 5: صفحة الموردين (suppliers)
- `suppliers-status-filter` (فلتر الحالة)
- `supplier-status` (حالة المورد)

### المرحلة 6: صفحة الأصناف (products)
- `products-status-filter` (فلتر الحالة)
- `product-category` (التصنيف)
- `product-status` (الحالة)
- `vf-status` (فلتر الحالة)

### المرحلة 7: صفحة المخزون (inventory)
- `filter-warehouse` (فلتر المستودع)
- `filter-category` (فلتر الفئة)
- `filter-stock-status` (فلتر حالة المخزون)
- `tx-filter-warehouse` (فلتر المستودع - حركات)
- `tx-filter-type` (فلتر نوع الحركة)
- `ca-client` (اختيار العميل - مقارنة)
- `cmp-client-a` (العميل الأول)
- `cmp-client-b` (العميل الثاني)
- `adj-type` (نوع التسوية)
- `inv-mv-type` (فلتر نوع الحركة)

### المرحلة 8: صفحة المخازن (warehouses)
- `det-hist-type` (فلتر نوع العملية)
- `stock-warehouse-filter` (فلتر المستودع)
- `stock-client-filter` (فلتر العميل)
- `history-type-filter` (فلتر نوع العملية)
- `modal-warehouse` (اختيار المستودع)
- `modal-product` (اختيار الصنف)
- `modal-variant` (اختيار المقاس)
- `wh-type` (نوع المستودع)
- `wh-client` (العميل - مستودع مخصص)
- `wh-mv-type` (فلتر نوع الحركة)
- `wh-mv-client` (فلتر العميل)

### المرحلة 9: صفحة سندات التسليم (vmi-dispatch)
- `dv-archive-status-filter` (فلتر الحالة)
- `dv-create-client` (العميل)
- `dv-create-branch` (الفرع)
- `dv-create-warehouse` (المستودع)

### المرحلة 10: صفحة سندات الاستلام (receiving-vouchers)
- `rv-archive-mo-filter` (فلتر أمر التشغيل)
- `rv-archive-status-filter` (فلتر الحالة)
- `rv-archive-invoice-filter` (فلتر الفاتورة)
- `rv-receive-warehouse` (المستودع)

### المرحلة 11: سندات القبض والصرف (receipt-voucher + payment-voucher)
- `rv-filter-status` / `pv-filter-status` (فلتر الحالة)
- `rv-payment-method` / `pv-payment-method` (طريقة الدفع)
- `rv-cash-account` / `pv-cash-account` (الحساب)

### المرحلة 12: استلام مؤقت (direct-receipts)
- `dr-review-supplier` (المورد)
- `dr-review-warehouse` (المستودع)
- `dr-qp-category` (التصنيف)

### المرحلة 13: أوامر التشغيل (production_orders)
- `assign-supplier-select` (المورد)
- `bulk-supplier-select` (المورد الجماعي)

### المرحلة 14: صفحات متنوعة
- users: `filter-role`, `filter-status`
- tasks: `filter-status`, `filter-priority`
- forecast: `forecast-client`, `forecast-periods`
- whatsapp: `wa-queue-filter`

---

## قواعد التنفيذ الصارمة (Strict Rules)

1. **مرحلة واحدة في كل مرة** — نختبر كل مرحلة قبل الانتقال للتالية
2. **مش نلمس `_makeSearchable` القديم** في quotations إلا في المرحلة 0 (wrapper فقط)
3. **كل `<select>` عليه `onchange`** — لازم نتأكد إن الـ event بيشتغل بعد الاختيار
4. **الـ dynamic options** — لازم `MutationObserver` أو `refresh()` يتدعى بعد تحديث الـ options
5. **الـ disabled / hidden selects** — مش لازم تتحول ل searchable
6. **z-index** — الـ dropdown لازم يكون `z-[100]` عشان يظهر فوق modals
7. **RTL** — الـ dropdown direction لازم يكون `rtl`
8. **مش نحذف `<select>` الأصلي** — نخفيه بـ `display:none` ونخليه في DOM عشان أي كود يعتمد عليه
9. **اختبار كل مرحلة** — بعد كل مرحلة، نختبر الصفحة يدوياً (فتح modal، اختيار، حفظ، فلترة)
10. **git commit بعد كل مرحلة** — عشان نقدر نرجع لو فيه كسر

---

## معايير القبول النهائية (Acceptance Criteria)

- [x] كل `<select>` فيه أكثر من 5 options أصبح searchable (المرحلة 0-14 اتعملت)
- [x] البحث بالكيبورد شغال (Arrow Up/Down للتنقل، Enter للاختيار، Escape للإغلاق)
- [x] `onchange` events بتشتغل بعد الاختيار في كل المربعات
- [x] الـ dynamic options بتظهر صح في الـ dropdown (MutationObserver)
- [x] الـ disabled/hidden selects متأثرتش (makeSelectSearchable بيتخطاها)
- [x] الـ dropdown بيظهر فوق modals (z-[100])
- [ ] مفيش أي صفحة اتحطمت أو أي وظيفة بطلت تشتغل (يحتاج اختبار يدوي)
- [x] الـ RTL سليم في كل الـ dropdowns

---

## ترتيب الأولويات (Priority)

**أولوية عالية (بيانات كتيرة):**
- كل مربعات العملاء (client selects)
- كل مربعات الموردين (supplier selects)
- كل مربعات المنتجات/الأصناف (product selects)
- كل مربعات المستودعات (warehouse selects)

**أولوية متوسطة (بيانات متغيرة):**
- مربعات التصنيف (category selects)
- مربعات الفروع (branch selects)

**أولوية منخفضة (options ثابتة قليلة):**
- مربعات الحالة (status filters)
- مربعات طريقة الدفع (payment method)
- مربعات نوع الحركة (movement type)
- مربعات نوع التسوية (adjustment type)
