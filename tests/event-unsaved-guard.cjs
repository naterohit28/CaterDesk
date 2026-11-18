// A new or edited event with unsaved changes asks "Keep editing / Discard changes" before it is dismissed, by the close
// button, a tap outside the sheet, Escape and the phone's Back; an unchanged form closes at once; Save closes normally;
// a failed save keeps what was typed; other sheets and the app's Back history behave as before. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = []; let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const open = async ({ slowBackMs = 0 } = {}) => {
    const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
    if (slowBackMs) await ctx.addInitScript(ms => {   // a slow phone: the browser's Back takes effect late, in order
      const back = history.back.bind(history), go = history.go.bind(history); let chain = Promise.resolve();
      history.back = () => { chain = chain.then(() => new Promise(r => setTimeout(() => { back(); setTimeout(r, 50); }, ms))); };
      history.go = n => { chain = chain.then(() => new Promise(r => { go(n); setTimeout(r, 50); })); };
    }, slowBackMs);
    const p = await ctx.newPage(); p.setDefaultTimeout(10000); p.on('pageerror', e => errors.push(e.message));
    await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
    await p.evaluate(async () => { const db = await import('./db.js'); await db.importAllData({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [], vendors: [],
      events: [{ id: 'e1', name: 'Sample Guard Event', date: '2099-01-10', venue: 'Sample Hall', type: 'Party – पार्टी', billing: 1000, guests: 10,
        meals: ['lunch', 'dinner'], mealPlan: { lunch: { guests: 40, rate: 300 }, dinner: { guests: 60, rate: 450 } }, logistics: { power: 'genset' }, mobile: '9876543210', notes: 'Sample note', photoIds: [] }] }); });
    await p.reload(); await p.waitForSelector('#kpi .card');
    await p.locator('#n-events:visible').click(); await p.waitForSelector('#tab-events.active');
    return { ctx, p };
  };
  const sheetOpen = p => p.evaluate(() => document.querySelector('#ev-modal').classList.contains('active'));
  const askOpen = p => p.evaluate(() => document.querySelector('#ask-modal').classList.contains('active'));
  const hist = p => p.evaluate(() => history.state);
  const settle = p => p.waitForTimeout(250);
  const newEvent = async p => { await p.locator('#fab').click(); await p.waitForSelector('#ev-modal.active'); };
  const editEvent = async p => {
    await p.locator('[data-action="evdetail"][data-id="e1"]:visible').first().click(); await p.waitForSelector('#tab-evdetail.active');
    await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active');
  };
  const dismissals = {
    'close button': p => p.locator('#ev-modal [data-action="close-modal"]').click(),
    'tap outside':  p => p.locator('#ev-modal').click({ position: { x: 20, y: 20 } }),
    'Escape':       p => p.keyboard.press('Escape'),
    'Back':         p => p.goBack({ waitUntil: 'commit' }).catch(() => {})
  };
  const eventCount = p => p.evaluate(async () => (await (await import('./db.js')).getAll('events')).length);

  await test('unchanged new and edited events close at once by every route, with no question', async () => {
    const { ctx, p } = await open();
    for (const [route, act] of Object.entries(dismissals)) for (const opener of [newEvent, editEvent]) {
      const before = await hist(p);
      await opener(p);
      await p.locator('#ev-logi summary').click();   // opening a section is not a change
      await act(p); await settle(p);
      assert.equal(await askOpen(p), false, `${route}: no question for an unchanged form`);
      assert.equal(await sheetOpen(p), false, `${route}: the unchanged form closed`);
      if (opener === editEvent) { assert.equal((await hist(p)).tab, 'evdetail'); await p.locator('#hdr-back').click(); await p.waitForSelector('#tab-events.active'); }
      else assert.deepEqual(await hist(p), before, `${route}: history back where it was`);
    }
    await ctx.close();
  });

  await test('typing a value and deleting it again is not a change', async () => {
    const { ctx, p } = await open();
    await editEvent(p);
    await p.fill('#ev-venue', 'Another Hall'); await p.fill('#ev-venue', 'Sample Hall ');
    await p.locator('#ev-meals [data-meal="breakfast"]').click(); await p.locator('#ev-meals [data-meal="breakfast"]').click();
    await dismissals['close button'](p); await settle(p);
    assert.equal(await askOpen(p), false); assert.equal(await sheetOpen(p), false);
    await ctx.close();
  });

  for (const route of Object.keys(dismissals)) await test(`${route} on a changed form asks; Keep editing keeps every value; Discard closes without saving`, async () => {
    const { ctx, p } = await open();
    const before = await hist(p), count = await eventCount(p);
    await newEvent(p);
    await p.fill('#ev-name', 'Unsaved Sample Client'); await p.fill('#ev-venue', 'Unsaved Hall');
    await p.locator('#ev-meals [data-meal="lunch"]').click();
    await dismissals[route](p); await p.waitForSelector('#ask-modal.active');
    assert.equal(await sheetOpen(p), true, 'the form stays behind the question');
    assert.match(await p.locator('#ask-actions button').first().textContent(), /Keep editing/, 'the safe choice comes first');
    assert.equal(await p.locator('#ask-actions button').count(), 2, 'Keep editing and Discard only');
    assert.equal(await p.evaluate(() => document.activeElement?.textContent), await p.locator('#ask-actions button').first().textContent(), 'focus on Keep editing');
    await p.locator('#ask-actions button', { hasText: 'Keep editing' }).click(); await settle(p);
    assert.equal(await askOpen(p), false); assert.equal(await sheetOpen(p), true, 'still editing');
    assert.equal(await p.inputValue('#ev-name'), 'Unsaved Sample Client'); assert.equal(await p.inputValue('#ev-venue'), 'Unsaved Hall');
    assert.equal(await p.locator('#ev-meals [data-meal="lunch"]').getAttribute('aria-pressed'), 'true');
    assert.equal((await hist(p)).overlay, true, 'the form still has its own history entry');
    await dismissals[route](p); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Discard' }).click(); await settle(p); await settle(p);
    assert.equal(await askOpen(p), false); assert.equal(await sheetOpen(p), false, 'discarded');
    assert.deepEqual(await hist(p), before, 'history back where it was before the form opened');
    assert.equal(await eventCount(p), count, 'nothing saved');
    await newEvent(p);
    assert.equal(await p.inputValue('#ev-name'), '', 'a new form starts empty again');
    await ctx.close();
  });

  await test('Back and Escape on the question itself mean Keep editing', async () => {
    const { ctx, p } = await open();
    await editEvent(p);
    await p.fill('#ev-notes', 'Changed sample note');
    await dismissals.Back(p); await p.waitForSelector('#ask-modal.active');
    await dismissals.Back(p); await settle(p);
    assert.equal(await askOpen(p), false); assert.equal(await sheetOpen(p), true);
    await dismissals.Escape(p); await p.waitForSelector('#ask-modal.active');
    await dismissals.Escape(p); await settle(p);
    assert.equal(await askOpen(p), false); assert.equal(await sheetOpen(p), true);
    assert.equal(await p.inputValue('#ev-notes'), 'Changed sample note');
    // Back history still lines up: Back asks, Discard closes, Back again leaves the event page for Events
    await dismissals.Back(p); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Discard' }).click(); await settle(p); await settle(p);
    assert.equal(await sheetOpen(p), false); assert.equal((await hist(p)).tab, 'evdetail'); assert.ok(!(await hist(p)).overlay);
    await dismissals.Back(p); await p.waitForSelector('#tab-events.active');
    const ev = await p.evaluate(async () => (await (await import('./db.js')).getAll('events')).find(e => e.id === 'e1'));
    assert.equal(ev.notes, 'Sample note', 'discarded edit not saved');
    await ctx.close();
  });

  await test('Save closes normally without a question; the edit is saved', async () => {
    const { ctx, p } = await open();
    await editEvent(p);
    await p.fill('#ev-venue', 'Saved Sample Hall');
    await p.locator('#btn-save-event').click(); await settle(p); await settle(p);
    assert.equal(await askOpen(p), false); assert.equal(await sheetOpen(p), false);
    assert.equal((await hist(p)).tab, 'evdetail'); assert.ok(!(await hist(p)).overlay);
    const ev = await p.evaluate(async () => (await (await import('./db.js')).getAll('events')).find(e => e.id === 'e1'));
    assert.equal(ev.venue, 'Saved Sample Hall');
    await p.locator('#hdr-back').click(); await p.waitForSelector('#tab-events.active');   // the event page's + adds an expense
    await newEvent(p);
    await p.fill('#ev-name', 'New Saved Client'); await p.fill('#ev-date', '2099-02-02'); await p.fill('#ev-venue', 'New Hall'); await p.fill('#ev-guests', '25');
    await p.locator('#btn-save-event').click(); await settle(p); await settle(p);
    assert.equal(await askOpen(p), false); assert.equal(await sheetOpen(p), false);
    assert.equal(await eventCount(p), 2);
    await ctx.close();
  });

  await test('a failed save keeps the form open with every value, and dismissing it still asks', async () => {
    const { ctx, p } = await open();
    await newEvent(p);
    await p.fill('#ev-name', 'Failing Sample Client'); await p.fill('#ev-venue', 'Failing Hall'); await p.fill('#ev-guests', '30');
    await p.locator('#btn-save-event').click(); await settle(p);   // no date: refused by validation
    assert.equal(await sheetOpen(p), true); assert.equal(await p.inputValue('#ev-name'), 'Failing Sample Client');
    await p.fill('#ev-date', '2099-03-03');
    await p.evaluate(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { IDBObjectStore.prototype.put = put; throw new DOMException('Sample failure', 'UnknownError'); }; });
    await p.locator('#btn-save-event').click(); await p.waitForSelector('#toast.error');
    assert.equal(await sheetOpen(p), true, 'the form stays after a storage failure');
    assert.equal(await p.inputValue('#ev-name'), 'Failing Sample Client'); assert.equal(await p.inputValue('#ev-date'), '2099-03-03');
    assert.equal(await eventCount(p), 1, 'nothing half-saved');
    await dismissals['close button'](p); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Keep editing' }).click(); await settle(p);
    await p.locator('#btn-save-event').click(); await settle(p); await settle(p);
    assert.equal(await sheetOpen(p), false, 'saved on the retry'); assert.equal(await eventCount(p), 2);
    await ctx.close();
  });

  await test('slow phone: Back on a changed form, then Discard, leaves history and Home navigation working', async () => {
    const { ctx, p } = await open({ slowBackMs: 900 });
    await newEvent(p);
    await p.fill('#ev-name', 'Slow Sample Client');
    await dismissals.Back(p); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Discard' }).click();
    await p.waitForFunction(() => !document.querySelector('#ev-modal').classList.contains('active'));
    await p.waitForTimeout(2500);   // let the late Backs land
    assert.equal(await sheetOpen(p), false); assert.equal(await askOpen(p), false);
    await p.locator('#n-home').click(); await p.waitForTimeout(1500);
    assert.equal(await p.evaluate(() => document.querySelector('.tab.active')?.id), 'tab-home');
    await ctx.close();
  });

  await test('other sheets are unchanged: a typed expense or vendor still closes at once', async () => {
    const { ctx, p } = await open();
    await p.locator('#n-expenses:visible').click(); await p.waitForSelector('#tab-expenses.active');
    await p.locator('#fab').click(); await p.waitForSelector('#exp-modal.active');
    await p.fill('#exp-amt', '500');
    await p.keyboard.press('Escape'); await settle(p);
    assert.equal(await askOpen(p), false);
    assert.equal(await p.evaluate(() => document.querySelector('#exp-modal').classList.contains('active')), false);
    await p.locator('#n-vendors:visible').click(); await p.waitForSelector('#tab-vendors.active');
    await p.locator('#fab').click(); await p.waitForSelector('#ven-modal.active');
    await p.fill('#ven-name', 'Sample Vendor');
    await p.goBack({ waitUntil: 'commit' }).catch(() => {}); await settle(p);
    assert.equal(await askOpen(p), false);
    assert.equal(await p.evaluate(() => document.querySelector('#ven-modal').classList.contains('active')), false);
    await ctx.close();
  });

  await browser.close();
  assert.deepEqual(errors, [], 'no page errors');
  if (failed) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
