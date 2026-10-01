/**
 * @jest-environment jsdom
 *
 * Warehouses shelves tab — XSS-safe unassigned labels, occupancy section
 * hidden in assign mode, and manual occupancy clear (null) support.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'frontend', 'views', 'warehouses.html');

function mountDom() {
    document.body.innerHTML = `
        <input id="shelf-search">
        <div id="shelf-grid"></div>
        <div id="shelf-unassigned-box"></div>
        <div id="shelf-modal" class="hidden">
            <h3 id="shelf-modal-title"></h3>
            <p id="shelf-modal-meta"></p>
            <div id="shelf-occ-section"><div id="shelf-occ-btns">
                <button data-pct="25"></button><button data-pct="50"></button>
                <button data-pct="75"></button><button data-pct="100"></button>
                <button data-pct=""></button>
            </div></div>
            <div id="shelf-contents-section"><div id="shelf-contents"></div></div>
            <div id="shelf-move-box" class="hidden">
                <p id="shelf-move-title"></p>
                <input id="shelf-move-qty">
                <select id="shelf-move-target"></select>
                <div id="shelf-move-occ"><button data-pct="25"></button></div>
            </div>
        </div>`;
}

function loadViewScript() {
    const html = fs.readFileSync(SRC, 'utf8');
    const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
    // Keep initWarehousesView dormant — pretend DOM is still loading so the
    // script registers a DOMContentLoaded listener instead of running init.
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    (0, eval)(script); // global eval: view functions land on globalThis
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
}

describe('warehouses shelves UI', () => {
    beforeAll(() => {
        mountDom();
        window.apiFetch = jest.fn(async () => ({ data: [] }));
        window.showToast = jest.fn();
        loadViewScript();
    });

    test('unassigned labels are HTML-escaped and carry no inline name injection', () => {
        globalThis._activeWhId = 'wh-1';
        globalThis._shelfData = {
            shelves: [],
            unassigned: [{
                stock_id: 'stk-1',
                unassigned_qty: '7',
                product_name: 'صنف "مزدوج" <img src=x>',
                size_name: '3*18',
                client_name: "O'Brien",
            }],
        };

        globalThis.renderUnassignedBox();
        const box = document.getElementById('shelf-unassigned-box');

        // The injected markup never becomes an element; the name renders as text
        expect(box.querySelector('img')).toBe(null);
        expect(box.textContent).toContain('صنف "مزدوج"');
        // onclick only carries the uuid + qty — the name never enters it
        const btn = box.querySelector('button');
        const onclick = btn.getAttribute('onclick');
        expect(onclick).toBe("openAssignMove('stk-1', 7)");
        expect(onclick).not.toContain('مزدوج');
    });

    test('openAssignMove hides occupancy + contents sections and resolves label safely', () => {
        globalThis._shelfData = {
            shelves: [{ id: 's1', code: 'A1-01', zone: 'A', floor: 1, slot: 1, status: 'active' }],
            unassigned: [{ stock_id: 'stk-9', unassigned_qty: 4, product_name: 'كرتونة "خاصة"', size_name: 'L', client_name: null }],
        };

        globalThis.openAssignMove('stk-9', 4);

        expect(document.getElementById('shelf-occ-section').classList.contains('hidden')).toBe(true);
        expect(document.getElementById('shelf-contents-section').classList.contains('hidden')).toBe(true);
        expect(document.getElementById('shelf-modal').classList.contains('hidden')).toBe(false);
        // label resolved via textContent — raw quotes, no markup execution
        expect(document.getElementById('shelf-modal-meta').textContent).toContain('كرتونة "خاصة"');
        expect(globalThis._shelfMoveCtx.stock_id).toBe('stk-9');
        expect(globalThis._shelfMoveCtx.from_shelf_id).toBe(null);
    });

    test('openShelf restores occupancy + contents sections', async () => {
        window.apiFetch = jest.fn(async () => ({
            data: {
                shelf: { id: 's1', code: 'A1-01', zone: 'A', floor: 1, occupancy_pct: 50, warehouse_name: 'الرئيسي' },
                items: [],
            },
        }));

        await globalThis.openShelf('s1');

        expect(document.getElementById('shelf-occ-section').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('shelf-contents-section').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('shelf-modal-title').textContent).toBe('رف A1-01');
    });

    test('setShelfOccupancy(null) clears the estimate via the API', async () => {
        globalThis._activeShelf = { id: 's1', occupancy_pct: 50 };
        window.apiFetch = jest.fn(async () => ({ data: {} }));

        await globalThis.setShelfOccupancy(null);

        expect(window.apiFetch).toHaveBeenCalledWith(
            '/api/inventory/shelves/s1/occupancy',
            expect.objectContaining({ method: 'PATCH', body: { occupancy_pct: null } })
        );
        expect(globalThis._activeShelf.occupancy_pct).toBe(null);
    });

    test('openShelf escapes product/client names in shelf contents rows', async () => {
        window.apiFetch = jest.fn(async () => ({
            data: {
                shelf: { id: 's1', code: 'A1-01', zone: 'A', floor: 1, occupancy_pct: 50, warehouse_name: 'الرئيسي' },
                items: [{
                    stock_id: 'stk-2',
                    quantity: '3',
                    product_name: 'صنف <img src=x>',
                    size_name: '3*18',
                    client_name: "O'Brien <b>bold</b>",
                }],
            },
        }));

        await globalThis.openShelf('s1');

        const box = document.getElementById('shelf-contents');
        // hostile markup stays text — never becomes elements
        expect(box.querySelector('img')).toBe(null);
        expect(box.querySelector('b')).toBe(null);
        expect(box.textContent).toContain('صنف <img src=x>');
        expect(box.textContent).toContain("O'Brien <b>bold</b>");
        // نقل button carries only uuid + shelf id + qty
        expect(box.querySelector('button').getAttribute('onclick'))
            .toBe("openShelfMove('stk-2', 's1', 3)");
    });

    test('clear-occupancy button keeps its dashed style and highlights when cleared', async () => {
        const clearBtn = document.querySelector('#shelf-occ-btns button[data-pct=""]');

        // shelf with occupancy=50 → clear button keeps its own style, not the flat one
        window.apiFetch = jest.fn(async () => ({
            data: { shelf: { id: 's1', code: 'A1-01', zone: 'A', floor: 1, occupancy_pct: 50, warehouse_name: 'الرئيسي' }, items: [] },
        }));
        await globalThis.openShelf('s1');
        expect(clearBtn.className).toContain('border-dashed');
        expect(clearBtn.className).not.toContain('bg-brand-600');

        // clearing occupancy marks it active
        window.apiFetch = jest.fn(async () => ({ data: {} }));
        await globalThis.setShelfOccupancy(null);
        expect(clearBtn.className).toContain('bg-brand-600');

        // opening a shelf with NULL occupancy highlights it too
        window.apiFetch = jest.fn(async () => ({
            data: { shelf: { id: 's1', code: 'A1-01', zone: 'A', floor: 1, occupancy_pct: null, warehouse_name: 'الرئيسي' }, items: [] },
        }));
        await globalThis.openShelf('s1');
        expect(clearBtn.className).toContain('bg-brand-600');
    });

    test('whDetailSwitchTab keeps stock/history behavior and adds shelves', () => {
        document.body.innerHTML += `
            <button id="det-tab-stock"></button><button id="det-tab-history"></button><button id="det-tab-shelves"></button>
            <div id="det-section-stock"></div><div id="det-section-history"></div><div id="det-section-shelves" class="hidden"></div>`;

        globalThis.whDetailSwitchTab('shelves');
        expect(document.getElementById('det-section-shelves').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('det-section-stock').classList.contains('hidden')).toBe(true);

        globalThis.whDetailSwitchTab('stock');
        expect(document.getElementById('det-section-shelves').classList.contains('hidden')).toBe(true);
        expect(document.getElementById('det-section-stock').classList.contains('hidden')).toBe(false);
    });
});
