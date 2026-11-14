// Phase 5 learning from past events (spec §12.1, G-22): suggestions only from reconciled events, each with its sources;
// "not enough history" instead of guessing; Use / Ignore. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const W = 'Wedding – लग्न';
const ev = (id, name, date, extra) => ({ id, name, date, venue: 'Sample Lawns', type: W, photoIds: [], ...extra });
const x = (id, evId, head, amt, extra = {}) => ({ id, evId, cat: extra.cat || 'Raw Material', head, amt, date: day(-30), pay: 'paid', billIds: [], ...extra });
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [],
  vendors: [{ id: 'vd', name: 'Sample Dosa Counter', cat: 'Live Counter' }],
  events: [
    ev('E1', 'Sample Wedding One', day(-90), { guests: 300, billing: 300000, menu: 'golden', orders: [{ id: 'o1', head: 'Dosa – डोसा', venId: 'vd', plates: 250, status: 'delivered' }],
      labour: { rows: [{ id: 'r1', role: 'Boys – बॉईज', rate: 550, counts: { e: 10 } }], pay: 'paid', mode: '', expIds: {} } }),
    ev('E2', 'Sample Wedding Two', day(-60), { guests: 500, billing: 450000, menu: 'golden', venue: 'Other Hall', orders: [{ id: 'o2', head: 'Dosa – डोसा', venId: 'vd', plates: 400, status: 'delivered' }] }),
    ev('E3', 'Sample Wedding Three', day(-30), { guests: 400, billing: 400000, menu: 'silver',
      labour: { rows: [{ id: 'r2', role: 'Boys – बॉईज', rate: 600, counts: { e: 12 } }], pay: 'paid', mode: '', expIds: {} } }),
    ev('E4', 'Sample Unfinished', day(-10), { guests: 400, billing: 400000, menu: 'golden' }),                // not reconciled: never learned from
    ev('T', 'Sample Upcoming', day(15), { guests: 400, billing: 380000, menu: 'golden', dishes: [{ name: 'Masala Dosa', head: 'Dosa – डोसा' }] }),
    ev('B', 'Sample Birthday', day(20), { guests: 100, billing: 60000, type: 'Birthday – वाढदिवस', venue: 'Somewhere Else' })],
  expenses: [x('a1', 'E1', 'Grocery – किराणा', 180000), x('a2', 'E1', 'Dosa – डोसा', 30000, { cat: 'Live Counter', venId: 'vd' }), x('a3', 'E1', 'Generator – जनरेटर', 8000, { cat: 'Operations' }),
    x('b1', 'E2', 'Grocery – किराणा', 348000), x('b2', 'E2', 'Dosa – डोसा', 52000, { cat: 'Live Counter', venId: 'vd' }),
    x('c1', 'E3', 'Grocery – किराणा', 231000), x('c2', 'E3', 'Generator – जनरेटर', 9000, { cat: 'Operations' }),
    x('d1', 'E4', 'Grocery – किराणा', 800000)] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const tips = id => p.evaluate(async id => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData(); return u.pastSuggestions(d.events.find(e => e.id === id), d.events, d.expenses); }, id);
  const openEvent = async id => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator(`#ev-list [data-action="evdetail"][data-id="${id}"]:visible`).click(); await p.waitForSelector('#tab-evdetail .detail-name'); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  await p.evaluate(async () => { const db = await import('./db.js'), u = await import('./utils.js'); const d = await db.exportAllData();
    for (const id of ['E1', 'E2', 'E3']) { const { _rev, ...e } = d.events.find(x => x.id === id); await db.putOne('events', { ...e, ...u.reconcileFields(e, d.expenses, ['bills', 'shared', 'final']) }); } });

  await test('G-22: expected cost comes only from reconciled events on the same menu (₹763/plate), never from the unfinished one', async () => {
    const t = await tips('T'), cost = t.find(s => s.kind === 'cost');
    assert.deepEqual([cost.basis, cost.perPlate, cost.total, cost.src.n, cost.src.ids.sort()], ['menu', 763, 305200, 2, ['E1', 'E2']]);
    assert.equal(cost.src.ids.includes('E4'), false);
    const price = t.find(s => s.kind === 'price'); assert.deepEqual([price.perPlate, price.margin], [950, 19]);
  });

  await test('vendor per counter, latest labour rates, and charges at the same venue – each with its sources', async () => {
    const t = await tips('T');
    const c = t.find(s => s.kind === 'counter'); assert.deepEqual([c.head, c.venId, c.perPlate, c.src.n], ['Dosa – डोसा', 'vd', 125, 2]);
    const l = t.find(s => s.kind === 'labour'); assert.deepEqual(l.roles, [{ role: 'Boys – बॉईज', rate: 600, n: 2, last: DATA.events[2].date }]);
    const v = t.find(s => s.kind === 'venue'); assert.deepEqual(v.charges, [{ head: 'Generator – जनरेटर', amt: 8500, n: 2 }]); assert.equal(v.src.n, 2);
  });

  await test('not enough history: says so instead of guessing', async () => {
    const t = await tips('B');
    assert.deepEqual(t.map(s => s.kind), ['insufficient', 'labour'], 'labour rates are not tied to event type'); assert.equal(t[0].n, 0);
    await openEvent('B'); assert.match(await p.locator('#past-card').innerText(), /Expected cost: not enough history yet[\s\S]*found 0/);
  });

  await test('event page: "From your past events" with sources; Use as budget; Ignore hides it for this event only', async () => {
    await openEvent('T');
    const card = await p.locator('#past-card').innerText();
    for (const re of [/Expected cost ₹763\/plate · ₹3,05,200 for 400/, /Middle value of events on the Golden menu/, /2 reconciled events · .* · Sample Wedding Two, Sample Wedding One/,
      /Similar events billed ₹950\/plate · 19% contribution/, /Dosa: Sample Dosa Counter · ₹125\/plate ordered/, /Labour rates last paid\s*Boys ₹600/, /Charges at Sample Lawns before\s*Generator ₹8,500 \(2×\)/]) assert.match(card, re);
    await p.locator('[data-tip-use="cost"]').click(); await p.waitForTimeout(400);
    let e = (await p.evaluate(async () => (await import('./db.js')).exportAllData())).events.find(x => x.id === 'T');
    assert.equal(e.budget, 305200);
    await p.locator('[data-tip-ignore="venue"]').click(); await p.waitForTimeout(400);
    e = (await p.evaluate(async () => (await import('./db.js')).exportAllData())).events.find(x => x.id === 'T');
    assert.deepEqual(e.hiddenTips, ['venue']); assert.doesNotMatch(await p.locator('#past-card').innerText(), /Charges at/);
    assert.equal((await tips('E4')).some(s => s.kind === 'venue'), true, 'other events still get it');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });

  await test('a reconciled event shows no suggestions; Ignore choices survive backup; bad values refused', async () => {
    await openEvent('E1'); assert.equal(await p.locator('#past-card').count(), 0);
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); await db.importAllData(JSON.parse(JSON.stringify(d)), 'replace');
      const after = (await db.exportAllData()).events.find(e => e.id === 'T').hiddenTips;
      const c = await db.exportAllData(); delete c.manifest; c.events.find(e => e.id === 'T').hiddenTips = 'venue';
      let err = ''; try { await db.importAllData(c, 'replace'); } catch (e) { err = e.message; } return [after, err]; });
    assert.deepEqual(r, [['venue'], 'Invalid suggestion settings']);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'learning FAIL' : 'learning from past events (G-22, §12.1) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('learning FAIL'); process.exitCode = 1; });
