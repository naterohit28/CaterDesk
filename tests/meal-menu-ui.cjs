// Menu by meal on the event page and one meal's menu sheet (PR 3): each meal's own dishes by course; a library menu
// chosen for a meal is shown unconfirmed until "Use these dishes" makes them the meal's dishes (so counters and vendor
// orders see them, D2); date/time, course, food type and diet marks per dish; contradictions refused; menu history
// and order warnings as with the event menu. 360px wide. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'v1', name: 'Sample Chaat Stall', cat: 'Live Counter', phone: '9000000001' }],
  events: [
    { id: 'e1', name: 'Sample Lunch Dinner', date: day(9), venue: 'Sample Lawns', type: 'Wedding – लग्न', billing: 300000, guests: 300, meals: ['lunch', 'dinner'], photoIds: [],
      mealPlan: { lunch: { guests: 250, rate: 450 }, dinner: { guests: 300, rate: 650, menu: 'golden' } },
      dishes: [{ name: 'Jeera Rice', head: '', meal: 'lunch' }, { name: 'Pani Puri', head: 'Chaat – चाट', meal: 'lunch' }, { name: 'Mineral Water', head: '' }],
      orders: [{ id: 'o1', head: 'Chaat – चाट', venId: 'v1', plates: 200, date: day(9), time: '12:00', status: 'confirmed', at: '2026-11-01T10:00:00.000Z' }] },
    { id: 'e2', name: 'Sample Changed Elsewhere', date: day(11), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 80000, guests: 100, meals: ['dinner'], photoIds: [],
      mealPlan: { dinner: { guests: 100, rate: 600 } }, services: [{ id: 'svc-dinner', meal: 'dinner', time: '20:00' }], servicesSig: 'stale0',
      dishes: [{ name: 'Veg Pulao', head: '', meal: 'dinner' }, { name: 'Upma', head: '', meal: 'breakfast' }] },
    // Breakfast without a price, lunch, and two dinners on different dates (the second with its own guests, rate and library menu)
    { id: 'e3', name: 'Sample Two Dinners', date: day(20), venue: 'Sample Lawns', type: 'Wedding – लग्न', billing: 500000, guests: 300, meals: ['breakfast', 'lunch', 'dinner'], photoIds: [],
      mealPlan: { lunch: { guests: 200, rate: 450 }, dinner: { guests: 300, rate: 700 } },
      services: [{ id: 'svc-dinner', meal: 'dinner', time: '20:00' }, { id: 'svc-d2', meal: 'dinner', date: day(21), time: '20:30', guests: 80, rate: 500, template: { id: 'golden', name: 'Golden' } }],
      dishes: [{ name: 'Poha', head: '', meal: 'breakfast' }, { name: 'Dal Tadka', head: '', meal: 'lunch' }, { name: 'Paneer Tikka', head: 'Tandoor – तंदूर', meal: 'dinner' }] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } });
  let p = await ctx.newPage(); p.setDefaultTimeout(10000);
  ctx.on('page', pg => { if (pg !== p) pg.close().catch(() => {}); });
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const ev = async id => (await dump()).events.find(e => e.id === id);
  const openEvent = async name => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"]:visible', { hasText: name }).first().click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  const card = meal => p.locator(`.svc-card[data-meal-menu="${meal}"]`);
  const sheetDish = name => p.locator('#svc-dishes .svc-dish').filter({ has: p.locator(`input[data-k="name"][value="${name}"]`) });
  const noOverflow = () => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  const golden = await p.evaluate(async () => (await import('./utils.js')).menuById('golden').items);

  await test('each meal shows its own dishes, guests and rate; dishes for every meal once; a chosen library menu is shown as not confirmed and is not ordered', async () => {
    await openEvent('Sample Lunch Dinner');
    assert.equal(await p.locator('.svc-card').count(), 2);
    const lunch = await card('lunch').innerText(), dinner = await card('dinner').innerText();
    assert.match(lunch, /^Lunch\n250 guests · ₹450 \/ plate/); assert.match(lunch, /Jeera Rice/); assert.match(lunch, /Pani Puri/); assert.doesNotMatch(lunch, /Mineral Water/);
    assert.match(await p.locator('#meal-menus').innerText(), /Every meal: Mineral Water/);
    assert.match(dinner, /From Golden menu · \d+ dishes · not confirmed yet/); assert.match(dinner, /Use these dishes/);
    assert.equal(await card('dinner').locator('.dish-pill.preview').count(), golden.length, 'library dishes shown as unconfirmed');
    assert.doesNotMatch(await p.locator('#menu-orders').innerText(), new RegExp(golden[0].replace(/[()]/g, '.')), 'unconfirmed dishes are not ordered');
    assert.equal(await noOverflow(), true, 'nothing wider than 360px');
  });

  await test('D2: "Use these dishes" makes the library menu the meal\'s own dishes, so counters and orders see them', async () => {
    await card('dinner').locator('[data-action="svc-use"]').click(); await p.waitForTimeout(500);
    assert.match(await p.locator('#toast-msg').innerText(), new RegExp(`Dinner: ${golden.length} dishes added from Golden`));
    const e = await ev('e1');
    assert.deepEqual(e.dishes.filter(d => d.meal === 'dinner').map(d => d.name), golden);
    assert.equal(e.mealPlan.dinner.menu, 'golden', 'the chosen menu stays recorded');
    assert.equal(e.dishes.some(d => 'preview' in d || 'ref' in d || 'shared' in d), false, 'no screen-only fields saved');
    assert.equal(e.menuVersions, undefined, 'adding dishes to an empty meal is not a change to a sent menu');
    await openEvent('Sample Lunch Dinner');
    assert.equal(await card('dinner').locator('.dish-pill.preview').count(), 0);
    assert.match(await p.locator('#menu-orders').innerText(), new RegExp(golden[0].replace(/[()]/g, '.')), 'now part of the menu for counters and orders');
  });

  await test('one meal\'s sheet: date, time, course, food type and diet marks; Jain needs veg; add and remove dishes; history kept and the sent order flagged', async () => {
    await openEvent('Sample Lunch Dinner');
    await card('lunch').locator('[data-action="svc-edit"]').click(); await p.waitForSelector('#svc-modal.active');
    assert.equal(await p.inputValue('#svc-date'), day(9)); assert.equal(await p.locator('#svc-dishes .svc-dish').count(), 2, 'only lunch dishes; every-meal dishes are listed, not edited here');
    assert.match(await p.locator('#svc-dishes').innerText(), /Also served: Mineral Water/);
    await p.fill('#svc-date', day(10)); await p.fill('#svc-time', '12:30');
    const rice = sheetDish('Jeera Rice');
    assert.equal(await rice.locator('[data-diet="jain"]').isDisabled(), true, 'Jain only for a veg dish');
    await rice.locator('[data-k="cat"]').selectOption('rice'); await rice.locator('[data-k="type"]').selectOption('veg');
    await sheetDish('Jeera Rice').locator('[data-diet="jain"]').click();
    assert.equal(await sheetDish('Jeera Rice').locator('[data-diet="jain"]').getAttribute('aria-pressed'), 'true');
    await sheetDish('Pani Puri').locator('[data-sd-del]').click();
    await p.fill('#svc-add', 'Gulab Jamun, Masala Chaas'); await p.locator('#btn-svc-add').click();
    assert.equal(await p.locator('#svc-dishes .svc-dish').count(), 3);
    assert.equal(await p.evaluate(() => document.querySelector('#svc-modal .sheet').scrollWidth <= document.querySelector('#svc-modal .sheet').clientWidth), true);
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(600);
    assert.match(await p.locator('#toast-msg').innerText(), /Lunch menu saved · 1 order sent earlier may need updating/);
    const e = await ev('e1');
    const lunch = e.dishes.filter(d => d.meal === 'lunch');
    assert.deepEqual(lunch, [{ name: 'Jeera Rice', head: '', cat: 'rice', type: 'veg', diet: ['jain'], meal: 'lunch' }, { name: 'Gulab Jamun', head: '', meal: 'lunch' }, { name: 'Masala Chaas', head: '', meal: 'lunch' }]);
    assert.ok(e.dishes.some(d => d.name === 'Mineral Water' && !d.meal), 'every-meal dish kept');
    assert.deepEqual(e.services.find(s => s.meal === 'lunch'), { id: 'svc-lunch', meal: 'lunch', date: day(10), time: '12:30' });
    assert.equal(e.menuVersions.length, 1); assert.ok(e.menuVersions[0].dishes.some(d => d.name === 'Pani Puri'), 'previous menu kept');
    assert.equal(e.orders[0].menuChanged, true); assert.equal(e.orders[0].status, 'confirmed', 'flagged, nothing sent');
    await openEvent('Sample Lunch Dinner');
    const text = await card('lunch').innerText();
    assert.match(text, /12:30/); assert.match(text, /RICE\nVeg:\nJeera Rice\nJain\nOTHER DISHES\nGulab Jamun\nMasala Chaas/, "dishes by course, food type named for screen readers, diet mark"); assert.match(text, /Gulab Jamun/);
    assert.equal(await card('lunch').locator('.ft-veg').count(), 1); assert.match(await card('lunch').locator('.sr').first().innerText().catch(() => ''), /Veg/);
  });

  await test('a contradiction is refused with a reason and nothing is saved; saving without changes adds no menu version', async () => {
    const before = await ev('e1');
    await openEvent('Sample Lunch Dinner'); await card('lunch').locator('[data-action="svc-edit"]').click(); await p.waitForSelector('#svc-modal.active');
    await sheetDish('Jeera Rice').locator('[data-k="type"]').selectOption('nonveg');
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(400);
    assert.match(await p.locator('#toast-msg').innerText(), /Jeera Rice: Jain, no onion-garlic and vegan dishes must be veg/);
    assert.equal(await p.locator('#svc-modal.active').count(), 1, 'sheet stays open');
    const same = await ev('e1'); assert.deepEqual(same, before);
    await sheetDish('Jeera Rice').locator('[data-k="type"]').selectOption('veg');
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(500);
    const after = await ev('e1'); delete after._rev; delete before._rev;
    assert.deepEqual(after, before, 'unchanged menu: record identical, no new version');
  });

  await test('a menu changed in an older app version and dishes of a removed meal are pointed out', async () => {
    await openEvent('Sample Changed Elsewhere');
    const box = await p.locator('#tab-evdetail').innerText();
    assert.match(box, /This menu was changed in an older version of the app/);
    assert.match(await p.locator('#svc-unassigned').innerText(), /Not in any meal\nUpma \(Breakfast\)/);
    assert.match(await card('dinner').innerText(), /20:00/);
  });

  // Review workflows on one event: breakfast without a price, lunch, two dinners on different dates
  const others = (e, keep) => ({ dishes: e.dishes.filter(d => !keep(d)), mealPlan: e.mealPlan });
  const isD2 = d => d.svc === 'svc-d2';
  await test('two dinners on different dates stay two cards, each with its own date, guests, rate and dishes', async () => {
    await openEvent('Sample Two Dinners');
    assert.equal(await card('dinner').count(), 2);
    const [d1, d2] = [await card('dinner').nth(0).innerText(), await card('dinner').nth(1).innerText()];
    assert.match(d1, /^Dinner 1\n20:00 · 300 guests · ₹700 \/ plate/); assert.match(d1, /Paneer Tikka\n· Tandoor/, 'who prepares it');
    assert.match(d2, new RegExp(`^Dinner 2\\n${await p.evaluate(async d => (await import('./utils.js')).fmtDate(d), day(21))} · 20:30 · 80 guests · ₹500 / plate`));
    assert.match(d2, /From Golden menu · \d+ dishes · not confirmed yet/); assert.doesNotMatch(d2, /Paneer Tikka/);
    assert.equal(await noOverflow(), true);
  });

  await test('editing Dinner 2 changes only Dinner 2: breakfast, lunch and Dinner 1 stay exactly as they were', async () => {
    const before = await ev('e3');
    await card('dinner').nth(1).locator('[data-action="svc-edit"]').click(); await p.waitForSelector('#svc-modal.active');
    assert.match(await p.locator('#svc-mtitle').innerText(), /^Dinner 2 menu · /, 'the sheet says which dinner');
    await p.locator('#btn-svc-use').click();
    assert.equal(await p.locator('#svc-dishes .svc-dish').count(), golden.length);
    await sheetDish(golden[0]).locator('[data-k="type"]').selectOption('veg');
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(600);
    const e = await ev('e3');
    assert.deepEqual(others(e, isD2), others(before, isD2), 'other meals untouched');
    assert.deepEqual(e.dishes.filter(isD2).map(d => [d.name, d.meal]), golden.map(n => [n, 'dinner']));
    assert.equal(e.dishes.filter(isD2)[0].type, 'veg');
    assert.deepEqual(e.services.find(s => s.id === 'svc-d2'), before.services.find(s => s.id === 'svc-d2'), 'its date, time, guests, rate and menu kept');
    assert.deepEqual(e.services.find(s => s.id === 'svc-dinner'), before.services.find(s => s.id === 'svc-dinner'));
  });

  await test('choosing a library menu for a meal that has dishes keeps them; its dishes are added only on a tap', async () => {
    await openEvent('Sample Two Dinners'); await card('lunch').locator('[data-action="svc-edit"]').click(); await p.waitForSelector('#svc-modal.active');
    await p.selectOption('#svc-tpl', 'golden');
    assert.equal(await p.locator('#svc-dishes .svc-dish').count(), 1, 'Dal Tadka still the only dish');
    assert.match(await p.locator('#svc-tpl-note').innerText(), new RegExp(`Your 1 dishes stay as they are\\. Golden menu has ${golden.length} more`));
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(600);
    const e = await ev('e3');
    assert.deepEqual(e.dishes.filter(d => d.meal === 'lunch').map(d => d.name), ['Dal Tadka']);
    assert.equal(e.mealPlan.lunch.menu, 'golden', 'the chosen menu is recorded with the meal price');
  });

  await test('a meal without a price keeps its menu and dishes; no rate is made up', async () => {
    await openEvent('Sample Two Dinners'); await card('breakfast').locator('[data-action="svc-edit"]').click(); await p.waitForSelector('#svc-modal.active');
    await p.selectOption('#svc-tpl', 'golden'); await p.fill('#svc-time', '08:00');
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(600);
    const e = await ev('e3');
    assert.equal(e.mealPlan.breakfast, undefined, 'no price invented');
    assert.deepEqual(e.services.find(s => s.meal === 'breakfast'), { id: 'svc-breakfast', meal: 'breakfast', time: '08:00', template: { id: 'golden', name: 'Golden' } });
    assert.deepEqual(e.dishes.filter(d => d.meal === 'breakfast').map(d => d.name), ['Poha']);
    await openEvent('Sample Two Dinners');
    const text = await card('breakfast').innerText();
    assert.match(text, /^Breakfast\n08:00\n/); assert.doesNotMatch(text, /plate|guests/); assert.match(text, /Started from Golden menu/);
  });

  await test('removing lunch keeps its dishes recoverable, not moved to another meal; ticking lunch again brings them back', async () => {
    await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active');
    await p.locator('#ev-meals [data-meal="lunch"]').click();
    await p.locator('#btn-save-event').click(); await p.waitForTimeout(500); if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
    await openEvent('Sample Two Dinners');
    assert.equal(await card('lunch').count(), 0);
    assert.match(await p.locator('#svc-unassigned').innerText(), /Dal Tadka \(Lunch\)/);
    for (const m of ['breakfast', 'dinner']) for (let i = 0; i < await card(m).count(); i++) assert.doesNotMatch(await card(m).nth(i).innerText(), /Dal Tadka/);
    assert.deepEqual((await ev('e3')).dishes.find(d => d.name === 'Dal Tadka'), { name: 'Dal Tadka', head: '', meal: 'lunch' });
    await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active');
    await p.locator('#ev-meals [data-meal="lunch"]').click();
    await p.locator('#btn-save-event').click(); await p.waitForTimeout(500); if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
    await openEvent('Sample Two Dinners');
    assert.match(await card('lunch').innerText(), /Dal Tadka/); assert.equal(await p.locator('#svc-unassigned').count(), 0);
  });

  await test('after closing and reopening the app: two dinners, menus, diet marks and who prepares each dish are all still there', async () => {
    ctx.removeAllListeners('page');   // the new app page must not be closed as a stray WhatsApp tab
    await p.close(); p = await ctx.newPage(); p.setDefaultTimeout(10000); p.on('pageerror', e => errors.push(e.message));
    await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
    await openEvent('Sample Two Dinners');
    assert.equal(await card('dinner').count(), 2);
    assert.match(await card('dinner').nth(0).innerText(), /Paneer Tikka\n· Tandoor/);
    assert.equal(await card('dinner').nth(1).locator('.dish-pill').count(), golden.length); assert.equal(await card('dinner').nth(1).locator('.ft-veg').count(), 1);
    assert.match(await card('breakfast').innerText(), /08:00[\s\S]*Poha[\s\S]*Started from Golden menu/);
    await openEvent('Sample Lunch Dinner');
    assert.match(await card('lunch').innerText(), /Jeera Rice\nJain/);
  });


  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'menu by meal FAIL' : 'menu by meal PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('menu by meal FAIL'); process.exitCode = 1; });
