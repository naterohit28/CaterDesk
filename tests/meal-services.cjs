// Meal-by-meal menus (services): read from the older event fields without changing them; stable service ids (more
// than one service of a meal); the chosen library menu still shows after saving and reloading; dishes of a removed
// meal kept, never moved to other meals; food type separate from diet marks, nothing guessed. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // local date, as the app uses
const LEGACY = { id: 'e1', name: 'Sample Two Meal Wedding', date: day(9), venue: 'Sample Lawns', type: 'Wedding – लग्न', billing: 300000, guests: 300, meals: ['lunch', 'dinner'], photoIds: [],
  mealPlan: { lunch: { guests: 250, rate: 450, menu: 'golden' }, dinner: { guests: 300, rate: 650 } },
  dishes: [{ name: 'Jeera Rice', head: '', meal: 'lunch' }, { name: 'Pani Puri', head: 'Chaat – चाट', meal: 'lunch' }, { name: 'Jeera Rice', head: '', meal: 'dinner' }, { name: 'Mineral Water', head: '' }] };
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [], vendors: [],
  events: [structuredClone(LEGACY),
    { id: 'e2', name: 'Sample Plain Party', date: day(12), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 50000, guests: 80, photoIds: [], dishes: [{ name: 'Veg Pulao', head: '' }] },
    { id: 'e3', name: 'Sample Menu Only Lunch', date: day(14), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 90000, guests: 200, photoIds: [], meals: ['lunch'],
      mealPlan: { lunch: { guests: 200, rate: 450, menu: 'golden' } }, dishes: [] },
    { id: 'e4', name: 'Sample Breakfast Dinner', date: day(16), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 150000, guests: 200, photoIds: [], meals: ['breakfast', 'dinner'],
      mealPlan: { breakfast: { guests: 80, rate: 150 }, dinner: { guests: 200, rate: 600 } },
      dishes: [{ name: 'Upma', head: '', meal: 'breakfast', cat: 'main', type: 'veg' }, { name: 'Paneer Tikka', head: '', meal: 'dinner' }, { name: 'Mineral Water', head: '' }] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const ev = async id => (await dump()).events.find(e => e.id === id);
  const fresh = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); };
  const openEvent = async name => { await fresh(); await p.locator('#n-events:visible').click(); await p.locator('#ev-list [data-action="evdetail"]:visible', { hasText: name }).first().click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  const U = (fn, arg) => p.evaluate(async ([src, a]) => { const u = await import('./utils.js'); return new Function('u', 'a', `return (${src})(u, a)`)(u, a); }, [fn.toString(), arg]);
  // Save fields onto an event the way the app stores a record (merge import keeps everything else)
  const store = (id, fields) => p.evaluate(async ([id, f]) => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest;
    const e = d.events.find(x => x.id === id); Object.assign(e, f); delete e._rev; await db.importAllData(d, 'replace'); }, [id, fields]);
  const saveForm = async () => { await p.locator('#btn-save-event').click(); await p.waitForTimeout(500); if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click(); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  await fresh();

  await test('read from an older event without changing it: stable ids, own dishes per meal, the same dish at two meals, shared dishes, meal prices', async () => {
    const r = await U((u, e) => ({ out: u.eventServices(e), before: JSON.stringify(e) }), LEGACY);
    const [lunch, dinner] = r.out.services;
    assert.deepEqual([lunch.id, lunch.main, lunch.guests, lunch.rate, lunch.template?.id, lunch.fromTemplate], ['svc-lunch', true, 250, 450, 'golden', undefined], 'own dishes: no library preview');
    assert.deepEqual([dinner.id, dinner.guests, dinner.rate, dinner.template], ['svc-dinner', 300, 650, null]);
    assert.deepEqual(lunch.dishes.map(d => [d.name, d.ref, !!d.shared]), [['Jeera Rice', 0, false], ['Pani Puri', 1, false], ['Mineral Water', 3, true]]);
    assert.deepEqual(dinner.dishes.map(d => d.name), ['Jeera Rice', 'Mineral Water']);
    assert.deepEqual(r.out.unassigned, []); assert.equal(r.out.changedElsewhere, false);
    assert.equal(r.before, JSON.stringify(LEGACY), 'input untouched');
    const plain = await U((u, e) => u.eventServices(e).services, DATA.events[1]);
    assert.deepEqual(plain.map(s => [s.id, s.meal, s.dishes.map(d => d.name)]), [['svc-all', '', ['Veg Pulao']]]);
  });

  await test('a meal can have more than one service (a second lunch on another day), each with its own id, date, guests, rate and dishes', async () => {
    const r = await U((u, e) => {
      const s = u.eventServices(e).services;
      s.splice(1, 0, { id: 'svc-k2m9', meal: 'lunch', date: '2099-03-02', time: '13:00', guests: 120, rate: 400, template: null,
        dishes: [{ name: 'Veg Biryani', head: '' }, { name: 'Jeera Rice', head: '' }] });
      const saved = u.applyServices(e, s), rec = { ...e, ...saved };
      const moved = { ...rec, dishes: rec.dishes.map(d => d.name === 'Veg Biryani' ? { ...d, svc: 'svc-gone' } : d) };
      return { saved, view: u.eventServices(rec).services, moved: u.eventServices(moved).services };
    }, LEGACY);
    assert.deepEqual(r.saved.mealPlan, LEGACY.mealPlan, 'the main lunch keeps the meal price; the second lunch is not added to it');
    assert.deepEqual(r.saved.services.map(s => s.id), ['svc-lunch', 'svc-k2m9', 'svc-dinner']);
    assert.deepEqual(r.saved.services[1], { id: 'svc-k2m9', meal: 'lunch', date: '2099-03-02', time: '13:00', guests: 120, rate: 400 });
    assert.deepEqual(r.saved.dishes.filter(d => d.svc).map(d => d.name), ['Veg Biryani', 'Jeera Rice'], 'second-lunch dishes name their service');
    assert.deepEqual(r.view.map(s => [s.id, s.main, s.guests, s.dishes.filter(d => !d.shared).map(d => d.name).join('+')]),
      [['svc-lunch', true, 250, 'Jeera Rice+Pani Puri'], ['svc-k2m9', false, 120, 'Veg Biryani+Jeera Rice'], ['svc-dinner', true, 300, 'Jeera Rice']]);
    assert.deepEqual(r.moved[0].dishes.filter(d => !d.shared).map(d => d.name), ['Jeera Rice', 'Pani Puri', 'Veg Biryani'], 'a dish naming an unknown service goes to the meal\'s main service');
  });

  await test('the chosen library menu still shows after saving, reopening and reloading; it is never written into the dish list', async () => {
    const saved = await U((u, e) => { const s = u.eventServices(e).services; s[0].time = '12:30'; return u.applyServices(e, s); }, DATA.events[2]);
    assert.deepEqual(saved.dishes, []); assert.deepEqual(saved.services, [{ id: 'svc-lunch', meal: 'lunch', time: '12:30' }]); assert.equal(saved.mealPlan.lunch.menu, 'golden');
    await store('e3', saved);
    await fresh();
    const view = await U((u, e) => u.eventServices(e).services[0], await ev('e3'));
    assert.equal(view.fromTemplate, true); assert.ok(view.dishes.length > 3 && view.dishes.every(d => d.preview), 'Golden menu dishes shown');
    assert.equal(view.time, '12:30');
    // Reopen the menu sheet and save without typing: still shown, nothing written
    await openEvent('Sample Menu Only Lunch');
    assert.match(await p.locator('[data-meal-menu="lunch"]').innerText(), /Golden menu · \d+ dishes/);
    await p.locator('[data-action="menu-edit"]').first().click(); await p.waitForSelector('#menu-modal.active');
    await p.locator('#btn-save-menu').click(); await p.waitForTimeout(500);
    await openEvent('Sample Menu Only Lunch');
    assert.match(await p.locator('[data-meal-menu="lunch"]').innerText(), /Golden menu · \d+ dishes/, 'shown again after reload');
    const e = await ev('e3');
    assert.deepEqual(e.dishes, []); assert.equal((await U((u, x) => u.eventServices(x).services[0].fromTemplate, e)), true);
    // Once the meal has a dish of its own, that is its menu
    const own = await U((u, x) => u.eventServices({ ...x, dishes: [{ name: 'Veg Biryani', head: '', meal: 'lunch' }] }).services[0], e);
    assert.deepEqual([own.fromTemplate, own.dishes.map(d => d.name)], [undefined, ['Veg Biryani']]);
  });

  await test('removing breakfast keeps its dishes as they were, not served or ordered at dinner, until you choose a meal for them', async () => {
    await store('e4', await U((u, e) => { const s = u.eventServices(e).services; s[0].time = '07:30'; return u.applyServices(e, s); }, DATA.events[3]));
    await openEvent('Sample Breakfast Dinner'); await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active');
    await p.locator('#ev-meals [data-meal="breakfast"]').click(); await saveForm();
    let e = await ev('e4');
    assert.deepEqual(e.meals, ['dinner']);
    assert.deepEqual(e.dishes.find(d => d.name === 'Upma'), { name: 'Upma', head: '', meal: 'breakfast', cat: 'main', type: 'veg' }, 'kept exactly, details too');
    let view = await U((u, x) => u.eventServices(x), e);
    assert.deepEqual(view.services.map(s => [s.meal, s.dishes.map(d => d.name).sort()]), [['dinner', ['Mineral Water', 'Paneer Tikka']]], 'not moved into dinner');
    assert.deepEqual(view.unassigned.map(d => [d.name, d.meal]), [['Upma', 'breakfast']]); assert.equal(view.changedElsewhere, false);
    await openEvent('Sample Breakfast Dinner');
    const card = await p.locator('#menu-orders').innerText();
    assert.match(card, /Upma · Breakfast \(not in this event\)/); assert.match(card, /kept but not ordered/);
    // The menu sheet lists it under its own heading; saving without changes keeps it
    await p.locator('[data-action="menu-edit"]').first().click(); await p.waitForSelector('#menu-modal.active');
    assert.match(await p.inputValue('#menu-text'), /Breakfast \(not in this event\):\nUpma/);
    const upma = p.locator('#menu-review .check-row', { hasText: 'Upma' }).locator('[data-k="meal"]');
    assert.equal(await upma.inputValue(), 'breakfast');
    await p.locator('#btn-save-menu').click(); await p.waitForTimeout(500);
    assert.equal((await ev('e4')).dishes.find(d => d.name === 'Upma').meal, 'breakfast');
    // Ticking breakfast again brings back its time
    view = await U((u, x) => u.eventServices({ ...x, meals: ['breakfast', 'dinner'] }).services[0], await ev('e4'));
    assert.deepEqual([view.meal, view.time, view.dishes.map(d => d.name)], ['breakfast', '07:30', ['Upma', 'Mineral Water']]);
    // Choosing dinner for it is an explicit step
    await openEvent('Sample Breakfast Dinner'); await p.locator('[data-action="menu-edit"]').first().click(); await p.waitForSelector('#menu-modal.active');
    await p.locator('#menu-review .check-row', { hasText: 'Upma' }).locator('[data-k="meal"]').selectOption('dinner');
    await p.locator('#btn-save-menu').click(); await p.waitForTimeout(500);
    e = await ev('e4');
    assert.deepEqual(e.dishes.find(d => d.name === 'Upma'), { name: 'Upma', head: '', meal: 'dinner', cat: 'main', type: 'veg' });
    view = await U((u, x) => u.eventServices(x), e);
    assert.deepEqual(view.unassigned, []); assert.deepEqual(view.services[0].dishes.map(d => d.name).sort(), ['Mineral Water', 'Paneer Tikka', 'Upma']);
  });

  await test('food type is separate from diet marks: one type per dish, Jain / no onion-garlic / vegan only on veg, courses editable, nothing guessed', async () => {
    const r = await U(u => [{ type: 'veg', diet: ['jain', 'gluten_free'], cat: 'Live pasta' }, { type: 'nonveg', diet: ['jain'] }, { diet: ['vegan'] }, { type: 'egg', diet: ['nut_free'] },
      { type: ['veg', 'nonveg'] }, { type: 'vegetarian' }, { diet: ['jain', 'jain'], type: 'veg' }, { cat: '' }, { cat: 'x'.repeat(41) }, { cat: 'soup' }].map(d => u.dishProblem(d)));
    assert.deepEqual(r.map(Boolean), [false, true, true, false, true, true, true, true, true, false]);
    const cats = await U(u => u.DISH_CATS.map(c => c[0]));
    for (const c of ['soup', 'salad', 'snacks', 'accompaniment']) assert.ok(cats.includes(c), c);
    const view = await U((u, e) => u.eventServices(e).services[0].dishes.map(d => [d.type, d.diet]), LEGACY);
    assert.ok(view.every(([t, d]) => t === undefined && d === undefined), 'no type or diet inferred from dish names');
    const imp = await p.evaluate(async () => { const db = await import('./db.js'); const out = [];
      const d0 = await db.exportAllData(); delete d0.manifest;
      for (const dish of [{ type: 'veg', diet: ['jain', 'no_onion_garlic'], cat: 'Live pasta' }, { type: 'nonveg', diet: ['jain'] }, { diet: ['vegan'] }, { type: 'veg,egg' }, { diet: ['veg'] }, { cat: '' }]) {
        const d = structuredClone(d0); Object.assign(d.events.find(e => e.id === 'e1').dishes[0], dish);
        try { await db.importAllData(d, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message.split('.')[0]); } }
      await db.importAllData(d0, 'replace'); return out; });
    assert.deepEqual(imp, ['accepted', ...Array(5).fill('Invalid dish details')]);
  });

  await test('the event form notes saved services as current; an event without them gets no new fields', async () => {
    await store('e1', await U((u, e) => { const s = u.eventServices(e).services; s[1].time = '20:00'; return u.applyServices(e, s); }, await ev('e1')));
    await openEvent('Sample Two Meal Wedding'); await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active');
    if (await p.locator('#ev-mp').getAttribute('open') === null) await p.locator('#ev-mp summary').click();
    await p.fill('#ev-mp-dinner-g', '320'); await saveForm();
    const e = await ev('e1');
    const view = await U((u, x) => u.eventServices(x), e);
    assert.equal(view.changedElsewhere, false); assert.equal(view.services[1].guests, 320); assert.equal(view.services[1].time, '20:00');
    const before = await ev('e2');
    await openEvent('Sample Plain Party'); await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active'); await saveForm();
    const after = await ev('e2'); delete before._rev; delete after._rev;
    assert.deepEqual(after, before, 'no services or other field added');
  });

  await test('backups keep services; malformed services are refused; two services of one meal are allowed', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const out = [];
      const d0 = await db.exportAllData(); delete d0.manifest;
      await db.importAllData(structuredClone(d0), 'replace');
      const now = (await db.exportAllData()).events.find(e => e.id === 'e1'), was = d0.events.find(e => e.id === 'e1');
      out.push(JSON.stringify([now.services, now.servicesSig]) === JSON.stringify([was.services, was.servicesSig]) ? 'kept' : 'lost');
      const svc = was.services;
      for (const bad of [{ services: [...svc, { id: 'svc-x', meal: 'lunch', guests: 50, rate: 300 }] }, { services: 'x' }, { services: [svc[0], svc[0]] }, { services: [{ ...svc[0], meal: 'supper' }] },
        { services: [{ ...svc[0], id: '' }] }, { services: [{ ...svc[0], guests: -1 }] }, { services: [{ ...svc[0], rate: 1.234 }] }, { services: [{ ...svc[0], date: '2026-13-01' }] },
        { services: [{ ...svc[0], template: { name: 'x' } }] }, { servicesSig: 5 }]) {
        const d = structuredClone(d0); Object.assign(d.events.find(e => e.id === 'e1'), bad);
        try { await db.importAllData(d, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message.split('.')[0]); } }
      await db.importAllData(d0, 'replace'); return out; });
    assert.deepEqual(r, ['kept', 'accepted', ...Array(4).fill('Invalid meal menus'), 'Invalid meal menus', 'Invalid money amount: meal rate', 'Invalid meal menus', 'Invalid meal menus', 'Invalid meal menus']);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'meal services FAIL' : 'meal services PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('meal services FAIL'); process.exitCode = 1; });
