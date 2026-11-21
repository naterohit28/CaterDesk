// Owner's phone review (4.31.21): vendor messages carry the same lines every time — counter/items, quantity, date,
// ready-by time, venue — and an order or purchase needs its time; one Save saves a typed menu; the field being typed
// stays in view; times are picked as Hour / Minute / AM-PM, not on the phone's clock dial. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'vd', name: 'Sample Dosa Counter', cat: 'Live Counter', specialty: 'Dosa – डोसा', phone: '9000000001' },
    { id: 'vs', name: 'Sample Sweet Shop', cat: 'Raw Material', phone: '9000000005' }],
  events: [{ id: 'E1', name: 'Sample UX Event', date: day(6), venue: 'Sample Hall', locality: 'Baner', type: 'Wedding – लग्न', billing: 160000, photoIds: [],
    meals: ['dinner'], mealPlan: { dinner: { guests: 200, rate: 800 } },
    dishes: [{ name: 'Masala Dosa', head: 'Dosa – डोसा', meal: 'dinner' }, { name: 'Gulab Jamun', src: 'buy', meal: 'dinner' }],
    orders: [{ id: 'OLD', head: 'Dosa – डोसा', venId: 'vd', plates: 10, date: day(6), time: '07:32', status: 'cancelled', messages: [] }] }] };
// Type the time, then tap AM or PM (no clock dial, no lists — owner, 4.31.22)
const setTime = async (p, id, text, ap) => { await p.fill(`#${id}-t`, text); if (ap) await p.locator(`#${id}-${ap.toLowerCase()}`).click(); };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const ev = async () => (await p.evaluate(async () => (await import('./db.js')).exportAllData())).events.find(e => e.id === 'E1');
  const openEvent = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="E1"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d, 'replace'); }, DATA);
  await p.addInitScript(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return {}; }; });

  await test('no clock dial anywhere: every time is one typed box and an AM / PM switch', async () => {
    await openEvent();
    assert.equal(await p.locator('input[type="time"]').count(), 0);
    for (const id of ['svc-time', 'ord-time', 'buy-time']) for (const k of ['t', 'am', 'pm']) assert.equal(await p.locator(`#${id}-${k}`).count(), 1, `${id}-${k}`);
    assert.equal(await p.locator('.time-pick select').count(), 0, 'no hour / minute lists');
  });

  await test('typing a time: 7:30, 7.30, 730 and 7 with PM; 19:30 sets PM by itself; nothing guessed without AM / PM', async () => {
    await openEvent();
    await p.locator('[data-action="order-new"][data-id^="Dosa"]').click(); await p.waitForSelector('#ord-modal.active');
    const v = () => p.inputValue('#ord-time');
    await setTime(p, 'ord-time', '7:30', ''); assert.equal(await v(), '', '7:30 alone is not a time yet');
    await p.locator('#ord-time-pm').click(); assert.equal(await v(), '19:30');
    for (const [typed, want] of [['7.30', '19:30'], ['730', '19:30'], ['7', '19:00'], ['12', '12:00'], ['7:5', '19:50']]) { await p.fill('#ord-time-t', typed); assert.equal(await v(), want, typed); }
    await p.locator('#ord-time-am').click(); await p.fill('#ord-time-t', '12:15'); assert.equal(await v(), '00:15', '12:15 AM is just after midnight');
    await p.fill('#ord-time-t', '19:30'); assert.equal(await v(), '19:30');
    assert.equal(await p.locator('#ord-time-pm').getAttribute('aria-pressed'), 'true', 'a 24-hour time sets PM');
    for (const bad of ['25:00', '7:75', 'abc']) { await p.fill('#ord-time-t', bad); assert.equal(await v(), '', bad); }
    await p.locator('#ord-modal [data-action="close-modal"]').first().click().catch(() => {});
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
  });

  await test('a vendor order needs its ready-by time; the message has every line in a fixed order', async () => {
    await openEvent();
    await p.locator('[data-action="order-new"][data-id^="Dosa"]').click(); await p.waitForSelector('#ord-modal.active');
    await p.selectOption('#ord-ven', 'vd'); await p.fill('#ord-plates', '150');
    await setTime(p, 'ord-time', '', ''); await p.locator('#btn-save-ord').click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#ord-modal').innerText(), /Ready by: type the time and tap AM or PM/);
    assert.equal(((await ev()).orders || []).filter(o => o.status !== 'cancelled').length, 0, 'nothing saved without a time');
    await setTime(p, 'ord-time', '7:30', 'PM'); assert.equal(await p.inputValue('#ord-time'), '19:30');
    await p.locator('#btn-send-ord').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-modal.active #ask-actions .btn-wa').click(); await p.waitForTimeout(300);
    const text = decodeURIComponent((await p.evaluate(() => window.__opened[0])).split('?text=')[1]);
    const lines = text.split('\n').map(l => l.split(':')[0]);
    assert.deepEqual(lines.slice(1, 7), ['Counter', 'Items', 'Quantity', 'Date', 'Ready by', 'Venue'], text);
    assert.match(text, /Items: Masala Dosa\nQuantity: 150 plates\nDate: .*\(Dinner\)\nReady by: 7:30 PM\nVenue: Sample Hall, Baner/);
    assert.equal((await ev()).orders.find(o => o.status !== 'cancelled').time, '19:30');
  });

  await test('an older time shows exactly in the box (7:32 AM), and 12 PM / 12 AM are noon and midnight', async () => {
    await openEvent(); await p.locator('[data-action="order-status"]').first().click(); await p.locator('#ask-modal.active #ask-actions button', { hasText: 'Edit / send again' }).click(); await p.waitForSelector('#ord-modal.active');
    await p.evaluate(() => { const i = document.getElementById('ord-time'); i.value = '07:32'; });
    assert.deepEqual([await p.inputValue('#ord-time-t'), await p.locator('#ord-time-am').getAttribute('aria-pressed')], ['7:32', 'true']);
    await setTime(p, 'ord-time', '12:00', 'PM'); assert.equal(await p.inputValue('#ord-time'), '12:00');
    await setTime(p, 'ord-time', '12:15', 'AM'); assert.equal(await p.inputValue('#ord-time'), '00:15');
    await p.locator('#ord-modal [data-action="close-modal"]').first().click().catch(() => {});
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
  });

  await test('a purchase needs its deliver-by time; the message says Date, Deliver by, Venue', async () => {
    await openEvent(); await p.evaluate(() => { window.__opened = []; });
    await p.locator('[data-action="buy-new"]').first().click(); await p.waitForSelector('#buy-modal.active');
    await p.selectOption('#buy-ven', 'vs'); await p.fill('#buy-qty', '300'); await p.selectOption('#buy-unit', 'pcs');
    await p.locator('#btn-send-buy').click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#buy-modal').innerText(), /Deliver by: type the time and tap AM or PM/);
    await setTime(p, 'buy-time', '6', 'PM'); await p.locator('#btn-send-buy').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-modal.active #ask-actions .btn-wa').click(); await p.waitForTimeout(300);
    const text = decodeURIComponent((await p.evaluate(() => window.__opened[0])).split('?text=')[1]);
    assert.match(text, /Item: Gulab Jamun\nQuantity: 300 pieces\nDate: .*\nDeliver by: 6:00 PM\nVenue: Sample Hall, Baner/);
  });

  await test('one Save saves a typed menu (no second tap)', async () => {
    await openEvent();
    await p.locator('[data-action="svc-edit"]').first().click(); await p.waitForSelector('#svc-modal.active');
    await p.locator('#svc-add').fill('Paneer Tikka, Dal Makhani');
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(600);
    assert.equal(await p.locator('#svc-modal.active').count(), 0, 'the sheet closed');
    assert.deepEqual((await ev()).dishes.map(d => d.name).filter(n => ['Paneer Tikka', 'Dal Makhani'].includes(n)), ['Paneer Tikka', 'Dal Makhani']);
  });

  await test('a field low in a sheet is scrolled into view when it gets focus (small visible area, as with the keyboard open)', async () => {
    await p.setViewportSize({ width: 390, height: 420 });
    await openEvent();
    await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active'); await p.waitForTimeout(300);
    await p.evaluate(() => document.getElementById('ev-notes').focus()); await p.waitForTimeout(900);
    const r = await p.evaluate(() => { const a = document.getElementById('ev-notes').getBoundingClientRect(); return { top: a.top, bottom: a.bottom, h: window.visualViewport.height }; });
    assert.ok(r.top >= 0 && r.bottom <= r.h, JSON.stringify(r));
    await p.setViewportSize({ width: 390, height: 844 });
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'phone-ux FAIL' : 'order lines and time, one Save, field in view, hour/minute/AM-PM PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('phone-ux FAIL'); process.exitCode = 1; });
