// Backup & Recovery (4.31.0): Backup to phone (encrypted .cdbk), Backup to Google Drive through Android's share menu
// (the owner picks Drive, the account and the folder; no Google sign-in, no Google code), Restore backup (any file the
// phone's picker offers, local or from a cloud app), Recovery key. Honest status: a share is "handed to the app you
// chose", never "saved"; a refused or cancelled share records nothing and never silently downloads instead. Replace
// asks for a confirmed copy of this phone's data first. The share menu is simulated (Android's own rules: .cdbk is not
// a type it shares, .txt is). Synthetic data only; no network.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const DATA = { version: 'ffv2', cPays: [{ id: 'p1', evId: 'e1', amt: 25000, date: '2026-11-01', mode: 'UPI' }], vPays: [],
  expenses: [{ id: 'x1', evId: 'e1', cat: 'Raw Material', head: 'Vegetables – भाजी', amt: 4200, date: '2026-11-02', pay: 'paid', mode: 'UPI', billIds: ['ph1'] }],
  vendors: [{ id: 'v1', name: 'Sample Secret Vendor', cat: 'Live Counter', phone: '9000000001' }],
  events: [{ id: 'e1', name: 'Sample Confidential Wedding', date: '2026-12-10', venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 300000, guests: 300, photoIds: [], meals: ['dinner'],
    mealPlan: { dinner: { guests: 300, rate: 650 } }, dishes: [{ name: 'Sample Paneer Tikka', head: '', meal: 'dinner' }] }],
  // A bill photo and a custom menu: restore must bring back money records, menus and photos alike
  photos: [{ id: 'ph1', expenseId: 'x1', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', createdAt: '2026-11-02T10:00:00.000Z' }],
  menus: [{ id: 'my1', name: 'Sample Custom Menu', meals: ['dinner'], slabs: [{ min: 100, rate: 500 }], items: ['Sample Dal'] }] };

// Android's share menu, as Chrome on Android behaves: canShare/share accept only known file types (.txt yes, .cdbk no)
const SHARE_SIM = () => {
  const ok = files => files.every(f => /\.(txt|text|pdf|png|jpe?g|csv)$/i.test(f.name));
  window.__shared = []; window.__shareMode = 'accept';
  navigator.canShare = d => !!d?.files?.length && ok(d.files);
  navigator.share = async d => {
    if (!navigator.userActivation?.isActive) throw new DOMException('Must be handling a user gesture to perform a share request.', 'NotAllowedError');
    if (!ok(d.files)) throw new DOMException('Permission denied', 'NotAllowedError');
    if (window.__shareMode === 'cancel') throw new DOMException('Share canceled', 'AbortError');
    if (window.__shareMode === 'refuse') throw new DOMException('Permission denied', 'NotAllowedError');
    const f = d.files[0]; window.__shared.push({ name: f.name, type: f.type, b64: btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer()))) });
  };
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const phone = async ({ share = true } = {}) => {
    const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 }, acceptDownloads: true });
    if (share) await ctx.addInitScript(SHARE_SIM);
    else await ctx.addInitScript(() => { navigator.canShare = undefined; navigator.share = undefined; });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (!r.url().startsWith(BASE_URL)) external.push(r.url()); });
    await page.goto(BASE_URL); await page.waitForSelector('#kpi .card');
    return { ctx, page };
  };
  const errors = [], external = [];
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const drawer = async page => { if (!await page.locator('#drawer.active').count()) await page.locator('#drawer-toggle').click(); await page.waitForSelector('#drawer.active'); };
  const toast = page => page.waitForSelector('#toast.show').then(() => page.locator('#toast-msg').innerText());
  const snapshot = page => page.evaluate(async () => { const d = await (await import('./db.js')).exportAllData(); delete d.manifest; delete d.exportedAt; delete d.appVersion;
    for (const s of Object.keys(d)) if (Array.isArray(d[s])) d[s] = d[s].map(({ _rev, ...r }) => r).sort((a, b) => String(a.id).localeCompare(String(b.id))); return JSON.stringify(d); });
  const lastExport = page => page.evaluate(async () => { const db = await import('./db.js'); return [await db.getMeta('last_export'), await db.getMeta('last_export_how')]; });

  const { ctx, page: p } = await phone();
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  await p.reload(); await p.waitForSelector('#kpi .card');
  let keyText;

  await test('Settings has one Backup & Recovery group: phone, Google Drive, restore, recovery key (plus the readable backup); no Google sign-in shown', async () => {
    await drawer(p);
    const items = await p.locator('#drawer .d-group:has(#btn-export-enc) .d-item:visible').allInnerTexts();
    assert.deepEqual(items.map(t => t.split(/ – |\n/)[0]), ['Backup to phone', 'Backup to Google Drive', 'Restore backup', 'Recovery key', 'Readable backup (not encrypted)']);
    assert.equal(await p.locator('#btn-drive').isHidden(), true, 'the Drive API client stays switched off');
  });

  await test('without a recovery key, both backups open key setup first; nothing is saved or shared', async () => {
    for (const id of ['#btn-export-enc', '#btn-export-drive']) {
      await drawer(p); await p.locator(id).click(); await p.waitForSelector('#rk-modal.active');
      await p.locator('#rk-modal [data-action="close-modal"]').click(); await p.waitForSelector('#rk-modal.active', { state: 'detached' }).catch(() => {});
      await p.waitForFunction(() => !document.querySelector('#rk-modal.active'));
    }
    assert.deepEqual(await p.evaluate(() => window.__shared), []);
    assert.deepEqual(await lastExport(p), [null, null]);
    // Set the key up for the rest
    await drawer(p); await p.locator('#btn-enc-setup').click(); await p.waitForSelector('#rk-modal.active');
    keyText = await p.locator('#rk-key').innerText();
    await p.locator('#rk-written').check(); await p.locator('#btn-rk-next').click();
    await p.fill('#rk-typed', keyText); await p.locator('#btn-rk-verify').click();
    await p.waitForSelector('#toast-msg:has-text("Encrypted backup is set up")');
    await drawer(p); assert.match(await p.locator('#enc-meta').innerText(), /recovery key set/);
  });

  let phoneFile;
  await test('Backup to phone downloads the encrypted .cdbk file and says only that the download started', async () => {
    await drawer(p);
    const dl = p.waitForEvent('download'); await p.locator('#btn-export-enc').click();
    const d = await dl; assert.match(d.suggestedFilename(), /^caterdesk-backup-\d{4}-\d\d-\d\d-\d{4}\.cdbk$/);
    phoneFile = path.join('test-artifacts', 'br-' + d.suggestedFilename()); await d.saveAs(phoneFile);
    const bytes = fs.readFileSync(phoneFile);
    assert.equal(bytes.subarray(0, 4).toString(), 'CDBK');
    for (const s of ['Sample Confidential Wedding', 'Sample Secret Vendor']) assert.ok(!bytes.toString('latin1').includes(s));
    assert.match(await toast(p), /^Encrypted backup download started .*Check it is in this phone's Downloads/);
    assert.equal((await lastExport(p))[1], 'download');
    assert.deepEqual(await p.evaluate(() => window.__shared), [], 'not shared');
  });

  let driveFile;
  await test('Backup to Google Drive hands the encrypted file to the share menu as .cdbk.txt (a type Android shares) and never claims it was saved', async () => {
    await drawer(p); await p.locator('#btn-export-drive').click();
    await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-msg').innerText(), /choose Drive, then pick your Google account and folder[\s\S]*\.txt file\. It is encrypted/);
    await p.locator('#ask-actions button', { hasText: 'Share to Google Drive' }).click();
    assert.match(await toast(p), /^Encrypted backup handed to the app you chose .*cannot see whether it was saved: check it is in your Drive/);
    const shared = await p.evaluate(() => window.__shared);
    assert.equal(shared.length, 1);
    assert.match(shared[0].name, /^caterdesk-backup-\d{4}-\d\d-\d\d-\d{4}\.cdbk\.txt$/); assert.equal(shared[0].type, 'text/plain');
    const bytes = Buffer.from(shared[0].b64, 'base64');
    assert.equal(bytes.subarray(0, 4).toString(), 'CDBK', 'the same encrypted format, only named .txt');
    for (const s of ['Sample Confidential Wedding', 'Sample Secret Vendor', 'Sample Paneer Tikka']) assert.ok(!bytes.toString('latin1').includes(s));
    driveFile = path.join('test-artifacts', 'br-' + shared[0].name); fs.writeFileSync(driveFile, bytes);
    assert.equal((await lastExport(p))[1], 'shared');
  });

  await test('a cancelled or refused share records nothing and does not download instead', async () => {
    const before = await lastExport(p);
    let downloads = 0; const onDl = () => downloads++; p.on('download', onDl);
    // Cancel at CaterDesk's sheet
    await drawer(p); await p.locator('#btn-export-drive').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Cancel' }).click(); await p.waitForTimeout(300);
    // Cancel in Android's share menu
    await p.evaluate(() => { window.__shareMode = 'cancel'; });
    await drawer(p); await p.locator('#btn-export-drive').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Share to Google Drive' }).click(); await p.waitForTimeout(500);
    // The phone refuses the share
    await p.evaluate(() => { window.__shareMode = 'refuse'; });
    await drawer(p); await p.locator('#btn-export-drive').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Share to Google Drive' }).click();
    assert.match(await toast(p), /did not open the share menu \(NotAllowedError: Permission denied\)\. Nothing was saved\. Use "Backup to phone"/);
    await p.evaluate(() => { window.__shareMode = 'accept'; });
    p.off('download', onDl);
    assert.equal(downloads, 0, 'no silent download in place of the share');
    assert.deepEqual(await lastExport(p), before, 'nothing recorded');
    assert.equal(await p.evaluate(() => window.__shared.length), 1);
  });

  await test('a device that cannot share says so before building anything, and points to Backup to phone', async () => {
    const { ctx: c2, page: p2 } = await phone({ share: false });
    await drawer(p2); await p2.locator('#btn-export-drive').click();
    assert.match(await toast(p2), /cannot hand files to Google Drive from CaterDesk\. Use "Backup to phone"/);
    assert.equal(await p2.locator('#rk-modal.active').count(), 0);
    await c2.close();
  });

  await test('Restore backup opens both copies (.cdbk from the phone, .cdbk.txt from Drive) on a new phone with the recovery key', async () => {
    const before = await snapshot(p);
    for (const file of [phoneFile, driveFile]) {
      const { ctx: c3, page: p3 } = await phone();
      await drawer(p3);
      const chooser = p3.waitForEvent('filechooser'); await p3.locator('#btn-import').click();
      await (await chooser).setFiles(file);
      await p3.waitForSelector('#rki-modal.active');
      await p3.fill('#rki-typed', keyText); await p3.locator('#btn-rki-ok').click();
      await p3.waitForSelector('#ask-modal.active #ask-actions button:has-text("Replace all data")');
      assert.match(await p3.locator('#ask-msg').innerText(), /Checked: complete and undamaged/);
      await p3.locator('#ask-actions button', { hasText: 'Replace all data' }).click();   // empty phone: no copy needed
      await p3.waitForSelector('#toast-msg:has-text("Imported")');
      assert.equal(await snapshot(p3), before, path.basename(file));
      const back = JSON.parse(await snapshot(p3));
      assert.deepEqual([back.events.length, back.expenses[0].amt, back.cPays[0].amt, back.photos.length, back.menus.map(m => m.name)], [1, 4200, 25000, 1, ['Sample Custom Menu']], 'records, amounts, the bill photo and the custom menu');
      await c3.close();
    }
    const accept = await p.locator('#import-input').getAttribute('accept');
    assert.match(accept, /\.cdbk/); assert.match(accept, /text\/plain/); assert.match(accept, /application\/octet-stream/);
  });

  await test('Restore backup with Replace on a phone with data asks for a confirmed copy first; not confirming changes nothing', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); await db.putOne('vendors', { id: 'v9', name: 'Sample Later Vendor', cat: 'Live Counter', phone: '9000000009' }); });
    await p.reload(); await p.waitForSelector('#kpi .card');
    const before = await snapshot(p);
    const restore = async () => { await p.locator('#import-input').setInputFiles(driveFile);   // this phone's key made it: no prompt
      await p.waitForSelector('#ask-modal.active #ask-actions button:has-text("Replace all data")');
      await p.locator('#ask-actions button', { hasText: 'Replace all data' }).click();
      await p.waitForSelector('#ask-modal.active'); return p.locator('#ask-title').innerText(); };
    assert.match(await restore(), /First, save a copy/);
    await p.locator('#ask-actions button', { hasText: 'Cancel' }).click();
    await p.waitForSelector('#toast-msg:has-text("Not replaced")');
    assert.equal(await snapshot(p), before);
    assert.match(await restore(), /First, save a copy/);
    const dl = p.waitForEvent('download'); await p.locator('#ask-actions button', { hasText: 'Save a copy' }).click();
    const d = await dl; assert.match(d.suggestedFilename(), /^caterdesk-before-restore-.*\.cdbk$/, 'with a recovery key the copy is encrypted (tests/encrypted-safety-copy.cjs restores it)');
    assert.equal(fs.readFileSync(await d.path()).subarray(0, 4).toString(), 'CDBK');
    await p.waitForSelector('#ask-modal.active #ask-title:has-text("Is the copy saved")');
    await p.locator('#ask-actions button', { hasText: 'The copy is saved' }).click();
    await p.waitForSelector('#toast-msg:has-text("Imported")');
    assert.equal(await p.evaluate(async () => (await (await import('./db.js')).getAll('vendors')).some(v => v.name === 'Sample Later Vendor')), false);
  });

  await test('no Google code, sign-in or network request anywhere in these flows', async () => {
    assert.deepEqual(external.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)), []);
    assert.deepEqual(errors, []);
  });

  await ctx.close(); await browser.close();
  console.log(failed ? 'backup & recovery FAIL' : 'backup & recovery PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('backup & recovery FAIL'); process.exitCode = 1; });
