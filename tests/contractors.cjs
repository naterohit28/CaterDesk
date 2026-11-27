// 5.4.0 (owner, 27 Nov 2026): suppliers and labour contractors are two lists on the Vendors tab, each with its own
// totals, so labour dues never mix with supplier dues. A contractor is a vendor saved under Labour; contractors are
// grouped by the worker type they supply (two contractors for Ghati are listed together); Add contractor starts with
// Labour chosen. No record changes. Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const GHATI = 'Ghati – घाटी', ROJIYA = 'Rojiya Labour – रोजीया मजूर';
const V = (id, name, cat, specialty = '', extra = {}) => ({ id, name, cat, specialty, ...extra });
const X = (id, venId, cat, head, amt) => ({ id, evId: 'E', cat, head, amt, date: day(-3), pay: 'credit', mode: '', venId, billIds: [] });
const DATA = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [],
  events: [{ id: 'E', name: 'Sample Gala', date: day(-3), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 100, photoIds: [] }],
  vendors: [V('s1', 'Sample Grocer', 'Raw Material', 'Grocery – किराणा'), V('s2', 'Sample Chaat Stall', 'Live Counter', 'Chaat – चाट'),
    V('c1', 'Sample Ghati Team A', 'Labour', GHATI), V('c2', 'Sample Ghati Team B', 'Labour', GHATI), V('c3', 'Sample Rojiya Mukadam', 'Labour', ROJIYA),
    V('c4', 'Sample Helper Group', 'Labour', ''), V('p1', 'Sample Lender', '', '', { kind: 'person' })],
  expenses: [X('x1', 's1', 'Raw Material', 'Grocery – किराणा', 5000), X('x2', 'c1', 'Labour', GHATI, 3000), X('x3', 'c3', 'Labour', ROJIYA, 1200)] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const text = async sel => (await p.locator(sel).innerText()).replace(/\s+/g, ' ');
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });
  await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA());
  await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' });
  const before = await dump();
  await p.locator('#n-vendors:visible').click(); await p.waitForTimeout(300);

  await test('Vendors opens on Suppliers: suppliers and other people, no contractors; supplier totals only', async () => {
    assert.match(await text('#ven-split'), /Suppliers 2 Contractors 4/);
    const t = await text('#ven-list');
    assert.match(t, /Sample Grocer/); assert.match(t, /Sample Chaat Stall/); assert.match(t, /Sample Lender/);
    assert.ok(!/Ghati|Rojiya|Helper/.test(t), 'no contractors here');
    assert.match(await text('#ven-sum'), /Total payable ₹5,000 .*Total vendors 2/);
    assert.match(await p.locator('#fab-label').innerText(), /Add vendor/);
  });

  await test('Contractors: grouped by worker type (both Ghati teams together), labour totals only', async () => {
    await p.locator('#ven-split [data-id="con"]').click(); await p.waitForTimeout(300);
    const groups = await p.locator('#ven-list .sec-title').allInnerTexts();
    assert.deepEqual(groups.map(g => g.split(' – ')[0]), ['Rojiya Labour', 'Ghati', 'Worker type not set']);
    assert.match(await text('#ven-list .ven-con[data-type="Ghati – घाटी"]'), /Sample Ghati Team A.*Sample Ghati Team B/);
    assert.ok(!/Grocer|Chaat|Lender/.test(await text('#ven-list')), 'no suppliers or people here');
    assert.match(await text('#ven-sum'), /Labour payable ₹4,200 .*Contractors 4/);
    assert.match(await p.locator('#fab-label').innerText(), /Add contractor/);
  });

  await test('Add contractor opens the vendor form with Labour chosen', async () => {
    await p.locator('#fab').click(); await p.waitForSelector('#ven-modal.active');
    assert.equal(await p.inputValue('#ven-cat'), 'Labour');
    await p.fill('#ven-name', 'Sample New Contractor'); await p.locator('#btn-save-ven').click(); await p.waitForTimeout(500);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
    const v = (await dump()).vendors.find(x => x.name === 'Sample New Contractor'); assert.equal(v.cat, 'Labour');
  });

  await test('search and To pay work inside the chosen list', async () => {
    await p.locator('#n-vendors:visible').click(); await p.waitForTimeout(300);
    if (await p.locator('#ven-split [data-id="con"][aria-pressed="false"]').count()) await p.locator('#ven-split [data-id="con"]').click();
    await p.locator('[data-action="ven-filter"][data-id="pay"]').click(); await p.waitForTimeout(300);
    const t = await text('#ven-list'); assert.match(t, /Sample Ghati Team A/); assert.match(t, /Sample Rojiya Mukadam/); assert.ok(!/Team B|Grocer/.test(t));
    await p.locator('[data-action="ven-filter"][data-id="all"]').click();
    await p.fill('#ven-q', 'Grocer'); await p.waitForTimeout(400);
    assert.ok(!/Sample Grocer/.test(await text('#ven-list')), 'a supplier is not found in Contractors');
    await p.locator('#ven-split [data-id="sup"]').click(); await p.waitForTimeout(300);
    assert.match(await text('#ven-list'), /Sample Grocer/); await p.fill('#ven-q', '');
  });

  await test('no record changed by the new lists', async () => {
    const after = await dump(); const strip = d => JSON.stringify(d.vendors.filter(v => v.name !== 'Sample New Contractor').map(({ _rev, ...v }) => v));
    assert.equal(strip(after), strip(before)); assert.equal(JSON.stringify(after.expenses.map(({ _rev, ...x }) => x)), JSON.stringify(before.expenses.map(({ _rev, ...x }) => x)));
  });

  await test("the owner's labour types are all offered, the older ones kept", async () => {
    const L = await p.evaluate(async () => (await import('./utils.js')).EXPENSE_HEADS.Labour.map(h => h.split(' – ')[0]));
    for (const w of ['Cook', 'Chinese Cook', 'Roti Cook (Puri / Phulka)', 'Roti Labour', 'Starter / Farsan Labour', 'Sweet Labour', 'Rojiya Labour', 'Ghati', 'Boys', 'PRO',
      'House Keeping', 'Security', 'Valet', 'Supervisor', 'Manager', 'Loading / Unloading Labour', 'Specialist Cook', 'Helper Staff', 'Cleaner / Washing'])
      assert.ok(L.includes(w), w);
    await p.locator('#n-vendors:visible').click(); await p.waitForTimeout(200);
    await p.locator('#fab').click(); await p.waitForSelector('#ven-modal.active'); await p.selectOption('#ven-cat', 'Labour'); await p.waitForTimeout(150);
    const opts = await p.locator('#ven-specialty option').evaluateAll(o => o.map(x => x.value));
    assert.ok(opts.includes('Security – सुरक्षा') && opts.includes('Sweet Labour – मिठाई मजूर'), 'a contractor can be saved with the new worker types');
    await p.locator('#ven-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(200);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'contractors FAIL' : 'suppliers and labour contractors as two lists PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('contractors FAIL'); process.exit(1); });
