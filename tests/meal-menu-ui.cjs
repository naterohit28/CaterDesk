// Menu by meal on the event page and the meal-menu sheet (PR 3). The sheet goes: 1 meal (each service; a repeated meal
// shows its date), 2 a library menu (best matches for the meal first, with dish counts) or a new one, 3 the dishes by
// course, editable, 4 save for this event only or also as a new library menu. Dishes a meal has stay unless replaced
// on purpose; existing library menus are never changed; switching meals with unsaved changes asks first. A library
// menu chosen for a meal is shown unconfirmed on the event page until "Use these dishes" (D2). 360px. Synthetic data.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const MENUS = [
  { id: 'MNbf', name: 'Sample Breakfast Menu', meals: ['breakfast'], slabs: [{ min: 0, rate: 180 }], items: ['Poha', 'Upma', 'Masala Tea'] },
  { id: 'MNdn', name: 'Sample Dinner Menu', meals: ['dinner'], slabs: [{ min: 0, rate: 650 }], items: ['Paneer Tikka', 'Dal Makhani', 'Butter Naan', 'Gulab Jamun'] }];
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [], menus: MENUS,
  vendors: [{ id: 'v1', name: 'Sample Chaat Stall', cat: 'Live Counter', phone: '9000000001' }],
  events: [
    { id: 'e1', name: 'Sample Lunch Dinner', date: day(9), venue: 'Sample Lawns', type: 'Wedding – लग्न', billing: 300000, guests: 300, meals: ['lunch', 'dinner'], photoIds: [],
      mealPlan: { lunch: { guests: 250, rate: 450 }, dinner: { guests: 300, rate: 650, menu: 'golden' } },
      dishes: [{ name: 'Jeera Rice', head: '', meal: 'lunch' }, { name: 'Pani Puri', head: 'Chaat – चाट', meal: 'lunch' }, { name: 'Mineral Water', head: '' }],
      orders: [{ id: 'o1', head: 'Chaat – चाट', venId: 'v1', plates: 200, date: day(9), time: '12:00', status: 'confirmed', at: '2026-11-01T10:00:00.000Z' }] },
    { id: 'e2', name: 'Sample Changed Elsewhere', date: day(11), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 80000, guests: 100, meals: ['dinner'], photoIds: [],
      mealPlan: { dinner: { guests: 100, rate: 600 } }, services: [{ id: 'svc-dinner', meal: 'dinner', time: '20:00' }], servicesSig: 'stale0',
      dishes: [{ name: 'Veg Pulao', head: '', meal: 'dinner' }, { name: 'Upma', head: '', meal: 'breakfast' }] },
    // Breakfast without a price or dishes, lunch, and two dinners on different dates (the second with its own guests, rate and library menu)
    { id: 'e3', name: 'Sample Two Dinners', date: day(20), venue: 'Sample Lawns', type: 'Wedding – लग्न', billing: 500000, guests: 300, meals: ['breakfast', 'lunch', 'dinner'], photoIds: [],
      mealPlan: { lunch: { guests: 200, rate: 450 }, dinner: { guests: 300, rate: 700 } },
      services: [{ id: 'svc-dinner', meal: 'dinner', time: '20:00' }, { id: 'svc-d2', meal: 'dinner', date: day(21), time: '20:30', guests: 80, rate: 500, template: { id: 'golden', name: 'Golden' } }],
      dishes: [{ name: 'Dal Tadka', head: '', meal: 'lunch' }, { name: 'Paneer Tikka', head: 'Tandoor – तंदूर', meal: 'dinner' }] }] };

const pickTime = async (p, id, hhmm = '19:30') => { if (await p.inputValue('#' + id)) return; const [h, m] = hhmm.split(':').map(Number); await p.fill('#' + id + '-t', `${h % 12 || 12}:${String(m).padStart(2, '0')}`); await p.locator('#' + id + (h < 12 ? '-am' : '-pm')).click(); };
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
  const library = async () => JSON.stringify((await dump()).menus.map(({ _rev, ...m }) => m).sort((a, b) => a.id.localeCompare(b.id)));
  const openEvent = async name => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"]:visible', { hasText: name }).first().click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  const card = meal => p.locator(`.svc-card[data-meal-menu="${meal}"]`);
  const sheetDish = name => p.locator('#svc-dishes .svc-dish').filter({ has: p.locator(`input[data-k="name"][value="${name}"]`) });
  const noOverflow = () => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  const openSheet = async () => { await p.locator('[data-action="svc-add"]').click(); await p.waitForSelector('#svc-modal.active'); };
  const fmt = d => p.evaluate(async x => (await import('./utils.js')).fmtDate(x), d);
  const toast = () => p.locator('#toast-msg').innerText();
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  const golden = await p.evaluate(async () => (await import('./utils.js')).menuById('golden').items);
  const lib0 = await library();

  await test('event page: each meal its own dishes, guests and rate; every-meal dishes once; a chosen library menu shown not confirmed and not ordered', async () => {
    await openEvent('Sample Lunch Dinner');
    assert.equal(await p.locator('.svc-card').count(), 2);
    const lunch = await card('lunch').innerText(), dinner = await card('dinner').innerText();
    assert.match(lunch, /^Lunch\n250 guests · ₹450 \/ plate/); assert.match(lunch, /Jeera Rice/); assert.match(lunch, /Pani Puri\n· Chaat/); assert.doesNotMatch(lunch, /Mineral Water/);
    assert.match(await p.locator('#meal-menus').innerText(), /Every meal: Mineral Water/);
    assert.match(dinner, /From Golden menu · \d+ dishes · not confirmed yet/);
    assert.equal(await card('dinner').locator('.dish-pill.preview').count(), golden.length);
    assert.doesNotMatch(await p.locator('#menu-orders').innerText(), new RegExp(golden[0].replace(/[()]/g, '.')), 'unconfirmed dishes are not ordered');
    assert.equal(await noOverflow(), true);
  });

  await test('D2: "Use these dishes" on the event page makes the library menu that meal\'s own dishes, so counters and orders see them', async () => {
    await card('dinner').locator('[data-action="svc-use"]').click(); await p.waitForTimeout(500);
    assert.match(await toast(), new RegExp(`Dinner: ${golden.length} dishes added from Golden`));
    const e = await ev('e1');
    assert.deepEqual(e.dishes.filter(d => d.meal === 'dinner').map(d => d.name), golden);
    assert.equal(e.dishes.some(d => 'preview' in d || 'ref' in d || 'shared' in d), false);
    await openEvent('Sample Lunch Dinner');
    assert.match(await p.locator('#menu-orders').innerText(), new RegExp(golden[0].replace(/[()]/g, '.')));
    assert.equal(await library(), lib0, 'Menu Library unchanged');
  });

  await test('1 meal dropdown: every service of the event, a repeated meal with its date, dish counts; nothing editable until a meal is chosen', async () => {
    await openEvent('Sample Two Dinners'); await openSheet();
    const opts = await p.locator('#svc-meal option').allInnerTexts();
    assert.deepEqual(opts, ['Choose a meal', 'Breakfast · no dishes yet', 'Lunch · 1 dish', `Dinner 1 · ${await fmt(day(20))} · 1 dish`, `Dinner 2 · ${await fmt(day(21))} · no dishes yet`]);
    assert.deepEqual(await p.locator('#svc-meal option').evaluateAll(o => o.map(x => x.value)), ['', 'svc-breakfast', 'svc-lunch', 'svc-dinner', 'svc-d2'], 'stable service ids inside');
    assert.equal(await p.locator('#svc-body').isHidden(), true); assert.equal(await p.locator('#btn-save-svc').isDisabled(), true);
    await p.selectOption('#svc-meal', 'svc-d2');
    assert.equal(await p.locator('#svc-mtitle').innerText(), `Dinner 2 · ${await fmt(day(21))} menu`);
    assert.equal(await p.locator('#btn-save-svc').innerText(), `Save Dinner 2 · ${await fmt(day(21))} menu`);
    assert.match(await p.locator('#svc-facts').innerText(), /80 guests · ₹500 \/ plate · No dishes saved yet/);
    await p.locator('#svc-modal [data-action="close-modal"]').click();
  });

  await test('2 menu dropdown: menus for the chosen meal first, then any-meal, then other meals, each with its dish count, and Create new menu', async () => {
    await openSheet(); await p.selectOption('#svc-meal', 'svc-breakfast');
    const groups = await p.locator('#svc-tpl optgroup').evaluateAll(gs => gs.map(g => [g.label, [...g.children].map(o => o.textContent)]));
    // 5.3.2: the 8 starter Breakfast / High Tea combinations are offered for breakfast too
    assert.equal(groups[0][0], 'For Breakfast'); assert.ok(groups[0][1].includes('Sample Breakfast Menu · 3 dishes'));
    assert.equal(groups[0][1].filter(t => t.startsWith('Breakfast / High Tea – ')).length, 8);
    assert.equal(groups[1][0], 'Any meal'); assert.ok(groups[1][1].includes(`Golden · ${golden.length} dishes`));
    assert.equal(groups.at(-1)[0], 'Other meals'); assert.ok(groups.at(-1)[1].includes('Sample Dinner Menu · 4 dishes'), 'other saved menus still choosable');   // 5.5.0: with Late Night and Punjabi
    assert.deepEqual(await p.locator('#svc-tpl > option').allInnerTexts(), ['No library menu', '+ Create new menu']);
    await p.selectOption('#svc-meal', 'svc-dinner');
    assert.deepEqual((await p.locator('#svc-tpl optgroup').first().evaluate(g => [g.label, [...g.children].map(o => o.textContent)])), ['For Dinner', ['Punjabi · 12 dishes', 'Sample Dinner Menu · 4 dishes']]);   // 5.5.0: Punjabi starter menu
    await p.locator('#svc-modal [data-action="close-modal"]').click();
  });

  await test('3 an existing menu is previewed and customised (names, who prepares, diet marks); nothing is saved before Save; Save Breakfast changes only breakfast; library untouched', async () => {
    const before = await ev('e3');
    await openSheet(); await p.selectOption('#svc-meal', 'svc-breakfast'); await p.selectOption('#svc-tpl', 'MNbf');
    assert.equal(await p.locator('#svc-dishes .svc-dish').count(), 3);
    assert.match(await p.locator('#svc-tpl-note').innerText(), /3 dishes from Sample Breakfast Menu below\. Nothing is saved until you tap Save/);
    assert.deepEqual(await ev('e3'), before, 'nothing saved yet');
    // Each dish: its name, who prepares it, and diet marks behind a small Diet button. No course or food type to pick.
    assert.equal(await p.locator('#svc-dishes [data-k="cat"], #svc-dishes [data-k="type"]').count(), 0, 'no course or type pickers');
    assert.equal(await p.locator('#svc-dishes [data-diet]').count(), 0, 'diet marks tucked away');
    const tea = sheetDish('Masala Tea');
    assert.equal(await tea.locator('[data-diet-toggle]').innerText(), 'Diet');
    await tea.locator('[data-diet-toggle]').click();
    await sheetDish('Masala Tea').locator('[data-diet="jain"]').click();
    assert.equal(await sheetDish('Masala Tea').locator('[data-diet-toggle]').innerText(), 'Jain', 'the chosen mark shows on the button');
    await sheetDish('Poha').locator('[data-k="head"]').selectOption({ index: 4 });
    const counter = await sheetDish('Poha').locator('[data-k="head"]').inputValue();
    await sheetDish('Upma').locator('[data-sd-del]').click();
    await p.fill('#svc-add', 'Idli, Medu Vada\nFruit Bowl'); await p.locator('#btn-svc-add').click();
    assert.deepEqual(await p.locator('#svc-dishes input[data-k="name"]').evaluateAll(i => i.map(x => x.value)), ['Poha', 'Masala Tea', 'Idli', 'Medu Vada', 'Fruit Bowl']);
    assert.equal(await sheetDish('Masala Tea').locator('[data-diet-toggle]').innerText(), 'Jain', 'marks stay with their dish after a removal');
    assert.equal(await p.evaluate(() => document.querySelector('#svc-modal .sheet').scrollWidth <= document.querySelector('#svc-modal .sheet').clientWidth), true);
    await p.evaluate(() => { document.getElementById('svc-time').value = ''; }); await pickTime(p, 'svc-time', '08:00');
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(600);
    assert.match(await toast(), /^Breakfast menu saved for this event/);
    const e = await ev('e3'), notBf = x => x.dishes.filter(d => d.meal !== 'breakfast');
    assert.deepEqual(e.dishes.filter(d => d.meal === 'breakfast'), [{ name: 'Poha', head: counter, manual: true, meal: 'breakfast' }, { name: 'Masala Tea', head: '', diet: ['jain'], meal: 'breakfast' },
      { name: 'Idli', head: '', meal: 'breakfast' }, { name: 'Medu Vada', head: '', meal: 'breakfast' }, { name: 'Fruit Bowl', head: '', meal: 'breakfast' }]);
    assert.deepEqual(notBf(e), notBf(before), 'lunch and both dinners unchanged'); assert.deepEqual(e.mealPlan, before.mealPlan, 'no price invented for breakfast');
    assert.deepEqual(e.services.find(s => s.meal === 'breakfast'), { id: 'svc-breakfast', meal: 'breakfast', time: '08:00', template: { id: 'MNbf', name: 'Sample Breakfast Menu' } });
    assert.equal(await library(), lib0, 'Sample Breakfast Menu not changed by the customised copy');
  });

  await test('dishes a meal already has stay when a menu is chosen; its dishes are added or replaced only on a tap, and replacing asks first', async () => {
    const before = await ev('e3');
    await openSheet(); await p.selectOption('#svc-meal', 'svc-lunch'); await p.selectOption('#svc-tpl', 'MNdn');
    assert.equal(await p.locator('#svc-dishes .svc-dish').count(), 1, 'Dal Tadka kept');
    assert.match(await p.locator('#svc-tpl-note').innerText(), /Lunch has 1 dish; they stay unless you replace them\. Sample Dinner Menu has 4 more/);
    await p.locator('#btn-svc-replace').click(); await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-title').innerText(), /Replace Lunch's dishes\?/);
    await p.locator('#ask-actions button', { hasText: 'Cancel' }).click(); await p.waitForTimeout(300);
    assert.equal(await p.locator('#svc-dishes .svc-dish').count(), 1, 'cancel keeps them');
    await p.locator('#btn-svc-addtpl').click();
    assert.equal(await p.locator('#svc-dishes .svc-dish').count(), 5);
    assert.deepEqual(await ev('e3'), before, 'still nothing saved');
    // Switching meal with unsaved changes asks; Cancel stays on Lunch with the changes
    await p.selectOption('#svc-meal', 'svc-dinner'); await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-title').innerText(), /Discard changes to Lunch menu\?/);
    await p.locator('#ask-actions button', { hasText: 'Cancel' }).click(); await p.waitForTimeout(300);
    assert.equal(await p.inputValue('#svc-meal'), 'svc-lunch'); assert.equal(await p.locator('#svc-dishes .svc-dish').count(), 5);
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(600);
    const e = await ev('e3');
    assert.deepEqual(e.dishes.filter(d => d.meal === 'lunch').map(d => d.name), ['Dal Tadka', 'Paneer Tikka', 'Dal Makhani', 'Butter Naan', 'Gulab Jamun']);
    assert.equal(e.mealPlan.lunch.menu, 'MNdn'); assert.equal(await library(), lib0);
  });

  await test('4 a missing menu is created: Create new menu saves the event and adds a new library menu; an existing name is refused', async () => {
    await openSheet(); await p.selectOption('#svc-meal', 'svc-d2'); await p.selectOption('#svc-tpl', '__new');
    assert.equal(await p.locator('#svc-save [data-save="library"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await p.inputValue('#svc-libprice'), '500', 'price starts from the meal rate');
    await p.fill('#svc-add', 'Veg Biryani, Raita, Kulfi'); await p.locator('#btn-svc-add').click();
    await p.fill('#svc-libname', 'Sample Dinner Menu');
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(400);
    assert.match(await p.locator('#svc-lib .field-error').innerText(), /already has this name/); assert.equal(await library(), lib0);
    await p.fill('#svc-libname', 'Sample Reception Dinner');
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(800);
    assert.match(await toast(), /Dinner 2 · .* menu saved · Sample Reception Dinner added to the Menu Library/);
    const menus = (await dump()).menus, made = menus.find(m => m.name === 'Sample Reception Dinner');
    assert.deepEqual({ meals: made.meals, slabs: made.slabs, items: made.items }, { meals: ['dinner'], slabs: [{ min: 0, rate: 500 }], items: ['Veg Biryani', 'Raita', 'Kulfi'] });
    assert.equal(menus.length, MENUS.length + 1, 'only the new menu added'); assert.equal(JSON.stringify(menus.filter(m => m.id !== made.id).map(({ _rev, ...m }) => m).sort((a, b) => a.id.localeCompare(b.id))), lib0);
    const e = await ev('e3');
    assert.deepEqual(e.dishes.filter(d => d.svc === 'svc-d2').map(d => d.name), ['Veg Biryani', 'Raita', 'Kulfi']);
    assert.deepEqual(e.services.find(s => s.id === 'svc-d2').template, { id: made.id, name: 'Sample Reception Dinner' });
  });

  await test('two dinners on different dates stay independent; saving Dinner 1 leaves breakfast, lunch and Dinner 2 as they were', async () => {
    const before = await ev('e3');
    await openEvent('Sample Two Dinners');
    assert.equal(await card('dinner').count(), 2);
    assert.match(await card('dinner').nth(1).innerText(), new RegExp(`^Dinner 2\\n${await fmt(day(21))} · 20:30 · 80 guests · ₹500 / plate`));
    await card('dinner').nth(0).locator('[data-action="svc-edit"]').click(); await p.waitForSelector('#svc-modal.active');
    assert.equal(await p.inputValue('#svc-meal'), 'svc-dinner');
    await p.fill('#svc-add', 'Jeera Rice'); await p.locator('#btn-svc-add').click();
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(600);
    const e = await ev('e3'), other = x => x.dishes.filter(d => !(d.meal === 'dinner' && !d.svc));
    assert.deepEqual(other(e), other(before)); assert.deepEqual(e.services.find(s => s.id === 'svc-d2'), before.services.find(s => s.id === 'svc-d2'));
    assert.deepEqual(e.dishes.filter(d => d.meal === 'dinner' && !d.svc).map(d => d.name), ['Paneer Tikka', 'Jeera Rice']);
  });

  await test('a dish already marked non-veg cannot be given Jain, no onion-garlic or vegan; saving without changes adds no menu version', async () => {
    // A food type saved earlier (now not asked for) is kept and still respected
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest;
      const e = d.events.find(x => x.id === 'e1'); e.dishes.push({ name: 'Chicken Lollipop', head: '', meal: 'lunch', type: 'nonveg' }); delete e._rev; await db.importAllData(d, 'replace'); });
    await openEvent('Sample Lunch Dinner');
    await card('lunch').locator('[data-action="svc-edit"]').click(); await p.waitForSelector('#svc-modal.active');
    await sheetDish('Chicken Lollipop').locator('[data-diet-toggle]').click();
    for (const k of ['jain', 'no_onion_garlic', 'vegan']) assert.equal(await sheetDish('Chicken Lollipop').locator(`[data-diet="${k}"]`).isDisabled(), true, k);
    assert.equal(await sheetDish('Chicken Lollipop').locator('[data-diet="nut_free"]').isDisabled(), false);
    await p.locator('#svc-modal [data-action="close-modal"]').click();
    const before = await ev('e1');
    await openEvent('Sample Lunch Dinner'); await card('lunch').locator('[data-action="svc-edit"]').click(); await p.waitForSelector('#svc-modal.active');
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(500);
    // The dish added outside the app made the change marker stale; saving here only refreshes that marker
    const after = await ev('e1'); for (const x of [after, before]) { delete x._rev; delete x.servicesSig; }
    assert.deepEqual(after, before, 'unchanged menu: record identical apart from the marker, no new version');
  });

  await test('a menu changed in an older app version and dishes of a removed meal are pointed out', async () => {
    await openEvent('Sample Changed Elsewhere');
    assert.match(await p.locator('#tab-evdetail').innerText(), /This menu was changed in an older version of the app/);
    assert.match(await p.locator('#svc-unassigned').innerText(), /Not in any meal\nUpma \(Breakfast\)/);
    assert.match(await card('dinner').innerText(), /20:00/);
  });

  await test('removing lunch keeps its dishes recoverable, not moved to another meal; ticking lunch again brings them back', async () => {
    await openEvent('Sample Two Dinners');
    const save = async () => { await p.locator('#btn-save-event').click(); await p.waitForTimeout(500); if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click(); };
    await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active'); await p.locator('#ev-meals [data-meal="lunch"]').click(); await save();
    await openEvent('Sample Two Dinners');
    assert.equal(await card('lunch').count(), 0); assert.match(await p.locator('#svc-unassigned').innerText(), /Dal Tadka \(Lunch\)/);
    for (const m of ['breakfast', 'dinner']) for (let i = 0; i < await card(m).count(); i++) assert.doesNotMatch(await card(m).nth(i).innerText(), /Dal Tadka/);
    await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active'); await p.locator('#ev-meals [data-meal="lunch"]').click(); await save();
    await openEvent('Sample Two Dinners');
    assert.match(await card('lunch').innerText(), /Dal Tadka/); assert.equal(await p.locator('#svc-unassigned').count(), 0);
  });

  await test('after closing and reopening the app: meals, menus, diet marks, who prepares and both dinners are all still there; library as left', async () => {
    const lib = await library();
    ctx.removeAllListeners('page');   // the new app page must not be closed as a stray WhatsApp tab
    await p.close(); p = await ctx.newPage(); p.setDefaultTimeout(10000); p.on('pageerror', e => errors.push(e.message));
    await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
    await openEvent('Sample Two Dinners');
    assert.equal(await card('dinner').count(), 2);
    assert.match(await card('dinner').nth(0).innerText(), /Paneer Tikka\n· Tandoor[\s\S]*Jeera Rice/);
    assert.match(await card('dinner').nth(1).innerText(), /Veg Biryani[\s\S]*Started from Sample Reception Dinner menu/);
    assert.match(await card('breakfast').innerText(), /08:00[\s\S]*Masala Tea\nJain[\s\S]*Medu Vada[\s\S]*Started from Sample Breakfast Menu menu/);
    await openSheet(); await p.selectOption('#svc-meal', 'svc-breakfast');
    assert.equal(await p.inputValue('#svc-tpl'), 'MNbf', 'chosen menu kept'); assert.equal(await p.locator('#svc-dishes .svc-dish').count(), 5);
    assert.equal(await library(), lib);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'menu by meal FAIL' : 'menu by meal PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('menu by meal FAIL'); process.exitCode = 1; });
