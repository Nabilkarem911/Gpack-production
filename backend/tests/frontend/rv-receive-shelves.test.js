/**
 * @jest-environment jsdom
 *
 * receiving-vouchers.js — اعتماد الاستلام modal shelf allocation:
 * per-item [data-rv-shelf-row] allocations are collected from the subrow
 * rendered after each item row, sent inside the FormData `items` JSON to
 * /manufacturer-orders/:id/receive, and blocked when their sum exceeds the
 * received quantity.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'frontend', 'js', 'views', 'receiving-vouchers.js');

function mountDom() {
    document.body.innerHTML = `
        <select id="rv-receive-warehouse"><option value="">—</option><option value="w1" selected>Main</option></select>
        <input id="rv-receive-notes">
        <button id="rv-receive-save-btn"></button>
        <table><tbody id="rv-receive-items">
            <tr>
                <td><input type="number" data-mo-id="mo1" data-item-id="it1"
                           data-order-item-id="oi1" data-variant-id="v1"
                           data-rem-qty="10" value="10"></td>
                <td><input type="file" data-rv-photo></td>
                <td><input type="checkbox"></td>
                <td><input type="checkbox" data-rv-invoice></td>
            </tr>
            <tr data-shelf-subrow>
                <td><div data-shelf-allocs>
                    <div data-rv-shelf-row>
                        <select data-rv-alloc-shelf><option value="s1" selected>A1-01</option></select>
                        <input type="number" data-rv-alloc-qty value="4">
                        <select data-rv-alloc-occ><option value="25" selected>25%</option></select>
                    </div>
                    <div data-rv-shelf-row>
                        <select data-rv-alloc-shelf><option value="s2" selected>A1-02</option></select>
                        <input type="number" data-rv-alloc-qty value="3">
                        <select data-rv-alloc-occ><option value="" selected></option></select>
                    </div>
                </div>
                <button type="button">توزيع على رف</button></td>
            </tr>
        </tbody></table>
        <span id="rv-sum-full"></span><span id="rv-sum-partial"></span><span id="rv-sum-none"></span>
        <!-- elements touched by rvInit on load -->
        <div id="rv-mo-grid"></div><div id="rv-empty"></div><div id="rv-loading"></div>
        <span id="rv-stat-active"></span><span id="rv-stat-partial"></span><span id="rv-stat-items"></span>
        <span id="rv-tab-active-badge"></span>`;
}

function loadScript() {
    const src = fs.readFileSync(SRC, 'utf8');
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    (0, eval)(src);
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
}

describe('receiving-vouchers shelf allocations', () => {
    let sentBody;

    beforeAll(() => {
        mountDom();
        window.showToast = jest.fn();
        window.makeSelectSearchable = jest.fn((sel) => {
            sel.dataset.searchable = '1';
            return { refresh() {}, destroy() {}, input: null };
        });
        window.apiFetch = jest.fn(async (url) => {
            if (String(url).includes('/shelves')) return { data: { shelves: [] } };
            return { data: [] };
        });
        global.fetch = jest.fn(async (url, opts) => {
            sentBody = { url, form: opts.body };
            return { ok: true, json: async () => ({ data: {} }) };
        });
        loadScript();
    });

    test('shelf rows are sent inside FormData items JSON', async () => {
        await window.rvConfirmReceiving();
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(sentBody.url).toBe('/api/manufacturer-orders/mo1/receive');
        const items = JSON.parse(sentBody.form.get('items'));
        expect(items).toHaveLength(1);
        expect(items[0].quantity).toBe(10);
        expect(items[0].shelves).toEqual([
            { shelf_id: 's1', quantity: 4, occupancy_pct: 25 },
            { shelf_id: 's2', quantity: 3 },
        ]);
        // internal helper fields never reach the wire
        expect(items[0]._files).toBeUndefined();
        expect(items[0]._idx).toBeUndefined();
    });

    test('shelf subrow stays excluded even if its inputs gain item-identity attrs', async () => {
        // simulate a future markup change that tags the alloc qty input with the
        // item's identifiers — the data-shelf-subrow guard, not missing attrs,
        // must keep the subrow out of the payload (the route does not dedupe).
        document.querySelectorAll('[data-rv-alloc-qty]').forEach(i => {
            i.setAttribute('data-item-id', 'it1');
            i.setAttribute('data-mo-id', 'mo1');
            i.setAttribute('data-variant-id', 'v1');
        });
        global.fetch.mockClear();
        await window.rvConfirmReceiving();
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const items = JSON.parse(sentBody.form.get('items'));
        expect(items).toHaveLength(1);
        expect(items[0].quantity).toBe(10);
        expect(items[0].shelves).toHaveLength(2);   // real item still carries its allocs
        document.querySelectorAll('[data-rv-alloc-qty]').forEach(i => {
            i.removeAttribute('data-item-id');
            i.removeAttribute('data-mo-id');
            i.removeAttribute('data-variant-id');
        });
    });

    test('alloc sum above received qty blocks submit and reports error', async () => {
        document.querySelector('[data-rv-alloc-qty]').value = '99';
        global.fetch.mockClear();
        await window.rvConfirmReceiving();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(window.showToast).toHaveBeenCalledWith(
            expect.stringContaining('توزيع الرفوف'), 'error');
    });

    test('item without shelf rows sends no shelves key', async () => {
        // strip the two alloc rows from the subrow
        document.querySelectorAll('[data-rv-shelf-row]').forEach(r => r.remove());
        global.fetch.mockClear();
        await window.rvConfirmReceiving();
        const items = JSON.parse(sentBody.form.get('items'));
        expect(items[0].shelves).toBeUndefined();
    });

    test('rvAddShelfAllocRow/rvRemoveShelfAllocRow manage rows in the subrow', () => {
        const btn = document.querySelector('[data-shelf-subrow] button');
        expect(document.querySelectorAll('[data-rv-shelf-row]')).toHaveLength(0);
        window.rvAddShelfAllocRow(btn);
        window.rvAddShelfAllocRow(btn);
        expect(document.querySelectorAll('[data-rv-shelf-row]')).toHaveLength(2);
        window.rvRemoveShelfAllocRow(document.querySelector('[data-rv-shelf-row] button'));
        expect(document.querySelectorAll('[data-rv-shelf-row]')).toHaveLength(1);
    });

    test('new alloc row auto-fills the remaining qty and gets a searchable shelf select', () => {
        document.querySelectorAll('[data-rv-shelf-row]').forEach(r => r.remove());
        const btn = document.querySelector('[data-shelf-subrow] button');
        // item row qty = 10; no existing allocs → remaining should be 10
        window.makeSelectSearchable.mockClear();
        window.rvAddShelfAllocRow(btn);
        const row = document.querySelector('[data-rv-shelf-row]');
        expect(row.querySelector('[data-rv-alloc-qty]').value).toBe('10');
        expect(window.makeSelectSearchable).toHaveBeenCalledWith(
            row.querySelector('[data-rv-alloc-shelf]'),
            expect.objectContaining({ wrapClass: 'flex-1 min-w-0' }));

        // a second row sees qty already used → remaining 0 → left empty
        row.querySelector('[data-rv-alloc-qty]').value = '6';
        window.rvAddShelfAllocRow(btn);
        const rows = document.querySelectorAll('[data-rv-shelf-row]');
        expect(rows[1].querySelector('[data-rv-alloc-qty]').value).toBe('4');
        document.querySelectorAll('[data-rv-shelf-row]').forEach(r => r.remove());
    });

    test('warehouse change refreshes shelf selects in ALL modals, not just #rv-receive-items', async () => {
        window.apiFetch = jest.fn(async (url) => {
            if (String(url).includes('/manufacturer-orders?')) return { data: [{
                id: 'mo1', order_id: 'o1', order_number: 'PO-1', client_name: 'عميل',
                status: 'ordered',
                items: [{ id: 'it1', order_item_id: 'oi1', product_name: 'كوب',
                          mo_quantity: 10, received_qty: 0, variant_id: 'v1' }],
            }] };
            if (String(url).includes('/inventory/warehouses')) return { data: [
                { id: 'w1', name: 'Main', is_main: true }, { id: 'w2', name: 'Second' },
            ] };
            if (String(url).includes('/shelves')) {
                const wid = String(url).split('warehouse_id=')[1];
                return { data: { shelves: wid === 'w2'
                    ? [{ id: 'n1', code: 'B1-01' }] : [{ id: 's1', code: 'A1-01' }] } };
            }
            return { data: [] };
        });
        window.openModal = jest.fn();
        document.body.insertAdjacentHTML('beforeend', '<span id="rv-receive-subtitle"></span>');
        await window.rvInit();
        window.rvOpenReceiveModal('o1');
        await new Promise(r => setTimeout(r, 20));

        // main warehouse is preselected → its shelves load without a manual pick
        const whSelAuto = document.getElementById('rv-receive-warehouse');
        expect(whSelAuto.value).toBe('w1');
        expect(window.apiFetch.mock.calls.some(([u]) =>
            String(u).includes('/shelves') && String(u).includes('warehouse_id=w1'))).toBe(true);

        // a shelf select living in ANOTHER modal (e.g. the manual voucher modal)
        const other = document.createElement('div');
        other.innerHTML =
            '<select data-rv-alloc-shelf><option value="s1" selected>A1-01</option></select>';
        document.body.appendChild(other);

        const whSel = document.getElementById('rv-receive-warehouse');
        whSel.value = 'w2';
        await whSel.onchange();
        await new Promise(r => setTimeout(r, 20));

        const sel = other.querySelector('[data-rv-alloc-shelf]');
        expect(sel.querySelector('option[value="n1"]')).toBeTruthy();
        expect(sel.value).toBe('');          // stale warehouse value cleared
    });
});
