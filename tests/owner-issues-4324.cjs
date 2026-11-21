// Owner (4.31.24): 1 — labour lines with people but no rate were dropped on save: they are kept, with no expense until
// a rate or the contractor's bill is added, and a blank rate never deletes an earlier expense; 2 — a vendor order had no
// cost until its bill: an optional price saves it at once as an expense to pay that vendor; 3 — part of a dish from a
// vendor with the rest made by us, and dishes cooked at the venue; 4 — back from a phone call, the field being typed in
// keeps the cursor. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const COOK = 'Cook – आचारी', HELPER = 'Helper – मदतनीस';
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'vc', name: 'Sample Chaat Counter', cat: 'Live Counter', specialty: 'Chaat – चाट', phone: '9000000002' }],
  events: [{ id: 'E1', name: 'Sample Owner Event', date: day(6), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 160000, photoIds: [],
    meals: ['dinner'], mealPlan: { dinner: { guests: 200, rate: 800 } },
    dishes: [{ name: 'Pani Puri', head: 'Chaat – चाट', meal: 'dinner' }, { name: 'Paneer Tikka', meal: 'dinner' }, { name: 'Dal Tadka', meal: 'dinner' }],
    labour: { pay: 'paid', mode: 'Cash', rows: [{ id: 'L1', role: COOK, rate: 0, counts: { e: 3 } }, { id: 'L2', role: HELPER, rate: 500, counts: { e: 2 } }], expIds: {} } }] };
const pickTime = async (p, id) => { await p.fill(`#${id}-t`, '7:30'); await p.locator(`#${id}-pm`).click(); };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const ev = async () => (await dump()).events.find(e => e.id === 'E1');
  const openEvent = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="E1"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  const saveLabour = async (fill = async () => {}) => { await openEvent(); await p.locator('[data-action="lab-edit"]').click(); await p.waitForSelector('#lab-modal.active');
    await fill(); await p.locator('#btn-save-lab').click(); await p.waitForTimeout(600); };
  const labourExp = async () => (await dump()).expenses.filter(x => x.evId === 'E1' && /Labour sheet/.test(x.notes || ''));
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d, 'replace'); }, DATA);

  await test('1: a labour line with no rate is kept on the sheet; only the priced line is an expense; the card says the rate is missing', async () => {
    await saveLabour();
    assert.match(await p.locator('#toast-msg').innerText(), /No rate yet for Cook/);
    assert.deepEqual((await ev()).labour.rows.map(r => [r.role, r.rate, r.counts.e]), [[COOK, 0, 3], [HELPER, 500, 2]]);
    assert.deepEqual((await labourExp()).map(x => [x.head, x.amt]), [[HELPER, 1000]]);
    await openEvent();
    assert.equal(await p.locator('#labour-card [data-no-rate]').count(), 1);
    assert.doesNotMatch(await p.locator('#labour-card').innerText(), /₹0/);
  });

  await test('1: no rates at all but a contractor\'s bill: the bill is saved as the expense', async () => {
    await saveLabour(async () => { await p.locator('[data-lab="1"] [data-k="rate"]').fill(''); await p.fill('#lab-bill', '5000'); await p.locator('#lab-bill').dispatchEvent('input'); });
    const xs = await labourExp();
    assert.equal(xs.length, 1); assert.equal(xs[0].amt, 5000);
    assert.equal((await ev()).labour.rows.length, 2, 'both lines kept');
  });

  await test('1: no rates and no bill: the sheet is kept, nothing is called cleared, and an earlier amount is not deleted for a blank rate', async () => {
    await saveLabour(async () => { await p.locator('[data-lab="1"] [data-k="rate"]').fill('600'); await p.fill('#lab-bill', ''); await p.locator('#lab-bill').dispatchEvent('input'); });
    assert.deepEqual((await labourExp()).map(x => [x.head, x.amt]), [[HELPER, 1200]]);
    await saveLabour(async () => { await p.locator('[data-lab="1"] [data-k="rate"]').fill(''); });
    assert.match(await p.locator('#toast-msg').innerText(), /Labour sheet saved\. No rate yet for Cook, Helper/);
    assert.equal((await ev()).labour.rows.length, 2);
    assert.deepEqual((await labourExp()).map(x => [x.head, x.amt]), [[HELPER, 1200]], 'the earlier Helper amount stays');
  });

  await test('1: labour is ordered by heads per shift: a new worker line or a copied sheet gets no rate (it comes with the bill); the last rate is only a hint', async () => {
    await openEvent(); await p.locator('[data-action="lab-edit"]').click(); await p.waitForSelector('#lab-modal.active');
    await p.locator('#btn-lab-add').click(); await p.waitForTimeout(200);
    const row = p.locator('[data-lab]').last();
    await row.locator('[data-k="role"]').selectOption('Boys – बॉईज'); await p.waitForTimeout(150);
    assert.equal(await row.locator('[data-k="rate"]').inputValue(), '', 'no rate filled in');
    assert.equal(await row.locator('[data-k="rate"]').getAttribute('placeholder'), 'From the bill', 'no earlier rate: the box says the rate comes from the bill');   // a remembered rate shows as "Last time ₹…" (regression.cjs)
    await p.locator('#lab-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(300);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
  });

  await test('2: an order with a price is saved as an expense to pay its vendor; a new price updates it; the real bill is kept', async () => {
    await openEvent();
    await p.locator('[data-action="order-new"][data-id^="Chaat"]').click(); await p.waitForSelector('#ord-modal.active');
    await p.selectOption('#ord-ven', 'vc'); await p.fill('#ord-plates', '80'); await pickTime(p, 'ord-time'); await p.fill('#ord-price', '12000');
    await p.locator('#btn-save-ord').click(); await p.waitForTimeout(700);
    assert.match(await p.locator('#toast-msg').innerText(), /₹12,000 saved as an expense to pay Sample Chaat Counter/);
    let d = await dump(); const o = d.events[0].orders[0];
    assert.equal(o.price, 12000);
    let x = d.expenses.find(e => e.order === o.id);
    assert.deepEqual([x.amt, x.pay, x.venId, x.cat, x.head, x.fromOrder], [12000, 'credit', 'vc', 'Live Counter', 'Chaat – चाट', true]);
    await openEvent(); await p.locator('#menu-orders [data-action="order-status"]').first().click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Edit / send again' }).click(); await p.waitForSelector('#ord-modal.active');
    assert.equal(await p.inputValue('#ord-price'), '12000');
    await p.fill('#ord-price', '13500'); await p.locator('#btn-save-ord').click(); await p.waitForTimeout(700);
    d = await dump(); x = d.expenses.filter(e => e.order === o.id);
    assert.deepEqual(x.map(e => e.amt), [13500], 'the same expense, updated');
    // The bill came in at a different amount: the order never overwrites it again
    await p.evaluate(async id => { const db = await import('./db.js'); const all = await db.getAll('expenses'); const e = all.find(r => r.order === id); await db.putOne('expenses', { ...e, amt: 14000 }); }, o.id);
    await openEvent(); await p.locator('#menu-orders [data-action="order-status"]').first().click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Edit / send again' }).click(); await p.waitForSelector('#ord-modal.active');
    await p.fill('#ord-price', '9000'); await p.locator('#btn-save-ord').click(); await p.waitForTimeout(700);
    assert.deepEqual((await dump()).expenses.filter(e => e.order === o.id).map(e => e.amt), [14000]);
  });

  await test('2: an order without a price records no expense and says so; cancelling a priced order removes its price', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest;
      d.events[0].orders = []; d.expenses = d.expenses.filter(e => !e.order); await db.importAllData(d, 'replace'); });
    await openEvent();
    await p.locator('[data-action="order-new"][data-id^="Chaat"]').click(); await p.waitForSelector('#ord-modal.active');
    await p.selectOption('#ord-ven', 'vc'); await p.fill('#ord-plates', '80'); await pickTime(p, 'ord-time');
    await p.locator('#btn-save-ord').click(); await p.waitForTimeout(700);
    assert.match(await p.locator('#toast-msg').innerText(), /No price yet: the cost is added when you record its bill/);
    assert.equal((await dump()).expenses.filter(e => e.order).length, 0);
    await openEvent(); await p.locator('#menu-orders [data-action="order-status"]').first().click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Edit / send again' }).click(); await p.waitForSelector('#ord-modal.active');
    await p.fill('#ord-price', '8000'); await p.locator('#btn-save-ord').click(); await p.waitForTimeout(700);
    assert.equal((await dump()).expenses.filter(e => e.order).length, 1);
    await openEvent(); await p.locator('#menu-orders [data-action="order-status"]').first().click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Cancel order' }).click(); await p.waitForTimeout(700);
    assert.equal((await dump()).expenses.filter(e => e.order).length, 0, 'the cancelled order costs nothing');
  });

  await test('3: part of a dish from a vendor, the rest from our kitchen; a dish cooked at the venue', async () => {
    await openEvent();
    await p.locator('[data-action="dish-assign"]', { hasText: 'Paneer Tikka' }).click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Only part from outside' }).click(); await p.waitForTimeout(300);
    await p.locator('#ask-actions button', { hasText: 'Chaat' }).click(); await p.waitForTimeout(300);
    await p.locator('#ask-actions button', { hasText: 'In our kitchen' }).click(); await p.waitForTimeout(600);
    await openEvent();
    await p.locator('[data-action="dish-assign"]', { hasText: 'Dal Tadka' }).click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'We cook it at the venue' }).click(); await p.waitForTimeout(600);
    const dishes = (await ev()).dishes;
    assert.deepEqual(dishes.find(d => d.name === 'Paneer Tikka'), { name: 'Paneer Tikka', meal: 'dinner', head: 'Chaat – चाट', part: true, manual: true });
    assert.equal(dishes.find(d => d.name === 'Dal Tadka').at, 'venue');
    await openEvent();
    const text = await p.locator('#menu-orders').innerText();
    assert.match(text, /Our kitchen\s*Paneer Tikka \(rest\), Dal Tadka · at venue/);
    assert.match(text, /Pani Puri, Paneer Tikka/, 'the vendor gets it on the Chaat order');
    // Back to all from the kitchen clears both marks
    await p.locator('[data-action="dish-assign"]', { hasText: 'Paneer Tikka' }).click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Our kitchen' }).first().click(); await p.waitForTimeout(600);
    assert.equal((await ev()).dishes.find(d => d.name === 'Paneer Tikka').part, undefined);
    // Backups refuse a malformed mark
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest; d.events[0].dishes[0].part = 'half';
      try { await db.importAllData(d, 'replace'); return 'accepted'; } catch (e) { return e.message; } });
    assert.match(r, /Invalid menu/);
  });

  await test('3: one event with 4 ready-made, 3 bought-and-finished and 5 outsourced items: each is listed where it belongs', async () => {
    const B = n => ({ name: n, src: 'buy', meal: 'dinner' }), F = n => ({ name: n, src: 'finish', meal: 'dinner' }), C = (n, h) => ({ name: n, head: h, meal: 'dinner' });
    await p.evaluate(async dishes => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest; d.events[0].dishes = dishes; d.events[0].orders = []; d.events[0].purchases = [];
      d.expenses = d.expenses.filter(e => !e.order); await db.importAllData(d, 'replace'); },
      [B('Gulab Jamun'), B('Rasmalai'), B('Papad'), B('Ice Cream'), F('Spring Rolls'), F('Samosa'), F('Paneer Cubes'),
       C('Pani Puri', 'Chaat – चाट'), C('Sev Puri', 'Chaat – चाट'), C('Masala Dosa', 'Dosa – डोसा'), C('Jalebi', 'Dessert Counter'), C('Pasta', 'Pizza / Italian Counter'), { name: 'Dal Tadka', meal: 'dinner' }]);
    await openEvent();
    const buy = await p.locator('#buy-list').innerText(), menu = await p.locator('#menu-orders').innerText();
    for (const n of ['Gulab Jamun', 'Rasmalai', 'Papad', 'Ice Cream', 'Spring Rolls', 'Samosa', 'Paneer Cubes']) assert.match(buy, new RegExp(n), n + ' under To buy');
    assert.equal((buy.match(/Buy & finish/g) || []).length >= 3 || /finish/i.test(buy), true, 'bought-and-finished are marked');
    assert.match(menu, /Pani Puri, Sev Puri/); assert.match(menu, /Masala Dosa/); assert.match(menu, /Jalebi/); assert.match(menu, /Pasta/);
    assert.match(menu, /Our kitchen[\s\S]*Dal Tadka/);
    assert.equal(await p.locator('#menu-orders [data-action="order-new"]').count(), 4, 'one order to send per outsourced counter');
  });

  await test('4: back from a phone call in the middle of an entry, the field being typed in keeps the cursor', async () => {
    await p.reload(); await p.waitForSelector('#kpi .card');
    await p.locator('[data-action="quick"][data-id="expense"]').first().click(); await p.waitForSelector('#exp-modal.active');
    await p.locator('#exp-notes').click(); await p.keyboard.type('Half typed');
    await p.evaluate(() => { document.activeElement.blur(); window.dispatchEvent(new Event('blur'));
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
    await p.waitForTimeout(400);
    assert.equal(await p.evaluate(() => document.activeElement.id), 'exp-notes');
    assert.equal(await p.inputValue('#exp-notes'), 'Half typed');
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'owner-issues-4324 FAIL' : 'owner issues 4.31.24: labour without rate, order price, part from a vendor, call interruption PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('owner-issues-4324 FAIL'); process.exitCode = 1; });
