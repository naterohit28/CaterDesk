// Owner's full-event test on v4.31.13 (checks 3, 4, 6–8, 11, 12, 14, 16, 17, 21) and Codex's review of #88: a payment plan in % without a % key, a labelled date, meal
// dishes typed but not added are never dropped by Save, an order can be saved without sending, typed plates stay the
// owner's, and WhatsApp opens inside the tap (before the save is awaited). Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'vg', name: 'Sample Gas Supplier', cat: 'Raw Material', phone: '9999999997' }, { id: 'vd', name: 'Sample Dosa Counter', cat: 'Live Counter', phone: '9999999999' }, { id: 'vs', name: 'Sample Sweet Shop', cat: 'Raw Material', phone: '9999999998' }],
  events: [{ id: 'E1', name: 'Sample Full Event', date: day(7), venue: 'Sample Hall', type: 'Wedding – लग्न', guests: 300, billing: 225000,
    mealPlan: { dinner: { guests: 300, rate: 750 } }, meals: ['dinner'], photoIds: [] },
  { id: 'E2', name: 'Sample Small Party', date: day(7), venue: 'Sample Hall', type: 'Birthday – वाढदिवस', guests: 50, billing: 30000, photoIds: [] },
  { id: 'E3', name: 'Sample Past Party', date: day(-1), venue: 'Sample Hall', type: 'Birthday – वाढदिवस', guests: 50, billing: 10000, photoIds: [] }] };

const pickTime = async (p, id, hhmm = '19:30') => { if (await p.inputValue('#' + id)) return; const [h, m] = hhmm.split(':').map(Number); await p.fill('#' + id + '-t', `${h % 12 || 12}:${String(m).padStart(2, '0')}`); await p.locator('#' + id + (h < 12 ? '-am' : '-pm')).click(); };
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
  await p.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return {}; }; });

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

  await test('meal menu: dishes typed but not added are saved (not dropped) by one Save', async () => {
    await openEvent();
    await p.locator('[data-action="svc-edit"]').first().click();
    await p.locator('#svc-add').fill('Paneer Butter Masala, Dal Tadka, Masala Dosa');
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(500);   // one Save (owner's phone review, 4.31.21)
    assert.equal(await p.locator('#svc-modal.active').count(), 0, 'one Save closes the sheet');
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
    await pickTime(p, 'ord-time'); await p.locator('#btn-save-ord').click(); await p.waitForTimeout(500);
    let o = (await ev()).orders[0];
    assert.deepEqual([o.status, o.plates, o.messages.length], ['prepared', 260, 1]);
    assert.deepEqual(await p.evaluate(() => window.__opened.length), 0, 'Save order opens nothing');
    await p.locator(`[data-action="order-status"][data-id="${o.id}"]`).click();
    await p.getByRole('button', { name: /^Send on WhatsApp/ }).click(); await p.waitForTimeout(400);
    assert.match(await p.evaluate(() => window.__opened[0]), /^https:\/\/wa\.me\/919999999999\?text=Namaste%20Sample%20Dosa%20Counter/);
    o = (await ev()).orders[0];
    assert.deepEqual([o.status, o.messages.at(-1).status], ['opened', 'opened'], 'opened, not sent, until you mark it sent');
  });

  await test('Send on WhatsApp from the order sheet: saved first, then WhatsApp opens from a tap; opened is not sent', async () => {
    await openEvent();
    const o = (await ev()).orders[0];
    await p.locator(`[data-action="order-status"][data-id="${o.id}"]`).click();
    await p.getByRole('button', { name: /^Edit \/ send again/ }).click();
    await p.locator('#ord-notes').fill('setup by 6 pm');
    // window.event is the tap only while its handler runs synchronously: after any await it is gone
    await p.evaluate(() => { window.__opened = []; window.__inTap = []; window.open = u => { window.__opened.push(u); window.__inTap.push(window.event?.type === 'click'); return {}; }; });
    await pickTime(p, 'ord-time'); await p.locator('#btn-send-ord').click(); await p.waitForTimeout(600);
    assert.equal(await p.evaluate(() => window.__opened.length), 0, 'nothing opens before the save is done');
    let x = (await ev()).orders[0];
    assert.deepEqual([x.notes, x.status, x.messages.length, x.messages.at(-1).status], ['setup by 6 pm', 'prepared', 2, 'prepared'], 'the changed order is saved as a new, not-sent version');
    await p.locator('#ask-modal.active #ask-actions .btn-wa').click(); await p.waitForTimeout(400);
    assert.deepEqual(await p.evaluate(() => window.__inTap), [true], 'WhatsApp opened inside the tap');
    assert.match(await p.evaluate(() => decodeURIComponent(window.__opened[0])), /Note: setup by 6 pm/);
    x = (await ev()).orders[0];
    assert.deepEqual([x.status, x.messages.map(m => m.status)], ['opened', ['opened', 'opened']], 'opened, never sent; history kept');
    assert.equal((await ev()).orders.length, 1, 'no duplicate order');
  });

  await test('a failed save opens nothing; a blocked WhatsApp window leaves the order not sent', async () => {
    await openEvent();
    const o = (await ev()).orders[0];
    await p.locator(`[data-action="order-status"][data-id="${o.id}"]`).click();
    await p.getByRole('button', { name: /^Edit \/ send again/ }).click();
    await p.locator('#ord-notes').fill('setup by 7 pm');
    // The phone's storage refuses the next write (e.g. full): this save fails
    await p.evaluate(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { IDBObjectStore.prototype.put = put; throw new DOMException('Storage is full', 'QuotaExceededError'); }; });
    await p.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; });   // null: blocked
    await pickTime(p, 'ord-time'); await p.locator('#btn-send-ord').click(); await p.waitForTimeout(600);
    assert.equal(await p.locator('#ask-modal.active #ask-actions .btn-wa').count(), 0, 'no send step for an order that did not save');
    assert.equal(await p.evaluate(() => window.__opened.length), 0, 'nothing opened');
    assert.equal((await ev()).orders[0].notes, 'setup by 6 pm', 'the record is unchanged');
    // Saved now (fresh data), but the phone blocks the window: it stays "prepared", and says so
    await openEvent();
    await p.locator(`[data-action="order-status"][data-id="${o.id}"]`).click();
    await p.getByRole('button', { name: /^Edit \/ send again/ }).click();
    await p.locator('#ord-notes').fill('setup by 7 pm');
    await p.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; });
    await pickTime(p, 'ord-time'); await p.locator('#btn-send-ord').click(); await p.waitForTimeout(600);
    await p.locator('#ask-modal.active #ask-actions .btn-wa').click(); await p.waitForTimeout(400);
    assert.match(await p.locator('#toast-msg').innerText(), /WhatsApp did not open\. It is saved as not sent/);
    const x = (await ev()).orders;
    assert.deepEqual([x.length, x[0].notes, x[0].status], [1, 'setup by 7 pm', 'prepared']);
  });

  await test('Codex P2: type 25%, add a milestone, change the first one\'s due option, save: 25% of the bill, never ₹25', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const { _rev, payPlan, ...e } = d.events.find(x => x.id === 'E2'); await db.putOne('events', e); });
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="E2"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    await p.locator('[data-action="plan-edit"]').first().click();
    await p.locator('[data-pm="0"] [data-k="amt"]').fill('25%');
    assert.equal(await p.locator('[data-pm="0"] [data-k="unit"]').inputValue(), 'pct', 'typing % chooses %');
    await p.locator('#btn-plan-add').click();
    assert.equal(await p.locator('[data-pm="0"] [data-k="amt"]').inputValue(), '25');
    await p.locator('[data-pm="0"] [data-k="when"]').selectOption('before');
    await p.locator('[data-pm="0"] [data-k="days"]').fill('3');
    assert.equal(await p.locator('[data-pm="0"] [data-k="unit"]').inputValue(), 'pct', 'still % after the due option changed');
    await p.locator('[data-pm-del="1"]').click();
    assert.equal(await p.locator('[data-pm="0"] [data-k="unit"]').inputValue(), 'pct', 'still % after a row was removed');
    await p.locator('#btn-save-plan').click(); await p.waitForTimeout(400);
    const e2 = await p.evaluate(async () => (await (await import('./db.js')).exportAllData()).events.find(x => x.id === 'E2'));
    assert.deepEqual(e2.payPlan.map(m => [m.when, m.pct, m.amt, m.days]), [['before', 25, undefined, 3]]);
    // Switching to ₹ is explicit and keeps the number: 25 means ₹25 only when ₹ is chosen
    await p.locator('[data-action="plan-edit"]').first().click();
    await p.locator('[data-pm="0"] [data-k="unit"]').selectOption('amt');
    assert.equal(await p.locator('[data-pm="0"] [data-k="amt"]').inputValue(), '25');
    await p.locator('[data-pm="0"] [data-k="unit"]').selectOption('pct');
    await p.locator('#btn-save-plan').click(); await p.waitForTimeout(400);
    assert.equal((await p.evaluate(async () => (await (await import('./db.js')).exportAllData()).events.find(x => x.id === 'E2'))).payPlan[0].pct, 25);
  });

  await test('one bill for two events: Split bill on a new expense saves it, then divides it; the vendor is owed it once', async () => {
    await p.reload(); await p.waitForSelector('#kpi .card');
    await p.locator('.qa[data-id="expense"]').click(); await p.waitForSelector('#exp-modal.active');
    assert.equal(await p.locator('#btn-share-exp').isVisible(), true, 'Split bill is offered on a new expense');
    await p.locator('#exp-amt').fill('9000');
    await p.locator('#exp-pay [data-pay="credit"]').click();
    await p.locator('#exp-ev').selectOption('E1');
    await p.locator('#exp-vendor').selectOption('vg');
    await p.locator('#btn-share-exp').click(); await p.waitForSelector('#split-modal.active');
    await p.locator('#split-rows [data-sp="1"] [data-k="evId"]').selectOption('E2');
    await p.locator('#split-rows [data-sp="0"] [data-k="amt"]').fill('6000');
    await p.locator('#split-rows [data-sp="1"] [data-k="amt"]').fill('2000');
    await p.locator('#btn-save-split').click(); await p.waitForTimeout(400);
    assert.equal(await p.locator('#split-modal').isVisible(), true, '₹6,000 + ₹2,000 is refused: it is not ₹9,000');
    await p.locator('#split-rows [data-sp="1"] [data-k="amt"]').fill('3000');
    await p.locator('#btn-save-split').click(); await p.waitForTimeout(500);
    const r = await p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData();
      const gas = d.expenses.filter(x => x.venId === 'vg');
      return { parts: gas.map(x => [x.evId, x.amt]).sort(), total: gas[0]?.split?.total, owed: u.calcVendorBalance('vg', d.expenses, d.vPays).balance }; });
    assert.deepEqual(r, { parts: [['E1', 6000], ['E2', 3000]], total: 9000, owed: 9000 });
  });

  await test('a one-off cash purchase needs no vendor; on credit it asks who is owed', async () => {
    await p.reload(); await p.waitForSelector('#kpi .card');
    await p.locator('.qa[data-id="expense"]').click(); await p.waitForSelector('#exp-modal.active');
    assert.match(await p.locator('#exp-vendor-lbl').innerText(), /Vendor \(optional\)/);
    assert.match(await p.locator('#exp-vendor option').first().innerText(), /No vendor \(one-off purchase\)/);
    await p.locator('#exp-pay [data-pay="credit"]').click();
    assert.match(await p.locator('#exp-vendor option').first().innerText(), /Choose who you owe/);
    await p.locator('#exp-pay [data-pay="paid"]').click();
    await p.locator('#exp-amt').fill('350'); await p.locator('#exp-ev').selectOption('E1');
    await p.locator('#btn-save-exp').click(); await p.waitForTimeout(500);
    assert.equal(await p.locator('#exp-modal').isVisible(), false);
    assert.ok(await p.evaluate(async () => (await (await import('./db.js')).exportAllData()).expenses.some(x => x.amt === 350 && !x.venId)));
  });

  await test('final settlement: a payment can be recorded from the settlement sheet', async () => {
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="E3"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    await p.locator('[data-action="settle-open"]').click(); await p.waitForSelector('#settle-modal.active');
    await p.locator('[data-action="settle-pay"]').click(); await p.waitForSelector('#cpay-modal.active');
    assert.equal(await p.locator('#cpay-evid').inputValue(), 'E3');
    await p.locator('#cpay-amt').fill('10000'); await p.locator('#btn-save-cpay').click(); await p.waitForTimeout(500);
    assert.equal(await p.evaluate(async () => (await (await import('./db.js')).exportAllData()).cPays.filter(x => x.evId === 'E3').reduce((s, x) => s + x.amt, 0)), 10000);
  });

  await test('restore: the sheet says Merge keeps everything added since the backup and Replace removes it; Merge says so after', async () => {
    await p.reload(); await p.waitForSelector('#kpi .card');
    const backup = await p.evaluate(async () => JSON.stringify(await (await import('./db.js')).exportAllData()));
    await p.setInputFiles('#import-input', { name: 'caterdesk-backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
    await p.waitForSelector('#ask-modal.active');
    const msg = await p.locator('#ask-msg').innerText();
    assert.match(msg, /Merge adds the backup's records and removes nothing: everything added on this phone since the backup stays/);
    assert.match(msg, /Replace makes this phone exactly like the backup: everything added since it was made is removed/);
    const merge = p.getByRole('button', { name: /^Merge/ });
    assert.match(await merge.getAttribute('class'), /btn-secondary/, 'Merge is not the highlighted choice');
    await merge.click(); await p.waitForTimeout(800);
    assert.match(await p.locator('#toast-msg').innerText(), /Merged: nothing on this phone was removed. To go back to the backup exactly, import it again with Replace/);
  });

  await test('counter: 200 guests at 75% suggests 150; 165 typed is ordered, kept on reopen, and checked against the minimum', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
      await db.putOne('events', { id: 'E4', name: 'Sample Counter Party', date: day(10), venue: 'Sample Hall', type: 'Birthday – वाढदिवस', guests: 200, billing: 160000,
        mealPlan: { dinner: { guests: 200, rate: 800 } }, meals: ['dinner'], photoIds: [], dishes: [{ name: 'Masala Dosa', head: 'Dosa – डोसा' }] }); });
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="E4"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    await p.locator('[data-action="order-new"][data-id^="Dosa"]').click();
    await p.locator('#ord-ven').selectOption('vd');
    await p.locator('#ord-min').fill(''); // the minimum remembered from the last dosa order (250) would lift the suggestion
    await p.locator('#ord-takeup').fill('75');
    assert.equal(await p.locator('#ord-plates').inputValue(), '150', 'suggested 75% of 200');
    await p.locator('#ord-plates').fill('165');
    await p.locator('#ord-takeup').fill('70');
    assert.equal(await p.locator('#ord-plates').inputValue(), '165', 'a new take-up does not overwrite the typed 165');
    await p.locator('#ord-takeup').fill('75');
    await p.locator('#ord-min').fill('170');
    await pickTime(p, 'ord-time'); await p.locator('#btn-save-ord').click(); await p.waitForTimeout(400);
    assert.equal(await p.locator('#ord-modal').isVisible(), true, '165 is below the minimum of 170: a note is asked for');
    await p.locator('#ord-notes').fill('client expects a smaller crowd');
    await pickTime(p, 'ord-time'); await p.locator('#btn-save-ord').click(); await p.waitForTimeout(500);
    const ev4 = () => p.evaluate(async () => (await (await import('./db.js')).exportAllData()).events.find(x => x.id === 'E4'));
    let o = (await ev4()).orders[0];
    assert.deepEqual([o.plates, o.suggested, o.belowMinimum, o.status], [165, 170, 170, 'prepared'], 'ordered 165; the plan proposed 150 lifted to the 170 minimum; below-minimum recorded');
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="E4"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    await p.locator(`[data-action="order-status"][data-id="${o.id}"]`).click();
    await p.getByRole('button', { name: /^Edit \/ send again/ }).click();
    assert.equal(await p.locator('#ord-plates').inputValue(), '165', 'reopened: still 165');
  });

  await test('past event: the payment plan stays visible; a delivered order without a bill is flagged and blocks reconciling; nothing is invented as an expense', async () => {
    // E2 has the 25% plan from the Codex test; move it to yesterday
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const { _rev, ...e } = d.events.find(x => x.id === 'E2');
      const y = new Date(); y.setDate(y.getDate() - 1); await db.putOne('events', { ...e, date: y.toISOString().slice(0, 10) }); });
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="E2"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    assert.equal(await p.locator('#pay-schedule').isVisible(), true, 'the schedule is shown after the event');
    assert.match(await p.locator('#pay-schedule').innerText(), /Overdue/);
    assert.equal(await p.locator('#pay-schedule [data-action="plan-edit"]').isVisible(), true);
    // E4's order delivered, no bill yet: nothing is invented as an expense, and reconciling is blocked
    const r = await p.evaluate(async () => { const db = await import('./db.js'), u = await import('./utils.js'); const d = await db.exportAllData(); const { _rev, ...e } = d.events.find(x => x.id === 'E4');
      const e2 = { ...e, orders: e.orders.map(o => ({ ...o, status: 'delivered' })) }; await db.putOne('events', e2);
      const d2 = await db.exportAllData(); const ev = d2.events.find(x => x.id === 'E4');
      return { costs: u.calcEventExpenses('E4', d2.expenses), blockers: u.reconBlockers(ev, d2.expenses).map(b => b.en) }; });
    assert.equal(r.costs, 0, 'a delivered order is not an expense until its bill is recorded');
    assert.ok(r.blockers.includes('1 delivered order has no bill from that vendor yet'));
  });

  await test('meal menu sheet in Marathi: typed dishes are added on Save, not dropped', async () => {
    await p.evaluate(() => localStorage.setItem('ffv2_lang', 'mr'));
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const { _rev, dishes, services, ...e } = d.events.find(x => x.id === 'E1'); await db.putOne('events', e); });
    await openEvent();
    await p.locator('[data-action="svc-edit"]').first().click();
    await p.locator('#svc-add').fill('पनीर मसाला, जिलेबी');
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(500);
    assert.deepEqual((await ev()).dishes.map(d => d.name), ['पनीर मसाला', 'जिलेबी']);
    await p.evaluate(() => localStorage.setItem('ffv2_lang', 'en'));
  });

  await test('owner scenario: backup A, add test event B; Merge keeps B, Replace (after the safety copy) removes it and restores A exactly', async () => {
    await p.reload(); await p.waitForSelector('#kpi .card');
    const A = await p.evaluate(async () => (await import('./db.js')).exportAllData());
    const counts = d => ['events', 'expenses', 'cPays', 'vendors', 'vPays'].map(k => d[k].length);
    await p.evaluate(async () => { const db = await import('./db.js'); await db.putOne('events', { id: 'EB', name: 'Sample Test Event B', date: '2026-12-01', venue: 'Sample Hall', type: 'Birthday – वाढदिवस', guests: 20, photoIds: [] }); });
    const importA = async () => { await p.reload(); await p.waitForSelector('#kpi .card');
      await p.setInputFiles('#import-input', { name: 'backup-A.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(A)) });
      await p.waitForSelector('#ask-modal.active'); };
    await importA();
    const msg = await p.locator('#ask-msg').innerText();
    assert.match(msg, /This phone now: \d+ events/);
    assert.match(msg, /Replace would remove 1 event that the backup does not have \(events: Sample Test Event B\)/);
    await p.getByRole('button', { name: /^Merge/ }).click(); await p.waitForTimeout(800);
    assert.ok((await p.evaluate(async () => (await import('./db.js')).exportAllData())).events.some(e => e.id === 'EB'), 'Merge keeps B');
    await importA();
    await p.getByRole('button', { name: /^Replace all data/ }).click();
    await p.waitForSelector('#ask-modal.active');
    const dl = p.waitForEvent('download');
    await p.getByRole('button', { name: /^Save a copy to this phone/ }).click();
    assert.match((await dl).suggestedFilename(), /^caterdesk-before-restore-.*\.json$/);
    await p.getByRole('button', { name: /^The copy is saved/ }).click(); await p.waitForTimeout(1000);
    const after = await p.evaluate(async () => (await import('./db.js')).exportAllData());
    assert.equal(after.events.some(e => e.id === 'EB'), false, 'Replace removes B');
    assert.deepEqual(counts(after), counts(A), 'A restored exactly');
    assert.deepEqual(after.expenses.map(x => [x.id, x.amt]).sort(), A.expenses.map(x => [x.id, x.amt]).sort());
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'full-event-fixes FAIL' : 'full-event test fixes (plan %, meal dishes, orders) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('full-event-fixes FAIL'); process.exitCode = 1; });
