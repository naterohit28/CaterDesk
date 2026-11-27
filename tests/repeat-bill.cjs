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
  const load = async (d = DATA()) => { await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, d); await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' }); };
  const snap = async () => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-action="snap"]').first().click()]);
    await fc.setFiles({ name: 'bill.png', mimeType: 'image/png', buffer: png }); await p.waitForSelector('[data-action="fill-draft"]'); };
  const fill = async (amt, evId = 'E', { billNo = '', credit = false } = {}) => {
    await p.locator('[data-action="fill-draft"]').first().click(); await p.waitForSelector('#exp-modal.active');
    await p.fill('#exp-amt', String(amt)); await p.selectOption('#exp-ev', evId);
    await p.locator('#exp-cats [data-cat="Live Counter"]').click(); await p.selectOption('#exp-head', STARTER); await p.selectOption('#exp-vendor', 'vs');
    if (credit) await p.locator('#exp-pay [data-pay="credit"]').click();
    if (billNo) await p.evaluate(v => { const b = document.getElementById('exp-billno'); b.value = v; b.dispatchEvent(new Event('input', { bubbles: true })); }, billNo);
    await p.locator('#btn-save-exp').click(); await p.waitForTimeout(300); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });

  await test('the check finds one entry or several adding up to the bill, same vendor and event, nothing else', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js');
      const X = (id, amt, o = {}) => ({ id, amt, venId: 'v', evId: 'e', date: '2026-11-22', ...o });
      const ex = [X('a', 1140), X('b', 1350), X('c', 2490, { evId: 'z' }), X('d', 2490, { venId: 'w' }), X('f', 1000, { draft: true }), X('g', 700, { fromOrder: true, order: 'o1' })];
      const f = (amt, date = '2026-11-22') => (u.repeatBill(ex, { id: 'n', venId: 'v', evId: 'e', amt, date }) || []).map(x => x.id);
      const two = [...ex, X('h', 1000), X('k', 1490)];
      return [f(2490), f(1350), f(2000), f(2490, '2026-12-10'), f(1000), f(700),
        u.repeatBills(two, { id: 'n', venId: 'v', evId: 'e', amt: 2490, date: '2026-11-22' }).map(c => c.map(x => x.id))]; });
    assert.deepEqual(r, [['a', 'b'], ['b'], [], [], [], [], [['a', 'b'], ['h', 'k']]], 'drafts and order-price estimates never match; every combination is offered');
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
    const a = mine.find(x => x.id === 'a'), b = mine.find(x => x.id === 'b'), keep = x => [x.amt, x.cat, x.head, x.pay, x.mode, x.venId, x.date];
    assert.deepEqual([keep(a), keep(b)], DATA().expenses.map(keep), 'amounts, items, payment, vendor and dates unchanged');
    assert.deepEqual(a.billCovers, ['b']); assert.equal(b.billOn, 'a');
    assert.match(a.notes, /Bill photo \(₹2,490\) also covers Starter ₹1,350/); assert.match(b.notes, /Bill photo \(₹2,490\) is on Starter ₹1,140/);
    await p.locator('#n-expenses:visible').click(); await p.waitForTimeout(300);
    const list = (await p.locator('#exp-list').innerText()).replace(/\s+/g, ' ');
    assert.match(list, /bill photo covers 2 entries/); assert.match(list, /bill photo on another entry/);
    const r = await p.evaluate(async () => (await import('./utils.js')).calcEventExpenses('E', (await (await import('./db.js')).exportAllData()).expenses));
    assert.equal(r, 2490);
  });

  await test('the attached photo still opens with its entry and survives a backup round trip', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); await db.importAllData(JSON.parse(JSON.stringify(d)), 'replace');
      const back = (await db.exportAllData()).expenses; return [(await db.getBillsForExpense('a')).length, back.find(x => x.id === 'a').billCovers, back.find(x => x.id === 'b').billOn]; });
    assert.deepEqual(r, [1, ['b'], 'a']);
  });

  await test('deleting the entry that holds the photo says the photo covers the other entry; they stay', async () => {
    await p.locator('#n-expenses:visible').click(); await p.waitForTimeout(300);
    await p.evaluate(() => { const b = document.querySelector('[data-action="edit-exp"][data-id="a"]'); b.scrollIntoView(); b.click(); });
    await p.waitForSelector('#exp-modal.active'); await p.locator('#btn-del-exp').click(); await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-title').innerText(), /This bill photo covers other entries/);
    assert.match(await p.locator('#ask-msg').innerText(), /also covers Starter ₹1,350.*The other entries and their amounts stay/s);
    await p.locator('#ask-actions button').last().click(); await p.waitForTimeout(300);
    assert.ok((await dump()).expenses.some(x => x.id === 'a'), 'nothing deleted when cancelled');
  });

  await test('a typed bill number is kept on the entry, and a different payment status is pointed out, never changed', async () => {
    await load(); await snap(); await fill(2490, 'E', { billNo: 'SAMPLE-77', credit: true });
    await p.waitForSelector('#ask-modal.active');
    const m = await p.locator('#ask-msg').innerText();
    assert.match(m, /Payment differs: .*is paid.*this bill is marked on credit\. Nothing is changed/s); assert.match(m, /Bill no\. SAMPLE-77 is saved on that entry/);
    await p.locator('#ask-actions button', { hasText: 'Attach the bill photo' }).click(); await p.waitForTimeout(800);
    const d = await dump(); assert.equal(d.expenses.find(x => x.id === 'a').billNo, 'SAMPLE-77');
    assert.deepEqual(d.expenses.filter(x => x.evId === 'E').map(x => x.pay), ['paid', 'paid']);
  });

  await test('several combinations match: the person chooses which entries the bill covers', async () => {
    const d0 = DATA(); d0.expenses.push(X('c', 1000), X('d', 1490)); await load(d0); await snap(); await fill(2490);
    await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-msg').innerText(), /matches 2 combinations[\s\S]*1\) Starter ₹1,140 .* \+ Starter ₹1,350[\s\S]*2\) Starter ₹1,000 .* \+ Starter ₹1,490/);
    await p.locator('#ask-actions button', { hasText: 'Attach to 2)' }).click(); await p.waitForTimeout(800);
    const d = await dump(), by = id => d.expenses.find(x => x.id === id);
    assert.deepEqual([by('c').billCovers, by('d').billOn, by('a').billCovers, by('b').billOn], [['d'], 'c', undefined, undefined]);
    assert.equal(d.expenses.filter(x => x.evId === 'E').length, 4, 'no new expense');
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
