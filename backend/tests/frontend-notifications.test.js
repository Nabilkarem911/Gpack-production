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
