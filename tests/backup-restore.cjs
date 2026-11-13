// P1-C backup format v5: restore drill on a second device (G-15), damaged or wrong backups refused with
// existing data intact (G-16), bounded and validated import (G-28), saving through the share sheet.
// Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const DATA = {
  version: 'ffv2',
  vendors: [{ id: 'v1', name: 'Sample Chaat Counter', cat: 'Live Counter', phone: '9000000001' }, { id: 'p1', name: 'Sample Lender', kind: 'person' }],
  events: [{ id: 'e1', name: 'Sample Wedding', date: '2026-10-20', venue: 'Sample Lawn', type: 'Wedding – लग्न', billing: 250000.5, guests: 300, menu: 'golden', meals: ['lunch', 'dinner'], photoIds: ['ph1'],
    dishes: [{ name: 'Pani Puri', head: 'Chaat – चाट' }], orders: [{ id: 'o1', head: 'Chaat – चाट', venId: 'v1', plates: 300, date: '2026-10-20', time: '19:00', status: 'delivered' }],
    labour: { rows: [{ id: 'l1', role: 'Boys – बॉईज', rate: 600, counts: { e: 10, n: 4 } }], pay: 'credit', mode: '', venId: '', expIds: {} }, futureField: { keep: true } },
    { id: 'e2', name: 'Sample Birthday', date: '2026-11-02', venue: 'Sample Hall', type: 'Birthday – वाढदिवस', billing: 40000, guests: 80, outsourced: true, outVenId: 'v1', photoIds: [] }],
  expenses: [{ id: 'x1', evId: 'e1', cat: 'Live Counter', head: 'Chaat – चाट', amt: 18000.25, date: '2026-10-20', pay: 'credit', venId: 'v1', dueDate: '2026-11-20', billIds: ['ph2'] },
    { id: 'x2', evId: 'e1', cat: 'Labour', head: 'Boys – बॉईज', amt: 8400, date: '2026-10-21', pay: 'paid', mode: 'UPI', billIds: [] },
    { id: 'x3', evId: 'e2', cat: 'Operations', head: 'Caterer', amt: 34000, date: '2026-11-02', pay: 'credit', venId: 'v1', billIds: [] }],
  cPays: [{ id: 'c1', evId: 'e1', amt: 100000, date: '2026-10-01', mode: 'Bank' }, { id: 'c2', evId: 'e2', amt: 40000, date: '2026-11-02', mode: 'Cash' }],
  vPays: [{ id: 'vp1', venId: 'v1', amt: 5000, date: '2026-10-25', mode: 'UPI' }, { id: 'vp2', venId: 'p1', evId: 'e1', amt: 20000, date: '2026-10-05', mode: 'Cash', head: 'Loan' }],
  photos: [{ id: 'ph1', eventId: 'e1', data: PNG, createdAt: '2026-10-20T10:00:00.000Z' }, { id: 'ph2', expenseId: 'x1', data: PNG, createdAt: '2026-10-21T10:00:00.000Z' }]
};
const STORES = ['events', 'expenses', 'vendors', 'cPays', 'vPays', 'photos'];
const PREFS = { ffv2_theme: 'light', ffv2_lang: 'mr', ffv2_period: '"month"', ffv2_lastexp: '{"cat":"Labour","head":"Boys – बॉईज","mode":"UPI"}' };
const noRev = rows => rows.map(({ _rev, ...r }) => r).sort((a, b) => a.id.localeCompare(b.id));

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-backup-'));
  const results = [];
  const step = async (name, fn) => { try { await fn(); results.push(name + ' PASS'); console.log(name + ' PASS'); } catch (e) { console.error(e); console.log(name + ' FAIL'); process.exitCode = 1; } };
  const open = async () => {
    const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage(); p.setDefaultTimeout(10000);
    const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
    return { ctx, p, errors };
  };
  const dump = p => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const importFile = async (p, file, choose) => {
    await p.setInputFiles('#import-input', file);
    if (!choose) return;
    await p.waitForSelector('#ask-modal.active #ask-actions button');
    const msg = await p.locator('#ask-msg').textContent();
    await p.locator('#ask-actions button', { hasText: choose }).click();
    return msg;
  };
  const toast = async p => { await p.waitForSelector('#toast.show'); return p.locator('#toast-msg').textContent(); };

  // Device A: real records and settings, saved through the share sheet as Android offers it (.txt only)
  const A = await open();
  await A.p.evaluate(async ({ d, prefs }) => { const db = await import('./db.js'); await db.importAllData(d); for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, v); }, { d: DATA, prefs: PREFS });
  await A.p.reload(); await A.p.waitForSelector('#kpi .card');
  let shared;
  await step('backup saves through the share menu as .txt (Android refuses .json even when canShare says yes)', async () => {
    // The share sheet opens only from a tap made after the backup is ready (Android requires a recent tap)
    await A.p.evaluate(() => {
      window.__got = null;
      // As Android Chrome: canShare says yes to any file, share refuses types not on its list (.json), and only from a tap
      navigator.canShare = ({ files }) => files.length > 0;
      navigator.share = async ({ files }) => { if (window.event?.type !== 'click') throw new DOMException('Must be handling a user gesture to perform a share request.', 'NotAllowedError');
        if (!/\.txt$/.test(files[0].name) || files[0].type !== 'text/plain') throw new DOMException('Permission denied', 'NotAllowedError'); window.__got = { name: files[0].name, type: files[0].type, text: await files[0].text() }; };
      window.__done = window.FF.exportData();
    });
    await A.p.waitForSelector('#ask-modal.active #ask-actions button');
    assert.match(await A.p.locator('#ask-title').textContent(), /Backup ready|बॅकअप तयार/);
    await A.p.locator('#ask-actions button').first().click();
    shared = await A.p.evaluate(async () => { await window.__done; return window.__got; });
    assert(shared, 'share sheet opened from the tap');
    assert.match(shared.name, /^caterdesk-backup-\d{4}-\d{2}-\d{2}\.txt$/); assert.equal(shared.type, 'text/plain');
    assert.match(await toast(A.p), /Backup shared|बॅकअप पाठवला/);
    const b = JSON.parse(shared.text);
    assert.equal(b.version, 'ffv2', 'older app versions can still read it');
    assert.equal(b.manifest.format, 'caterdesk-backup'); assert.equal(b.manifest.formatVersion, 1); assert.match(b.manifest.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(b.manifest.counts, { events: 2, expenses: 3, vendors: 2, cPays: 2, vPays: 2, photos: 2 });
    assert.deepEqual(b.prefs, PREFS);
    assert(!JSON.stringify(b).includes('pin_hash') && !('ffv2_diagnostics' in b.prefs), 'PIN and error-report consent stay on the device');
  });
  const good = path.join(tmp, 'caterdesk-backup.txt'); fs.writeFileSync(good, shared.text);
  const before = await dump(A.p);

  await step('"Save to phone" downloads the .json backup', async () => {
    await A.p.locator('#toast').evaluate(t => t.className = '');
    const wait = A.p.waitForEvent('download');
    await A.p.evaluate(() => { window.__done = window.FF.exportData(); });
    await A.p.waitForSelector('#ask-modal.active #ask-actions button');
    await A.p.locator('#ask-actions button').nth(1).click();
    const dl = await wait; assert.match(dl.suggestedFilename(), /^caterdesk-backup-\d{4}-\d{2}-\d{2}\.json$/);
    await A.p.evaluate(() => window.__done); assert.match(await toast(A.p), /Downloads|जतन/);
  });
  await step('if the phone refuses to share, the backup is still saved to Downloads and the reason is shown', async () => {
    await A.p.locator('#toast').evaluate(t => t.className = '');
    const wait = A.p.waitForEvent('download');
    await A.p.evaluate(() => { navigator.share = async () => { throw new DOMException('refused', 'NotAllowedError'); }; window.__done = window.FF.exportData(); });
    await A.p.waitForSelector('#ask-modal.active #ask-actions button');
    await A.p.locator('#ask-actions button').first().click();
    const dl = await wait; assert.match(dl.suggestedFilename(), /\.json$/); await A.p.evaluate(() => window.__done);
    const msg = await toast(A.p); assert.match(msg, /did not open the share menu \(NotAllowedError: refused\)/); assert.match(msg, /saved to Downloads/);
  });
  await step('cancelling the choice saves nothing', async () => {
    let downloads = 0; const count = () => downloads++; A.p.on('download', count);
    await A.p.evaluate(() => { window.__done = window.FF.exportData(); });
    await A.p.waitForSelector('#ask-modal.active #ask-actions button');
    await A.p.locator('#ask-actions button').last().click();
    await A.p.evaluate(() => window.__done); await A.p.waitForTimeout(300); A.p.off('download', count);
    assert.equal(downloads, 0);
  });
  await step('without a share sheet the backup downloads as .json', async () => {
    const wait = A.p.waitForEvent('download');
    await A.p.evaluate(() => { navigator.canShare = () => false; return window.FF.exportData(); });
    const dl = await wait; assert.match(dl.suggestedFilename(), /^caterdesk-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const b = JSON.parse(fs.readFileSync(await dl.path(), 'utf8')); assert.equal(b.manifest.sha256, JSON.parse(shared.text).manifest.sha256);
  });

  // Device B: a fresh phone restores the backup file (G-15)
  const B = await open();
  await step('G-15 restore on a new device: every record, ID, amount, photo and setting matches', async () => {
    const msg = await importFile(B.p, good, 'Replace');
    assert.match(msg, /2 events · 3 expenses · 2 client payments · 2 vendors · 2 vendor payments · 2 photos/);
    assert.match(msg, /✓ Checked: complete and undamaged/); assert.match(msg, /CaterDesk v\d+\.\d+\.\d+/);
    assert.equal(await toast(B.p), 'आयात झाली', 'imported; the restored Marathi setting is already in effect');
    const after = await dump(B.p);
    for (const s of STORES) assert.deepEqual(noRev(after[s]), noRev(before[s]), s + ' identical after restore');
    const prefs = await B.p.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), Object.keys(PREFS));
    assert.deepEqual(prefs, PREFS);
    assert.equal(await B.p.evaluate(() => document.documentElement.classList.contains('light')), true, 'theme applied');
    // Balances and totals computed from the restored data match device A
    const totals = p => p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData();
      return { pl: d.events.map(e => u.calcEventPL(e, d.cPays, d.expenses)).map(r => [r.received, r.expTotal, r.profit, r.pending]), ven: u.calcVendorBalance ? d.vendors.map(v => JSON.stringify(u.calcVendorBalance(v.id, d.expenses, d.vPays))) : [] }; });
    assert.deepEqual(await totals(B.p), await totals(A.p));
  });

  // G-16 / G-28: damaged, cut-off, newer, foreign and oversized files are refused; data stays as it was
  const intact = async (p, why) => { const now = await dump(p); for (const s of STORES) assert.deepEqual(noRev(now[s]), noRev(before[s]), `${why}: ${s} unchanged`); };
  const bad = (name, text) => { const f = path.join(tmp, name); fs.writeFileSync(f, text); return f; };
  const b = JSON.parse(shared.text);
  const cases = [
    ['an amount edited inside the file', JSON.stringify({ ...b, expenses: b.expenses.map(x => x.id === 'x2' ? { ...x, amt: 840 } : x) }), /damaged or incomplete/],
    ['a record removed from the file', JSON.stringify({ ...b, cPays: b.cPays.slice(1) }), /damaged or incomplete/],
    ['a file cut off part-way', shared.text.slice(0, Math.floor(shared.text.length * .6)), /not a CaterDesk backup, or it is cut off/],
    ['a backup from a newer app', JSON.stringify({ ...b, manifest: { ...b.manifest, formatVersion: 99 } }), /made by a newer CaterDesk/],
    ['unreadable check information', JSON.stringify({ ...b, manifest: 'x' }), /damaged/],
    ['some other JSON file', JSON.stringify({ hello: 'world' }), /not a CaterDesk backup/]
  ];
  for (const [what, text, expect] of cases) await step(`G-16 refused with data intact: ${what}`, async () => {
    await B.p.locator('#toast').evaluate(t => t.className = '');
    await importFile(B.p, bad('bad.txt', text));
    const msg = await toast(B.p); assert.match(msg, expect); assert.match(msg, /not changed/);
    assert.equal(await B.p.locator('#ask-modal.active').count(), 0, 'no import choice offered');
    await intact(B.p, what);
  });
  await step('G-28 an oversized file is refused before it is read', async () => {
    await B.p.locator('#toast').evaluate(t => t.className = '');
    await B.p.evaluate(() => { const i = document.getElementById('import-input'); Object.defineProperty(i, 'files', { configurable: true, value: [{ size: 400 * 1024 * 1024, name: 'huge.json' }] }); i.dispatchEvent(new Event('change')); delete i.files; });
    assert.match(await toast(B.p), /too large/); await intact(B.p, 'oversized');
  });
  await step('a backup made before manifests (v4.0.x) still imports, flagged as unchecked', async () => {
    const C = await open();
    const { manifest, prefs, ...legacy } = b;
    const msg = await importFile(C.p, bad('legacy.json', JSON.stringify(legacy)), 'Replace');
    assert.match(msg, /older version: it cannot be checked/);
    assert.match(await toast(C.p), /Imported|आयात झाली/);
    const after = await dump(C.p); for (const s of STORES) assert.deepEqual(noRev(after[s]), noRev(before[s]));
    assert.equal(await C.p.evaluate(() => localStorage.getItem('ffv2_theme')), null, 'no settings in an old backup, none changed');
    await C.ctx.close();
  });
  await step('merge keeps this phone\'s own settings', async () => {
    await B.p.evaluate(() => localStorage.setItem('ffv2_theme', 'dark'));
    await importFile(B.p, good, /Merge|जोडा/); assert.match(await toast(B.p), /Imported|आयात झाली/);
    assert.equal(await B.p.evaluate(() => localStorage.getItem('ffv2_theme')), 'dark');
  });
  assert.deepEqual([...A.errors, ...B.errors], []);
  fs.rmSync(tmp, { recursive: true, force: true });
  await browser.close();
  console.log(process.exitCode ? 'backup restore drill FAIL' : `backup restore drill (${results.length} checks) PASS`);
})().catch(e => { console.error(e); console.log('backup restore drill FAIL'); process.exitCode = 1; });
