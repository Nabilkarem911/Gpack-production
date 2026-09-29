'use strict';

const fs = require('fs');
const vm = require('vm');

const notificationsSource = fs.readFileSync(
    require('path').join(__dirname, '..', '..', 'frontend', 'js', 'notifications.js'),
    'utf8'
);

function loadNotifications() {
    const calls = [];
    const elements = new Map();
    const element = () => ({
        classList: { add() {}, remove() {}, contains() { return false; } },
        innerHTML: '',
        textContent: '',
        contains() { return false; },
    });
    const getElementById = (id) => {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
    };
    const windowObject = {};
    const sandbox = {
        window: windowObject,
        document: {
            readyState: 'complete',
            getElementById,
            addEventListener() {},
        },
        localStorage: { getItem() { return null; }, setItem() {} },
        console,
        setInterval() {},
        setTimeout,
        clearTimeout,
        Date,
        String,
        JSON,
        Promise,
    };
    windowObject.apiFetch = async (endpoint) => {
        calls.push(endpoint);
        await new Promise(resolve => setTimeout(resolve, 5));
        return endpoint.startsWith('/api/notifications') ? { notifications: [] } : { data: [] };
    };

    vm.createContext(sandbox);
    vm.runInContext(notificationsSource, sandbox);
    return { windowObject, calls };
}

test('receiving voucher filters contain a valid closing select tag', () => {
    const html = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'frontend', 'views', 'receiving-vouchers.html'),
        'utf8'
    );
    expect(html).not.toContain('</n            </select>');
    expect(html).toContain('<option value="without">بدون فاتورة</option>');
});

test('deduplicates dashboard alerts while the initial notification request is pending', async () => {
    const { windowObject, calls } = loadNotifications();

    windowObject.notifToggle({ stopPropagation() {} });
    await new Promise(resolve => setTimeout(resolve, 25));

    expect(calls.filter(endpoint => endpoint === '/api/dashboard/alerts')).toHaveLength(1);
    expect(calls.filter(endpoint => endpoint === '/api/notifications?limit=20')).toHaveLength(1);
});

test('quotation share button only reads the existing token', () => {
    const source = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'frontend', 'js', 'views', 'quotations.js'),
        'utf8'
    );
    const shareBlock = source.slice(source.indexOf('window.shareQuote ='), source.indexOf('window.changeShareQuoteLink ='));

    expect(shareBlock).toContain('const token = order.share_token');
    expect(shareBlock).toContain('const tokenStillValid = token && expires && expires > new Date()');
    expect(shareBlock).not.toContain("/api/public/quotations/${orderId}/share");
    expect(shareBlock).toContain('order.client_response');
});

test('quotation link replacement requires explicit confirmation and owns the share endpoint', () => {
    const source = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'frontend', 'js', 'views', 'quotations.js'),
        'utf8'
    );
    const changeBlock = source.slice(source.indexOf('window.changeShareQuoteLink ='), source.indexOf('window.copyShareLink ='));

    expect(changeBlock).toContain("confirm('سيتم إلغاء الرابط الحالي وإنشاء رابط جديد. هل تريد المتابعة؟')");
    expect(changeBlock).toContain("/api/public/quotations/${_sharingOrderId}/share");
    expect(changeBlock).toContain('await window.shareQuote(_sharingOrderId)');
});

test('quotation copy action requires an actual HTTP link', () => {
    const source = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'frontend', 'js', 'views', 'quotations.js'),
        'utf8'
    );
    const copyBlock = source.slice(source.indexOf('window.copyShareLink ='), source.indexOf('window.closeShareModal ='));

    expect(copyBlock).toContain("!/^https?:\\/\\//.test(linkEl.value)");
});

test('quotation share modal exposes a separate link-change button', () => {
    const html = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'frontend', 'views', 'quotations.html'),
        'utf8'
    );

    expect(html).toContain('id="change-share-link-btn"');
    expect(html).toContain('window.changeShareQuoteLink()');
});

test('production invoice edit reuses order details and matches saved lines safely', () => {
    const source = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'frontend', 'js', 'views', 'production_orders_new.js'),
        'utf8'
    );

    expect(source).toContain('async function _renderInvoiceItems(savedItems = null)');
    expect(source).toContain('item.order_item_id');
    expect(source).toContain('String(item.order_item_id) === String(hubItem.id)');
    expect(source).toContain('String(item.variant_id) === String(hubItem.variant_id)');
    expect(source).toContain('_invoiceItemRowMarkup(saved, saved, isProforma, true)');
    expect(source).toContain('await _renderInvoiceItems(inv.items || [])');
    expect(source).toContain('data-order-item-id');
    expect(source).toContain('data-available');
});

test('production invoice edit keeps saved extra line values separate', () => {
    const source = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'frontend', 'js', 'views', 'production_orders_new.js'),
        'utf8'
    );
    const editBlock = source.slice(source.indexOf('async function _editInvoice'), source.indexOf('async function _saveEditInvoice'));

    expect(editBlock).toContain('filter(i => i.is_extra)');
    expect(editBlock).toContain('item_name || i.product_name');
    expect(editBlock).toContain('parseFloat(i.quantity || 0)');
    expect(editBlock).toContain('parseFloat(i.unit_price || 0)');
});

test('order item edit UI calls the in-place PATCH endpoint and never touches the MO link', () => {
    const source = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'frontend', 'js', 'views', 'production_orders_new.js'),
        'utf8'
    );
    const html = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'frontend', 'views', 'production_orders.html'),
        'utf8'
    );
    const editBlock = source.slice(
        source.indexOf('// ── Edit order item'),
        source.indexOf('// ── Update order status')
    );

    // Edit affordance is gated to production/processing, backend stays the authority
    expect(source).toContain("['production', 'processing'].includes(_hubOrder.status)");
    // In-place update — same endpoint, PATCH, no MO deletion/recreation
    expect(editBlock).toContain('`/api/orders/${_hubOrderId}/items/${itemId}`');
    expect(editBlock).toContain("method: 'PATCH'");
    expect(editBlock).not.toContain('revert-send');
    expect(editBlock).not.toContain('DELETE');
    // Supplier notification reuses shareMO → the share endpoint reuses the same token/URL
    expect(editBlock).toContain("window.shareMO('${mo.id}')");
    // Re-approval and design-review feedback paths
    expect(editBlock).toContain('TOTAL_CHANGE_REQUIRES_REAPPROVAL');
    expect(editBlock).toContain('design_review_needed');
    // Modal wiring
    expect(html).toContain('id="po-edit-item-modal"');
    expect(html).toContain('window.poView.saveItemEdit()');
    expect(source).toContain("window.poView.openEditItemModal('${item.id}')");
});

test('order item edit modal has searchable selects and inline product/variant quick-add', () => {
    const source = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'frontend', 'js', 'views', 'production_orders_new.js'),
        'utf8'
    );
    const html = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'frontend', 'views', 'production_orders.html'),
        'utf8'
    );
    const indexHtml = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'frontend', 'index.html'),
        'utf8'
    );
    const editBlock = source.slice(
        source.indexOf('// ── Edit order item'),
        source.indexOf('// ── Update order status')
    );

    // The shared searchable-dropdown helper is globally loaded and applied to
    // both selects (in-modal absolute dropdown + text search, no OS popup)
    expect(indexHtml).toContain('/js/utils/select-search.js');
    expect(editBlock).toContain('window.makeSelectSearchable');
    expect(editBlock.match(/makeSelectSearchable/g).length).toBeGreaterThanOrEqual(2);

    // Variant list is always rebuilt from the selected product's own variants
    expect(editBlock).toContain('(_editItemState.products || []).find(p => p.id === productSel.value)');
    expect(editBlock).toContain('(product && product.variants) || []');

    // Quick-add panels exist in the modal and are wired to exported handlers
    expect(html).toContain('id="edit-item-add-product"');
    expect(html).toContain('id="edit-item-add-variant"');
    expect(html).toContain('id="edit-item-new-product-name"');
    expect(html).toContain('id="edit-item-new-variant-name"');
    expect(html).toContain("window.poView._toggleItemAddPanel('product')");
    expect(html).toContain("window.poView._toggleItemAddPanel('variant')");

    // Quick-add uses the existing catalog endpoints — variant creation is
    // scoped to the selected product via the route path
    expect(editBlock).toContain("'/api/products'");
    expect(editBlock).toContain('`/api/products/${productId}/variants`');
    expect(editBlock).not.toContain('method: \'DELETE\'');

    // Newly created records are selected and sent through the same PATCH payload
    expect(editBlock).toContain('sel.dispatchEvent(new Event(\'change\'');
    expect(source).toContain('_toggleItemAddPanel:      _toggleItemAddPanel');
    expect(source).toContain('_saveNewProductInline:    _saveNewProductInline');
    expect(source).toContain('_saveNewVariantInline:    _saveNewVariantInline');
});

test('quotation item rows support Enter-key field navigation ending in a new row', () => {
    const source = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'frontend', 'js', 'views', 'quotations.js'),
        'utf8'
    );

    // POS-style chain: رقم الصنف → التصنيف → المنتج → المقاس → الكمية → السعر
    expect(source).toContain("const _rowEnterChain = ['row-product-code', 'row-category', 'row-product', 'row-variant', 'row-qty', 'row-price']");

    // Delegated capture-phase listener scoped to item rows only
    expect(source).toContain('_wireRowEnterNavigation');
    expect(source).toContain("e.target.closest('.quote-item-row')");
    expect(source).toContain("e.key !== 'Enter'");

    // Last field (price) creates the next row and lands on its code input
    expect(source).toContain('window.addQuoteItemRow()');

    // Searchable selects: Enter picks highlighted/first match then advances
    expect(source).toContain("dd.querySelector('.bg-brand-100')");
    expect(source).toContain("dd.querySelector('.cursor-pointer')");

    // Wired from the view init
    expect(source).toMatch(/async function initQuotationsView\(\) \{[\s\S]*?_wireRowEnterNavigation\(\);/);
});

test('print templates list exposes deduped client names and category without row multiplication', () => {
    const source = fs.readFileSync(
        require('path').join(__dirname, '..', 'routes', 'print-templates.js'),
        'utf8'
    );

    // Client names come from a scalar subquery with DISTINCT — one row per template
    expect(source).toContain('SELECT DISTINCT c.name');
    expect(source).toContain('AS client_names');
    expect(source).not.toContain('JOIN client_designs cd ON cd.variant_id');

    // Category is a LEFT JOIN on the one-to-one product relationship
    expect(source).toContain('p.category_id');
    expect(source).toContain('cat.name AS category_name');
    expect(source).toContain('LEFT JOIN categories cat ON cat.id = p.category_id');

    // Server-side search covers category + client names via EXISTS (no join fan-out)
    expect(source).toContain('cat.name ILIKE $1');
    expect(source).toContain('EXISTS (');
    expect(source).toContain('cd_search.variant_id = pv.id');
    expect(source).toContain('c_search.name ILIKE $1');
});

test('print templates view renders compact strips with red size and cascading filters', () => {
    const source = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'frontend', 'js', 'views', 'print-templates.js'),
        'utf8'
    );
    const html = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'frontend', 'views', 'print-templates.html'),
        'utf8'
    );

    // Cascade selects exist and are wired
    expect(html).toContain('id="print-templates-filter-category"');
    expect(html).toContain('id="print-templates-filter-product"');
    expect(html).toContain('id="print-templates-filter-variant"');
    expect(html).toContain('id="print-templates-clear-filters"');
    expect(source).toContain("$('print-templates-filter-category')?.addEventListener('change'");
    expect(source).toContain("$('print-templates-filter-product')?.addEventListener('change'");
    expect(source).toContain("$('print-templates-filter-variant')?.addEventListener('change'");

    // Category change resets product+variant; product change resets variant
    expect(source).toContain('_rebuildProductOptions(true);');
    expect(source).toContain('_rebuildVariantOptions(true);');

    // Search matches client names + category; filters combine (AND)
    expect(source).toContain('template.client_names');
    expect(source).toContain('template.category_name');
    expect(source).toContain('matchesSearch && matchesFilter && matchesCascade');

    // Compact strip: red prominent size + details modal still opens on click
    expect(source).toContain('text-red-600 font-extrabold text-base');
    expect(source).toContain('openDetails(card.dataset.templateId)');

    // Details endpoint/modal untouched — full data preserved
    expect(source).toContain('/api/print-templates/${encodeURIComponent(id)}');
    expect(source).toContain('print-template-supplier-privacy');
    expect(html).toContain('id="print-template-details-modal"');
});
