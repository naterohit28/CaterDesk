// Phase 4 P4-B (spec §10.3, G-08, G-23): pay a chosen bill, one "to pay" row per bill, credit notes,
// and a delivered order linked to the bill already recorded. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // local date, as the app uses
const ev = (id, name, date, extra = {}) => ({ id, name, date, venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 100, photoIds: [], ...extra });
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [],
  vendors: [{ id: 'vg', name: 'Sample Grocer', cat: 'Raw Material' }, { id: 'vd', name: 'Sample Dosa Counter', cat: 'Live Counter', phone: '9000000001' }],
  events: [ev('A', 'Sample Event A', day(-5)), ev('B', 'Sample Event B', day(-4)),
    ev('C', 'Sample Event C', day(-1), { dishes: [{ name: 'Masala Dosa', head: 'Dosa – डोसा' }],
      orders: [{ id: 'o1', head: 'Dosa – डोसा', venId: 'vd', plates: 300, status: 'confirmed' }, { id: 'o2', head: 'Dosa – डोसा', venId: 'vd', plates: 50, status: 'cancelled' }] })],
  expenses: [
    // Oldest: a ₹10,000 bill; then one ₹30,000 bill shared by A and B (one bill, two parts)
    { id: 'old', evId: 'A', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 10000, date: day(-6), pay: 'credit', venId: 'vg', dueDate: '', billIds: [] },
    { id: 'sa', evId: 'A', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 18000, date: day(-5), pay: 'credit', venId: 'vg', dueDate: '', billIds: [], billNo: 'G-77', split: { id: 'SPG', total: 30000 } },
    { id: 'sb', evId: 'B', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 12000, date: day(-5), pay: 'credit', venId: 'vg', dueDate: '', billIds: [], billNo: 'G-77', split: { id: 'SPG', total: 30000 } },
    // The dosa vendor's bill, typed in from the bill itself before the order was marked delivered
    { id: 'dosa', evId: 'C', cat: 'Live Counter', head: 'Dosa – डोसा', amt: 24000, date: day(-1), pay: 'credit', venId: 'vd', dueDate: '', billIds: [] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const bills = () => p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData();
    return Object.fromEntries(u.unpaidBills(d.expenses, d.vPays).map(b => [b.key, b.left])); });
  const bal = id => p.evaluate(async id => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData(); return u.calcVendorBalance(id, d.expenses, d.vPays); }, id);
  const cost = id => p.evaluate(async id => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData(); return u.calcEventExpenses(id, d.expenses); }, id);
  const expensesTab = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-expenses:visible').click(); await p.waitForSelector('#to-pay-list'); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);

  await test('"To pay" lists a shared bill once, with its number and the events it covers', async () => {
    await expensesTab();
    const rows = await p.locator('#to-pay-list .row').allInnerTexts();
    assert.equal(rows.length, 3, 'old bill, shared bill (once), dosa bill');
    const shared = rows.find(r => /G-77/.test(r));
    assert.match(shared, /Sample Grocer[\s\S]*Grocery · #G-77 · 2 events[\s\S]*₹30,000/);
    await p.locator('#n-home').click(); assert.match(await p.locator('#nudges').innerText(), /See all 3 to pay/);
  });

  await test('paying the shared bill from its row settles that bill, not the oldest one', async () => {
    await expensesTab();
    await p.locator('#to-pay-list [data-action="open-vpay"][data-bill="SPG"]').click(); await p.waitForSelector('#vpay-modal.active');
    assert.equal(await p.locator('#vpay-bill').inputValue(), 'SPG'); assert.equal(await p.locator('#vpay-amt').inputValue(), '30000');
    await p.fill('#vpay-amt', '20000'); await p.locator('#btn-save-vpay').click(); await p.waitForTimeout(500);
    assert.equal((await dump()).vPays[0].billKey, 'SPG');
    assert.deepEqual(await bills(), { old: 10000, SPG: 10000, dosa: 24000 }, 'the ₹10,000 old bill is untouched');
    assert.equal((await bal('vg')).balance, 20000);
    assert.deepEqual([await cost('A'), await cost('B')], [28000, 12000], 'paying never changes event costs');
  });

  await test('a payment for no particular bill goes to the oldest first; more than a bill flows to the next', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); await db.putOne('vPays', { id: 'p2', venId: 'vg', amt: 15000, date: new Date().toISOString().slice(0, 10), mode: 'UPI' }); });
    assert.deepEqual(await bills(), { SPG: 5000, dosa: 24000 });
    // A payment marked for a bill but larger than it: the rest settles the oldest remaining
    await p.evaluate(async () => { const db = await import('./db.js'); await db.putOne('vPays', { id: 'p3', venId: 'vd', amt: 30000, billKey: 'dosa', date: new Date().toISOString().slice(0, 10), mode: 'UPI' }); });
    const b = await bal('vd'); assert.equal(b.balance, -6000, 'overpaid ₹6,000 shows as an advance');
    assert.equal((await bills()).dosa, undefined);
  });

  await test('credit note: lowers what is owed without counting as money paid; needs a reference', async () => {
    await expensesTab();
    await p.locator('#to-pay-list [data-action="open-vpay"][data-bill="SPG"]').click(); await p.waitForSelector('#vpay-modal.active');
    await p.locator('#vpay-kind [data-kind="credit"]').click();
    assert.equal(await p.locator('#vpay-mode').isVisible(), false, 'no payment mode for a credit note');
    await p.fill('#vpay-amt', '2000'); await p.fill('#vpay-notes', ''); await p.locator('#btn-save-vpay').click(); await p.waitForTimeout(300);
    assert.equal((await dump()).vPays.length, 3, 'refused without a reference');
    await p.fill('#vpay-notes', 'CN-5 short supply of rice'); await p.locator('#btn-save-vpay').click(); await p.waitForTimeout(500);
    const cn = (await dump()).vPays.find(v => v.kind === 'credit');
    assert.deepEqual([cn.amt, cn.billKey, cn.mode, cn.notes], [2000, 'SPG', '', 'CN-5 short supply of rice']);
    const b = await bal('vg');
    assert.deepEqual([b.supplied, b.paid, b.credits, b.balance], [40000, 35000, 2000, 3000]);
    assert.deepEqual(await bills(), { SPG: 3000 });
    assert.deepEqual([await cost('A'), await cost('B')], [28000, 12000], 'event costs stay as billed');
    await p.locator('#n-vendors:visible').click(); await p.locator('[data-action="vendetail"][data-id="vg"]:visible').first().click(); await p.waitForTimeout(300);
    const t = await p.locator('#tab-vendetail').innerText();
    assert.match(t, /Credit notes ₹2,000 lower what you owe/); assert.match(t, /₹2,000\s*Credit note[\s\S]*for Grocery #G-77[\s\S]*CN-5/);
  });

  await test('G-23: delivered order whose bill is already recorded is linked, not entered twice', async () => {
    const before = (await dump()).expenses.length;
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="C"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    await p.locator('[data-action="order-status"][data-id="o1"]').click(); await p.locator('#ask-actions button', { hasText: 'Delivered' }).click();
    await p.waitForSelector('#ask-modal.active'); await p.waitForTimeout(300);
    assert.match(await p.locator('#ask-msg').innerText(), /Sample Dosa Counter already has a bill on this event/);
    await p.locator('#ask-actions button', { hasText: 'Link: Dosa · ₹24,000' }).click(); await p.waitForTimeout(500);
    const d = await dump();
    assert.equal(d.expenses.length, before, 'no second expense');
    assert.equal(d.expenses.find(x => x.id === 'dosa').order, 'o1');
    assert.equal(d.events.find(e => e.id === 'C').orders[0].status, 'delivered');
    assert.equal(await cost('C'), 24000);
    assert.match(await p.locator('[data-action="order-status"][data-id="o1"]').innerText(), /Delivered · billed/);
  });

  await test('G-23: with no bill yet, the bill recorded from the delivery is linked to the order', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const e = d.events.find(x => x.id === 'C'); const { _rev, ...r } = e;
      await db.putOne('events', { ...r, orders: [...r.orders, { id: 'o3', head: 'Chaat – चाट', venId: 'vg', plates: 200, status: 'confirmed' }], dishes: [...r.dishes, { name: 'Pani Puri', head: 'Chaat – चाट' }] }); });
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="C"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    await p.locator('[data-action="order-status"][data-id="o3"]').click(); await p.locator('#ask-actions button', { hasText: 'Delivered' }).click();
    await p.waitForSelector('#exp-modal.active');
    assert.match(await p.locator('[data-action="order-status"][data-id="o3"]').innerText(), /Delivered · bill not in/);
    await p.fill('#exp-amt', '9000'); await p.locator('#btn-save-exp').click(); await p.waitForTimeout(500);
    const x = (await dump()).expenses.find(e => e.order === 'o3');
    assert.deepEqual([x.evId, x.venId, x.amt, x.head], ['C', 'vg', 9000, 'Chaat – चाट']);
    assert.match(await p.locator('[data-action="order-status"][data-id="o3"]').innerText(), /Delivered · billed/);
  });

  await test('backup keeps bill targets, credit notes and order links; bad values are refused', async () => {
    const strip = rows => rows.map(({ _rev, ...x }) => x).sort((a, b) => a.id.localeCompare(b.id));
    const before = await dump();
    const after = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); await db.importAllData(JSON.parse(JSON.stringify(d)), 'replace'); return db.exportAllData(); });
    assert.deepEqual(strip(after.vPays), strip(before.vPays)); assert.deepEqual(strip(after.expenses), strip(before.expenses));
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const out = [];
      for (const f of [d => { d.vPays[0].kind = 'refund'; }, d => { d.vPays[0].billKey = 7; }, d => { d.expenses[0].order = {}; }, d => { d.vendors[0].kind = 'credit'; }]) {
        const d = await db.exportAllData(); delete d.manifest; f(d);
        try { await db.importAllData(d, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message.split(':')[0]); } }
      return out; });
    assert.deepEqual(r, ['Invalid payment kind', 'Invalid text field', 'Invalid text field', 'Invalid vendor kind']);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'bill payments FAIL' : 'bill payments, credit notes and order bills (G-08, G-23) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('bill payments FAIL'); process.exitCode = 1; });
