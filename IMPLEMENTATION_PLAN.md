# خطة التنفيذ الاحترافية — G.PACK 2.0
## الميزتان: المساعد الذكي (AI Assistant) + سير عمل المصمم (Designer Workflow)

---

## المبادئ الحاكمة (لا كسر في الكود)

1. **كل تعديلات الـ DB تكون migrations جديدة** — ملفات `.sql` في `backend/migrations/` بأرقام تسلسلية جديدة. لا تعديل على migrations موجودة.
2. **كل الـ routes الجديدة تُضاف بـ `_mountRoute` في `server.js`** — لا تعديل على routes الموجودة.
3. **كل الـ columns الجديدة بـ `DEFAULT NULL`** — لا تؤثر على أي كود موجود.
4. **كل الـ frontend views جديدة** — لا تعديل على views موجودة إلا إضافة زر/رابط.
5. **كل التعديلات على ملفات موجودة تكون إضافية فقط** (append) — لا حذف أو تعديل لـ logic موجود.
6. **الـ AI functions كلها READ ONLY** — لا كتابة ولا تعديل ولا حذف في الـ DB.
7. **الـ AI middleware يتعامل مع missing API key بسلاسة** — النظام يشتغل بدون AI لو المفتاح مش موجود.
8. **الـ polling الجديد يتبع نفس pattern الـ polling الموجود** (navigation token + clearInterval).

---

## الجزء الأول: المساعد الذكي (AI Chat Assistant)

### الفكرة
Chat bubble في الـ header — المستخدم يسأل بالعربي، الـ AI يجاوب بناءً على بيانات النظام باستخدام OpenAI Function Calling.

### المرحلة 1A: Backend — AI Route + Functions

#### الملفات الجديدة:
| الملف | الوصف |
|---|---|
| `backend/routes/ai-assistant.js` | الـ route الرئيسي للمساعد الذكي |
| `backend/utils/ai-functions.js` | تعريف الـ functions (schema + execution) |
| `backend/migrations/047_ai_chat_history.sql` | جدول `ai_chat_history` لحفظ المحادثات |

#### تفاصيل `backend/routes/ai-assistant.js`:
```
POST /api/ai-assistant/chat
  - Body: { message: string, conversation_id?: string }
  - يبعت رسالة المستخدم لـ OpenAI مع قائمة الـ functions
  - OpenAI يختار function → ينفذها → يرجع النتيجة → OpenAI يصيغ الإجابة
  - يدعم multi-turn (محادثة متعددة الرسائل)
  - يحفظ المحادثة في ai_chat_history
  - لو OPENAI_API_KEY مش موجود → يرجع رسالة "المساعد الذكي غير مفعل"

GET /api/ai-assistant/history
  - يجلب آخر محادثات المستخدم

GET /api/ai-assistant/health
  - فحص حالة الـ AI (متصل/غير متصل)
```

#### تفاصيل `backend/utils/ai-functions.js`:
كل function = object فيه:
- `name`: اسم الـ function
- `description`: وصف بالعربي للـ AI
- `parameters`: JSON schema للمدخلات
- `execute`: دالة تنفذ SQL query وترجع نتيجة

**الـ Functions المرحلة الأولى (12 function):**

| # | Name | الوصف | الـ Query الأساسية |
|---|---|---|---|
| 1 | `getSalesSummary` | ملخص المبيعات (يومي/شهري/سنوي) | `SELECT SUM(grand_total), COUNT(*) FROM invoices WHERE ...` |
| 2 | `getTopProducts` | أكثر المنتجات مبيعاً | `SELECT pv.product_name, SUM(oi.quantity) FROM order_items oi JOIN orders o ... GROUP BY ... ORDER BY ... LIMIT` |
| 3 | `getClientAccount` | حساب عميل (مديونيات، مدفوعات) | `SELECT c.name, SUM(i.grand_total), SUM(p.amount) FROM clients c LEFT JOIN invoices i ...` |
| 4 | `getSupplierAccount` | حساب مورد (مستحقات، مدفوعات) | `SELECT s.name, SUM(pi.total), SUM(pp.amount) FROM suppliers s LEFT JOIN ...` |
| 5 | `getInventoryStatus` | حالة المخزون (قاربت على النفاد) | `SELECT pv.product_name, SUM(ws.quantity) FROM warehouse_stock ws ... HAVING SUM(ws.quantity) < threshold` |
| 6 | `getSupplierPricing` | أسعار مورد لمنتج معين | `SELECT s.name, pv.cost_price FROM product_variants pv JOIN suppliers s ...` |
| 7 | `compareSupplierPricing` | مقارنة أسعار الموردين لمنتج | `SELECT s.name, pv.cost_price FROM product_variants pv JOIN suppliers s WHERE pv.product_name ILIKE ... ORDER BY pv.cost_price` |
| 8 | `getProductCostHistory` | تاريخ أسعار شراء منتج | `SELECT pi.invoice_date, pi_items.unit_price FROM purchase_invoice_items pi_items JOIN ...` |
| 9 | `getClientOrders` | طلبات عميل معين | `SELECT o.id, o.order_number, o.status, o.created_at FROM orders o WHERE o.client_id = ...` |
| 10 | `getPendingQuotes` | عروض أسعار معلقة | `SELECT o.id, o.order_number, c.name, o.pricing_status FROM orders o JOIN clients c WHERE o.status = 'quote'` |
| 11 | `getOutstandingPayments` | مستحقات معلقة | `SELECT c.name, SUM(i.balance_due) FROM invoices i JOIN clients c WHERE i.balance_due > 0` |
| 12 | `getProductionStatus` | حالة أوامر التشغيل | `SELECT mo.id, mo.mo_number, mo.status FROM manufacturer_orders mo WHERE mo.status IN ('pending', 'in_progress')` |

**قواعد الأمان في الـ functions:**
- كل function تستقبل `userId` و `role` من `req.user`
- لو المستخدم `sales_rep` → تضيف `AND created_by = userId` في الـ query
- لو `admin` أو `manager` → تشوف كل البيانات
- لو `accountant` → تشوف البيانات المالية فقط
- كل النتائج تمر عبر `_sanitizeResult()` تشيل أي sensitive data

#### تفاصيل `backend/migrations/047_ai_chat_history.sql`:
```sql
CREATE TABLE IF NOT EXISTS ai_chat_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL,  -- 'user' or 'assistant'
    content         TEXT NOT NULL,
    function_name   VARCHAR(100),           -- null for regular messages
    function_args   JSONB,                  -- args passed to function
    function_result JSONB,                  -- result returned by function
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_ai_chat_user_id ON ai_chat_history(user_id);
CREATE INDEX idx_ai_chat_created ON ai_chat_history(created_at DESC);
```

#### التعديل على `server.js` (سطر واحد):
```js
// بعد سطر 247 (forecast)
_mountRoute('/ai-assistant',     authenticate, require('./routes/ai-assistant'));
```

#### التعديل على `.env.example` (إضافة):
```
# AI Assistant
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini
AI_ASSISTANT_ENABLED=true
```

#### التعديل على `docker-compose.yml` (إضافة):
```yaml
OPENAI_API_KEY: ${OPENAI_API_KEY}
OPENAI_MODEL: ${OPENAI_MODEL:-gpt-4o-mini}
AI_ASSISTANT_ENABLED: ${AI_ASSISTANT_ENABLED:-true}
```

---

### المرحلة 1B: Frontend — Chat Bubble

#### الملفات الجديدة:
| الملف | الوصف |
|---|---|
| `frontend/js/ai-assistant.js` | الـ chat widget logic (open/close, send/receive, render) |
| `frontend/views/ai-assistant.html` | الـ HTML template للـ chat panel (يُحقن في الـ header) |

#### تفاصيل `frontend/js/ai-assistant.js`:
- يضيف زر chat icon في الـ header (بعد الـ notification bell)
- لما تضغط → يفتح panel جانبي (slide-in من اليمين)
- فيه:
  - منطقة رسائل (scrollable) — رسائل المستخدم يمين، ردود الـ AI يسار
  - input field + زر إرسال
  - loading indicator لما الـ AI بيفكر
  - suggestions chips (أسئلة مقترحة) أول ما تفتح
- يدعم Enter للإرسال
- يحفظ المحادثة في `localStorage` كـ cache (اختياري)
- polling: مفيش — الـ chat request-response فقط

#### التعديل على `frontend/index.html`:
- إضافة `<script src="/js/ai-assistant.js"></script>` بعد الـ scripts الموجودة
- إضافة `<div id="ai-chat-panel"></div>` في الـ header area

#### التعديل على `frontend/js/layout.js`:
- إضافة زر الـ AI chat في الـ header builder (سطر واحد بعد الـ notification bell)

#### الـ UI Design:
```
┌─────────────────────────────────────────┐
│  [🔔] [🤖]  G.PACK 2.0    [☰]  │  ← Header
└──────────┬──────────────────────────────┘
           │ (slide-in panel)
           ▼
┌──────────────────────────┐
│  المساعد الذكي      [✕]  │
├──────────────────────────┤
│                          │
│  🤖 أهلاً! اسألني عن      │
│  مبيعاتك، عملائك، مخزونك │
│                          │
│  ┌─── ┌─── ┌─── ┐       │
│  │مبيعات اليوم│     │
│  │أكثر المنتجات│     │
│  │حالة المخزون │     │
│  └─── └─── └─── ┘       │
│                          │
│  👤 مين أرخص مورد للأكواب؟│
│                          │
│  🤖 أرخص مورد للأكواب هو │
│  مورد النور بسعر 0.50 ريال│
│  تليه مورد الضياء بسعر   │
│  0.55 ريال               │
│                          │
├──────────────────────────┤
│  [اكتب سؤالك...]  [➤]   │
└──────────────────────────┘
```

---

### المرحلة 1C: توسيع الـ Functions (مرحلة لاحقة)

إضافة functions حسب الحاجة:

| # | Name | الوصف |
|---|---|---|
| 13 | `getProfitMargin` | هامش الربح لمنتج/فترة |
| 14 | `getSlowMovingStock` | مخزون راكد (أكتر من X شهر) |
| 15 | `getQuoteConversionRate` | نسبة تحويل العروض لفواتير |
| 16 | `getClientPaymentHistory` | تاريخ سداد عميل |
| 17 | `getSupplierDeliveryPerformance` | أداء مورد في التسليم |
| 18 | `getCashFlowSummary` | ملخص التدفق النقدي |
| 19 | `getVATSummary` | ملخص الضريبة المستحقة |
| 20 | `getTaskSummary` | ملخص المهام (متأخرة/مكتملة) |
| 21 | `getDeliveryNoteStatus` | حالة سندات التسليم |
| 22 | `getReceivingVoucherStatus` | حالة سندات الاستلام |
| 23 | `getJournalEntryStatus` | قيود محاسبية غير معتمدة |
| 24 | `getClientDesignHistory` | تصاميم عميل سابقة |

---

## الجزء الثاني: سير عمل المصمم (Designer Workflow)

### الفكرة
المدير يحول عرض سعر للمصمم بدل تحويله مباشرة لإنتاج. المصمم يصمم لكل صنف لوحده، يرفع ملفات، المدير يراجع ويعتمد → تحويل تلقائي لأمر إنتاج.

### المرحلة 2A: Database Migration

#### الملف الجديد: `backend/migrations/048_designer_workflow.sql`
```sql
-- =============================================
-- Designer Workflow — Add design columns to orders & order_items
-- All columns DEFAULT NULL — no impact on existing code
-- =============================================

-- Order-level design fields
ALTER TABLE orders ADD COLUMN IF NOT EXISTS design_status VARCHAR(20) DEFAULT NULL;
-- Values: NULL (not sent to designer), 'pending', 'in_progress', 'in_review', 'completed', 'revision'

ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_designer_id UUID DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS design_brief TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS design_brief_files JSONB DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS design_sent_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS design_completed_at TIMESTAMPTZ DEFAULT NULL;

-- Order-item-level design fields (per-item files & notes)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS design_notes TEXT DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS design_files JSONB DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS design_status VARCHAR(20) DEFAULT NULL;
-- Values: NULL, 'pending', 'in_progress', 'completed', 'approved', 'revision'

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS designer_notes TEXT DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS revision_notes TEXT DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS design_completed_at TIMESTAMPTZ DEFAULT NULL;

-- Index for designer queries
CREATE INDEX IF NOT EXISTS idx_orders_designer ON orders(assigned_designer_id) WHERE assigned_designer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_design_status ON orders(design_status) WHERE design_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_design_status ON order_items(design_status) WHERE design_status IS NOT NULL;
```

---

### المرحلة 2B: Backend — Designer Routes + File Upload

#### الملفات الجديدة:
| الملف | الوصف |
|---|---|
| `backend/routes/designer.js` | كل endpoints خاصة المصمم |
| `backend/migrations/048_designer_workflow.sql` | الـ DB migration |

#### تفاصيل `backend/routes/designer.js`:

```
─── المدير endpoints ───

POST /api/designer/assign
  - Body: { order_id, designer_id, design_brief, design_brief_files[] }
  - يحدّث: orders.design_status='pending', assigned_designer_id, design_brief, design_brief_files, design_sent_at
  - يحدّث: كل order_items.design_status='pending'
  - ينشئ إشعار للمصمم
  - Authorization: admin, manager, super_admin

PUT /api/designer/review/:orderId/item/:itemId
  - Body: { action: 'approve'|'revision', revision_notes? }
  - approve → order_items.design_status='approved'
  - revision → order_items.design_status='revision', revision_notes
  - لو كل الأصناف approved → تحويل تلقائي لأمر إنتاج (status='production')
  - ينشئ إشعار للمصمم
  - Authorization: admin, manager, super_admin

GET /api/designer/pending-review
  - عروض بانتظار مراجعة المدير (design_status='in_review')
  - Authorization: admin, manager, super_admin

─── المصمم endpoints ───

GET /api/designer/my-tasks
  - عروض مسندة للمصمم الحالي
  - يرجع: order + items + design_brief + design_brief_files + client designs + pantone colors
  - Authorization: designer role أو all_access

GET /api/designer/task/:orderId
  - تفاصيل عرض كامل للمصمم
  - يرجع: items مع design_notes, design_files, design_status
  - يرجع: client_designs و client_pantone_colors للعميل
  - Authorization: المصمم المسند فقط

PUT /api/designer/item/:orderId/:itemId/submit
  - Body (multipart/form-data): design_notes, design_files[]
  - يحدّث: order_items.design_files, order_items.designer_notes, order_items.design_status='completed'
  - لو كل الأصناف completed → orders.design_status='in_review' + إشعار للمدير
  - Authorization: المصمم المسند فقط

PUT /api/designer/item/:orderId/:itemId/start
  - يحدّث: order_items.design_status='in_progress'
  - لو أول صنف يبدأ → orders.design_status='in_progress'
  - Authorization: المصمم المسند فقط

─── ملفات ───

POST /api/designer/upload-brief/:orderId
  - رفع ملفات المديمير (شعار، مراجع) — multipart/form-data
  - يستخدم multer بنفس إعدادات client_designs (200MB, نفس الأنواع)
  - يخزن في: uploads/designs/{orderId}/brief/
  - Authorization: admin, manager, super_admin

POST /api/designer/upload-design/:orderId/:itemId
  - رفع ملفات التصميم النهائي للمصمم — multipart/form-data
  - يخزن في: uploads/designs/{orderId}/items/{itemId}/
  - Authorization: المصمم المسند فقط

GET /api/designer/file/:orderId/:filename
  - download/preview ملف
  - Authorization: admin, manager, المصمم المسند
```

#### إعدادات multer (نفس pattern بتاع client_designs):
```js
const UPLOAD_BASE = path.join(__dirname, '../uploads/designs');
// نفس allowedTypes بتاع client_designs
// limits: { fileSize: 200 * 1024 * 1024 } // 200MB
```

#### التعديل على `server.js` (سطر واحد):
```js
// بعد سطر ai-assistant
_mountRoute('/designer',          authenticate, require('./routes/designer'));
```

---

### المرحلة 2C: Frontend — Designer Page

#### الملفات الجديدة:
| الملف | الوصف |
|---|---|
| `frontend/views/designer.html` | صفحة المصمم |
| `frontend/js/views/designer.js` | logic الصفحة |

#### التعديلات على ملفات موجودة (إضافية فقط):

**`frontend/js/layout.js`** — إضافة nav item:
```js
// في NAV_ITEMS array، بعد production_orders
{ view: 'designer', label: 'المصمم', icon: 'fa-pen-ruler', permission: 'designer' },
```

**`frontend/js/views/quotations.js`** — إضافة زر "إرسال للمصمم":
- في الـ actions لكل عرض سعر (جنب زر "تحويل لإنتاج")
- يفتح modal فيه:
  - اختيار المصمم (dropdown من users)
  - textarea للتعليمات (design_brief)
  - منطقة رفع ملفات (شعار، مراجع)
  - لكل صنف: textarea لملاحظات خاصة + منطقة رفع ملفات خاصة
  - زر "إرسال للمصمم"

**`frontend/js/notifications.js`** — إضافة أنواع إشعارات:
```js
design_assigned:    { icon: 'fa-pen-ruler', color: 'blue', label: 'طلب تصميم جديد' },
design_completed:   { icon: 'fa-check-circle', color: 'green', label: 'تصميم مكتمل' },
design_approved:    { icon: 'fa-check-double', color: 'green', label: 'تصميم معتمد' },
design_revision:    { icon: 'fa-rotate-left', color: 'orange', label: 'مطلوب تعديل تصميم' },
```

**`backend/routes/dashboard.js`** — إضافة alerts للمصمم:
- في `/api/dashboard/alerts`:
  - للمصمم: عروض مسندة ليه بانتظار التصميم
  - للمدير: عروض بانتظار المراجعة

#### تفاصيل `frontend/views/designer.html`:
- صفحة كاملة بـ:
  - Header: "المهام التصميمية"
  - Tabs: "بانتظار التصميم" | "قيد التنفيذ" | "مكتملة"
  - Cards لكل عرض: رقم العرض، اسم العميل، عدد الأصناف، حالة كل صنف
  - زر "فتح" → يفتح تفاصيل العرض

#### تفاصيل `frontend/js/views/designer.js`:
- `_loadMyTasks()`: يجلب عروض المصمم من `/api/designer/my-tasks`
- `_openTask(orderId)`: يفتح تفاصيل عرض كامل
- `_renderItemCard(item)`: يعرض صنف بـ:
  - اسم الصنف + المقاس + الكمية
  - ملاحظات المدير (`design_notes`)
  - الملفات المرفوعة من المدير (`design_brief_files`) — preview + download
  - ألوان البانتون للعميل (من `client_pantone_colors`)
  - تصاميم العميل السابقة (من `client_designs`)
  - منطقة رفع ملفات التصميم (للمصمم)
  - textarea لملاحظات المصمم (`designer_notes`)
  - زر "بدء التصميم" + زر "إنهاء التصميم"
- `_startDesign(itemId)`: يضرب `/api/designer/item/:orderId/:itemId/start`
- `_submitDesign(orderId, itemId)`: يضرب `/api/designer/item/:orderId/:itemId/submit` مع الملفات
- **Polling**: كل 30 ثانية لتحديث الحالات (نفس pattern quotations.js)

#### تفاصيل صفحة المراجعة (للمدير):
- في `quotations.js` أو صفحة منفصلة:
  - المدير يشوف عروض `design_status='in_review'`
  - يفتح العرض → يشوف كل صنف:
    - ملفات المصمم (preview + download)
    - ملاحظات المصمم
    - زر "اعتماد" + زر "طلب تعديل" (مع textarea للسبب)
  - لما كل الأصناف تتعتمد → تحويل تلقائي لأمر إنتاج

---

### المرحلة 2D: Role & Permissions

#### إضافة role "designer":
- في `backend/routes/users.js` — النظام يدعم roles ديناميكية من DB
- نضيف role في الـ seed أو من صفحة Users:
  - `role_name`: 'designer'
  - `permissions`: `{ "designer": { "view": true, "upload": true, "submit": true } }`

#### إضافة permission "designer" للـ NAV_ITEMS:
- الـ `_hasPermission('designer')` في layout.js هتتحقق من permissions object
- المصمم يشوف بس صفحة المصمم + لوحة التحكم

#### التعديل على `frontend/js/layout.js`:
```js
// في roleLabels
designer: 'مصمم',
```

---

## ترتيب التنفيذ (Phases)

### Phase 1: AI Assistant (3 مراحل)
| المرحلة | المدة التقديرية | الملفات |
|---|---|---|
| 1A: Backend AI route + functions | أساس | `ai-assistant.js`, `ai-functions.js`, migration |
| 1B: Frontend chat bubble | أساس | `ai-assistant.js` (frontend), `ai-assistant.html` |
| 1C: توسيع functions | لاحقاً | إضافات على `ai-functions.js` |

### Phase 2: Designer Workflow (4 مراحل)
| المرحلة | المدة التقديرية | الملفات |
|---|---|---|
| 2A: DB migration | أساس | `048_designer_workflow.sql` |
| 2B: Backend routes + upload | أساس | `designer.js` (backend) |
| 2C: Frontend designer page | أساس | `designer.html`, `designer.js` (frontend) |
| 2D: Role + permissions + notifications | أساس | تعديلات على `layout.js`, `notifications.js`, `dashboard.js` |

---

## قائمة الملفات الكاملة

### ملفات جديدة (لا تكسر أي شيء):
| # | الملف | النوع |
|---|---|---|
| 1 | `backend/routes/ai-assistant.js` | Backend route |
| 2 | `backend/utils/ai-functions.js` | Backend utility |
| 3 | `backend/migrations/047_ai_chat_history.sql` | DB migration |
| 4 | `frontend/js/ai-assistant.js` | Frontend logic |
| 5 | `frontend/views/ai-assistant.html` | Frontend template |
| 6 | `backend/routes/designer.js` | Backend route |
| 7 | `backend/migrations/048_designer_workflow.sql` | DB migration |
| 8 | `frontend/views/designer.html` | Frontend view |
| 9 | `frontend/js/views/designer.js` | Frontend logic |

### ملفات يتم تعديلها (إضافات فقط):
| # | الملف | التعديل |
|---|---|---|
| 1 | `backend/server.js` | إضافة سطرين `_mountRoute` للـ routes الجديدة |
| 2 | `frontend/index.html` | إضافة `<script>` و `<div>` للـ AI chat |
| 3 | `frontend/js/layout.js` | إضافة nav item "المصمم" + زر AI chat في header + role label |
| 4 | `frontend/js/notifications.js` | إضافة 4 أنواع إشعارات تصميم |
| 5 | `frontend/js/views/quotations.js` | إضافة زر "إرسال للمصمم" + modal |
| 6 | `backend/routes/dashboard.js` | إضافة alerts للمصمم والمراجعة |
| 7 | `.env.example` | إضافة `OPENAI_API_KEY`, `OPENAI_MODEL` |
| 8 | `docker-compose.yml` | إضافة env vars للـ AI |

---

## اختبار عدم الكسر (Regression Checklist)

- [ ] النظام يشتغل بدون `OPENAI_API_KEY` (AI chat يعرض رسالة "غير مفعل")
- [ ] النظام يشتغل بدون أي مصمم معرف (صفحة المصمم تظهر "لا توجد مهام")
- [ ] عروض الأسعار الحالية تشتغل كأنه ما حصل (الـ columns الجديدة NULL)
- [ ] تحويل عرض سعر لإنتاج مباشرة يشتغل زي ما هو (بدون المرور بالمصمم)
- [ ] الإشعارات الحالية تظهر كأنه ما حصل (الأنواع الجديدة إضافية)
- [ ] الـ sidebar يعرض كأنه ما حصل للمستخدمين العاديين (المصمم فقط يشوف صفحته)
- [ ] الـ migrations تتعمل مرة واحدة بس (schema_migrations يمنع التكرار)
- [ ] رفع الملفات يشتغل بنفس الـ pattern الموجود (multer + uploads/)

---

## الأمان (Security Checklist)

- [ ] كل الـ AI functions READ ONLY (لا INSERT/UPDATE/DELETE)
- [ ] الـ AI functions تحترم صلاحيات المستخدم (sales_rep يشوف بس بياناته)
- [ ] مفيش sensitive data تطلع للـ AI (كلمات سر، أرقام بنكية)
- [ ] الـ AI route محمي بـ `authenticate` middleware
- [ ] الـ designer route محمي بـ `authenticate` + `authorize`
- [ ] رفع الملفات يستخدم `multer` مع `fileFilter` و `fileSize` limit
- [ ] الـ file paths في الـ DB مش قابلين للـ path traversal
- [ ] الـ chat history مرتبطة بـ `user_id` (كل مستخدم يشوف محادثاته بس)

---

## ملاحظات تقنية

### OpenAI API:
- الـ model: `gpt-4o-mini` (رخيص وسريع) أو `gpt-4o` (أقوى)
- الـ system prompt بالعربي: "أنت مساعد ذكي لنظام G.PACK لإدارة المستودعات. تجاوب بالعربي. استخدم الـ functions المتاحة لجلب البيانات."
- الـ temperature: 0.3 (ردود دقيقة مش إبداعية)
- الـ max_tokens: 1000 (كفاية للإجابات)

### File Storage:
- ملفات التصميم تتخزن في: `backend/uploads/designs/{orderId}/`
- ملفات الـ brief تتخزن في: `backend/uploads/designs/{orderId}/brief/`
- ملفات الأصناف تتخزن في: `backend/uploads/designs/{orderId}/items/{itemId}/`
- الـ static serving موجود بالفعل في `server.js:252`: `app.use('/uploads', express.static(...))`

### Polling:
- صفحة المصمم: polling كل 30 ثانية (نفس pattern quotations.js)
- الـ AI chat: مفيش polling — request/response فقط

### Docker:
- الـ env vars الجديدة تضاف لـ `docker-compose.yml`
- مفيش services جديدة مطلوبة (الـ AI service بتاع forecast منفصل عن الـ chat assistant)
- الـ uploads folder يفضل volume mount زي ما هو
