// Owner's full-event test on v4.31.13 (checks 3, 4, 6–8): a payment plan in % without a % key, a labelled date, meal
// dishes typed but not added are never dropped by Save, an order can be saved without sending, typed plates stay the
// owner's, and WhatsApp opens inside the tap (before the save is awaited). Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'vd', name: 'Sample Dosa Counter', cat: 'Live Counter', phone: '9999999999' }, { id: 'vs', name: 'Sample Sweet Shop', cat: 'Raw Material', phone: '9999999998' }],
  events: [{ id: 'E1', name: 'Sample Full Event', date: day(7), venue: 'Sample Hall', type: 'Wedding – लग्न', guests: 300, billing: 225000,
    mealPlan: { dinner: { guests: 300, rate: 750 } }, meals: ['dinner'], photoIds: [] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const ev = () => p.evaluate(async () => (await (await import('./db.js')).exportAllData()).events.find(e => e.id === 'E1'));
  const openEvent = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="E1"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name'); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  // Record every WhatsApp window and whether the order or purchase was already saved when it opened
  await p.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });

  await test('payment plan: ₹ or % chosen beside the amount (no % key needed); date and days fields are labelled', async () => {
    await openEvent();
    await p.locator('[data-action="plan-edit"]').click();
    const r0 = p.locator('[data-pm="0"]');
    await r0.locator('[data-k="unit"]').selectOption('pct');
    await p.locator('[data-pm="0"] [data-k="amt"]').fill('25');
    assert.equal(await p.locator('[data-pm="0"] label').first().innerText(), '% of the bill');
    await p.locator('#btn-plan-add').click();
    await p.locator('[data-pm="1"] [data-k="amt"]').fill('50');
    await p.locator('[data-pm="1"] [data-k="unit"]').selectOption('pct');
    assert.equal(await p.locator('[data-pm="1"] [data-k="amt"]').inputValue(), '50', 'the typed amount survives changing the unit');
    await p.locator('[data-pm="1"] [data-k="when"]').selectOption('before');
    assert.equal(await p.locator('[data-pm="1"] [data-k="amt"]').inputValue(), '50', 'and changing when it is due');
    assert.equal(await p.locator('label[for="pm-days-1"]').innerText(), 'Days before the event');
    await p.locator('[data-pm="1"] [data-k="days"]').fill('7');
    await p.locator('#btn-plan-add').click();
    await p.locator('[data-pm="2"] [data-k="when"]').selectOption('date');
    assert.match(await p.locator('label[for="pm-date-2"]').innerText(), /Due date – tap to pick/);
    assert.equal(await p.locator('#pm-date-2').getAttribute('type'), 'date');
    await p.locator('[data-pm-del="2"]').click();
    assert.match(await p.locator('#plan-sum').innerText(), /scheduled ₹1,68,750 · ₹56,250 left as balance/);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await p.locator('#btn-save-plan').click(); await p.waitForTimeout(400);
    assert.deepEqual((await ev()).payPlan.map(m => [m.when, m.pct, m.days]), [['booking', 25, undefined], ['before', 50, 7]]);
    // "25%" typed with the ₹ unit still means 25 percent
    await p.locator('[data-action="plan-edit"]').click();
    await p.locator('[data-pm="0"] [data-k="unit"]').selectOption('amt');
    await p.locator('[data-pm="0"] [data-k="amt"]').fill('20%');
    await p.locator('#btn-save-plan').click(); await p.waitForTimeout(400);
    assert.equal((await ev()).payPlan[0].pct, 20);
  });

  await test('meal menu: dishes typed but not added are added (not dropped) when Save is tapped; the next Save keeps them', async () => {
    await openEvent();
    await p.locator('[data-action="svc-edit"]').first().click();
    await p.locator('#svc-add').fill('Paneer Butter Masala, Dal Tadka, Masala Dosa');
    await p.locator('#btn-save-svc').click();
    assert.equal(await p.locator('#svc-modal').isVisible(), true, 'the sheet stays open to check kitchen or counter');
    assert.ok((await p.evaluate(() => [...document.querySelectorAll('#svc-modal input')].map(i => i.value))).includes('Masala Dosa'), 'listed for review');
    assert.equal((await ev()).dishes?.length || 0, 0, 'nothing saved yet');
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(500);
    assert.deepEqual((await ev()).dishes.map(d => d.name), ['Paneer Butter Masala', 'Dal Tadka', 'Masala Dosa']);
  });

  await test('vendor order: typed plates stay; Save order keeps it unsent; Send on WhatsApp from its status opens it in the tap', async () => {
    // Masala Dosa served from the dosa counter (in the app this is chosen per dish on the meal sheet)
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const { _rev, ...e } = d.events.find(x => x.id === 'E1');
      await db.putOne('events', { ...e, dishes: e.dishes.map(x => x.name === 'Masala Dosa' ? { ...x, head: 'Dosa – डोसा' } : x) }); });
    await openEvent();
    await p.locator('[data-action="order-new"][data-id^="Dosa"]').click();
    await p.locator('#ord-ven').selectOption('vd');
    await p.locator('#ord-takeup').fill('70'); await p.locator('#ord-min').fill('250');
    assert.equal(await p.locator('#ord-plates').inputValue(), '250', '70% of 300 = 210, lifted to the minimum');
    await p.locator('#ord-plates').fill('');
    assert.equal(await p.locator('#ord-plates').inputValue(), '', 'emptying the box to retype is not refilled');
    await p.locator('#ord-plates').fill('260');
    await p.locator('#ord-takeup').fill('75');
    assert.equal(await p.locator('#ord-plates').inputValue(), '260', 'a typed count is never replaced by the plan');
    await p.locator('#btn-save-ord').click(); await p.waitForTimeout(500);
    let o = (await ev()).orders[0];
    assert.deepEqual([o.status, o.plates, o.messages.length], ['prepared', 260, 1]);
    assert.deepEqual(await p.evaluate(() => window.__opened.length), 0, 'Save order opens nothing');
    await p.locator(`[data-action="order-status"][data-id="${o.id}"]`).click();
    await p.getByRole('button', { name: /^Send on WhatsApp/ }).click(); await p.waitForTimeout(400);
    assert.match(await p.evaluate(() => window.__opened[0]), /^https:\/\/wa\.me\/919999999999\?text=Namaste%20Sample%20Dosa%20Counter/);
    o = (await ev()).orders[0];
    assert.deepEqual([o.status, o.messages.at(-1).status], ['opened', 'opened'], 'opened, not sent, until you mark it sent');
  });

  await test('Send on WhatsApp from the order sheet opens WhatsApp before the save is awaited', async () => {
    await openEvent();
    const o = (await ev()).orders[0];
    await p.locator(`[data-action="order-status"][data-id="${o.id}"]`).click();
    await p.getByRole('button', { name: /^Edit \/ send again/ }).click();
    await p.locator('#ord-notes').fill('setup by 6 pm');
    // window.event is the tap only while its handler runs synchronously: after any await it is gone
    await p.evaluate(() => { window.__opened = []; window.__inTap = []; window.open = u => { window.__opened.push(u); window.__inTap.push(window.event?.type === 'click'); return null; }; });
    await p.locator('#btn-send-ord').click(); await p.waitForTimeout(600);
    assert.deepEqual(await p.evaluate(() => window.__inTap), [true], 'WhatsApp opened inside the tap');
    assert.match(await p.evaluate(() => decodeURIComponent(window.__opened[0])), /Note: setup by 6 pm/);
    assert.equal((await ev()).orders[0].notes, 'setup by 6 pm');
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'full-event-fixes FAIL' : 'full-event test fixes (plan %, meal dishes, orders) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('full-event-fixes FAIL'); process.exitCode = 1; });
