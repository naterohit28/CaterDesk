// Business details + printable quote (spec §6.5, D-3, G-27): only owner-entered details; no costs on the document;
// a sent quote keeps the details it went out with. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DATA = { version: 'ffv2', photos: [], vendors: [], vPays: [], cPays: [],
  expenses: [{ id: 'x1', evId: 'W', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 123456, date: day(-1), pay: 'paid' }],
  events: [{ id: 'W', name: 'Sample Wedding', date: day(20), venue: 'Sample Lawn', type: 'Wedding – लग्न', billing: 0, guests: 300, photoIds: [], mobile: '9000000005',
    meals: ['dinner'], mealPlan: { dinner: { guests: 300, rate: 800, menu: 'golden' } } }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const fillProfile = async v => { await p.locator('#drawer-toggle').click(); await p.locator('#open-profile').click(); await p.waitForSelector('#profile-modal.active');
    for (const [k, val] of Object.entries(v)) await p.fill('#pf-' + k, val); await p.locator('#btn-save-profile').click(); await p.waitForTimeout(400); };
  const openQuote = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="W"]:visible').click(); await p.locator('[data-action="quote-open"]').click(); await p.waitForSelector('#quote-modal.active');
    await p.evaluate(() => { window.__printed = []; window.print = () => window.__printed.push(document.querySelector('#print-doc').innerText); window.open = () => null; }); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);

  await test('business details: name required, GSTIN format checked, saved only as entered', async () => {
    await fillProfile({ name: '', gstin: '' });
    assert.equal(await p.locator('#profile-modal.active').count(), 1, 'refused without a name');
    await p.fill('#pf-name', 'Sample Caterers'); await p.fill('#pf-gstin', '27ABC'); await p.locator('#btn-save-profile').click(); await p.waitForTimeout(300);
    assert.equal(await p.locator('#profile-modal.active').count(), 1, 'a short GSTIN is refused');
    await p.fill('#pf-gstin', '27abcde1234f1z5'); await p.fill('#pf-phone', '9000000009'); await p.fill('#pf-address', 'Sample Road, Pune');
    await p.fill('#pf-pay', 'UPI sample@upi'); await p.fill('#pf-footer', 'Thank you'); await p.locator('#btn-save-profile').click(); await p.waitForTimeout(400);
    const prof = await p.evaluate(() => JSON.parse(localStorage.getItem('ffv2_profile')));
    assert.deepEqual(prof, { name: 'Sample Caterers', address: 'Sample Road, Pune', phone: '9000000009', gstin: '27ABCDE1234F1Z5', pay: 'UPI sample@upi', footer: 'Thank you' });
  });

  await test('Print / Save as PDF: an A4 quotation with your details, lines and totals – and no costs', async () => {
    await openQuote();
    await p.locator('[data-ql-add="item"]').click(); await p.locator('#quote-lines [data-ql="1"] [data-k="label"]').fill('Counter setup'); await p.locator('#quote-lines [data-ql="1"] [data-k="amt"]').fill('15000');
    await p.locator('[data-gst-add]').click(); await p.fill('[data-g="rate"]', '5'); await p.fill('#quote-terms', '50% advance to confirm');
    await p.locator('[data-action="quote-print"]').click(); await p.waitForTimeout(300);
    const [doc] = await p.evaluate(() => window.__printed);
    for (const re of [/Sample Caterers/, /Sample Road, Pune/, /GSTIN 27ABCDE1234F1Z5/, /QUOTATION|Quotation/i, /Sample Wedding/, /Version 1/,
      /Dinner – Golden menu\s*300 × ₹800\s*₹2,40,000/, /Counter setup\s*₹15,000/, /Subtotal\s*₹2,55,000/, /GST @ 5% on ₹2,55,000\s*₹12,750/, /Total\s*₹2,67,750/, /50% advance to confirm/, /UPI sample@upi/, /Thank you/]) assert.match(doc, re);
    assert.doesNotMatch(doc, /1,23,456|cost|margin|contribution|profit/i, 'no internal figures');
    assert.equal(await p.evaluate(() => document.body.classList.contains('printing')), true, 'only the document prints');
  });

  await test('G-27: a sent quote keeps the business details it went out with; new quotes use the updated details', async () => {
    await p.locator('[data-action="quote-sent"]').click(); await p.waitForTimeout(400);
    const sent = (await p.evaluate(async () => (await import('./db.js')).exportAllData())).events[0].quotes[0];
    assert.equal(sent.profile.name, 'Sample Caterers');
    await p.reload(); await p.waitForSelector('#kpi .card'); await fillProfile({ name: 'Sample Caterers & Events', gstin: '' });
    await openQuote(); await p.locator('[data-action="quote-print"]').click(); await p.waitForTimeout(300);
    let [doc] = await p.evaluate(() => window.__printed);
    assert.match(doc, /Sample Caterers/); assert.doesNotMatch(doc, /& Events/); assert.match(doc, /GSTIN 27ABCDE1234F1Z5/, 'old document unchanged');
    await p.locator('[data-action="quote-new"]').click(); await p.locator('[data-action="quote-print"]').click(); await p.waitForTimeout(300);
    [, doc] = await p.evaluate(() => window.__printed);
    assert.match(doc, /Sample Caterers & Events/); assert.doesNotMatch(doc, /GSTIN/);
  });

  await test('business details travel with backups; a bad saved copy on a quote is refused', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const c = structuredClone(d); delete c.manifest;
      c.events[0].quotes[0].profile = { name: 5 }; let err = ''; try { await db.importAllData(c, 'replace'); } catch (e) { err = e.message; } return err; });
    assert.match(r, /Invalid quote/);
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#drawer-toggle').click();
    const shared = await p.evaluate(async () => { let got = null; navigator.canShare = () => true; navigator.share = async d => { got = d; };
      document.querySelector('#btn-export').click(); for (let i = 0; i < 40 && !got && !document.querySelector('#ask-modal.active'); i++) await new Promise(r => setTimeout(r, 100));
      const b = document.querySelector('#ask-actions button'); if (!got && b) b.click(); for (let i = 0; i < 40 && !got; i++) await new Promise(r => setTimeout(r, 100));
      return got ? JSON.parse(await got.files[0].text()).prefs : null; });
    assert.equal(JSON.parse(shared.ffv2_profile).name, 'Sample Caterers & Events');
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'quote pdf FAIL' : 'business details and printable quote (D-3, G-27) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('quote pdf FAIL'); process.exitCode = 1; });
