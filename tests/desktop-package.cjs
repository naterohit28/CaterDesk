// Windows desktop package: desktop/build.ps1 copies an explicit file list into app/. Every file the app imports,
// index.html loads and the service worker precaches must be on that list, or the packaged app cannot start or
// install for offline use. This builds the app/ folder from that same list (without compiling or launching the
// .exe, which would open Edge with the owner's desktop profile) and starts it in a fresh browser. Synthetic only.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');

const read = f => fs.readFileSync(f, 'utf8');
const copied = (read('desktop/build.ps1').match(/foreach \(\$file in @\(([^)]*)\)\)/) || [])[1]?.match(/'[^']+'/g)?.map(s => s.slice(1, -1)) || [];
const icons = fs.readdirSync('public/icons').filter(f => f.endsWith('.png')).map(f => 'icons/' + f);   // build.ps1 copies icons\*.png
const packaged = new Set([...copied, ...icons]);

(async () => {
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };

  await test('desktop build copies every module the app imports, every file index.html loads and every file the service worker precaches', async () => {
    assert.ok(copied.length > 5, 'copy list found in desktop/build.ps1');
    const imports = new Set(), walk = f => { if (imports.has(f)) return; imports.add(f);
      for (const [, dep] of read(path.join('public', f)).matchAll(/(?:^|\n)\s*import\s[^'"]*['"]\.\/([\w.-]+\.js)['"]/g)) walk(dep); };
    walk('app.js');
    assert.ok(imports.has('backup-crypto.js'), 'the encrypted backup module is imported');
    const html = [...read('public/index.html').matchAll(/(?:src|href)="([^"#:]+)"/g)].map(m => m[1]);
    const precache = JSON.parse(read('public/sw.js').match(/const PRECACHE = (\[[^\]]*\])/)[1].replace(/'/g, '"')).map(u => u.replace(/^\.\//, '')).filter(Boolean);
    const missing = [...new Set(['index.html', ...imports, ...html, ...precache])].filter(f => !packaged.has(f));
    assert.deepEqual(missing, [], 'missing from desktop/build.ps1');
  });

  await test('a package built from that list starts, loads every script and completes its offline cache', async () => {
    const dir = path.resolve('test-artifacts', 'desktop-app');
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, 'icons'), { recursive: true });
    for (const f of packaged) fs.copyFileSync(path.join('public', f), path.join(dir, f));
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' };
    const notFound = [];
    const server = http.createServer((req, res) => {
      const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, '') || 'index.html';
      const file = path.resolve(dir, name);
      if (!file.startsWith(dir + path.sep) || !fs.existsSync(file)) { notFound.push(name); res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(fs.readFileSync(file));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
      const page = await (await browser.newContext()).newPage(); page.setDefaultTimeout(30000);
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(url); await page.waitForSelector('#kpi .card');
      const cache = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        const src = await (await fetch(reg.active.scriptURL)).text();
        const name = src.match(/const CACHE_NAME = '([^']+)'/)[1], list = JSON.parse(src.match(/const PRECACHE = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
        const c = await caches.open(name), missing = [];
        for (const u of list) if (!await c.match(new URL(u, location.href).href)) missing.push(u);
        return { active: reg.active.state, missing };
      });
      assert.deepEqual(cache, { active: 'activated', missing: [] }, 'service worker installed with every file cached');
      assert.deepEqual(notFound, [], 'no file the app asked for is missing from the package');
      assert.deepEqual(errors, []);
    } finally { await browser.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  console.log(failed ? 'desktop package FAIL' : 'desktop package PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('desktop package FAIL'); process.exitCode = 1; });
