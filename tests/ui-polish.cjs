// Phase 4 P4-E UI polish: paise shown as two digits, the event's tools in one row (no stray buttons),
// "Split bill" wording, and nothing wider than a small phone. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const DATA = { version: 'ffv2', photos: [], vPays: [],
  vendors: [{ id: 'vg', name: 'Sample Grocer', cat: 'Raw Material' }],
  events: [{ id: 'A', name: 'Sample Past Event', date: day(-2), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 100, photoIds: [] },
    { id: 'B', name: 'Sample Future Event', date: day(5), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 50000, guests: 50, photoIds: [], payPlan: [{ id: 'm1', when: 'booking', amt: 10000, label: 'Advance' }] }],
  cPays: [{ id: 'c1', evId: 'A', amt: 90000, date: day(-1), mode: 'UPI' }],
  expenses: [{ id: 'x1', evId: 'A', cat: 'Raw Material', head: 'Milk – दूध', amt: 2500.5, date: day(-2), pay: 'credit', venId: 'vg', billIds: [] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 740 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const openEvent = async id => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator(`#ev-list [data-action="evdetail"][data-id="${id}"]:visible`).click(); await p.waitForSelector('#tab-evdetail .detail-name'); };
  const noOverflow = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);

  await test('money with paise shows two digits; whole rupees show none', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js'); return [2500.5, 2500, 0.05, -1234.1, 100000].map(u.fmtCurrency); });
    assert.deepEqual(r, ['₹2,500.50', '₹2,500', '₹0.05', '-₹1,234.10', '₹1,00,000']);
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-expenses:visible').click();
    assert.match(await p.locator('#exp-list').innerText(), /₹2,500\.50/);
  });

  await test("a past event's tools sit in one row: guest count, final settlement, function sheet, schedule; no stray buttons", async () => {
    await openEvent('A');
    const tools = await p.locator('#ev-tools [data-action]').evaluateAll(bs => bs.map(b => b.dataset.action));
    assert.deepEqual(tools, ['plan-edit', 'count-open', 'settle-open', 'fs-open']);
    for (const a of ['plan-edit', 'count-open', 'settle-open', 'fs-open']) assert.equal(await p.locator(`#tab-evdetail [data-action="${a}"]`).count(), 1, `${a} appears once`);
    assert.equal(await noOverflow(), true);
  });

  await test('an upcoming, scheduled event shows its schedule block and no settlement button', async () => {
    await openEvent('B');
    assert.deepEqual(await p.locator('#ev-tools [data-action]').evaluateAll(bs => bs.map(b => b.dataset.action)), ['count-open', 'fs-open']);
    assert.equal(await p.locator('#pay-schedule [data-action="plan-edit"]').count(), 1);
    assert.equal(await noOverflow(), true);
  });

  await test('the bill split is called "Split bill" and offers common stock', async () => {
    await p.locator('#n-expenses:visible').click(); await p.locator('#exp-list [data-action="edit-exp"][data-id="x1"]:visible').first().click(); await p.waitForSelector('#exp-modal.active');
    assert.match(await p.locator('#btn-share-exp').innerText(), /Split bill/);
    await p.locator('#btn-share-exp').click(); await p.waitForSelector('#split-modal.active');
    assert.match(await p.locator('#split-mtitle').innerText(), /Split bill: events or stock/);
    assert.match(await p.locator('#split-rows').innerText(), /Common stock/);
    assert.equal(await noOverflow(), true);
  });

  await test('tools sit on an even two-column grid; text-only buttons are centred', async () => {
    await openEvent('A');
    const boxes = await p.locator('#ev-tools [data-action]').evaluateAll(bs => bs.map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; }));
    assert.equal(boxes[0][1], boxes[1][1], 'first two equal width'); assert.equal(boxes[2][0], boxes[0][0], 'second row starts at the same left edge');
    await p.locator('#n-expenses:visible').click();
    const pay = await p.locator('#to-pay-list [data-action="open-vpay"]').first().evaluate(b => { const s = getComputedStyle(b); return [s.paddingLeft, s.paddingRight, s.justifyContent]; });
    assert.deepEqual(pay, ['12px', '12px', 'center']);
  });

  await test('no separate refresh button; coming back to the app announces a new version with an Update button', async () => {
    assert.equal(await p.locator('#hdr-refresh').count(), 0);
    await p.evaluate(() => { window.caterDeskUpdate = async () => '9.9.9'; document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(500);
    assert.match(await p.locator('#toast-msg').innerText(), /New version v9\.9\.9 is ready/);
    assert.match(await p.locator('#toast-action').innerText(), /Update/);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'ui polish FAIL' : 'UI polish: money format, event tools row, split wording PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('ui polish FAIL'); process.exitCode = 1; });
