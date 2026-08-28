# G.PACK 2.0 — خطة: إشعارات واتساب داخلية (رقم ثاني)

> **الهدف**: إضافة رقم واتساب داخلي ثاني (منفصل عن رقم الشغل الرسمي) لإرسال تنبيهات داخلية للمدير وأمين المستودع في 3 سيناريوهات:
> 1. عرض سعر بسعر صفر → تنبيه المدير للتسعير
> 2. استلام بضاعة مؤقت → تنبيه المدير بوجود بضاعة بانتظار المراجعة
> 3. أمر فسح (release) → تنبيه أمين المستودع بالاستلام
>
> **القاعدة الذهبية**: لا كسر أي كود شغال. كل تغيير backward-compatible. الإشعارات القديمة (للعميل) تفضل تعمل بنفس السلوك بدون أي تعديل.

---

## 0. المبادئ الصارمة (لا تُخترق)

| # | المبدأ | التطبيق |
|---|---|---|
| 1 | **لا كسر الكود الحالي** | كل العمود الجديد `session` له `DEFAULT 'default'` — الرسائل القديمة تفضل شغالة |
| 2 | **Idempotency** | كل رسالة لها `idempotency_key` (SHA256) — لا تكرار |
| 3 | **Outbox Pattern** | الأحداث تُكتب في نفس الـ transaction — لا رسائل مفقودة |
| 4 | **Circuit Breaker + Retry** | نفس الحماية الموجودة — لا تغيير |
| 5 | **Feature Flag** | كل التنبيهات وراء `internal_whatsapp_enabled` — لو false، لا شيء يرسل |
| 6 | **No ORMs** | Raw SQL فقط عبر `pg` pool |
| 7 | **Transactions** | كل trigger يكتب outbox event داخل `BEGIN/COMMIT` |
| 8 | **Tests أولاً** | كل دالة جديدة لها test قبل الـ trigger |

---

## 1. البنية الحالية (ما لا نلمسه)

```
ERP Code → NotificationService.enqueue() → notification_queue
                                              ↓
                              notification-worker (polling 15s)
                                              ↓
                              WhatsApp.sendText() → WAHA (session: 'default')
```

**ما لا نلمسه**: `whatsapp-service.js` (الـ provider layer), `circuit-breaker.js`, `template-engine.js`, `notification-worker.js` (الـ polling logic), `notification_dead_queue`.

---

## 2. البنية الجديدة (ما نضيفه)

```
ERP Code → NotificationService.enqueue({ session: 'internal' }) → notification_queue
                                                                       ↓
                                                    notification-worker
                                                       (يقرأ session من queue item)
                                                                       ↓
                              WhatsApp.sendText(chatId, text, { session: 'internal' }) → WAHA (session: 'internal')
```

**التغيير الوحيد في الـ worker**: يقرأ `item.session` ويمرره لدوال الإرسال. الـ default = `'default'` = السلوك الحالي.

---

## 3. المراحل (7 مراحل — كل مرحلة مستقلة وقابلة للنشر وحدها)

### المرحلة 1: DB Migration (آمن — backward compatible)

**ملف**: `backend/migrations/075_internal_whatsapp_notifications.sql`

```sql
-- 1. إضافة عمود session لـ notification_queue (DEFAULT 'default' = السلوك الحالي)
ALTER TABLE notification_queue
    ADD COLUMN IF NOT EXISTS session VARCHAR(50) NOT NULL DEFAULT 'default';

-- 2. إضافة عمود session لـ notification_outbox
ALTER TABLE notification_outbox
    ADD COLUMN IF NOT EXISTS session VARCHAR(50) NOT NULL DEFAULT 'default';

-- 3. إضافة عمود session لـ notification_dead_queue (للحفاظ على التماثل)
ALTER TABLE notification_dead_queue
    ADD COLUMN IF NOT EXISTS session VARCHAR(50) NOT NULL DEFAULT 'default';

-- 4. Index لتسريع الاستعلام حسب session
CREATE INDEX IF NOT EXISTS idx_notif_queue_session
    ON notification_queue(session);

-- 5. إعدادات افتراضية (Feature flags + أرقام المستلمين)
INSERT INTO notification_settings (key, value, description) VALUES
    ('internal_whatsapp_enabled', 'false', 'تفعيل الإشعارات الداخلية على رقم الإدارة'),
    ('manager_whatsapp_phone', 'null', 'رقم واتساب المدير لاستلام التنبيهات الداخلية'),
    ('warehouse_keeper_whatsapp_phone', 'null', 'رقم واتساب أمين المستودع لاستلام أوامر الفسح')
ON CONFLICT (key) DO NOTHING;

-- 6. Env var جديد (ليس في DB):
--    WAHA_SESSION_INTERNAL=Gpack-2-studio (ثابت في docker-compose/.env)
```

**لماذا آمن**: `ADD COLUMN IF NOT EXISTS` + `DEFAULT 'default'` — كل الصفوف الموجودة تاخد `'default'` تلقائياً. لا downtime. لا كسر.

**اختبار المرحلة 1**:
```sql
-- يجب أن تنجح بدون خطأ
SELECT session, COUNT(*) FROM notification_queue GROUP BY session;
-- النتيجة: 'default' | <عدد الصفوف الحالية>
```

---

### المرحلة 2: whatsapp-service.js — دعم Multi-Session

**تغييرات**:
- كل دوال الإرسال (`sendText`, `sendImage`, `sendFile`, `sendButtons`, `sendTemplate`) تاخد `options` parameter اختياري فيه `session`
- الـ default = `WAHA_SESSION` (السلوك الحالي)
- دوال الـ session management (`getSessionStatus`, `getQRCode`, `startSession`) تاخد `session` parameter

**مثال التغيير** (قبل → بعد):
```js
// قبل
async function sendText(chatId, text) {
    return _wahaSendText(chatId, text);
}

// بعد
async function sendText(chatId, text, options = {}) {
    return _wahaSendText(chatId, text, options.session || WAHA_SESSION);
}

async function _wahaSendText(chatId, text, session = WAHA_SESSION) {
    return _wahaRequest('/api/sendText', {
        method: 'POST',
        body: { session, chatId: _ensureChatId(chatId), text },
    });
}
```

**لماذا آمن**: `options = {}` → `options.session || WAHA_SESSION` → لو مفيش options، السلوك زي ما هو بالظبط. كل الـ callers الحاليين مش هيتأثروا.

**اختبار المرحلة 2**:
- `sendText('0551234567', 'hello')` → body.session === `WAHA_SESSION` (السلوك الحالي)
- `sendText('0551234567', 'hello', { session: 'internal' })` → body.session === `'internal'`
- `getSessionStatus('internal')` → endpoint = `/api/sessions/internal`

---

### المرحلة 3: notification-service.js — دوال الإشعارات الجديدة

**دوال جديدة** (3 دوال + تعديل `enqueue`):

#### 3a. تعديل `enqueue` لدعم `session`

```js
// قبل
async function enqueue({ channel, recipient, ... priority, correlation_id }) {
    // INSERT بدون session
}

// بعد
async function enqueue({ channel, recipient, ..., priority, correlation_id, session }) {
    // INSERT مع session (DEFAULT 'default' لو مش موجود)
    // ... session: session || 'default'
}
```

#### 3b. دالة مساعدة: قراءة الإعدادات

```js
async function _getInternalSetting(key) {
    const res = await db.query(
        `SELECT value FROM notification_settings WHERE key = $1`, [key]
    );
    if (res.rows.length === 0) return null;
    let val = res.rows[0].value;
    if (typeof val === 'string') { try { val = JSON.parse(val); } catch {} }
    return val;
}

async function _isInternalWhatsAppEnabled() {
    const enabled = await _getInternalSetting('internal_whatsapp_enabled');
    return enabled === true || enabled === 'true';
}
```

#### 3c. الدوال الثلاث الجديدة

```js
// 1. تنبيه المدير: عرض سعر بحاجة تسعير
async function notifyQuotationNeedsPricing({ order_id, order_number, client_name, unpriced_count }) {
    if (!await _isInternalWhatsAppEnabled()) return null;
    const phone = await _getInternalSetting('manager_whatsapp_phone');
    if (!phone) return null;
    const session = (await _getInternalSetting('internal_whatsapp_session')) || 'internal';

    const body = `📋 عرض سعر بحاجة تسعير\n\nرقم العرض: #${order_number}\nالعميل: ${client_name}\nأصناف بدون سعر: ${unpriced_count}\n\nيرجى المراجعة وتحديد الأسعار.`;

    const id = await enqueue({
        channel: 'whatsapp',
        recipient: WhatsApp.normalizePhone(phone),
        recipient_name: 'المدير',
        recipient_role: 'manager',
        message_type: 'quotation_needs_pricing',
        body,
        entity_type: 'order',
        entity_id: order_id,
        metadata: { order_number, unpriced_count },
        priority: 'high',
        session,
    });

    await notifyInApp({
        target_role: 'manager',
        category: 'quotation',
        icon: 'fa-tags',
        title: `عرض سعر #${order_number} بحاجة تسعير`,
        body: `العميل: ${client_name} | ${unpriced_count} صنف بدون سعر`,
        link: `/quotations`,
        priority: 'high',
        entity_type: 'order',
        entity_id: order_id,
    });

    return id;
}

// 2. تنبيه المدير: استلام بضاعة مؤقت
async function notifyDirectReceiptCreated({ receipt_id, receipt_number, item_count, received_by_name }) {
    if (!await _isInternalWhatsAppEnabled()) return null;
    const phone = await _getInternalSetting('manager_whatsapp_phone');
    if (!phone) return null;
    const session = (await _getInternalSetting('internal_whatsapp_session')) || 'internal';

    const body = `📦 استلام بضاعة مؤقت\n\nرقم الاستلام: #${receipt_number}\nعدد الأصناف: ${item_count}\nاستلمها: ${received_by_name || 'أمين المستودع'}\n\nبانتظار مراجعتك وتحويلها لفاتورة شراء.`;

    const id = await enqueue({
        channel: 'whatsapp',
        recipient: WhatsApp.normalizePhone(phone),
        recipient_name: 'المدير',
        recipient_role: 'manager',
        message_type: 'direct_receipt_created',
        body,
        entity_type: 'direct_receipt',
        entity_id: receipt_id,
        metadata: { receipt_number, item_count },
        priority: 'normal',
        session,
    });

    await notifyInApp({
        target_role: 'manager',
        category: 'warehouse',
        icon: 'fa-warehouse',
        title: `استلام مؤقت #${receipt_number} بانتظار المراجعة`,
        body: `${item_count} صنف | استلمها: ${received_by_name || '—'}`,
        link: `/direct-receipts`,
        priority: 'normal',
        entity_type: 'direct_receipt',
        entity_id: receipt_id,
    });

    return id;
}

// 3. تنبيه أمين المستودع: أمر فسح
async function notifyReleaseOrderCreated({ order_id, order_number, client_name, items_summary }) {
    if (!await _isInternalWhatsAppEnabled()) return null;
    const phone = await _getInternalSetting('warehouse_keeper_whatsapp_phone');
    if (!phone) return null;
    const session = (await _getInternalSetting('internal_whatsapp_session')) || 'internal';

    const body = `📤 أمر فسح بضاعة\n\nرقم الأمر: #${order_number}\nالعميل: ${client_name}\n\nالأصناف:\n${items_summary}\n\nيرجى الاستلام وتجهيز البضاعة للإفراج.`;

    const id = await enqueue({
        channel: 'whatsapp',
        recipient: WhatsApp.normalizePhone(phone),
        recipient_name: 'أمين المستودع',
        recipient_role: 'warehouse_keeper',
        message_type: 'release_order_created',
        body,
        entity_type: 'order',
        entity_id: order_id,
        metadata: { order_number, client_name },
        priority: 'high',
        session,
    });

    await notifyInApp({
        target_role: 'warehouse_keeper',
        category: 'warehouse',
        icon: 'fa-truck',
        title: `أمر فسح #${order_number} — ${client_name}`,
        body: items_summary,
        link: `/orders/${order_id}`,
        priority: 'high',
        entity_type: 'order',
        entity_id: order_id,
    });

    return id;
}
```

**Exports الجديدة**:
```js
module.exports = {
    // ... الموجود
    notifyQuotationNeedsPricing,
    notifyDirectReceiptCreated,
    notifyReleaseOrderCreated,
};
```

**لماذا آمن**: دوال جديدة فقط. لا تعديل للدوال الموجودة (عدا `enqueue` بإضافة `session` اختياري). الـ feature flag يمنع أي إرسال لو `internal_whatsapp_enabled = false`.

---

### المرحلة 4: notification-worker.js — قراءة session من queue

**تغيير واحد فقط**: في `_sendWhatsApp`، تمرير `session` للدوال.

```js
// قبل
async function _sendWhatsApp(item) {
    // ...
    await WhatsApp.sendText(item.recipient, item.body);
    // ...
    await WhatsApp.sendImage(item.recipient, att.path, att.caption || '');
    await WhatsApp.sendFile(item.recipient, att.path, att.caption || '');
}

// بعد
async function _sendWhatsApp(item) {
    const session = item.session || 'default';
    // ...
    await WhatsApp.sendText(item.recipient, item.body, { session });
    // ...
    await WhatsApp.sendImage(item.recipient, att.path, att.caption || '', { session });
    await WhatsApp.sendFile(item.recipient, att.path, att.caption || '', { session });
}
```

**كمان**: في `_processQueue`، إضافة `session` للـ `RETURNING` في استعلام الـ claim.

```sql
-- قبل
RETURNING id, lease_id, ..., correlation_id

-- بعد
RETURNING id, lease_id, ..., correlation_id, session
```

**لماذا آمن**: `item.session || 'default'` — لو العمود مش موجود (قبل الـ migration)، JS يعطي undefined → `'default'`. لو الـ migration اتعمل، الصفوف القديمة عندها `'default'`.

---

### المرحلة 5: Triggers (نقاط التشغيل)

> **قاعدة**: كل trigger يكتب outbox event **داخل** الـ transaction. الـ worker يقرأ الـ outbox وينفذ.

#### 5a. Trigger 1: عرض سعر بسعر صفر

**ملف**: `backend/routes/orders.js` — POST `/` (إنشاء order)

**الموقع**: بعد `INSERT INTO orders` وقبل `COMMIT`، لو `pricing_status = 'pending'`:

```js
// داخل withTransaction، بعد orderInsert
if (order.pricing_status === 'pending') {
    const unpricedCount = processedItems.filter(i => !i.price || parseFloat(i.price) === 0).length;
    if (unpricedCount > 0) {
        await NotificationService.writeOutboxEvent({
            event_type: 'quotation_needs_pricing',
            entity_type: 'order',
            entity_id: order.id,
            correlation_id: NotificationService.generateCorrelationId('PRC'),
            payload: {
                order_id: order.id,
                order_number: order.order_number,
                client_name: /* fetch from DB */,
                unpriced_count: unpricedCount,
            },
            session: 'internal',
        }, client);
    }
}
```

**في الـ worker** (`_processOutbox`):
```js
case 'quotation_needs_pricing':
    await NotificationService.notifyQuotationNeedsPricing({
        ...payload,
        correlation_id: evt.correlation_id,
    });
    break;
```

#### 5b. Trigger 2: استلام بضاعة مؤقت

**ملف**: `backend/routes/direct-receipts.js` — POST `/` (إنشاء receipt)

**الموقع**: بعد `INSERT INTO direct_receipts` وقبل `COMMIT`:

```js
await NotificationService.writeOutboxEvent({
    event_type: 'direct_receipt_created',
    entity_type: 'direct_receipt',
    entity_id: receiptId,
    correlation_id: NotificationService.generateCorrelationId('RCV'),
    payload: {
        receipt_id: receiptId,
        receipt_number: receiptNumber,
        item_count: items.length,
        received_by_name: req.user.name,
    },
    session: 'internal',
}, client);
```

#### 5c. Trigger 3: أمر فسح (release)

**ملف**: `backend/routes/orders.js` — POST `/:id/release`

**الموقع**: بعد `COMMIT` بنجاح (لأنه لو فشل الـ transaction، لا رسالة):

```js
// بعد withTransaction بنجاح
const itemsSummary = items.map(i => `• ${i.product_name} (${i.size_name}) — ${i.quantity}`).join('\n');
await NotificationService.notifyReleaseOrderCreated({
    order_id: id,
    order_number: order.order_number,
    client_name: /* fetch */,
    items_summary: itemsSummary,
});
```

> **ملاحظة**: الـ release trigger مباشر (بدون outbox) لأنه بعد `COMMIT` — الـ transaction خلص. الـ notifyReleaseOrderCreated بتكتب في الـ queue مباشرة. لو فشل الإدراج في الـ queue، الـ business operation خلصت بالفعل (لا rollback). هذا مقبول لأن الـ in-app notification هتوصل على الأقل.

---

### المرحلة 6: Settings UI (WhatsApp Center)

**ملف**: `frontend/views/whatsapp-center.html` + `frontend/js/views/whatsapp-center.js`

إضافة قسم "الإشعارات الداخلية" فيه:
- Toggle: تفعيل الإشعارات الداخلية (`internal_whatsapp_enabled`)
- Input: رقم المدير (`manager_whatsapp_phone`)
- Input: رقم أمين المستودع (`warehouse_keeper_whatsapp_phone`)
- زر "حفظ"

**Backend**: إضافة endpoint `PUT /api/notifications/whatsapp/internal-settings` في `notifications.js`:

```js
router.put('/whatsapp/internal-settings', authenticate, authorize(['admin', 'super_admin']), async (req, res) => {
    const { enabled, manager_phone, warehouse_keeper_phone } = req.body;
    // Validation: أرقام سعودية صحيحة
    // UPDATE notification_settings SET value = $1 WHERE key = $2
    // لكل مفتاح
});
```

---

### المرحلة 7: docker-compose + QR Pairing

**ملف**: `docker-compose.yml`

```yaml
environment:
    # ... الموجود
    WAHA_SESSION_INTERNAL: ${WAHA_SESSION_INTERNAL:-internal}
```

**QR Pairing للجلسة الداخلية**:
- إضافة endpoint: `GET /api/notifications/whatsapp/qr/:session` في `notifications.js`
- في الـ WhatsApp Center UI: زر "إقران رقم الإدارة" يعرض QR للجلسة `internal`
- مسح QR مرة واحدة من هاتف رقم الإدارة

---

## 4. ترتيب التنفيذ (لا تخطي)

```
المرحلة 1 (DB)  →  المرحلة 2 (service)  →  المرحلة 3 (notification-service)
        ↓
المرحلة 4 (worker)  →  المرحلة 5 (triggers)  →  المرحلة 6 (UI)  →  المرحلة 7 (docker)
```

**كل مرحلة قابلة للنشر وحدها بدون كسر**:
- بعد المرحلة 1: DB جاهز، لا تغيير في الكود
- بعد المرحلة 2: service يدعم multi-session، لا caller يستخدمه بعد
- بعد المرحلة 3: دوال موجودة، لا أحد يستدعيها
- بعد المرحلة 4: worker يقرأ session، الرسائل القديمة تفضل `'default'`
- بعد المرحلة 5: triggers شغالة بس `internal_whatsapp_enabled = false` → لا إرسال
- بعد المرحلة 6: المدير يقدر يفعّل من الـ UI
- بعد المرحلة 7: الجلسة الداخلية مربوطة وجاهزة

---

## 5. الاختبارات (Tests)

| المرحلة | ملف الـ test | ما يختبر |
|---|---|---|
| 2 | `tests/services/whatsapp-service.test.js` | multi-session في sendText/sendImage/sendFile |
| 3 | `tests/services/notification-service.test.js` | دوال الإشعارات الجديدة + feature flag |
| 4 | `tests/services/notification-worker.test.js` | قراءة session من queue item |
| 5 | `tests/routes/orders.test.js` | trigger عرض سعر بسعر صفر |
| 5 | `tests/routes/direct-receipts.test.js` | trigger استلام مؤقت |
| 6 | `tests/routes/notifications.test.js` | endpoint الإعدادات |

**Tests صارمة**:
- لو `internal_whatsapp_enabled = false` → لا enqueue، لا notifyInApp
- لو `manager_whatsapp_phone = null` → لا enqueue
- لو `session = 'internal'` → body.session === `'internal'` في WAHA request
- Idempotency: نفس الـ event مرتين → queue item واحد

---

## 6. المخاطر والاحتياطات

| المخاطرة | الاحتياط |
|---|---|
| WAHA لا يدعم multi-session | التحقق من إصدار WAHA. لو ما يدعمش، نستخدم WAHA instance ثاني (container ثاني) |
| رقم الإدارة مش مربوط (QR لم يُمسح) | الـ circuit breaker يفتح، الرسائل تفضل في الـ queue، الـ in-app notification توصل |
| الـ migration يفشل | `ADD COLUMN IF NOT EXISTS` — آمن للإعادة |
| الـ trigger يفشل داخل الـ transaction | الـ outbox event يتراجع مع الـ transaction (نفس الـ rollback) |
| رسائل مكررة | `idempotency_key` من `entity_type + entity_id + message_type + recipient` |
| أداء الـ queue | الإشعارات الداخلية قليلة (أحداث نادرة) — لا تأثير |
| الوصول للأرقام | مخزنة في `notification_settings` (JSONB) — مش في الكود |

---

## 7. ما لا نلمسه (قائمة سلبية)

- ❌ `whatsapp-service.js` provider logic (WAHA REST calls) — بس نضيف `session` parameter
- ❌ `circuit-breaker.js` — لا تغيير
- ❌ `template-engine.js` — لا تغيير (الرسائل الداخلية hardcoded في notification-service)
- ❌ `notification_dead_queue` schema — بس نضيف `session` column للتماثل
- ❌ الإشعارات الموجودة (design_approved, design_sent_to_client) — لا تغيير
- ❌ `public-design.html` / `design-review.html` — لا تغيير
- ❌ `approval-service.js` — لا تغيير

---

## 8. قائمة الملفات المعدلة/الجديدة

### ملفات جديدة:
- `backend/migrations/075_internal_whatsapp_notifications.sql`
- `backend/tests/services/notification-service-internal.test.js`

### ملفات معدلة:
- `backend/services/whatsapp-service.js` (المرحلة 2)
- `backend/services/notification-service.js` (المرحلة 3)
- `backend/services/notification-worker.js` (المرحلة 4)
- `backend/routes/orders.js` (المرحلة 5a, 5c)
- `backend/routes/direct-receipts.js` (المرحلة 5b)
- `backend/routes/notifications.js` (المرحلة 6)
- `frontend/views/whatsapp-center.html` (المرحلة 6)
- `frontend/js/views/whatsapp-center.js` (المرحلة 6)
- `docker-compose.yml` (المرحلة 7)

### ملفات test معدلة:
- `backend/tests/services/whatsapp-service.test.js` (المرحلة 2)

---

## 9. معايير القبول (Definition of Done)

- [ ] الـ migration يشتغل بدون خطأ على DB فيه بيانات
- [ ] الرسائل القديمة (design_approved) تفضل ترسل بـ `session: 'default'`
- [ ] لو `internal_whatsapp_enabled = false`، لا رسالة داخلية تُرسل
- [ ] عرض سعر بسعر صفر → رسالة في `notification_queue` بـ `session: 'internal'`
- [ ] استلام مؤقت → رسالة في `notification_queue` بـ `session: 'internal'`
- [ ] أمر فسح → رسالة في `notification_queue` بـ `session: 'internal'`
- [ ] الـ worker يرسل الرسالة للجلسة الصحيحة (`internal` أو `default`)
- [ ] الـ WhatsApp Center يعرض الإعدادات ويحفظها
- [ ] كل الـ tests (الجديدة + القديمة) تمر
- [ ] لا كسر في أي workflow موجود

---

## 10. الأسئلة المفتوحة (تحتاج قرار قبل التنفيذ)

1. **WAHA version**: هل WAHA الحالي يدعم multi-session في نفس الـ container؟ (يتطلب فحص إصدار WAHA)
2. **أرقام الاختبار**: هل عندك أرقام واتساب للاختبار (واحد للإدارة، واحد للمستودع)؟
3. **الرسائل**: هل النصوص المقترحة مناسبة أو تريد تعديلها؟
4. **الأولوية**: هل نبدأ بالمرحلة 1-2 (البنية) أم تريد تنفيذ كامل دفعة واحدة؟
