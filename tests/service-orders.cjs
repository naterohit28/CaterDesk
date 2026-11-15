// Vendor orders per meal and counter (PR 6): when two meals use the same counter each gets its own order with that
// meal's dishes, date, time and guests; the message adds the meal, guests, venue notes and the approved menu version;
// a menu change flags only the orders whose own dishes changed (nothing is sent); an order from before has "all meals";
// the status sheet shows Prepared → WhatsApp opened → Sent → Confirmed → Delivered → Billed. 360px. Synthetic data.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const CHAAT = 'Chaat – चाट', TANDOOR = 'Barbeque / Tandoor – तंदूर';
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'v1', name: 'Sample Chaat Stall', cat: 'Live Counter', phone: '9000000001' }, { id: 'v2', name: 'Sample Tandoor Co', cat: 'Live Counter', phone: '9000000002' }],
  events: [
    { id: 'e1', name: 'Sample Order Wedding', date: day(12), venue: 'Sample Lawns', type: 'Wedding – लग्न', billing: 500000, guests: 400, meals: ['lunch', 'dinner'], photoIds: [],
      logistics: { gas: 'allowed', access: 'restricted', kitchen: 'available' },
      mealPlan: { lunch: { guests: 250, rate: 450 }, dinner: { guests: 300, rate: 650 } },
      services: [{ id: 'svc-lunch', meal: 'lunch', time: '12:30' }, { id: 'svc-dinner', meal: 'dinner', time: '20:00' }],
      dishes: [{ name: 'Pani Puri', head: CHAAT, meal: 'lunch' }, { name: 'Jeera Rice', head: '', meal: 'lunch' }, { name: 'Sev Puri', head: CHAAT, meal: 'dinner' }, { name: 'Paneer Tikka', head: TANDOOR, meal: 'dinner' }],
      // an order saved before orders had a meal, for a counter now used at both meals
      orders: [{ id: 'old1', head: CHAAT, venId: 'v1', plates: 500, date: day(12), status: 'confirmed', at: '2026-11-01T10:00:00.000Z' }] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const ev = async () => (await dump()).events.find(e => e.id === 'e1');
  const openEvent = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"]:visible', { hasText: 'Sample Order Wedding' }).first().click(); await p.waitForSelector('#tab-evdetail .detail-name');
    await p.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; }); };
  const row = key => p.locator(`#menu-orders [data-counter="${key}"]`);
  const lastMessage = async () => decodeURIComponent((await p.evaluate(() => window.__opened.at(-1))).split('text=')[1]);
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'), u = await import('./utils.js');
    d.events[0].menuApproved = [u.approvedVersion(d.events[0], { by: 'written' })]; await db.importAllData(d); }, DATA);

  await test('a counter used at two meals gets a row and an order for each meal; an older order is listed for all meals', async () => {
    await openEvent();
    assert.match(await row(`svc-lunch|${CHAAT}`).innerText(), /^Chaat · Lunch\nPani Puri/);
    assert.match(await row(`svc-dinner|${CHAAT}`).innerText(), /^Chaat · Dinner\nSev Puri/);
    assert.match(await row(`svc-dinner|${TANDOOR}`).innerText(), /^Barbeque \/ Tandoor · Dinner/);
    for (const k of [`svc-lunch|${CHAAT}`, `svc-dinner|${CHAAT}`]) assert.equal(await row(k).locator('[data-action="order-new"]').count(), 1, 'each meal has its own Order button');
    assert.match(await p.locator('#menu-orders [data-off-order="old1"]').innerText(), /Chaat · Sample Chaat Stall\nOlder order · all meals/);
  });

  await test('the dinner order covers dinner only: its dishes, date, time and guests; the message adds guests, venue notes and the approved menu', async () => {
    await row(`svc-dinner|${CHAAT}`).locator('[data-action="order-new"]').click(); await p.waitForSelector('#ord-modal.active');
    assert.equal(await p.locator('#ord-mtitle').innerText(), 'Chaat order · Dinner');
    assert.equal(await p.locator('#ord-items').innerText(), 'Sev Puri');
    assert.deepEqual([await p.inputValue('#ord-date'), await p.inputValue('#ord-time'), await p.inputValue('#ord-plates')], [day(12), '20:00', '300']);
    assert.match(await p.locator('#ord-plan').innerText(), /Based on 300 dinner guests; change it if needed/);
    await p.selectOption('#ord-ven', 'v1'); await p.fill('#ord-plates', '280'); await p.locator('#btn-send-ord').click(); await p.waitForTimeout(500);
    const msg = await lastMessage();
    assert.match(msg, /^Namaste Sample Chaat Stall! Order for Sample Order Wedding:\nDate: .*, 20:00 \(Dinner\)\nVenue: Sample Lawns\nChaat for 280 plates\nItems: Sev Puri\nGuests: 300\nAt the venue: Cooking at venue: Gas allowed · Parking & loading: Restricted\nMenu: version 1, approved by the client\n/);
    assert.doesNotMatch(msg, /Pani Puri|Kitchen: /, 'lunch dishes and unrelated venue details left out');
    const o = (await ev()).orders.find(x => x.svc === 'svc-dinner');
    assert.deepEqual([o.head, o.plates, o.status, o.menuVersion, o.basis], [CHAAT, 280, 'opened', (await ev()).menuApproved[0].id, { guests: 300, from: 'meal' }]);
    await openEvent();
    assert.equal(await row(`svc-lunch|${CHAAT}`).locator('[data-action="order-new"]').count(), 1, 'lunch chaat still to order');
    await row(`svc-lunch|${CHAAT}`).locator('[data-action="order-new"]').click(); await p.waitForSelector('#ord-modal.active');
    assert.deepEqual([await p.locator('#ord-items').innerText(), await p.inputValue('#ord-time'), await p.inputValue('#ord-plates')], ['Pani Puri', '12:30', '250']);
    await p.selectOption('#ord-ven', 'v1'); await p.locator('#btn-send-ord').click(); await p.waitForTimeout(500);
    assert.match(await lastMessage(), /\(Lunch\)[\s\S]*Items: Pani Puri\n/);
  });

  await test('the status sheet shows the steps; changing dinner flags only the dinner order, nothing is sent', async () => {
    await openEvent();
    await row(`svc-dinner|${CHAAT}`).locator('[data-action="order-status"]').click(); await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-title').innerText(), /^Chaat · Dinner · Sample Chaat Stall/);
    assert.equal(await p.locator('#ask-msg').innerText(), '✓ Prepared → ✓ WhatsApp opened → Sent → Confirmed → Delivered → Billed');
    await p.locator('#ask-actions button', { hasText: 'Vendor confirmed' }).click(); await p.waitForTimeout(400);
    await openEvent(); await row(`svc-lunch|${CHAAT}`).locator('[data-action="order-status"]').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Vendor confirmed' }).click(); await p.waitForTimeout(400);
    const opened = await p.evaluate(() => window.__opened.length);
    await openEvent();
    await p.locator('.svc-card[data-svc="svc-dinner"] [data-action="svc-edit"]').click(); await p.waitForSelector('#svc-modal.active');
    await p.fill('#svc-add', 'Bhel Puri'); await p.locator('#btn-svc-add').click();
    await p.locator('#svc-dishes .svc-dish').filter({ has: p.locator('input[value="Bhel Puri"]') }).locator('[data-k="head"]').selectOption(CHAAT);
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(600);
    assert.match(await p.locator('#toast-msg').innerText(), /2 orders sent earlier may need updating/, 'the dinner order and the older all-meals order');
    const e = await ev(), by = id => e.orders.find(x => x.svc === id);
    assert.deepEqual([by('svc-dinner').menuChanged, by('svc-lunch').menuChanged, e.orders.find(x => x.id === 'old1').menuChanged], [true, undefined, true],
      'dinner order and the older all-meals order flagged; lunch untouched');
    assert.equal(by('svc-dinner').status, 'confirmed'); assert.equal(await p.evaluate(() => window.__opened.length), 0, 'nothing sent');
    await openEvent();
    assert.match(await row(`svc-dinner|${CHAAT}`).innerText(), /Menu changed · resend/);
    assert.doesNotMatch(await row(`svc-lunch|${CHAAT}`).innerText(), /Menu changed/);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  });

  await test('delivered and billed are separate steps; a changed menu is not sent as the approved version', async () => {
    await row(`svc-dinner|${CHAAT}`).locator('[data-action="order-status"]').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Edit / send again' }).click(); await p.waitForSelector('#ord-modal.active');
    assert.equal(await p.locator('#ord-items').innerText(), 'Sev Puri, Bhel Puri');
    await p.locator('#btn-send-ord').click(); await p.waitForTimeout(500);
    const msg = await lastMessage();
    assert.match(msg, /Items: Sev Puri, Bhel Puri\n/); assert.doesNotMatch(msg, /Menu: version/, 'menu changed since approval: no approved version claimed');
    assert.equal((await ev()).orders.find(x => x.svc === 'svc-dinner').menuVersion, undefined);
    const steps = await p.evaluate(async () => { const e = (await (await import('./db.js')).exportAllData()).events[0]; return e.orders.map(o => [o.svc || o.id, o.status]); });
    assert.ok(steps.length >= 3);
    // delivered without a bill, then with one
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest; const e = d.events[0];
      e.orders.find(o => o.svc === 'svc-lunch').status = 'delivered'; delete e._rev; await db.importAllData(d, 'replace'); });
    await openEvent(); await row(`svc-lunch|${'Chaat – चाट'}`).locator('[data-action="order-status"]').click(); await p.waitForSelector('#ask-modal.active');
    assert.equal(await p.locator('#ask-msg').innerText(), '✓ Prepared → ✓ WhatsApp opened → ✓ Sent → ✓ Confirmed → ✓ Delivered → Billed');
    await p.locator('#ask-actions button', { hasText: 'Cancel' }).click();
  });

  await test('approval-relevant changes and the order\'s approved-version reference: veg → non-veg, re-approval, a diet mark, a kitchen-only dish', async () => {
    const TANDOOR = 'Barbeque / Tandoor – तंदूर';
    const edit = fn => p.evaluate(async src => { const db = await import('./db.js'), u = await import('./utils.js'); const d = await db.exportAllData(); delete d.manifest;
      const e = d.events.find(x => x.id === 'e9'); new Function('e', 'u', src)(e, u); delete e._rev; await db.importAllData(d, 'replace'); }, fn);
    await p.evaluate(async T => { const db = await import('./db.js'), u = await import('./utils.js'); const d = await db.exportAllData(); delete d.manifest;
      const e = { id: 'e9', name: 'Sample Single Dinner', date: new Date(Date.now() + 8 * 864e5).toISOString().slice(0, 10), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 100000, guests: 120, meals: ['dinner'], photoIds: [],
        mealPlan: { dinner: { guests: 120, rate: 600 } }, dishes: [{ name: 'Paneer Tikka', head: T, meal: 'dinner', type: 'veg' }, { name: 'Dal Makhani', head: '', meal: 'dinner' }] };
      e.menuApproved = [u.approvedVersion(e, { by: 'written', id: 'MA1-e9' })]; d.events.push(e); await db.importAllData(d, 'replace'); }, TANDOOR);
    const openE9 = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
      await p.locator('#ev-list [data-action="evdetail"]:visible', { hasText: 'Sample Single Dinner' }).first().click(); await p.waitForSelector('#menu-orders');
      await p.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; }); };
    const send = async () => { await p.waitForSelector('#ord-modal.active'); await p.selectOption('#ord-ven', 'v2'); await p.locator('#btn-send-ord').click(); await p.waitForTimeout(500); return lastMessage(); };
    const o9 = async () => (await dump()).events.find(e => e.id === 'e9').orders[0];
    const resend = async () => { await openE9(); await p.locator('#menu-orders [data-action="order-status"]').first().click(); await p.waitForSelector('#ask-modal.active');
      await p.locator('#ask-actions button', { hasText: 'Edit / send again' }).click(); return send(); };
    // 1. Unchanged since approval: the order states version 1
    await openE9(); await p.locator(`#menu-orders [data-counter="${TANDOOR}"] [data-action="order-new"]`).click();
    assert.match(await send(), /Menu: version 1, approved by the client/); assert.equal((await o9()).menuVersion, 'MA1-e9');
    // 2. Paneer Tikka becomes non-veg: the menu is no longer the approved one; a resend claims no approved version
    await edit("e.dishes.find(d => d.name === 'Paneer Tikka').type = 'nonveg';");
    assert.equal(await p.evaluate(async () => { const u = await import('./utils.js'), db = await import('./db.js'); return u.menuSinceApproved((await db.exportAllData()).events.find(e => e.id === 'e9')).count; }), 1);
    const m2 = await resend(); assert.doesNotMatch(m2, /Menu: version/); assert.equal((await o9()).menuVersion, undefined);
    // 3. Approved again as version 2: the next send states version 2
    await edit("e.menuApproved.push(u.approvedVersion(e, { by: 'verbal', who: 'Sample Client', id: 'MA2-e9' }));");
    assert.match(await resend(), /Menu: version 2, approved by the client/); assert.equal((await o9()).menuVersion, 'MA2-e9');
    // 4. A diet mark added to the vendor's dish (through the meal sheet) flags the confirmed order; nothing is sent
    await openE9(); await p.locator('#menu-orders [data-action="order-status"]').first().click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Vendor confirmed' }).click(); await p.waitForTimeout(400);
    await openE9(); await p.locator('.svc-card [data-action="svc-edit"]').click(); await p.waitForSelector('#svc-modal.active');
    const dish = p.locator('#svc-dishes .svc-dish').filter({ has: p.locator('input[value="Paneer Tikka"]') });
    await dish.locator('[data-diet-toggle]').click(); await p.locator('#svc-dishes .svc-dish').filter({ has: p.locator('input[value="Paneer Tikka"]') }).locator('[data-diet="nut_free"]').click();
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(600);
    let o = await o9(); assert.equal(o.menuChanged, true, 'diet change on the vendor\'s dish flags the order'); assert.equal(o.status, 'confirmed');
    assert.equal(await p.evaluate(() => window.__opened.length), 0, 'nothing sent');
    // 5. A kitchen-only dish changes: the vendor's order is not flagged, but no approved version is claimed any more
    await resend(); await openE9(); await p.locator('#menu-orders [data-action="order-status"]').first().click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Vendor confirmed' }).click(); await p.waitForTimeout(400);
    await openE9(); await p.locator('.svc-card [data-action="svc-edit"]').click(); await p.waitForSelector('#svc-modal.active');
    await p.fill('#svc-add', 'Jeera Rice'); await p.locator('#btn-svc-add').click(); await p.locator('#btn-save-svc').click(); await p.waitForTimeout(600);
    o = await o9(); assert.equal(o.menuChanged, undefined, 'kitchen dish: the Tandoor order is not flagged');
    assert.doesNotMatch(await resend(), /Menu: version/, 'but the menu is no longer the approved one');
  });

  await test('backups keep an order\'s meal, menu version and guests; malformed ones are refused', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const out = [];
      const d0 = await db.exportAllData(); delete d0.manifest;
      await db.importAllData(structuredClone(d0), 'replace');
      out.push(JSON.stringify((await db.exportAllData()).events[0].orders) === JSON.stringify(d0.events[0].orders) ? 'kept' : 'lost');
      for (const bad of [o => { o.svc = 5; }, o => { o.basis = { guests: -1, from: 'meal' }; }, o => { o.basis = { guests: 10, from: 'guess' }; }, o => { o.menuVersion = 7; }]) {
        const d = structuredClone(d0); bad(d.events[0].orders[1]);
        try { await db.importAllData(d, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message.split('.')[0]); } }
      await db.importAllData(d0, 'replace'); return out; });
    assert.deepEqual(r, ['kept', ...Array(4).fill('Invalid order')]);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'orders per meal FAIL' : 'orders per meal PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('orders per meal FAIL'); process.exitCode = 1; });
