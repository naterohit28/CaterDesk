// Encrypted pre-restore safety copy (4.31.15): before Replace removes this phone's data, the copy it asks for is
// encrypted with the recovery key (.cdbk, key never inside) when one is set up. Without a key it is a readable copy
// with a warning; with a key, a readable copy is a warned emergency option. Cancelled, failed and interrupted
// restores change nothing, and the encrypted copy really brings the data back (on this phone, and on another phone
// only with the right key). Synthetic data only; no network.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const BACKUP = { version: 'ffv2', cPays: [], vPays: [], expenses: [], photos: [],
  vendors: [{ id: 'v1', name: 'Sample Backup Vendor', cat: 'Live Counter', phone: '9000000001' }],
  events: [{ id: 'e1', name: 'Sample Backup Wedding', date: '2026-12-10', venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 300000, guests: 300, photoIds: [], meals: ['dinner'], mealPlan: { dinner: { guests: 300, rate: 650 } }, dishes: [] }] };
const PHONE = { version: 'ffv2', cPays: [{ id: 'p9', evId: 'e9', amt: 41000, date: '2026-11-01', mode: 'UPI' }], vPays: [], photos: [],
  expenses: [{ id: 'x9', evId: 'e9', cat: 'Raw Material', head: 'Vegetables – भाजी', amt: 7300, date: '2026-11-02', pay: 'paid', mode: 'UPI', billIds: [] }],
  vendors: [{ id: 'v9', name: 'Sample Private Vendor', cat: 'Live Counter', phone: '9000000009' }],
  events: [{ id: 'e9', name: 'Sample Private Reception', date: '2026-12-20', venue: 'Sample Lawns', type: 'Reception – स्वागत', billing: 180000, guests: 200, photoIds: [], meals: ['dinner'], mealPlan: { dinner: { guests: 200, rate: 900 } }, dishes: [] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [], external = [];
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const phone = async () => {
    const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (!r.url().startsWith(BASE_URL)) external.push(r.url()); });
    await page.goto(BASE_URL); await page.waitForSelector('#kpi .card');
    return { ctx, page };
  };
  const drawer = async p => { if (!await p.locator('#drawer.active').count()) await p.locator('#drawer-toggle').click(); await p.waitForSelector('#drawer.active'); };
  const load = async (p, d) => { await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d, 'replace'); }, d); await p.reload(); await p.waitForSelector('#kpi .card'); };
  const snapshot = p => p.evaluate(async () => { const d = await (await import('./db.js')).exportAllData(); delete d.manifest; delete d.exportedAt; delete d.appVersion;
    for (const s of Object.keys(d)) if (Array.isArray(d[s])) d[s] = d[s].map(({ _rev, ...r }) => r).sort((a, b) => String(a.id).localeCompare(String(b.id))); return JSON.stringify(d); });
  const title = p => p.waitForSelector('#ask-modal.active').then(() => p.locator('#ask-title').innerText());
  const btn = (p, re) => p.locator('#ask-modal.active #ask-actions button').filter({ hasText: re });
  const setKey = async p => {
    await drawer(p); await p.locator('#btn-enc-setup').click(); await p.waitForSelector('#rk-modal.active');
    const keyText = await p.locator('#rk-key').innerText();
    await p.locator('#rk-written').check(); await p.locator('#btn-rk-next').click();
    await p.fill('#rk-typed', keyText); await p.locator('#btn-rk-verify').click();
    await p.waitForSelector('#toast-msg:has-text("Encrypted backup is set up")');
    return keyText;
  };
  const file = (name, data) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  // Choose a backup and tap Replace; resolves at the next sheet's title
  const replaceWith = async (p, f) => {
    await p.locator('#import-input').setInputFiles(f);
    await p.waitForSelector('#ask-modal.active #ask-actions button:has-text("Replace all data")');
    await btn(p, /^Replace all data/).click();
    return title(p);
  };
  const notReplaced = async (p, before) => { await p.waitForSelector('#toast-msg:has-text("Not replaced")'); assert.equal(await snapshot(p), before, 'this phone\'s data is unchanged'); };

  await test('no recovery key: the copy is a readable file, with the warning and a pointer to the recovery key', async () => {
    const { ctx, page: p } = await phone();
    await load(p, PHONE);
    const before = await snapshot(p);
    assert.match(await replaceWith(p, file('b.json', BACKUP)), /First, save a copy/);
    const msg = await p.locator('#ask-msg').innerText();
    assert.match(msg, /not encrypted: anyone who opens it can read your business records/);
    assert.match(msg, /set up the recovery key in Backup & Recovery first/);
    assert.equal(await btn(p, /Readable copy instead/).count(), 0, 'no second choice: readable is the only copy without a key');
    const dl = p.waitForEvent('download'); await btn(p, /^Save a copy to this phone/).click();
    const d = await dl; assert.match(d.suggestedFilename(), /^caterdesk-before-restore-.*\.json$/);
    assert.ok(JSON.parse(fs.readFileSync(await d.path(), 'utf8')).vendors.some(v => v.name === 'Sample Private Vendor'));
    assert.match(await title(p), /Is the copy saved/);
    await btn(p, /^Cancel/).click();
    await notReplaced(p, before);
    await ctx.close();
  });

  const { ctx, page: p } = await phone();
  await load(p, PHONE);
  const keyText = await setKey(p);
  const before = await snapshot(p);
  let copyPath;

  await test('with a recovery key: cancelling at the first sheet changes nothing and saves nothing', async () => {
    let downloads = 0; const count = () => downloads++; p.on('download', count);
    assert.match(await replaceWith(p, file('b.json', BACKUP)), /First, save a copy/);
    assert.match(await p.locator('#ask-msg').innerText(), /encrypted with your recovery key \([0-9A-F]{4}…\): it opens only in CaterDesk, with that key/);
    await btn(p, /^Cancel/).click();
    await notReplaced(p, before);
    p.off('download', count); assert.equal(downloads, 0);
  });

  await test('with a recovery key: the copy is an encrypted .cdbk (no readable records, no key inside); not confirming it changes nothing', async () => {
    await replaceWith(p, file('b.json', BACKUP));
    const dl = p.waitForEvent('download'); await btn(p, /^Save a copy to this phone/).click();
    const d = await dl; assert.match(d.suggestedFilename(), /^caterdesk-before-restore-\d{4}-\d\d-\d\d-\d{4}\.cdbk$/);
    copyPath = path.join('test-artifacts', 'esc-' + d.suggestedFilename()); await d.saveAs(copyPath);
    const bytes = fs.readFileSync(copyPath), text = bytes.toString('latin1');
    assert.equal(bytes.subarray(0, 4).toString(), 'CDBK');
    for (const s of ['Sample Private Reception', 'Sample Private Vendor', '41000', '7300']) assert.ok(!text.includes(s), `"${s}" is not readable in the copy`);
    for (const g of keyText.split(/[\s-]+/).filter(g => g.length >= 4)) assert.ok(!text.includes(g), 'the recovery key is not in the copy');
    assert.match(await title(p), /Is the copy saved/);
    assert.match(await p.locator('#ask-msg').innerText(), /opens with your recovery key/);
    await btn(p, /^Cancel/).click();
    await notReplaced(p, before);
  });

  await test('interrupted: the app is closed while asking whether the copy is saved, and nothing is replaced', async () => {
    await replaceWith(p, file('b.json', BACKUP));
    const dl = p.waitForEvent('download'); await btn(p, /^Save a copy to this phone/).click(); await dl;
    assert.match(await title(p), /Is the copy saved/);
    await p.reload(); await p.waitForSelector('#kpi .card');
    assert.equal(await snapshot(p), before);
  });

  await test('the encrypted copy cannot be made: nothing is downloaded and nothing is replaced', async () => {
    await p.evaluate(() => { window.__realEncrypt = crypto.subtle.encrypt; Object.defineProperty(crypto.subtle, 'encrypt', { configurable: true, writable: true, value: () => Promise.reject(new Error('Simulated failure')) }); });
    let downloads = 0; const count = () => downloads++; p.on('download', count);
    await replaceWith(p, file('b.json', BACKUP));
    await btn(p, /^Save a copy to this phone/).click();
    await p.waitForSelector('#toast-msg:has-text("The encrypted copy could not be made")');
    assert.match(await p.locator('#toast-msg').innerText(), /Nothing was replaced/);
    assert.equal(await snapshot(p), before);
    p.off('download', count); assert.equal(downloads, 0);
    await p.evaluate(() => { delete crypto.subtle.encrypt; });
  });

  await test('the readable copy is a warned emergency option: backing out of the warning changes nothing; accepting it saves a .json', async () => {
    await replaceWith(p, file('b.json', BACKUP));
    await btn(p, /^Readable copy instead/).click();
    assert.match(await title(p), /Save a readable copy\?/);
    assert.match(await p.locator('#ask-msg').innerText(), /not encrypted: anyone who opens it can read your business records[\s\S]*Use it only if/);
    await btn(p, /^Cancel/).click();
    await notReplaced(p, before);
    await replaceWith(p, file('b.json', BACKUP));
    await btn(p, /^Readable copy instead/).click(); await title(p);
    const dl = p.waitForEvent('download'); await btn(p, /^Save a readable copy/).click();
    const d = await dl; assert.match(d.suggestedFilename(), /^caterdesk-before-restore-.*\.json$/);
    assert.ok(JSON.parse(fs.readFileSync(await d.path(), 'utf8')).events.some(e => e.name === 'Sample Private Reception'));
    await title(p); await btn(p, /^Cancel/).click();
    await notReplaced(p, before);
  });

  await test('rollback: after Replace, restoring the encrypted copy brings this phone back exactly as it was', async () => {
    assert.match(await replaceWith(p, file('b.json', BACKUP)), /First, save a copy/);
    const dl = p.waitForEvent('download'); await btn(p, /^Save a copy to this phone/).click();
    const d = await dl; copyPath = path.join('test-artifacts', 'esc-rollback-' + d.suggestedFilename()); await d.saveAs(copyPath);
    await title(p); await btn(p, /^The copy is saved/).click();
    await p.waitForSelector('#toast-msg:has-text("Imported")');
    const replaced = JSON.parse(await snapshot(p));
    assert.deepEqual(replaced.events.map(e => e.name), ['Sample Backup Wedding'], 'Replace happened');
    // Bring it back: this phone's own key made the copy, so no key is asked for. Replace asks for a copy again (of the backup's data).
    assert.match(await replaceWith(p, copyPath), /First, save a copy/);
    const dl2 = p.waitForEvent('download'); await btn(p, /^Save a copy to this phone/).click(); await dl2;
    await title(p); await btn(p, /^The copy is saved/).click();
    await p.waitForSelector('#toast-msg:has-text("Imported")');
    assert.equal(await snapshot(p), before, 'every record is back, amounts included');
  });

  await test('on another phone the encrypted copy opens only with the recovery key: a wrong key is refused, the right key restores it', async () => {
    const { ctx: c2, page: p2 } = await phone();
    await p2.locator('#import-input').setInputFiles(copyPath);
    await p2.waitForSelector('#rki-modal.active');
    const wrong = keyText.replace(/[0-9A-Z](?=[^0-9A-Z]*$)/, ch => ch === 'A' ? 'B' : 'A');
    await p2.fill('#rki-typed', wrong); await p2.locator('#btn-rki-ok').click();
    await p2.waitForFunction(() => document.querySelector('#rki-result').textContent.trim().length > 0);
    assert.equal(await p2.locator('#rki-modal.active').count(), 1, 'still asking: the wrong key opened nothing');
    await p2.fill('#rki-typed', keyText); await p2.locator('#btn-rki-ok').click();
    await p2.waitForSelector('#ask-modal.active #ask-actions button:has-text("Replace all data")');
    await btn(p2, /^Replace all data/).click();   // an empty phone: nothing to copy first
    await p2.waitForSelector('#toast-msg:has-text("Imported")');
    assert.equal(await snapshot(p2), before);
    await c2.close();
  });

  await test('no errors and no network request outside this app', async () => {
    assert.deepEqual(external.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)), []);
    assert.deepEqual(errors, []);
  });

  await ctx.close(); await browser.close();
  console.log(failed ? 'encrypted safety copy FAIL' : 'encrypted safety copy PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('encrypted safety copy FAIL'); process.exitCode = 1; });
