const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, 'frontend');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/verify-tree.html';
    const fp = path.join(ROOT, p);
    if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
});

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;
    const browser = await puppeteer.launch({ headless: 'new', executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    page.on('pageerror', e => console.log('[pageerror]', e.message));
    await page.goto(`http://localhost:${port}/verify-tree.html`, { waitUntil: 'networkidle2' });
    await wait(2000);

    // 1. collapsed state — only 3 parent rows
    let rows = await page.evaluate(() => document.querySelectorAll('#products-tbody tr').length);
    console.log('COLLAPSED rows:', rows);
    await page.screenshot({ path: 'tree-collapsed.png' });

    // 2. expand product p1 by clicking its name
    await page.evaluate(() => window.toggleProductExpandOrOpen('p1'));
    await wait(400);
    rows = await page.evaluate(() => document.querySelectorAll('#products-tbody tr').length);
    const childTexts = await page.evaluate(() =>
        [...document.querySelectorAll('#products-tbody tr')].map(r => r.innerText.replace(/\n/g,' | ').slice(0,90)));
    console.log('EXPANDED rows:', rows);
    childTexts.forEach(t => console.log('  ROW:', t));
    await page.screenshot({ path: 'tree-expanded.png' });

    // 3. expand p3 too
    await page.evaluate(() => window.toggleProductExpand('p3'));
    await wait(300);
    rows = await page.evaluate(() => document.querySelectorAll('#products-tbody tr').length);
    console.log('BOTH EXPANDED rows:', rows);

    // 4. collapse p1 again
    await page.evaluate(() => window.toggleProductExpand('p1'));
    await wait(300);
    rows = await page.evaluate(() => document.querySelectorAll('#products-tbody tr').length);
    console.log('P1 COLLAPSED rows:', rows);

    // 5. click variant → variant-scoped modal
    await page.evaluate(() => window.openProductLifecycle('p1', 'v1'));
    await wait(1200);
    const badge = await page.evaluate(() => {
        const b = document.getElementById('plc-variant-badge');
        return b && !b.classList.contains('hidden') ? b.innerText : 'HIDDEN';
    });
    const calledScoped = await page.evaluate(() => window._lastScoped || 'see console');
    console.log('VARIANT BADGE:', badge);
    await page.screenshot({ path: 'tree-variant-modal.png' });

    await browser.close();
    server.close();
    console.log('DONE');
})().catch(e => { console.error(e); server.close(); process.exit(1); });
