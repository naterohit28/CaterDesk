// v6.0-B: "Type it in words". Text → "I understood" → the ordinary form, filled in. Nothing is saved by the sheet;
// paid/credit is never guessed; an advance is money received, never the bill; two events that fit must be chosen;
// "paid X to <vendor>" with money owed opens a vendor payment, with nothing owed it becomes a new expense.
// Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const ev = (id, name, date, x = {}) => ({ id, name, date, type: 'Wedding – लग्न', venue: '', billing: 100000, guests: 200, photoIds: [], ...x });
const DATA = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [],
  events: [ev('P', 'Sample Patil Wedding', iso(1), { venue: 'Sample Lawns', locality: 'Vashi' }), ev('D', 'Sample Desai Reception', iso(1)), ev('K', 'Sample Kulkarni Pooja', iso(0))],
  vendors: [{ id: 'veg', name: 'Sample Bhaji Supplier', cat: 'Raw Material', specialty: 'Vegetable – भाजी' }, { id: 'ram', name: 'Ramesh Mukadam', cat: 'Labour', specialty: 'Boys – बॉईज' },
    { id: 'bos', name: 'Bay of Snacks', cat: 'Live Counter', specialty: 'Starter – स्टार्टर' }],
  expenses: [{ id: 'x1', evId: 'K', date: iso(-1), cat: 'Labour', head: 'Boys – बॉईज', amt: 12000, venId: 'ram', pay: 'credit', mode: '', photoIds: [] }] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });
  await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA());
  await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' });
  const closeAll = async () => { for (let i = 0; i < 3 && await p.locator('.modal-ov.active').count(); i++) { await p.locator('.modal-ov.active [data-action="close-modal"]').first().click(); await p.waitForTimeout(250); } };
  const sayIt = async text => {
    await closeAll(); if (!(await p.locator('#tab-home.active').count())) { await p.locator('#n-home:visible').click(); await p.waitForTimeout(200); }
    await p.locator('[data-action="quick"][data-id="say"]').click(); await p.waitForSelector('#say-modal.active');
    await p.fill('#say-text', text); await p.locator('#btn-say').click(); await p.waitForTimeout(150);
    return p.locator('#say-result').innerText();
  };
  const go = async () => { await p.locator('#btn-say-go').click(); await p.waitForTimeout(500); };
  const before = JSON.stringify((await dump()).expenses);

  await test('expense: paid or credit must be chosen; the form opens filled in; nothing saved by the sheet', async () => {
    const t = await sayIt('Patil lagnasathi bhajiwala 8:30 hajar udhar');
    assert.match(t, /I understood/); assert.match(t, /₹8,500/); assert.match(t, /Vegetable/); assert.match(t, /sounds like credit/);
    assert.equal(await p.inputValue('#say-ev'), 'P', 'Patil found');
    await go(); assert.match(await p.locator('#say-err').innerText(), /paid now or on credit/i, 'never guessed');
    await p.locator('#say-pay [data-say-pay="credit"]').click(); await p.waitForTimeout(100);
    await go(); await p.waitForSelector('#exp-modal.active');
    assert.deepEqual([await p.inputValue('#exp-amt'), await p.inputValue('#exp-ev'), await p.locator('#exp-pay').getAttribute('data-value'), await p.inputValue('#exp-head')],
      ['8500', 'P', 'credit', 'Vegetable – भाजी']);
    assert.equal(JSON.stringify((await dump()).expenses), before, 'nothing saved until the form is saved');
  });

  await test('paid with how: "Sabzi ka 4500 cash diya" → paid, cash; today\'s only event shown chosen, marked to check', async () => {
    const t = await sayIt('Sabzi ka 4500 cash diya'); assert.match(t, /₹4,500/);
    assert.equal(await p.locator('#say-pay [data-say-pay="paid"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await p.inputValue('#say-ev'), 'K'); assert.match(await p.locator('[data-say-guess]').innerText(), /Today's only event/);
    await p.selectOption('#say-ev', ''); assert.equal(await p.locator('[data-say-guess]').count(), 0, 'chosen by hand: no note');
    await go(); assert.match(await p.locator('#say-err').innerText(), /Choose the event/);
    await p.selectOption('#say-ev', 'K'); await go(); await p.waitForSelector('#exp-modal.active');
    assert.deepEqual([await p.inputValue('#exp-amt'), await p.inputValue('#exp-ev'), await p.locator('#exp-pay').getAttribute('data-value'), await p.inputValue('#exp-mode')], ['4500', 'K', 'paid', 'Cash – रोख']);
  });

  await test('two events on the day said are both offered, none picked', async () => {
    const t = await sayIt('udya gas 1200 cash');
    assert.equal(await p.inputValue('#say-ev'), ''); assert.match(t, /More than one event fits/);
  });

  await test('client advance: money received, the bill unchanged; the payment form opens filled in', async () => {
    const t = await sayIt('Desai client ne 50 thousand advance diya UPI');
    assert.match(t, /Money received from the client/); assert.match(t, /bill is not changed/);
    assert.match(await p.locator('[data-say-money]').innerText(), /Bill ₹1,00,000 · received ₹0 · balance ₹1,00,000[\s\S]*After this: ₹50,000 left/);
    await go(); await p.waitForSelector('#cpay-modal.active');
    assert.deepEqual([await p.inputValue('#cpay-evid'), await p.inputValue('#cpay-amt'), await p.inputValue('#cpay-mode')], ['D', '50000', 'UPI']);
  });

  await test('paid to a contractor who is owed: a vendor payment, with a switch to a new expense', async () => {
    const t = await sayIt('Ramesh ko 10 hazaar diye cash'); assert.match(t, /Payment to a vendor/);
    assert.equal(await p.inputValue('#say-ven'), 'ram');
    assert.equal(await p.locator('#btn-say-alt').count(), 1);
    await go(); await p.waitForSelector('#vpay-modal.active');
    assert.deepEqual([await p.inputValue('#vpay-venid'), await p.inputValue('#vpay-amt')], ['ram', '10000']);
    const t2 = await sayIt('Ramesh ko 10 hazaar diye cash'); await p.locator('#btn-say-alt').click(); await p.waitForTimeout(100);
    assert.match(await p.locator('#say-result').innerText(), /What\s*Expense/);
  });

  await test('paid to a vendor who is owed nothing: a new paid purchase', async () => {
    const t = await sayIt('Bay of Snacks ko 2490 diye UPI');
    assert.match(t, /Expense/); assert.match(t, /Nothing is owed to this vendor/);
    assert.equal(await p.locator('#say-pay [data-say-pay="paid"]').getAttribute('aria-pressed'), 'true');
  });

  await test('quick event: date, plates and place filled; an advance goes to "received now", never the bill', async () => {
    const t = await sayIt('Kal Vashi mein 100 plates ka birthday hai');
    assert.match(t, /New quick event/); assert.match(t, /check: "kal"/);
    await go(); await p.waitForSelector('#qev-modal.active');
    assert.deepEqual([await p.inputValue('#qev-name'), await p.inputValue('#qev-date'), await p.inputValue('#qev-guests'), await p.inputValue('#qev-venue'), await p.inputValue('#qev-bill')],
      ['Birthday – Vashi', iso(1), '100', 'Vashi', '']);
    await sayIt('Book birthday 80 plates kal, 5000 advance received UPI'); await go(); await p.waitForSelector('#qev-modal.active');
    assert.deepEqual([await p.inputValue('#qev-rec'), await p.inputValue('#qev-bill'), await p.inputValue('#qev-mode')], ['5000', '', 'UPI']);
  });

  await test('paying a vendor shows what is owed and which bills it pays, oldest first; more than owed is an advance', async () => {
    await sayIt('Ramesh ko 10 hazaar diye cash');
    const m = await p.locator('[data-say-money]').innerText();
    assert.match(m, /Owed to them now: ₹12,000/); assert.match(m, /Boys · .* · ₹12,000 \(₹10,000 of it\)/);
    await sayIt('Ramesh ko 15000 diye cash');
    assert.match(await p.locator('[data-say-money]').innerText(), /₹3,000 more than owed: the extra stays with them as an advance/);
  });

  await test('client money more than the balance is flagged; nothing set yet counts as an advance', async () => {
    await sayIt('Desai client ne 1.5 lakh diye UPI');
    assert.match(await p.locator('[data-say-money]').innerText(), /₹50,000 more than the balance/);
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest; d.events.find(e => e.id === 'P').billing = 0; await db.importAllData(d, 'replace'); });
    await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' });
    await sayIt('Patil client ne 20000 advance diya UPI');
    assert.match(await p.locator('[data-say-money]').innerText(), /No bill set yet[\s\S]*counts as an advance/);
  });

  await test('someone not in the vendor list: offer to add them, filled in', async () => {
    await sayIt('Suresh ko 2000 diye cash');
    await p.locator('#btn-say-newven').click(); await p.waitForSelector('#ven-modal.active');
    assert.equal(await p.inputValue('#ven-name'), 'Suresh');
  });

  await test('labour need opens the event, with what to add', async () => {
    const t = await sayIt('Patil dinner ke liye 15 boys bulana'); assert.match(t, /15 Boys/); assert.match(t, /Dinner/);
    await go(); await p.waitForSelector('#tab-evdetail.active');
    assert.match(await p.locator('#tab-evdetail').innerText(), /Sample Patil Wedding/);
  });

  await test('new vendor opens the vendor form with what they supply', async () => {
    await sayIt('Naya vegetable supplier add karo'); await go(); await p.waitForSelector('#ven-modal.active');
    assert.deepEqual([await p.inputValue('#ven-cat'), await p.inputValue('#ven-specialty')], ['Raw Material', 'Vegetable – भाजी']);
  });

  await test('not understood: says so, offers nothing to save', async () => {
    const t = await sayIt('hello'); assert.match(t, /Not understood/); assert.equal(await p.locator('#btn-say-go').count(), 0);
  });

  await test('nothing was saved by typing; nothing sideways at 360px', async () => {
    await sayIt('Sabzi ka 4500 cash diya');
    const r = await p.evaluate(() => { const sh = document.querySelector('#say-modal .sheet'); return document.documentElement.scrollWidth <= innerWidth && sh.scrollWidth <= sh.clientWidth; });
    assert.equal(r, true);
    const d = await dump(); assert.equal(JSON.stringify(d.expenses.map(({ _rev, ...x }) => x)), JSON.stringify(JSON.parse(before).map(({ _rev, ...x }) => x))); assert.deepEqual([d.cPays.length, d.vPays.length, d.events.length, d.vendors.length], [0, 0, 3, 3]);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'type-entry FAIL' : 'typed entry PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('type-entry FAIL'); process.exit(1); });
