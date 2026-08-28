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
const WAHA_SESSION_INTERNAL = process.env.WAHA_SESSION_INTERNAL || WAHA_SESSION;
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

// ── Ensure chatId is in WAHA format ──────────────────────────────────────────
// If the input already looks like a WhatsApp ID (contains '@'), pass through
// as-is. Otherwise, normalize it as a phone number.
// This makes all send functions accept BOTH raw phones and pre-normalized IDs
// without double-normalizing or breaking group IDs (e.g. 120363xxx@g.us).
function _ensureChatId(chatId) {
    if (!chatId) return null;
    if (typeof chatId === 'string' && chatId.includes('@')) return chatId;
    return _normalizePhone(chatId);
}

// ── Send text message ───────────────────────────────────────────────────────
// options.session: WAHA session name (default: WAHA_SESSION)
async function sendText(chatId, text, options = {}) {
    if (PROVIDER === 'waha') {
        return _wahaSendText(chatId, text, options.session);
    }
    // Future: _metaSendText, _twilioSendText, etc.
    throw new Error(`WhatsApp provider "${PROVIDER}" not implemented`);
}

// ── Send image with optional caption ────────────────────────────────────────
// options.session: WAHA session name (default: WAHA_SESSION)
async function sendImage(chatId, imagePath, caption, options = {}) {
    if (PROVIDER === 'waha') {
        return _wahaSendImage(chatId, imagePath, caption, options.session);
    }
    throw new Error(`WhatsApp provider "${PROVIDER}" not implemented`);
}

// ── Send file (PDF, etc.) with optional caption ─────────────────────────────
// options.session: WAHA session name (default: WAHA_SESSION)
async function sendFile(chatId, filePath, caption, options = {}) {
    if (PROVIDER === 'waha') {
        return _wahaSendFile(chatId, filePath, caption, options.session);
    }
    throw new Error(`WhatsApp provider "${PROVIDER}" not implemented`);
}

// ── Get session status ──────────────────────────────────────────────────────
async function getSessionStatus(session = WAHA_SESSION) {
    if (PROVIDER === 'waha') {
        return _wahaGetSessionStatus(session);
    }
    throw new Error(`WhatsApp provider "${PROVIDER}" not implemented`);
}

// ── Get QR code for pairing ─────────────────────────────────────────────────
async function getQRCode(session = WAHA_SESSION) {
    if (PROVIDER === 'waha') {
        return _wahaGetQRCode(session);
    }
    throw new Error(`WhatsApp provider "${PROVIDER}" not implemented`);
}

// ── Start session ───────────────────────────────────────────────────────────
async function startSession(session = WAHA_SESSION) {
    if (PROVIDER === 'waha') {
        return _wahaStartSession(session);
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

async function _wahaSendText(chatId, text, session = WAHA_SESSION) {
    return _wahaRequest('/api/sendText', {
        method: 'POST',
        body: { session, chatId: _ensureChatId(chatId), text },
    });
}

async function _wahaSendImage(chatId, imagePath, caption, session = WAHA_SESSION) {
    const resolved = _resolvePath(imagePath);
    if (!fs.existsSync(resolved)) throw new Error(`Image not found: ${imagePath}`);
    const buffer = fs.readFileSync(resolved);
    const base64 = buffer.toString('base64');
    const ext = imagePath.split('.').pop().toLowerCase();
    const imageMimeMap = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
    };
    const mime = imageMimeMap[ext] || 'image/jpeg';

    return _wahaRequest('/api/sendImage', {
        method: 'POST',
        body: {
            session,
            chatId: _ensureChatId(chatId),
            file: { mimetype: mime, filename: resolved.split('/').pop(), data: base64 },
            caption: caption || '',
        },
    });
}

async function _wahaSendFile(chatId, filePath, caption, session = WAHA_SESSION) {
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
            session,
            chatId: _ensureChatId(chatId),
            file: { mimetype: mime, filename: resolved.split('/').pop(), data: base64 },
            caption: caption || '',
        },
    });
}

async function _wahaGetSessionStatus(session = WAHA_SESSION) {
    try {
        const result = await _wahaRequest(`/api/sessions/${session}`);
        return {
            provider: 'waha',
            session,
            status: result?.status || 'unknown',
            connected: result?.status === 'WORKING',
            url: WAHA_URL,
        };
    } catch (err) {
        return {
            provider: 'waha',
            session,
            status: 'error',
            connected: false,
            error: err.message,
            url: WAHA_URL,
        };
    }
}

async function _wahaGetQRCode(session = WAHA_SESSION) {
    try {
        const result = await _wahaRequest(`/api/sessions/${session}/qr`);
        return result;
    } catch (err) {
        return { error: err.message };
    }
}

async function _wahaStartSession(session = WAHA_SESSION) {
    try {
        const result = await _wahaRequest('/api/sessions', {
            method: 'POST',
            body: { name: session },
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
// options.session: WAHA session name (default: WAHA_SESSION)
async function sendButtons(chatId, text, buttons, options = {}) {
    if (!WAHA_URL) throw new Error('WAHA_URL not configured');
    const session = options.session || WAHA_SESSION;
    const normalizedId = _ensureChatId(chatId);

    // WAHA buttons format: [{ id, title }, ...]
    const wahaButtons = buttons.map((b, i) => ({
        id: b.id || `btn_${i}`,
        title: b.title || b.text || b,
    }));

    return _wahaRequest('/api/sendButtons', {
        method: 'POST',
        body: {
            session,
            chatId: normalizedId,
            text,
            buttons: wahaButtons,
        },
    });
}

// ── Send template message (for future use with Meta Cloud API) ──────────────
// options.session: WAHA session name (default: WAHA_SESSION)
async function sendTemplate(chatId, templateName, language, components, options = {}) {
    if (!WAHA_URL) throw new Error('WAHA_URL not configured');
    const session = options.session || WAHA_SESSION;
    const normalizedId = _ensureChatId(chatId);

    // WAHA template format (may vary by provider)
    return _wahaRequest('/api/sendTemplate', {
        method: 'POST',
        body: {
            session,
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
    ensureChatId: _ensureChatId,
    isConfigured: () => !!WAHA_URL,
    WAHA_SESSION,
    WAHA_SESSION_INTERNAL,
};
