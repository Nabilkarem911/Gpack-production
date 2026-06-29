'use strict';

// =============================================================================
// G.PACK 2.0 — AI Demand Forecasting Route
// /api/forecast
// =============================================================================

const express = require('express');
const router  = express.Router();
const http    = require('http');
const authorize = require('../middleware/authorize');
const { forecastQuery, validateBody } = require('../utils/validators');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai-service:8000';

// View permission: users with 'forecast' view can access AI insights
router.use(authorize('forecast', 'view'));

function aiRequest(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, AI_SERVICE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve(data);
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('AI service timeout')); });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

// =============================================================================
// GET /api/forecast/health
// Health check for AI service
// =============================================================================
router.get('/health', async (req, res) => {
    try {
        const data = await aiRequest('/health');
        res.json({ ai_status: 'connected', data });
    } catch (err) {
        res.status(503).json({ error: 'خدمة الذكاء الاصطناعي غير متاحة', detail: err.message });
    }
});

// =============================================================================
// POST /api/forecast/client/:clientId
// Forecast demand for a specific client
// =============================================================================
router.post('/client/:clientId', validateBody(forecastQuery), async (req, res) => {
    const { clientId } = req.params;
    const { periods = 30 } = req.validatedBody;

    try {
        const data = await aiRequest(`/forecast/client/${clientId}?periods=${periods}`, 'POST');
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'خطأ في التواصل مع خدمة التوقع', detail: err.message });
    }
});

// =============================================================================
// POST /api/forecast/variant/:variantId
// Forecast demand for a specific product variant
// =============================================================================
router.post('/variant/:variantId', validateBody(forecastQuery), async (req, res) => {
    const { variantId } = req.params;
    const { periods = 30 } = req.validatedBody;

    try {
        const data = await aiRequest(`/forecast/variant/${variantId}?periods=${periods}`, 'POST');
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'خطأ في التواصل مع خدمة التوقع', detail: err.message });
    }
});

// =============================================================================
// GET /api/forecast/insights/rfm
// RFM customer segmentation
// =============================================================================
router.get('/insights/rfm', async (req, res) => {
    try {
        const data = await aiRequest('/insights/rfm');
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'خطأ في تحليل العملاء', detail: err.message });
    }
});

// =============================================================================
// GET /api/forecast/insights/churn
// Churn alerts — inactive clients
// =============================================================================
router.get('/insights/churn', async (req, res) => {
    const days = parseInt(req.query.days) || 30;
    try {
        const data = await aiRequest(`/insights/churn?days=${days}`);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'خطأ في جلب التنبيهات', detail: err.message });
    }
});

module.exports = router;
