// Independent pre-v5 audit (4.31.16): A — a vendor order is saved only with a whole number of plates (1 or more) and a
// real delivery date; B — a delivered purchase without its bill stops reconciliation like a delivered order does;
// C — two delivered orders from one vendor need two bills: one vendor bill no longer covers every order from that
// vendor. Older unlinked bills still count, one bill per delivered item. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'vd', name: 'Sample Dosa Counter', cat: 'Live Counter', phone: '9999999999' }],
  events: [{ id: 'E1', name: 'Sample Order Event', date: day(7), venue: 'Sample Hall', type: 'Wedding – लग्न', guests: 200, billing: 160000,
    mealPlan: { dinner: { guests: 200, rate: 800 } }, meals: ['dinner'], photoIds: [], dishes: [{ name: 'Masala Dosa', head: 'Dosa – डोसा', meal: 'dinner' }] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const orders = () => p.evaluate(async () => (await (await import('./db.js')).exportAllData()).events.find(e => e.id === 'E1').orders || []);
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  await p.addInitScript(() => { window.open = () => ({}); });
  await p.reload(); await p.waitForSelector('#kpi .card');

  await test('A: an order is refused with blank, zero, negative or fractional plates, or no date; a whole number saves', async () => {
    await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="E1"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    await p.locator('[data-action="order-new"][data-id^="Dosa"]').click();
    await p.locator('#ord-ven').selectOption('vd');
    for (const bad of ['', '0', '-5', '12.5']) {
      await p.locator('#ord-plates').fill(bad);
      await p.locator('#btn-save-ord').click(); await p.waitForTimeout(300);
      assert.equal(await p.locator('#ord-plates').getAttribute('aria-invalid'), 'true', `"${bad}" is marked`);
      assert.match(await p.locator('#ord-modal').innerText(), /Plates: a whole number, 1 or more/, `"${bad}" explains why`);
      assert.equal((await orders()).length, 0, `"${bad}" saves nothing`);
    }
    await p.locator('#ord-plates').fill('150');
    await p.locator('#ord-date').fill('');
    await p.locator('#btn-save-ord').click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#ord-modal').innerText(), /Choose the delivery date/);
    assert.equal((await orders()).length, 0, 'no date saves nothing');
    await p.locator('#ord-date').fill(day(7));
    await p.locator('#btn-save-ord').click(); await p.waitForTimeout(500);
    const o = await orders();
    assert.deepEqual(o.map(x => [x.plates, x.date, x.status]), [[150, day(7), 'prepared']]);
  });

  // The reconciliation rules, run in the app's own module on synthetic records
  const check = cases => p.evaluate(async cases => { const u = await import('./utils.js');
    return cases.map(({ ev, expenses }) => ({ missing: u.deliveredWithoutBill(ev, expenses).map(o => o.id), blockers: u.reconBlockers(ev, expenses).map(b => b.en) })); }, cases);
  const PAST = { id: 'P1', name: 'Sample Past Event', date: day(-2), venue: 'Sample Hall', guests: 100, billing: 60000, photoIds: [] };
  const bill = (id, extra) => ({ id, evId: 'P1', cat: 'Live Counter', head: 'Dosa counter', amt: 9000, date: day(-2), pay: 'credit', billIds: [], venId: 'vd', ...extra });

  await test('B: a delivered purchase without its bill is listed and blocks reconciliation; its linked bill clears it', async () => {
    const buy = { id: 'PO1', item: 'Gulab Jamun', venId: 'vs', qty: 300, unit: 'pc', date: day(-2), status: 'delivered' };
    const ev = { ...PAST, purchases: [buy] };
    const other = { id: 'xk', evId: 'P1', cat: 'Raw Material', head: 'Vegetables', amt: 5000, date: day(-2), pay: 'paid', mode: 'UPI', billIds: [] };
    const [none, linked, draft] = await check([
      { ev, expenses: [other] },
      { ev, expenses: [other, { ...other, id: 'xb', venId: 'vs', amt: 6000, purchase: 'PO1' }] },
      { ev, expenses: [other, { ...other, id: 'xb', venId: 'vs', amt: 6000, purchase: 'PO1', draft: true }] }]);
    assert.deepEqual(none.missing, ['PO1']);
    assert.ok(none.blockers.includes('1 delivered order or purchase has no bill recorded yet'), none.blockers.join(' | '));
    assert.deepEqual(linked.missing, []);
    assert.deepEqual(draft.missing, ['PO1'], 'a bill still being filled in does not count');
  });

  await test('C: two delivered orders from one vendor and one bill linked to the dosa order: the chaat order is still listed', async () => {
    const ev = { ...PAST, orders: [{ id: 'OD', head: 'Dosa – डोसा', venId: 'vd', plates: 150, status: 'delivered' }, { id: 'OC', head: 'Chaat – चाट', venId: 'vd', plates: 120, status: 'delivered' }] };
    const [linkedOne, linkedBoth, legacyOne, legacyTwo, mixed] = await check([
      { ev, expenses: [bill('x1', { order: 'OD' })] },
      { ev, expenses: [bill('x1', { order: 'OD' }), bill('x2', { order: 'OC' })] },
      { ev, expenses: [bill('x1')] },                                          // an older bill, linked to nothing
      { ev, expenses: [bill('x1'), bill('x2')] },
      { ev, expenses: [bill('x1', { order: 'OD' }), bill('x2')] }]);
    assert.deepEqual(linkedOne.missing, ['OC']);
    assert.ok(linkedOne.blockers.includes('1 delivered order has no bill from that vendor yet'));
    assert.deepEqual(linkedBoth.missing, []);
    assert.equal(legacyOne.missing.length, 1, 'one unlinked bill covers one delivered order, not both');
    assert.deepEqual(legacyTwo.missing, []);
    assert.deepEqual(mixed.missing, [], 'a linked bill for one and an unlinked bill for the other');
  });

  await test('unchanged: one delivered order with an older unlinked bill from its vendor is covered; outsourced events are never blocked', async () => {
    const ev = { ...PAST, orders: [{ id: 'OD', head: 'Dosa – डोसा', venId: 'vd', plates: 150, status: 'delivered' }] };
    const [legacy, out] = await check([{ ev, expenses: [bill('x1')] }, { ev: { ...ev, outsourced: true }, expenses: [] }]);
    assert.deepEqual(legacy.missing, []);
    assert.deepEqual(out.missing, []);
  });

  await test('Books check counts delivered purchases without a bill too', async () => {
    const r = await p.evaluate(async d => { const u = await import('./utils.js');
      return u.booksCheck(d.events, d.expenses, [], []).unbilled; }, {
      events: [{ ...PAST, purchases: [{ id: 'PO1', item: 'Gulab Jamun', venId: 'vs', qty: 300, unit: 'pc', date: day(-2), status: 'delivered' }],
        orders: [{ id: 'OD', head: 'Dosa – डोसा', venId: 'vd', plates: 150, status: 'delivered' }, { id: 'OC', head: 'Chaat – चाट', venId: 'vd', plates: 120, status: 'delivered' }] }],
      expenses: [bill('x1', { order: 'OD' })] });
    assert.equal(r, 2, 'the chaat order and the purchase');
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'order-recon-fixes FAIL' : 'order quantities, purchase bills and one-bill-per-order reconciliation PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('order-recon-fixes FAIL'); process.exitCode = 1; });
