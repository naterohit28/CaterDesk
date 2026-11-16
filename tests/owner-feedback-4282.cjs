// Owner feedback after testing 4.28.1 (4.28.2): a first quote starts from the event's own meals and guests, not a lone
// Dinner line; the total bill is optional (shown as "Not set"); the meal choice never scrolls; "Save timings & setup"
// is a visible button; event photos can be taken with the camera as well as picked from the gallery. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DATA = { version: 'ffv2', photos: [], vPays: [], vendors: [],
  cPays: [{ id: 'p1', evId: 'e1', amt: 25000, date: day(-2), mode: 'UPI' }],
  expenses: [{ id: 'x1', evId: 'e1', cat: 'Raw Material', head: 'Vegetables – भाजी', amt: 4200, date: day(-1), pay: 'paid', mode: 'UPI', billIds: [] },
    { id: 'x3', evId: 'e3', cat: 'Raw Material', head: 'Vegetables – भाजी', amt: 90000, date: day(-1), pay: 'paid', mode: 'UPI', billIds: [] }],
  events: [{ id: 'e1', name: 'Sample Guests No Rates', date: day(20), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 0, meals: ['lunch', 'dinner'], photoIds: [],
      mealPlan: { lunch: { guests: 250, rate: 0 }, dinner: { guests: 300, rate: 0 } } },
    { id: 'e2', name: 'Sample One Meal', date: day(25), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 80000, guests: 120, meals: ['hightea'], photoIds: [] },
    { id: 'e3', name: 'Sample Priced', date: day(30), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 300000, meals: ['breakfast', 'lunch'], photoIds: [],
      mealPlan: { breakfast: { guests: 200, rate: 150 }, lunch: { guests: 400, rate: 0 } } }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const openEvent = async id => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator(`#ev-list [data-action="evdetail"][data-id="${id}"]:visible`).click(); await p.waitForSelector('#tab-evdetail .detail-name'); };
  const quoteLines = () => p.locator('#quote-lines .q-line').evaluateAll(ls => ls.map(l => [l.querySelector('[data-k="meal"]')?.value, l.querySelector('[data-k="guests"]')?.value, l.querySelector('[data-k="rate"]')?.value]));
  const openQuote = async id => { await openEvent(id); await p.locator('#tab-evdetail [data-action="quote-open"]').first().click(); await p.waitForSelector('#quote-modal.active'); await p.waitForTimeout(200); };

  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA);

  await test('a first quote starts from the event\'s meals and booked guests (rates where known), never a lone Dinner line', async () => {
    await openQuote('e1'); assert.deepEqual(await quoteLines(), [['lunch', '250', ''], ['dinner', '300', '']]);
    await p.keyboard.press('Escape');
    await openQuote('e2'); assert.deepEqual(await quoteLines(), [['hightea', '120', '']]);
    await p.keyboard.press('Escape');
    await openQuote('e3'); assert.deepEqual(await quoteLines(), [['breakfast', '200', '150'], ['lunch', '400', '']]);
    await p.keyboard.press('Escape');
  });

  await test('missing rates stay missing: a quote without them cannot be saved, shared or sent, and nothing is kept', async () => {
    await openQuote('e1');
    await p.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; });
    for (const act of ['quote-share', 'quote-save']) {
      await p.locator(`#quote-modal [data-action="${act}"]`).click(); await p.waitForTimeout(300);
      assert.match(await p.locator('#toast-msg').innerText(), /Each meal needs guests and a rate/, act);
    }
    await p.locator('#quote-modal [data-action="quote-sent"]').click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#toast-msg').innerText(), /Each meal needs guests and a rate/, 'I have sent it');
    const r = await p.evaluate(async () => ({ quotes: (await (await import('./db.js')).exportAllData()).events.find(e => e.id === 'e1').quotes, opened: window.__opened.length }));
    assert.deepEqual(r, { quotes: undefined, opened: 0 });
    await p.keyboard.press('Escape');
  });

  await test('a bill not set is never read as a ₹0 bill: no contribution, margin, settlement, payment plan or reconciliation until it is set', async () => {
    await openEvent('e1');
    assert.equal(await p.locator('#ev-bill-unset').innerText(), 'Not set');
    assert.equal(await p.locator('#ev-contrib-unset').innerText(), '—', 'no contribution against a missing bill');
    assert.doesNotMatch(await p.locator('#tab-evdetail').innerText(), /more than the bill|Final settlement/, 'a payment is not "more than the bill"');
    await p.locator('#tab-evdetail [data-action="plan-edit"]').first().click(); await p.waitForTimeout(300);
    assert.equal(await p.locator('#plan-modal.active').count(), 0); assert.match(await p.locator('#toast-msg').innerText(), /Set the event.s total bill first/);
    const blocked = await p.evaluate(async () => { const u = await import('./utils.js'), db = await import('./db.js'), d = await db.exportAllData();
      return u.reconBlockers(d.events.find(e => e.id === 'e1'), d.expenses).map(b => b.en); });
    assert.ok(blocked.includes('The bill is not set yet'), 'reconciliation waits for the bill');
    // Home says how many events have no bill; Reports show them apart and keep them out of per-plate benchmarks
    await p.locator('#n-home:visible').click().catch(() => {}); await p.reload(); await p.waitForSelector('#kpi .card');
    assert.match(await p.locator('#kpi .hero').innerText(), /1 without a bill yet/);
    assert.match(await p.locator('#kpi-awaiting').innerText(), /without a bill yet: not in contribution or pending until the bill is set/);
    await p.locator('#n-summary:visible').click(); await p.waitForTimeout(400);
    const row = p.locator('#tab-summary .bar-row[data-action="evdetail"][data-id="e1"]');
    assert.match(await row.innerText(), /no bill yet[\s\S]*—/);
    // an event with a bill is unchanged
    assert.match(await p.locator('#tab-summary .bar-row[data-action="evdetail"][data-id="e3"]').innerText(), /₹2,10,000/);
  });

  await test('a typed 0 is refused ("leave it empty"); an empty bill saves as not set', async () => {
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click(); await p.locator('#fab').click(); await p.waitForSelector('#ev-modal.active');
    await p.fill('#ev-name', 'Sample Zero Bill'); await p.fill('#ev-date', day(45)); await p.fill('#ev-venue', 'Sample Hall'); await p.fill('#ev-guests', '50'); await p.fill('#ev-billing', '0');
    await p.locator('#btn-save-event').click(); await p.waitForTimeout(400);
    assert.match(await p.locator('#ev-modal').innerText(), /Leave it empty if the bill is not known yet/);
    assert.equal(await p.evaluate(async () => (await (await import('./db.js')).exportAllData()).events.some(e => e.name === 'Sample Zero Bill')), false, 'not saved');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
  });

  await test('the total bill is optional: an event saves without it, with an advance, and its page says "Not set"', async () => {
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click(); await p.locator('#fab').click(); await p.waitForSelector('#ev-modal.active');
    assert.equal(await p.locator('label[for="ev-billing"] .req').count(), 0, 'not marked required');
    await p.fill('#ev-name', 'Sample No Bill Yet'); await p.fill('#ev-date', day(40)); await p.fill('#ev-venue', 'Sample Hall'); await p.fill('#ev-guests', '150');
    if (await p.locator('#ev-adv').isVisible()) await p.fill('#ev-adv', '5000');
    await p.locator('#btn-save-event').click(); await p.waitForTimeout(600);
    while (await p.locator('#ask-modal.active').count()) { await p.locator('#ask-actions button').first().click(); await p.waitForTimeout(400); }
    const ev = await p.evaluate(async () => (await (await import('./db.js')).exportAllData()).events.find(e => e.name === 'Sample No Bill Yet'));
    assert.ok(ev, 'saved'); assert.equal(ev.billing, 0);
    await openEvent(ev.id); assert.equal(await p.locator('#ev-bill-unset').innerText(), 'Not set');
  });

  await test('the meal choice in the event form wraps without any scroll bar (360px and 426px)', async () => {
    for (const width of [360, 426]) {
      await p.setViewportSize({ width, height: 844 });
      await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click(); await p.locator('#fab').click(); await p.waitForSelector('#ev-modal.active');
      await p.locator('#ev-meals [data-meal="dinner"]').click();
      // No scroll bar: the row does not scroll at all (a pressed chip's shadow may spill a few pixels, as on any card)
      const box = await p.locator('#ev-meals').evaluate(el => ({ x: getComputedStyle(el).overflowX, y: getComputedStyle(el).overflowY, w: el.scrollWidth - el.clientWidth }));
      assert.deepEqual(box, { x: 'visible', y: 'visible', w: 0 }, `${width}px`);
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
    }
    await p.setViewportSize({ width: 390, height: 844 });
  });

  await test('"Save timings & setup" is a visible button in light and dark themes', async () => {
    for (const theme of ['light', 'dark']) {
      await p.evaluate(t => localStorage.setItem('ffv2_theme', t), theme);
      await openEvent('e2'); await p.locator('#tab-evdetail [data-action="fs-open"]').first().click(); await p.waitForSelector('#fs-modal.active');
      const btn = p.locator('#fs-modal [data-action="fs-save"]');
      assert.equal(await btn.getAttribute('class'), 'btn btn-secondary', theme);
      assert.notEqual(await btn.evaluate(b => getComputedStyle(b).backgroundColor), 'rgba(0, 0, 0, 0)', `${theme}: has a background`);
      await p.keyboard.press('Escape');
    }
    await p.evaluate(() => localStorage.setItem('ffv2_theme', 'light'));
  });

  await test('event photos: Camera opens the camera directly; Gallery picks photos already on the phone', async () => {
    await openEvent('e2');
    assert.equal(await p.locator('#photo-cam').getAttribute('capture'), 'environment');
    const [cam] = await Promise.all([p.waitForEvent('filechooser'), p.locator('#tab-evdetail [data-action="add-photo-cam"]').click()]);
    assert.equal(await cam.element().evaluate(e => e.id), 'photo-cam');
    const [gal] = await Promise.all([p.waitForEvent('filechooser'), p.locator('#tab-evdetail [data-action="add-photo"]').click()]);
    assert.equal(await gal.element().evaluate(e => e.id), 'photo-input'); assert.equal(gal.isMultiple(), true);
    // coming back from the camera without a photo (cancelled, or camera permission refused) changes nothing
    const [none] = await Promise.all([p.waitForEvent('filechooser'), p.locator('#tab-evdetail [data-action="add-photo-cam"]').click()]);
    await none.setFiles([]); await p.waitForTimeout(500);
    assert.equal(await p.evaluate(async () => (await (await import('./db.js')).exportAllData()).events.find(e => e.id === 'e2').photoIds.length), 0, 'nothing added');
    // a photo taken with the camera is added to the event
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const [again] = await Promise.all([p.waitForEvent('filechooser'), p.locator('#tab-evdetail [data-action="add-photo-cam"]').click()]);
    await again.setFiles({ name: 'sample.png', mimeType: 'image/png', buffer: png }); await p.waitForTimeout(1200);
    const n = await p.evaluate(async () => (await (await import('./db.js')).exportAllData()).events.find(e => e.id === 'e2').photoIds.length);
    assert.equal(n, 1);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'owner feedback 4.28.2 FAIL' : 'owner feedback 4.28.2 PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('owner feedback 4.28.2 FAIL'); process.exitCode = 1; });
