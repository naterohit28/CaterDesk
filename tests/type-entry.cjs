// v6.0-B: "Speak or type" (was "Type it in words"). Text → "I understood" → the ordinary form, filled in. Nothing is saved by the sheet;
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
    { id: 'bos', name: 'Bay of Snacks', cat: 'Live Counter', specialty: 'Starter – स्टार्टर' }, { id: 'gro', name: 'Sample Kirana Store', cat: 'Raw Material', specialty: 'Grocery – किराणा' }],
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
    await p.fill('#say-text', text); await p.locator('#btn-say').click(); await p.waitForTimeout(500);
    return (await p.locator('#say-modal.active').count()) ? p.locator('#say-result').innerText() : '';   // '' = nothing to ask: the form opened directly
  };
  // One step (owner, phone test): when nothing needs asking the form is already open; otherwise press the review's button
  const go = async () => { if (await p.locator('#say-modal.active #btn-say-go').count()) await p.locator('#btn-say-go').click(); await p.waitForTimeout(500); };
  const direct = async sel => { await p.waitForSelector(sel); assert.equal(await p.locator('#say-modal.active').count(), 0, 'no review screen');
    assert.match(await p.locator(sel + ' .say-filled').innerText(), /Filled in from what you said/); };
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

  await test('one step: client advance with nothing to ask opens the filled payment form directly, marked "filled in"', async () => {
    const t = await sayIt('Desai client ne 50 thousand advance diya UPI'); assert.equal(t, '');
    await direct('#cpay-modal.active');
    assert.deepEqual([await p.inputValue('#cpay-evid'), await p.inputValue('#cpay-amt'), await p.inputValue('#cpay-mode')], ['D', '50000', 'UPI']);
    await closeAll(); await p.locator('[data-action="quick"][data-id="expense"]').click().catch(() => {}); await p.waitForTimeout(300);
    assert.equal(await p.locator('.say-filled').count(), 0, 'the note goes with that form, never on the next one');
  });

  await test('the review stays when how it was paid is missing: money context shown', async () => {
    const t = await sayIt('Desai client ne 50 thousand advance diya');
    assert.match(t, /Money received from the client/); assert.match(t, /bill is not changed/);
    assert.match(await p.locator('[data-say-money]').innerText(), /Bill ₹1,00,000 · received ₹0 · balance ₹1,00,000[\s\S]*After this: ₹50,000 left/);
  });

  await test('paid to a contractor who is owed: a vendor payment, with a switch to a new expense', async () => {
    const t = await sayIt('Ramesh ko 10 hazaar diye cash'); assert.equal(t, '', 'within what is owed, said how: straight to the payment');
    await direct('#vpay-modal.active');
    assert.deepEqual([await p.inputValue('#vpay-venid'), await p.inputValue('#vpay-amt')], ['ram', '10000']);
    const t2 = await sayIt('Ramesh ko 10 hazaar diye'); assert.match(t2, /Payment to a vendor/);
    await p.locator('#btn-say-alt').click(); await p.waitForTimeout(100);
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
    await sayIt('Ramesh ko 10 hazaar diye');
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

  await test('labour need opens the event\'s labour sheet with the workers filled in', async () => {
    const t = await sayIt('Patil dinner ke liye 15 boys bulana'); assert.equal(t, '');
    await direct('#lab-modal.active');
    assert.match(await p.locator('#tab-evdetail').innerText(), /Sample Patil Wedding/);
    await p.locator('#lab-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(300);
  });

  await test('new vendor opens the vendor form with what they supply', async () => {
    await sayIt('Naya vegetable supplier add karo'); await go(); await p.waitForSelector('#ven-modal.active');   // nothing to ask: direct
    assert.deepEqual([await p.inputValue('#ven-cat'), await p.inputValue('#ven-specialty')], ['Raw Material', 'Vegetable – भाजी']);
  });

  await test('not understood: says so, offers nothing to save', async () => {
    const t = await sayIt('hello'); assert.match(t, /Not understood/); assert.equal(await p.locator('#btn-say-go').count(), 0);
  });

  await test('nothing was saved by typing; nothing sideways at 360px', async () => {
    await sayIt('Sabzi ka 4500 cash diya');
    const r = await p.evaluate(() => { const sh = document.querySelector('#say-modal .sheet'); return document.documentElement.scrollWidth <= innerWidth && sh.scrollWidth <= sh.clientWidth; });
    assert.equal(r, true);
    const d = await dump(); assert.equal(JSON.stringify(d.expenses.map(({ _rev, ...x }) => x)), JSON.stringify(JSON.parse(before).map(({ _rev, ...x }) => x))); assert.deepEqual([d.cPays.length, d.vPays.length, d.events.length, d.vendors.length], [0, 0, 3, 4]);
  });

  // 6.0-E: these save (by pressing the form's own Save), so they run after the "nothing saved by typing" check
  await test('6.0-E labour: "15 boys bulana" is 15 asked for; who came (and the cost) untouched; saved only with Save sheet', async () => {
    await sayIt('Patil dinner ke liye 15 boys bulana'); await go(); await p.waitForSelector('#lab-modal.active');
    assert.equal((await dump()).events.find(e => e.id === 'P').labour, undefined, 'not saved yet');
    await p.locator('#btn-save-lab').click(); await p.waitForTimeout(800);
    const rows = (await dump()).events.find(e => e.id === 'P').labour.rows;
    assert.deepEqual(rows.map(r => [r.role, r.counts, r.asked]), [['Boys – बॉईज', {}, 15]]);
    assert.equal((await dump()).expenses.filter(x => x.evId === 'P').length, 0, 'a plan costs nothing');
  });

  await test('6.0-E attendance: "dinner mein 12 boys aaye" sets the evening shift on the same line; asked for stays 15', async () => {
    await sayIt('Patil dinner mein 12 boys aaye'); await go(); await p.waitForSelector('#lab-modal.active');
    await p.locator('#btn-save-lab').click(); await p.waitForTimeout(800);
    const rows = (await dump()).events.find(e => e.id === 'P').labour.rows;
    assert.deepEqual(rows.map(r => [r.role, r.counts, r.asked]), [['Boys – बॉईज', { e: 12 }, 15]], 'one line, not two');
  });

  await test('6.0-E attendance with no meal said: no shift guessed', async () => {
    await sayIt('Patil 10 boys aaye'); await go(); await p.waitForSelector('#lab-modal.active');
    await p.locator('#btn-save-lab').click(); await p.waitForTimeout(800);
    const rows = (await dump()).events.find(e => e.id === 'P').labour.rows;
    assert.deepEqual(rows.map(r => [r.counts, r.asked]), [[{ e: 12 }, 15]], 'unchanged');
  });

  await test('6.0-E cooking work: a by-order cook line with people and dishes', async () => {
    await sayIt('Patil ke liye Chinese noodles aur Manchurian, 2 log'); await go(); await p.waitForSelector('#lab-modal.active');
    await p.locator('#btn-save-lab').click(); await p.waitForTimeout(800);
    const job = (await dump()).events.find(e => e.id === 'P').labour.rows.find(r => r.job);
    assert.deepEqual([job.role, job.people, job.dishes], ['Chinese Cook – चायनीज आचारी', 2, ['Noodles', 'Manchurian']]);
  });

  await test('6.0-E supplier order: items said in words become one order of other items, supplier chosen; saved as prepared, not sent', async () => {
    await sayIt('Patil ke liye kirana wale ko 25 kilo rice aur 10 kilo sugar');
    await go(); await p.waitForSelector('#buy-modal.active');
    assert.deepEqual([await p.inputValue('#buy-item'), await p.inputValue('#buy-qty'), await p.inputValue('#buy-unit'), await p.inputValue('#buy-ven')], ['Rice', '25', 'kg', 'gro']);
    assert.deepEqual([await p.inputValue('#buy-more [data-bm="0"] [data-bk="name"]'), await p.inputValue('#buy-more [data-bm="0"] [data-bk="qty"]')], ['Sugar', '10']);
    await p.fill('#buy-time-t', '10:30'); await p.locator('#buy-time-am').click();   // when to deliver is always the person's choice
    await p.locator('#btn-send-buy').click(); await p.waitForTimeout(900);
    const pur = (await dump()).events.find(e => e.id === 'P').purchases;
    assert.deepEqual(pur.map(x => [x.item, x.qty, x.unit, x.venId, x.extra, x.status]).sort(), [['Rice', 25, 'kg', 'gro', true, 'prepared'], ['Sugar', 10, 'kg', 'gro', true, 'prepared']]);
    assert.equal(new Set(pur.map(x => x.grp)).size, 1, 'one order');
  });

  await test('6.0-E guest change: the count sheet opens with the new count, nothing applied until saved', async () => {
    await closeAll(); await sayIt('Patil 200 se 250 plates ho gaya'); await go(); await p.waitForSelector('#count-modal.active');
    assert.equal(await p.inputValue('#count-n'), '250');
    assert.equal((await dump()).events.find(e => e.id === 'P').guestCounts, undefined, 'not applied');
  });

  // CTO review (v6.0): what must never become a completed entry, and what must be asked
  await test('CTO: not done, not to be done, or to be paid later: nothing proposed, no button', async () => {
    for (const t of ['Gas 1200 cash nahi diya', 'Client ne 2000 nahi diya', 'Ramesh ko 5000 UPI mat dena', 'Ramesh ko 5000 dena hai', 'Client ne abhi advance nahi diya']) {
      await sayIt(t); assert.equal(await p.locator('[data-say-stop]').count(), 1, t); assert.equal(await p.locator('#btn-say-go').count(), 0, t);
    }
  });

  await test('CTO: two amounts: one entry at a time, neither dropped', async () => {
    const t = await sayIt('Gas 1200 cash aur sabzi 4500 cash');
    assert.match(t, /2 amounts found \(₹1,200, ₹4,500\)[\s\S]*one entry at a time/); assert.equal(await p.locator('#btn-say-go').count(), 0);
  });

  await test('CTO: credit and a way of paying, or two ways: nothing chosen until you choose', async () => {
    await sayIt('Patil gas 1200 udhar UPI');
    assert.match(await p.locator('[data-say-note]').innerText(), /both credit and a way of paying/);
    assert.deepEqual([await p.locator('#say-pay [data-say-pay="paid"]').getAttribute('aria-pressed'), await p.locator('#say-pay [data-say-pay="credit"]').getAttribute('aria-pressed')], ['false', 'false']);
    await sayIt('Patil gas 1200 cash or UPI');
    assert.match(await p.locator('#say-result').innerText(), /You said UPI and Cash/);
    await p.locator('#say-pay [data-say-pay="paid"]').click(); await p.waitForTimeout(100);
    assert.equal(await p.inputValue('#say-mode'), '', 'no way of paying chosen for you'); await go();
    assert.match(await p.locator('#say-err').innerText(), /Choose how it was paid/, 'the form\'s usual way of paying never stands in');
  });

  await test('CTO: a phone number is never money; the vendor form gets the name and phone', async () => {
    const t = await sayIt('Naya supplier Raj phone 9876543210'); assert.doesNotMatch(t, /₹/);
    await go(); await p.waitForSelector('#ven-modal.active');
    assert.deepEqual([await p.inputValue('#ven-name'), await p.inputValue('#ven-phone')], ['Raj', '9876543210']);
  });

  await test('CTO: a day said that does not match the event found: nothing chosen, the conflict shown', async () => {
    await sayIt('Kulkarni gas 1200 cash udya');
    assert.equal(await p.inputValue('#say-ev'), ''); assert.match(await p.locator('#say-result').innerText(), /Sample Kulkarni Pooja is on .*not the day you said/);
  });

  await test('CTO: "kal gas ka 1500 cash diya": dated yesterday, to check; no event assumed; the form gets that date', async () => {
    const t = await sayIt('Kal gas ka 1500 cash diya');
    assert.match(t, /Date of this entry: .* – check it/); assert.equal(await p.locator('[data-say-guess]').count(), 0, 'no "today\'s only event"');
    await p.selectOption('#say-ev', 'K'); await go(); await p.waitForSelector('#exp-modal.active');
    assert.equal(await p.inputValue('#exp-date'), iso(-1));
  });

  await test('CTO: a place the app does not know is not replaced by today\'s event', async () => {
    await sayIt('Shivaji Mandir sabzi 4500 cash'); assert.equal(await p.inputValue('#say-ev'), ''); assert.equal(await p.locator('[data-say-guess]').count(), 0);
  });

  await test('CTO: the locality names its event ("Vashi" → the Patil wedding at Sample Lawns, Vashi)', async () => {
    await sayIt('Vashi ka gas 1200 cash'); assert.equal(await p.inputValue('#say-ev'), 'P');
  });

  await test('CTO: an advance to a supplier who is owed nothing stays a payment to them', async () => {
    const t = await sayIt('Bay of Snacks ko 5000 advance diya UPI');
    assert.match(t, /Payment to a vendor/); assert.doesNotMatch(t, /new purchase\./);
  });

  await test('CTO: editing the text after it was understood: the old reading cannot be used', async () => {
    await sayIt('Patil gas 1200'); await p.fill('#say-text', 'Patil gas 1500');
    assert.equal(await p.locator('#btn-say-go').count(), 0); assert.match(await p.locator('#say-result').innerText(), /text changed/i);
  });

  await test('phone test: money "to" someone who is owed, understood as a new expense, asks whether it pays what is owed', async () => {
    const t = await sayIt('Ramesh mukadam boys 3000 cash'); assert.match(t, /is owed ₹12,000\. Was this paying that\?/);
    await p.locator('#btn-say-topay').click(); await p.waitForTimeout(100);
    assert.match(await p.locator('#say-result').innerText(), /Payment to a vendor/);
  });

  await test('Speak or type: the Home button and the sheet say you can speak', async () => {
    await closeAll(); if (!(await p.locator('#tab-home.active').count())) { await p.locator('#n-home:visible').click(); await p.waitForTimeout(200); }
    assert.match(await p.locator('[data-action="quick"][data-id="say"]').innerText(), /Speak or type/);
    await p.locator('[data-action="quick"][data-id="say"]').click(); await p.waitForSelector('#say-modal.active');
    assert.match(await p.locator('#say-mtitle').innerText(), /Speak or type/);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'type-entry FAIL' : 'typed entry PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('type-entry FAIL'); process.exit(1); });
