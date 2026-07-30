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

// ── Config ───────────────────────────────────────────────────────────────────
// Supports ANY OpenAI-compatible provider: OpenAI, Azure OpenAI, OpenRouter,
// Groq, Together AI, Ollama, LM Studio, etc.
// Just set OPENAI_BASE_URL to the provider's endpoint.
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const AI_ENABLED = process.env.AI_ASSISTANT_ENABLED !== 'false' && OPENAI_API_KEY.length > 0;

const SYSTEM_PROMPT = `أنت مساعد ذكي لنظام G.PACK 2.0 لإدارة المستودعات والمبيعات والتصنيع.
تجاوب باللغة العربية دائماً.
استخدم الدوال المتاحة لجلب البيانات. اختر الدالة المناسبة بسرعة.
إذا لم تكن هناك دالة مناسبة، أبلغ المستخدم بوضوح.
كن مختصراً ودقيقاً. استخدم الجداول Markdown عند عرض بيانات متعددة.
استخدم الريال السعودي للقيم المالية.
إذا كانت النتيجة فارغة، قل أنه لا توجد بيانات.
عند اقتراح أسعار، اراعِ التكلفة وهامش الربح المعقول (15-30%).

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
- users — المستخدمون
- tasks — المهام
- settings — الإعدادات

مثال: [[action:navigate|warehouses|فتح صفحة المخازن]]
مثال: [[action:filter|inventory:warehouse_id=5|فلترة المخزون بالمستودع]]
مثال: [[action:navigate|quotations|فتح صفحة عروض الأسعار]]
مثال: [[action:navigate|sales-invoices|فتح صفحة الفواتير]]
اكتب الإجراءات في سطر منفصل بعد الرد. максимум 3 إجراءات لكل رد.

--- اقتراح إجراءات تنفيذية ---
عندما يطلب المستخدم إنشاء عرض سعر أو تسجيل دفعة أو تحويل عرض لفاتورة أو إنشاء أمر تشغيل، اقترح إجراء تنفيذي بصيغة:
[[propose_action:create_quote|{"client_name":"اسم العميل","items":[{"product_name":"اسم المنتج","quantity":100}]}|إنشاء عرض سعر]]
[[propose_action:add_payment|{"order_number":123,"amount":500,"payment_method":"cash"}|تسجيل دفعة]]
[[propose_action:convert_quote_to_invoice|{"order_number":123}|تحويل لفاتورة]]
[[propose_action:create_production_order|{"client_name":"اسم العميل","items":[{"product_name":"اسم المنتج","quantity":100}],"internal_notes":"ملاحظات"}|إنشاء أمر تشغيل]]
اكتب الإجراء في سطر منفصل. الإجراء سيتم تنفيذه فقط بعد تأكيد المستخدم.

--- نتائج البحث ---
عند استخدام دالة globalSearch، اعرض النتائج مصنفة حسب الفئة (عملاء، منتجات، طلبات، فواتير، موردين).
لكل نتيجة، أضف زر تنقل بصيغة:
[[action:navigate|clients|فتح صفحة العملاء]]
[[action:navigate|products|فتح صفحة المنتجات]]
[[action:navigate|quotations|فتح صفحة عروض الأسعار]]
[[action:navigate|sales-invoices|فتح صفحة الفواتير]]
[[action:navigate|suppliers|فتح صفحة الموردين]]
أضف أزرار التنقل المناسبة لكل فئة وجدت فيها نتائج.

--- إجراءات مجمعة ---
عندما يطلب المستخدم تطبيق تغيير على مجموعة منتجات أو إنشاء طلبات شراء متعددة، اقترح إجراء مجمع بصيغة:
[[propose_action:bulk_update_prices|{"category":"أكواب","percentage":10,"direction":"increase"}|زيادة أسعار الأكواب 10%]]
[[propose_action:bulk_create_reorders|{"supplier_name":"اسم المورد","max_items":20}|إنشاء طلبات شراء للأصناف منخفضة المخزون]]
الإجراء سيتم تنفيذه فقط بعد تأكيد المستخدم.`;

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

        // Execute in transaction
        const result = await action.execute(logEntry.proposal, req.user);

        // Update action log
        await db.query(
            `UPDATE ai_action_log
             SET status = 'executed', result = $1::jsonb, executed_at = NOW()
             WHERE id = $2`,
            [JSON.stringify(result), action_id]
        );

        res.json({ success: true, result });
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
// POST /api/ai-assistant/chat
// Body: { message: string, context?: { page, entity_type, entity_id } }
// =============================================================================
router.post('/chat', async (req, res) => {
    const { message, context } = req.body;

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

    try {
        // ── 1. Load recent conversation context (last 10 messages) ──────────
        const historyResult = await db.query(
            `SELECT role, content FROM ai_chat_history
             WHERE user_id = $1
             ORDER BY created_at DESC LIMIT 10`,
            [req.user.id]
        );
        const recentMessages = historyResult.rows.reverse().map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
        }));

        // ── 2. Save user message ─────────────────────────────────────────────
        await db.query(
            `INSERT INTO ai_chat_history (user_id, role, content) VALUES ($1, 'user', $2)`,
            [req.user.id, message.trim()]
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
        const proposedActions = [];
        const proposeRegex = /\[\[propose_action:(\w+)\|(\{[^}]*\})\|([^\]]+)\]\]/g;
        let proposeMatch;
        while ((proposeMatch = proposeRegex.exec(reply)) !== null) {
            try {
                proposedActions.push({
                    action_type: proposeMatch[1],
                    args: JSON.parse(proposeMatch[2]),
                    label: proposeMatch[3].trim(),
                });
            } catch {
                // Skip malformed JSON
            }
        }
        // Remove propose_action tags from reply text
        reply = reply.replace(proposeRegex, '').trim();

        // ── 7. Save assistant reply ──────────────────────────────────────────
        await db.query(
            `INSERT INTO ai_chat_history (user_id, role, content) VALUES ($1, 'assistant', $2)`,
            [req.user.id, reply]
        );

        res.json({
            reply,
            actions: actions.length > 0 ? actions : undefined,
            proposed_actions: proposedActions.length > 0 ? proposedActions : undefined,
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

module.exports = router;
