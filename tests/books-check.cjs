// Phase 4 P4-D (spec §10, Phase 4 exit gate): the owner's Books check reconciles bills, event costs, stock, payables
// and receivables; a delivered order with no bill blocks reconciliation. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // local date, as the app uses
const ev = (id, name, billing, extra = {}) => ({ id, name, date: day(-3), venue: 'Sample Hall', type: 'Wedding – लग्न', billing, guests: 100, photoIds: [], ...extra });
const DATA = { version: 'ffv2', photos: [],
  vendors: [{ id: 'vg', name: 'Sample Grocer', cat: 'Raw Material' }, { id: 'vd', name: 'Sample Dosa Counter', cat: 'Live Counter' }, { id: 'vt', name: 'Sample Tempo', cat: 'Operations' }],
  events: [ev('A', 'Sample Event A', 200000, { billChanges: [{ at: '2026-01-01T00:00:00.000Z', from: 205000, to: 200000, reason: 'round figure', kind: 'discount', ack: 'written', taxReview: true }] }),
    ev('B', 'Sample Event B', 150000, { dispute: { amt: 10000, reason: 'plates disputed', at: '2026-01-01T00:00:00.000Z' },
      orders: [{ id: 'od', head: 'Dosa – डोसा', venId: 'vd', plates: 200, status: 'delivered' }] }),
    ev('C', 'Sample Event C', 50000)],
  expenses: [
    { id: 'p1', evId: 'A', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 20000, date: day(-3), pay: 'credit', venId: 'vg', billIds: [], split: { id: 'S1', total: 40000 } },
    { id: 'p2', evId: 'B', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 15000, date: day(-3), pay: 'credit', venId: 'vg', billIds: [], split: { id: 'S1', total: 40000 } },
    { id: 'p3', evId: '', stock: true, cat: 'Raw Material', head: 'Grocery – किराणा', amt: 5000, date: day(-3), pay: 'credit', venId: 'vg', billIds: [], split: { id: 'S1', total: 40000 } },
    { id: 't1', evId: 'C', cat: 'Operations', head: 'Transport – वाहतूक', amt: 6000, date: day(-3), pay: 'credit', venId: 'vt', billIds: [] },
    { id: 'k1', evId: 'A', cat: 'Raw Material', head: 'Milk – दूध', amt: 2500.5, date: day(-3), pay: 'paid', mode: 'Cash – रोख', billIds: [] }],
  vPays: [{ id: 'v1', venId: 'vg', amt: 30000, date: day(-1), mode: 'UPI' }, { id: 'v2', venId: 'vg', amt: 1000, date: day(-1), kind: 'credit', notes: 'CN-1' },
    { id: 'v3', venId: 'vt', amt: 7000, date: day(-1), mode: 'UPI' }],
  cPays: [{ id: 'c1', evId: 'A', amt: 200000, date: day(-1), mode: 'UPI' }, { id: 'c2', evId: 'B', amt: 100000, date: day(-1), mode: 'UPI' }, { id: 'c3', evId: 'C', amt: 52000, date: day(-1), mode: 'UPI' }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const books = () => p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData(); return u.booksCheck(d.events, d.expenses, d.cPays, d.vPays); });
  const reports = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-summary:visible').click();
    await p.locator('#tab-summary [data-period-seg] [data-id="all"]').click(); await p.waitForSelector('#books-check'); return p.locator('#books-check').innerText(); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);

  await test('Books check: every bill rupee is on one event or in stock; payables, advances, receivables and adjustments shown apart', async () => {
    const b = await books();
    assert.deepEqual({ spent: b.spent, eventCosts: b.eventCosts, stock: b.stock, unplaced: b.unplaced, splits: b.splits, badSplits: b.badSplits },
      { spent: 48500.5, eventCosts: 43500.5, stock: 5000, unplaced: 0, splits: 1, badSplits: 0 });
    assert.deepEqual({ owed: b.owed, advance: b.advance, creditNotes: b.creditNotes }, { owed: 9000, advance: 1000, creditNotes: 1000 }, 'grocer 40k − 30k − 1k CN; tempo overpaid 1k');
    assert.deepEqual({ receivable: b.receivable, overReceived: b.overReceived, disputed: b.disputed, adjusted: b.adjusted, unbilled: b.unbilled },
      { receivable: 50000, overReceived: 2000, disputed: 10000, adjusted: 5000, unbilled: 1 });
    assert.equal(b.ok, true);
    const t = await reports();
    for (const re of [/Bills ₹48,500\.50? = event costs ₹43,500\.50? \+ common stock ₹5,000/, /1 shared bill, every part adds up/, /Owed to vendors \(after ₹1,000 credit notes\)\s*₹9,000/,
      /Advances paid to vendors\s*₹1,000/, /Clients still owe, ₹10,000 disputed\s*₹50,000/, /Received more than the bill \(refund or bill change\?\)\s*₹2,000/,
      /Discounts \/ waivers \/ write-offs agreed \(tax review needed\)\s*₹5,000/, /1 delivered order has no bill yet/]) assert.match(t, re);
  });

  await test('a shared bill whose parts no longer add up is caught', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const { _rev, ...x } = d.expenses.find(e => e.id === 'p2'); await db.putOne('expenses', { ...x, amt: 14000 }); });
    const b = await books(); assert.deepEqual([b.badSplits, b.ok], [1, false]);
    assert.match(await reports(), /1 shared bill does not add up to its parts/);
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const { _rev, ...x } = d.expenses.find(e => e.id === 'p2'); await db.putOne('expenses', { ...x, amt: 15000 }); });
    assert.equal((await books()).ok, true);
  });

  await test('a delivered order with no bill from its vendor keeps the event from being reconciled, until the bill is in', async () => {
    const blockers = () => p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData(); return u.reconBlockers(d.events.find(e => e.id === 'B'), d.expenses).map(b => b.en); });
    assert.deepEqual(await blockers(), ['1 delivered order has no bill from that vendor yet']);
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="B"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    await p.locator('[data-action="recon-open"]').click(); await p.waitForSelector('#recon-modal.active');
    assert.match(await p.locator('#recon-block').innerText(), /1 delivered order has no bill from that vendor yet/);
    assert.equal(await p.locator('#btn-save-recon').isDisabled(), true);
    await p.evaluate(async () => { const db = await import('./db.js'); await db.putOne('expenses', { id: 'd1', evId: 'B', cat: 'Live Counter', head: 'Dosa – डोसा', amt: 16000, date: new Date().toISOString().slice(0, 10), pay: 'credit', venId: 'vd', billIds: [], order: 'od' }); });
    assert.deepEqual(await blockers(), []); assert.equal((await books()).unbilled, 0);
  });

  await test('property: on any valid books (random bills, splits, stock, payments, credit notes) the totals reconcile exactly', async () => {
    const bad = await p.evaluate(async () => { const u = await import('./utils.js'); let seed = 11, bad = 0; const rnd = n => (seed = (seed * 16807) % 2147483647) % n;
      for (let round = 0; round < 150; round++) {
        const events = Array.from({ length: 1 + rnd(4) }, (_, i) => ({ id: 'E' + i, billing: rnd(500000), date: '2026-01-01' }));
        const expenses = [], vPays = [], cPays = []; let sumP = 0;
        for (let b = 0; b < 1 + rnd(6); b++) {
          const total = (1 + rnd(9000000)) / 100, n = 1 + rnd(4), parts = u.equalSplit(total, n), venId = 'V' + rnd(3), pay = rnd(3) ? 'credit' : 'paid', sid = 'S' + b;
          parts.forEach((amt, j) => { const stock = j === n - 1 && rnd(2) === 0; expenses.push({ id: sid + '-' + j, evId: stock ? '' : events[rnd(events.length)].id, stock: stock || undefined, venId, pay, amt, date: '2026-01-01', ...(n > 1 ? { split: { id: sid, total } } : {}) }); });
          sumP += u.toPaise(total);
        }
        for (let k = 0; k < rnd(5); k++) vPays.push({ id: 'P' + k, venId: 'V' + rnd(3), amt: (1 + rnd(5000000)) / 100, ...(rnd(4) === 0 ? { kind: 'credit' } : {}) });
        for (const e of events) if (rnd(2)) cPays.push({ id: 'C' + e.id, evId: e.id, amt: rnd(600000) });
        const b = u.booksCheck(events, expenses, cPays, vPays);
        const creditP = expenses.filter(x => x.pay === 'credit').reduce((s, x) => s + u.toPaise(x.amt), 0), paidP = vPays.reduce((s, p) => s + u.toPaise(p.amt), 0);
        const billsP = events.reduce((s, e) => s + u.toPaise(e.billing), 0), recP = cPays.reduce((s, c) => s + u.toPaise(c.amt), 0);
        if (!b.ok || u.toPaise(b.spent) !== sumP || u.toPaise(b.eventCosts) + u.toPaise(b.stock) !== sumP
          || u.toPaise(b.owed) - u.toPaise(b.advance) !== creditP - paidP
          || u.toPaise(b.receivable) - u.toPaise(b.overReceived) !== billsP - recP) bad++;
        // Payments never move event costs
        const before = events.map(e => u.calcEventExpenses(e.id, expenses)).join(), after = events.map(e => u.calcEventExpenses(e.id, expenses)).join();
        if (before !== after) bad++;
      }
      return bad; });
    assert.equal(bad, 0);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'books check FAIL' : 'books check: bills, stock, payables and receivables reconcile PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('books check FAIL'); process.exitCode = 1; });
