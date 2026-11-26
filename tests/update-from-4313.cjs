// Updating to this release from the last accepted phone release (4.31.13) and from 4.31.14: the released app (from
// its git tag) is installed with records and an unfinished form, then the server switches to this version. Checked:
// the normal update (Settings → Check for app updates), records and the open form kept, the new build running, the
// app opening offline afterwards, and an update that arrives while the phone is offline (the old version keeps
// working offline, and updates once back online). Fresh browser profile, synthetic data, no live site.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
process.chdir(path.resolve(__dirname, '..'));
const NEW = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const filesAt = ref => { const m = new Map();
  for (const f of execFileSync('git', ['ls-tree', '-r', '--name-only', ref, 'public'], { encoding: 'utf8' }).split('\n').filter(Boolean))
    m.set('/' + f.slice('public/'.length), execFileSync('git', ['show', `${ref}:${f}`], { maxBuffer: 2e7 }));
  return m; };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };

  for (const from of ['4.31.13', '4.31.14', '4.31.22', '4.31.23', '4.31.24', '5.0.0', '5.1.0', '5.1.3', '5.2.0', '5.2.1', '5.2.2', '5.3.0']) {
    const old = filesAt('v' + from);
    let serveNew = false, offline = false;
    // Offline means the server cannot be reached at all: the browser's offline switch does not cover the app's update
    // worker on every runner (run 44940048900 attempt 2), so the server also drops every request while offline
    const server = http.createServer((req, res) => {
      if (offline) { req.socket.destroy(); return; }
      let key = new URL(req.url, 'http://local').pathname; if (key === '/') key = '/index.html';
      let body = null;
      if (serveNew) { const file = path.resolve('public', '.' + key); if (file.startsWith(path.resolve('public') + path.sep) && fs.existsSync(file)) body = fs.readFileSync(file); }
      else body = old.get(key) || null;
      if (!body) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(key)] || 'text/plain', 'Cache-Control': 'no-store' }); res.end(body);
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}`;
    const errors = [];
    const open = async ctx => { const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.on('pageerror', e => errors.push(e.message));
      await p.goto(url, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#kpi .card');
      await p.waitForFunction(() => document.getElementById('app-build').textContent !== 'v?'); return p; };   // the label is filled in when the app starts
    // The version label, once the app has started and filled it in (it reads "v?" until then)
    const build = async p => { for (let i = 0; ; i++) { try { await p.waitForFunction(() => document.getElementById('app-build')?.textContent !== 'v?'); return await p.locator('#app-build').textContent(); }
      catch (e) { if (i === 3 || !/context was destroyed|navigation/i.test(e.message)) throw e; await p.waitForLoadState('domcontentloaded'); } } };   // same as marker: a reload while opening
    // The records themselves, money included (independent release audit of #100): each event's name, bill and meals,
    // each client payment's amount, date and mode, each expense's amount, item, payment state and mode
    // Read again if the page reloads itself while opening (seen on GitHub's runner offline, run 44926720829)
    const marker = async p => { for (let i = 0; ; i++) { try { return await readRecords(p); } catch (e) {
      if (i === 3 || !/context was destroyed|navigation/i.test(e.message)) throw e; await p.waitForLoadState('domcontentloaded'); await p.waitForSelector('#kpi .card'); } } };
    const readRecords = p => p.evaluate(async () => { const db = await import('./db.js');
      const [events, cPays, expenses] = await Promise.all(['events', 'cPays', 'expenses'].map(s => db.getAll(s)));
      return JSON.stringify({
        events: events.map(e => [e.id, e.name, e.billing, e.guests, JSON.stringify(e.mealPlan || null)]).sort(),
        cPays: cPays.map(c => [c.id, c.evId, c.amt, c.date, c.mode]).sort(),
        expenses: expenses.map(x => [x.id, x.evId, x.amt, x.head, x.pay, x.mode || '']).sort() }); });
    const MONEY = JSON.stringify({ events: [['e1', 'Sample Update Wedding', 160000, 200, JSON.stringify({ dinner: { guests: 200, rate: 800 } })]],
      cPays: [['p1', 'e1', 35000, '2026-11-01', 'UPI']], expenses: [['x1', 'e1', 4200, 'Vegetables – भाजी', 'paid', 'UPI']] });
    // The running worker's release (the service worker answers GET_RELEASE)
    const swRelease = p => p.evaluate(() => navigator.serviceWorker.getRegistration().then(r => !r?.active ? null : new Promise(res => {
      const c = new MessageChannel(); const t = setTimeout(() => res(null), 500); c.port1.onmessage = e => { clearTimeout(t); res(e.data.release); }; r.active.postMessage({ type: 'GET_RELEASE' }, [c.port2]); })));
    // A new tab after the update: reopened until it runs the new release (a phone shows it on the next open at the latest)
    // A tab that does not open within 30 s right after the update (GitHub runs 44940048900 and 44957445158, never on a PC
    // or phone) is closed and opened again, at most twice, with a warning in the log; the version, records and page-error
    // checks still decide the result.
    const openNew = async ctx => { let slow = 0;
      for (let i = 0; ; i++) {
        let p; try { p = await open(ctx); } catch (e) {
          if (!/Timeout/.test(e.message) || slow === 2) throw e;
          slow++; console.log(`WARNING from ${from}: a new tab did not open within 30 s after the update; opening it again (${slow} of 2)`);
          for (const pg of ctx.pages().slice(1)) await pg.close().catch(() => {}); continue; }
        if (await build(p) === 'v' + NEW || i >= 4) return p; await p.close(); await new Promise(r => setTimeout(r, 1000)); } };
    const goOffline = async (ctx, v) => { offline = v; await ctx.setOffline(v); };
    const install = async ctx => {
      const p = await open(ctx);
      await p.evaluate(() => navigator.serviceWorker.ready); await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('#kpi .card');
      assert.equal(await build(p), 'v' + from, 'the old release is running');
      await p.evaluate(async () => { const db = await import('./db.js');
        await db.importAllData({ version: 'ffv2', cPays: [{ id: 'p1', evId: 'e1', amt: 35000, date: '2026-11-01', mode: 'UPI' }], vPays: [], photos: [], vendors: [],
          expenses: [{ id: 'x1', evId: 'e1', cat: 'Raw Material', head: 'Vegetables – भाजी', amt: 4200, date: '2026-11-02', pay: 'paid', mode: 'UPI', billIds: [] }],
          events: [{ id: 'e1', name: 'Sample Update Wedding', date: '2026-12-10', venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 160000, guests: 200, photoIds: [], meals: ['dinner'], mealPlan: { dinner: { guests: 200, rate: 800 } }, dishes: [] }] }, 'replace'); });
      await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('#kpi .card');
      return p;
    };

    await test(`from ${from}: Check for app updates brings ${NEW}; records and an unsaved form are kept; it then opens offline`, async () => {
      const ctx = await browser.newContext(); await ctx.route('https://fonts.**', r => r.abort());
      try {
      const p = await install(ctx);
      const before = await marker(p);
      assert.equal(before, MONEY, 'the installed release holds the exact bill, payment and expense');
      await p.locator('[data-action="quick"][data-id="event"]').click(); await p.locator('#ev-name').fill('Sample unsaved event');
      serveNew = true;
      await p.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      await p.waitForFunction(v => navigator.serviceWorker.getRegistration().then(r => !r?.active ? false : new Promise(res => {
        const c = new MessageChannel(); const t = setTimeout(() => res(false), 300); c.port1.onmessage = e => { clearTimeout(t); res(e.data.release === v); }; r.active.postMessage({ type: 'GET_RELEASE' }, [c.port2]); })), NEW, { polling: 500, timeout: 60000 });
      // The open form is not thrown away by the update
      assert.equal(await p.locator('#ev-name').inputValue(), 'Sample unsaved event');
      // A new tab gets the new release; the records are the same
      const fresh = await openNew(ctx);
      assert.equal(await build(fresh), 'v' + NEW);
      assert.equal(await swRelease(fresh), NEW);
      assert.equal(await marker(fresh), before, 'records kept');
      await fresh.locator('#drawer-toggle').click(); await fresh.locator('#check-app-update').click();
      await fresh.waitForFunction(v => document.querySelector('#app-update-status').textContent.includes('using CaterDesk v' + v), NEW);
      // Offline afterwards: the new release opens from the phone with the same records
      await goOffline(ctx, true);
      await fresh.reload({ waitUntil: 'domcontentloaded' }); await fresh.waitForSelector('#kpi .card');
      assert.equal(await build(fresh), 'v' + NEW, 'opens offline');
      assert.equal(await marker(fresh), before);
      } finally { await ctx.close(); serveNew = false; offline = false; }
    });

    await test(`from ${from}: an update published while the phone is offline: ${from} keeps working offline, and updates once back online`, async () => {
      const ctx = await browser.newContext(); await ctx.route('https://fonts.**', r => r.abort());
      try {
      const p = await install(ctx);
      const before = await marker(p);
      assert.equal(before, MONEY, 'the installed release holds the exact bill, payment and expense');
      await goOffline(ctx, true);
      serveNew = true;   // published only once the phone is offline (run 44928858429: the old order let the update in first)
      await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('#kpi .card');
      assert.equal(await build(p), 'v' + from, 'offline: the installed release opens');
      assert.equal(await marker(p), before);
      await goOffline(ctx, false);
      await p.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      await p.waitForFunction(v => navigator.serviceWorker.getRegistration().then(r => !r?.active ? false : new Promise(res => {
        const c = new MessageChannel(); const t = setTimeout(() => res(false), 300); c.port1.onmessage = e => { clearTimeout(t); res(e.data.release === v); }; r.active.postMessage({ type: 'GET_RELEASE' }, [c.port2]); })), NEW, { polling: 500, timeout: 60000 });
      const fresh = await openNew(ctx);
      assert.equal(await build(fresh), 'v' + NEW);
      assert.equal(await marker(fresh), before, 'records kept');
      } finally { await ctx.close(); serveNew = false; offline = false; }
    });

    await test(`from ${from}: no page errors`, async () => { assert.deepEqual(errors, []); });
    server.close();
  }

  await browser.close();
  console.log(failed ? 'update from 4.31.13 FAIL' : `update from 4.31.13 / 4.31.14 / 4.31.22 / 4.31.23 / 4.31.24 / 5.0.0 / 5.1.0 / 5.1.3 / 5.2.0 to ${NEW} PASS`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('update from 4.31.13 FAIL'); process.exitCode = 1; });
