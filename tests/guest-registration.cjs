// Guests first (4.28.0): a new or upcoming event needs its guest count before it is saved (one box, or one per meal);
// a meal's guests are kept before it is priced; the Guest count sheet starts with Booked guests and a day-of count
// waits for them; the event page shows the guests or "Guest count not entered". Past and unchanged old events save
// as they were. 360px. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [], vendors: [],
  events: [
    // upcoming, booked before guests were required: no guest number at all
    { id: 'up', name: 'Sample Upcoming No Guests', date: day(10), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 200000, meals: ['lunch', 'dinner'], photoIds: [] },
    // past, no guests: still editable
    { id: 'past', name: 'Sample Past Party', date: day(-20), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 50000, photoIds: [] },
    // older style: one number used for each meal
    { id: 'old', name: 'Sample Old Style', date: day(12), venue: 'Sample Lawns', type: 'Wedding – लग्न', billing: 300000, guests: 400, meals: ['breakfast', 'dinner'], photoIds: [] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const ev = async id => (await dump()).events.find(e => e.id === id);
  const noRev = x => { const y = structuredClone(x); delete y._rev; return y; };
  const openEvent = async id => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator(`#ev-list [data-action="evdetail"][data-id="${id}"]:visible`).click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(150); };
  const newEventForm = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click(); await p.locator('#fab').click(); await p.waitForSelector('#ev-modal.active'); };
  const save = async () => { await p.locator('#btn-save-event').click(); await p.waitForTimeout(500); if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click(); };
  const errText = () => p.locator('#ev-modal .field-error').allInnerTexts();
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);

  await test('new event: Guests comes right after Meals and is required', async () => {
    await newEventForm();
    const order = await p.evaluate(() => [...document.querySelectorAll('#ev-modal .field')].map(f => f.id || f.querySelector('input,select,textarea')?.id).filter(Boolean));
    assert.ok(order.indexOf('ev-g') > order.indexOf('ev-date') && order.indexOf('ev-g') < order.indexOf('ev-venue'), order.join(','));
    await p.fill('#ev-name', 'Sample No Guest Count'); await p.fill('#ev-date', day(30)); await p.fill('#ev-venue', 'Sample Hall'); await p.fill('#ev-billing', '80000');
    await save();
    assert.equal(await p.locator('#ev-modal.active').count(), 1, 'not saved');
    assert.match((await errText()).join('|'), /Guests/);
    await p.fill('#ev-guests', '250'); await save();
    const e = (await dump()).events.find(x => x.name === 'Sample No Guest Count');
    assert.equal(e.guests, 250);
  });

  await test('with meals: one guest box per meal, each required; a meal is kept with its guests before it is priced', async () => {
    await newEventForm();
    await p.fill('#ev-name', 'Sample Two Meals'); await p.fill('#ev-date', day(31)); await p.fill('#ev-venue', 'Sample Hall'); await p.fill('#ev-billing', '150000');
    await p.locator('#ev-meals [data-meal="dinner"]').click(); await p.locator('#ev-meals [data-meal="lunch"]').click();
    assert.equal(await p.locator('#ev-guests').isHidden(), true, 'one box per meal instead');
    assert.deepEqual(await p.locator('#ev-g-meals label').allInnerTexts(), ['Breakfast', 'Lunch', 'Dinner'], 'lunch brings breakfast, as before');
    await p.fill('#ev-mp-breakfast-g', '40'); await p.fill('#ev-mp-lunch-g', '200'); await save();
    assert.match((await errText()).join('|'), /Dinner: guests/);
    await p.fill('#ev-mp-dinner-g', '300'); await save();
    const e = (await dump()).events.find(x => x.name === 'Sample Two Meals');
    assert.deepEqual(e.mealPlan, { breakfast: { guests: 40, rate: 0 }, lunch: { guests: 200, rate: 0 }, dinner: { guests: 300, rate: 0 } });
    assert.ok(!e.guests, 'meal guests are never added up into the event number');
    assert.equal(e.billing, 150000, 'unpriced meals do not touch the bill');
    await openEvent(e.id);
    assert.match(await p.locator('#guests-line').innerText(), /Guests: Breakfast 40 · Lunch 200 · Dinner 300/);
  });

  await test('an upcoming event without guests: the event page asks for them; the count sheet starts with Booked guests', async () => {
    await openEvent('up');
    assert.match(await p.locator('#guests-line').innerText(), /Guest count not entered \(Lunch, Dinner\)/);
    await p.locator('#guests-line [data-action="count-open"]').click(); await p.waitForSelector('#count-modal.active');
    const cards = await p.evaluate(() => [...document.querySelectorAll('#count-body > *')].map(n => n.id || n.tagName));
    assert.equal(cards[0], 'count-booked', 'Booked guests first'); assert.equal(cards.at(-1), 'count-policy', 'count method last');
    assert.equal(await p.locator('#count-policy').getAttribute('open'), null, 'count method collapsed');
    // a day-of count waits for the booked guests
    await p.fill('#count-n', '210'); await p.locator('[data-action="count-save"]').click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#count-modal .field-error').innerText(), /booked guests first/);
    assert.equal((await ev('up')).guestCounts, undefined, 'nothing counted');
    await p.fill('#count-booked-n', '0'); await p.locator('[data-action="count-booked-save"]').click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#count-modal .field-error').innerText(), /1 or more/);
    await p.fill('#count-booked-n', '220'); await p.locator('[data-action="count-booked-save"]').click(); await p.waitForTimeout(500);
    assert.deepEqual((await ev('up')).mealPlan, { dinner: { guests: 220, rate: 0 } });
    assert.match(await p.locator('#count-booked').innerText(), /Booked guests · Dinner\n?/);
  });

  await test('once counting starts, booked guests are fixed (the guarantee is never changed from here)', async () => {
    await p.fill('#count-n', '230'); await p.locator('[data-action="count-save"]').click(); await p.waitForTimeout(500);
    const g = (await ev('up')).guestCounts.dinner;
    assert.equal(g.contracted, 220); assert.equal(g.counts.at(-1).n, 230);
    assert.equal(await p.locator('#count-booked-n').count(), 0, 'no longer editable');
    assert.match(await p.locator('#count-booked').innerText(), /220\nFixed when counting started/);
  });

  await test('a past event without guests can still be corrected; an older event with one guest number saves unchanged', async () => {
    await openEvent('past'); await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active');
    await p.fill('#ev-venue', 'Sample Hall 2'); await save();
    assert.equal((await ev('past')).venue, 'Sample Hall 2');
    const before = await ev('old');
    await openEvent('old');
    assert.match(await p.locator('#guests-line').innerText(), /Guests: Breakfast 400 · Dinner 400/, 'the event number counts for each meal, as before');
    await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active');
    assert.equal(await p.locator('#ev-mp-dinner-g').getAttribute('placeholder'), '400', 'shown as a hint');
    assert.equal(await p.inputValue('#ev-mp-dinner-g'), '', 'not filled in');
    await save();
    assert.deepEqual(noRev(await ev('old')), noRev(before), 'saving unchanged adds nothing');
  });

  await test('360px in English, Marathi and both: the guest boxes fit', async () => {
    for (const lang of ['en', 'mr', 'both']) {
      await p.evaluate(l => localStorage.setItem('ffv2_lang', l), lang);
      await newEventForm();
      for (const m of ['breakfast', 'lunch', 'dinner']) await p.locator(`#ev-meals [data-meal="${m}"]`).click();
      const sheet = await p.locator('#ev-modal .sheet').boundingBox();
      for (const m of ['breakfast', 'lunch', 'dinner']) { const b = await p.locator(`#ev-mp-${m}-g`).boundingBox(); assert.ok(b.x >= sheet.x && b.x + b.width <= sheet.x + sheet.width + 1, `${m} ${lang}`); }
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    }
    await p.evaluate(() => localStorage.setItem('ffv2_lang', 'en'));
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'guest registration FAIL' : 'guest registration PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('guest registration FAIL'); process.exitCode = 1; });
