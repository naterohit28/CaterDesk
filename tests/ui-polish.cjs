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

  await test('long vendor and event names: full-width pickers, text shrinks (not below 13px) so the chosen name reads in full', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const { _rev, ...v } = d.vendors[0]; await db.putOne('vendors', { ...v, name: 'Sample Shree Ganesh Grocery Suppliers' }); });
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-expenses:visible').click();
    await p.locator('#exp-list [data-action="edit-exp"][data-id="x1"]:visible').first().click(); await p.waitForSelector('#exp-modal.active'); await p.waitForTimeout(400);
    const r = await p.evaluate(() => ['#exp-vendor', '#exp-ev'].map(id => { const s = document.querySelector(id), cs = getComputedStyle(s);
      const c = document.createElement('canvas').getContext('2d'); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      return { w: Math.round(s.getBoundingClientRect().width), size: parseFloat(cs.fontSize), fits: c.measureText(s.selectedOptions[0].text).width <= s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) }; }));
    assert.equal(r[0].w, r[1].w, 'vendor picker as wide as the event picker');
    for (const x of r) { assert.equal(x.fits, true); assert(x.size >= 13); }
  });

  await test('alignment: tab icons centred on one point, period buttons even, no floating button over Home quick actions', async () => {
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-home').click();
    const icons = await p.locator('nav.bot-nav .nav-it svg').evaluateAll(ss => ss.map(s => { const b = s.getBBox(); return [Math.round((b.x + b.width / 2) * 2) / 2, Math.round((b.y + b.height / 2) * 2) / 2]; }));
    assert.deepEqual(icons, Array(5).fill([12, 12]), 'every tab icon centred in its 24×24 frame');
    const tabs = await p.locator('nav.bot-nav .nav-it').evaluateAll(bs => bs.map(b => { const r = b.getBoundingClientRect(), i = b.querySelector('svg').getBoundingClientRect(), l = b.querySelector('.nav-en').getBoundingClientRect();
      return [Math.round(r.left + r.width / 2), Math.round(i.left + i.width / 2), Math.round(l.left + l.width / 2), Math.round(i.top), Math.round(l.top)]; }));
    for (const [btn, ic, lab] of tabs) { assert(Math.abs(btn - ic) <= 1 && Math.abs(btn - lab) <= 1, 'icon and label centred in the tab'); }
    assert.equal(new Set(tabs.map(t => t[3])).size, 1); assert.equal(new Set(tabs.map(t => t[4])).size, 1);
    const seg = await p.locator('#tab-home .seg.period button').evaluateAll(bs => bs.map(b => b.innerText));
    assert.deepEqual(seg, ['Month', '3 months', 'FY', 'All time']);
    assert.equal(await p.locator('#fab').isHidden(), true, 'Home has Add expense in Quick actions; no floating copy over the cards');
    await p.locator('#n-events').click(); assert.equal(await p.locator('#fab').isVisible(), true, 'other tabs keep their button');
  });

  await test('the collected bar has a caption, and is left out while nothing is collected', async () => {
    await openEvent('A'); assert.match(await p.locator('#ev-collected').innerText(), /90% of the bill collected/);
    await openEvent('B'); assert.equal(await p.locator('#tab-evdetail .prog').count(), 0); assert.equal(await p.locator('#ev-collected').count(), 0);
  });

  await test('insight and note rows: icon and one-line text share the same centre line', async () => {
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-home').click();
    const off = await p.locator('#insights-wrap .note').evaluateAll(ns => ns.map(n => { const i = n.querySelector('.note-ic').getBoundingClientRect(), t = n.querySelector(':scope > div').getBoundingClientRect();
      return Math.abs(Math.round((i.top + i.height / 2) - (t.top + t.height / 2))); }));
    assert(off.length > 0); assert(off.every(d => d <= 1), 'offsets ' + off);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'ui polish FAIL' : 'UI polish: money format, event tools row, split wording PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('ui polish FAIL'); process.exitCode = 1; });
