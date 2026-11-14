// Phase 2 P2-B: margin vs markup (G-04), per-meal pricing (G-03 / Q-01), menu review with counter and meal per
// dish, and a menu changed after orders were sent keeps the old version and flags those orders (G-11).
// Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // local date, as the app uses
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'v1', name: 'Sample Chaat Counter', cat: 'Live Counter', phone: '9000000001' }],
  events: [{ id: 'e1', name: 'Sample Reception', date: day(7), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 500000, guests: 500, meals: ['breakfast', 'dinner'], photoIds: [],
    dishes: [{ name: 'Pani Puri', head: 'Chaat – चाट', meal: 'dinner' }, { name: 'Sev Puri', head: 'Chaat – चाट', meal: 'dinner' }, { name: 'Upma', head: '', meal: 'breakfast' }],
    orders: [{ id: 'o1', head: 'Chaat – चाट', venId: 'v1', plates: 400, date: day(7), time: '19:00', notes: 'keep', status: 'confirmed', at: '2026-11-01T10:00:00.000Z', ref: 'vendor-ref-1' }] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  ctx.on('page', pg => { if (pg !== p) pg.close().catch(() => {}); });   // WhatsApp links open in a new tab: close it
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const ev = async id => (await dump()).events.find(e => e.id === id);
  const fresh = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); };
  const openEvent = async name => { await fresh(); await p.locator('#n-events:visible').click(); await p.locator('#ev-list [data-action="evdetail"]:visible', { hasText: name }).first().click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  await fresh();

  await test('G-04 margin and markup are different and exact; no price without a real cost', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js');
      return [u.priceForMargin(700, 30), u.priceForMarkup(700, 30), u.marginPct(910, 700), u.marginPct(1000, 700), u.markupPct(1000, 700),
        u.priceForMargin(700, 100), u.priceForMargin(700, 120), u.priceForMargin(0, 30), u.priceForMargin(-5, 30), u.priceForMarkup(0, 30), u.priceForMargin(450, 30)]; });
    assert.deepEqual(r, [1000, 910, 23.08, 30, 42.86, null, null, null, null, null, 643]);
  });

  await test('G-03 / Q-01 price by meal: 900 × ₹800 + 35 × ₹150 = ₹7,25,250, one bill, meals independent', async () => {
    const t = await p.evaluate(async () => (await import('./utils.js')).mealPlanTotal({ dinner: { guests: 900, rate: 800 }, breakfast: { guests: 35, rate: 150 } }));
    assert.equal(t.total, 725250); assert.deepEqual(t.lines.map(l => [l.meal, l.total]), [['breakfast', 5250], ['dinner', 720000]]);
    // Through the form
    await p.locator('#n-events:visible').click(); await p.locator('#fab').click(); await p.waitForSelector('#ev-modal.active');
    await p.fill('#ev-name', 'Sample Meal Priced'); await p.fill('#ev-date', day(20)); await p.fill('#ev-venue', 'Sample Lawn');
    assert.equal(await p.locator('#ev-mp').isHidden(), true, 'hidden until a meal is ticked');
    await p.locator('#ev-meals [data-meal="dinner"]').click(); await p.locator('#ev-meals [data-meal="breakfast"]').click();
    await p.locator('#ev-mp summary').click();
    await p.fill('#ev-mp-dinner-g', '900'); await p.fill('#ev-mp-dinner-r', '800'); await p.fill('#ev-mp-breakfast-g', '35'); await p.fill('#ev-mp-breakfast-r', '150');
    assert.equal(await p.inputValue('#ev-billing'), '725250', 'empty bill filled from the meal total');
    assert.match(await p.locator('#ev-mp-total').innerText(), /Breakfast\s*35 × ₹150\s*₹5,250\s*Dinner\s*900 × ₹800\s*₹7,20,000\s*Meals total\s*₹7,25,250\s*Before tax/);
    // Changing dinner's rate leaves breakfast as it is
    await p.fill('#ev-mp-dinner-r', '820');
    assert.equal(await p.inputValue('#ev-mp-breakfast-r'), '150'); assert.equal(await p.inputValue('#ev-billing'), '743250');
    // A bill typed by hand is never overwritten by the meal total
    await p.fill('#ev-billing', '750000'); await p.fill('#ev-mp-dinner-r', '800');
    assert.equal(await p.inputValue('#ev-billing'), '750000');
    await p.locator('#btn-save-event').click(); await p.waitForTimeout(500);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
    const saved = (await dump()).events.find(e => e.name === 'Sample Meal Priced');
    assert.deepEqual(saved.mealPlan, { breakfast: { guests: 35, rate: 150 }, dinner: { guests: 900, rate: 800 } });
    assert.equal(saved.billing, 750000, 'one commercial amount: the bill');
    assert(!saved.guests, 'meal guests are never added up (no 935) into the event guest count');
    await openEvent('Sample Meal Priced');
    const line = await p.locator('#meal-plan').innerText();
    assert.match(line, /Meals total\s*₹7,25,250/); assert.match(line, /Bill is ₹24,750 more than the meal prices/);
  });

  await test('unticking a meal drops its price; an event without meal prices is unchanged', async () => {
    await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active');
    assert.equal(await p.locator('#ev-mp').getAttribute('open'), '', 'opens when the event has meal prices');
    await p.locator('#ev-meals [data-meal="breakfast"]').click();
    await p.locator('#btn-save-event').click(); await p.waitForTimeout(500);
    const e = (await dump()).events.find(x => x.name === 'Sample Meal Priced');
    assert.deepEqual(e.mealPlan, { dinner: { guests: 900, rate: 800 } }); assert.deepEqual(e.meals, ['dinner']);
    const before = await ev('e1');
    await openEvent('Sample Reception'); await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active');
    await p.locator('#btn-save-event').click(); await p.waitForTimeout(500);
    const after = await ev('e1'); delete before._rev; delete after._rev;
    assert.deepEqual(after, before, 'no mealPlan or other field added');
  });

  await test('menu review: pasted dishes show counter and meal before saving; choices kept; removed dishes go', async () => {
    await openEvent('Sample Reception'); await p.locator('[data-action="menu-edit"]').first().click(); await p.waitForSelector('#menu-modal.active');
    assert.equal(await p.locator('#menu-review .check-row').count(), 3, 'current menu shown for review');
    await p.fill('#menu-text', 'Pani Puri\nSev Puri\nUpma\nMasala Dosa\nGulab Jamun');
    await p.waitForTimeout(500);
    assert.equal(await p.locator('#menu-review .check-row').count(), 5);
    const row = name => p.locator('#menu-review .check-row', { hasText: name });
    assert.equal(await row('Pani Puri').locator('[data-k="meal"]').inputValue(), 'dinner', 'earlier meal choice kept');
    await row('Masala Dosa').locator('[data-k="meal"]').selectOption('dinner');
    await row('Gulab Jamun').locator('[data-k="head"]').selectOption('');   // our kitchen
    await row('Gulab Jamun').locator('[data-k="meal"]').selectOption('dinner');
    await row('Upma').locator('[data-md-del]').click();
    assert.doesNotMatch(await p.inputValue('#menu-text'), /Upma/);
    await p.locator('#btn-save-menu').click(); await p.waitForTimeout(500);
    const e = await ev('e1');
    const by = n => e.dishes.find(d => d.name === n);
    assert.deepEqual(e.dishes.map(d => d.name), ['Pani Puri', 'Sev Puri', 'Masala Dosa', 'Gulab Jamun']);
    assert.equal(by('Masala Dosa').meal, 'dinner'); assert.equal(by('Gulab Jamun').head, ''); assert.equal(by('Gulab Jamun').manual, true);
    assert.equal(by('Pani Puri').head, 'Chaat – चाट');
  });

  await test('G-11 menu changed after an order was confirmed: old menu kept, order flagged, nothing sent', async () => {
    const before = await ev('e1');
    assert.equal(before.menuVersions.length, 1, 'previous menu kept'); assert.deepEqual(before.menuVersions[0].dishes.map(d => d.name), ['Pani Puri', 'Sev Puri', 'Upma']);
    // That edit did not touch the chaat counter (same chaat dishes): the confirmed order is not flagged
    assert.equal(before.orders[0].menuChanged, undefined);
    // Now remove a chaat dish
    let popups = 0; const count = pg => { if (pg !== p) popups++; }; ctx.on('page', count);
    await openEvent('Sample Reception'); await p.locator('[data-action="menu-edit"]').first().click(); await p.waitForSelector('#menu-modal.active');
    await p.locator('#menu-review .check-row', { hasText: 'Sev Puri' }).locator('[data-md-del]').click();
    await p.locator('#btn-save-menu').click(); await p.waitForTimeout(500);
    assert.match(await p.locator('#toast-msg').innerText(), /1 order sent earlier may need updating/);
    const after = await ev('e1');
    assert.equal(after.menuVersions.length, 2);
    assert.deepEqual(after.orders.map(o => [o.id, o.status, o.menuChanged]), [['o1', 'confirmed', true]], 'same order, status unchanged, flagged');
    assert.equal(popups, 0, 'nothing was sent');
    await openEvent('Sample Reception');
    assert.match(await p.locator('#menu-orders').innerText(), /Menu changed · resend/);
    // Re-sending opens WhatsApp with the current menu; the warning stays until you mark it sent (v4.4.1)
    await p.locator('[data-action="order-status"]').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Edit / send again' }).click(); await p.waitForSelector('#ord-modal.active');
    assert.match(await p.locator('#ord-items').innerText(), /Pani Puri/); assert.doesNotMatch(await p.locator('#ord-items').innerText(), /Sev Puri/);
    await p.locator('#btn-send-ord').click(); await p.waitForTimeout(500);
    ctx.off('page', count);
    let o = (await ev('e1')).orders[0];
    assert.equal(o.menuChanged, true, 'still flagged after WhatsApp opened'); assert.equal(o.status, 'opened', 'the revised message is opened, not confirmed (4.9.0 versions)'); assert.equal(o.ref, 'vendor-ref-1', 'other order details kept');
    await openEvent('Sample Reception'); await p.locator('[data-action="order-status"]').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Vendor confirmed' }).click(); await p.waitForTimeout(400);
    o = (await ev('e1')).orders[0];
    assert.equal(o.menuChanged, undefined, 'cleared once the vendor confirmed the new menu'); assert.equal(o.status, 'confirmed'); assert.equal(o.ref, 'vendor-ref-1');
  });

  await test('menu paste by meal: headings set the meal, a dish can repeat at another meal, choices stay per meal', async () => {
    const parsed = await p.evaluate(async () => { const u = await import('./utils.js');
      return [u.parseMenu('Lunch: Jeera Rice, Dal Tadka, Gulab Jamun\nDinner: Jeera Rice, Paneer Tikka, Gulab Jamun, jeera rice'),
        u.parseMenu('Welcome drink\nHi-Tea –\n1. Samosa\nLATE NIGHT MENU:\nMaggi\nStarters: Paneer Tikka'), u.parseMenu('Paneer, paneer, Dal')]; });
    assert.deepEqual(parsed[0].map(d => `${d.meal}:${d.name}`), ['lunch:Jeera Rice', 'lunch:Dal Tadka', 'lunch:Gulab Jamun', 'dinner:Jeera Rice', 'dinner:Paneer Tikka', 'dinner:Gulab Jamun'],
      'repeats kept across meals, dropped within one');
    assert.deepEqual(parsed[1].map(d => `${d.meal}:${d.name}`), [':Welcome drink', 'hightea:Samosa', 'latenight:Maggi', 'latenight:Paneer Tikka']);
    assert.deepEqual(parsed[2].map(d => d.name), ['Paneer', 'Dal']);
    assert.equal(await p.evaluate(async () => (await import('./utils.js')).menuText([{ name: 'Idli', meal: 'breakfast' }, { name: 'Dal', meal: 'dinner' }], ['dinner'], { dinner: 'Dinner' })),
      'Idli\n\nDinner:\nDal', 'a dish for a meal the event no longer has is still listed');
    // Through the menu sheet (event has breakfast and dinner)
    await openEvent('Sample Reception'); await p.locator('[data-action="menu-edit"]').first().click(); await p.waitForSelector('#menu-modal.active');
    assert.match(await p.inputValue('#menu-text'), /^Dinner:\nPani Puri\nMasala Dosa\nGulab Jamun$/, 'current dishes listed under their meal heading');
    await p.fill('#menu-text', 'Breakfast:\nUpma\nMasala Chai\n\nDinner:\nPani Puri\nMasala Chai\nLunch: Veg Biryani');
    await p.waitForTimeout(500);
    const rows = p.locator('#menu-review .check-row');
    assert.equal(await rows.count(), 5, 'Masala Chai listed for both meals; lunch is not one of this event\'s meals');
    const chai = rows.filter({ hasText: 'Masala Chai' });
    assert.deepEqual([await chai.nth(0).locator('[data-k="meal"]').inputValue(), await chai.nth(1).locator('[data-k="meal"]').inputValue()], ['breakfast', 'dinner']);
    assert.equal(await rows.filter({ hasText: 'Veg Biryani' }).locator('[data-k="meal"]').inputValue(), '', 'a heading for a meal the event lacks means all meals');
    await chai.nth(1).locator('[data-k="head"]').selectOption({ index: 1 });   // dinner chai from a counter; breakfast chai stays in our kitchen
    const counter = await chai.nth(1).locator('[data-k="head"]').inputValue();
    await p.locator('#btn-save-menu').click(); await p.waitForTimeout(500);
    const e = await ev('e1');
    const chais = e.dishes.filter(d => d.name === 'Masala Chai');
    assert.deepEqual(chais.map(d => [d.meal, d.head]), [['breakfast', ''], ['dinner', counter]], 'each meal keeps its own choice');
    assert.equal(e.dishes.find(d => d.name === 'Pani Puri').head, 'Chaat – चाट', 'unchanged dish keeps its counter');
    // Opening and saving again without edits changes nothing
    const versions = e.menuVersions.length;
    await openEvent('Sample Reception'); await p.locator('[data-action="menu-edit"]').first().click(); await p.waitForSelector('#menu-modal.active');
    assert.match(await p.inputValue('#menu-text'), /^Veg Biryani\n\nBreakfast:\nUpma\nMasala Chai\n\nDinner:\nPani Puri\nMasala Chai$/);
    await p.locator('#btn-save-menu').click(); await p.waitForTimeout(500);
    const again = await ev('e1');
    assert.equal(again.menuVersions.length, versions, 'no new menu version'); assert.deepEqual(again.dishes, e.dishes);
  });

  await test('import refuses malformed meal prices and menus', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const out = [];
      for (const bad of [{ mealPlan: { supper: { guests: 1, rate: 1 } } }, { mealPlan: { dinner: { guests: 1.5, rate: 1 } } }, { mealPlan: { dinner: { guests: 1, rate: 1.234 } } }, { dishes: [{ name: 'x', meal: 'midnight' }] }, { menuVersions: [{}] }]) {
        const d = await db.exportAllData(); delete d.manifest; Object.assign(d.events[0], bad);
        try { await db.importAllData(d, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message.split('.')[0]); } }
      return out; });
    assert.deepEqual(r, ['Invalid meal pricing', 'Invalid meal pricing', 'Invalid money amount: meal rate', 'Invalid menu', 'Invalid menu history']);
  });

  await test('each meal can have its own menu: picking one fills the rate from its slab; it is saved with the meal and shown', async () => {
    await p.reload(); await p.waitForSelector('#kpi .card');
    await p.locator('#n-events:visible').click(); await p.locator('#fab').click(); await p.waitForSelector('#ev-modal.active');
    await p.fill('#ev-name', 'Sample Menu Per Meal'); await p.fill('#ev-date', day(25)); await p.fill('#ev-venue', 'Sample Lawn');
    for (const m of ['breakfast', 'lunch', 'hightea', 'dinner', 'latenight']) await p.locator(`#ev-meals [data-meal="${m}"]`).click();
    await p.locator('#ev-mp summary').click();
    assert.equal(await p.locator('#ev-mp-rows [data-mp]').count(), 5, 'five meals in a day');
    await p.fill('#ev-mp-dinner-g', '400'); await p.selectOption('#ev-mp-dinner-m', 'golden');
    assert.equal(await p.inputValue('#ev-mp-dinner-r'), '800', 'Golden for 400 guests: the 301+ slab');
    await p.fill('#ev-mp-lunch-g', '200'); await p.fill('#ev-mp-lunch-r', '700'); await p.selectOption('#ev-mp-lunch-m', 'golden');
    assert.equal(await p.inputValue('#ev-mp-lunch-r'), '700', 'a rate typed by hand is kept');
    assert.match(await p.locator('#ev-mp-m-dinner, #ev-mp-dinner-m').first().evaluate(s => s.options[0].text), /^No menu/);
    await p.locator('#btn-save-event').click(); await p.waitForTimeout(500);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
    const saved = (await dump()).events.find(e => e.name === 'Sample Menu Per Meal');
    assert.deepEqual(saved.mealPlan, { lunch: { guests: 200, rate: 700, menu: 'golden' }, dinner: { guests: 400, rate: 800, menu: 'golden' } });
    await openEvent('Sample Menu Per Meal');
    assert.match(await p.locator('#meal-plan').innerText(), /Lunch\s*Golden\s*200 × ₹700\s*₹1,40,000\s*Dinner\s*Golden\s*400 × ₹800\s*₹3,20,000/);
    const text = await p.evaluate(async () => { const d = await (await import('./db.js')).exportAllData(); const e = d.events.find(x => x.name === 'Sample Menu Per Meal');
      return (await import('./utils.js')).nextQuoteDraft(e).lines; });
    assert.deepEqual(text.map(l => l.menu), ['golden', 'golden'], 'a new quote keeps each meal\'s menu');
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'menus and meals FAIL' : 'menus and meals (G-03, G-04, G-11) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('menus and meals FAIL'); process.exitCode = 1; });
