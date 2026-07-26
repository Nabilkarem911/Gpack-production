'use strict';

// =============================================================================
// G.PACK 2.0 — WhatsApp Service
// Single entry point for all WhatsApp operations in the ERP.
// WAHA is the current provider. To switch to Meta Cloud API, Twilio, Green API,
// or Evolution API — only this file changes. Zero changes in the rest of the ERP.
// =============================================================================

const fs = require('fs');

// ── Provider Configuration ──────────────────────────────────────────────────
const PROVIDER = process.env.WHATSAPP_PROVIDER || 'waha';
const WAHA_URL = process.env.WAHA_URL || '';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';

// ── Normalize phone number to WAHA chatId format ────────────────────────────
// Accepts: "0551234567", "+966551234567", "966551234567"
// Returns: "966551234567@c.us" (WAHA format)
function _normalizePhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/[^0-9]/g, '');

    // Saudi numbers: 05xxxxxxxx → 9665xxxxxxxx
    if (cleaned.startsWith('0')) {
        cleaned = '966' + cleaned.slice(1);
    }
    // If starts with 966, keep as is
    // If no country code, assume Saudi
    if (!cleaned.startsWith('966') && cleaned.length === 9) {
        cleaned = '966' + cleaned;
    }

    return `${cleaned}@c.us`;
}

// ── Send text message ───────────────────────────────────────────────────────
async function sendText(chatId, text) {
    if (PROVIDER === 'waha') {
        return _wahaSendText(chatId, text);
    }
    // Future: _metaSendText, _twilioSendText, etc.
    throw new Error(`WhatsApp provider "${PROVIDER}" not implemented`);
}

// ── Send image with optional caption ────────────────────────────────────────
async function sendImage(chatId, imagePath, caption) {
    if (PROVIDER === 'waha') {
        return _wahaSendImage(chatId, imagePath, caption);
    }
    throw new Error(`WhatsApp provider "${PROVIDER}" not implemented`);
}

// ── Send file (PDF, etc.) with optional caption ─────────────────────────────
async function sendFile(chatId, filePath, caption) {
    if (PROVIDER === 'waha') {
        return _wahaSendFile(chatId, filePath, caption);
    }
    throw new Error(`WhatsApp provider "${PROVIDER}" not implemented`);
}

// ── Get session status ──────────────────────────────────────────────────────
async function getSessionStatus() {
    if (PROVIDER === 'waha') {
        return _wahaGetSessionStatus();
    }
    throw new Error(`WhatsApp provider "${PROVIDER}" not implemented`);
}

// ── Get QR code for pairing ─────────────────────────────────────────────────
async function getQRCode() {
    if (PROVIDER === 'waha') {
        return _wahaGetQRCode();
    }
    throw new Error(`WhatsApp provider "${PROVIDER}" not implemented`);
}

// ── Start session ───────────────────────────────────────────────────────────
async function startSession() {
    if (PROVIDER === 'waha') {
        return _wahaStartSession();
    }
    throw new Error(`WhatsApp provider "${PROVIDER}" not implemented`);
}

// =============================================================================
// WAHA Provider Implementation
// =============================================================================

async function _wahaRequest(endpoint, options = {}) {
    if (!WAHA_URL) throw new Error('WAHA_URL not configured');

    const url = `${WAHA_URL}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (WAHA_API_KEY) {
        headers['X-Api-Key'] = WAHA_API_KEY;
    }
    const res = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`WAHA ${res.status}: ${errText || res.statusText}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return res.json();
    }
    return res.text();
}

async function _wahaSendText(chatId, text) {
    return _wahaRequest('/api/sendText', {
        method: 'POST',
        body: { session: WAHA_SESSION, chatId, text },
    });
}

async function _wahaSendImage(chatId, imagePath, caption) {
    const resolved = _resolvePath(imagePath);
    if (!fs.existsSync(resolved)) throw new Error(`Image not found: ${imagePath}`);
    const buffer = fs.readFileSync(resolved);
    const base64 = buffer.toString('base64');
    const ext = imagePath.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';

    return _wahaRequest('/api/sendImage', {
        method: 'POST',
        body: {
            session: WAHA_SESSION,
            chatId,
            file: { mimetype: mime, filename: resolved.split('/').pop(), data: base64 },
            caption: caption || '',
        },
    });
}

async function _wahaSendFile(chatId, filePath, caption) {
    const resolved = _resolvePath(filePath);
    if (!fs.existsSync(resolved)) throw new Error(`File not found: ${filePath}`);
    const buffer = fs.readFileSync(resolved);
    const base64 = buffer.toString('base64');
    const ext = filePath.split('.').pop().toLowerCase();
    const mimeMap = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    const mime = mimeMap[ext] || 'application/octet-stream';

    return _wahaRequest('/api/sendFile', {
        method: 'POST',
        body: {
            session: WAHA_SESSION,
            chatId,
            file: { mimetype: mime, filename: resolved.split('/').pop(), data: base64 },
            caption: caption || '',
        },
    });
}

async function _wahaGetSessionStatus() {
    try {
        const result = await _wahaRequest(`/api/sessions/${WAHA_SESSION}`);
        return {
            provider: 'waha',
            session: WAHA_SESSION,
            status: result?.status || 'unknown',
            connected: result?.status === 'WORKING' || result?.status === 'qr',
            url: WAHA_URL,
        };
    } catch (err) {
        return {
            provider: 'waha',
            session: WAHA_SESSION,
            status: 'error',
            connected: false,
            error: err.message,
            url: WAHA_URL,
        };
    }
}

async function _wahaGetQRCode() {
    try {
        const result = await _wahaRequest(`/api/sessions/${WAHA_SESSION}/qr`);
        return result;
    } catch (err) {
        return { error: err.message };
    }
}

async function _wahaStartSession() {
    try {
        const result = await _wahaRequest('/api/sessions', {
            method: 'POST',
            body: { name: WAHA_SESSION },
        });
        return result;
    } catch (err) {
        return { error: err.message };
    }
}

// ── Resolve file path for container environment ─────────────────────────────
// DB stores paths like /uploads/designs/... but inside Docker the app runs
// from /app, so files are at /app/uploads/designs/...
function _resolvePath(filePath) {
    if (!filePath) return filePath;
    // Already absolute and exists → use as-is
    if (fs.existsSync(filePath)) return filePath;
    // Try prepending /app (Docker working directory)
    if (filePath.startsWith('/uploads/')) {
        const containerPath = '/app' + filePath;
        if (fs.existsSync(containerPath)) return containerPath;
    }
    // Try relative to __dirname (local dev)
    const relPath = require('path').join(__dirname, '..', filePath);
    if (fs.existsSync(relPath)) return relPath;
    // Return original (will fail with clear error)
    return filePath;
}

// ── Send interactive buttons message ────────────────────────────────────────
async function sendButtons(chatId, text, buttons) {
    if (!WAHA_URL) throw new Error('WAHA_URL not configured');
    const normalizedId = _normalizePhone(chatId);

    // WAHA buttons format: [{ id, title }, ...]
    const wahaButtons = buttons.map((b, i) => ({
        id: b.id || `btn_${i}`,
        title: b.title || b.text || b,
    }));

    return _wahaRequest('/api/sendButtons', {
        method: 'POST',
        body: {
            session: WAHA_SESSION,
            chatId: normalizedId,
            text,
            buttons: wahaButtons,
        },
    });
}

// ── Send template message (for future use with Meta Cloud API) ──────────────
async function sendTemplate(chatId, templateName, language, components) {
    if (!WAHA_URL) throw new Error('WAHA_URL not configured');
    const normalizedId = _normalizePhone(chatId);

    // WAHA template format (may vary by provider)
    return _wahaRequest('/api/sendTemplate', {
        method: 'POST',
        body: {
            session: WAHA_SESSION,
            chatId: normalizedId,
            template: {
                name: templateName,
                language: { code: language || 'ar' },
                components: components || [],
            },
        },
    });
}

module.exports = {
    sendText,
    sendImage,
    sendFile,
    sendButtons,
    sendTemplate,
    getSessionStatus,
    getQRCode,
    startSession,
    normalizePhone: _normalizePhone,
    isConfigured: () => !!WAHA_URL,
};
