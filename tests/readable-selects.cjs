// Long event and vendor names in pickers: the text stays at the readable 16px (never shrunk), a chosen name that
// doesn't fit is written out in full on a line under its picker (only then), in English and in Marathi; nothing
// overflows the screen sideways, and short names change nothing. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const LONG_EN = 'Sample Shree Mahalaxmi Wedding Reception and Sangeet Evening Banquet';
const LONG_MR = 'नमुना श्री महालक्ष्मी विवाह स्वागत समारंभ आणि संगीत संध्या कार्यक्रम';
const VEN_EN = 'Sample Shree Ganesh Grocery and Provision Wholesale Suppliers';
const VEN_MR = 'नमुना श्री गणेश किराणा आणि धान्य घाऊक पुरवठादार मंडळ';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = []; let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const ev = (id, name, venue = 'Sample Hall') => ({ id, name, date: '2099-01-10', venue, type: 'Party – पार्टी', billing: 1000, guests: 10, photoIds: [] });
  const open = async (width = 360) => {
    const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width, height: 780 } });
    const p = await ctx.newPage(); p.setDefaultTimeout(10000); p.on('pageerror', e => errors.push(e.message));
    await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
    await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
      events: [ev('e1', 'Short Party', 'Sample Garden'), ev('e2', LONG_EN), ev('e3', LONG_MR)],
      vendors: [{ id: 'v1', name: 'Ram Stores', cat: 'Raw Material' }, { id: 'v2', name: VEN_EN, cat: 'Raw Material' }, { id: 'v3', name: VEN_MR, cat: 'Raw Material' }] });
    await p.reload(); await p.waitForSelector('#kpi .card');
    await p.locator('#n-expenses:visible').click(); await p.waitForSelector('#tab-expenses.active');
    await p.locator('#fab').click(); await p.waitForSelector('#exp-modal.active'); await p.waitForTimeout(300);
    await p.locator('#exp-pay [data-pay="credit"]').click();   // the vendor picker is used for credit
    return { ctx, p };
  };
  const state = (p, id) => p.evaluate(id => {
    const s = document.getElementById(id), cs = getComputedStyle(s), next = s.nextElementSibling;
    const full = next?.classList.contains('sel-full') ? next : null;
    return { size: parseFloat(cs.fontSize), text: s.selectedOptions[0]?.text || '', full: full?.textContent ?? null,
      fullHidden: full?.getAttribute('aria-hidden'), fullFits: full ? full.scrollWidth <= full.clientWidth : null,
      noSideways: document.documentElement.scrollWidth <= innerWidth && document.querySelector('#exp-modal .sheet').scrollWidth <= document.querySelector('#exp-modal .sheet').clientWidth };
  }, id);
  const pick = async (p, id, value) => { await p.locator('#' + id).selectOption(value); await p.waitForTimeout(150); };

  await test('a short name: 16px, no extra line', async () => {
    const { ctx, p } = await open();
    await pick(p, 'exp-ev', 'e1'); await pick(p, 'exp-vendor', 'v1');
    for (const id of ['exp-ev', 'exp-vendor']) { const s = await state(p, id); assert.equal(s.size, 16, id); assert.equal(s.full, null, `${id}: nothing added`); assert.equal(s.noSideways, true); }
    await ctx.close();
  });

  for (const [label, evId, venId, evName, venName] of [['English', 'e2', 'v2', LONG_EN, VEN_EN], ['Marathi', 'e3', 'v3', LONG_MR, VEN_MR]])
    await test(`long ${label} event and vendor names: still 16px, the full name written under the picker, nothing sideways`, async () => {
      const { ctx, p } = await open();
      await pick(p, 'exp-ev', evId); await pick(p, 'exp-vendor', venId);
      const e = await state(p, 'exp-ev'), v = await state(p, 'exp-vendor');
      assert.equal(e.size, 16, 'event picker not shrunk'); assert.equal(v.size, 16, 'vendor picker not shrunk');
      assert.ok(e.text.includes(evName)); assert.ok(e.full?.includes(evName), 'the event name in full'); assert.equal(e.full, e.text, 'exactly what is chosen');
      assert.equal(v.full, venName, 'the vendor name in full');
      for (const s of [e, v]) { assert.equal(s.fullHidden, 'true', 'not read twice by a screen reader'); assert.equal(s.fullFits, true, 'the line wraps inside the sheet'); assert.equal(s.noSideways, true, 'no sideways scroll'); }
      await ctx.close();
    });

  await test('choosing a short name again removes the line; a wider screen drops it once the name fits', async () => {
    const { ctx, p } = await open();
    await pick(p, 'exp-vendor', 'v2'); assert.equal((await state(p, 'exp-vendor')).full, VEN_EN);
    await pick(p, 'exp-vendor', 'v1'); assert.equal((await state(p, 'exp-vendor')).full, null);
    await pick(p, 'exp-vendor', 'v2');
    await p.setViewportSize({ width: 1200, height: 800 }); await p.waitForTimeout(300);
    const wide = await state(p, 'exp-vendor');
    assert.equal(wide.full, null, 'fits on a wide screen, so no extra line');
    await p.setViewportSize({ width: 360, height: 780 }); await p.waitForTimeout(300);
    assert.equal((await state(p, 'exp-vendor')).full, VEN_EN, 'back on a phone, the full name is shown again');
    await ctx.close();
  });

  await test('tapping a usual-vendor chip updates the full-name line, so it always names the vendor that will be saved (Codex on #83)', async () => {
    const { ctx, p } = await open();
    await p.locator('#exp-cats [data-cat="Raw Material"]').click(); await p.waitForTimeout(150);
    await p.locator('#exp-ven-quick [data-ven="v1"]').waitFor();
    await pick(p, 'exp-vendor', 'v2'); assert.equal((await state(p, 'exp-vendor')).full, VEN_EN);
    await p.locator('#exp-ven-quick [data-ven="v1"]').click(); await p.waitForTimeout(150);
    assert.equal(await p.locator('#exp-vendor').inputValue(), 'v1');
    assert.equal((await state(p, 'exp-vendor')).full, null, 'a short vendor chosen by chip: the long name is gone');
    await p.locator('#exp-ven-quick [data-ven="v2"]').click(); await p.waitForTimeout(150);
    assert.equal((await state(p, 'exp-vendor')).full, VEN_EN, 'the long vendor chosen by chip: its name is shown');
    await p.locator('#exp-ven-quick [data-ven="v2"]').click(); await p.waitForTimeout(150);
    assert.equal(await p.locator('#exp-vendor').inputValue(), '');
    assert.equal((await state(p, 'exp-vendor')).full, null, 'cleared by tapping the chip again: no name left behind');
    await ctx.close();
  });

  await test('reopening the sheet with a long name already chosen shows it in full', async () => {
    const { ctx, p } = await open();
    await pick(p, 'exp-ev', 'e3');
    await p.locator('#exp-modal [data-action="close-modal"]').click(); await p.waitForTimeout(250);
    if (await p.locator('#ask-modal.active').count()) { await p.locator('#ask-actions button', { hasText: 'Discard' }).click(); await p.waitForTimeout(250); }
    await p.locator('#n-events:visible').click(); await p.locator('[data-action="evdetail"][data-id="e3"]:visible').first().click(); await p.waitForSelector('#tab-evdetail.active');
    await p.locator('#fab').click(); await p.waitForSelector('#exp-modal.active'); await p.waitForTimeout(300);
    const e = await state(p, 'exp-ev');
    assert.ok(e.text.includes(LONG_MR), 'the event is preselected'); assert.equal(e.full, e.text); assert.equal(e.size, 16);
    await ctx.close();
  });

  await browser.close();
  assert.deepEqual(errors, [], 'no page errors');
  if (failed) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
