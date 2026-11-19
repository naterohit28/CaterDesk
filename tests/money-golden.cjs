// Stage 2 – independent money check. A fixed set of synthetic events, bills and payments whose every figure was worked
// out by hand (the arithmetic is written next to each expected value). The app's money functions and the screens the
// owner reads (Home, Reports, Books check, event page) must show exactly these rupees and paise.
// Synthetic "Sample" data only; fixed past dates so nothing depends on today.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const W = 'Wedding – लग्न';
const ev = (id, name, date, extra) => ({ id, name, date, venue: 'Sample Hall', type: W, photoIds: [], ...extra });
const x = (id, evId, head, amt, extra = {}) => ({ id, evId, cat: 'Raw Material', head, amt, date: '2026-01-18', billIds: [], ...extra });
const split = { id: 'S1', total: 10000.01 };
const DATA = { version: 'ffv2', photos: [],
  vendors: [{ id: 'vd', name: 'Sample Dosa Counter', cat: 'Live Counter' }, { id: 'vg', name: 'Sample Gas Supplier', cat: 'Operations' }, { id: 'vk', name: 'Sample Grocer', cat: 'Raw Material' }],
  events: [
    // A: 200 plates × ₹800 = ₹1,60,000 bill; GST 5% on ₹1,60,000 = ₹8,000; client owes ₹1,68,000
    ev('A', 'Sample Golden Wedding', '2026-01-20', { guests: 200, billing: 160000, mealPlan: { dinner: { guests: 200, rate: 800 } },
      gst: { rate: 5, taxable: 160000, amount: 8000, from: 'q1' } }),
    // B: bill ₹90,000 lowered to ₹85,000 by an agreed discount at settlement; ₹2,000 of what is left is disputed
    ev('B', 'Sample Golden Reception', '2026-01-25', { guests: 100, billing: 85000,
      billChanges: [{ at: '2026-02-01T00:00:00.000Z', from: 90000, to: 85000, kind: 'discount', reason: 'agreed', ack: 'written', taxReview: true }],
      dispute: { amt: 2000, reason: 'plates', at: '2026-02-01T00:00:00.000Z' } }),
    // C: no bill yet; its cost and its advance are kept out of contribution and pending
    ev('C', 'Sample Golden Engagement', '2026-02-05', { guests: 50, billing: 0 }),
    // D: bill ₹20,000, client paid ₹20,500 (₹500 too much)
    ev('D', 'Sample Golden Birthday', '2026-02-10', { guests: 40, billing: 20000 })],
  expenses: [
    x('x1', 'A', 'Grocery – किराणा', 52345.5, { pay: 'paid', mode: 'Cash – रोख' }),
    x('x2', 'A', 'Dosa – डोसा', 18000, { cat: 'Live Counter', pay: 'credit', venId: 'vd' }),
    x('x3', 'A', 'Labour – मजूर', 12600, { cat: 'Labour', pay: 'paid', mode: 'Cash – रोख' }),
    // one gas bill of ₹10,000.01 shared three ways (equalSplit): A ₹3,333.33, B ₹3,333.33, common stock ₹3,333.35
    x('s1', 'A', 'Gas – गॅस', 3333.33, { cat: 'Operations', pay: 'credit', venId: 'vg', split }),
    x('s2', 'B', 'Gas – गॅस', 3333.33, { cat: 'Operations', pay: 'credit', venId: 'vg', split }),
    x('s3', '', 'Gas – गॅस', 3333.35, { cat: 'Operations', pay: 'credit', venId: 'vg', split, stock: true }),
    x('x4', 'B', 'Grocery – किराणा', 41000.75, { pay: 'credit', venId: 'vk' }),
    x('x5', 'C', 'Grocery – किराणा', 2500, { pay: 'paid', mode: 'UPI' }),
    x('x6', 'D', 'Grocery – किराणा', 9999.99, { pay: 'paid', mode: 'UPI' })],
  cPays: [{ id: 'c1', evId: 'A', amt: 35000, date: '2026-01-02', mode: 'UPI' }, { id: 'c2', evId: 'A', amt: 100000, date: '2026-01-22', mode: 'NEFT' },
    { id: 'c3', evId: 'B', amt: 80000, date: '2026-01-26', mode: 'UPI' }, { id: 'c4', evId: 'C', amt: 10000, date: '2026-01-30', mode: 'UPI' },
    { id: 'c5', evId: 'D', amt: 20500, date: '2026-02-10', mode: 'Cash – रोख' }],
  vPays: [{ id: 'v1', venId: 'vd', amt: 10000, date: '2026-01-21', mode: 'UPI', billKey: 'x2' }, { id: 'v2', venId: 'vd', amt: 1000, date: '2026-01-21', kind: 'credit', notes: 'CN-1' },
    { id: 'v3', venId: 'vg', amt: 12000, date: '2026-01-21', mode: 'UPI' }, { id: 'v4', venId: 'vk', amt: 41000.75, date: '2026-01-27', mode: 'NEFT' }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  // Runs `fn(u, d)` in the page with utils and the saved data
  const calc = (fn, arg) => p.evaluate(async ([src, arg]) => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData();
    return (0, eval)(src)(u, d, arg); }, [fn.toString(), arg]);
  const allTime = async () => { await p.locator('[data-period-seg]:visible [data-id="all"]').click(); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);

  await test('paise arithmetic: no float drift, one rounding rule, shared bills and percentages never gain or lose a paisa', async () => {
    const r = await calc(u => ({ sum: u.sumRupees([{ amt: 0.1 }, { amt: 0.2 }]), half: u.toPaise(1.005), neg: u.toPaise(-2.345),
      eq: u.equalSplit(10000.01, 3), split: u.checkSplit([{ evId: 'A', amt: 3333.33 }, { evId: 'B', amt: 3333.33 }, { evId: '__stock', amt: 3333.35 }], 10000.01),
      off: u.checkSplit([{ evId: 'A', amt: 3333.33 }, { evId: 'B', amt: 3333.33 }], 10000.01),
      margin: u.priceForMargin(700, 30), markup: u.priceForMarkup(700, 30), mPct: u.marginPct(910, 700), uPct: u.markupPct(1000, 700),
      fmt: [u.fmtCurrency(146446.25), u.fmtCurrency(2500.5), u.fmtCurrency(1200000), u.fmtCurrency(-500)] }));
    assert.equal(r.sum, 0.3, '₹0.10 + ₹0.20 = ₹0.30 exactly');
    assert.deepEqual([r.half, r.neg], [101, -235], '₹1.005 → 101 paise; −₹2.345 → −235 paise (half rounds away from zero)');
    assert.deepEqual(r.eq, [3333.33, 3333.33, 3333.35], '₹10,000.01 ÷ 3: 333333 + 333333 + 333335 paise = 1000001');
    assert.equal(r.split, '');
    assert.match(r.off, /add up to 6666\.66, not the bill's 10000\.01/);
    assert.deepEqual([r.margin, r.markup, r.mPct, r.uPct], [1000, 910, 23.08, 42.86], '700 ÷ 0.7 = 1000; 700 × 1.3 = 910; 210/910 = 23.08%; 300/700 = 42.86%');
    assert.deepEqual(r.fmt, ['₹1,46,446.25', '₹2,500.50', '₹12,00,000', '-₹500'], 'Indian grouping, paise as two digits');
  });

  await test('quote and meal totals: guests × rate per meal, items, discount, GST on the owner\'s taxable amount', async () => {
    const r = await calc(u => ({ q: u.quoteTotal({ lines: [{ kind: 'meal', meal: 'dinner', guests: 200, rate: 800 }, { kind: 'item', amt: 12000.5 }, { kind: 'discount', amt: 2000.25 }],
      gst: { rate: 5, taxable: 170000.25 } }), m: u.mealPlanTotal({ breakfast: { guests: 35, rate: 120.5 }, dinner: { guests: 200, rate: 800 }, lunch: { guests: 80, rate: 0 } }) }));
    // 1,60,000 + 12,000.50 − 2,000.25 = 1,70,000.25; 5% of 1,70,000.25 = 8,500.0125 → ₹8,500.01; grand 1,78,500.26
    assert.deepEqual([r.q.total, r.q.gst, r.q.grand], [170000.25, 8500.01, 178500.26]);
    // 35 × 120.50 = 4,217.50; 200 × 800 = 1,60,000; lunch at rate 0 is left out → 1,64,217.50
    assert.deepEqual([r.m.total, r.m.lines.map(l => [l.meal, l.total])], [164217.5, [['breakfast', 4217.5], ['dinner', 160000]]]);
  });

  await test('each event: received, costs, contribution, margin, per plate and what is left to collect', async () => {
    const r = await calc((u, d) => Object.fromEntries(d.events.map(e => [e.id, u.calcEventPL(e, d.cPays, d.expenses)])));
    // A costs 52,345.50 + 18,000 + 12,600 + 3,333.33 = 86,278.83; contribution 1,60,000 − 86,278.83 = 73,721.17 (46.08% → 46)
    // pending 1,68,000 (bill + GST) − 1,35,000 = 33,000; cost per plate 86,278.83 ÷ 200 = 431.39 → 431; contribution per plate 368.61 → 369
    assert.deepEqual([r.A.received, r.A.expTotal, r.A.profit, r.A.margin, r.A.pending, r.A.billPerPlate, r.A.costPerPlate, r.A.profitPerPlate],
      [135000, 86278.83, 73721.17, 46, 33000, 800, 431, 369]);
    // B costs 3,333.33 + 41,000.75 = 44,334.08; contribution 85,000 − 44,334.08 = 40,665.92 (47.84% → 48); pending 85,000 − 80,000 = 5,000
    assert.deepEqual([r.B.received, r.B.expTotal, r.B.profit, r.B.margin, r.B.pending], [80000, 44334.08, 40665.92, 48, 5000]);
    // D contribution 20,000 − 9,999.99 = 10,000.01 (50%); paid ₹500 more than owed
    assert.deepEqual([r.D.expTotal, r.D.profit, r.D.margin, r.D.pending], [9999.99, 10000.01, 50, -500]);
    assert.deepEqual([r.C.expTotal, r.C.received], [2500, 10000]);
  });

  await test('settlement per event: billed, received, outstanding, overpaid, disputed and agreed reductions kept apart', async () => {
    const r = await calc((u, d) => Object.fromEntries(d.events.map(e => [e.id, u.settlementStatus(e, d.cPays)])));
    const pick = s => [s.billed, s.received, s.outstanding, s.over, s.disputed, s.adjusted, s.taxReview];
    assert.deepEqual(pick(r.A), [168000, 135000, 33000, 0, 0, 0, false], 'A: 1,68,000 − 1,35,000');
    assert.deepEqual(pick(r.B), [85000, 80000, 5000, 0, 2000, 5000, true], 'B: 90,000 → 85,000 (5,000 discount); 85,000 − 80,000; 2,000 of it disputed');
    assert.equal(r.B.original, 90000);
    assert.deepEqual(pick(r.C), [0, 10000, 0, 0, 0, 0, false], 'C: no bill → owes nothing yet; the 10,000 is an advance');
    assert.deepEqual(pick(r.D), [20000, 20500, 0, 500, 0, 0, false], 'D: 500 received over the bill');
  });

  await test('client payment plan: % milestones add up to the bill to the paisa; due now and overdue follow the dates', async () => {
    const r = await calc((u, d) => {
      const A = d.events.find(e => e.id === 'A');
      const plan = { ...A, payPlan: [{ id: 'm1', when: 'booking', pct: 25 }, { id: 'm2', when: 'before', days: 7, pct: 50 }] };
      const thirds = { ...A, payPlan: [{ id: 't1', when: 'booking', pct: 33.33 }, { id: 't2', when: 'before', days: 7, pct: 33.33 }, { id: 't3', when: 'after', days: 1, pct: 33.33 }] };
      return { early: u.paymentSchedule(plan, d.cPays.filter(c => c.id === 'c1'), '2026-01-15'), late: u.paymentSchedule(plan, d.cPays, '2026-01-25'),
        thirds: u.paymentSchedule(thirds, [], '2026-01-01') };
    });
    const rows = s => s.rows.map(x => [x.amount, x.paid, x.rest, x.dueDate, x.state]);
    // 1,68,000: 25% = 42,000 on booking; 75% − 25% = 84,000 seven days before (13 Jan); balance 42,000 the day after (21 Jan)
    // On 15 Jan with ₹35,000 paid: booking 7,000 left (due), 84,000 overdue, balance upcoming
    assert.deepEqual(rows(r.early), [[42000, 35000, 7000, '', 'due'], [84000, 0, 84000, '2026-01-13', 'overdue'], [42000, 0, 42000, '2026-01-21', 'upcoming']]);
    assert.deepEqual([r.early.dueNow, r.early.overdue, r.early.outstanding, r.early.unscheduled], [91000, 84000, 133000, 42000]);
    // On 25 Jan with ₹1,35,000 paid: the balance has 9,000 paid and 33,000 overdue
    assert.deepEqual(rows(r.late)[2], [42000, 9000, 33000, '2026-01-21', 'overdue']);
    assert.deepEqual([r.late.dueNow, r.late.overdue], [33000, 33000]);
    // 33.33% × 3 of 1,68,000: 55,994.40 each (running totals 55,994.40 / 1,11,988.80 / 1,67,983.20) + balance 16.80 = 1,68,000.00
    assert.deepEqual(r.thirds.rows.map(x => x.amount), [55994.4, 55994.4, 55994.4, 16.8]);
    assert.equal(Math.round(r.thirds.rows.reduce((s, x) => s + x.amount * 100, 0)), 16800000);
  });

  await test('vendors: what each is owed after payments, a paid-against bill and a credit note; an overpayment is an advance', async () => {
    const r = await calc((u, d) => ({ bal: Object.fromEntries(['vd', 'vg', 'vk'].map(v => [v, u.calcVendorBalance(v, d.expenses, d.vPays)])),
      unpaid: u.unpaidBills(d.expenses, d.vPays).map(b => [b.key, b.owed, b.left]) }));
    // Dosa: 18,000 on credit − 10,000 paid − 1,000 credit note = 7,000
    assert.deepEqual([r.bal.vd.credit, r.bal.vd.paid, r.bal.vd.credits, r.bal.vd.balance], [18000, 10000, 1000, 7000]);
    // Gas: the shared bill 10,000.01 (all three parts, stock included) − 12,000 paid = −1,999.99 (an advance)
    assert.deepEqual([r.bal.vg.credit, r.bal.vg.balance], [10000.01, -1999.99]);
    assert.equal(r.bal.vk.balance, 0, 'Grocer: 41,000.75 − 41,000.75');
    // Unpaid bills: only the dosa bill, 18,000 owed with 7,000 left; the shared gas bill is one bill, fully paid
    assert.deepEqual(r.unpaid, [['x2', 18000, 7000]]);
  });

  await test('Books check: every bill rupee placed once; payables, advances, receivables, disputes and reductions', async () => {
    const b = await calc((u, d) => u.booksCheck(d.events, d.expenses, d.cPays, d.vPays));
    // Bills 86,278.83 (A) + 44,334.08 (B) + 2,500 (C) + 9,999.99 (D) = 1,43,112.90 on events + 3,333.35 stock = 1,46,446.25
    assert.deepEqual([b.spent, b.eventCosts, b.stock, b.unplaced, b.splits, b.badSplits, b.ok], [146446.25, 143112.9, 3333.35, 0, 1, 0, true]);
    assert.deepEqual([b.owed, b.advance, b.creditNotes], [7000, 1999.99, 1000]);
    // Clients owe 33,000 (A) + 5,000 (B) = 38,000; D paid 500 over; 2,000 disputed; 5,000 agreed discount
    assert.deepEqual([b.receivable, b.overReceived, b.disputed, b.adjusted, b.unbilled], [38000, 500, 2000, 5000, 0]);
  });

  await test('Home and Reports totals: billed events only; the event without a bill is kept apart', async () => {
    // Home and Reports work on sliceByPeriod, which keeps common stock out (it is no event's cost yet)
    const s = await calc((u, d) => { const P = u.sliceByPeriod(d, 'all'); const b = u.billingSplit(P.events, P.expenses, P.cPays); return { ...b, billed: b.billed.length }; });
    // Billed 1,60,000 + 85,000 + 20,000 = 2,65,000. Event costs 1,43,112.90 (stock ₹3,333.35 left out), less C's 2,500 (no bill)
    // = 1,40,612.90. Contribution 2,65,000 − 1,40,612.90 = 1,24,387.10; margin 46.94% → 47%.
    assert.deepEqual([s.billed, s.unbilled, s.billP, s.expP, s.awaitP, s.contribP, s.margin], [3, 1, 26500000, 14311290, 250000, 12438710, 47]);
    // Received 35,000 + 1,00,000 + 80,000 + 10,000 + 20,500 = 2,45,500, of which 10,000 is C's advance.
    // Due 1,68,000 + 85,000 + 20,000 = 2,73,000; pending 33,000 + 5,000 + 0 (D's 500 over never cancels another's balance) = 38,000
    assert.deepEqual([s.recP, s.advP, s.dueP, s.pendingP], [24550000, 1000000, 27300000, 3800000]);
  });

  await test('the screens show the same rupees: Home, Reports with the Books check, and an event page', async () => {
    await p.reload(); await p.waitForSelector('#kpi .card'); await allTime();
    const home = await p.locator('#kpi').innerText();
    // collected (2,45,500 − 10,000) ÷ 2,73,000 = 86.26% → 86%
    for (const re of [/contribution · All time\s*₹1,24,387\.10/, /47% margin on ₹2,65,000 billed · 4 events/, /Received\s*₹2,45,500/, /Pending\s*₹38,000/,
      /Expenses\s*₹1,43,112\.90/, /To collect\s*₹38,000/, /To pay\s*₹7,000/,/₹2,500 of costs and ₹10,000 received are on 1 event without a bill yet/, /86% of billing collected/]) assert.match(home, re);
    await p.locator('#n-summary:visible').click(); await allTime(); await p.waitForSelector('#books-check');
    const rep = await p.locator('#summary-content').innerText();
    for (const re of [/Contribution[\s\S]{0,20}₹1,24,387\.10/, /Margin[\s\S]{0,20}47%/, /Billed[\s\S]{0,20}₹2,65,000/,
      /Bills ₹1,46,446\.25 = event costs ₹1,43,112\.90 \+ common stock ₹3,333\.35/, /1 shared bill, every part adds up/,
      /Owed to vendors \(after ₹1,000 credit notes\)\s*₹7,000/, /Advances paid to vendors\s*₹1,999\.99/, /Clients still owe, ₹2,000 disputed\s*₹38,000/,
      /Received more than the bill \(refund or bill change\?\)\s*₹500/, /Discounts \/ waivers \/ write-offs agreed \(tax review needed\)\s*₹5,000/,
      /Sample Golden Wedding[\s\S]*?₹73,721\.17/, /Sample Golden Reception[\s\S]*?₹40,665\.92/, /Sample Golden Birthday[\s\S]*?₹10,000\.01/]) assert.match(rep, re);
    await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="A"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    const a = await p.locator('#tab-evdetail').innerText();
    for (const re of [/₹1,60,000/, /₹1,35,000/, /₹86,278\.83/, /₹73,721\.17/, /₹33,000/]) assert.match(a, re);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'money-golden FAIL' : 'independent money check (golden figures) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('money-golden FAIL'); process.exitCode = 1; });
