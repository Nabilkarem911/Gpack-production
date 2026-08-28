// =============================================================================
// Tests: Internal WhatsApp notifications (multi-session + new notification fns)
// =============================================================================

process.env.WAHA_URL = 'http://waha-test:3000';
process.env.WAHA_SESSION = 'default';
process.env.WAHA_SESSION_INTERNAL = 'internal';
process.env.WAHA_API_KEY = 'test-key';

const NotificationService = require('../../services/notification-service');
const WhatsApp = require('../../services/whatsapp-service');

// Mock db
jest.mock('../../db', () => {
    const _settings = {
        internal_whatsapp_enabled: 'false',
        manager_whatsapp_phone: 'null',
        warehouse_keeper_whatsapp_phone: 'null',
    };

    return {
        query: jest.fn(async (sql, params) => {
            if (sql.includes('SELECT value FROM notification_settings WHERE key = $1')) {
                const val = _settings[params[0]] ?? null;
                return { rows: val !== null ? [{ value: val }] : [] };
            }
            if (sql.includes('INSERT INTO notification_queue')) {
                return { rows: [{ id: 'test-queue-id' }] };
            }
            if (sql.includes('INSERT INTO notifications')) {
                return { rows: [{ id: 'test-notif-id' }] };
            }
            if (sql.includes('INSERT INTO notification_outbox')) {
                return { rows: [] };
            }
            return { rows: [] };
        }),
    };
});

// Mock fetch for WAHA calls
global.fetch = jest.fn(async (url, opts) => {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'application/json' },
        json: async () => ({ id: 'msg_123' }),
        text: async () => '',
    };
});

beforeEach(() => {
    fetch.mockClear();
});

describe('Multi-session: whatsapp-service sends to correct session', () => {
    test('sendText default session uses WAHA_SESSION', async () => {
        await WhatsApp.sendText('0551234567', 'hello');
        const [_url, opts] = fetch.mock.calls[0];
        const body = JSON.parse(opts.body);
        expect(body.session).toBe('default');
        expect(body.chatId).toBe('966551234567@c.us');
    });

    test('sendText with options.session = "internal" uses WAHA_SESSION_INTERNAL', async () => {
        await WhatsApp.sendText('0551234567', 'hello', { session: 'internal' });
        const [_url, opts] = fetch.mock.calls[0];
        const body = JSON.parse(opts.body);
        expect(body.session).toBe('internal');
        expect(body.chatId).toBe('966551234567@c.us');
    });

    test('getSessionStatus default uses WAHA_SESSION', async () => {
        await WhatsApp.getSessionStatus();
        expect(fetch.mock.calls[0][0]).toMatch(/\/api\/sessions\/default$/);
    });

    test('getSessionStatus with explicit session uses it', async () => {
        await WhatsApp.getSessionStatus('custom-session');
        expect(fetch.mock.calls[0][0]).toMatch(/\/api\/sessions\/custom-session$/);
    });
});

describe('Internal notification functions are feature-flagged', () => {
    test('notifyQuotationNeedsPricing returns null when disabled', async () => {
        const result = await NotificationService.notifyQuotationNeedsPricing({
            order_id: 'order-1',
            order_number: 123,
            client_name: 'Test Client',
            unpriced_count: 2,
        });
        expect(result).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });

    test('notifyDirectReceiptCreated returns null when disabled', async () => {
        const result = await NotificationService.notifyDirectReceiptCreated({
            receipt_id: 'receipt-1',
            receipt_number: 456,
            item_count: 3,
            received_by_name: 'Warehouse Keeper',
        });
        expect(result).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });

    test('notifyReleaseOrderCreated returns null when disabled', async () => {
        const result = await NotificationService.notifyReleaseOrderCreated({
            order_id: 'order-1',
            order_number: 789,
            client_name: 'Test Client',
            items_summary: '• Product A',
        });
        expect(result).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });
});
