const BASE_URL = process.env.TEST_BASE_URL;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL || '')) throw new Error('Use npm test');
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); p.setDefaultTimeout(15000);
  const results = [], errors = []; p.on('pageerror', e => errors.push(e.message));
  const test = async (name, fn) => { try { results.push({ name, pass: true, detail: await fn() }); } catch (e) { results.push({ name, pass: false, error: e.stack }); } fs.writeFileSync('test-artifacts/idle-recovery-results.json', JSON.stringify(results, null, 2)); console.log(name, results.at(-1).pass ? 'PASS' : 'FAIL'); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  const seed = async () => {
    await p.evaluate(async () => { const d = await import('./db.js'); await d.setMeta('pin_hash', null); await d.importAllData({ version: 'ffv2', events: [{ id: 'idle-event', name: 'Idle event', date: '2026-10-27', venue: 'Pune', billing: 10000 }], vendors: [{ id: 'idle-vendor', name: 'Supplier', cat: 'Raw Material' }], expenses: [], cPays: [], vPays: [], photos: [] }); });
    await p.reload(); await p.waitForSelector('#kpi .card');
  };
  const newEvent = async name => { await p.locator('#n-events').click(); await p.locator('#fab').click(); for (const [id, value] of [['ev-name', name], ['ev-date', '2026-10-27'], ['ev-venue', 'Pune'], ['ev-billing', '1000']]) await p.locator('#' + id).fill(value); };
  await test('queued write cancels before unlocking Save; wake cannot permit duplicate', async () => {
    await seed(); await newEvent('Blocked save');
    const blocker = await ctx.newPage(); await blocker.goto(BASE_URL); await blocker.waitForSelector('#kpi .card');
    await blocker.evaluate(async () => { const d = await import('./db.js'); const db = await d.openDB(); const tx = db.transaction(['events', 'vendors', 'meta'], 'readwrite'); window.blocker = tx; const pump = () => { const req = tx.objectStore('events').get('hold'); req.onsuccess = pump; req.onerror = e => e.preventDefault(); }; pump(); });
    await p.bringToFront();
    await p.locator('#btn-save-event').click();
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => !!window.hiddenForTest }); window.hiddenForTest = true; document.dispatchEvent(new Event('visibilitychange')); window.hiddenForTest = false; document.dispatchEvent(new Event('visibilitychange')); });
    assert(await p.locator('#btn-save-event').isDisabled());
    await p.waitForFunction(() => !document.querySelector('#btn-save-event').disabled, null, { timeout: 12000 });
    assert.match(await p.locator('#toast').innerText(), /cancelled|busy|aborted/);
    assert.equal(await p.locator('#ev-name').inputValue(), 'Blocked save');
    await blocker.evaluate(() => window.blocker.abort()); await blocker.close();
    await p.waitForTimeout(300);
    assert.equal(await p.evaluate(async () => (await (await import('./db.js')).getAll('events')).filter(e => e.name === 'Blocked save').length), 0);
    await p.locator('#btn-save-event').click(); await p.waitForTimeout(250);
    assert.equal(await p.evaluate(async () => (await (await import('./db.js')).getAll('events')).filter(e => e.name === 'Blocked save').length), 1);
  });
  await test('missing popstate cannot leave a form or navigation stuck', async () => {
    await seed(); await newEvent('Close test');
    await p.evaluate(() => { window.originalBack = history.back.bind(history); history.back = () => {}; });
    await p.locator('#ev-modal [data-action="close-modal"]').click(); await p.waitForTimeout(750);
    assert(await p.locator('#n-home').isEnabled()); await p.locator('#n-home').click(); await p.locator('.qa[data-id="expense"]').click(); await p.locator('#exp-amt').fill('71'); await p.locator('#btn-save-exp').click(); await p.waitForTimeout(750);
    assert.equal(await p.evaluate(async () => (await (await import('./db.js')).getAll('expenses')).length), 1);
    await p.evaluate(() => { history.back = window.originalBack; });
  });
  await test('delayed attachment read does not silently lose bill IDs', async () => {
    await seed(); await p.evaluate(async () => { const d = await import('./db.js'); await d.putOne('expenses', { id: 'withbill', evId: 'idle-event', amt: 100, date: '2026-10-27', pay: 'paid', cat: 'Raw Material', billIds: ['receipt'] }); await d.putOne('photos', { id: 'receipt', expenseId: 'withbill', data: 'data:image/png;base64,AA==' }); });
    await p.reload(); await p.waitForSelector('#kpi .card');
    await p.evaluate(() => { window.nativeIndexGetAll = IDBIndex.prototype.getAll; IDBIndex.prototype.getAll = function (...args) { const req = window.nativeIndexGetAll.apply(this, args); if (this.name !== 'expenseId') return req; return { get result() { return req.result; }, get error() { return req.error; }, set onsuccess(fn) { req.onsuccess = () => setTimeout(fn, 3600); }, set onerror(fn) { req.onerror = fn; } }; }; });
    await p.locator('#n-expenses').click(); await p.locator('#exp-list [data-action="edit-exp"]').click(); await p.locator('#exp-amt').fill('200'); await p.locator('#btn-save-exp').click(); await p.waitForTimeout(2800); assert(await p.locator('#btn-save-exp').isDisabled());
    await p.waitForFunction(() => !document.querySelector('#btn-save-exp').disabled);
    await p.evaluate(() => { IDBIndex.prototype.getAll = window.nativeIndexGetAll; });
    const row = await p.evaluate(async () => (await import('./db.js')).getOne('expenses', 'withbill'));
    assert.equal(row.amt, 200); assert.deepEqual(row.billIds, ['receipt']);
  });
  await test('closed connection recovers on export and import too', async () => {
    await seed(); const payload = await p.evaluate(async () => { const d = await import('./db.js'); (await d.openDB()).close(); return d.exportAllData(); });
    assert.equal(payload.events.length, 1);
    await p.evaluate(async payload => { const d = await import('./db.js'); (await d.openDB()).close(); await d.importAllData(payload); }, payload);
  });
  await test('simulated 30-minute background preserves open entry and unlocks normally', async () => {
    await seed(); await p.evaluate(async () => { const d = await import('./db.js'); const u = await import('./utils.js'); await d.setMeta('pin_hash', await u.hashPin('1234')); });
    await p.reload(); await p.locator('#pin-screen.active').waitFor(); for (const digit of '1234') await p.locator('.pin-key[data-val="' + digit + '"]').click(); await p.waitForTimeout(350);
    await p.locator('.qa[data-id="expense"]').click(); await p.locator('#exp-amt').fill('93');
    await p.evaluate(() => { const native = Date.now; const now = native(); window.hiddenForTest = true; Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.hiddenForTest }); document.dispatchEvent(new Event('visibilitychange')); Date.now = () => now + 1800000; window.hiddenForTest = false; document.dispatchEvent(new Event('visibilitychange')); Date.now = native; });
    await p.locator('#pin-screen.active').waitFor(); for (const digit of '1234') await p.locator('.pin-key[data-val="' + digit + '"]').click(); await p.waitForTimeout(350);
    assert.equal(await p.locator('#exp-amt').inputValue(), '93'); await p.locator('#btn-save-exp').click(); await p.waitForTimeout(250);
    assert.equal(await p.evaluate(async () => (await (await import('./db.js')).getAll('expenses')).filter(x => x.amt === 93).length), 1);
  });
  await test('repeated tab switching and 30 saves stay usable', async () => {
    await seed();
    for (let i = 0; i < 30; i++) { await p.locator('#n-home').click(); await p.locator('.qa[data-id="expense"]').click(); await p.locator('#exp-amt').fill(String(100 + i)); await p.locator('#exp-vendor').selectOption('idle-vendor'); await p.locator('#btn-save-exp').click(); await p.waitForFunction(() => !document.querySelector('#btn-save-exp').disabled); await p.locator('#n-summary').click(); await p.locator('#n-vendors').click(); }
    assert.equal(await p.evaluate(async () => (await (await import('./db.js')).getAll('expenses')).length), 30);
  });
  results.push({ name: 'unexpected idle-test page errors', pass: !errors.length, errors }); fs.writeFileSync('test-artifacts/idle-recovery-results.json', JSON.stringify(results, null, 2));
  await browser.close(); if (results.some(r => !r.pass)) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
