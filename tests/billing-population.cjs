// One billed event and one event without a bill (4.28.2): Home and Reports compute contribution, margin and pending
// from events with a bill only; the unbilled event's costs stay recorded and are shown as awaiting billing; its advance
// stays in Received and never reduces another event's pending; no pending is made up for it. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const x = (id, evId, amt) => ({ id, evId, cat: 'Raw Material', head: 'Vegetables – भाजी', amt, date: day(-2), pay: 'paid', mode: 'UPI', billIds: [] });
const DATA = { version: 'ffv2', photos: [], vPays: [], vendors: [],
  events: [{ id: 'eb', name: 'Sample Billed Wedding', date: day(-1), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 100, photoIds: [], mobile: '9000000041' },
    { id: 'eu', name: 'Sample Unbilled Party', date: day(-1), venue: 'Sample Lawn', type: 'Party – पार्टी', billing: 0, guests: 80, photoIds: [], mobile: '9000000042' }],
  expenses: [x('x1', 'eb', 30000), x('x2', 'eu', 12000)],
  cPays: [{ id: 'p1', evId: 'eb', amt: 60000, date: day(-3), mode: 'UPI' }, { id: 'p2', evId: 'eu', amt: 20000, date: day(-3), mode: 'UPI' }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const home = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); };
  const metric = async (root, label) => (await p.locator(`${root} .metric`).filter({ has: p.locator('.label', { hasText: label }) }).first().innerText()).split('\n').slice(1).join(' ');

  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(() => localStorage.setItem('ffv2_period', 'all'));
  await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA);

  await test('Home: contribution and margin from the billed event only; all costs and payments still shown; no pending made up', async () => {
    await home();
    const hero = await p.locator('#kpi .hero').innerText();
    assert.match(hero, /₹70,000/, 'contribution = ₹1,00,000 bill − ₹30,000 of its costs');
    assert.match(hero, /70% margin on ₹1,00,000 billed · 2 events · .*1 without a bill yet/);
    assert.equal(await metric('#kpi .hero', 'Received'), '₹80,000', 'the advance on the unbilled event stays recorded');
    assert.equal(await metric('#kpi .hero', 'Pending'), '₹40,000', 'only the billed event is owed; the advance does not reduce it');
    assert.equal(await metric('#kpi .hero', 'Expenses'), '₹42,000', 'every cost is recorded and visible');
    assert.match(await p.locator('#kpi-awaiting').innerText(), /₹12,000 of costs and ₹20,000 received are on 1 event without a bill yet/);
    assert.match(hero, /60% of billing collected/);
  });

  await test('Reports: the same population; the unbilled event is listed apart, never as a ₹0 revenue event', async () => {
    await home(); await p.locator('#n-summary:visible').click(); await p.waitForTimeout(400);
    const tiles = await p.locator('#summary-content .metric-tiles').innerText();
    assert.match(tiles, /Contribution\s*₹70,000/); assert.match(tiles, /Margin\s*70%/); assert.match(tiles, /Billed\s*₹1,00,000/); assert.match(tiles, /Events\s*2\s*1 without a bill/);
    assert.match(await p.locator('#contrib-awaiting').innerText(), /₹12,000 of costs awaiting billing \(1 event without a bill\)/);
    assert.match(await p.locator('#tab-summary .bar-row[data-id="eu"]').innerText(), /no bill yet[\s\S]*—/);
    assert.doesNotMatch(await p.locator('#tab-summary .bar-row[data-id="eu"]').innerText(), /₹/);
    assert.match(await p.locator('#tab-summary .bar-row[data-id="eb"]').innerText(), /₹70,000/);
    const board = await p.locator('#summary-content').innerText();
    assert.match(board, /Biggest events[\s\S]*Sample Billed Wedding/); assert.doesNotMatch(board.split('Biggest events')[1], /Sample Unbilled Party/);
  });

  await test('event details: the unbilled event shows its costs and advance, with no bill, pending, contribution or "fully paid"', async () => {
    await home(); await p.locator('#n-events:visible').click(); await p.locator('#ev-list [data-action="evdetail"][data-id="eu"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    assert.equal(await p.locator('#ev-bill-unset').innerText(), 'Not set');
    assert.equal(await p.locator('#ev-pending').innerText(), '—');
    assert.equal(await p.locator('#ev-contrib-unset').innerText(), '—');
    assert.equal(await metric('#tab-evdetail', 'Received'), '₹20,000');
    assert.match(await metric('#tab-evdetail', 'Expenses'), /₹12,000/);
    const receipt = decodeURIComponent(await p.locator('#tab-evdetail a[aria-label="Send receipt on WhatsApp"]').first().getAttribute('href'));
    assert.match(receipt, /Total bill: to be confirmed/); assert.match(receipt, /Received as an advance/); assert.doesNotMatch(receipt, /Fully paid|₹0/);
    // the billed event is unchanged
    await p.locator('#n-events:visible').click(); await p.locator('#ev-list [data-action="evdetail"][data-id="eb"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    assert.equal(await p.locator('#ev-pending').innerText(), '₹40,000');
    assert.match(await p.locator('#tab-evdetail').innerText(), /₹70,000/);
  });

  await test('records are untouched: reporting changes nothing stored, and the data backs up and restores as before', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData();
      const strip = a => JSON.stringify(a.map(({ _rev, ...x }) => x).sort((a, b) => a.id.localeCompare(b.id)));
      const before = ['events', 'expenses', 'cPays'].map(s => strip(d[s])).join('|');
      await db.importAllData(structuredClone(d), 'replace'); const after = await db.exportAllData();
      return { same: before === ['events', 'expenses', 'cPays'].map(s => strip(after[s])).join('|'), billing: after.events.find(e => e.id === 'eu').billing }; });
    assert.deepEqual(r, { same: true, billing: 0 });
  });

  // The owner's review table (Codex P2 findings on #68): five bill situations side by side
  const CASES = { version: 'ffv2', photos: [], vPays: [], vendors: [],
    events: [
      { id: 'c1', name: 'Sample No Bill Advance', date: day(-5), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 0, guests: 40, photoIds: [] },
      { id: 'c2', name: 'Sample Part Paid', date: day(-5), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 20000, guests: 40, photoIds: [] },
      { id: 'c3', name: 'Sample Overpaid', date: day(-5), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 20000, guests: 40, photoIds: [] },
      { id: 'c4', name: 'Sample Fully Waived', date: day(-5), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 0, guests: 40, photoIds: [],
        billChanges: [{ at: '2026-11-10T10:00:00.000Z', from: 10000, to: 0, reason: 'Sample full waiver', kind: 'waiver', ack: 'written', taxReview: true }] },
      { id: 'c5', name: 'Sample Never Billed', date: day(-5), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 0, guests: 40, photoIds: [],
        payPlan: [{ id: 'PM1', label: 'Advance', when: 'booking', amt: 5000 }, { id: 'PM2', label: 'Second', when: 'before', days: 2, amt: 5000 }] }],
    expenses: [x('k1', 'c1', 1000), x('k2', 'c2', 4000), x('k3', 'c3', 4000), x('k4', 'c4', 3000), x('k5', 'c5', 2000)],
    cPays: [{ id: 'q1', evId: 'c1', amt: 5000, date: day(-6), mode: 'UPI' }, { id: 'q2', evId: 'c2', amt: 5000, date: day(-6), mode: 'UPI' },
      { id: 'q3', evId: 'c3', amt: 25000, date: day(-6), mode: 'UPI' }] };
  const openEv = async id => { await home(); await p.locator('#n-events:visible').click(); await p.locator(`#ev-list [data-action="evdetail"][data-id="${id}"]:visible`).click(); await p.waitForSelector('#tab-evdetail .detail-name'); };

  await test('five bill situations: advance without a bill, part paid, overpaid, fully waived, never billed', async () => {
    await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, CASES);
    const r = await p.evaluate(async () => { const u = await import('./utils.js'), d = await (await import('./db.js')).exportAllData();
      const ev = id => d.events.find(e => e.id === id), st = id => u.settlementStatus(ev(id), d.cPays);
      return { set: ['c1', 'c2', 'c3', 'c4', 'c5'].map(id => u.billSet(ev(id))),
        c1: [st('c1').outstanding, st('c1').over], c2: [st('c2').outstanding, st('c2').over], c3: [st('c3').outstanding, st('c3').over], c4: [st('c4').adjusted, st('c4').taxReview],
        books: u.booksCheck(d.events, d.expenses, d.cPays, d.vPays).overReceived, receivable: u.booksCheck(d.events, d.expenses, d.cPays, d.vPays).receivable,
        split: (s => [s.contribP / 100, s.awaitP / 100, s.pendingP / 100])(u.billingSplit(d.events, d.expenses, d.cPays)) }; });
    assert.deepEqual(r.set, [false, true, true, true, false], 'a waived ₹0 bill is known; a 0 never set is not');
    assert.deepEqual(r.c1, [0, 0], 'no bill, ₹5,000 advance: nothing pending, no overpayment');
    assert.deepEqual(r.c2, [15000, 0], '₹20,000 bill, ₹5,000 received: ₹15,000 pending');
    assert.deepEqual(r.c3, [0, 5000], '₹20,000 bill, ₹25,000 received: ₹5,000 overpaid');
    assert.deepEqual(r.c4, [10000, true], 'fully waived: the ₹10,000 adjustment and its tax review stay recorded');
    assert.equal(r.books, 5000, 'the books check flags only the real overpayment, never the advance');
    assert.equal(r.receivable, 15000);
    // contribution: c2 16,000 + c3 16,000 + c4 −3,000 (the waived event's loss counts); c1 and c5 costs await billing
    assert.deepEqual(r.split, [29000, 3000, 15000]);
    await home(); await p.locator('#n-summary:visible').click(); await p.waitForTimeout(400);
    const books = await p.locator('#summary-content').innerText();
    assert.match(books, /Received more than the bill \(refund or bill change\?\)\s*₹5,000\b/, 'only the real ₹5,000 overpayment');
  });

  await test('a fully waived bill is a known ₹0 bill on its page: its loss shows, its settlement stands, reconciliation is not blocked', async () => {
    await openEv('c4');
    assert.equal(await p.locator('#ev-bill-unset').count(), 0, 'not "Not set"');
    assert.equal(await metric('#tab-evdetail', 'Bill'), '₹0');
    assert.match(await p.locator('#tab-evdetail').innerText(), /−₹3,000|-₹3,000/, 'the loss is shown');
    assert.match(await p.locator('#settle-line').innerText(), /Sample full waiver/);
    const blocked = await p.evaluate(async () => { const u = await import('./utils.js'), d = await (await import('./db.js')).exportAllData();
      return u.reconBlockers(d.events.find(e => e.id === 'c4'), d.expenses).map(b => b.en); });
    assert.equal(blocked.includes('The bill is not set yet'), false);
    // Home: the waived event's loss is a real loss; the never-billed event is not called a loss
    await home(); const ins = await p.locator('body').innerText();
    if (/made a loss/.test(ins)) { assert.match(ins, /made a loss: [^\n]*Sample Fully Waived/); assert.doesNotMatch(ins, /made a loss: [^\n]*Sample (Never Billed|No Bill Advance)/); }
    const insights = await p.evaluate(async () => { const u = await import('./utils.js'), d = await (await import('./db.js')).exportAllData();
      return u.generateInsights(d.events, d.cPays, d.expenses, d.vendors, d.vPays).map(i => i.en).join(' | '); });
    assert.match(insights, /1 event made a loss: <b>Sample Fully Waived<\/b>/);
  });

  await test('a plan made before the bill was cleared is paused (nothing due or overdue) and can still be removed', async () => {
    await openEv('c5');
    assert.match(await p.locator('#pay-paused').innerText(), /Payment plan paused until the bill is set \(2 milestones kept\)/);
    assert.doesNotMatch(await p.locator('#tab-evdetail').innerText(), /overdue|more than the bill/i);
    await p.locator('#pay-schedule [data-action="plan-edit"]').click(); await p.waitForSelector('#plan-modal.active');
    await p.locator('#btn-save-plan').first().click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#toast-msg').innerText(), /Set the bill before changing the plan/);
    for (let i = 0; i < 5 && await p.locator('#plan-modal [data-pm-del]').count(); i++)
      await p.locator('#plan-modal [data-pm-del]').first().click();
    await p.locator('#btn-save-plan').first().click(); await p.waitForTimeout(400);
    assert.equal(await p.evaluate(async () => (await (await import('./db.js')).exportAllData()).events.find(e => e.id === 'c5').payPlan), undefined, 'removed');
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'billing population FAIL' : 'billing population PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('billing population FAIL'); process.exitCode = 1; });
