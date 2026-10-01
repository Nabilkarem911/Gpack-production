/**
 * @jest-environment jsdom
 *
 * direct-receipts.js — review modal shelf allocations:
 * allocations are rendered per item (prefilled from stored shelf_allocations),
 * collected into the review payload, validated against confirmed_quantity,
 * and sent to PUT /api/direct-receipts/:id/review.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'frontend', 'js', 'views', 'direct-receipts.js');

const IDS = [
    'dr-list-container', 'dr-empty', 'dr-search', 'dr-has-invoice', 'dr-notes',
    'dr-items-tbody', 'dr-save-btn', 'dr-tab-archive', 'dr-tab-pending',
    'dr-tab-pending-badge', 'dr-detail-content', 'dr-detail-number',
    'dr-convert-btn', 'dr-review-number', 'dr-review-info',
    'dr-review-invoice-ref', 'dr-save-review-btn',
    'dr-qp-category', 'dr-qp-category-inline', 'dr-qp-category-name', 'dr-qp-error',
    'dr-qp-name', 'dr-qp-size', 'dr-qp-submit-btn', 'dr-qp-unit', 'dr-qp-unit-abbr',
    'dr-qp-unit-inline', 'dr-qp-unit-name', 'dr-qu-abbr', 'dr-qu-name', 'dr-qu-submit-btn',
];

function mountDom() {
    document.body.innerHTML =
        IDS.map(id => `<div id="${id}"></div>`).join('') +
        `<select id="dr-review-supplier"></select>
         <select id="dr-review-warehouse"></select>
         <table><tbody id="dr-review-items-tbody"></tbody></table>`;
}

function loadScript() {
    const src = fs.readFileSync(SRC, 'utf8');
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    (0, eval)(src);
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
}

const RECEIPT = {
    id: 'r1', receipt_number: 7, status: 'pending_review',
    received_at: '2026-10-01T00:00:00Z', warehouse_id: 'w1', supplier_id: 'sup1',
    items: [{
        id: 'it1', product_name: 'كوب QA', unit_name: 'كرتون', quantity: 10,
        variant_id: 'v1', unit_id: 'u1', confirmed_quantity: 10, unit_cost: 5,
        client_id: 'c1', client_name: 'عميل',
        matched_product_name: 'كوب QA', size_name: '12oz',
        shelf_allocations: [{ shelf_id: 's1', quantity: 6, occupancy_pct: 25 }],
    }],
};

// Two items: one linked, one never linked — discriminates F3 (partial payloads
// must never ship; old per-row `return` would still send the valid item alone).
const RECEIPT2 = {
    id: 'r2', receipt_number: 8, status: 'pending_review',
    received_at: '2026-10-01T00:00:00Z', warehouse_id: 'w1', supplier_id: 'sup1',
    items: [
        { id: 'itA', product_name: 'صنف مربوط', unit_name: 'كرتون', quantity: 5,
          variant_id: 'v1', unit_id: 'u1', confirmed_quantity: 5, unit_cost: 5,
          client_id: 'c1', client_name: 'عميل', matched_product_name: 'صنف مربوط',
          size_name: '12oz', shelf_allocations: [] },
        { id: 'itB', product_name: 'صنف غير مربوط', unit_name: 'كرتون', quantity: 3,
          variant_id: null, unit_id: 'u1', confirmed_quantity: 3, unit_cost: 5,
          client_id: null, client_name: null, matched_product_name: null,
          size_name: null, shelf_allocations: [] },
    ],
};

describe('direct-receipts review shelf allocations', () => {
    let savedBody;

    beforeAll(async () => {
        mountDom();
        window.showToast = jest.fn();
        window.makeSelectSearchable = jest.fn((sel) => {
            sel.dataset.searchable = '1';
            return { refresh() {}, destroy() {}, input: null };
        });
        window.apiFetch = jest.fn(async (url, opts) => {
            if (String(url).includes('/shelves')) {
                const wid = String(url).split('warehouse_id=')[1];
                const shelves = wid === 'w2'
                    ? [{ id: 's3', code: 'B1-01' }]
                    : [{ id: 's1', code: 'A1-01' }, { id: 's2', code: 'A1-02' }];
                return { data: { shelves } };
            }
            if (String(url).match(/direct-receipts\/[^/]+$/) && !opts) {
                const rid = String(url).split('/').pop();
                return { data: rid === 'r2' ? RECEIPT2 : RECEIPT };
            }
            if (String(url).includes('/review')) { savedBody = opts.body; return { data: {} }; }
            if (String(url).includes('/suppliers')) return { data: [{ id: 'sup1', company_name: 'مورد' }] };
            if (String(url).includes('/warehouses')) return { data: [
                { id: 'w1', name: 'رئيسي' }, { id: 'w2', name: 'فرعي' },
            ] };
            return { data: [] };
        });
        loadScript();
        await new Promise(r => setTimeout(r, 50));
        await window.drOpenReview('r1');
    });

    test('stored allocations are prefilled as shelf rows', () => {
        const rows = document.querySelectorAll('[data-dr-shelf-row]');
        expect(rows).toHaveLength(1);
        expect(rows[0].querySelector('[data-dr-alloc-shelf]').value).toBe('s1');
        expect(rows[0].querySelector('[data-dr-alloc-qty]').value).toBe('6');
        expect(rows[0].querySelector('[data-dr-alloc-occ]').value).toBe('25');
    });

    test('save sends shelves inside items payload', async () => {
        // add a second allocation row: s2 qty 2
        window.drAddShelfAllocRow(document.querySelector('[data-shelf-subrow] button'));
        const rows = document.querySelectorAll('[data-dr-shelf-row]');
        expect(rows).toHaveLength(2);
        rows[1].querySelector('[data-dr-alloc-shelf]').value = 's2';
        rows[1].querySelector('[data-dr-alloc-qty]').value = '2';
        rows[1].querySelector('[data-dr-alloc-occ]').value = '50';

        await window.drSaveReview();
        expect(window.apiFetch).toHaveBeenCalledWith(
            '/api/direct-receipts/r1/review',
            expect.objectContaining({ method: 'PUT' }));
        expect(savedBody.items[0].shelves).toEqual([
            { shelf_id: 's1', quantity: 6, occupancy_pct: 25 },
            { shelf_id: 's2', quantity: 2, occupancy_pct: 50 },
        ]);
    });

    test('item without linked variant aborts the whole save — no partial PUT, no success toast', async () => {
        // RECEIPT2 = [linked item, unlinked item]. Discriminates the fix: the
        // OLD per-row `return` would still PUT items[0] alone and toast success.
        await window.drOpenReview('r2');
        const inputs = document.querySelectorAll('.dr-review-variant-search');
        expect(inputs).toHaveLength(2);
        expect(inputs[0].dataset.variantId).toBe('v1');
        expect(inputs[1].dataset.variantId).toBe('');

        window.apiFetch.mockClear();
        window.showToast.mockClear();
        await window.drSaveReview();

        const putCalls = window.apiFetch.mock.calls
            .filter(c => String(c[0]).includes('/review') && c[1]?.method === 'PUT');
        expect(putCalls).toHaveLength(0);               // nothing shipped — not even the valid item
        expect(window.showToast).toHaveBeenCalledTimes(1);
        expect(window.showToast).toHaveBeenCalledWith('كل صنف يجب ربطه بمنتج', 'error');

        await window.drOpenReview('r1');                // restore single-item fixture for later tests
    });

    test('alloc sum above confirmed qty blocks save', async () => {
        const qtyInputs = document.querySelectorAll('[data-dr-alloc-qty]');
        qtyInputs[0].value = '99';
        window.apiFetch.mockClear();
        await window.drSaveReview();
        expect(window.apiFetch).not.toHaveBeenCalledWith(
            '/api/direct-receipts/r1/review', expect.anything());
        expect(window.showToast).toHaveBeenCalledWith(
            expect.stringContaining('توزيع الرفوف'), 'error');
    });

    test('warehouse change asks before dropping allocations; cancel restores', async () => {
        await window.drOpenReview('r1');
        window.confirm = jest.fn(() => false);
        const whSel = document.getElementById('dr-review-warehouse');
        const shelvesCalls = () =>
            window.apiFetch.mock.calls.filter(c => String(c[0]).includes('/shelves')).length;
        const before = shelvesCalls();
        whSel.value = 'w2';
        await whSel.onchange();
        expect(window.confirm).toHaveBeenCalled();
        expect(whSel.value).toBe('w1');              // reverted to previous warehouse
        expect(shelvesCalls()).toBe(before);         // no refetch — nothing changed
        expect(document.querySelector('[data-dr-alloc-shelf]').value).toBe('s1');
    });

    test('confirming warehouse change clears stale shelf selections', async () => {
        await window.drOpenReview('r1');
        window.confirm = jest.fn(() => true);
        const whSel = document.getElementById('dr-review-warehouse');
        whSel.value = 'w2';
        await whSel.onchange();
        await new Promise(r => setTimeout(r, 20));
        const sel = document.querySelector('[data-dr-alloc-shelf]');
        // new warehouse's shelf list lacks 's1' → the row falls back to empty
        expect(sel.value).toBe('');
        expect(sel.querySelector('option[value=""]')).toBeTruthy();
    });

    test('save is blocked when shelf loading fails (no silent shelves:[])', async () => {
        const realImpl = window.apiFetch.getMockImplementation();
        window.apiFetch = jest.fn(async (url, opts) => {
            if (String(url).includes('/shelves')) throw new Error('network down');
            return realImpl(url, opts);
        });
        await window.drOpenReview('r1');             // warehouse w1 → load fails
        window.apiFetch.mockClear();
        await window.drSaveReview();
        expect(window.apiFetch).not.toHaveBeenCalledWith(
            '/api/direct-receipts/r1/review', expect.anything());
        expect(window.showToast).toHaveBeenCalledWith(
            expect.stringContaining('فشل تحميل رفوف'), 'error');
        window.apiFetch = jest.fn(realImpl);
    });

    test('new alloc row auto-fills the remaining qty and gets a searchable shelf select', async () => {
        await window.drOpenReview('r1');                 // fresh render: one stored alloc qty=6, item qty=10
        const btn = document.querySelector('[data-shelf-subrow] button');
        const itemQty = parseFloat(document.querySelector('.dr-review-qty').value) || 0;
        const used = [...document.querySelectorAll('[data-dr-alloc-qty]')]
            .reduce((s, i) => s + (parseFloat(i.value) || 0), 0);

        window.makeSelectSearchable.mockClear();
        window.drAddShelfAllocRow(btn);

        const rows = document.querySelectorAll('[data-dr-shelf-row]');
        const added = rows[rows.length - 1];
        expect(added.querySelector('[data-dr-alloc-qty]').value)
            .toBe(String(Math.max(0, itemQty - used)));
        expect(window.makeSelectSearchable).toHaveBeenCalledWith(
            added.querySelector('[data-dr-alloc-shelf]'),
            expect.objectContaining({ wrapClass: 'flex-1 min-w-0' }));
        // clean up the extra row so later tests see the stored state only
        added.remove();
    });
});
