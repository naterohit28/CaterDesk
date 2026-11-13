// P1-B reconciliation (D-4): explicit status separate from the event's date, owner checklist, unpaid bills
// counted, reopen with history when costs/bill/guests change, contribution vs net profit labels,
// reconciled-only benchmarks (G-12, G-22) and integer-paise rounding. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const base = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [],
  vendors: [{ id: 'v1', name: 'Sample Counter', cat: 'Live Counter' }, { id: 'v2', name: 'Sample Grocer', cat: 'Raw Material' }],
  events: [
    { id: 'g12', name: 'Sample Reception', date: day(-3), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 300000, guests: 300, menu: 'golden', photoIds: [] },
    { id: 'old', name: 'Sample Old Party', date: day(-40), venue: 'Sample Lawn', type: 'Wedding – लग्न', billing: 200000, guests: 200, menu: 'golden', photoIds: [] },
    { id: 'soon', name: 'Sample Upcoming', date: day(5), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 100, photoIds: [] },
    { id: 'bare', name: 'Sample No Costs', date: day(-2), venue: 'Sample Hall', type: 'Birthday – वाढदिवस', billing: 50000, guests: 50, photoIds: [] }],
  expenses: [
    { id: 'a1', evId: 'g12', cat: 'Live Counter', head: 'Chaat – चाट', amt: 66000, date: day(-3), pay: 'paid', venId: 'v1' },
    { id: 'a2', evId: 'g12', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 75000, date: day(-3), pay: 'credit', venId: 'v2', dueDate: day(10) },   // unpaid: still a cost
    { id: 'b1', evId: 'old', cat: 'Live Counter', head: 'Chaat – चाट', amt: 40000, date: day(-40), pay: 'paid', venId: 'v1' },
    { id: 'b2', evId: 'old', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 60000, date: day(-40), pay: 'paid', venId: 'v2' }]
});

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const seed = async data => { await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, data); await p.reload(); await p.waitForSelector('#kpi .card'); };
  const u = (fn, arg) => p.evaluate(async ([src, arg]) => { const u = await import('./utils.js'); return new Function('u', 'arg', 'return (' + src + ')(u, arg)')(u, arg); }, [fn.toString(), arg]);
  const stored = id => p.evaluate(async id => (await (await import('./db.js')).exportAllData()).events.find(e => e.id === id), id);
  const openEvent = async id => { await p.locator('#n-events:visible').click(); await p.locator(`#ev-list [data-action="evdetail"][data-id="${id}"]:visible`).click(); await p.waitForSelector('#tab-evdetail #recon-card, #tab-evdetail .card'); };
  const text = sel => p.locator(sel).first().innerText();
  const contrib = () => p.locator('#tab-evdetail .metric', { has: p.locator('.label', { hasText: /Contribution|Commission/ }) }).first();
  const cLabel = () => contrib().locator('.label').innerText(), cAmt = () => contrib().locator('.amt-md').innerText();
  const reconcile = async () => {
    await p.locator('[data-action="recon-open"]').click(); await p.waitForSelector('#recon-modal.active');
    assert.equal(await p.locator('#btn-save-recon').isDisabled(), true, 'not until every check is ticked');
    const boxes = p.locator('#recon-checks input'); assert.equal(await boxes.count(), 3);
    await boxes.nth(0).check(); await boxes.nth(1).check();
    assert.equal(await p.locator('#btn-save-recon').isDisabled(), true);
    await boxes.nth(2).check(); await p.locator('#btn-save-recon').click();
    await p.waitForSelector('#recon-card .chip.pos');
  };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');

  await test('money is added in whole paise with one rounding rule', async () => {
    const r = await u(u => [u.toPaise(0.1) + u.toPaise(0.2), u.sumRupees([{ amt: 0.1 }, { amt: 0.2 }]), u.toPaise(1.005), u.toPaise(2.675), u.toPaise(-2.345), u.toPaise(18000.25), u.toPaise('12.5'), u.toPaise(NaN),
      u.sumRupees(Array.from({ length: 1000 }, () => ({ amt: 0.01 }))), u.calcEventPL({ id: 'e', billing: 1000.1 }, [], [{ evId: 'e', amt: 333.33 }, { evId: 'e', amt: 333.33 }, { evId: 'e', amt: 333.34 }]).profit]);
    assert.deepEqual(r, [30, 0.3, 101, 268, -235, 1800025, 1250, 0, 10, 0.1]);
  });

  await seed(base());
  await test('legacy events load as costs pending without any record being changed', async () => {
    const before = await stored('old');
    await openEvent('old');
    assert.match(await text('#recon-card'), /Costs pending/);
    assert.match(await cLabel(), /Contribution · provisional/);
    assert.deepEqual(await stored('old'), before, 'opening the event wrote nothing');
    assert.equal('recon' in before, false);
  });

  await test('operational status is separate: an upcoming event has no reconciliation card', async () => {
    await openEvent('soon'); assert.equal(await p.locator('#recon-card').count(), 0);
  });

  await test('an event with no costs cannot be reconciled (checks disabled, reason shown)', async () => {
    await openEvent('bare');
    await p.locator('[data-action="recon-open"]').click(); await p.waitForSelector('#recon-modal.active');
    assert.match(await text('#recon-block'), /No costs are recorded/);
    assert.equal(await p.locator('#recon-checks input:disabled').count(), 3);
    assert.equal(await p.locator('#btn-save-recon').isDisabled(), true);
    await p.locator('#recon-modal [data-action="close-modal"]').click(); await p.waitForTimeout(200);
  });

  await test('G-12 unpaid bill counted; ₹1.65 lakh provisional, then a ₹75k late bill: ₹90k, reopened, reconciled again with history', async () => {
    // Start without the grocery bill: provisional contribution 300000 − 60000 − 75000 is shown after it arrives
    const d = base(); d.expenses = d.expenses.filter(x => x.id !== 'a2'); d.expenses.push({ id: 'a3', evId: 'g12', cat: 'Labour', head: 'Boys – बॉईज', amt: 69000, date: day(-3), pay: 'paid' });
    await seed(d);
    await openEvent('g12');
    assert.match(await cAmt(), /1,65,000/);
    await p.locator('[data-action="recon-open"]').click(); await p.waitForSelector('#recon-modal.active');
    assert.match(await text('#recon-sum'), /1,35,000/); await p.locator('#recon-modal [data-action="close-modal"]').click(); await p.waitForTimeout(200);
    await reconcile();
    assert.match(await cLabel(), /^Contribution/); assert.doesNotMatch(await cLabel(), /provisional/);
    let ev = await stored('g12');
    assert.deepEqual(ev.recon.checks, ['bills', 'shared', 'final']); assert.equal(ev.recon.costPaise, 13500000); assert.equal(ev.reconHistory.length, 1);
    // Late vendor bill, unpaid
    await p.evaluate(async x => { const db = await import('./db.js'); await db.putOne('expenses', x); }, { id: 'late', evId: 'g12', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 75000, date: day(0), pay: 'credit', venId: 'v2', dueDate: day(15) });
    await p.reload(); await p.waitForSelector('#kpi .card'); await openEvent('g12');
    assert.match(await cAmt(), /90,000/);
    assert.match(await cLabel(), /provisional/);
    assert.match(await text('#recon-card'), /Changed after reconciling/); assert.match(await text('#recon-card'), /1,35,000 → ₹2,10,000/);
    await p.locator('[data-action="recon-open"]').click(); await p.waitForSelector('#recon-modal.active');
    assert.match(await text('#recon-sum'), /75,000 still on credit \(counted\)/);
    await p.locator('#recon-modal [data-action="close-modal"]').click(); await p.waitForTimeout(200);
    await reconcile();
    ev = await stored('g12');
    assert.deepEqual(ev.reconHistory.map(h => h.action), ['reconciled', 'reopened', 'reconciled']);
    assert.deepEqual(ev.reconHistory[1].changes, [{ what: 'costs', from: 135000, to: 210000 }]);
    assert.equal(ev.recon.costPaise, 21000000);
    await p.locator('#recon-card summary').click(); assert.match(await text('#recon-card details'), /History \(3\)/);
  });

  await test('a changed bill or guest count reopens it; manual reopen keeps history', async () => {
    const ev = await stored('g12');
    for (const [patch, what] of [[{ billing: 310000 }, /Bill ₹3,00,000 → ₹3,10,000/], [{ guests: 320 }, /Guests 300 → 320/]]) {
      await p.evaluate(async r => { const db = await import('./db.js'); await db.putOne('events', r); }, { ...ev, ...patch });
      await p.reload(); await p.waitForSelector('#kpi .card'); await openEvent('g12');
      assert.match(await text('#recon-card'), what);
    }
    await p.evaluate(async r => { const db = await import('./db.js'); await db.putOne('events', r); }, (({ _rev, ...r }) => r)(ev));
    await p.reload(); await p.waitForSelector('#kpi .card'); await openEvent('g12');
    assert.match(await text('#recon-card'), /Reconciled/);
    await p.locator('[data-action="recon-reopen"]').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button').first().click(); await p.waitForSelector('#recon-card .chip.due');
    const after = await stored('g12');
    assert.equal(after.recon, null); assert.deepEqual(after.reconHistory.map(h => h.action), ['reconciled', 'reopened', 'reconciled', 'reopened']);
    assert.equal(after.reconHistory[3].reason, 'manual');
  });

  await test('a cost saved elsewhere while the checklist is open is never hidden by the reconciliation', async () => {
    await seed(base()); await openEvent('g12');
    await p.locator('[data-action="recon-open"]').click(); await p.waitForSelector('#recon-modal.active');
    for (let i = 0; i < 3; i++) await p.locator('#recon-checks input').nth(i).check();
    // Another tab or device saves a new cost for this event before Save is tapped here
    await p.evaluate(async d => { const db = await import('./db.js'); await db.putOne('expenses', { id: 'mid', evId: 'g12', cat: 'Labour', head: 'Boys – बॉईज', amt: 5000, date: d, pay: 'paid' }); }, day(0));
    await p.locator('#btn-save-recon').click(); await p.waitForTimeout(400);
    await p.reload(); await p.waitForSelector('#kpi .card'); await openEvent('g12');
    const ev = await stored('g12');
    if (ev.recon) { assert.equal(ev.recon.costPaise, 14100000, 'snapshot of the costs this screen showed'); assert.match(await text('#recon-card'), /Changed after reconciling/); assert.match(await text('#recon-card'), /1,41,000 → ₹1,46,000/); }
    else assert.match(await text('#recon-card'), /Costs pending/);
    assert.match(await cLabel(), /provisional/, 'the unseen cost keeps the contribution provisional');
  });

  await test('bill photos still to be filled in for the event block reconciling', async () => {
    const d = base(); d.expenses.push({ id: 'dr', draft: true, evId: 'g12', amt: 0, date: day(0), cat: '', head: '', pay: 'paid', billIds: [], createdAt: new Date().toISOString() });
    await seed(d); await openEvent('g12');
    await p.locator('[data-action="recon-open"]').click(); await p.waitForSelector('#recon-modal.active');
    assert.match(await text('#recon-block'), /1 bill photo for this event still to be filled in/);
    assert.equal(await p.locator('#btn-save-recon').isDisabled(), true);
    await p.locator('#recon-modal [data-action="close-modal"]').click(); await p.waitForTimeout(200);
  });

  await test('G-22 benchmarks (menu cost/plate, quote helper, cost vs usual, spend creep) use reconciled events only', async () => {
    await seed(base());
    const data = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
    const calc = async () => { const d = await data(); return p.evaluate(async d => { const u = await import('./utils.js');
      return { menu: u.menuCostPerPlate('golden', d.events, d.expenses, 'new'), creep: u.priceCreep(d.expenses, d.events).length,
        usual: !!u.costVsUsual(d.events.find(e => e.id === 'g12'), d.events, u.costByCategory(d.events, d.expenses), u.reconciledIds(d.events, d.expenses)) }; }, d); };
    assert.deepEqual(await calc(), { menu: null, creep: 0, usual: false }, 'nothing reconciled: no benchmark at all (not a partial one)');
    await openEvent('old'); await reconcile();
    assert.deepEqual(await calc(), { menu: { n: 1, perPlate: 500 }, creep: 0, usual: true });
    await openEvent('g12'); await reconcile();
    const r = await calc(); assert.equal(r.menu.n, 2); assert.equal(r.menu.perPlate, 482); assert.equal(r.creep, 1, 'only the counter rose per plate (₹200 → ₹220); grocery fell');
    // Quote helper in the event form uses the same reconciled-only figure
    await p.locator('#n-events:visible').click(); await p.locator('#fab').click(); await p.waitForSelector('#ev-modal.active');
    await p.selectOption('#ev-menu', 'golden'); await p.fill('#ev-guests', '100'); await p.locator('#ev-guests').dispatchEvent('input');
    assert.match(await text('#ev-quote'), /usually costs you ₹482\/plate \(2 reconciled events\)/);
    await p.locator('#ev-modal [data-action="close-modal"]').click(); await p.waitForTimeout(300);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
  });

  await test('G-22 an unreconciled event never moves a benchmark, however extreme its costs', async () => {
    // Two reconciled Golden events (old, g12) from the previous test; add a pending Golden event with absurd costs
    const ref = await p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData();
      return { menu: u.menuCostPerPlate('golden', d.events, d.expenses, 'new'), creep: JSON.stringify(u.priceCreep(d.expenses, d.events)),
        usual: JSON.stringify(u.costVsUsual(d.events.find(e => e.id === 'g12'), d.events, u.costByCategory(d.events, d.expenses), u.reconciledIds(d.events, d.expenses))) }; });
    await p.evaluate(async x => { const db = await import('./db.js');
      await db.putOne('events', { id: 'wild', name: 'Sample Pending Outlier', date: x.d, venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 100, menu: 'golden', photoIds: [] });
      await db.putOne('expenses', { id: 'w1', evId: 'wild', cat: 'Live Counter', head: 'Chaat – चाट', amt: 900000, date: x.d, pay: 'credit', venId: 'v1' });
      await db.putOne('expenses', { id: 'w2', evId: 'wild', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 1, date: x.d, pay: 'paid', venId: 'v2' }); }, { d: day(-1) });
    await p.reload(); await p.waitForSelector('#kpi .card');
    const now = await p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData();
      return { menu: u.menuCostPerPlate('golden', d.events, d.expenses, 'new'), creep: JSON.stringify(u.priceCreep(d.expenses, d.events)),
        usual: JSON.stringify(u.costVsUsual(d.events.find(e => e.id === 'g12'), d.events, u.costByCategory(d.events, d.expenses), u.reconciledIds(d.events, d.expenses))),
        pending: u.reconStatus(d.events.find(e => e.id === 'wild'), d.expenses).state }; });
    assert.equal(now.pending, 'pending');
    assert.deepEqual({ menu: now.menu, creep: now.creep, usual: now.usual }, ref, 'menu cost/plate, spend per plate and cost vs usual unchanged');
    // Quote helper and the Reports menu/type averages also ignore it
    await p.locator('#n-events:visible').click(); await p.locator('#fab').click(); await p.waitForSelector('#ev-modal.active');
    await p.selectOption('#ev-menu', 'golden'); await p.fill('#ev-guests', '100'); await p.locator('#ev-guests').dispatchEvent('input');
    assert.match(await text('#ev-quote'), /usually costs you ₹482\/plate \(2 reconciled events\)/);
    await p.locator('#ev-modal [data-action="close-modal"]').click(); await p.waitForTimeout(300);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
    await p.locator('#n-summary:visible').click(); await p.locator('#tab-summary [data-period-seg] [data-id="all"]').click();
    const rep = await text('#summary-content');
    assert.match(rep, /Menu contribution ranking[\s\S]*Golden[\s\S]*2 events · bill ₹1,000 · cost ₹482 per plate/);
    assert.match(rep, /Sample Pending Outlier[\s\S]*provisional/, 'the event itself is still listed, marked provisional');
    await p.evaluate(async () => { const db = await import('./db.js'); for (const id of ['w1', 'w2']) await db.deleteOne('expenses', id); await db.deleteOne('events', 'wild'); });
    await p.reload(); await p.waitForSelector('#kpi .card');
  });

  await test('reports show contribution, not net profit, with the provisional count', async () => {
    await p.locator('#n-summary:visible').click(); await p.locator('#tab-summary [data-period-seg] [data-id="all"]').click();
    const body = await text('#summary-content');
    assert.match(body, /Contribution/); assert.doesNotMatch(body, /Net profit/);
    assert.match(body, /2 of 4 final · before overheads/);
    assert.match(body, /Vendor spend per plate rising/); assert.match(body, /Not the vendor’s rate/);
    await p.locator('#n-home:visible').click(); assert.match(await text('#kpi .hero'), /Event contribution/); assert.match(await text('#kpi .hero'), /2 provisional/);
  });

  await test('backup keeps reconciliation and history; damaged reconciliation data is refused', async () => {
    const d = await p.evaluate(async () => (await import('./db.js')).exportAllData());
    const ev = d.events.find(e => e.id === 'g12'); assert(ev.recon && ev.reconHistory.length);
    const out = await p.evaluate(async d => { const db = await import('./db.js'); const res = [];
      for (const bad of [{ recon: 'yes' }, { recon: { costPaise: 1.5, billPaise: 1, sig: 'x' } }, { reconHistory: [{ action: 'deleted' }] }]) {
        const copy = structuredClone(d); delete copy.manifest; Object.assign(copy.events[0], bad);
        try { await db.importAllData(copy, 'replace'); res.push('accepted'); } catch (e) { res.push(e.message); } }
      await db.importAllData(d, 'replace'); const back = (await db.exportAllData()).events.find(e => e.id === 'g12'); res.push(back.recon.costPaise, back.reconHistory.length); return res; }, d);
    assert.deepEqual(out.slice(0, 3), ['Invalid reconciliation', 'Invalid reconciliation', 'Invalid reconciliation history']);
    assert.deepEqual(out.slice(3), [ev.recon.costPaise, ev.reconHistory.length]);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'reconciliation FAIL' : 'reconciliation (D-4, G-12, G-22, paise) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('reconciliation FAIL'); process.exitCode = 1; });
