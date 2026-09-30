/**
 * @jest-environment jsdom
 *
 * _closeWithoutInvoice confirm-warning logic in production_orders_new.js.
 * Covers: remaining qty (wh_received_qty - delivered_qty), VMI stock warning
 * filtered by variant_id, branch→parent stock merge (no duplicated rows —
 * each warehouse_stock row has a single client_id, so the two queries are
 * disjoint), PATCH /closure payload, and the confirm-decline path.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'frontend', 'js', 'views', 'production_orders_new.js');

function mountDom() {
    document.body.innerHTML = `
        <input id="po-search">
        <table><tbody id="po-tbody"></tbody></table>
        <div id="po-empty" class="hidden"></div>
    `;
}

const ORDER = {
    id: 'o1', order_number: 42, client_id: 'c-branch',
    items: [
        { id: 'i1', variant_id: 'v1', product_name: 'ستيكر', size_name: '3*18',
          quantity: 100, wh_received_qty: 100, delivered_qty: 30 },
        { id: 'i2', variant_id: 'v2', product_name: 'علبة', size_name: 'كبير',
          quantity: 50, wh_received_qty: 50, delivered_qty: 50 },
    ],
};

function buildApiFetch(stockByClient) {
    return jest.fn(async (url) => {
        if (url === '/api/orders/o1') return { data: ORDER };
        const m = url.match(/^\/api\/vmi\/stock\?client_id=(.+)$/);
        if (m) return stockByClient[m[1]] || { client: { id: m[1], parent_id: null }, data: [] };
        return { data: [] }; // _loadOrders etc.
    });
}

describe('Production orders — close without invoice warning', () => {
    let apiFetch;

    beforeAll(async () => {
        mountDom();
        window.confirm  = jest.fn(() => true);
        window.showToast = jest.fn();
        window.apiFetch = jest.fn(async () => ({ data: [] }));
        eval(fs.readFileSync(SRC, 'utf8'));
        await new Promise(r => setTimeout(r, 50)); // let _init() settle
        apiFetch = buildApiFetch({});
        window.apiFetch = apiFetch;
    });

    beforeEach(() => {
        apiFetch.mockClear();
        window.confirm.mockClear().mockReturnValue(true);
        window.showToast.mockClear();
    });

    test('merges branch + parent stock into one aggregated line per variant', async () => {
        apiFetch = buildApiFetch({
            'c-branch': { client: { id: 'c-branch', parent_id: 'c-parent' },
                          data: [
                              { stock_id: 's1', variant_id: 'v1', product_name: 'ستيكر', size_name: '3*18', quantity: 40 },
                              { stock_id: 'sX', variant_id: 'vX', product_name: 'غير مرتبط', size_name: '', quantity: 99 },
                          ] },
            'c-parent': { client: { id: 'c-parent', parent_id: null },
                          data: [
                              { stock_id: 's2', variant_id: 'v1', product_name: 'ستيكر', size_name: '3*18', quantity: 60 },
                          ] },
        });
        window.apiFetch = apiFetch;

        await window.poView.closeWithoutInvoice('o1');

        // Both stock endpoints hit, in order, with the right client ids
        const stockCalls = apiFetch.mock.calls.map(c => c[0]).filter(u => u.startsWith('/api/vmi/stock'));
        expect(stockCalls).toEqual(['/api/vmi/stock?client_id=c-branch', '/api/vmi/stock?client_id=c-parent']);

        const msg = window.confirm.mock.calls[0][0];
        // Remaining across delivery notes: 100 - 30 = 70 (the 50-50 item is absent)
        expect(msg).toContain('70');
        expect(msg).not.toContain('علبة');
        // Branch (40) + parent (60) stock aggregated into one line: 100 —
        // not two identically-labelled rows
        expect(msg).toContain(': 100');
        expect(msg).not.toContain(': 40');
        expect(msg).not.toContain(': 60');
        expect(msg).not.toContain('99');           // variant vX not in the order
        expect((msg.match(/•/g) || []).length).toBe(2);

        const patch = apiFetch.mock.calls.find(c => c[0] === '/api/orders/o1/closure');
        expect(patch).toBeTruthy();
        expect(patch[1]).toEqual({ method: 'PATCH', body: { closed: true } });
    });

    test('no parent_id → single stock fetch, no merge', async () => {
        apiFetch = buildApiFetch({
            'c-branch': { client: { id: 'c-branch', parent_id: null },
                          data: [{ stock_id: 's1', variant_id: 'v1', product_name: 'ستيكر', size_name: '3*18', quantity: 10 }] },
        });
        window.apiFetch = apiFetch;

        await window.poView.closeWithoutInvoice('o1');

        const stockCalls = apiFetch.mock.calls.map(c => c[0]).filter(u => u.startsWith('/api/vmi/stock'));
        expect(stockCalls).toEqual(['/api/vmi/stock?client_id=c-branch']);
        expect(window.confirm.mock.calls[0][0]).toContain(': 10');
    });

    test('parent stock fetch failure still closes on branch data alone', async () => {
        apiFetch = jest.fn(async (url) => {
            if (url === '/api/orders/o1') return { data: ORDER };
            if (url === '/api/vmi/stock?client_id=c-branch')
                return { client: { id: 'c-branch', parent_id: 'c-parent' },
                         data: [{ stock_id: 's1', variant_id: 'v1', product_name: 'ستيكر', size_name: '3*18', quantity: 40 }] };
            if (url === '/api/vmi/stock?client_id=c-parent') throw new Error('forbidden');
            return { data: [] };
        });
        window.apiFetch = apiFetch;

        await window.poView.closeWithoutInvoice('o1');

        const msg = window.confirm.mock.calls[0][0];
        expect(msg).toContain(': 40');
        expect(apiFetch.mock.calls.some(c => c[0] === '/api/orders/o1/closure')).toBe(true);
    });

    test('vmi/stock without permission → warning still shows remaining qty', async () => {
        apiFetch = jest.fn(async (url) => {
            if (url === '/api/orders/o1') return { data: ORDER };
            if (url.startsWith('/api/vmi/stock')) { const e = new Error('403'); throw e; }
            return { data: [] };
        });
        window.apiFetch = apiFetch;

        await window.poView.closeWithoutInvoice('o1');

        const msg = window.confirm.mock.calls[0][0];
        expect(msg).toContain('70');               // remaining still surfaced
        expect(msg).not.toContain('رصيد العميل');  // stock section skipped
        expect(apiFetch.mock.calls.some(c => c[0] === '/api/orders/o1/closure')).toBe(true);
    });

    test('declining the confirm aborts — no PATCH sent', async () => {
        window.confirm.mockReturnValue(false);
        apiFetch = buildApiFetch({});
        window.apiFetch = apiFetch;

        await window.poView.closeWithoutInvoice('o1');

        expect(window.confirm).toHaveBeenCalled();
        expect(apiFetch.mock.calls.some(c => c[0] === '/api/orders/o1/closure')).toBe(false);
    });
});
