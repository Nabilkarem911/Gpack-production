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
عند اقتراح أسعار، اراعِ التكلفة وهامش الربح المعقول (15-30%).`;

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
// POST /api/ai-assistant/chat
// Body: { message: string }
// =============================================================================
router.post('/chat', async (req, res) => {
    const { message } = req.body;

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

        // ── 3. Build OpenAI request ──────────────────────────────────────────
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
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

        // ── 6. Extract final reply ───────────────────────────────────────────
        let reply = assistantMessage.content;
        if (!reply && assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            reply = 'وصلت لحد أقصى عدد استدعاءات الدوال. حاول إعادة صياغة السؤال بشكل أبسط.';
        }
        reply = reply || 'عذراً، لم أتمكن من توليد رد. حاول مرة أخرى.';

        // ── 7. Save assistant reply ──────────────────────────────────────────
        await db.query(
            `INSERT INTO ai_chat_history (user_id, role, content) VALUES ($1, 'assistant', $2)`,
            [req.user.id, reply]
        );

        res.json({ reply, enabled: true });

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
