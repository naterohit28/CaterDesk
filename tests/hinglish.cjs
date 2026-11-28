// 5.6.0 (owner's requirements): Hinglish as a fourth interface language in the existing i18n.js. Roman-script Hindi
// for everyday words; stored identifiers, typed names, documents and WhatsApp text unchanged; English, Marathi and
// both still work; the choice is kept like the others. Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DATA = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [], vendors: [],
  events: [{ id: 'E', name: 'Sample Save Party', date: day(2), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 50000, guests: 100, photoIds: [] }],
  expenses: [{ id: 'x', evId: 'E', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 500, date: day(-1), pay: 'credit', mode: '', billIds: [], venId: '' }] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });
  await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA());
  await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' });
  const setLang = async l => { await p.locator('#drawer-toggle').click(); await p.locator(`[data-lang-set="${l}"]`).click(); await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(300); };

  await test('Hinglish: everyday words in Roman-script Hindi; typed names and stored values untouched', async () => {
    await setLang('hi');
    assert.equal(await p.evaluate(() => document.documentElement.dataset.lang), 'hi');
    const qa = await p.locator('.qa-grid').innerText();
    assert.match(qa, /Naya event/); assert.match(qa, /Kharcha jodo/); assert.match(qa, /Chhota event/);
    assert.doesNotMatch(qa, /[ऀ-ॿ]/, 'no Marathi shown');
    await p.locator('[data-action="quick"][data-id="expense"]').first().click(); await p.waitForSelector('#exp-modal.active');
    assert.match(await p.locator('#exp-pay').innerText(), /Abhi diya[^]*Udhaar/);
    assert.equal(await p.inputValue('#exp-head').catch(() => ''), await p.locator('#exp-head').evaluate(s => s.value), 'stored values unchanged');
    await p.locator('#exp-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(200);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
    await p.locator('#n-events:visible').click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#ev-list').innerText(), /Sample Save Party/, 'a typed name containing an English word is not changed');
    const d = await p.evaluate(async () => (await import('./db.js')).exportAllData());
    assert.equal(d.expenses[0].head, 'Grocery – किराणा'); assert.equal(d.events[0].type, 'Wedding – लग्न');
  });

  await test('the choice is kept after a reload, and English, Marathi and both still work', async () => {
    await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' });
    assert.equal(await p.evaluate(() => document.documentElement.dataset.lang), 'hi');
    assert.match(await p.locator('.qa-grid').innerText(), /Naya event/);
    await setLang('mr'); assert.match(await p.locator('.qa-grid').innerText(), /नवीन कार्यक्रम/);
    await setLang('en'); assert.match(await p.locator('.qa-grid').innerText(), /New event/); assert.doesNotMatch(await p.locator('.qa-grid').innerText(), /Naya/);
    await setLang('both'); assert.match(await p.locator('.qa-grid').innerText(), /New event[^]*नवीन कार्यक्रम/);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'hinglish FAIL' : 'Hinglish interface PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('hinglish FAIL'); process.exit(1); });
