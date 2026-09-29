/**
 * @jest-environment jsdom
 *
 * Bulk + single assign modal behavior in production_orders_new.js.
 * Covers: supplier field surviving design selection, no-preset design type,
 * required design type on save, mockup payload pass-through.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'frontend', 'js', 'views', 'production_orders_new.js');

function mountDom() {
    document.body.innerHTML = `
        <input id="po-search">
        <input id="hub-items-check-all" type="checkbox">
        <table><tbody id="hub-items-tbody"></tbody></table>

        <div id="po-assign-modal" class="hidden"></div>
        <input id="assign-mo-id">
        <input id="assign-order-item-id">
        <input id="assign-order-id">
        <span id="assign-item-name"></span>
        <b id="assign-item-qty"></b><b id="assign-item-assigned"></b><b id="assign-item-available"></b>
        <select id="assign-supplier-select"></select>
        <input id="assign-qty">
        <input type="radio" name="assign-design-status" value="new">
        <input type="radio" name="assign-design-status" value="reprint">
        <div id="assign-design-preview-box" class="hidden"></div>
        <div id="assign-no-design-box" class="hidden"></div>
        <button id="assign-design-thumb"><div class="design-preview-media"></div></button>
        <div id="assign-design-name"></div><div id="assign-design-type-label"></div>
        <input id="assign-selected-design-id">
        <span id="assign-design-status-badge" class="hidden"></span>
        <span id="assign-design-btn-text"></span>
        <input type="file" id="assign-mockup-file">
        <div id="assign-mockup-preview" class="hidden"><img id="assign-mockup-thumb"><p id="assign-mockup-name"></p></div>
        <input id="assign-pantone-search"><div id="assign-pantone-list"></div>
        <input id="assign-expected-delivery"><textarea id="assign-notes"></textarea>
        <input id="upload-design-client-id">

        <div id="po-design-selector-modal" class="hidden"></div>
        <input id="design-search"><div id="design-selector-list"></div>
        <button id="design-tab-item"><span id="design-tab-item-count"></span></button>
        <button id="design-tab-client"><span id="design-tab-client-count"></span></button>

        <div id="po-bulk-assign-modal" class="hidden"></div>
        <div id="bulk-items-summary"></div>
        <select id="bulk-supplier-select"></select>
        <input id="bulk-expected-delivery"><textarea id="bulk-notes"></textarea>
        <button id="bulk-save-btn"></button>
    `;
}

function makeCheckbox(itemId) {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.itemId = itemId;
    cb.dataset.itemName = 'ستيكر اعلاق 3*18سم';
    cb.dataset.itemQty = '50';
    cb.dataset.itemAssigned = '0';
    cb.dataset.designId = '';
    cb.dataset.designName = '';
    cb.dataset.designThumb = '';
    cb.dataset.variantId = 'v1';
    return cb;
}

describe('Production orders — assign modals', () => {
    let apiFetch;

    beforeAll(async () => {
        mountDom();
        apiFetch = jest.fn(async (url) => {
            if (url.startsWith('/api/orders/o1')) {
                return { data: { id: 'o1', order_number: 1, client_id: 'c1', client_name: 'عميل',
                    items: [{ id: 'i1', product_name: 'ستيكر اعلاق', size_name: '3*18سم', quantity: 50,
                              manufacturer_po_qty: 0, unit_price: 2, variant_id: 'v1', client_id: 'c1' }] } };
            }
            if (url.includes('/api/client-designs') && url.includes('variant_id')) {
                return { data: [{ id: 'd-item', design_name: 'تصميم الصنف', design_number: 5, thumbnail_url: null }] };
            }
            if (url.includes('/api/client-designs')) {
                return { data: [
                    { id: 'd-item', design_name: 'تصميم الصنف', design_number: 5, thumbnail_url: null },
                    { id: 'd-client', design_name: 'تصميم عميل آخر', design_number: 2, thumbnail_url: null },
                ] };
            }
            if (url.includes('/api/client-pantone-colors')) return { data: [] };
            if (url.includes('/api/suppliers')) return { data: [{ id: 'sup1', company_name: 'مورد تجريبي' }] };
            return { data: [] };
        });
        window.apiFetch = apiFetch;
        window.showToast = jest.fn();
        window.makeSelectSearchable = jest.fn();
        // Load the real view file (IIFE registers window.poView)
        eval(fs.readFileSync(SRC, 'utf8'));
        await new Promise(r => setTimeout(r, 50)); // let _init() finish
    });

    beforeEach(() => {
        apiFetch.mockClear();
        window.showToast.mockClear();
        document.getElementById('hub-items-tbody').innerHTML = '';
        document.getElementById('bulk-supplier-select').innerHTML = '';
        document.getElementById('bulk-expected-delivery').value = '';
        document.getElementById('bulk-notes').value = '';
    });

    async function openHub() {
        await window.poView.openHub('o1');
    }

    test('bulk: supplier, delivery and notes survive design selection', async () => {
        await openHub();
        const cb = makeCheckbox('i1');
        document.getElementById('hub-items-tbody').appendChild(cb);
        window.poView.toggleItemCheck(cb);
        window.poView.openBulkAssignModal();

        const sel = document.getElementById('bulk-supplier-select');
        sel.value = 'sup1';
        document.getElementById('bulk-expected-delivery').value = '2026-01-15';
        document.getElementById('bulk-notes').value = 'ملاحظات مهمة';

        // design type starts unselected
        expect(document.querySelector('input[name="bulk-design-status-i1"]:checked')).toBeNull();

        await window.poView.bulkSelectDesign('i1');      // opens picker (both tabs load)
        window.poView._selectDesign('d-client', 'تصميم عميل آخر', '', 'png');

        // THE FIX: supplier/delivery/notes untouched by the re-render
        expect(sel.value).toBe('sup1');
        expect(document.getElementById('bulk-expected-delivery').value).toBe('2026-01-15');
        expect(document.getElementById('bulk-notes').value).toBe('ملاحظات مهمة');

        // row re-rendered: design picked → reprint radio set, name shown
        expect(document.querySelector('input[name="bulk-design-status-i1"][value="reprint"]').checked).toBe(true);
        expect(document.getElementById('bulk-items-summary').innerHTML).toContain('تصميم عميل آخر');
    });

    test('bulk: design selector has item + client tabs with correct lists', async () => {
        await openHub();
        const cb = makeCheckbox('i1');
        window.poView.toggleItemCheck(cb);
        await window.poView.bulkSelectDesign('i1');

        // item tab (default) shows only variant-linked design
        expect(document.getElementById('design-selector-list').innerHTML).toContain('تصميم الصنف');
        expect(document.getElementById('design-selector-list').innerHTML).not.toContain('تصميم عميل آخر');
        expect(document.getElementById('design-tab-item-count').textContent).toBe('(1)');
        expect(document.getElementById('design-tab-client-count').textContent).toBe('(2)');

        // switch to client tab shows all client designs
        window.poView._switchDesignTab('client');
        expect(document.getElementById('design-selector-list').innerHTML).toContain('تصميم عميل آخر');
        window.poView._closeDesignSelector();
    });

    test('bulk: save blocked until every item has a design type', async () => {
        await openHub();
        const cb = makeCheckbox('i1');
        window.poView.toggleItemCheck(cb);
        window.poView.openBulkAssignModal();
        document.getElementById('bulk-supplier-select').value = 'sup1';

        await window.poView.saveBulkAssignment();
        expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('حدد نوع التصميم'), 'error');
        expect(apiFetch.mock.calls.some(c => c[0] === '/api/manufacturer-orders')).toBe(false);

        window.poView._bulkSetDesignStatus('i1', 'new');
        await window.poView.saveBulkAssignment();
        const postCall = apiFetch.mock.calls.find(c => c[0] === '/api/manufacturer-orders' && c[1]?.method === 'POST');
        expect(postCall).toBeTruthy();
        expect(postCall[1].body.items[0].design_status).toBe('new');
        expect(postCall[1].body.items[0].mockup_path).toBeNull();
    });

    test('single assign: no preset design type, save blocked until chosen', async () => {
        await openHub();
        await window.poView.openAssignModal('i1');
        expect(document.querySelector('input[name="assign-design-status"]:checked')).toBeNull();

        document.getElementById('assign-supplier-select').innerHTML = '<option value="sup1">مورد</option>';
        document.getElementById('assign-supplier-select').value = 'sup1';
        document.getElementById('assign-qty').value = '10';

        await window.poView.saveAssignment();
        expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('نوع التصميم'), 'error');
        expect(apiFetch.mock.calls.some(c => c[0] === '/api/manufacturer-orders')).toBe(false);

        document.querySelector('input[name="assign-design-status"][value="reprint"]').checked = true;
        await window.poView.saveAssignment();
        const postCall = apiFetch.mock.calls.find(c => c[0] === '/api/manufacturer-orders' && c[1]?.method === 'POST');
        expect(postCall).toBeTruthy();
        expect(postCall[1].body.items[0].design_status).toBe('reprint');
        expect(postCall[1].body.items[0].mockup_path).toBeNull();
    });
});
