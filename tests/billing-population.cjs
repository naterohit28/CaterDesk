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

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'billing population FAIL' : 'billing population PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('billing population FAIL'); process.exitCode = 1; });
