// Form errors for screen readers: a failed save moves focus to the first invalid field (in the form's order), each
// message is tied to its field (aria-invalid + aria-describedby, keeping any hint already linked), a message goes away
// when its field is edited, and fields that are required only in some cases say so (aria-required). The rules, the
// messages and what is saved stay as they were. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = []; let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const open = async (events = []) => {
    const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage(); p.setDefaultTimeout(10000); p.on('pageerror', e => errors.push(e.message));
    await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
    await p.evaluate(async events => { const db = await import('./db.js'); await db.importAllData({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
      vendors: [{ id: 'v1', name: 'Sample Caterer', cat: 'Operations' }], events }); }, events);
    await p.reload(); await p.waitForSelector('#kpi .card');
    return { ctx, p };
  };
  const newEvent = async p => { await p.locator('#n-events:visible').click(); await p.waitForSelector('#tab-events.active'); await p.locator('#fab').click(); await p.waitForSelector('#ev-modal.active'); };
  const save = async p => { await p.locator('#btn-save-event').click(); await p.waitForTimeout(250); };
  // what a screen reader gets for one field
  const a11y = (p, id) => p.evaluate(id => {
    const el = document.getElementById(id), ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    return { invalid: el.getAttribute('aria-invalid'), required: el.getAttribute('aria-required'), describedBy: ids,
      text: ids.map(i => document.getElementById(i)?.textContent || '').join(' | '), focused: document.activeElement === el };
  }, id);
  const eventCount = p => p.evaluate(async () => (await (await import('./db.js')).getAll('events')).length);

  await test('an empty new event: focus goes to the first field, every message is tied to its field, the old messages are unchanged', async () => {
    const { ctx, p } = await open();
    await newEvent(p); await save(p);
    const name = await a11y(p, 'ev-name');
    assert.equal(name.focused, true, 'focus on the event name, the first field');
    assert.equal(name.invalid, 'true');
    assert.equal(name.describedBy.length, 1); assert.ok(name.text.trim().length > 0, 'the name message is read with the field');
    for (const id of ['ev-date', 'ev-venue', 'ev-guests']) {
      const f = await a11y(p, id);
      assert.equal(f.invalid, 'true', `${id} invalid`); assert.ok(f.text.trim(), `${id} has its message linked`);
    }
    assert.equal(await p.locator('#ev-modal .field-error').count(), 4, 'one visible message per invalid field');
    assert.equal(await eventCount(p), 0, 'nothing saved');
    await ctx.close();
  });

  await test('focus follows the form order, not the order the rules run in', async () => {
    const { ctx, p } = await open();
    await newEvent(p);
    await p.fill('#ev-name', 'Sample Client'); await p.fill('#ev-venue', 'Sample Hall'); await p.fill('#ev-guests', '50');
    await p.fill('#ev-billing', '1000'); await p.fill('#ev-adv', '5000');   // the advance rule and the date rule both fail
    await save(p);
    assert.equal((await a11y(p, 'ev-date')).focused, true, 'the date comes before the advance in the form');
    assert.equal((await a11y(p, 'ev-adv')).invalid, 'true');
    await ctx.close();
  });

  await test('editing a field takes away only its own message; saving again checks the rules again', async () => {
    const { ctx, p } = await open();
    await newEvent(p); await save(p);
    await p.fill('#ev-name', 'Sample Client');
    const name = await a11y(p, 'ev-name');
    assert.equal(name.invalid, null); assert.deepEqual(name.describedBy, []);
    assert.equal(await p.locator('#ev-name').evaluate(el => el.classList.contains('error')), false, 'the red border goes too');
    assert.equal((await a11y(p, 'ev-venue')).invalid, 'true', 'the other fields keep their messages');
    assert.equal(await p.locator('#ev-modal .field-error').count(), 3);
    await p.fill('#ev-venue', 'x'); await p.fill('#ev-venue', '');   // typing and deleting again: the message is gone until the next save
    assert.equal(await p.locator('#ev-modal .field-error').count(), 2);
    await save(p);
    assert.equal((await a11y(p, 'ev-venue')).invalid, 'true', 'still empty, so the next save shows it again');
    assert.equal((await a11y(p, 'ev-name')).invalid, null, 'a corrected field stays clear');
    assert.equal((await a11y(p, 'ev-date')).focused, true);
    await ctx.close();
  });

  await test('a corrected form saves as before and leaves no error state behind', async () => {
    const { ctx, p } = await open();
    await newEvent(p); await save(p);
    await p.fill('#ev-name', 'Sample Client'); await p.fill('#ev-date', '2099-02-01'); await p.fill('#ev-venue', 'Sample Hall'); await p.fill('#ev-guests', '80');
    await save(p);
    assert.equal(await p.evaluate(() => document.querySelector('#ev-modal').classList.contains('active')), false, 'saved and closed');
    assert.equal(await eventCount(p), 1);
    assert.equal(await p.locator('[aria-invalid="true"], .field-error:not([hidden])').count(), 0);
    await ctx.close();
  });

  await test('a hint already linked to a field is kept next to its error', async () => {
    const { ctx, p } = await open();
    await p.locator('#n-vendors:visible').click(); await p.waitForSelector('#tab-vendors.active');
    await p.locator('#fab').click(); await p.waitForSelector('#ven-modal.active');
    await p.fill('#ven-name', 'Sample Supplier'); await p.fill('#ven-gstin', 'BAD');
    await p.locator('#btn-save-ven').click(); await p.waitForTimeout(250);
    const g = await a11y(p, 'ven-gstin');
    assert.equal(g.invalid, 'true'); assert.equal(g.focused, true);
    assert.equal(g.describedBy[0], 'ven-gstin-hint', 'the hint is still read'); assert.equal(g.describedBy.length, 2);
    await p.fill('#ven-gstin', '');
    assert.deepEqual((await a11y(p, 'ven-gstin')).describedBy, ['ven-gstin-hint'], 'only the hint is left');
    await ctx.close();
  });

  await test('required fields say so; conditional ones follow their condition; the * is not read out', async () => {
    const { ctx, p } = await open();
    await newEvent(p);
    for (const id of ['ev-name', 'ev-date', 'ev-venue', 'ev-guests']) assert.equal((await a11y(p, id)).required, 'true', `${id} required`);
    assert.equal(await p.locator('#ev-modal label .req:not([aria-hidden="true"])').count(), 0, 'every * hidden from screen readers');
    assert.equal((await a11y(p, 'ev-billing')).required, null, 'an optional field is not required');
    assert.equal((await a11y(p, 'ev-out-ven')).required, null, 'who does the event: not needed while we cater');
    await p.locator('#ev-handling [data-h="out"]').click(); await p.waitForTimeout(100);
    assert.equal((await a11y(p, 'ev-out-ven')).required, 'true', 'needed once someone else does it');
    await p.locator('#ev-handling [data-h="own"]').click(); await p.waitForTimeout(100);
    assert.equal((await a11y(p, 'ev-out-ven')).required, null);
    await p.locator('#ev-meals [data-meal="lunch"]').click(); await p.waitForTimeout(100);
    assert.equal((await a11y(p, 'ev-mp-lunch-g')).required, 'true', 'with meals chosen, each meal needs its guests');
    assert.equal((await a11y(p, 'ev-guests')).required, null);
    await ctx.close();
  });

  await test('a label that gains its * when paying on credit makes its field required', async () => {
    const { ctx, p } = await open([{ id: 'e1', name: 'Sample Event', date: '2099-01-10', venue: 'Sample Hall', type: 'Party – पार्टी', billing: 1000, guests: 10, photoIds: [] }]);
    await p.locator('#n-expenses:visible').click(); await p.waitForSelector('#tab-expenses.active');
    await p.locator('#fab').click(); await p.waitForSelector('#exp-modal.active');
    assert.equal((await a11y(p, 'exp-vendor')).required, null);
    await p.locator('#exp-pay [data-pay="credit"]').click(); await p.waitForTimeout(100);
    assert.equal((await a11y(p, 'exp-vendor')).required, 'true', 'owed to whom: required on credit');
    await ctx.close();
  });

  await test('the menu price message is shown (it used to be dropped) and tied to the price fields', async () => {
    const { ctx, p } = await open();
    await p.locator('#drawer-toggle').click(); await p.locator('#open-menus').click(); await p.waitForSelector('#menus-modal.active'); await p.waitForTimeout(700);
    await p.locator('#btn-menu-new').click(); await p.waitForSelector('#menu-edit-modal.active');
    await p.fill('#me-name', 'Sample Menu'); await p.locator('#btn-me-save').click(); await p.waitForTimeout(250);
    const msg = p.locator('#me-slabs-err');
    assert.equal(await msg.isVisible(), true); assert.match(await msg.textContent(), /Add a price per plate/);
    const focusedInSlabs = await p.evaluate(() => document.querySelector('#me-slabs').contains(document.activeElement));
    assert.equal(focusedInSlabs, true, 'focus on a price field');
    assert.equal(await p.evaluate(() => (document.activeElement.getAttribute('aria-describedby') || '').includes('me-slabs-err')), true);
    await p.locator('#me-slabs [data-ms="0"] [data-k="rate"]').fill('300');
    assert.equal(await msg.isVisible(), false, 'typing a price clears it');
    assert.equal(await p.locator('#me-slabs-err').count(), 1, 'the message slot stays in the page for next time');
    // a price of 0 (refused like an empty one) next to a filled "From guests": the price box is the one to fix (Codex on #78)
    const min = p.locator('#me-slabs [data-ms="0"] [data-k="min"]'), rate = p.locator('#me-slabs [data-ms="0"] [data-k="rate"]');
    await min.fill('50'); await rate.fill('0');
    await p.locator('#btn-me-save').click(); await p.waitForTimeout(250);
    assert.equal(await msg.isVisible(), true, 'a price of 0 is refused as before');
    assert.equal(await rate.evaluate(el => document.activeElement === el), true, 'focus on the price box');
    assert.equal(await rate.getAttribute('aria-invalid'), 'true');
    assert.match(await rate.getAttribute('aria-describedby') || '', /me-slabs-err/);
    assert.equal(await min.getAttribute('aria-invalid'), null, 'the valid "From guests" box is not marked');
    assert.doesNotMatch(await min.getAttribute('aria-describedby') || '', /me-slabs-err/);
    await ctx.close();
  });

  await browser.close();
  assert.deepEqual(errors, [], 'no page errors');
  if (failed) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
