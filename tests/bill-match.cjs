// 5.5.0 (owner's requirements): manual bill matching. When the items of a bill were entered one by one and the bill
// photo's amount does not add up to them exactly (extra charge, rounding, more than 4 items, more than 7 days apart),
// the automatic check finds nothing; the owner ticks the entries the photo covers. Amounts stay untouched; nothing is
// counted twice; one save. Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2kAAAAASUVORK5CYII=', 'base64');
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const STARTER = 'Starter – स्टार्टर';
const X = (id, amt, extra = {}) => ({ id, evId: 'E', cat: 'Live Counter', head: STARTER, amt, date: day(-5), pay: 'paid', mode: 'UPI', venId: 'vs', billIds: [], ...extra });
const DATA = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [],
  vendors: [{ id: 'vs', name: 'Sample Snacks Co', cat: 'Live Counter', specialty: STARTER }],
  events: [{ id: 'E', name: 'Sample Gala', date: day(-5), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 100, photoIds: [] }],
  expenses: [X('a', 1140), X('b', 1350), X('c', 800, { date: day(-20) })] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const load = async (d = DATA()) => { await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, d); await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' }); };
  const snap = async () => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-action="snap"]').first().click()]);
    await fc.setFiles({ name: 'bill.png', mimeType: 'image/png', buffer: png }); await p.waitForSelector('[data-action="fill-draft"]'); };
  const fillIn = async amt => {
    await p.locator('[data-action="fill-draft"]').first().click(); await p.waitForSelector('#exp-modal.active');
    await p.fill('#exp-amt', String(amt)); await p.selectOption('#exp-ev', 'E');
    await p.locator('#exp-cats [data-cat="Live Counter"]').click(); await p.selectOption('#exp-head', STARTER); await p.selectOption('#exp-vendor', 'vs'); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });

  await test('the entries offered: same vendor within 60 days, nearest first; never drafts, order estimates, split parts or entries on another photo', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js');
      const X = (id, date, o = {}) => ({ id, amt: 100, venId: 'v', evId: 'e', date, ...o });
      const ex = [X('a', '2026-11-20'), X('b', '2026-11-25'), X('c', '2026-11-20', { venId: 'w' }), X('d', '2026-11-20', { draft: true }), X('f', '2026-11-20', { fromOrder: true }),
        X('g', '2026-11-20', { billOn: 'a' }), X('h', '2026-11-20', { split: { id: 's' } }), X('k', '2026-08-01'), X('m', '2026-11-21', { venId: '', evId: 'e' })];
      return [u.billCandidates(ex, { id: 'n', venId: 'v', evId: 'e', date: '2026-11-26' }).map(x => x.id),
        u.billCandidates(ex, { id: 'n', venId: '', evId: 'e', date: '2026-11-26' }).map(x => x.id), u.billCandidates(ex, { id: 'n', venId: '', evId: '', date: '2026-11-26' }).length]; });
    assert.deepEqual(r, [['b', 'a'], ['b', 'm', 'a', 'c'], 0], 'with no vendor: every vendor on this event');
  });

  await test('a ₹2,600 bill photo over ₹1,140 + ₹1,350 already entered: no automatic match, so tick them by hand', async () => {
    await load(); await snap(); await fillIn(2600);
    assert.equal(await p.locator('#btn-exp-match').isVisible(), true, 'offered on a bill photo being filled in');
    await p.locator('#btn-exp-match').click(); await p.waitForSelector('#ask-modal.active #match-list');
    assert.deepEqual(await p.locator('#match-list label').evaluateAll(l => l.map(x => x.innerText.split(' · ')[0])), ['Starter ₹1,140', 'Starter ₹1,350', 'Starter ₹800']);
    await p.locator('#match-list [data-match="a"]').check(); await p.locator('#match-list [data-match="b"]').check();
    assert.match(await p.locator('#match-sum').innerText(), /Ticked ₹2,490 · this bill ₹2,600 \(differs by ₹110\)/);
    await p.locator('#ask-actions button', { hasText: 'Attach the bill photo' }).click(); await p.waitForTimeout(800);
    const d = await dump(), a = d.expenses.find(x => x.id === 'a'), b = d.expenses.find(x => x.id === 'b');
    assert.deepEqual(d.expenses.filter(x => x.evId === 'E' && !x.draft).map(x => [x.id, x.amt]).sort(), [['a', 1140], ['b', 1350], ['c', 800]], 'no new entry, amounts untouched');
    assert.equal(d.expenses.filter(x => x.draft).length, 0, 'the bill-photo draft is gone');
    assert.equal(a.billIds.length, 1); assert.deepEqual(a.billCovers, ['b']); assert.equal(b.billOn, 'a');
    assert.equal(d.photos.find(ph => ph.id === a.billIds[0]).expenseId, 'a');
  });

  await test('the automatic question also offers choosing by hand', async () => {
    await load(); await snap(); await fillIn(2490);
    await p.locator('#btn-save-exp').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Choose the entries myself' }).click(); await p.waitForSelector('#ask-modal.active #match-list');
    await p.locator('#match-list [data-match="b"]').check(); await p.locator('#ask-actions button', { hasText: 'Attach the bill photo' }).click(); await p.waitForTimeout(800);
    const d = await dump();
    assert.equal(d.expenses.find(x => x.id === 'b').billIds.length, 1); assert.equal(d.expenses.filter(x => x.draft).length, 0);
  });

  await test('nothing ticked: nothing changes', async () => {
    await load(); await snap(); await fillIn(5000);
    await p.locator('#btn-exp-match').click(); await p.waitForSelector('#ask-modal.active #match-list');
    await p.locator('#ask-actions button', { hasText: 'Attach the bill photo' }).click(); await p.waitForTimeout(400);
    const d = await dump();
    assert.equal(d.expenses.filter(x => x.draft).length, 1); assert.ok(d.expenses.every(x => !x.billCovers && !x.billOn));
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'bill-match FAIL' : 'manual bill matching PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('bill-match FAIL'); process.exit(1); });
