'use strict';

// =============================================================================
// G.PACK 2.0 — Messaging Provider Interface
// Single entry point for all outbound messaging in the ERP.
// The ERP never knows which provider (WAHA, Meta, Twilio, etc.) is in use.
//
// Current providers:
//   - WhatsApp (via WAHA) → whatsapp-service.js
//
// Future providers (add here, zero changes elsewhere in ERP):
//   - SMS (via Twilio/Vonage) → sms-service.js
//   - Email (via SendGrid/SES) → email-service.js
//   - Push (via FCM/APNS) → push-service.js
//
// Usage:
//   const MessagingProvider = require('./messaging-provider');
//   await MessagingProvider.sendText(recipient, body);
//   await MessagingProvider.sendImage(recipient, imagePath, caption);
//   await MessagingProvider.sendFile(recipient, filePath, caption);
// =============================================================================

const WhatsApp = require('./whatsapp-service');

// ── Channel Routing ─────────────────────────────────────────────────────────
// Routes a message to the appropriate provider based on channel type.
// Currently only 'whatsapp' is implemented. Adding 'sms' or 'email' is trivial.

async function sendText(channel, recipient, text) {
    switch (channel) {
        case 'whatsapp':
            return WhatsApp.sendText(recipient, text);
        // case 'sms':
        //     return SMS.sendText(recipient, text);
        // case 'email':
        //     return Email.sendText(recipient, text);
        default:
            throw new Error(`Messaging channel "${channel}" not implemented`);
    }
}

async function sendImage(channel, recipient, imagePath, caption) {
    switch (channel) {
        case 'whatsapp':
            return WhatsApp.sendImage(recipient, imagePath, caption);
        default:
            throw new Error(`Messaging channel "${channel}" does not support images`);
    }
}

async function sendFile(channel, recipient, filePath, caption) {
    switch (channel) {
        case 'whatsapp':
            return WhatsApp.sendFile(recipient, filePath, caption);
        default:
            throw new Error(`Messaging channel "${channel}" does not support files`);
    }
}

async function getSessionStatus(channel = 'whatsapp') {
    switch (channel) {
        case 'whatsapp':
            return WhatsApp.getSessionStatus();
        default:
            return { connected: false, error: `Channel "${channel}" not implemented` };
    }
}

function isConfigured(channel = 'whatsapp') {
    switch (channel) {
        case 'whatsapp':
            return WhatsApp.isConfigured();
        default:
            return false;
    }
}

function normalizePhone(phone) {
    return WhatsApp.normalizePhone(phone);
}

module.exports = {
    sendText,
    sendImage,
    sendFile,
    getSessionStatus,
    isConfigured,
    normalizePhone,
    // Direct re-exports for backward compatibility (during transition)
    WhatsApp,
};
