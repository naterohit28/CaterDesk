// 5.5.0 (owner's requirements): easier entry. Find an expense item by everyday names (English, Hindi, Marathi); a
// library menu only previewed is marked so, and using it goes straight on to kitchen and orders; Late Night, Punjabi
// and Fasting starter menus carry no price; the usual labour rate is one tap (never filled in by itself); attendance:
// people asked for against who came. Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ROJIYA = 'Rojiya Labour – रोजीया मजूर';
const SHEET = (rate, extra = {}) => ({ rows: [{ id: 'r' + rate + (extra.id || ''), role: ROJIYA, rate, counts: { f: 4 }, venId: 'rj' }] });
const DATA = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'rj', name: 'Sample Rojiya Mukadam', cat: 'Labour', specialty: ROJIYA }],
  events: [{ id: 'E', name: 'Sample Punjabi Dinner', date: day(5), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 200, photoIds: [],
      meals: ['dinner'], mealPlan: { dinner: { guests: 200, rate: 0, menu: 'punjabi' } } },
    { id: 'P1', name: 'Sample Past 1', date: day(-30), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 50000, guests: 100, photoIds: [], labour: SHEET(650) },
    { id: 'P2', name: 'Sample Past 2', date: day(-20), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 50000, guests: 100, photoIds: [], labour: SHEET(700) },
    { id: 'P3', name: 'Sample Past 3', date: day(-10), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 50000, guests: 100, photoIds: [], labour: SHEET(700, { id: 'b' }) }] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const openEvent = async () => { await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' }); await p.locator('#n-events:visible').click(); await p.waitForTimeout(300);
    await p.locator('#ev-list [data-action="evdetail"][data-id="E"]:visible').first().click(); await p.waitForSelector('#tab-evdetail.active'); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });
  await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA());

  await test('find an expense item by everyday words; a tap sets category and item', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js'); const f = w => u.findHeads(w).map(h => h.head.split(' – ')[0]);
      return [f('paneer'), f('tempo'), f('waiter'), f('दूध'), f('ice'), f('pani puri'), f('x')]; });
    assert.deepEqual(r, [['Milk & Dairy'], ['Transport'], ['Boys'], ['Milk & Dairy'], ['Ice', 'Ice Cream', 'Kulfi / Ice Gola'], ['Chaat'], []]);
    await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' });
    await p.locator('[data-action="quick"][data-id="expense"]').first().click();
    await p.waitForSelector('#exp-modal.active');
    await p.fill('#exp-find', 'paneer'); await p.locator('#exp-find-res [data-qhead]').first().click();
    assert.equal(await p.inputValue('#exp-cat'), 'Raw Material'); assert.match(await p.inputValue('#exp-head'), /^Milk & Dairy/);
    assert.equal(await p.inputValue('#exp-find'), '', 'search cleared');
    await p.fill('#exp-find', 'zzz'); assert.match(await p.locator('#exp-find-res').innerText(), /No match/);
    await p.locator('#exp-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(200);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
  });

  await test('a previewed library menu says so; Use these dishes saves them and goes on to kitchen and orders', async () => {
    await openEvent();
    const card = p.locator('[data-meal-menu="dinner"]');
    assert.match(await card.innerText(), /Preview · not saved[^]*From Punjabi menu · 12 dishes · not confirmed yet/);
    await card.locator('[data-action="svc-use"]').click(); await p.waitForTimeout(800);
    assert.equal(await card.locator('[data-preview]').count(), 0);
    assert.equal((await dump()).events.find(e => e.id === 'E').dishes.length, 12);
    const top = await p.locator('#menu-orders').evaluate(el => el.getBoundingClientRect().top);
    assert.ok(top < 400, `kitchen and orders brought into view (${top})`);
  });

  await test('the new starter menus have no price and fill none', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js'); return ['latenight', 'punjabi', 'fasting'].map(id => { const m = u.MENUS.find(x => x.id === id); return [m.name, m.items.length, u.menuRate(m, 100)]; }); });
    assert.deepEqual(r, [['Late Night Snacks', 6, 0], ['Punjabi', 12, 0], ['Fasting (Upwas)', 10, 0]]);
    assert.equal((await dump()).events.find(e => e.id === 'E').mealPlan.dinner.rate, 0, 'no price filled from the menu');
  });

  await test('the usual rate is one tap (most used of the last ones), and asked-for against who came', async () => {
    await openEvent(); await p.locator('[data-action="lab-edit"]').click(); await p.waitForSelector('#lab-modal.active');
    const row = p.locator('#lab-rows [data-lab="0"]');
    await row.locator('[data-k="role"]').selectOption(ROJIYA); await p.waitForTimeout(150);
    assert.equal(await row.locator('[data-k="rate"]').inputValue(), '', 'never filled in by itself');
    assert.match(await row.locator('[data-lab-usual]').innerText(), /Use usual rate ₹700/);
    await row.locator('[data-lab-usual]').click(); await p.waitForTimeout(150);
    assert.equal(await row.locator('[data-k="rate"]').inputValue(), '700');
    await row.locator('[data-k="asked"]').fill('8'); await row.locator('[data-k="c-f"]').fill('7');
    await p.locator('#btn-save-lab').click(); await p.waitForTimeout(700);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
    const ev = (await dump()).events.find(e => e.id === 'E');
    assert.deepEqual([ev.labour.rows[0].asked, ev.labour.rows[0].rate, ev.labour.rows[0].counts], [8, 700, { f: 7 }]);
    assert.match((await p.locator('#labour-card').innerText()).replace(/\s+/g, ' '), /asked 8 1 short/);
  });

  await test('a backup with a bad asked-for count is refused', async () => {
    const d = DATA(); d.events[1].labour.rows[0].asked = -2;
    const err = await p.evaluate(async x => { try { await (await import('./db.js')).importAllData(x, 'replace'); return ''; } catch (e) { return e.message; } }, d);
    assert.match(err, /labour/i);
  });

  await test('5.6.0: wider item list in the same six categories; items used before first, the rest under All items', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js'); const f = w => u.findHeads(w).map(h => `${h.cat}: ${h.head.split(' – ')[0]}`);
      return [Object.keys(u.EXPENSE_HEADS).length, f('chicken'), f('koyla'), f('kiraya'), f('frozen')]; });
    assert.deepEqual(r, [6, ['Raw Material: Non-veg (Chicken / Mutton / Fish)'], ['Operations: Charcoal / Firewood'], ['Admin: Rent'], ['Raw Material: Frozen / Ready Food']]);
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest;
      d.expenses.push({ id: 'xg', evId: 'E', cat: 'Raw Material', head: 'Vegetable – भाजी', amt: 300, date: d.events[0].date, pay: 'paid', mode: 'UPI', billIds: [] }); await db.importAllData(d, 'replace'); });
    await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' });
    await p.locator('[data-action="quick"][data-id="expense"]').first().click(); await p.waitForSelector('#exp-modal.active');
    await p.locator('#exp-cats [data-cat="Raw Material"]').click();
    const groups = await p.locator('#exp-head optgroup').evaluateAll(gs => gs.map(g => [g.label, g.children.length]));
    assert.deepEqual(groups.map(g => g[0]), ['Used before – नेहमीचे', 'All items – सर्व']);
    assert.equal(await p.locator('#exp-head optgroup').first().locator('option').first().getAttribute('value'), 'Vegetable – भाजी');
    await p.locator('#exp-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(200);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'easier-entry FAIL' : 'easier entry PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('easier-entry FAIL'); process.exit(1); });
