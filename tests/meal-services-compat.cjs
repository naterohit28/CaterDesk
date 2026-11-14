// Old and new app versions editing the same event. The released 4.21.1 app (git 9066ae1) is served at /old/ and this
// version at /, on one origin, so both use the same IndexedDB database (schema 4). The old app cannot show services,
// a second lunch or dish details; this checks what it keeps, what this version notices, and that backups move both
// ways. Uses a fresh browser profile and synthetic data; never visits the live site.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const OLD_REF = '9066ae1';
process.chdir(path.resolve(__dirname, '..'));

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const EVENT = { id: 'e1', name: 'Sample Two Lunch Wedding', date: day(9), venue: 'Sample Lawns', type: 'Wedding – लग्न', billing: 400000, guests: 300, meals: ['lunch', 'dinner'], photoIds: [],
  mealPlan: { lunch: { guests: 250, rate: 450 }, dinner: { guests: 300, rate: 650 } },
  dishes: [{ name: 'Jeera Rice', head: '', meal: 'lunch' }, { name: 'Paneer Tikka', head: '', meal: 'dinner' }, { name: 'Mineral Water', head: '' }] };
const HISTORY = { id: 'e2', name: 'Sample Past Party', date: day(-40), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 60000, guests: 90, photoIds: [], meals: ['dinner'],
  mealPlan: { dinner: { guests: 90, rate: 600 } }, dishes: [{ name: 'Veg Pulao', head: '', meal: 'dinner' }] };

(async () => {
  const oldFiles = new Map();
  for (const f of execFileSync('git', ['ls-tree', '-r', '--name-only', OLD_REF, 'public'], { encoding: 'utf8' }).split('\n').filter(Boolean))
    oldFiles.set('/old/' + f.slice('public/'.length), execFileSync('git', ['show', `${OLD_REF}:${f}`], { maxBuffer: 2e7 }));
  const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    let key = new URL(req.url, 'http://local').pathname; if (key === '/' || key === '/old/') key += 'index.html';
    let body = null;
    if (key.startsWith('/old/')) body = oldFiles.get(key) || null;
    else { const file = path.resolve('public', '.' + key); if (file.startsWith(path.resolve('public') + path.sep) && fs.existsSync(file)) body = fs.readFileSync(file); }
    if (!body) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(key)] || 'text/plain', 'Cache-Control': 'no-store' }); res.end(body);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  // No service workers: each version's page must load its own files
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route('https://fonts.**', r => r.abort());
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const go = async where => { await p.goto(base + (where === 'old' ? '/old/' : '/')); await p.waitForSelector('#kpi .card'); };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const ev = async id => (await dump()).events.find(e => e.id === id);
  const U = (fn, arg) => p.evaluate(async ([src, a]) => { const u = await import('./utils.js'); return new Function('u', 'a', `return (${src})(u, a)`)(u, a); }, [fn.toString(), arg]);
  const openEvent = async (where, name) => { await go(where); await p.locator('#n-events:visible').click(); await p.locator('#ev-list [data-action="evdetail"]:visible', { hasText: name }).first().click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  const noRev = e => { const { _rev, ...x } = e; return x; };

  await go('new');
  const NEW_BUILD = 'v' + require('../package.json').version;
  assert.equal(await p.locator('#app-build').textContent(), NEW_BUILD, 'this version at /');
  // This version saves the event meal by meal: a second lunch the day after with its own dishes, a time, dish details
  await p.evaluate(async ([e, h]) => { const db = await import('./db.js'), u = await import('./utils.js');
    const s = u.eventServices(e).services;
    s[0].time = '12:30'; s[0].dishes[0] = { ...s[0].dishes[0], id: 'd1', cat: 'rice', type: 'veg', diet: ['jain'] };
    s.splice(1, 0, { id: 'svc-k2m9', meal: 'lunch', date: '2099-03-02', time: '13:00', guests: 120, rate: 400, template: null, dishes: [{ name: 'Veg Biryani', head: '' }, { name: 'Raita', head: '', cat: 'accompaniment' }] });
    await db.importAllData({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [], vendors: [], events: [{ ...e, ...u.applyServices(e, s) }, h] }); }, [EVENT, HISTORY]);
  const start = await ev('e1'), history = noRev(await ev('e2'));

  await test('the old app (4.21.1) opens the same database and shows the event, the second lunch\'s dishes under lunch', async () => {
    await openEvent('old', 'Sample Two Lunch Wedding');
    assert.equal(await p.locator('#app-build').textContent(), 'v4.21.1', 'the released old version at /old/');
    const chips = await p.locator('#menu-orders').innerText();
    for (const n of ['Jeera Rice', 'Veg Biryani', 'Raita', 'Paneer Tikka']) assert.match(chips, new RegExp(n));
  });

  await test('the old app edits the menu: services, the second lunch and dish details survive; the new dish lands in the right meal; the change is noticed', async () => {
    await p.locator('[data-action="menu-edit"]').first().click(); await p.waitForSelector('#menu-modal.active');
    await p.fill('#menu-text', (await p.inputValue('#menu-text')).replace('Dinner:\nPaneer Tikka', 'Dinner:\nPaneer Tikka\nGulab Jamun'));
    await p.waitForTimeout(500); await p.locator('#btn-save-menu').click(); await p.waitForTimeout(500);
    await go('new');
    const e = await ev('e1');
    assert.deepEqual(e.services, start.services, 'old app kept the services as they were');
    assert.deepEqual(e.dishes.find(d => d.name === 'Jeera Rice'), { name: 'Jeera Rice', head: '', meal: 'lunch', id: 'd1', cat: 'rice', type: 'veg', diet: ['jain'] }, 'dish details kept');
    assert.deepEqual(e.dishes.filter(d => d.svc).map(d => [d.name, d.svc]), [['Veg Biryani', 'svc-k2m9'], ['Raita', 'svc-k2m9']], 'second-lunch dishes still name their service');
    const view = await U((u, x) => u.eventServices(x), e);
    assert.equal(view.changedElsewhere, true, 'this version can say the menu was changed in an older version');
    assert.deepEqual(view.services.map(s => [s.id, s.dishes.filter(d => !d.shared).map(d => d.name).join('+')]),
      [['svc-lunch', 'Jeera Rice'], ['svc-k2m9', 'Veg Biryani+Raita'], ['svc-dinner', 'Paneer Tikka+Gulab Jamun']]);
  });

  await test('the old app edits the event form: meal price saved, services and times kept, the past event untouched', async () => {
    await openEvent('old', 'Sample Two Lunch Wedding'); await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active');
    if (await p.locator('#ev-mp').getAttribute('open') === null) await p.locator('#ev-mp summary').click();
    await p.fill('#ev-mp-dinner-g', '310');
    await p.locator('#btn-save-event').click(); await p.waitForTimeout(500);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
    await go('new');
    const e = await ev('e1');
    assert.equal(e.mealPlan.dinner.guests, 310); assert.deepEqual(e.services, start.services);
    const view = await U((u, x) => u.eventServices(x).services, e);
    assert.deepEqual(view.map(s => [s.id, s.guests, s.time || '', s.date || '']), [['svc-lunch', 250, '12:30', ''], ['svc-k2m9', 120, '13:00', '2099-03-02'], ['svc-dinner', 310, '', '']]);
    assert.deepEqual(noRev(await ev('e2')), history);
  });

  await test('saving again in this version notes the menu as current; nothing the old app saved is lost', async () => {
    await openEvent('new', 'Sample Two Lunch Wedding');
    await p.locator('[data-action="menu-edit"]').first().click(); await p.waitForSelector('#menu-modal.active');
    await p.locator('#btn-save-menu').click(); await p.waitForTimeout(500);
    const e = await ev('e1');
    assert.equal((await U((u, x) => u.eventServices(x).changedElsewhere, e)), false);
    assert.ok(e.dishes.some(d => d.name === 'Gulab Jamun' && d.meal === 'dinner')); assert.equal(e.mealPlan.dinner.guests, 310);
  });

  await test('backups move both ways: old app export keeps services and details; new app restores it; old app accepts a new backup; past event unchanged', async () => {
    await go('old');
    const fromOld = await p.evaluate(async () => { const d = await (await import('./db.js')).exportAllData(); delete d.manifest; return d; });
    const oldE = fromOld.events.find(e => e.id === 'e1');
    assert.ok(Array.isArray(oldE.services) && oldE.services.length === 3, 'old export carries services');
    await go('new');
    const before = noRev(await ev('e1'));
    await p.evaluate(async d => (await import('./db.js')).importAllData(d, 'replace'), fromOld);
    assert.deepEqual(noRev(await ev('e1')), before, 'restored in this version exactly');
    const fromNew = await p.evaluate(async () => { const d = await (await import('./db.js')).exportAllData(); delete d.manifest; return d; });
    await go('old');
    const r = await p.evaluate(async d => { try { await (await import('./db.js')).importAllData(d, 'replace'); return 'accepted'; } catch (e) { return e.message; } }, fromNew);
    assert.equal(r, 'accepted');
    const back = await p.evaluate(async () => (await (await import('./db.js')).exportAllData()).events);
    assert.deepEqual(noRev(back.find(e => e.id === 'e1')), before); assert.deepEqual(noRev(back.find(e => e.id === 'e2')), history);
    await go('new');
    assert.deepEqual(noRev(await ev('e2')), history, 'past event never given services');
    assert.equal((await ev('e2')).services, undefined);
  });

  await test('this version refuses a backup with a contradictory dish (Jain and non-veg)', async () => {
    const bad = await p.evaluate(async () => { const d = await (await import('./db.js')).exportAllData(); delete d.manifest; d.events.find(e => e.id === 'e1').dishes[0].diet = ['jain']; d.events.find(e => e.id === 'e1').dishes[0].type = 'nonveg'; return d; });
    const r = await p.evaluate(async d => { try { await (await import('./db.js')).importAllData(d, 'replace'); return 'accepted'; } catch (e) { return e.message.split('.')[0]; } }, bad);
    assert.equal(r, 'Invalid dish details');
  });

  assert.deepEqual(errors.filter(m => !/service ?worker/i.test(m)), []);
  await browser.close(); server.close();
  console.log(failed ? 'meal services old/new compatibility FAIL' : 'meal services old/new compatibility PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('meal services old/new compatibility FAIL'); process.exitCode = 1; });
