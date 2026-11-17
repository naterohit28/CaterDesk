// Home: "Pending collections" shows the total still to collect beside its heading (the sum of the amounts listed),
// like "Pay vendors". Settings: the CaterDesk brand at the top is a button that closes Settings and goes to Home,
// leaving no extra history entry. 390px. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DATA = { version: 'ffv2', photos: [], vPays: [], expenses: [], vendors: [],
  events: [{ id: 'a', name: 'Sample Past Party', date: day(-20), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 120000.5, guests: 100, photoIds: [] },
    { id: 'b', name: 'Sample Coming Wedding', date: day(20), venue: 'Sample Lawns', type: 'Wedding – लग्न', billing: 300000, guests: 300, photoIds: [] },
    { id: 'c', name: 'Sample Paid Event', date: day(-40), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 50000, guests: 50, photoIds: [] }],
  cPays: [{ id: 'p1', evId: 'a', amt: 20000.25, date: day(-25), mode: 'UPI' }, { id: 'p2', evId: 'c', amt: 50000, date: day(-40), mode: 'UPI' }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  await p.reload(); await p.waitForSelector('#kpi .card');

  await test('Pending collections shows the total to collect beside its heading, the sum of the amounts listed', async () => {
    const head = p.locator('.sec', { hasText: 'Pending collections' });
    assert.equal(await head.locator('#od-total').innerText(), '₹4,00,000.25', '1,00,000.25 + 3,00,000 (the paid event is not listed)');
    assert.equal(await head.locator('#od-total').getAttribute('class'), 'sec-amt due', 'styled like Pay vendors');
    const rows = await p.locator('#od-list .amt-sm').allInnerTexts();
    assert.deepEqual(rows.sort(), ['₹1,00,000.25', '₹3,00,000'].sort());
    // Everything collected: no total shown
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest;
      d.cPays.push({ id: 'p3', evId: 'a', amt: 100000.25, date: new Date().toISOString().slice(0, 10), mode: 'UPI' }, { id: 'p4', evId: 'b', amt: 300000, date: new Date().toISOString().slice(0, 10), mode: 'UPI' });
      await db.importAllData(d, 'replace'); });
    await p.reload(); await p.waitForSelector('#kpi .card');
    assert.equal(await p.locator('#od-total').isHidden(), true);
  });

  await test('the CaterDesk brand in Settings is a button: it closes Settings and goes Home, with no extra history entry', async () => {
    await p.locator('#n-events:visible').click(); await p.locator('#ev-list [data-action="evdetail"]:visible').first().click(); await p.waitForSelector('#tab-evdetail.active');
    const depth = await p.evaluate(() => history.length);
    await p.locator('#drawer-toggle').click(); await p.waitForSelector('#drawer.active');
    const brand = p.getByRole('button', { name: 'CaterDesk – go to Home' });
    assert.equal(await brand.count(), 1, 'a real, named button');
    await brand.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
    assert.equal(await p.locator('#drawer.active').count(), 0, 'Settings closed');
    assert.equal(await p.evaluate(() => document.querySelector('.tab.active')?.id), 'tab-home');
    assert.equal(await p.evaluate(() => history.state?.depth || 0), 0, 'Home is the root: no stray entries above it');
    assert.ok(await p.evaluate(() => history.length) <= depth + 1, 'Settings left no extra entry');
    // Tapping works too, from another tab
    await p.locator('#n-vendors:visible').click(); await p.locator('#drawer-toggle').click(); await p.waitForSelector('#drawer.active');
    await p.locator('#drawer-home').click(); await p.waitForTimeout(500);
    assert.equal(await p.evaluate(() => document.querySelector('.tab.active')?.id), 'tab-home');
    assert.equal(await p.locator('#drawer.active').count(), 0);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'home shortcuts FAIL' : 'home shortcuts PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('home shortcuts FAIL'); process.exitCode = 1; });
