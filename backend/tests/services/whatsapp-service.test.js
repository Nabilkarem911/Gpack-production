// =============================================================================
// Tests: services/whatsapp-service.js
// Covers the 5 fixes:
//   #1 — 'qr' status must NOT be treated as connected
//   #4 — Image MIME map supports png, jpeg, gif, webp, bmp
//   #5 — Phone normalization unified via _ensureChatId across all send fns
// =============================================================================

// ── Stub environment before requiring the module ─────────────────────────────
process.env.WAHA_URL = 'http://waha-test:3000';
process.env.WAHA_SESSION = 'test-session';
process.env.WAHA_API_KEY = 'test-key';

const fs = require('fs');
const path = require('path');
const WhatsApp = require('../../services/whatsapp-service');

// ── Mock fetch globally ──────────────────────────────────────────────────────
let _lastFetchCall = null;
global.fetch = jest.fn(async (url, opts) => {
    _lastFetchCall = { url, opts };
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'application/json' },
        json: async () => ({ id: 'msg_123', status: 'sent' }),
        text: async () => '',
    };
});

function _lastBody() {
    if (!_lastFetchCall || !_lastFetchCall.opts || !_lastFetchCall.opts.body) return null;
    return JSON.parse(_lastFetchCall.opts.body);
}

function _lastUrl() {
    return _lastFetchCall ? _lastFetchCall.url : null;
}

beforeEach(() => {
    fetch.mockClear();
    _lastFetchCall = null;
});

// =============================================================================
// Fix #1 — Session status: 'qr' is NOT connected
// =============================================================================
describe('Fix #1 — getSessionStatus: qr is not connected', () => {
    test('WORKING status → connected: true', async () => {
        fetch.mockImplementationOnce(async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: () => 'application/json' },
            json: async () => ({ status: 'WORKING' }),
            text: async () => '',
        }));
        const result = await WhatsApp.getSessionStatus();
        expect(result.status).toBe('WORKING');
        expect(result.connected).toBe(true);
    });

    test('qr status → connected: false (was true before fix)', async () => {
        fetch.mockImplementationOnce(async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: () => 'application/json' },
            json: async () => ({ status: 'qr' }),
            text: async () => '',
        }));
        const result = await WhatsApp.getSessionStatus();
        expect(result.status).toBe('qr');
        expect(result.connected).toBe(false);
    });

    test('unknown status → connected: false', async () => {
        fetch.mockImplementationOnce(async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: () => 'application/json' },
            json: async () => ({ status: 'something_else' }),
            text: async () => '',
        }));
        const result = await WhatsApp.getSessionStatus();
        expect(result.connected).toBe(false);
    });
});

// =============================================================================
// Fix #5 — _ensureChatId / normalizePhone unification
// =============================================================================
describe('Fix #5 — ensureChatId unification', () => {
    test('raw Saudi phone 05xxxxxxxx → 9665xxxxxxxx@c.us', () => {
        expect(WhatsApp.ensureChatId('0551234567')).toBe('966551234567@c.us');
    });

    test('phone with + → strips non-digits and normalizes', () => {
        expect(WhatsApp.ensureChatId('+966551234567')).toBe('966551234567@c.us');
    });

    test('already-normalized chatId passes through (contains @)', () => {
        expect(WhatsApp.ensureChatId('966551234567@c.us')).toBe('966551234567@c.us');
    });

    test('group ID (g.us) passes through unchanged', () => {
        expect(WhatsApp.ensureChatId('120363123456789@g.us')).toBe('120363123456789@g.us');
    });

    test('null → null', () => {
        expect(WhatsApp.ensureChatId(null)).toBeNull();
    });

    test('empty string → null', () => {
        expect(WhatsApp.ensureChatId('')).toBeNull();
    });

    test('normalizePhone still works (backward compat)', () => {
        expect(WhatsApp.normalizePhone('0551234567')).toBe('966551234567@c.us');
    });
});

// =============================================================================
// Fix #5 — sendText uses _ensureChatId
// =============================================================================
describe('Fix #5 — sendText normalizes chatId', () => {
    test('raw phone gets normalized', async () => {
        await WhatsApp.sendText('0551234567', 'hello');
        const body = _lastBody();
        expect(body.chatId).toBe('966551234567@c.us');
        expect(body.text).toBe('hello');
    });

    test('pre-normalized chatId passes through', async () => {
        await WhatsApp.sendText('966551234567@c.us', 'hello');
        const body = _lastBody();
        expect(body.chatId).toBe('966551234567@c.us');
    });
});

// =============================================================================
// Fix #4 — Image MIME map supports multiple formats
// =============================================================================
describe('Fix #4 — sendImage MIME types', () => {
    // Create temp image files for each extension
    const tmpDir = path.join(__dirname, '_tmp_images');
    beforeAll(() => {
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']) {
            fs.writeFileSync(path.join(tmpDir, `test.${ext}`), Buffer.from('fake-image-data'));
        }
    });
    afterAll(() => {
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const expectedMimes = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
    };

    for (const [ext, expectedMime] of Object.entries(expectedMimes)) {
        test(`.${ext} → ${expectedMime}`, async () => {
            await WhatsApp.sendImage('966551234567@c.us', path.join(tmpDir, `test.${ext}`), 'cap');
            const body = _lastBody();
            expect(body.file.mimetype).toBe(expectedMime);
        });
    }

    test('unknown extension defaults to image/jpeg', async () => {
        fs.writeFileSync(path.join(tmpDir, 'test.xyz'), Buffer.from('fake'));
        await WhatsApp.sendImage('966551234567@c.us', path.join(tmpDir, 'test.xyz'), 'cap');
        const body = _lastBody();
        expect(body.file.mimetype).toBe('image/jpeg');
    });
});

// =============================================================================
// Fix #5 — sendFile and sendButtons also use _ensureChatId
// =============================================================================
describe('Fix #5 — sendFile normalizes chatId', () => {
    const tmpDir = path.join(__dirname, '_tmp_files');
    beforeAll(() => {
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'doc.pdf'), Buffer.from('fake-pdf'));
    });
    afterAll(() => {
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('raw phone gets normalized in sendFile', async () => {
        await WhatsApp.sendFile('0551234567', path.join(tmpDir, 'doc.pdf'), 'cap');
        const body = _lastBody();
        expect(body.chatId).toBe('966551234567@c.us');
    });
});

describe('Fix #5 — sendButtons normalizes chatId', () => {
    test('raw phone gets normalized in sendButtons', async () => {
        await WhatsApp.sendButtons('0551234567', 'Choose', [{ id: 'b1', title: 'Yes' }]);
        const body = _lastBody();
        expect(body.chatId).toBe('966551234567@c.us');
    });

    test('pre-normalized chatId passes through in sendButtons', async () => {
        await WhatsApp.sendButtons('966551234567@c.us', 'Choose', [{ id: 'b1', title: 'Yes' }]);
        const body = _lastBody();
        expect(body.chatId).toBe('966551234567@c.us');
    });
});

describe('Fix #5 — sendTemplate normalizes chatId', () => {
    test('raw phone gets normalized in sendTemplate', async () => {
        await WhatsApp.sendTemplate('0551234567', 'tpl_name', 'ar', []);
        const body = _lastBody();
        expect(body.chatId).toBe('966551234567@c.us');
    });
});
