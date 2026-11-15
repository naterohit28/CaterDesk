// Encrypted backup file (D1 of the Drive backup design): recovery key shown once and typed back in full before use;
// the key stays on this phone (usable, not readable) and never in a backup; .cdbk files carry no readable business
// data; a large backup with 300 bill photos (~120 MB) round-trips onto a new device with the typed key; wrong key,
// changed files and a cancelled key prompt change nothing. No network, no Google. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const DATA = { version: 'ffv2', cPays: [{ id: 'p1', evId: 'e1', amt: 25000, date: '2026-11-01', mode: 'UPI' }], vPays: [], expenses: [{ id: 'x1', evId: 'e1', cat: 'Raw Material', head: 'Vegetables – भाजी', amt: 4200, date: '2026-11-02', pay: 'paid', mode: 'UPI', billIds: [] }],
  vendors: [{ id: 'v1', name: 'Sample Secret Vendor', cat: 'Live Counter', phone: '9000000001' }],
  events: [{ id: 'e1', name: 'Sample Confidential Wedding', date: '2026-12-10', venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 300000, guests: 300, photoIds: [], meals: ['dinner'],
    mealPlan: { dinner: { guests: 300, rate: 650 } }, dishes: [{ name: 'Sample Paneer Tikka', head: '', meal: 'dinner' }],
    quotes: [{ v: 1, status: 'draft', lines: [{ kind: 'meal', meal: 'dinner', guests: 300, rate: 650 }], showRates: true, terms: '' }],
    // Documents and orders the owner needs back on a new phone: approved menu, menu sent to the client, a vendor counter order, a purchase order
    menuApproved: [{ id: 'ma1', n: 1, at: '2026-11-03T10:00:00.000Z', by: 'written', who: 'Sample Client', services: [{ id: 'svc-dinner', meal: 'dinner', guests: 300, rate: 650, dishes: [{ name: 'Sample Paneer Tikka', head: '' }] }], shared: [] }],
    menuDocs: [{ id: 'md1', at: '2026-11-03T11:00:00.000Z', date: '2026-11-03', v: '1', layout: 1, text: 'Sample menu text', event: { name: 'Sample Confidential Wedding', date: '2026-12-10' },
      menu: { v: '1', label: 'Approved menu 1', meals: [{ title: 'Dinner', when: '', guests: 300, dishes: [{ name: 'Sample Paneer Tikka' }] }], shared: [] } }],
    orders: [{ id: 'o1', head: 'Chaat – चाट', venId: 'v1', plates: 300, date: '2026-12-10', time: '19:00', status: 'confirmed', at: '2026-11-04T10:00:00.000Z' }],
    purchases: [{ id: 'PO1', item: 'Sample Mineral Water', src: 'buy', venId: 'v1', qty: 20, unit: 'carton', date: '2026-12-10', status: 'delivered', at: '2026-11-05T10:00:00.000Z',
      basis: { item: 'Sample Mineral Water', src: 'buy' }, messages: [{ v: 1, text: 'Sample purchase order', status: 'sent', at: '2026-11-05T10:00:00.000Z' }] }] }], photos: [] };
DATA.events[0].dishes.push({ name: 'Sample Mineral Water', head: '', src: 'buy' });
DATA.expenses.push({ id: 'x2', evId: 'e1', cat: 'Raw Material', head: 'Water – पाणी', amt: 1800, date: '2026-11-06', pay: 'paid', mode: 'UPI', venId: 'v1', billIds: [], purchase: 'PO1' });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const p = await ctx.newPage(); p.setDefaultTimeout(15000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const drawer = async page => { if (!await page.locator('#drawer.active').count()) await page.locator('#drawer-toggle').click(); await page.waitForSelector('#drawer.active'); };
  const snapshot = page => page.evaluate(async () => { const d = await (await import('./db.js')).exportAllData(); delete d.manifest; delete d.exportedAt; delete d.appVersion;
    for (const s of Object.keys(d)) if (Array.isArray(d[s])) d[s] = d[s].map(({ _rev, ...r }) => r).sort((a, b) => String(a.id).localeCompare(String(b.id))); return JSON.stringify(d); });
  const saveEncrypted = async page => { await drawer(page); const dl = page.waitForEvent('download', { timeout: 180000 });
    await page.locator('#btn-export-enc').click();
    // Phones that can share are asked Share or Save to phone (as for plain backups); choose Save to phone
    const save = page.locator('#ask-modal.active #ask-actions button', { hasText: 'Save to phone' });
    await save.waitFor({ timeout: 180000 }); await save.click();
    const d = await dl; const file = path.join('test-artifacts', `enc-${Date.now()}.cdbk`); await d.saveAs(file); return file; };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  await p.reload(); await p.waitForSelector('#kpi .card');
  let keyText;

  await test('setup: the key is shown once and must be typed back in full; a wrong or partial key never completes setup', async () => {
    await drawer(p); assert.match(await p.locator('#enc-meta').innerText(), /not set up/);
    await p.locator('#btn-enc-setup').click(); await p.waitForSelector('#rk-modal.active');
    keyText = await p.locator('#rk-key').innerText();
    assert.match(keyText, /^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/, '14 groups of 4');
    assert.equal(await p.locator('#btn-rk-next').isDisabled(), true, 'only after confirming it is written down');
    await p.locator('#rk-written').check(); await p.locator('#btn-rk-next').click();
    assert.equal(await p.locator('#rk-key').innerText(), '', 'not left on screen while typing it back');
    const groups = keyText.split('-');
    const wrong = [...groups]; wrong[2] = wrong[2].slice(0, 3) + (wrong[2][3] === '0' ? '1' : '0');
    await p.fill('#rk-typed', wrong.join('-')); await p.locator('#btn-rk-verify').click();
    assert.match(await p.locator('#rk-result').innerText(), /^Group 3 does not match/);
    await p.fill('#rk-typed', groups.slice(0, 13).join('-')); await p.locator('#btn-rk-verify').click();
    assert.match(await p.locator('#rk-result').innerText(), /Group 14 does not match/, 'a partial key never completes setup');
    assert.equal(await p.evaluate(async () => (await import('./db.js')).getMeta('backup_key_id')), null, 'nothing stored yet');
    await p.fill('#rk-typed', keyText.toLowerCase().replace(/-/g, ' ')); await p.locator('#btn-rk-verify').click(); await p.waitForTimeout(500);
    assert.match(await p.locator('#toast-msg').innerText(), /Encrypted backup is set up/);
    await drawer(p); assert.match(await p.locator('#enc-meta').innerText(), /recovery key set/);
  });

  await test('the key stays on this phone, usable but not readable, and is never in a backup', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const k = await db.getMeta('backup_key');
      let exported = 'refused'; try { await crypto.subtle.exportKey('raw', k); exported = 'exported'; } catch {}
      return { type: k?.constructor?.name, extractable: k.extractable, exported, inBackup: JSON.stringify(await db.exportAllData()).includes('backup_key') }; });
    assert.deepEqual(r, { type: 'CryptoKey', extractable: false, exported: 'refused', inBackup: false });
  });

  let small;
  await test('a saved encrypted backup has no readable business data and opens to exactly the same records', async () => {
    small = await saveEncrypted(p);
    const bytes = fs.readFileSync(small);
    assert.equal(bytes.subarray(0, 4).toString(), 'CDBK');
    for (const secret of ['Sample Confidential Wedding', 'Sample Secret Vendor', 'Sample Paneer Tikka', '9000000001', '300000']) assert.equal(bytes.includes(Buffer.from(secret)), false, secret);
    const same = await p.evaluate(async b64 => { const c = await import('./backup-crypto.js'), db = await import('./db.js');
      const bytes = Uint8Array.from(atob(b64), x => x.charCodeAt(0)); const json = await c.decryptBackup(await db.getMeta('backup_key'), await db.getMeta('backup_key_id'), bytes);
      const a = JSON.parse(json), now = await db.exportAllData(); return a.events.length === now.events.length && a.events[0].name === now.events[0].name && a.manifest.counts.events === 1; }, bytes.toString('base64'));
    assert.equal(same, true);
  });

  await test('large backup: 300 bill photos (~120 MB) encrypt, and restore on a new device with the typed recovery key', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest;
      const rnd = new Uint8Array(300000); for (let k = 0; k < rnd.length; k += 65536) crypto.getRandomValues(rnd.subarray(k, Math.min(rnd.length, k + 65536)));
      let s = ''; for (let k = 0; k < rnd.length; k += 8192) s += String.fromCharCode(...rnd.subarray(k, k + 8192));
      const base = btoa(s);
      d.photos = Array.from({ length: 300 }, (_, i) => ({ id: `ph${i}`, expenseId: 'x1', data: 'data:image/jpeg;base64,' + base.slice(i % 64) + base.slice(0, i % 64), createdAt: '2026-11-02T10:00:00.000Z' }));
      await db.importAllData(d, 'replace'); });
    await p.reload(); await p.waitForSelector('#kpi .card');
    const before = await snapshot(p);
    assert.ok(before.length > 115e6, `about 120 MB of data (${(before.length / 1e6).toFixed(0)} MB)`);
    const t0 = Date.now(); const big = await saveEncrypted(p); const secs = (Date.now() - t0) / 1000;
    const size = fs.statSync(big).size; assert.ok(size > 85e6, `encrypted file ${(size / 1e6).toFixed(0)} MB`);
    console.log(`  large backup: ${(before.length / 1e6).toFixed(0)} MB of data → ${(size / 1e6).toFixed(0)} MB encrypted file in ${secs.toFixed(1)} s`);
    // A new device: separate browser profile, no key stored, no data
    const ctx2 = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
    const p2 = await ctx2.newPage(); p2.setDefaultTimeout(180000); p2.on('pageerror', e => errors.push(e.message));
    await p2.goto(BASE_URL); await p2.waitForSelector('#kpi .card');
    await p2.locator('#import-input').setInputFiles(big); await p2.waitForSelector('#rki-modal.active');
    await p2.fill('#rki-typed', keyText); await p2.locator('#btn-rki-ok').click();
    await p2.waitForSelector('#ask-modal.active'); assert.match(await p2.locator('#ask-msg').innerText(), /300 photos[\s\S]*Checked: complete and undamaged/);
    await p2.locator('#ask-actions button', { hasText: 'Replace all data' }).click(); await p2.waitForSelector('#toast-msg:has-text("Imported")', { timeout: 180000 });
    assert.equal(await snapshot(p2), before, 'every record and photo identical on the new device');
    await ctx2.close();
  });

  await test('wrong key, a changed file and a cancelled key prompt each leave the data unchanged', async () => {
    const ctx3 = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
    const p3 = await ctx3.newPage(); p3.setDefaultTimeout(30000); p3.on('pageerror', e => errors.push(e.message));
    await p3.goto(BASE_URL); await p3.waitForSelector('#kpi .card');
    await p3.evaluate(async () => { const db = await import('./db.js'); await db.importAllData({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [], vendors: [], events: [{ id: 'k1', name: 'Sample Keep Me', date: '2026-12-01', venue: 'Sample Hall', type: 'Party – पार्टी', billing: 1000, guests: 10, photoIds: [] }] }); });
    await p3.reload(); await p3.waitForSelector('#kpi .card');
    const keep = await snapshot(p3);
    // wrong key (a valid key, but not the one used)
    const other = await p3.evaluate(async () => (await (await import('./backup-crypto.js')).newRecoveryKey()).text);
    await p3.locator('#import-input').setInputFiles(small); await p3.waitForSelector('#rki-modal.active');
    await p3.fill('#rki-typed', other); await p3.locator('#btn-rki-ok').click(); await p3.waitForTimeout(300);
    assert.match(await p3.locator('#rki-result').innerText(), /made with a different recovery key/);
    await p3.locator('#rki-modal [data-action="close-modal"]').click(); await p3.waitForTimeout(400);
    assert.equal(await snapshot(p3), keep, 'cancelled: nothing changed');
    // a changed byte deep in the file
    const bad = path.join('test-artifacts', 'enc-tampered.cdbk'), b = fs.readFileSync(small); b[b.length - 40] ^= 1; fs.writeFileSync(bad, b);
    await p3.locator('#import-input').setInputFiles(bad); await p3.waitForSelector('#rki-modal.active');
    await p3.fill('#rki-typed', keyText); await p3.locator('#btn-rki-ok').click(); await p3.waitForTimeout(800);
    assert.match(await p3.locator('#toast-msg').innerText(), /damaged[\s\S]*Nothing was changed/);
    assert.equal(await snapshot(p3), keep);
    await ctx3.close();
  });

  await test('a multi-piece file: a changed header or tag, a dropped, swapped or cut-off piece each fail; the intact file opens', async () => {
    const r = await p.evaluate(async () => { const c = await import('./backup-crypto.js');
      const k = await c.newRecoveryKey(), key = await c.importBackupKey(k.raw), id = await c.keyIdOf(k.raw);
      const rnd = new Uint8Array(7_000_000); for (let i = 0; i < rnd.length; i += 65536) crypto.getRandomValues(rnd.subarray(i, Math.min(rnd.length, i + 65536)));
      let s = ''; for (let i = 0; i < rnd.length; i += 8192) s += String.fromCharCode(...rnd.subarray(i, i + 8192));
      const json = JSON.stringify({ blob: btoa(s) });
      const { parts } = await c.encryptBackup(key, id, json);
      const join = ps => { const n = ps.reduce((a, x) => a + x.length, 0), out = new Uint8Array(n); let o = 0; for (const x of ps) { out.set(x, o); o += x.length; } return out; };
      const [pre, ...chunks] = parts, out = { pieces: chunks.length };
      const tryOpen = async bytes => { try { return (await c.decryptBackup(key, id, bytes)) === json ? 'opened' : 'different'; } catch (e) { return e.code; } };
      const flip = (ps, at, off) => { const cp = ps.map(x => x.slice()); cp[at][off] ^= 1; return join(cp); };
      out.intact = await tryOpen(join(parts));
      out.header = await tryOpen(flip(parts, 0, pre.length - 3));
      out.tag = await tryOpen(flip(parts, 1, chunks[0].length - 1));
      out.dropped = await tryOpen(join([pre, chunks[0], ...chunks.slice(2)]));
      out.swapped = await tryOpen(join([pre, chunks[1], chunks[0], ...chunks.slice(2)]));
      out.cutOff = await tryOpen(join([pre, ...chunks.slice(0, -1)]));
      out.shortened = await tryOpen(join(parts).slice(0, -1));
      return out; });
    assert.ok(r.pieces >= 3, `several pieces (${r.pieces})`);
    assert.deepEqual({ ...r, pieces: 0 }, { pieces: 0, intact: 'opened', header: 'tampered', tag: 'tampered', dropped: 'tampered', swapped: 'tampered', cutOff: 'tampered', shortened: 'tampered' });
  });

  await test('on the phone that made it, an encrypted backup opens with the stored key without asking', async () => {
    await p.locator('#import-input').setInputFiles(small); await p.waitForSelector('#ask-modal.active');
    assert.equal(await p.locator('#rki-modal.active').count(), 0, 'no key prompt');
    assert.match(await p.locator('#ask-msg').innerText(), /1 events[\s\S]*Checked: complete and undamaged/);
    await p.locator('#ask-actions button').last().click();
  });

  assert.deepEqual(errors, []);
  await browser.close();
  for (const f of fs.readdirSync('test-artifacts').filter(f => f.endsWith('.cdbk'))) fs.unlinkSync(path.join('test-artifacts', f));   // test files only
  console.log(failed ? 'encrypted backup file FAIL' : 'encrypted backup file PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('encrypted backup file FAIL'); process.exitCode = 1; });
