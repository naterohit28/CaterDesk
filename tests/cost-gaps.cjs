// 5.3.3 (owner, 26 Nov 2026): an event must not look finished or profitable while its costs are incomplete. Warned
// about (never blocked, never changed): usual costs from the last similar reconciled event not recorded, no labour
// cost, labour lines without a rate. Shown on the event as "Costs incomplete", listed when reconciling (which then
// asks "Reconcile anyway?"), and on Home for every past event not yet reconciled. Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const GROCERY = 'Grocery – किराणा', ICE = 'Ice – बर्फ', BOYS = 'Boys – बॉईज';
const EV = (id, name, n, extra = {}) => ({ id, name, date: day(n), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 100, photoIds: [], ...extra });
const X = (id, evId, cat, head, amt) => ({ id, evId, cat, head, amt, date: day(-40), pay: 'paid', mode: 'UPI', billIds: [] });
const DATA = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [], vendors: [],
  events: [
    EV('R', 'Sample Reference Event', -60),
    EV('A', 'Sample Incomplete Event', -3, { labour: { rows: [{ id: 'r1', role: BOYS, count: 4 }] } }),
    EV('B', 'Sample Outsourced Event', -5, { outsourced: true }),
    EV('C', 'Sample Older Event', -30),
    EV('D', 'Sample Complete Event', -4)],
  expenses: [
    X('r1', 'R', 'Raw Material', GROCERY, 5000), X('r2', 'R', 'Labour', BOYS, 3000), X('r3', 'R', 'Raw Material', ICE, 500),
    X('a1', 'A', 'Raw Material', GROCERY, 4000),
    X('b1', 'B', 'Live Counter', 'Chaat – चाट', 9000),
    X('c1', 'C', 'Raw Material', GROCERY, 4500),
    X('d1', 'D', 'Raw Material', GROCERY, 4800), X('d2', 'D', 'Labour', BOYS, 2800), X('d3', 'D', 'Raw Material', ICE, 450)] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const openEvent = async name => { await p.locator('#n-events:visible').click(); await p.waitForTimeout(300);
    await p.locator('#ev-filters button').first().click().catch(() => {});
    await p.locator('#ev-list [data-action="evdetail"]', { hasText: name }).first().click(); await p.waitForSelector('#tab-evdetail.active'); };
  const reconcile = async () => { await p.locator('[data-action="recon-open"]').click(); await p.waitForSelector('#recon-modal.active');
    for (const b of await p.locator('#recon-checks input').all()) await b.check();
    await p.locator('#btn-save-recon').click(); await p.waitForTimeout(400); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });
  // The reference event is reconciled, so its costs are the usual ones
  await p.evaluate(async d => { const u = await import('./utils.js'), db = await import('./db.js');
    const r = d.events.find(e => e.id === 'R'); Object.assign(r, u.reconcileFields(r, d.expenses, u.RECON_CHECKS.map(c => c.id)));
    await db.importAllData(d, 'replace'); }, DATA());
  await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' });

  await test('what looks missing: usual costs, labour lines without a rate; nothing for complete or outsourced events', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js'), d = await (await import('./db.js')).exportAllData();
      return Object.fromEntries(d.events.map(e => [e.id, u.costGaps(e, d.events, d.expenses).map(g => [g.kind, g.n, g.en])])); });
    assert.deepEqual(r.A.map(g => g.slice(0, 2)), [['usual', 2], ['rates', 1]]);
    assert.match(r.A[0][2], /2 usual costs not recorded \(from Sample Reference Event\): Boys, Ice/);
    assert.deepEqual(r.D, []); assert.deepEqual(r.B, []); assert.deepEqual(r.R, []);
    assert.deepEqual(r.C.map(g => g.slice(0, 2)), [['usual', 2]]);
  });

  await test('Home lists every past event not yet reconciled with incomplete costs, older than two weeks too', async () => {
    const t = (await p.locator('#check-costs').innerText()).replace(/\s+/g, ' ');
    assert.match(t, /Sample Incomplete Event.*2 usual costs not recorded · 1 labour line has no rate yet.*Sample Older Event.*2 usual costs not recorded/);
    assert.ok(!/Complete Event|Outsourced|Reference/.test(t));
    assert.ok(!t.includes('<'), 'no markup shown as text');
  });

  await test('the event says "Costs incomplete" and what is missing', async () => {
    await openEvent('Sample Incomplete Event');
    assert.equal(await p.locator('#recon-card .chip').first().innerText(), 'Costs incomplete');
    assert.match(await p.locator('#recon-gaps').innerText(), /2 usual costs not recorded[\s\S]*1 labour line has no rate yet/);
    assert.ok(!(await p.locator('#recon-gaps').innerText()).includes('<'), 'no markup shown as text');
  });

  await test('reconciling lists the gaps and asks first; Go back changes nothing, Reconcile anyway closes it', async () => {
    const before = (await dump()).events.find(e => e.id === 'A');
    await reconcile();
    assert.match(await p.locator('#recon-gap-list').innerText(), /usual costs not recorded/);
    await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-title').innerText(), /Costs look incomplete/);
    assert.match(await p.locator('#ask-msg').innerText(), /Boys, Ice[\s\S]*Reconcile only if these really were not spent/);
    await p.locator('#ask-actions button', { hasText: 'Go back' }).click(); await p.waitForTimeout(300);
    assert.deepEqual((await dump()).events.find(e => e.id === 'A'), before, 'nothing saved');
    await p.locator('#btn-save-recon').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Reconcile anyway' }).click(); await p.waitForTimeout(600);
    const a = (await dump()).events.find(e => e.id === 'A');
    assert.ok(a.recon, 'reconciled after confirming'); assert.equal(a.billing, before.billing);
    const x = (await dump()).expenses.filter(e => e.evId === 'A'); assert.equal(x.length, 1, 'no cost added or changed'); assert.equal(x[0].amt, 4000);
  });

  await test('an event with every usual cost reconciles without the extra question', async () => {
    await openEvent('Sample Complete Event');
    assert.equal(await p.locator('#recon-card .chip').first().innerText(), 'Costs pending');
    await reconcile();
    assert.equal(await p.locator('#ask-modal.active').count(), 0);
    assert.ok((await dump()).events.find(e => e.id === 'D').recon);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'cost-gaps FAIL' : 'incomplete costs are warned about before an event is called final PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('cost-gaps FAIL'); process.exit(1); });
