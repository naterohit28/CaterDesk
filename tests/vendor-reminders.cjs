// Vendor reminders: Home's Deliveries lists orders not yet confirmed for the next 2 days with Remind (WhatsApp opens a
// prefilled confirmation request; the app sends nothing) and Confirmed; confirmed deliveries today and tomorrow stay
// listed; an order never sent offers Send; the order's status sheet offers "Remind to confirm". 360px. Synthetic data.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const CHAAT = 'Chaat – चाट', DOSA = 'Dosa – डोसा';
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'v1', name: 'Sample Chaat Stall', cat: 'Live Counter', phone: '9000000001' }, { id: 'v2', name: 'Sample Dosa Cart', cat: 'Live Counter', phone: '9000000002' },
    { id: 'v3', name: 'Sample Ice Gola', cat: 'Live Counter' }],
  events: [
    { id: 'e1', name: 'Sample Tomorrow Wedding', date: day(1), venue: 'Sample Lawns', type: 'Wedding – लग्न', billing: 300000, guests: 300, meals: ['dinner'], photoIds: [],
      mealPlan: { dinner: { guests: 300, rate: 650 } }, dishes: [{ name: 'Pani Puri', head: CHAAT, meal: 'dinner' }, { name: 'Masala Dosa', head: DOSA, meal: 'dinner' }, { name: 'Ice Gola', head: 'Kulfi / Ice Gola – कुल्फी', meal: 'dinner' }],
      orders: [{ id: 'o1', head: CHAAT, venId: 'v1', plates: 250, date: day(1), time: '19:00', status: 'sent', at: '2026-11-01T10:00:00.000Z', basis: { guests: 300, from: 'meal' } },
        { id: 'o2', head: DOSA, venId: 'v2', plates: 200, date: day(1), time: '19:30', status: 'confirmed', at: '2026-11-01T10:00:00.000Z' },
        { id: 'o3', head: 'Kulfi / Ice Gola – कुल्फी', venId: 'v3', plates: 150, date: day(1), status: 'prepared', at: '2026-11-01T10:00:00.000Z' }] },
    { id: 'e2', name: 'Sample Day After Party', date: day(2), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 80000, guests: 100, photoIds: [],
      dishes: [{ name: 'Sev Puri', head: CHAAT }],
      orders: [{ id: 'o4', head: CHAAT, venId: 'v1', plates: 100, date: day(2), time: '13:00', status: 'opened', at: '2026-11-01T10:00:00.000Z' }] },
    { id: 'e3', name: 'Sample Next Week Event', date: day(6), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 50000, guests: 80, photoIds: [],
      dishes: [{ name: 'Bhel', head: CHAAT }],
      orders: [{ id: 'o5', head: CHAAT, venId: 'v1', plates: 80, date: day(6), status: 'sent', at: '2026-11-01T10:00:00.000Z' }] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const order = async id => (await dump()).events.flatMap(e => e.orders || []).find(o => o.id === id);
  const home = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; }); };
  const acts = id => p.locator(`#deliveries .dl-acts[data-order="${id}"]`);
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);

  await test('Home lists unconfirmed orders for the next 2 days with Remind and Confirmed; confirmed deliveries stay; later ones wait', async () => {
    await home();
    const head = await p.locator('.sec', { hasText: 'Deliveries' }).innerText();
    assert.match(head, /Deliveries\s*4 · 3 to confirm/);
    const text = await p.locator('#deliveries').innerText();
    assert.match(text, /Tomorrow 19:00 · Sample Chaat Stall\nChaat · 250 plates · Sample Tomorrow Wedding/);
    assert.match(text, /Tomorrow 19:30 · Sample Dosa Cart[\s\S]*Confirmed/);
    assert.doesNotMatch(text, /Sample Next Week Event/, 'more than 2 days ahead: not yet');
    assert.match(await acts('o4').innerText(), /Remind\s*Confirmed/, 'day after tomorrow, not confirmed');
    assert.equal(await acts('o2').count(), 0, 'confirmed: nothing to do');
    assert.match(await acts('o3').innerText(), /Send order\s*Confirmed/, 'never sent: send it first');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  });

  await test('Remind opens WhatsApp with the order details asking to confirm; it is recorded; the status does not change', async () => {
    await acts('o1').locator('[data-action="order-remind"]').click(); await p.waitForTimeout(500);
    const url = await p.evaluate(() => window.__opened.at(-1)), msg = decodeURIComponent(url.split('text=')[1]);
    assert.match(url, /^https:\/\/wa\.me\/(91)?9000000001\?text=/);
    assert.match(msg, /^Namaste Sample Chaat Stall! A reminder for Sample Tomorrow Wedding:\nCounter: Chaat\nItems: Pani Puri\nQuantity: 250 plates\nDate: .* \(Dinner\)\nReady by: 7:00 PM\nVenue: Sample Lawns\nGuests: 300\n\nPlease confirm everything is on track\. Thank you!$/);
    assert.match(await p.locator('#toast-msg').innerText(), /WhatsApp opened with a reminder for Sample Chaat Stall\. Tap Confirmed when they reply/);
    const o = await order('o1');
    assert.equal(o.status, 'sent', 'a reminder is not a confirmation'); assert.equal(o.reminded.length, 1);
    await home();
    assert.match(await acts('o1').innerText(), /Reminded /);
  });

  await test('Confirmed marks the order confirmed and it leaves the to-confirm list; a vendor without a phone gets no WhatsApp', async () => {
    await acts('o1').locator('[data-action="order-confirm"]').click(); await p.waitForTimeout(500);
    assert.equal((await order('o1')).status, 'confirmed');
    await home();
    assert.equal(await acts('o1').count(), 0);
    assert.match(await p.locator('.sec', { hasText: 'Deliveries' }).innerText(), /4 · 2 to confirm/);
    await p.evaluate(() => { window.__opened = []; });
    // The Ice Gola vendor has no phone: Send opens the order on its event page instead
    await acts('o3').locator('[data-action="order-status"]').click(); await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-title').innerText(), /^Kulfi \/ Ice Gola · Sample Ice Gola – Not sent yet/); await p.locator('#ask-actions button').last().click();
    assert.equal(await p.evaluate(() => document.querySelector('.tab.active')?.id), 'tab-evdetail');
  });

  await test('the order status sheet offers "Remind to confirm" for a sent order, not for a confirmed one', async () => {
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"]:visible', { hasText: 'Sample Day After Party' }).first().click(); await p.waitForSelector('#menu-orders');
    await p.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; });
    await p.locator('#menu-orders [data-action="order-status"]').first().click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Remind to confirm' }).click(); await p.waitForTimeout(500);
    assert.match(decodeURIComponent(await p.evaluate(() => window.__opened.at(-1))), /A reminder for Sample Day After Party:[\s\S]*Items: Sev Puri/);
    assert.equal((await order('o4')).reminded.length, 1);
    await p.locator('#menu-orders [data-action="order-status"]').first().click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Vendor confirmed' }).click(); await p.waitForTimeout(400);
    await p.locator('#menu-orders [data-action="order-status"]').first().click(); await p.waitForSelector('#ask-modal.active');
    assert.equal(await p.locator('#ask-actions button', { hasText: 'Remind to confirm' }).count(), 0);
    await p.locator('#ask-actions button').last().click();
  });

  await test('backups keep reminders; malformed ones are refused', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const out = [];
      const d0 = await db.exportAllData(); delete d0.manifest;
      await db.importAllData(structuredClone(d0), 'replace');
      out.push(JSON.stringify((await db.exportAllData()).events.map(e => e.orders)) === JSON.stringify(d0.events.map(e => e.orders)) ? 'kept' : 'lost');
      const d = structuredClone(d0); d.events[0].orders[0].reminded = 'yesterday';
      try { await db.importAllData(d, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message.split('.')[0]); }
      await db.importAllData(d0, 'replace'); return out; });
    assert.deepEqual(r, ['kept', 'Invalid order']);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'vendor reminders FAIL' : 'vendor reminders PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('vendor reminders FAIL'); process.exitCode = 1; });
