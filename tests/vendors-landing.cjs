// Vendors tab and vendor GSTIN (4.27.0): a summary of what you owe suppliers and the advances you gave them (people who
// lent you money are kept apart), search by name / category / speciality / phone / GSTIN, filters, sorting and Show
// more; an optional, checked GSTIN and registered name on vendors (never on a person), shown with Copy and a link to
// the official GST search. Totals match each vendor's own ledger. 360px and 390px, English, Marathi and both.
// Synthetic data only: "Sample" names, 90000000xx numbers, made-up GSTINs.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const LONG = 'Sample Shree Ganesh Mega Catering Supplies and General Provision Stores Private Limited';
function dataset(n = 45) {
  const vendors = [], expenses = [], vPays = [];
  const cats = [['Live Counter', 'Chaat – चाट'], ['Groceries', ''], ['Labour', ''], ['Decoration', '']];
  for (let i = 1; i <= n; i++) { const [cat, specialty] = cats[i % 4];
    vendors.push({ id: 'v' + i, name: i === 3 ? LONG : `Sample Vendor ${String(i).padStart(3, '0')}`, cat, specialty, phone: '90000000' + String(i % 100).padStart(2, '0') }); }
  vendors.push({ id: 'p1', name: 'Sample Lender', kind: 'person', cat: '', specialty: '' });
  // v1–v30 have a bill on credit (v1 newest); v20–v30 are paid: odd ones exactly (settled), even ones ₹500 more (advance)
  for (let i = 1; i <= Math.min(30, n); i++) expenses.push({ id: 'x' + i, venId: 'v' + i, amt: 1000 * i, date: day(-i - 10), cat: 'Groceries', head: 'Sample', pay: 'credit', stock: true });
  for (let i = 20; i <= Math.min(30, n); i++) vPays.push({ id: 'vp' + i, venId: 'v' + i, amt: i % 2 ? 1000 * i : 1000 * i + 500, date: day(-5), mode: 'Cash' });
  vPays.push({ id: 'vp-recent', venId: 'v40', amt: 100, date: day(-1), mode: 'Cash' });   // v40: only an advance, used most recently
  expenses.push({ id: 'xp', venId: 'p1', amt: 5000, date: day(-2), cat: 'Groceries', head: 'Sample', pay: 'credit', stock: true });
  return { version: 'ffv2', photos: [], cPays: [], events: [], vendors, expenses, vPays };
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const load = d => p.evaluate(async x => { const db = await import('./db.js'); await db.importAllData(x, 'replace'); }, d);
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const openVendors = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-vendors:visible').click(); await p.waitForSelector('#tab-vendors.active'); };
  const names = sel => p.locator(`${sel} .row .ven-name`).allInnerTexts();
  const supNames = () => names('#ven-sup');
  const chip = k => p.locator(`#ven-filters [data-id="${k}"]`);
  const search = async t => { await p.fill('#ven-q', t); await p.waitForTimeout(150); };
  const noOverflow = () => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  // A made-up GSTIN with a correct check character (state 27, PAN-like part from the given letters)
  const gstin = body => p.evaluate(async b => { const u = await import('./utils.js'); for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (u.gstinValid(b + c)) return b + c; }, body);
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');

  await test('no vendors: the empty state offers Add vendor; the summary and tools are hidden', async () => {
    await load({ version: 'ffv2', photos: [], cPays: [], events: [], vendors: [], expenses: [], vPays: [] });
    await openVendors();
    assert.match(await p.locator('#ven-list').innerText(), /No vendors yet/);
    assert.equal(await p.locator('#ven-list [data-action="quick"][data-id="vendor"]').count(), 1);
    assert.equal(await p.locator('#ven-tools').isHidden(), true); assert.equal(await p.locator('#ven-sum').innerText(), '');
  });

  await load(dataset());
  await test('summary: total payable sums only what you owe suppliers, advances shown apart, people left out; each matches the vendor\'s ledger', async () => {
    await openVendors();
    const expect = await p.evaluate(async () => { const u = await import('./utils.js'), db = await import('./db.js'); const d = await db.exportAllData();
      let pay = 0, adv = 0; for (const v of d.vendors.filter(v => v.kind !== 'person')) { const b = u.calcVendorBalance(v.id, d.expenses, d.vPays).balance; if (b > 0) pay += b; else adv -= b; }
      return { pay: u.fmtCurrency(pay), adv: u.fmtCurrency(adv), n: d.vendors.filter(v => v.kind !== 'person').length }; });
    assert.deepEqual(expect, { pay: '₹1,90,000', adv: '₹3,100', n: 45 }, 'v1–v19 owed, six ₹500 advances and v40\'s ₹100; the lender\'s ₹5,000 is not a supplier');
    const sum = await p.locator('#ven-sum').innerText();
    assert.match(sum, /Total payable\n₹1,90,000/); assert.match(sum, /Vendor advances\n₹3,100/); assert.match(sum, /Total vendors\n45/);
    assert.match(await p.locator('#ven-list').innerText(), /Other people\nyou owe\n?₹5,000[\s\S]*Sample Lender/);
    // the same figure as the vendor's own page
    await p.locator('#ven-list [data-id="v19"]').click(); await p.waitForSelector('#tab-vendetail.active');
    assert.match(await p.locator('#tab-vendetail').innerText(), /You owe\n₹19,000/);
  });

  await test('filters: All, To pay, Advances, Settled and No activity, with counts; nothing to show offers Show all', async () => {
    await openVendors();
    assert.deepEqual((await p.locator('#ven-filters .f-chip').allInnerTexts()).map(t => t.replace(/\s+/g, ' ')), ['All 46', 'To pay 20', 'Advances 7', 'Settled 5', 'No activity 14']);
    await chip('adv').click(); await p.waitForTimeout(100);
    assert.deepEqual((await supNames()).sort(), ['Sample Vendor 020', 'Sample Vendor 022', 'Sample Vendor 024', 'Sample Vendor 026', 'Sample Vendor 028', 'Sample Vendor 030', 'Sample Vendor 040']);
    assert.equal(await chip('adv').getAttribute('aria-pressed'), 'true');
    await chip('settled').click(); assert.equal((await supNames()).length, 5);
    await chip('none').click(); assert.equal((await supNames()).length, 14);
    await chip('pay').click();
    assert.equal((await supNames()).length, 19); assert.match(await p.locator('#ven-list').innerText(), /Sample Lender/, 'a person you owe is under To pay, in their own section');
    await search('Sample Vendor 041'); assert.match(await p.locator('#ven-list').innerText(), /No matching vendors/);
    await p.locator('#ven-list [data-action="ven-filter"][data-id="all"]').click(); await p.waitForTimeout(100);
    assert.deepEqual(await supNames(), ['Sample Vendor 041']); await search('');
  });

  await test('search: name, category, speciality, phone (with or without spaces), GSTIN and registered name', async () => {
    const g = await gstin('27SAMPL0001A1Z');
    await p.evaluate(async x => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest;
      Object.assign(d.vendors.find(v => v.id === 'v7'), { gstin: x, legalName: 'Sample Registered Traders LLP' }); await db.importAllData(d, 'replace'); }, g);
    await openVendors();
    await search('vendor 012'); assert.deepEqual(await supNames(), ['Sample Vendor 012']);
    await search('decoration'); { const n = await supNames(); assert.equal(n.length, 11); assert.ok(n.includes(LONG) && n.includes('Sample Vendor 043')); }
    await search('chaat'); assert.equal((await supNames()).length, 11);
    await search('90000 00012'); assert.deepEqual(await supNames(), ['Sample Vendor 012']);
    await search(g.slice(2, 9).toLowerCase()); assert.deepEqual(await supNames(), ['Sample Vendor 007'], 'part of the GSTIN, any case');
    await search('registered traders'); assert.deepEqual(await supNames(), ['Sample Vendor 007']);
    assert.match(await p.locator('#ven-list [data-id="v7"]').innerText(), /· GST/);
    await search('');
  });

  await test('sorting: highest payable, name A–Z, recently used; the choice is remembered', async () => {
    await openVendors();
    assert.deepEqual((await supNames()).slice(0, 3), ['Sample Vendor 019', 'Sample Vendor 018', 'Sample Vendor 017']);
    await p.selectOption('#ven-sort', 'name'); await p.waitForTimeout(100);
    assert.deepEqual((await supNames()).slice(0, 3), [LONG, 'Sample Vendor 001', 'Sample Vendor 002']);
    await p.selectOption('#ven-sort', 'recent'); await p.waitForTimeout(100);
    assert.deepEqual((await supNames()).slice(0, 3), ['Sample Vendor 040', 'Sample Vendor 020', 'Sample Vendor 021'], 'latest bill or payment first');
    await p.locator('[data-action="ven-more"]').click(); await p.waitForTimeout(100);
    assert.equal((await supNames()).at(-1), 'Sample Vendor 045', 'never used: last, by name');
    await openVendors(); assert.equal(await p.inputValue('#ven-sort'), 'recent');
    await p.selectOption('#ven-sort', 'pay');
  });

  await test('Show more: 30 at first, then the rest; a new search or filter starts again at 30', async () => {
    await openVendors();
    assert.equal((await supNames()).length, 30);
    assert.match(await p.locator('#ven-list .sec').first().innerText(), /30 of 45/);
    await p.locator('[data-action="ven-more"]').click(); await p.waitForTimeout(100);
    assert.equal((await supNames()).length, 45); assert.equal(await p.locator('[data-action="ven-more"]').count(), 0);
    await search('sample'); assert.equal((await supNames()).length, 30); await search('');
  });

  await test('a long business name wraps to two lines without widening the page; rows open with Enter', async () => {
    await openVendors(); await p.selectOption('#ven-sort', 'name');
    const row = p.locator('#ven-list [data-id="v3"]');
    const h = await row.locator('.ven-name').evaluate(e => ({ lines: Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)), clipped: e.scrollHeight > e.clientHeight }));
    assert.equal(h.lines, 2); assert.equal(await noOverflow(), true);
    await row.focus(); await p.keyboard.press('Enter'); await p.waitForSelector('#tab-vendetail.active');
    assert.match(await p.locator('#tab-vendetail .detail-name').innerText(), /Sample Shree Ganesh/);
    await openVendors(); await p.selectOption('#ven-sort', 'pay');
  });

  await test('GSTIN: optional; checked before saving; typed in any case with spaces; a person has none', async () => {
    const g = await gstin('27SAMPL0002B1Z');
    await openVendors(); await p.locator('#ven-list [data-id="v12"]').click(); await p.waitForSelector('#tab-vendetail.active');
    assert.equal(await p.locator('#ven-gst').count(), 0, 'no GST card without a GSTIN');
    await p.locator('#hdr-edit').click();
    await p.waitForSelector('#ven-modal.active');
    assert.equal(await p.locator('#ven-tax').isVisible(), true);
    await p.fill('#ven-gstin', '27SAMPL0002'); await p.locator('#btn-save-ven').click(); await p.waitForTimeout(200);
    assert.match(await p.locator('#ven-modal .field-error').innerText(), /GSTIN has 15 characters/);
    await p.fill('#ven-gstin', g.slice(0, 14) + (g[14] === 'A' ? 'B' : 'A')); await p.locator('#btn-save-ven').click(); await p.waitForTimeout(200);
    assert.match(await p.locator('#ven-modal .field-error').innerText(), /not valid/);
    assert.equal((await dump()).vendors.find(v => v.id === 'v12').gstin, undefined, 'nothing saved while invalid');
    await p.fill('#ven-gstin', ` ${g.slice(0, 2)} ${g.slice(2, 12).toLowerCase()} ${g.slice(12)} `); await p.fill('#ven-legal', 'Sample Registered Foods Pvt Ltd');
    await p.locator('#btn-save-ven').click(); await p.waitForTimeout(500);
    const v = (await dump()).vendors.find(x => x.id === 'v12');
    assert.deepEqual([v.gstin, v.legalName, v.id], [g, 'Sample Registered Foods Pvt Ltd', 'v12']);
  });

  await test('vendor page: GSTIN with Copy and a link to the official GST search (the GSTIN is never put in the link)', async () => {
    const v = (await dump()).vendors.find(x => x.id === 'v12');
    await openVendors(); await p.locator('#ven-list [data-id="v12"]').click(); await p.waitForSelector('#tab-vendetail.active');
    const card = await p.locator('#ven-gst').innerText();
    assert.match(card, new RegExp(`Registered name\\nSample Registered Foods Pvt Ltd\\nGSTIN\\n${v.gstin}`));
    const link = p.locator('#ven-gst a.gst-link');
    assert.equal(await link.getAttribute('href'), 'https://services.gst.gov.in/services/searchtp');
    assert.equal(await link.getAttribute('target'), '_blank'); assert.match(await link.getAttribute('rel'), /noopener/);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
    await p.locator('#ven-gst [data-action="copy-gstin"]').click(); await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => navigator.clipboard.readText()), v.gstin);
    assert.match(await p.locator('#toast-msg').innerText(), /Copied/);
    // the bill and payment stay linked to the same vendor
    assert.match(await p.locator('#tab-vendetail').innerText(), /You owe\n₹12,000/);
  });

  await test('removing the GSTIN removes the field; a person never shows or keeps GST fields', async () => {
    await p.locator('#hdr-edit').click(); await p.waitForSelector('#ven-modal.active');
    await p.fill('#ven-gstin', ''); await p.fill('#ven-legal', ''); await p.locator('#btn-save-ven').click(); await p.waitForTimeout(500);
    const v = (await dump()).vendors.find(x => x.id === 'v12');
    assert.equal('gstin' in v, false); assert.equal('legalName' in v, false);
    await openVendors(); await p.locator('#fab').click(); await p.waitForSelector('#ven-modal.active');
    await p.locator('#ven-kind [data-kind="person"]').click();
    assert.equal(await p.locator('#ven-tax').isHidden(), true);
    await p.locator('#ven-kind [data-kind="vendor"]').click(); assert.equal(await p.locator('#ven-tax').isVisible(), true);
    await p.locator('#ven-modal [data-action="close-modal"]').first().click();
  });

  await test('backups: GSTIN survives export and restore; old vendors without it still restore; a bad GSTIN or a person with one is refused', async () => {
    const g = await gstin('27SAMPL0003C1Z');
    const r = await p.evaluate(async x => { const db = await import('./db.js'); const out = [];
      const d0 = await db.exportAllData(); delete d0.manifest;
      d0.vendors.find(v => v.id === 'v5').gstin = x; d0.vendors.find(v => v.id === 'v5').legalName = 'Sample Legal Name';
      await db.importAllData(structuredClone(d0), 'replace');
      const back = (await db.exportAllData()).vendors.find(v => v.id === 'v5'); out.push(back.gstin === x && back.legalName === 'Sample Legal Name' ? 'kept' : 'lost');
      const old = structuredClone(d0); for (const v of old.vendors) { delete v.gstin; delete v.legalName; }
      try { await db.importAllData(old, 'replace'); out.push('old ok'); } catch (e) { out.push(e.message); }
      for (const bad of [v => { v.gstin = x.toLowerCase(); }, v => { v.gstin = x.slice(0, 14) + (x[14] === 'A' ? 'B' : 'A'); }, v => { v.gstin = 7; }, v => { v.legalName = 'x'.repeat(201); }]) {
        const d = structuredClone(d0); bad(d.vendors.find(v => v.id === 'v6'));
        try { await db.importAllData(d, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message); } }
      { const d = structuredClone(d0); d.vendors.find(v => v.id === 'p1').gstin = x; try { await db.importAllData(d, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message); } }
      await db.importAllData(d0, 'replace'); return out; }, g);
    assert.deepEqual(r, ['kept', 'old ok', ...Array(5).fill('Invalid vendor GSTIN')]);
  });

  await test('360px and 390px in English, Marathi and both: the tab and the vendor form fit, nothing cut off', async () => {
    for (const w of [360, 390]) for (const lang of ['en', 'mr', 'both']) {
      await p.setViewportSize({ width: w, height: 780 });
      await p.evaluate(l => localStorage.setItem('ffv2_lang', l), lang);
      await openVendors();
      assert.equal(await noOverflow(), true, `vendors ${w}px ${lang}`);
      const box = await p.locator('#ven-sort').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= w, `sort fits ${w}px ${lang}`);
      await p.locator('#fab').click(); await p.waitForSelector('#ven-modal.active');
      assert.equal(await noOverflow(), true, `form ${w}px ${lang}`);
      const sheet = await p.locator('#ven-modal .sheet').boundingBox(), gst = await p.locator('#ven-gstin').boundingBox();
      assert.ok(gst.x >= sheet.x && gst.x + gst.width <= sheet.x + sheet.width + 1, `GSTIN field fits ${w}px ${lang}`);
      await p.locator('#ven-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(250);
    }
    await p.evaluate(() => localStorage.setItem('ffv2_lang', 'en')); await p.setViewportSize({ width: 360, height: 780 });
  });

  await test('a large list (600 vendors) shows 30 rows quickly; totals still match the ledger', async () => {
    await load(dataset(600));
    await openVendors();
    const t = await p.evaluate(() => { const s = performance.now(); document.querySelector('#ven-filters [data-id="all"]').click(); return performance.now() - s; });
    assert.ok(t < 1500, `rendered in ${Math.round(t)} ms`);
    assert.equal(await p.locator('#ven-sup .row').count(), 30);
    assert.match(await p.locator('#ven-sum').innerText(), /Total payable\n₹1,90,000[\s\S]*Total vendors\n600/);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'vendors tab FAIL' : 'vendors tab PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('vendors tab FAIL'); process.exitCode = 1; });
