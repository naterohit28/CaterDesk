// Google Drive backup (D2 of the Drive backup design), against a MOCKED Google: the sign-in library and the Drive API
// are answered inside this test, so nothing ever reaches Google and no real account, client ID or token exists.
// The app is served with the production Content-Security-Policy from vercel.json. Synthetic data only.
// Covers: hidden without a client ID; sign-in library loaded only when Drive backup is opened; drive.file scope only;
// encrypted bytes only (no business data in files, names or properties); token never stored or logged; resumable
// upload after a dropped connection; upload verification; offline / expired sign-in / Drive full; retention to the bin
// (never deleted); restore on a new device (key checked before download) and onto a device with data (safety copy).
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), nodeCrypto = require('node:crypto');

const CSP = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).headers.find(h => h.source === '/(.*)').headers.find(h => h.key === 'Content-Security-Policy').value;
const OLD_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
const CLIENT_ID = 'test-000000000000.apps.googleusercontent.com';   // a made-up ID in the shape Google uses
const TOKEN = 'ya29.MOCK-' + nodeCrypto.randomBytes(24).toString('hex');
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const DATA = { version: 'ffv2', cPays: [{ id: 'p1', evId: 'e1', amt: 25000, date: '2026-11-01', mode: 'UPI' }], vPays: [],
  expenses: [{ id: 'x1', evId: 'e1', cat: 'Raw Material', head: 'Vegetables – भाजी', amt: 4200, date: '2026-11-02', pay: 'paid', mode: 'UPI', billIds: [] }],
  vendors: [{ id: 'v1', name: 'Sample Secret Vendor', cat: 'Live Counter', phone: '9000000001' }],
  events: [{ id: 'e1', name: 'Sample Confidential Wedding', date: '2026-12-10', venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 300000, guests: 300, photoIds: [], meals: ['dinner'],
    mealPlan: { dinner: { guests: 300, rate: 650 } }, dishes: [{ name: 'Sample Paneer Tikka', head: '', meal: 'dinner' }],
    quotes: [{ v: 1, status: 'draft', lines: [{ kind: 'meal', meal: 'dinner', guests: 300, rate: 650 }], showRates: true, terms: '' }] }], photos: [] };
const SECRETS = ['Sample Confidential Wedding', 'Sample Secret Vendor', 'Sample Paneer Tikka', 'Sample Hall', '9000000001'];

/* ── The mocked Google Drive (state lives here in the test) ── */
const drive = { files: new Map(), sessions: new Map(), log: [], n: 0, quota: { limit: String(15e9), usage: '0' },
  dropChunkOnce: false, badChecksum: false, unauthorized: false, offline: false };
const sha = b => nodeCrypto.createHash('sha256').update(b).digest('hex');
const meta = f => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.data ? String(f.data.length) : undefined, createdTime: f.createdTime, appProperties: f.appProperties, trashed: f.trashed,
  sha256Checksum: f.data ? (drive.badChecksum ? sha(Buffer.from('not the same')) : sha(f.data)) : undefined });
function addFile(props, data) { const id = 'f' + (++drive.n) + nodeCrypto.randomBytes(4).toString('hex'); const f = { id, trashed: false, createdTime: new Date().toISOString(), parents: [], ...props, data }; drive.files.set(id, f); return f; }

async function driveRoute(route) {
  const req = route.request(), url = new URL(req.url()), origin = req.headers().origin || BASE_URL;
  const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'Location, Range, Content-Length', 'Access-Control-Allow-Headers': 'authorization, content-type, content-range, x-upload-content-type, x-upload-content-length', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE' };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const body = req.postDataBuffer() || Buffer.alloc(0);
  const entry = { method: req.method(), path: url.pathname, search: url.search, headers: req.headers(), body, fromWorker: !!req.serviceWorker() };
  drive.log.push(entry);
  if (drive.offline) return route.abort('internetdisconnected');
  const reply = (status, json, extra = {}) => route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json', ...extra }, body: json === undefined ? '' : JSON.stringify(json) });
  if (drive.unauthorized || req.headers().authorization !== `Bearer ${TOKEN}`) return reply(401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
  const p = url.pathname, qs = url.searchParams;
  if (p === '/drive/v3/about') return reply(200, { storageQuota: drive.quota });
  if (p === '/drive/v3/files' && req.method() === 'GET') {
    const q = qs.get('q') || '';
    let list = [...drive.files.values()].filter(f => !f.trashed);
    if (q.includes("mimeType='application/vnd.google-apps.folder'")) list = list.filter(f => f.mimeType === 'application/vnd.google-apps.folder' && f.appProperties?.caterdesk === 'folder');
    else { const parent = /'([^']+)' in parents/.exec(q)?.[1]; list = list.filter(f => f.parents.includes(parent)); }
    list.sort((a, b) => (qs.get('orderBy') || '').includes('desc') ? b.createdTime.localeCompare(a.createdTime) : a.createdTime.localeCompare(b.createdTime));
    return reply(200, { files: list.map(meta) });
  }
  if (p === '/drive/v3/files' && req.method() === 'POST') { const m = JSON.parse(body.toString()); entry.metadata = m; return reply(200, { id: addFile({ name: m.name, mimeType: m.mimeType, appProperties: m.appProperties, parents: m.parents || [] }).id }); }
  const one = /^\/drive\/v3\/files\/([\w-]+)$/.exec(p);
  if (one) {
    const f = drive.files.get(one[1]); if (!f) return reply(404, { error: { code: 404 } });
    if (req.method() === 'PATCH') { const m = JSON.parse(body.toString()); if (m.trashed === true) f.trashed = true; return reply(200, { id: f.id }); }
    if (req.method() === 'GET' && qs.get('alt') === 'media') return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/octet-stream', 'Content-Length': String(f.data.length) }, body: f.data });
    if (req.method() === 'GET') return reply(200, meta(f));
    return reply(405, {});
  }
  if (p === '/upload/drive/v3/files' && req.method() === 'POST' && qs.get('uploadType') === 'resumable') {
    const m = JSON.parse(body.toString()); entry.metadata = m;
    const sid = 'up' + nodeCrypto.randomBytes(6).toString('hex');
    drive.sessions.set(sid, { m, total: Number(req.headers()['x-upload-content-length']), got: [], len: 0 });
    return reply(200, undefined, { Location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${sid}` });
  }
  if (p === '/upload/drive/v3/files' && req.method() === 'PUT') {
    const s = drive.sessions.get(qs.get('upload_id')); if (!s) return reply(404, {});
    const range = req.headers()['content-range'] || '';
    const status = () => s.len ? reply(308, undefined, { Range: `bytes=0-${s.len - 1}` }) : reply(308, undefined);
    if (/^bytes \*\//.test(range)) { entry.statusQuery = true; return s.done ? reply(200, meta(s.done)) : status(); }
    const [, from, to] = /^bytes (\d+)-(\d+)\/\d+$/.exec(range) || [];
    if (drive.dropChunkOnce && Number(from) > 0) { drive.dropChunkOnce = false; entry.dropped = true; return route.abort('connectionreset'); }
    if (Number(from) !== s.len || body.length !== Number(to) - Number(from) + 1) return status();
    s.got.push(body); s.len += body.length;
    if (s.len < s.total) return status();
    s.done = addFile({ name: s.m.name, mimeType: s.m.mimeType, appProperties: s.m.appProperties, parents: s.m.parents || [] }, Buffer.concat(s.got));
    return reply(200, meta(s.done));
  }
  return reply(400, { error: { code: 400 } });
}
const gisScript = `window.__gis = { inits: [], revokes: 0 };
window.google = { accounts: { oauth2: {
  initTokenClient(cfg) { __gis.inits.push({ client_id: cfg.client_id, scope: cfg.scope }); return { requestAccessToken() { setTimeout(() => cfg.callback({ access_token: ${JSON.stringify(TOKEN)}, expires_in: 3599, scope: cfg.scope, token_type: 'Bearer' }), 20); } }; },
  hasGrantedAllScopes(r, ...s) { return s.every(x => String(r.scope).split(' ').includes(x)); },
  revoke(t, cb) { __gis.revokes++; cb && cb({ successful: true }); } } } };`;

/* ── A local server that sends the production security headers ── */
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' };
const webRoot = path.resolve('public');
function startServer() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.resolve(webRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(webRoot + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Security-Policy': CSP }); res.end(fs.readFileSync(file));
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

(async () => {
  const server = await startServer();
  const APP = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const external = [], violations = [], consoleText = [], errors = [];
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  // A phone with Drive backup configured (only the config file is swapped, as D3 would do); SW off so routes see every request
  async function phone({ configured = true } = {}) {
    const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 }, acceptDownloads: true, serviceWorkers: 'block' });
    if (configured) await ctx.route('**/drive-config.js', r => r.fulfill({ status: 200, headers: { 'Content-Type': 'text/javascript', 'Content-Security-Policy': CSP },
      body: `export const DRIVE_CLIENT_ID = ${JSON.stringify(CLIENT_ID)};\nexport const DRIVE_ORIGINS = [${JSON.stringify(APP.slice(0, -1))}];\n` }));
    await ctx.route('https://accounts.google.com/**', r => { external.push(r.request().url()); return new URL(r.request().url()).pathname === '/gsi/client' ? r.fulfill({ status: 200, headers: { 'Content-Type': 'text/javascript' }, body: gisScript }) : r.abort(); });
    await ctx.route('https://www.googleapis.com/**', r => { external.push(r.request().url()); return driveRoute(r); });
    await ctx.route(/^https:\/\/(?!www\.googleapis\.com|accounts\.google\.com)/, r => { external.push(r.request().url()); return r.abort(); });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => consoleText.push(m.text()));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', e => console.log('CSP-VIOLATION ' + e.blockedURI + ' ' + e.violatedDirective)));
    page.on('console', m => { if (m.text().startsWith('CSP-VIOLATION')) violations.push(m.text()); });
    await page.goto(APP); await page.waitForSelector('#kpi .card');
    return { ctx, page };
  }
  const google = () => external.filter(u => /accounts\.google\.com|googleapis\.com/.test(u) && !/fonts\.googleapis/.test(u));
  const drawer = async page => { if (!await page.locator('#drawer.active').count()) await page.locator('#drawer-toggle').click(); await page.waitForSelector('#drawer.active'); };
  const openDrive = async page => { await drawer(page); await page.locator('#btn-drive').click(); await page.waitForSelector('#drive-modal.active'); };
  const progress = page => page.locator('#drive-progress').innerText();
  const snapshot = page => page.evaluate(async () => { const d = await (await import('./db.js')).exportAllData(); delete d.manifest; delete d.exportedAt; delete d.appVersion;
    for (const s of Object.keys(d)) if (Array.isArray(d[s])) d[s] = d[s].map(({ _rev, ...r }) => r).sort((a, b) => String(a.id).localeCompare(String(b.id))); return JSON.stringify(d); });
  const backups = () => [...drive.files.values()].filter(f => f.appProperties?.caterdesk === '1');
  const backupNow = async page => { await page.evaluate(() => { document.getElementById('drive-progress').textContent = ''; }); await page.locator('#btn-drive-backup').click(); await page.waitForFunction(() => !document.getElementById('btn-drive-backup').disabled && document.getElementById('drive-progress').textContent, null, { timeout: 120000 }); return progress(page); };

  await test('Drive backup is hidden and no Google code loads while no client ID is configured (as shipped)', async () => {
    const { ctx, page } = await phone({ configured: false });
    await drawer(page);
    assert.equal(await page.locator('#btn-drive').isHidden(), true);
    assert.deepEqual(google(), []);
    await ctx.close();
  });

  const { ctx, page: p } = await phone();
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  await p.reload(); await p.waitForSelector('#kpi .card');
  let keyText;

  await test('the Google sign-in library loads only when Drive backup is opened, not on start or in daily use', async () => {
    for (const tab of ['n-events', 'n-expenses', 'n-vendors', 'n-summary', 'n-home']) { await p.locator('#' + tab).click(); await p.waitForTimeout(150); }
    await drawer(p);
    assert.equal(await p.locator('#btn-drive').isVisible(), true, 'shown once a client ID is configured');
    assert.deepEqual(google(), [], 'no request to Google before Drive backup is opened');
    await p.locator('#btn-drive').click(); await p.waitForSelector('#drive-modal.active');
    await p.waitForFunction(() => !!window.google?.accounts?.oauth2);
    assert.deepEqual(google(), ['https://accounts.google.com/gsi/client'], 'only the sign-in library, and nothing sent to Drive yet');
    assert.match(await p.locator('#drive-status').innerText(), /Not connected[\s\S]*No verified backup/);
  });

  await test('Back up now needs the recovery key first (backups are encrypted with it)', async () => {
    await p.locator('#btn-drive-backup').click(); await p.waitForSelector('#rk-modal.active');
    keyText = await p.locator('#rk-key').innerText();
    await p.locator('#rk-written').check(); await p.locator('#btn-rk-next').click();
    await p.fill('#rk-typed', keyText); await p.locator('#btn-rk-verify').click();
    await p.waitForSelector('#toast-msg:has-text("Encrypted backup is set up")');
    assert.equal(google().filter(u => u.includes('googleapis')).length, 0, 'nothing went to Drive');
  });

  // 40 older backups already in Drive (one a day before today), to check old copies go to the bin and nothing is deleted
  const folder = addFile({ name: 'CaterDesk Backups', mimeType: 'application/vnd.google-apps.folder', appProperties: { caterdesk: 'folder' }, createdTime: '2026-01-01T00:00:00.000Z' });
  for (let d = 1; d <= 40; d++) { const at = new Date(Date.now() - d * 86400000).toISOString();
    addFile({ name: `CaterDesk-backup-old-${d}.cdbk`, mimeType: 'application/octet-stream', parents: [folder.id], createdTime: at, appProperties: { caterdesk: '1', format: '1', keyId: '0000000000000000', createdAt: at, appVersion: '4.29.0' } }, Buffer.from('CDBK old')); }

  await test('Back up now: connects with drive.file only, uploads encrypted bytes only, checks them, records the verified backup', async () => {
    await openDrive(p);
    const text = await backupNow(p);
    assert.match(text, /^Saved to Drive and verified/, text);
    assert.deepEqual(await p.evaluate(() => window.__gis.inits), [{ client_id: CLIENT_ID, scope: SCOPE }], 'one token client, exactly the drive.file scope');
    const made = backups().filter(f => f.parents.includes(folder.id) && !f.name.includes('-old-'));
    assert.equal(made.length, 1);
    const f = made[0];
    assert.match(f.name, /^CaterDesk-backup-\d{4}-\d\d-\d\d-\d{4}-[0-9a-f]{6}\.cdbk$/);
    assert.deepEqual(Object.keys(f.appProperties).sort(), ['appVersion', 'caterdesk', 'createdAt', 'format', 'keyId'], 'only the allowed properties');
    assert.equal(f.data.subarray(0, 4).toString(), 'CDBK');
    const uploads = drive.log.filter(e => e.path.startsWith('/upload/') || e.method !== 'GET');
    for (const e of uploads) for (const s of SECRETS) assert.ok(!e.body.toString('latin1').includes(s) && !(e.path + e.search).includes(s), `no "${s}" sent to Drive`);
    const md = drive.log.find(e => e.path === '/upload/drive/v3/files' && e.method === 'POST').metadata;
    assert.deepEqual(Object.keys(md).sort(), ['appProperties', 'mimeType', 'name', 'parents']);
    assert.equal(drive.log.some(e => e.method === 'DELETE'), false, 'nothing is ever deleted');
    // Older copies beyond 14 daily / 8 weekly / 12 monthly went to the bin; the newest days stayed
    const old = backups().filter(x => x.name.includes('-old-'));
    const binned = old.filter(x => x.trashed).map(x => Number(x.name.match(/-old-(\d+)/)[1]));
    assert.ok(binned.length > 10 && binned.every(d => d > 13), `older copies moved to the bin (${binned.length}), recent days kept`);
    // The uploaded file opens with the recovery key and holds this phone's data
    const back = await p.evaluate(async ({ bytes, keyText }) => { const c = await import('./backup-crypto.js'); const raw = await c.parseRecoveryKey(keyText);
      const u8 = Uint8Array.from(atob(bytes), ch => ch.charCodeAt(0)); return JSON.parse(await c.decryptBackup(await c.importBackupKey(raw), await c.keyIdOf(raw), u8)).events[0].name; }, { bytes: f.data.toString('base64'), keyText });
    assert.equal(back, 'Sample Confidential Wedding');
    const v = await p.evaluate(async () => (await import('./db.js')).getMeta('drive_last_verified'));
    assert.equal(v.id, f.id); assert.equal(v.size, f.data.length);
    assert.match(await p.locator('#drive-status').innerText(), /Connected for this session[\s\S]*Last verified backup: .* · key /);
  });

  await test('the access token is never stored, logged, put in a URL or left in the page', async () => {
    const found = await p.evaluate(async t => { const db = await import('./db.js'); const where = [];
      for (const s of ['events', 'expenses', 'vendors', 'cPays', 'vPays', 'photos', 'meta']) if (JSON.stringify(await db.getAll(s)).includes(t)) where.push('idb:' + s);
      for (const st of [localStorage, sessionStorage]) for (let i = 0; i < st.length; i++) if ((st.key(i) + st.getItem(st.key(i))).includes(t)) where.push('storage');
      if (document.documentElement.outerHTML.includes(t) || location.href.includes(t)) where.push('page');
      return where; }, TOKEN);
    assert.deepEqual(found, []);
    assert.equal(consoleText.some(c => c.includes(TOKEN)), false, 'not in the console');
    assert.equal(external.some(u => u.includes(TOKEN)), false, 'not in any URL');
  });

  await test('daily use while connected sends nothing to Google (reports and suggestions stay on the phone)', async () => {
    await p.locator('#drive-modal [data-action="close-modal"]').click();
    const before = google().length;
    for (const tab of ['n-summary', 'n-events', 'n-home']) { await p.locator('#' + tab).click(); await p.waitForTimeout(200); }
    assert.equal(google().length, before);
  });

  await test('a large backup resumes after the connection drops mid-upload and is still verified', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest;
      const rnd = new Uint8Array(200000); for (let k = 0; k < rnd.length; k += 65536) crypto.getRandomValues(rnd.subarray(k, Math.min(rnd.length, k + 65536)));
      let s = ''; for (let k = 0; k < rnd.length; k += 8192) s += String.fromCharCode(...rnd.subarray(k, k + 8192));
      const base = btoa(s);
      d.photos = Array.from({ length: 50 }, (_, i) => ({ id: `ph${i}`, expenseId: 'x1', data: 'data:image/jpeg;base64,' + base.slice(i * 97) + base.slice(0, i * 97), createdAt: '2026-11-02T10:00:00.000Z' }));
      await db.importAllData(d, 'replace'); });
    await p.reload(); await p.waitForSelector('#kpi .card');
    drive.dropChunkOnce = true; const logFrom = drive.log.length;
    await openDrive(p);
    const text = await backupNow(p);
    assert.match(text, /^Saved to Drive and verified/, text);
    const mine = drive.log.slice(logFrom);
    assert.ok(mine.some(e => e.dropped), 'a piece was dropped'); assert.ok(mine.some(e => e.statusQuery), 'asked Drive how far it got');
    const newest = backups().filter(f => !f.trashed).sort((a, b) => b.createdTime.localeCompare(a.createdTime))[0];
    assert.ok(newest.data.length > 8 * 1024 * 1024, `more than two upload pieces (${(newest.data.length / 1048576).toFixed(1)} MB)`);
    const v = await p.evaluate(async () => (await import('./db.js')).getMeta('drive_last_verified'));
    assert.equal(v.id, newest.id);
  });

  const lastVerified = () => p.evaluate(async () => (await import('./db.js')).getMeta('drive_last_verified'));
  const lastAttempt = () => p.evaluate(async () => (await import('./db.js')).getMeta('drive_last_attempt'));

  await test('an upload Drive does not hold exactly is reported, moved to the bin, and the last verified backup is unchanged', async () => {
    const v0 = await lastVerified(); drive.badChecksum = true;
    const text = await backupNow(p); drive.badChecksum = false;
    assert.match(text, /^Upload could not be verified/);
    assert.deepEqual(await lastVerified(), v0);
    const a = await lastAttempt(); assert.equal(a.ok, false); assert.match(a.reason, /could not be verified/);
    const bad = backups().sort((x, y) => y.createdTime.localeCompare(x.createdTime))[0];
    assert.equal(bad.trashed, true, 'the unverified copy is in the bin, not deleted');
    assert.match(await p.locator('#drive-status').innerText(), /Last attempt .* failed: Upload could not be verified/);
    assert.equal(drive.log.some(e => e.method === 'DELETE'), false);
  });

  await test('offline, expired sign-in and a full Drive each fail honestly and leave the last verified backup unchanged', async () => {
    const v0 = await lastVerified(), count = drive.files.size;
    drive.offline = true; assert.match(await backupNow(p), /^No internet connection/); drive.offline = false;
    drive.quota = { limit: '1000', usage: '900' }; assert.match(await backupNow(p), /^Google Drive storage is full/); drive.quota = { limit: String(15e9), usage: '0' };
    drive.unauthorized = true; assert.match(await backupNow(p), /^Google sign-in has expired/); drive.unauthorized = false;
    assert.match(await p.locator('#drive-status').innerText(), /Not connected/, 'an expired token is forgotten');
    assert.equal(await p.locator('#btn-drive-connect').isVisible(), true);
    assert.deepEqual(await lastVerified(), v0);
    assert.equal(drive.files.size, count, 'nothing uploaded, moved or deleted to make room');
    assert.equal((await lastAttempt()).ok, false);
  });

  await test('retention: over 120 days of daily backups, 14 daily, 8 weekly and 12 monthly copies plus the 3 newest are kept', async () => {
    const r = await p.evaluate(async () => { const { toPrune } = await import('./drive-backup.js');
      const now = new Date(2026, 10, 16, 21, 0), files = [];
      for (let d = 0; d < 120; d++) { const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d, 21, 0); files.push({ id: 'd' + d, createdAt: t.toISOString() });
        if (d < 2) files.push({ id: 'e' + d, createdAt: new Date(t.getTime() - 3600000).toISOString() }); }   // two days with a second, earlier backup
      const out = new Set(toPrune(files)), kept = files.filter(f => !out.has(f.id)).map(f => f.id);
      const day = t => new Date(t).toDateString();
      const mon = t => { const x = new Date(t); return new Date(x.getFullYear(), x.getMonth(), x.getDate() - (x.getDay() + 6) % 7).toDateString(); };
      const month = t => { const x = new Date(t); return x.getFullYear() + '-' + x.getMonth(); };
      return { kept, total: files.length, days: new Set(kept.filter(id => id[0] === 'd').map(id => day(files.find(f => f.id === id).createdAt))).size,
        weeks: new Set(kept.map(id => mon(files.find(f => f.id === id).createdAt))).size, months: new Set(kept.map(id => month(files.find(f => f.id === id).createdAt))).size }; });
    for (let d = 0; d < 14; d++) assert.ok(r.kept.includes('d' + d), `day ${d} kept`);
    assert.ok(r.kept.includes('e0'), 'the 3 newest are kept even on the same day');
    assert.ok(!r.kept.includes('e1'), 'an earlier copy on an older day is not');
    assert.ok(r.weeks >= 8, `8 weeks covered (${r.weeks})`); assert.ok(r.months >= 4, `every month in 120 days covered (${r.months})`);
    assert.ok(r.kept.length < 14 + 8 + 12 + 3 && r.kept.length >= 14 + 6, `kept ${r.kept.length} of ${r.total}`);
  });

  await test('restore on a new device: the recovery key is checked before download; a wrong key is refused; every record comes back', async () => {
    const before = await snapshot(p);
    const { ctx: c2, page: p2 } = await phone();
    const logFrom = drive.log.length;
    await openDrive(p2);
    await p2.locator('#btn-drive-restore').click(); await p2.waitForSelector('#ask-modal.active');
    assert.match(await p2.locator('#ask-msg').innerText(), /backups? on Drive/);
    await p2.locator('#ask-actions button').first().click();
    await p2.waitForSelector('#rki-modal.active');
    assert.equal(drive.log.slice(logFrom).some(e => e.search.includes('alt=media')), false, 'nothing downloaded before the key is given');
    const wrong = keyText.split('-'); wrong[0] = wrong[0] === 'AAAA' ? 'BBBB' : 'AAAA';
    await p2.fill('#rki-typed', wrong.join('-')); await p2.locator('#btn-rki-ok').click();
    assert.match(await p2.locator('#rki-result').innerText(), /not right|different recovery key/);
    await p2.fill('#rki-typed', keyText); await p2.locator('#btn-rki-ok').click();
    await p2.waitForSelector('#ask-modal.active #ask-actions button:has-text("Replace all data")', { timeout: 120000 });
    assert.match(await p2.locator('#ask-msg').innerText(), /50 photos[\s\S]*Checked: complete and undamaged/);
    await p2.locator('#ask-actions button', { hasText: 'Replace all data' }).click();
    await p2.waitForSelector('#toast-msg:has-text("Imported")', { timeout: 120000 });
    assert.equal(await snapshot(p2), before, 'identical on the new device');
    await c2.close();
  });

  // Restore the newest Drive backup with Replace, up to the point where a safety copy would be asked for
  const replaceFromDrive = async page => {
    await openDrive(page);
    await page.locator('#btn-drive-restore').click(); await page.waitForSelector('#ask-modal.active');
    await page.locator('#ask-actions button').first().click();
    if (await page.locator('#rki-modal.active').count() || await page.waitForSelector('#rki-modal.active', { timeout: 3000 }).catch(() => null)) { await page.fill('#rki-typed', keyText); await page.locator('#btn-rki-ok').click(); }
    await page.waitForSelector('#ask-modal.active #ask-actions button:has-text("Replace all data")', { timeout: 120000 });
    assert.match(await page.locator('#ask-msg').innerText(), /you will save a copy of it before anything is replaced/);
    await page.locator('#ask-actions button', { hasText: 'Replace all data' }).click();
  };
  const askTitle = page => page.waitForSelector('#ask-modal.active').then(() => page.locator('#ask-title').innerText());

  await test('Replace from Drive: no copy confirmed, nothing replaced (closing, cancelling, or not confirming the saved copy)', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); await db.putOne('vendors', { id: 'v9', name: 'Sample Later Vendor', cat: 'Live Counter', phone: '9000000009' }); });
    await p.reload(); await p.waitForSelector('#kpi .card');
    const before = await snapshot(p);
    // Cancel at "save a copy first"
    await replaceFromDrive(p);
    assert.match(await askTitle(p), /First, save a copy/);
    assert.match(await p.locator('#ask-msg').innerText(), /encrypted with your recovery key/);
    await p.locator('#ask-actions button', { hasText: 'Cancel' }).click();
    await p.waitForSelector('#toast-msg:has-text("Not replaced")');
    assert.equal(await snapshot(p), before);
    // The copy is downloaded, but the owner does not confirm it is there (e.g. the phone blocked the download)
    await replaceFromDrive(p);
    await askTitle(p);
    const dl = p.waitForEvent('download');
    await p.locator('#ask-actions button', { hasText: 'Save a copy' }).click();
    await dl; assert.match(await askTitle(p), /Is the copy saved/);
    await p.goBack();   // Back, as on a phone
    await p.waitForSelector('#toast-msg:has-text("Not replaced")');
    assert.equal(await snapshot(p), before, 'nothing replaced without a confirmed copy');
  });

  await test('Replace from Drive onto a device with data: the copy is saved (again if needed) and confirmed, then replaced', async () => {
    await replaceFromDrive(p);
    await askTitle(p);
    const dl1 = p.waitForEvent('download');
    await p.locator('#ask-actions button', { hasText: 'Save a copy' }).click(); await dl1;
    await askTitle(p);
    const dl2 = p.waitForEvent('download');
    await p.locator('#ask-actions button', { hasText: 'Save the copy again' }).click();
    const d = await dl2; assert.match(d.suggestedFilename(), /^caterdesk-before-restore-.*\.cdbk$/);
    const saved = fs.readFileSync(await d.path());
    assert.equal(saved.subarray(0, 4).toString(), 'CDBK', 'the copy is encrypted with the recovery key (tests/encrypted-safety-copy.cjs restores one)');
    assert.ok(!saved.toString('latin1').includes('Sample Later Vendor'), 'and its records are not readable');
    assert.match(await askTitle(p), /Is the copy saved/);
    await p.locator('#ask-actions button', { hasText: 'The copy is saved' }).click();
    await p.waitForSelector('#toast-msg:has-text("Imported")', { timeout: 120000 });
    assert.equal(await p.evaluate(async () => (await (await import('./db.js')).getAll('vendors')).some(v => v.name === 'Sample Later Vendor')), false, 'replaced after confirmation');
  });

  await test('a device holding only custom menus, or only business details, is asked for a copy too (Replace removes them)', async () => {
    for (const setup of ['menus', 'profile']) {
      const { ctx: c3, page: p3 } = await phone();
      await p3.evaluate(async setup => { const db = await import('./db.js');
        if (setup === 'menus') await db.putOne('menus', { id: 'my1', name: 'Sample Custom Menu', meals: ['dinner'], slabs: [{ min: 100, rate: 500 }], items: ['Sample Dal'] });
        else localStorage.setItem('ffv2_profile', JSON.stringify({ name: 'Sample Caterers', phone: '9000000010' })); }, setup);
      await p3.reload(); await p3.waitForSelector('#kpi .card');
      if (setup === 'menus') assert.equal(await p3.evaluate(async () => (await (await import('./db.js')).exportAllData()).menus.length), 1, 'a menu-library entry and nothing else');
      await replaceFromDrive(p3);
      assert.match(await askTitle(p3), /First, save a copy/, setup);
      assert.match(await p3.locator('#ask-msg').innerText(), setup === 'menus' ? /\(1 record\)/ : /\(business details\)/);
      await p3.locator('#ask-actions button', { hasText: 'Cancel' }).click();
      await p3.waitForSelector('#toast-msg:has-text("Not replaced")');
      if (setup === 'menus') assert.equal(await p3.evaluate(async () => (await (await import('./db.js')).exportAllData()).menus[0]?.name), 'Sample Custom Menu', 'the menu is kept');
      await c3.close();
    }
  });

  await test('Disconnect tells Google to forget the access and this phone forgets the token', async () => {
    await openDrive(p);
    await p.locator('#btn-drive-disconnect').click();
    assert.equal(await p.evaluate(() => window.__gis.revokes), 1);
    await p.waitForSelector('#drive-status:has-text("Not connected")');
    assert.equal(await p.locator('#btn-drive-connect').isVisible(), true);
    const n = drive.log.length;
    await p.evaluate(async () => { const d = await import('./drive-backup.js'); try { await d.listBackups('abc'); } catch (e) { return e.code; } });
    assert.equal(drive.log.length, n, 'no Drive call is made without connecting again');
  });

  await test('the production policy adds only the Google sign-in file and Drive/Google token addresses, and nothing was blocked', async () => {
    const dirs = s => Object.fromEntries(s.split(';').map(x => x.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    const now = dirs(CSP), old = dirs(OLD_CSP);
    assert.deepEqual(Object.keys(now), Object.keys(old));
    const added = Object.fromEntries(Object.keys(now).map(k => [k, now[k].filter(v => !old[k].includes(v))]).filter(([, v]) => v.length));
    assert.deepEqual(added, { 'script-src': ['https://accounts.google.com/gsi/client'], 'connect-src': ['https://www.googleapis.com', 'https://accounts.google.com/gsi/', 'https://oauth2.googleapis.com/revoke'] });
    assert.ok(Object.keys(now).every(k => old[k].every(v => now[k].includes(v))), 'nothing removed');
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
  });

  await ctx.close();

  await test('with the service worker on, Google requests go straight to the network (never answered or cached by the worker)', async () => {
    const c = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
    const seen = [];
    await c.route('https://www.googleapis.com/**', r => { seen.push(!!r.request().serviceWorker()); return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' }); });
    await c.route(/^https:\/\/(?!www\.googleapis\.com)/, r => r.abort());
    const page = await c.newPage(); await page.goto(APP); await page.waitForSelector('#kpi .card');
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready).active && !!navigator.serviceWorker.controller, null, { timeout: 30000 }).catch(async () => { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller); });
    await page.evaluate(() => fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota').then(r => r.text()));
    assert.deepEqual(seen, [false], 'sent by the page, not through the service worker');
    const cached = await page.evaluate(async () => { for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) if (!r.url.startsWith(location.origin)) return r.url; return null; });
    assert.equal(cached, null);
    await c.close();
  });

  await browser.close(); server.close();
  console.log(failed ? 'drive backup FAIL' : 'drive backup PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('drive backup FAIL'); process.exitCode = 1; });
