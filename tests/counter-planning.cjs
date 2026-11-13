// Phase 3 P3-A counter planning (spec §5.4, C-01, C-02, G-06). Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // local date, as the app uses
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'vd', name: 'Sample Dosa Counter', cat: 'Live Counter', phone: '9000000001' }, { id: 'vc', name: 'Sample Chaat Counter', cat: 'Live Counter', phone: '9000000002' }],
  events: [
    { id: 'e1', name: 'Sample Wedding', date: day(10), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 500000, guests: 500, meals: ['dinner'], photoIds: [],
      dishes: [{ name: 'Masala Dosa', head: 'Dosa – डोसा', meal: 'dinner' }, { name: 'Pani Puri', head: 'Chaat – चाट', meal: 'dinner' }] },
    { id: 'e2', name: 'Sample Birthday', date: day(20), venue: 'Sample Lawn', type: 'Birthday – वाढदिवस', billing: 200000, guests: 300, meals: ['dinner'], photoIds: [],
      dishes: [{ name: 'Mysore Dosa', head: 'Dosa – डोसा', meal: 'dinner' }] },
    { id: 'e3', name: 'Sample Two Meals', date: day(30), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 750000, guests: 935, meals: ['breakfast', 'dinner'], photoIds: [],
      mealPlan: { breakfast: { guests: 35, rate: 150 }, dinner: { guests: 900, rate: 800 } },
      dishes: [{ name: 'Masala Dosa', head: 'Dosa – डोसा', meal: 'dinner' }, { name: 'Upma', head: '', meal: 'breakfast' }] },
    { id: 'e4', name: 'Sample Outsourced', date: day(40), venue: 'Sample Hall', type: 'Birthday – वाढदिवस', billing: 90000, guests: 100, outsourced: true, outVenId: 'vc', photoIds: [],
      dishes: [{ name: 'Thali', head: '' }] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  ctx.on('page', pg => { if (pg !== p) pg.close().catch(() => {}); });
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const ev = async id => (await p.evaluate(async () => (await import('./db.js')).exportAllData())).events.find(e => e.id === id);
  const openEvent = async name => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"]:visible', { hasText: name }).first().click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  const openOrder = async counter => { await p.locator(`[data-action="order-new"][data-id^="${counter}"]`).click(); await p.waitForSelector('#ord-modal.active');
    await p.selectOption('#ord-ven', counter === 'Chaat' ? 'vc' : 'vd'); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);

  await test('C-01 / G-06: 500 guests × 75% dosa suggests 375; ordering 400 keeps served unknown', async () => {
    await openEvent('Sample Wedding'); await openOrder('Dosa');
    assert.equal(await p.inputValue('#ord-takeup'), '', 'no take-up assumed for a counter never planned');
    assert.equal(await p.inputValue('#ord-plates'), '500', 'without a plan, plates start at the guest count as before');
    await p.fill('#ord-takeup', '75');
    assert.equal(await p.inputValue('#ord-plates'), '375');
    assert.match(await p.locator('#ord-plan').innerText(), /500 guests × 75% = 375 suggested/);
    await p.fill('#ord-plates', '400'); await p.fill('#ord-takeup', '80');
    assert.equal(await p.inputValue('#ord-plates'), '400', 'a number you typed is not replaced');
    await p.fill('#ord-takeup', '75');
    await p.locator('#btn-send-ord').click(); await p.waitForTimeout(500);
    const e = await ev('e1'); const o = e.orders[0];
    assert.deepEqual([o.plates, o.suggested, 'served' in o, 'actualServed' in o], [400, 375, false, false], 'ordered 400, suggested 375, served unknown');
    assert.deepEqual(e.counterPlan, { 'Dosa – डोसा': { takeUp: 75 } });
    await openEvent('Sample Wedding');
    assert.match(await p.locator('#menu-orders').innerText(), /Plan 375 \(75% of 500\) · ordered 400/);
  });

  await test('counter take-ups are independent and need not add up to 100%', async () => {
    await openOrder('Chaat'); await p.fill('#ord-takeup', '75'); assert.equal(await p.inputValue('#ord-plates'), '375');
    await p.locator('#btn-send-ord').click(); await p.waitForTimeout(500);
    const e = await ev('e1');
    assert.deepEqual(e.counterPlan, { 'Dosa – डोसा': { takeUp: 75 }, 'Chaat – चाट': { takeUp: 75 } }, '75% + 75% accepted');
  });

  await test('C-02: forecast 220 under a vendor minimum of 250 proposes 250; ordering below it needs a note', async () => {
    await openEvent('Sample Birthday'); await openOrder('Dosa');
    assert.equal(await p.inputValue('#ord-takeup'), '75', 'last plan for this counter offered as a starting point');
    await p.fill('#ord-takeup', '73.4'); await p.fill('#ord-min', '250');
    assert.equal(await p.inputValue('#ord-plates'), '250');
    assert.match(await p.locator('#ord-plan').innerText(), /300 guests × 73\.4% = 221 suggested · vendor minimum 250/);
    await p.fill('#ord-plates', '230');
    assert.match(await p.locator('#ord-plan').innerText(), /Below the vendor minimum of 250: add a note why/);
    await p.locator('#btn-send-ord').click(); await p.waitForTimeout(300);
    assert.equal(await p.locator('#ord-modal.active').count(), 1, 'not sent without a note');
    assert.match(await p.locator('#ord-modal').innerText(), /add a note why/);
    assert.equal((await ev('e2')).orders, undefined);
    await p.fill('#ord-notes', 'Client confirmed smaller crowd'); await p.locator('#btn-send-ord').click(); await p.waitForTimeout(500);
    const e = await ev('e2'); const o = e.orders[0];
    assert.deepEqual([o.plates, o.suggested, o.belowMinimum], [230, 250, 250]);
    assert.deepEqual(e.counterPlan['Dosa – डोसा'], { takeUp: 73.4, minimum: 250 });
    await openEvent('Sample Birthday'); assert.match(await p.locator('#menu-orders').innerText(), /below minimum/);
  });

  await test('the counter plans from its own meal guests (900 dinner), never 935', async () => {
    await openEvent('Sample Two Meals'); await openOrder('Dosa');
    await p.fill('#ord-takeup', '75');
    assert.equal(await p.inputValue('#ord-plates'), '675', '900 × 75%');
    assert.match(await p.locator('#ord-plan').innerText(), /900 dinner guests/);
    await p.locator('#ord-modal [data-action="close-modal"]').click(); await p.waitForTimeout(250);
  });

  await test('outsourced events have no counter plan; invalid plans are refused on import', async () => {
    await openEvent('Sample Outsourced');
    await p.locator('[data-action="order-new"]').first().click(); await p.waitForSelector('#ord-modal.active');
    assert.equal(await p.locator('#ord-plan-fields').isHidden(), true);
    await p.locator('#ord-modal [data-action="close-modal"]').click(); await p.waitForTimeout(250);
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const out = [];
      for (const bad of [{ 'Dosa – डोसा': { takeUp: 150 } }, { 'Dosa – डोसा': { minimum: -1 } }, { 'Dosa – डोसा': 'x' }]) {
        const d = await db.exportAllData(); delete d.manifest; d.events[0].counterPlan = bad;
        try { await db.importAllData(d, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message); } }
      return out; });
    assert.deepEqual(r, ['Invalid counter plan', 'Invalid counter plan', 'Invalid counter plan']);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'counter planning FAIL' : 'counter planning (C-01, C-02, G-06) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('counter planning FAIL'); process.exitCode = 1; });
