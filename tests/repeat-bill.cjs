// 5.3.4 (owner's phone, 27 Nov 2026): two starter items from one vendor were entered one by one (₹1,140 + ₹1,350),
// then the bill photo of ₹2,490 was filled in and saved as a third entry, so the event's costs counted the bill twice.
// Now saving a new entry, or filling in a bill photo, whose amount equals what is already recorded from that vendor for
// that event (one entry, or 2–4 added together, within 7 days) asks first: attach the photo to those entries (nothing
// new is counted), save it as a different bill, or go back. Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2kAAAAASUVORK5CYII=', 'base64');
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const STARTER = 'Starter – स्टार्टर';
const X = (id, amt, extra = {}) => ({ id, evId: 'E', cat: 'Live Counter', head: STARTER, amt, date: day(-5), pay: 'paid', mode: 'UPI', venId: 'vs', billIds: [], ...extra });
const DATA = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [],
  vendors: [{ id: 'vs', name: 'Sample Snacks Co', cat: 'Live Counter', specialty: STARTER }],
  events: [{ id: 'E', name: 'Sample Gala', date: day(-5), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 100, photoIds: [] },
           { id: 'F', name: 'Sample Other Event', date: day(-5), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 50000, guests: 50, photoIds: [] }],
  expenses: [X('a', 1140), X('b', 1350)] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const load = async () => { await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA()); await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' }); };
  const snap = async () => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-action="snap"]').first().click()]);
    await fc.setFiles({ name: 'bill.png', mimeType: 'image/png', buffer: png }); await p.waitForSelector('[data-action="fill-draft"]'); };
  const fill = async (amt, evId = 'E') => {
    await p.locator('[data-action="fill-draft"]').first().click(); await p.waitForSelector('#exp-modal.active');
    await p.fill('#exp-amt', String(amt)); await p.selectOption('#exp-ev', evId);
    await p.locator('#exp-cats [data-cat="Live Counter"]').click(); await p.selectOption('#exp-head', STARTER); await p.selectOption('#exp-vendor', 'vs');
    await p.locator('#btn-save-exp').click(); await p.waitForTimeout(300); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });

  await test('the check finds one entry or several adding up to the bill, same vendor and event, nothing else', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js');
      const X = (id, amt, o = {}) => ({ id, amt, venId: 'v', evId: 'e', date: '2026-11-22', ...o });
      const ex = [X('a', 1140), X('b', 1350), X('c', 2490, { evId: 'z' }), X('d', 2490, { venId: 'w' }), X('f', 1000, { draft: true })];
      const f = (amt, date = '2026-11-22') => (u.repeatBill(ex, { id: 'n', venId: 'v', evId: 'e', amt, date }) || []).map(x => x.id);
      return [f(2490), f(1350), f(2000), f(2490, '2026-12-10'), f(1000)]; });
    assert.deepEqual(r, [['a', 'b'], ['b'], [], [], []]);
  });

  await test('filling in the bill photo: the question names both entries and their total', async () => {
    await load(); await snap(); await fill(2490);
    await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-title').innerText(), /Already recorded\?/);
    assert.match(await p.locator('#ask-msg').innerText(), /Sample Snacks Co for Sample Gala: Starter ₹1,140 .* \+ Starter ₹1,350 .* = ₹2,490 is already recorded/);
  });

  await test('Attach the bill photo: no third entry, the photo is on the first entry, costs stay ₹2,490', async () => {
    await p.locator('#ask-actions button', { hasText: 'Attach the bill photo' }).click(); await p.waitForTimeout(800);
    const d = await dump(), mine = d.expenses.filter(x => x.evId === 'E');
    assert.deepEqual(mine.map(x => [x.id, x.amt]).sort(), [['a', 1140], ['b', 1350]]);
    assert.equal(d.expenses.filter(x => x.draft).length, 0, 'the bill-photo draft is gone');
    assert.equal(mine.find(x => x.id === 'a').billIds.length, 1);
    assert.equal(d.photos.length, 1); assert.equal(d.photos[0].expenseId, 'a');
    const r = await p.evaluate(async () => (await import('./utils.js')).calcEventExpenses('E', (await (await import('./db.js')).exportAllData()).expenses));
    assert.equal(r, 2490);
  });

  await test('the attached photo still opens with its entry and survives a backup round trip', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); await db.importAllData(JSON.parse(JSON.stringify(d)), 'replace');
      return (await db.getBillsForExpense('a')).length; });
    assert.equal(r, 1);
  });

  await test('Different bill, save: it is saved as its own entry', async () => {
    await load(); await snap(); await fill(2490);
    await p.waitForSelector('#ask-modal.active'); await p.locator('#ask-actions button', { hasText: 'Different bill' }).click(); await p.waitForTimeout(800);
    assert.equal((await dump()).expenses.filter(x => x.evId === 'E').length, 3);
  });

  await test('Go back: nothing saved, the photo stays as a bill to fill in', async () => {
    await load(); await snap(); await fill(1350);
    await p.waitForSelector('#ask-modal.active'); await p.locator('#ask-actions button', { hasText: 'Go back' }).click(); await p.waitForTimeout(400);
    const d = await dump(); assert.equal(d.expenses.filter(x => x.evId === 'E' && !x.draft).length, 2); assert.equal(d.expenses.filter(x => x.draft).length, 1);
  });

  await test('a different amount, or another event, is saved without asking', async () => {
    await load(); await snap(); await fill(2000);
    assert.equal(await p.locator('#ask-modal.active').count(), 0);
    await snap(); await fill(2490, 'F');
    assert.equal(await p.locator('#ask-modal.active').count(), 0);
    assert.equal((await dump()).expenses.filter(x => !x.draft).length, 4);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'repeat-bill FAIL' : 'a bill already entered item by item is not counted twice PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('repeat-bill FAIL'); process.exit(1); });
