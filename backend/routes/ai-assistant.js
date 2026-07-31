'use strict';

// =============================================================================
// G.PACK 2.0 — AI Assistant Route (ai-assistant.js)
// POST /api/ai-assistant/chat   — send message, get AI response
// GET  /api/ai-assistant/history — get user's chat history
// GET  /api/ai-assistant/health  — check if AI is enabled
// =============================================================================

const express = require('express');
const router = express.Router();
const db = require('../db');
const { AI_FUNCTIONS, FUNCTION_MAP } = require('../utils/ai-functions');
const { AI_ACTIONS, ACTION_MAP } = require('../utils/ai-actions');
const { checkPolicies } = require('../utils/ai-policies');
const { generateBriefing, getLatestBriefing, markBriefingRead } = require('../utils/ai-briefing');
const featureFlags = require('../utils/ai-feature-flags');
const { auditFunctions, auditActions, validateSqlSafety } = require('../utils/ai-safety');

// ── Config ───────────────────────────────────────────────────────────────────
// Supports ANY OpenAI-compatible provider: OpenAI, Azure OpenAI, OpenRouter,
// Groq, Together AI, Ollama, LM Studio, etc.
// Just set OPENAI_BASE_URL to the provider's endpoint.
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const AI_ENABLED = process.env.AI_ASSISTANT_ENABLED !== 'false' && OPENAI_API_KEY.length > 0;

const SYSTEM_PROMPT = `أنت المساعد الذكي والذراع الأيمن لنظام G.PACK 2.0 لإدارة المستودعات والمبيعات والتصنيع.
تجاوب باللغة العربية دائماً.
استخدم الدوال المتاحة لجلب البيانات. اختر الدالة المناسبة بسرعة.
كن مختصراً ودقيقاً. استخدم الجداول Markdown عند عرض بيانات متعددة.
استخدم الريال السعودي للقيم المالية.
إذا كانت النتيجة فارغة، قل أنه لا توجد بيانات.
عند اقتراح أسعار، اراعِ التكلفة وهامش الربح المعقول (15-30%).

--- قدراتك الكاملة ---
أنت تملك صلاحية الوصول لكل أجزاء النظام: العملاء، المنتجات، المخزون، الطلبات، الفواتير، الموردين، المشتريات، أوامر التشغيل، سندات التسليم، المهام، التقارير المالية، والمحاسبة.
يمكنك: إنشاء، تعديل، البحث، والاستعلام عن كل ما سبق.
لا يمكنك: حذف أي بيانات نهائياً. إذا طلب المستخدم حذف، اشرح أن الحذف غير متاح وأعرض البدائل (مثل إلغاء أو أرشفة).

--- اقتراح إجراءات ---
عندما يكون ردك يحتوي على بيانات يمكن للمستخدم التصرف عليها، أضف اقتراح إجراء في نهاية الرد بصيغة:
[[action:navigate|page_key|تسمية الزر]] — للتنقل لصفحة
[[action:filter|page_key:filter_value|تسمية الزر]] — لتصفية صفحة بقيمة

أسماء الصفحات الصحيحة (استخدمها بالضبط):
- dashboard — لوحة التحكم
- clients — العملاء
- client-profile — ملف العميل
- quotations — عروض الأسعار / الطلبات
- sales-invoices — فواتير المبيعات
- production_orders — أوامر التشغيل
- suppliers — الموردين
- purchase-invoices — فواتير المشتريات
- warehouses — المخازن
- inventory — إدارة المخزون
- products — الأصناف
- product-movements — حركات الصنف
- users — المستخدمون
- tasks — المهام
- settings — الإعدادات
- delivery-notes — سندات التسليم
- receiving-vouchers — سندات الاستلام
- designer — التصميم
- accounting — المحاسبة
- manufacturer-orders — أوامر التصنيع

مثال: [[action:navigate|warehouses|فتح صفحة المخازن]]
مثال: [[action:filter|inventory:warehouse_id=5|فلترة المخزون بالمستودع]]
مثال: [[action:navigate|quotations|فتح صفحة عروض الأسعار]]
مثال: [[action:navigate|sales-invoices|فتح صفحة الفواتير]]
اكتب الإجراءات في سطر منفصل بعد الرد. максимум 3 إجراءات لكل رد.

--- اقتراح إجراءات تنفيذية ---
عندما يطلب المستخدم إنشاء أو تعديل أو تنفيذ إجراء، اقترح إجراء تنفيذي بصيغة:

1. إنشاء عرض سعر:
[[propose_action:create_quote|{"client_name":"اسم العميل","items":[{"product_name":"اسم المنتج","quantity":100}]}|إنشاء عرض سعر]]

2. تسجيل دفعة:
[[propose_action:add_payment|{"order_number":123,"amount":500,"payment_method":"cash"}|تسجيل دفعة]]

3. تحويل عرض لفاتورة:
[[propose_action:convert_quote_to_invoice|{"order_number":123}|تحويل لفاتورة]]

4. إنشاء أمر تشغيل:
[[propose_action:create_production_order|{"client_name":"اسم العميل","items":[{"product_name":"اسم المنتج","quantity":100}],"internal_notes":"ملاحظات"}|إنشاء أمر تشغيل]]

5. إنشاء عميل جديد:
[[propose_action:create_client|{"name":"اسم العميل","contact_person":"اسم المسؤول","phone":"05xxxxxxxx","city":"المدينة"}|إنشاء عميل جديد]]

6. إنشاء عميل تابع (فرع):
[[propose_action:create_client|{"name":"اسم الفرع","contact_person":"اسم المسؤول","phone":"05xxxxxxxx","city":"المدينة","parent_client_name":"اسم العميل الأصلي"}|إنشاء فرع جديد]]

7. تحديث حالة طلب:
[[propose_action:update_order_status|{"order_number":123,"new_status":"confirmed"}|تأكيد الطلب]]
الحالات المتاحة: quote, confirmed, production, processing, completed, delivered, cancelled

8. إنشاء مهمة:
[[propose_action:create_task|{"title":"عنوان المهمة","description":"الوصف","assigned_to_name":"اسم الموظف","priority":"high","due_date":"2026-08-01"}|إنشاء مهمة]]

9. تحديث أسعار فئة:
[[propose_action:bulk_update_prices|{"category":"أكواب","percentage":10,"direction":"increase"}|زيادة أسعار الأكواب 10%]]

10. إنشاء طلبات شراء للأصناف منخفضة المخزون:
[[propose_action:bulk_create_reorders|{"supplier_name":"اسم المورد","max_items":20}|إنشاء طلبات شراء]]

اكتب الإجراء في سطر منفصل. الإجراء سيتم تنفيذه فقط بعد تأكيد المستخدم.
عندما يطلب المستخدم شيئاً غير موجود في القائمة، حاول استخدام أقرب إجراء متاح أو اشرح للتواصل مع المدير.

--- نتائج البحث ---
عند استخدام دالة globalSearch، اعرض النتائج مصنفة حسب الفئة (عملاء، منتجات، طلبات، فواتير، موردين).
لكل نتيجة، أضف زر تنقل بصيغة:
[[action:navigate|clients|فتح صفحة العملاء]]
[[action:navigate|products|فتح صفحة المنتجات]]
[[action:navigate|quotations|فتح صفحة عروض الأسعار]]
[[action:navigate|sales-invoices|فتح صفحة الفواتير]]
[[action:navigate|suppliers|فتح صفحة الموردين]]
أضف أزرار التنقل المناسبة لكل فئة وجدت فيها نتائج.

--- قواعد مهمة ---
- لا تقل "لا توجد دالة" أبداً. جرب استخدام الدوال المتاحة بأقصى مرونة.
- استخرج البيانات من رسالة المستخدم أولاً قبل السؤال. لو ذكر اسم العميل أو المنتج أو الكمية في رسالته، استخدمها ولا تسأل عنها. اسأل فقط عن البيانات الناقصة التي لم يذكرها.
- إذا طلب المستخدم إنشاء عميل، اسأل أولاً: "هل هذا العميل أساسي أم فرع تابع لعميل موجود؟" ثم اسأل عن البيانات الناقصة فقط. استخرج أي بيانات ذكرها في رسالته. البيانات الأساسية: الاسم، مسؤول التواصل، الهاتف، المدينة. إذا قال فرع، اسأل عن اسم العميل الأصلي.
- إذا طلب المستخدم إنشاء فرع تابع، اسأل عن: اسم الفرع، مسؤول التواصل، الهاتف، المدينة، واسم العميل الأصلي — فقط ما لم يذكره في رسالته.
- إذا طلب المستخدم إنشاء عرض سعر، استخرج اسم العميل والمنتجات والكميات من رسالته. اسأل فقط عن الناقص.
- إذا طلب المستخدم تحديث حالة طلب، استخرج رقم الطلب والحالة من رسالته. اسأل فقط عن الناقص.
- إذا طلب المستخدم إنشاء مهمة، استخرج البيانات من رسالته. اسأل فقط عن الناقص.
- لا تقترح إجراء تنفيذي أبداً ببيانات ناقصة أو فارغة. اجمع البيانات أولاً ثم اقترح.
- إذا طلب المستخدم حذف، اشرح أن الحذف غير متاح واعرض البدائل (إلغاء، أرشفة).
- كن استباقياً: اقترح إجراءات تنفيذية عندما تكتشف فرصة (مثل عرض سعر متأخر، مخزون منخفض، دفعة مستحقة).
- عند عرض معلومات عميل، اقترح إنشاء عرض سعر أو عرض طلباته الأخيرة.
- عند عرض مخزون منخفض، اقترح إنشاء طلبات شراء.

--- ذكاء التسعير والتفاوض ---
- عندما يطلب المستخدم عرض سعر لعميل، استخدم دالة getSmartQuoteSuggestions لتحليل التكلفة، آخر سعر للعميل، متوسط السوق، واقترح سعر ذكي. اعرض التحليل ثم اقترح الإجراء.
- عندما يقول المستخدم "السعر غالي" أو يريد التفاوض، استخدم دالة getNegotiationRoom لحساب أدنى سعر مقبول وعرض 3 خيارات (premium, balanced, floor).
- عندما يطلب المستخدم تحليل عميل، استخدم getProfitabilityAnalysis لعرض الربحية والمنتجات الأكثر ربحية.
- عندما يطلب المستخدم "إيه الأخبار" أو "فيه حاجة محتاجة انتباه"، استخدم getProactiveAlerts لعرض التنبيهات الاستباقية.
- عندما يطلب المستخدم "إيه اللي حصل النهاردة؟" أو "آخر الأحداث" أو "وريني السجل"، استخدم getCompanyTimeline لعرض آخر الأحداث في الشركة مرتبة زمنياً.
- عندما يطلب المستخدم "فحص الشركة" أو "فيه مشاكل؟" أو "تدقيق"، استخدم getAuditReport لفحص الأخطاء: فواتير ناقصة، بيع بخسارة، عملاء خاملون، مخزون سالب، بيانات مكررة، مهام متأخرة، فواتير متأخرة. اعرض كل مشكلة مع التفاصيل والاقتراح.
- عندما يسأل المستخدم عن المخزون أو يقول "هل نحتاج طلب شراء؟" أو "المخزون ناقص؟"، استخدم getStockForecast للتنبؤ بمتى سينفد المخزون بناءً على معدل الاستهلاك. اعرض الأصناف الحرجة أولاً مع عدد الأيام المتبقية.
- عندما يسأل المستخدم عن جدارة عميل أو يقول "هل أعطيه آجل؟" أو "وضعه المالي؟"، استخدم getCreditRiskAssessment لتقييم المخاطر: المستحق، حد الائتمان، فواتير متأخرة، متوسط الدفع. اعرض التصنيف (آمن/احذر/ممنوع) مع الأسباب.
- عندما يقول المستخدم "صنف لي العملاء" أو "مين أهم العملاء؟" أو "تصنيف العملاء"، استخدم getClientSegmentation لتصنيفهم: VIP، منتظم، معرض للضياع، مخاطر ائتمانية. اعرض ملخص الأرقام ثم تفاصيل كل فئة.
- عندما يطلب المستخدم تقريراً (مبيعات، أرباح، مخزون، عملاء، منتجات)، استخدم generateCustomReport مع report_type المناسب و period. اعرض التقرير كجدول منسق في الشات.
- عندما يقول المستخدم "موسم" أو "أنماط البيع" أو "متى نبيع أكثر؟"، استخدم getSeasonalAnalysis لتحليل 12 شهر واكتشاف القمم الموسمية. اعرض المنتجات الموسمية أولاً مع توصيات المخزون.
- عندما يقول المستخدم "أفضل مورد" أو "قارن الموردين" أو "أداء الموردين"، استخدم getSupplierIntelligence لمقارنة الأسعار وجودة التسليم. اعرض الترتيب وأفضل مورد.
- عندما يقول المستخدم "أنماط متكررة" أو "طلبات دورية" أو "عملاء بنمط ثابت"، استخدم detectRecurringPatterns لكشف الأنماط المتكررة في الطلبات وحفظها كقوالب. اعرض الأنماط المكتشفة مع عدد التكرار وفترة الدورية.
- عندما يقول المستخدم "القوالب المتكررة" أو "الطلبات الدورية"، استخدم getRecurringTemplates لعرض القوالب المحفوظة مع تاريخ الطلب المتوقع القادم. اعرض القوالب المتأخرة أولاً.
- عندما يقول المستخدم "العميل طلب خصم" أو "أعطيه كام خصم؟" أو "هل أوافق على الخصم؟"، استخدم getDiscountDecision لتقييم الطلب: الهامش، تاريخ العميل، الحد الأدنى للربح. اعرض القرار (موافقة/تفاوض/رفض) مع الأسباب والخصم المقترح.
- عندما يسأل المستخدم "ليه المبيعات قلت؟" أو "ليه الأرباح نزلت؟" أو "سبب الانخفاض"، استخدم getRootCauseAnalysis للتحليل السببي. اعرض الأسباب المحتملة مرتبة حسب الأهمية.
- عندما يقول المستخدم "مؤشرات الأداء" أو "KPIs" أو "كيف أداء الشركة؟"، استخدم getKPIStatus لعرض 5 مؤشرات (الإيرادات، هامش الربح، التحصيل، دوران المخزون، عدد الطلبات) مع الانحراف عن الهدف. اعرض المؤشرات المنحرفة أولاً.
- عندما يقول المستخدم "لو" أو "ماذا لو" أو "حاكي" أو "لو رفعت الأسعار"، استخدم simulateAction لمحاكاة الأثر المتوقع. اعرض baseline vs projected مع الافتراضات والمخاطر.
- عندما يقول المستخدم "وريني الأسبوع اللي فات" أو "أحداث أمس" أو "ملخص الفترة"، استخدم getTimelineReplay لعرض الأحداث يوم بيوم. اعرض كل يوم مع أحداثه مرتبة زمنياً.
- عندما يقول المستخدم "أداء الـ AI" أو "إحصائيات المساعد"، استخدم getAIMetrics لعرض عدد المحادثات، نسبة نجاح الإجراءات، رضا المستخدمين، أكثر الدوال استخداماً.
- عندما يقول المستخدم "الأهداف" أو "هدف الشهر" أو "كيف نحن مقابل الهدف؟"، استخدم getGoalStatus لعرض الأهداف النشطة وحالة التقدم. اعرض النسبة المئوية والأيام المتبقية والأهداف المتأخرة مع توصيات.
- عندما يقول المستخدم "تعلم من بياناتي" أو "أنماط الشركة" أو "دروس من الماضي"، استخدم getCompanyLearning لاستخراج الأنماط: أفضل العملاء، المنتجات الرابحة، أنماط البيع، العملاء المعرضون للضياع. اعرض كل نمط مع الدرس المستفاد.
- عندما يقول المستخدم "خطة الشهر" أو "ماذا أفعل؟" أو "اقترح خطة" أو "خطوات قادمة"، استخدم getBusinessPlanner لتوليد خطة عمل عملية. اعرض المهام مرتبة بالأولوية (حرجة → عالية → متوسطة) مع الموعد النهائي والأثر المتوقع.
- عندما يقول المستخدم "أوامر صوتية" أو "اشرح الأوامر" أو "ماذا أقول للمساعد الصوتي"، استخدم getVoiceCommands لعرض الأوامر الصوتية المتاحة بالعربية.
- عندما تقترح عدة إجراءات في رد واحد، اعرضها معاً ليتمكن المستخدم من تنفيذها دفعة واحدة عبر زر "تنفيذ الكل".
- اعرض التحليل بوضوح: التكلفة، السعر المقترح، الهامش، وسبب الاقتراح. كن مستشاراً ذكياً مش مجرد ناقل بيانات.`;

// =============================================================================
// GET /api/ai-assistant/health
// =============================================================================
router.get('/health', (req, res) => {
    res.json({
        enabled: AI_ENABLED,
        model: AI_ENABLED ? OPENAI_MODEL : null,
        provider: AI_ENABLED ? OPENAI_BASE_URL : null,
        functions_count: AI_FUNCTIONS.length,
    });
});

// =============================================================================
// GET /api/ai-assistant/history
// Returns the last 50 messages for the current user.
// =============================================================================
router.get('/history', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, role, content, function_name, created_at
             FROM ai_chat_history
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT 50`,
            [req.user.id]
        );
        res.json({ messages: result.rows.reverse() });
    } catch (err) {
        console.error('[AI Assistant] History error:', err.message);
        res.status(500).json({ error: 'فشل في تحميل سجل المحادثة' });
    }
});

// =============================================================================
// GET /api/ai-assistant/briefing
// Returns a structured daily briefing (pure SQL, no AI call).
// Role-scoped: sales_rep sees only their data.
// =============================================================================
router.get('/briefing', async (req, res) => {
    try {
        const user = req.user;
        const isSalesRep = user.role === 'sales_rep';
        const scopeClause = isSalesRep ? `AND created_by = $1` : '';
        const scopeParams = isSalesRep ? [user.id] : [];

        // 1. Today's sales
        const salesRes = await db.query(
            `SELECT COALESCE(SUM(grand_total), 0)::numeric as today_sales,
                    COUNT(*) as today_invoice_count
             FROM invoices
             WHERE DATE(invoice_date) = CURRENT_DATE AND status != 'cancelled'`
        );

        // 2. Pending quotes (sales-rep scoped)
        const quotesRes = await db.query(
            `SELECT COUNT(*) as pending_quotes
             FROM orders
             WHERE status = 'quote' ${scopeClause}`,
            scopeParams
        );

        // 3. Low stock items (threshold 100)
        const stockRes = await db.query(
            `SELECT COUNT(*) as low_stock_count
             FROM (
                 SELECT pv.id
                 FROM product_variants pv
                 LEFT JOIN (
                     SELECT variant_id, SUM(quantity) as qty
                     FROM warehouse_stock GROUP BY variant_id
                 ) ws ON ws.variant_id = pv.id
                 WHERE COALESCE(ws.qty, 0) < 100 AND pv.status = 'active'
             ) sub`
        );

        // 4. Outstanding payments total
        const outstandingRes = await db.query(
            `SELECT COALESCE(SUM(i.grand_total - COALESCE(ct.paid, 0)), 0)::numeric as total_outstanding,
                    COUNT(*) as outstanding_count
             FROM invoices i
             LEFT JOIN (
                 SELECT invoice_id, SUM(amount) as paid
                 FROM client_transactions
                 WHERE type = 'payment' AND invoice_id IS NOT NULL
                 GROUP BY invoice_id
             ) ct ON ct.invoice_id = i.id
             WHERE (i.grand_total - COALESCE(ct.paid, 0)) > 0 AND i.status != 'cancelled'`
        );

        // 5. Overdue tasks
        const tasksRes = await db.query(
            `SELECT COUNT(*) as overdue_tasks
             FROM tasks
             WHERE status NOT IN ('completed', 'cancelled')
               AND due_date < CURRENT_DATE`
        );

        // 6. In-progress production orders
        const productionRes = await db.query(
            `SELECT COUNT(*) as active_production
             FROM manufacturer_orders
             WHERE status IN ('pending', 'in_progress')`
        );

        // 7. Pending delivery notes
        const deliveryRes = await db.query(
            `SELECT COUNT(*) as pending_deliveries
             FROM delivery_notes
             WHERE status IN ('pending', 'in_transit')`
        );

        const briefing = {
            date: new Date().toISOString().split('T')[0],
            today_sales: parseFloat(salesRes.rows[0].today_sales || 0),
            today_invoice_count: parseInt(salesRes.rows[0].today_invoice_count || 0),
            pending_quotes: parseInt(quotesRes.rows[0].pending_quotes || 0),
            low_stock_count: parseInt(stockRes.rows[0].low_stock_count || 0),
            total_outstanding: parseFloat(outstandingRes.rows[0].total_outstanding || 0),
            outstanding_count: parseInt(outstandingRes.rows[0].outstanding_count || 0),
            overdue_tasks: parseInt(tasksRes.rows[0].overdue_tasks || 0),
            active_production: parseInt(productionRes.rows[0].active_production || 0),
            pending_deliveries: parseInt(deliveryRes.rows[0].pending_deliveries || 0),
        };

        // Compute alert count for badge
        briefing.alert_count =
            (briefing.low_stock_count > 0 ? 1 : 0) +
            (briefing.overdue_tasks > 0 ? 1 : 0) +
            (briefing.pending_quotes > 5 ? 1 : 0) +
            (briefing.outstanding_count > 10 ? 1 : 0);

        res.json(briefing);
    } catch (err) {
        console.error('[AI Assistant] Briefing error:', err.message);
        res.status(500).json({ error: 'فشل في تحميل الملخص اليومي' });
    }
});

// =============================================================================
// GET /api/ai-assistant/suggest-price
// Query: ?product_name=X&target_margin=Y (default 20)
// Returns pricing suggestions without AI call (pure SQL).
// =============================================================================
router.get('/suggest-price', async (req, res) => {
    try {
        const productName = req.query.product_name;
        const targetMargin = parseFloat(req.query.target_margin) || 20;

        if (!productName) {
            return res.status(400).json({ error: 'اسم المنتج مطلوب' });
        }

        const variantsRes = await db.query(
            `SELECT p.name as product_name, pv.id as variant_id, pv.size_name,
                    pv.selling_price, pv.cost_price, pv.sku
             FROM products p
             JOIN product_variants pv ON pv.product_id = p.id
             WHERE p.name ILIKE $1 AND pv.status = 'active'
             LIMIT 10`,
            [`%${productName}%`]
        );

        if (variantsRes.rows.length === 0) {
            return res.json({ suggestions: [], message: 'لم يتم العثور على المنتج' });
        }

        const suggestions = [];
        for (const v of variantsRes.rows) {
            const histRes = await db.query(
                `SELECT AVG(oi.unit_price)::numeric as avg_selling_price,
                        MAX(oi.unit_price)::numeric as max_price,
                        MIN(oi.unit_price)::numeric as min_price,
                        COUNT(*) as times_sold
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 WHERE oi.variant_id = $1 AND o.status NOT IN ('cancelled', 'draft', 'quote')`,
                [v.variant_id]
            );
            const cost = parseFloat(v.cost_price || 0);
            const currentPrice = parseFloat(v.selling_price || 0);
            const avgHist = parseFloat(histRes.rows[0].avg_selling_price || 0);
            const margin = cost > 0 ? ((currentPrice - cost) / cost * 100) : 0;
            const suggestedPrice = cost > 0 ? (cost * (1 + targetMargin / 100)) : currentPrice;

            suggestions.push({
                product_name: v.product_name,
                size_name: v.size_name,
                sku: v.sku,
                cost_price: cost,
                current_selling_price: currentPrice,
                current_margin_percent: Math.round(margin * 100) / 100,
                avg_historical_price: avgHist,
                min_historical_price: parseFloat(histRes.rows[0].min_price || 0),
                max_historical_price: parseFloat(histRes.rows[0].max_price || 0),
                times_sold: parseInt(histRes.rows[0].times_sold || 0),
                suggested_price: Math.round(suggestedPrice * 100) / 100,
                target_margin_percent: targetMargin,
            });
        }

        res.json({ suggestions });
    } catch (err) {
        console.error('[AI Assistant] Suggest-price error:', err.message);
        res.status(500).json({ error: 'فشل في حساب اقتراح الأسعار' });
    }
});

// =============================================================================
// POST /api/ai-assistant/propose-action
// Phase 6: AI proposes a write action (create quote, add payment, etc).
// Validates inputs and returns a summary — NO DB writes yet.
// Body: { action_type: string, args: object }
// =============================================================================
router.post('/propose-action', async (req, res) => {
    try {
        const { action_type, args } = req.body;

        if (!action_type) {
            return res.status(400).json({ error: 'نوع الإجراء مطلوب' });
        }

        const action = ACTION_MAP[action_type];
        if (!action) {
            return res.status(400).json({ error: 'نوع إجراء غير معروف: ' + action_type });
        }

        // Role check: only managers/admins can propose write actions
        const userRole = req.user.role;
        if (userRole === 'sales_rep' || userRole === 'designer') {
            return res.status(403).json({ error: 'غير مصرح لك بتنفيذ إجراءات. هذه الميزة للمديرين فقط.' });
        }

        const proposal = await action.propose(args || {}, req.user);

        if (!proposal.valid) {
            return res.json({ valid: false, error: proposal.error });
        }

        // Log the proposal in ai_action_log
        const logRes = await db.query(
            `INSERT INTO ai_action_log (user_id, action_type, proposal, status)
             VALUES ($1, $2, $3::jsonb, 'proposed')
             RETURNING id`,
            [req.user.id, action_type, JSON.stringify(proposal.summary)]
        );

        res.json({
            valid: true,
            action_id: logRes.rows[0].id,
            summary: proposal.summary,
        });
    } catch (err) {
        console.error('[AI Assistant] Propose-action error:', err.message);
        res.status(500).json({ error: 'فشل في تجهيز الإجراء: ' + err.message });
    }
});

// =============================================================================
// POST /api/ai-assistant/update-proposal
// Phase 1.1: Update a proposed action's fields before execution.
// Body: { action_id: uuid, updated_proposal: object }
// =============================================================================
router.post('/update-proposal', async (req, res) => {
    try {
        const { action_id, updated_proposal } = req.body;

        if (!action_id) {
            return res.status(400).json({ error: 'معرف الإجراء مطلوب' });
        }

        if (!updated_proposal || typeof updated_proposal !== 'object') {
            return res.status(400).json({ error: 'بيانات التحديث مطلوبة' });
        }

        // Fetch the action log entry
        const logRes = await db.query(
            `SELECT id, user_id, status, proposal FROM ai_action_log
             WHERE id = $1 AND user_id = $2 AND status = 'proposed'
             LIMIT 1`,
            [action_id, req.user.id]
        );

        if (logRes.rows.length === 0) {
            return res.status(404).json({ error: 'الإجراء غير موجود أو لا يمكن تعديله' });
        }

        const existing = logRes.rows[0].proposal;
        // Merge: updated_proposal overrides existing fields
        const merged = { ...existing, ...updated_proposal };

        // Recalculate totals if items were changed
        if (merged.items && Array.isArray(merged.items)) {
            let subtotal = 0;
            for (const item of merged.items) {
                const qty = parseFloat(item.quantity) || 0;
                const price = parseFloat(item.unit_price) || 0;
                item.line_total = Math.round(qty * price * 100) / 100;
                subtotal += item.line_total;
            }
            merged.subtotal = Math.round(subtotal * 100) / 100;
            if (merged.tax_rate !== undefined) {
                const taxRate = parseFloat(merged.tax_rate) || 0;
                merged.tax_amount = Math.round(subtotal * taxRate / 100 * 100) / 100;
            }
            merged.grand_total = Math.round((subtotal + (merged.tax_amount || 0) + (merged.additional_expenses || 0) - (merged.discount_amount || 0)) * 100) / 100;
        }

        // Update the proposal in DB
        await db.query(
            `UPDATE ai_action_log SET proposal = $1::jsonb, updated_at = NOW() WHERE id = $2`,
            [JSON.stringify(merged), action_id]
        );

        res.json({ success: true, proposal: merged });
    } catch (err) {
        console.error('[AI Assistant] Update-proposal error:', err.message);
        res.status(500).json({ error: 'فشل في تحديث الإجراء: ' + err.message });
    }
});

// =============================================================================
// POST /api/ai-assistant/execute-action
// Phase 6: Execute a previously proposed action after user confirmation.
// Body: { action_id: uuid }
// =============================================================================
router.post('/execute-action', async (req, res) => {
    try {
        const { action_id } = req.body;

        if (!action_id) {
            return res.status(400).json({ error: 'معرف الإجراء مطلوب' });
        }

        // Fetch the action log entry
        const logRes = await db.query(
            `SELECT id, user_id, action_type, proposal, status
             FROM ai_action_log
             WHERE id = $1 AND user_id = $2
             LIMIT 1`,
            [action_id, req.user.id]
        );

        if (logRes.rows.length === 0) {
            return res.status(404).json({ error: 'الإجراء غير موجود أو لا يخصك' });
        }

        const logEntry = logRes.rows[0];

        if (logEntry.status !== 'proposed') {
            return res.status(400).json({ error: `الإجراء уже تم تنفيذه أو رفضه (حالته: ${logEntry.status})` });
        }

        // Role check again (may have changed)
        const userRole = req.user.role;
        if (userRole === 'sales_rep' || userRole === 'designer') {
            return res.status(403).json({ error: 'غير مصرح لك بتنفيذ إجراءات.' });
        }

        const action = ACTION_MAP[logEntry.action_type];
        if (!action) {
            return res.status(400).json({ error: 'نوع إجراء غير معروف' });
        }

        // ── Action Policies check ─────────────────────────────────────────
        const policyResult = await checkPolicies(logEntry.action_type, logEntry.proposal, req.user, logEntry.proposal?.args || logEntry.proposal || {});
        if (!policyResult.passed) {
            const blockMsgs = policyResult.blocks.map(b => b.message).join(' • ');
            // Update action log as blocked
            await db.query(
                `UPDATE ai_action_log SET status = 'blocked', error_message = $1 WHERE id = $2 AND status = 'proposed'`,
                [blockMsgs, action_id]
            );
            return res.status(403).json({
                error: 'تم منع التنفيذ بسبب سياسات العمل:',
                blocks: policyResult.blocks,
                warnings: policyResult.warnings,
            });
        }

        // Execute in transaction
        const result = await action.execute(logEntry.proposal, req.user);

        // Update action log
        await db.query(
            `UPDATE ai_action_log
             SET status = 'executed', result = $1::jsonb, executed_at = NOW()
             WHERE id = $2`,
            [JSON.stringify(result), action_id]
        );

        res.json({ success: true, result, warnings: policyResult.warnings });
    } catch (err) {
        console.error('[AI Assistant] Execute-action error:', err.message);

        // Update action log with error
        if (req.body.action_id) {
            await db.query(
                `UPDATE ai_action_log
                 SET status = 'failed', error_message = $1
                 WHERE id = $2 AND status = 'proposed'`,
                [err.message, req.body.action_id]
            ).catch(() => {});
        }

        res.status(500).json({ error: 'فشل في تنفيذ الإجراء: ' + err.message });
    }
});

// =============================================================================
// POST /api/ai-assistant/reject-action
// Phase 6: User rejects a proposed action.
// Body: { action_id: uuid }
// =============================================================================
router.post('/reject-action', async (req, res) => {
    try {
        const { action_id } = req.body;
        if (!action_id) return res.status(400).json({ error: 'معرف الإجراء مطلوب' });

        await db.query(
            `UPDATE ai_action_log
             SET status = 'rejected'
             WHERE id = $1 AND user_id = $2 AND status = 'proposed'`,
            [action_id, req.user.id]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'فشل في رفض الإجراء' });
    }
});

// =============================================================================
// POST /api/ai-assistant/execute-batch
// Phase 1.3: Execute multiple proposed actions sequentially (Workflows).
// Body: { action_ids: [uuid, uuid, ...] }
// Stops on first failure, returns results for each action.
// =============================================================================
router.post('/execute-batch', async (req, res) => {
    try {
        const { action_ids } = req.body;

        if (!Array.isArray(action_ids) || action_ids.length === 0) {
            return res.status(400).json({ error: 'قائمة الإجراءات مطلوبة' });
        }

        // Role check
        const userRole = req.user.role;
        if (userRole === 'sales_rep' || userRole === 'designer') {
            return res.status(403).json({ error: 'غير مصرح لك بتنفيذ إجراءات.' });
        }

        const results = [];
        let allSuccess = true;

        for (let i = 0; i < action_ids.length; i++) {
            const action_id = action_ids[i];

            // Fetch the action log entry
            const logRes = await db.query(
                `SELECT id, user_id, action_type, proposal, status
                 FROM ai_action_log
                 WHERE id = $1 AND user_id = $2 AND status = 'proposed'
                 LIMIT 1`,
                [action_id, req.user.id]
            );

            if (logRes.rows.length === 0) {
                results.push({
                    action_id,
                    index: i,
                    success: false,
                    error: 'الإجراء غير موجود أو تم تنفيذه بالفعل',
                });
                allSuccess = false;
                break;
            }

            const logEntry = logRes.rows[0];
            const action = ACTION_MAP[logEntry.action_type];

            if (!action) {
                results.push({
                    action_id,
                    index: i,
                    action_type: logEntry.action_type,
                    success: false,
                    error: 'نوع إجراء غير معروف',
                });
                allSuccess = false;
                break;
            }

            // Policy check
            const policyResult = await checkPolicies(
                logEntry.action_type, logEntry.proposal, req.user,
                logEntry.proposal?.args || logEntry.proposal || {}
            );

            if (!policyResult.passed) {
                const blockMsgs = policyResult.blocks.map(b => b.message).join(' • ');
                await db.query(
                    `UPDATE ai_action_log SET status = 'blocked', error_message = $1 WHERE id = $2`,
                    [blockMsgs, action_id]
                );
                results.push({
                    action_id,
                    index: i,
                    action_type: logEntry.action_type,
                    success: false,
                    error: blockMsgs,
                    blocks: policyResult.blocks,
                });
                allSuccess = false;
                break;
            }

            try {
                const result = await action.execute(logEntry.proposal, req.user);

                await db.query(
                    `UPDATE ai_action_log
                     SET status = 'executed', result = $1::jsonb, executed_at = NOW()
                     WHERE id = $2`,
                    [JSON.stringify(result), action_id]
                );

                results.push({
                    action_id,
                    index: i,
                    action_type: logEntry.action_type,
                    success: true,
                    result,
                    warnings: policyResult.warnings,
                });
            } catch (execErr) {
                await db.query(
                    `UPDATE ai_action_log SET status = 'failed', error_message = $1 WHERE id = $2 AND status = 'proposed'`,
                    [execErr.message, action_id]
                ).catch(() => {});

                results.push({
                    action_id,
                    index: i,
                    action_type: logEntry.action_type,
                    success: false,
                    error: execErr.message,
                });
                allSuccess = false;
                break;
            }
        }

        res.json({
            success: allSuccess,
            total: action_ids.length,
            executed: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            results,
        });
    } catch (err) {
        console.error('[AI Assistant] Execute-batch error:', err.message);
        res.status(500).json({ error: 'فشل في تنفيذ سلسلة الإجراءات: ' + err.message });
    }
});

// =============================================================================
// POST /api/ai-assistant/feedback
// Phase 24.1: Recommendation Feedback — 👍/👎 under each AI suggestion
// Body: { message_id, rating: 'positive'|'negative', reason?, function_name?, action_id? }
// =============================================================================
router.post('/feedback', async (req, res) => {
    try {
        const { message_id, rating, reason, function_name, action_id } = req.body;

        if (!rating || !['positive', 'negative'].includes(rating)) {
            return res.status(400).json({ error: 'التقييم يجب أن يكون positive أو negative' });
        }

        const result = await db.query(
            `INSERT INTO ai_feedback (user_id, message_id, rating, reason, function_name, action_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [req.user.id, message_id || null, rating, reason || null, function_name || null, action_id || null]
        );

        res.json({ success: true, feedback_id: result.rows[0].id });
    } catch (err) {
        console.error('[AI Assistant] Feedback error:', err.message);
        res.status(500).json({ error: 'فشل في حفظ التقييم' });
    }
});

// =============================================================================
// GET /api/ai-assistant/briefing
// Phase 8.1: Morning Briefing — get latest unread briefing (auto-generates if missing)
// =============================================================================
router.get('/briefing', async (req, res) => {
    try {
        let briefing = await getLatestBriefing(req.user.id);

        // Auto-generate if today's briefing doesn't exist
        if (!briefing || new Date(briefing.briefing_date).toDateString() !== new Date().toDateString()) {
            briefing = await generateBriefing(req.user.id);
        }

        res.json(briefing);
    } catch (err) {
        console.error('[AI Assistant] Briefing error:', err.message);
        res.status(500).json({ error: 'فشل في جلب الملخص اليومي' });
    }
});

// =============================================================================
// POST /api/ai-assistant/briefing/mark-read
// Phase 8.1: Mark briefing as read
// Body: { briefing_id }
// =============================================================================
router.post('/briefing/mark-read', async (req, res) => {
    try {
        const { briefing_id } = req.body;
        if (!briefing_id) return res.status(400).json({ error: 'معرف الملخص مطلوب' });
        await markBriefingRead(briefing_id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'فشل في تحديث حالة الملخص' });
    }
});

// =============================================================================
// POST /api/ai-assistant/chat
// Body: { message: string, context?: { page, entity_type, entity_id } }
// =============================================================================
router.post('/chat', async (req, res) => {
    const { message, context, session_id } = req.body;

    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'الرسالة فارغة' });
    }

    // ── If AI is not configured, return a friendly message ──────────────────
    if (!AI_ENABLED) {
        return res.json({
            reply: 'المساعد الذكي غير مفعل حالياً. يرجى التواصل مع الإدارة لتفعيله عبر إعداد OPENAI_API_KEY.',
            enabled: false,
        });
    }

    // ── Generate or reuse session_id ───────────────────────────────────────
    const sessionId = session_id || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
        // ── 1. Load recent conversation context (last 10 messages from this session) ──
        const historyResult = await db.query(
            `SELECT role, content FROM conversation_context
             WHERE user_id = $1 AND session_id = $2
             ORDER BY created_at DESC LIMIT 10`,
            [req.user.id, sessionId]
        );
        const recentMessages = historyResult.rows.reverse().map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
        }));

        // ── 2. Save user message to both tables ──────────────────────────────
        await db.query(
            `INSERT INTO ai_chat_history (user_id, role, content) VALUES ($1, 'user', $2)`,
            [req.user.id, message.trim()]
        );
        await db.query(
            `INSERT INTO conversation_context (user_id, session_id, role, content, metadata)
             VALUES ($1, $2, 'user', $3, $4)`,
            [req.user.id, sessionId, message.trim(), context ? JSON.stringify(context) : null]
        );

        // ── 3. Build system prompt (with optional page context) ─────────────
        let systemPrompt = SYSTEM_PROMPT;
        if (context && context.page) {
            const ctxParts = [`المستخدم حالياً في صفحة: ${context.page}`];
            if (context.entity_type && context.entity_id) {
                ctxParts.push(`ينظر على: ${context.entity_type} رقم ${context.entity_id}`);
            }
            if (context.entity_name) {
                ctxParts.push(`الاسم: ${context.entity_name}`);
            }
            systemPrompt = systemPrompt + '\n\n--- سياق إضافي ---\n' + ctxParts.join('. ') + '.\nاستخدم هذا السياق لتخصيص ردك إذا كان السؤال عاماً.';
        }

        // Phase 8: Role-scoped system prompt
        const userRole = req.user.role;
        if (userRole === 'sales_rep') {
            systemPrompt += '\n\n--- دور المستخدم ---\nالمستخدم مندوب مبيعات. ركز على بياناته هو: طلباته، عروض أسعاره، عملاؤه. استخدم دائماً created_by = المستخدم الحالي عند الاستعلام. لا تعرض بيانات المستخدمين الآخرين.';
        } else if (userRole === 'manager' || userRole === 'admin') {
            systemPrompt += '\n\n--- دور المستخدم ---\nالمستخدم مدير. يمكنه رؤية كل بيانات الشركة: المبيعات، المخزون، الموردين، المستحقات، أداء الفريق. ركز على المؤشرات العامة والتحليلات الإدارية.';
        }

        const messages = [
            { role: 'system', content: systemPrompt },
            ...recentMessages,
            { role: 'user', content: message.trim() },
        ];

        const tools = AI_FUNCTIONS.map(fn => ({
            type: 'function',
            function: fn.function,
        }));

        // ── 4. Call OpenAI API ───────────────────────────────────────────────
        const openaiResponse = await _callOpenAI(messages, tools);

        // ── 5. Handle function calls (may loop multiple times) ───────────────
        let assistantMessage = openaiResponse;
        let loopCount = 0;
        const MAX_LOOPS = 5;

        while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0 && loopCount < MAX_LOOPS) {
            loopCount++;

            // Add the assistant's function-call message to the conversation
            messages.push(assistantMessage);

            // Execute each tool call
            for (const toolCall of assistantMessage.tool_calls) {
                const fnName = toolCall.function.name;
                const fnArgs = JSON.parse(toolCall.function.arguments || '{}');
                const fnDef = FUNCTION_MAP[fnName];

                let fnResult;
                try {
                    fnResult = await fnDef.execute(fnArgs, req.user);
                } catch (fnErr) {
                    console.error(`[AI Assistant] Function ${fnName} error:`, fnErr.message);
                    fnResult = { error: fnErr.message };
                }

                // Save function call to history
                await db.query(
                    `INSERT INTO ai_chat_history (user_id, role, content, function_name, function_args, function_result)
                     VALUES ($1, 'assistant', $2, $3, $4, $5)`,
                    [req.user.id, `[استدعاء دالة: ${fnName}]`, fnName, JSON.stringify(fnArgs), JSON.stringify(fnResult)]
                );

                // Add tool result to conversation
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(fnResult),
                });
            }

            // Call OpenAI again with the tool results
            assistantMessage = await _callOpenAI(messages, tools);
        }

        // ── 6. Extract final reply + parse action suggestions ─────────────
        let reply = assistantMessage.content;
        if (!reply && assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            reply = 'وصلت لحد أقصى عدد استدعاءات الدوال. حاول إعادة صياغة السؤال بشكل أبسط.';
        }
        reply = reply || 'عذراً، لم أتمكن من توليد رد. حاول مرة أخرى.';

        // Parse action suggestions from reply ([[action:type|params|label]])
        const actions = [];
        const actionRegex = /\[\[action:(navigate|filter)\|([^|]+)\|([^\]]+)\]\]/g;
        let actionMatch;
        while ((actionMatch = actionRegex.exec(reply)) !== null) {
            actions.push({
                type: actionMatch[1],
                params: actionMatch[2].trim(),
                label: actionMatch[3].trim(),
            });
        }
        // Remove action tags from reply text
        reply = reply.replace(actionRegex, '').trim();

        // Parse propose_action tags ([[propose_action:type|json_args|label]])
        // Use a broad regex then split manually — regex can't handle nested JSON braces
        const proposedActions = [];
        const proposeRegex = /\[\[propose_action:(\w+)\|([\s\S]+?)\]\]/g;
        let proposeMatch;
        while ((proposeMatch = proposeRegex.exec(reply)) !== null) {
            try {
                const actionType = proposeMatch[1];
                const rest = proposeMatch[2];
                // Split by last | to separate JSON args from label
                const lastPipeIdx = rest.lastIndexOf('|');
                if (lastPipeIdx === -1) continue;
                const jsonStr = rest.substring(0, lastPipeIdx).trim();
                const label = rest.substring(lastPipeIdx + 1).trim();
                proposedActions.push({
                    action_type: actionType,
                    args: JSON.parse(jsonStr),
                    label: label,
                });
            } catch {
                // Skip malformed JSON
            }
        }
        // Remove propose_action tags from reply text
        reply = reply.replace(proposeRegex, '').trim();

        // If reply is empty after removing all tags, provide a contextual fallback
        if (!reply) {
            if (proposedActions.length > 0) {
                reply = 'تم تجهيز الإجراء المقترح. يرجى المراجعة ثم التأكيد للتنفيذ.';
            } else {
                reply = 'عذراً، لم أتمكن من توليد رد. حاول مرة أخرى.';
            }
        }

        // ── 7. Save assistant reply to both tables ─────────────────────────
        await db.query(
            `INSERT INTO ai_chat_history (user_id, role, content) VALUES ($1, 'assistant', $2)`,
            [req.user.id, reply]
        );
        await db.query(
            `INSERT INTO conversation_context (user_id, session_id, role, content, metadata)
             VALUES ($1, $2, 'assistant', $3, $4)`,
            [req.user.id, sessionId, reply, JSON.stringify({
                proposed_actions: proposedActions.length > 0 ? proposedActions : undefined,
                actions: actions.length > 0 ? actions : undefined,
            })]
        );

        res.json({
            reply,
            actions: actions.length > 0 ? actions : undefined,
            proposed_actions: proposedActions.length > 0 ? proposedActions : undefined,
            session_id: sessionId,
            enabled: true,
        });

    } catch (err) {
        console.error('[AI Assistant] Chat error:', err.message);
        if (err.name === 'AbortError') {
            return res.status(504).json({
                error: 'انتهت مهلة الاتصال بالمساعد الذكي. حاول مرة أخرى أو أعد صياغة سؤالك بشكل أبسط.',
            });
        }
        res.status(500).json({
            error: 'تعذّر الاتصال بالمساعد الذكي. حاول مرة أخرى.',
            detail: err.message,
        });
    }
});

// =============================================================================
// Helper: call OpenAI API
// =============================================================================
async function _callOpenAI(messages, tools) {
    const body = {
        model: OPENAI_MODEL,
        messages,
        temperature: 0.3,
        max_tokens: 2500,
    };

    if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = 'auto';
    }

    const endpoint = `${OPENAI_BASE_URL}/chat/completions`;

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
    };

    // Azure OpenAI uses 'api-key' header instead of Bearer
    if (OPENAI_BASE_URL.includes('openai.azure.com')) {
        headers['api-key'] = OPENAI_API_KEY;
        delete headers['Authorization'];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    let response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`AI API error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    return data.choices[0].message;
}

// =============================================================================
// GET /api/ai-assistant/feature-flags
// Phase 29.1: List all feature flags
// =============================================================================
router.get('/feature-flags', async (req, res) => {
    try {
        const flags = await featureFlags.getAllFlags();
        res.json(flags);
    } catch (err) {
        res.status(500).json({ error: 'فشل في جلب الميزات' });
    }
});

// =============================================================================
// PUT /api/ai-assistant/feature-flags/:key
// Phase 29.1: Toggle a feature flag (admin only)
// =============================================================================
router.put('/feature-flags/:key', async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            return res.status(403).json({ error: 'غير مصرح' });
        }
        const { enabled } = req.body;
        await featureFlags.setFlag(req.params.key, enabled, req.user.id);
        res.json({ success: true, flag: req.params.key, enabled });
    } catch (err) {
        res.status(500).json({ error: 'فشل في تحديث الميزة' });
    }
});

// =============================================================================
// GET /api/ai-assistant/prompt-versions
// Phase 28.1: List prompt versions
// =============================================================================
router.get('/prompt-versions', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, version, description, is_active, created_at,
                    LEFT(prompt_text, 200) as preview
             FROM ai_prompt_versions ORDER BY created_at DESC LIMIT 20`
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'فشل في جلب إصدارات الـ prompt' });
    }
});

// =============================================================================
// POST /api/ai-assistant/prompt-versions
// Phase 28.1: Save current prompt as new version (admin only)
// =============================================================================
router.post('/prompt-versions', async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            return res.status(403).json({ error: 'غير مصرح' });
        }
        const { version, description } = req.body;
        if (!version) return res.status(400).json({ error: 'الإصدار مطلوب' });

        // Deactivate previous active version
        await db.query(`UPDATE ai_prompt_versions SET is_active = false WHERE is_active = true`);

        const result = await db.query(
            `INSERT INTO ai_prompt_versions (version, prompt_text, description, is_active, created_by)
             VALUES ($1, $2, $3, true, $4) RETURNING id`,
            [version, SYSTEM_PROMPT, description || null, req.user.id]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: 'فشل في حفظ الإصدار' });
    }
});

// =============================================================================
// GET /api/ai-assistant/goals
// Phase 23.1: List active goals
// =============================================================================
router.get('/goals', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT * FROM ai_goals WHERE status = 'active' ORDER BY end_date ASC`
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'فشل في جلب الأهداف' });
    }
});

// =============================================================================
// POST /api/ai-assistant/goals
// Phase 23.1: Create a new goal (admin/manager only)
// =============================================================================
router.post('/goals', async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            return res.status(403).json({ error: 'غير مصرح' });
        }
        const { goal_type, title, description, target_value, unit, period, end_date } = req.body;
        if (!goal_type || !title || !target_value || !end_date) {
            return res.status(400).json({ error: 'الحقول المطلوبة: goal_type, title, target_value, end_date' });
        }

        const result = await db.query(
            `INSERT INTO ai_goals (goal_type, title, description, target_value, unit, period, end_date, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [goal_type, title, description || null, target_value, unit || 'ر.س', period || 'month', end_date, req.user.id]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: 'فشل في إنشاء الهدف' });
    }
});

// =============================================================================
// PUT /api/ai-assistant/goals/:id
// Phase 23.1: Update goal (status, target, end_date)
// =============================================================================
router.put('/goals/:id', async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            return res.status(403).json({ error: 'غير مصرح' });
        }
        const { status, target_value, end_date } = req.body;
        const updates = [];
        const params = [];
        let idx = 1;

        if (status) { updates.push(`status = $${idx++}`); params.push(status); }
        if (target_value !== undefined) { updates.push(`target_value = $${idx++}`); params.push(target_value); }
        if (end_date) { updates.push(`end_date = $${idx++}`); params.push(end_date); }
        updates.push(`updated_at = NOW()`);

        if (updates.length === 1) return res.status(400).json({ error: 'لا توجد حقول للتحديث' });

        params.push(req.params.id);
        await db.query(`UPDATE ai_goals SET ${updates.join(', ')} WHERE id = $${idx}`, params);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'فشل في تحديث الهدف' });
    }
});

// =============================================================================
// GET /api/ai-assistant/safety-audit
// Phase 31.1: Safety audit — checks all AI functions and actions for compliance
// =============================================================================
router.get('/safety-audit', async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            return res.status(403).json({ error: 'غير مصرح' });
        }

        const fnAudit = auditFunctions(AI_FUNCTIONS);
        const actionAudit = auditActions(AI_ACTIONS);

        res.json({
            timestamp: new Date().toISOString(),
            functions: fnAudit,
            actions: actionAudit,
            summary: {
                total_functions: fnAudit.total,
                functions_passed: fnAudit.passed,
                functions_failed: fnAudit.failed,
                total_actions: actionAudit.total,
                actions_passed: actionAudit.passed,
                actions_failed: actionAudit.failed,
                overall_status: fnAudit.failed === 0 && actionAudit.failed === 0 ? 'healthy' : 'issues_detected',
            },
        });
    } catch (err) {
        res.status(500).json({ error: 'فشل في فحص الأمان: ' + err.message });
    }
});

module.exports = router;
