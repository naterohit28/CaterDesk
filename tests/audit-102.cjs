// Independent audit of PR #102 (4.31.24), F-01 to F-07: an order's price is an estimate, never its bill, until the bill is
// recorded; the order and its price are saved together; a recorded or paid bill is never changed or removed by its
// order; "at the venue" is kept by the meal editor; a cleared labour rate's earlier amount shows on the card; a dish
// becoming part from its counter flags the order; prices take whole paise only. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const CHAAT = 'Chaat – चाट', BOYS = 'Boys – बॉईज', GHATI = 'Ghati – घाटी';
const DATA = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'vc', name: 'Sample Chaat Counter', cat: 'Live Counter', specialty: CHAAT, phone: '9000000002' }],
  events: [{ id: 'E1', name: 'Sample Audit Event', date: day(6), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 160000, photoIds: [],
    meals: ['dinner'], mealPlan: { dinner: { guests: 200, rate: 800 } },
    dishes: [{ name: 'Pani Puri', head: CHAAT, meal: 'dinner' }, { name: 'Sev Puri', head: CHAAT, meal: 'dinner' }, { name: 'Dal Tadka', meal: 'dinner' }] }] });
const pickTime = async (p, id) => { await p.fill(`#${id}-t`, '7:30'); await p.locator(`#${id}-pm`).click(); };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const reset = d => p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d, 'replace'); }, d);
  const openEvent = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="E1"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  const orderSheet = async () => { await openEvent(); const st = p.locator('#menu-orders [data-action="order-status"]');
    if (await st.count()) { await st.first().click(); await p.waitForSelector('#ask-modal.active'); await p.locator('#ask-actions button', { hasText: 'Edit / send again' }).click(); }
    else await p.locator('[data-action="order-new"][data-id^="Chaat"]').click();
    await p.waitForSelector('#ord-modal.active'); };
  const newPricedOrder = async price => { await orderSheet(); await p.selectOption('#ord-ven', 'vc'); await p.fill('#ord-plates', '80'); await pickTime(p, 'ord-time');
    await p.fill('#ord-price', price); await p.locator('#btn-save-ord').click(); await p.waitForTimeout(700); };
  const statusAction = async label => { await openEvent(); await p.locator('#menu-orders [data-action="order-status"]').first().click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: label }).click(); await p.waitForTimeout(700); };
  const orderExp = async () => (await dump()).expenses.filter(x => x.order);
  const unbilled = () => p.evaluate(async () => { const [u, db] = [await import('./utils.js'), await import('./db.js')]; const d = await db.exportAllData();
    return u.deliveredWithoutBill(d.events[0], d.expenses).map(o => o.id); });
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');

  await test('F-01: a delivered order with only its price still needs its bill; recording the bill confirms it', async () => {
    await reset(DATA()); await newPricedOrder('12000');
    await statusAction('Delivered');
    if (await p.locator('#exp-modal.active').count()) await p.locator('#exp-modal [data-action="close-modal"]').first().click();
    const o = (await dump()).events[0].orders[0];
    assert.deepEqual(await unbilled(), [o.id], 'the order price is not its bill: the event is not ready to close');
    await openEvent();
    assert.match(await p.locator('#menu-orders').innerText(), /bill not in \(order price only\)/);
    await statusAction('Record / link its bill'); await p.waitForSelector('#exp-modal.active');
    assert.equal(await p.inputValue('#exp-amt'), '12000');
    await p.fill('#exp-amt', '12500'); await p.locator('#btn-save-exp').click(); await p.waitForTimeout(700);
    const x = await orderExp();
    assert.deepEqual(x.map(e => [e.amt, e.fromOrder]), [[12500, undefined]], 'the same expense, now the bill');
    assert.deepEqual(await unbilled(), []);
  });

  await test('F-02: the order and its price are saved together: when the price cannot be saved, the order is not changed either; a retry then saves both', async () => {
    await reset(DATA()); await newPricedOrder('12000');
    await orderSheet(); await p.fill('#ord-price', '13500');
    // Someone else changed the price expense meanwhile (another tab): this save must fail as a whole
    await p.evaluate(async () => { const db = await import('./db.js'); const x = (await db.getAll('expenses')).find(e => e.order); await db.putOne('expenses', { ...x, notes: 'changed elsewhere' }); });
    await p.locator('#btn-save-ord').click(); await p.waitForTimeout(700);
    let d = await dump();
    assert.equal(d.events[0].orders[0].price, 12000, 'order unchanged'); assert.equal(d.expenses.find(e => e.order).amt, 12000, 'price unchanged');
    await newPricedOrder('13500');
    d = await dump();
    assert.equal(d.events[0].orders[0].price, 13500); assert.deepEqual(d.expenses.filter(e => e.order).map(e => [e.amt, e.fromOrder]), [[13500, true]]);
  });

  await test('F-03: a recorded bill (same amount), a paid one, or one with a bill number is never changed or removed by editing or cancelling its order', async () => {
    for (const make of ['recorded', 'paid', 'billNo']) {
      await reset(DATA()); await newPricedOrder('12000');
      if (make === 'recorded') { await statusAction('Delivered'); if (!(await p.locator('#exp-modal.active').count())) { await statusAction('Record / link its bill'); }
        await p.waitForSelector('#exp-modal.active'); await p.locator('#btn-save-exp').click(); await p.waitForTimeout(700); }
      else await p.evaluate(async k => { const db = await import('./db.js'); const x = (await db.getAll('expenses')).find(e => e.order);
        await db.putOne('expenses', k === 'paid' ? { ...x, pay: 'paid', mode: 'UPI' } : { ...x, billNo: 'B-77' }); }, make);
      const before = (await orderExp()).map(e => [e.id, e.amt]);
      if (make !== 'recorded') { await orderSheet(); await p.fill('#ord-price', ''); await p.locator('#btn-save-ord').click(); await p.waitForTimeout(700);
        assert.deepEqual((await orderExp()).map(e => [e.id, e.amt]), before, make + ': clearing the price keeps it'); }
      await orderSheet(); await p.locator('#btn-cancel-ord').click(); await p.waitForTimeout(700);
      assert.deepEqual((await orderExp()).map(e => [e.id, e.amt]), before, make + ': cancelling the order keeps it');
    }
  });

  await test('F-03: cancelling from the status sheet removes only the order price, in the same step', async () => {
    await reset(DATA()); await newPricedOrder('8000');
    await statusAction('Cancel order');
    const d = await dump();
    assert.equal(d.events[0].orders[0].status, 'cancelled'); assert.equal(d.expenses.filter(e => e.order).length, 0);
  });

  await test('F-04: "We cook it at the venue" chosen in the meal editor is saved', async () => {
    await reset(DATA()); await openEvent();
    await p.locator('[data-action="svc-edit"]').first().click(); await p.waitForSelector('#svc-modal.active');
    const dal = p.locator('#svc-dishes .svc-dish').filter({ has: p.locator('input[data-k="name"][value="Dal Tadka"]') });
    await dal.locator('[data-k="head"]').selectOption('@venue');
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(700);
    assert.equal((await dump()).events[0].dishes.find(d => d.name === 'Dal Tadka').at, 'venue');
    await openEvent(); assert.match(await p.locator('#menu-orders').innerText(), /Dal Tadka · at venue/);
  });

  await test('F-05: a cleared labour rate keeps its earlier amount, and the card shows and counts it', async () => {
    const d = DATA(); d.events[0].labour = { pay: 'paid', mode: 'Cash', rows: [{ id: 'L1', role: BOYS, rate: 500, counts: { e: 3 } }, { id: 'L2', role: GHATI, rate: 500, counts: { e: 2 } }], expIds: {} };
    await reset(d); await openEvent(); await p.locator('[data-action="lab-edit"]').click(); await p.waitForSelector('#lab-modal.active');
    await p.locator('#btn-save-lab').click(); await p.waitForTimeout(600);
    await openEvent(); await p.locator('[data-action="lab-edit"]').click(); await p.waitForSelector('#lab-modal.active');
    await p.locator('[data-lab="0"] [data-k="rate"]').fill(''); await p.locator('#btn-save-lab').click(); await p.waitForTimeout(600);
    assert.match(await p.locator('#toast-msg').innerText(), /Labour ₹2,500 saved\. Boys: rate cleared, earlier amount still counted/);
    const counted = (await dump()).expenses.filter(x => x.cat === 'Labour').reduce((s, x) => s + x.amt, 0);
    await openEvent(); const card = await p.locator('#labour-card').innerText();
    assert.equal(counted, 2500);
    assert.match(card, /Rate not set · earlier amount still counted\s*₹1,500/); assert.match(card, /Total · 5 shifts\s*₹2,500/);
  });

  await test('F-06: a dish on a sent order becoming only part from that counter flags the order; nothing is sent or rewritten', async () => {
    await reset(DATA()); await newPricedOrder('');
    await statusAction('Vendor confirmed');
    await openEvent(); await p.locator('[data-action="dish-assign"]', { hasText: 'Sev Puri' }).click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Only part from outside' }).click(); await p.waitForTimeout(300);
    await p.locator('#ask-actions button', { hasText: 'Chaat' }).click(); await p.waitForTimeout(300);
    await p.locator('#ask-actions button', { hasText: 'In our kitchen' }).click(); await p.waitForTimeout(600);
    const o = (await dump()).events[0].orders[0];
    assert.equal(o.menuChanged, true); assert.equal(o.status, 'confirmed'); assert.equal(o.plates, 80);
  });

  await test('F-07: an order price with more than 2 decimals is refused, not rounded', async () => {
    await reset(DATA()); await orderSheet(); await p.selectOption('#ord-ven', 'vc'); await p.fill('#ord-plates', '80'); await pickTime(p, 'ord-time');
    await p.fill('#ord-price', '125.555'); await p.locator('#btn-save-ord').click(); await p.waitForTimeout(400);
    assert.equal(await p.locator('#ord-modal.active').count(), 1, 'the sheet stays open');
    assert.equal((await dump()).events[0].orders?.length || 0, 0, 'nothing saved');
    await p.fill('#ord-price', '125.50'); await p.locator('#btn-save-ord').click(); await p.waitForTimeout(700);
    assert.equal((await orderExp())[0].amt, 125.5);
  });

  await test('backups refuse a malformed order-price mark', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest; d.expenses[0].order = undefined;
      try { await db.importAllData(d, 'replace'); return 'accepted'; } catch (e) { return e.message; } });
    assert.match(r, /Invalid order price/);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'audit-102 FAIL' : 'audit of #102: order price is an estimate, saved with its order; bills kept; venue mark; labour kept amount; part flags order; paise PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('audit-102 FAIL'); process.exitCode = 1; });
