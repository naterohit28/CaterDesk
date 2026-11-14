// Menu library: your own menus (starter menus, your edits, new ones), which meals they suit, price slabs and dishes;
// a menu per meal on events; dishes in quotes; menus kept in backups (older backups still verify). Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DATA = { version: 'ffv2', photos: [], vendors: [], vPays: [], cPays: [], expenses: [],
  events: [{ id: 'W', name: 'Sample Wedding', date: day(20), venue: 'Sample Lawn', type: 'Wedding – लग्न', billing: 0, guests: 400, photoIds: [], mobile: '9000000005' }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const openMenus = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#drawer-toggle').click(); await p.locator('#open-menus').click();
    await p.waitForSelector('#menus-modal.active'); await p.waitForTimeout(700); assert.equal(await p.locator('#menus-modal.active').count(), 1, 'Menus stays open after the drawer closes'); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);

  await test('Menus (from ☰) lists the starter menus with their dishes and lowest price per plate', async () => {
    await openMenus();
    const t = await p.locator('#menus-body').innerText();
    assert.match(t, /Golden\s*11 dishes\s*₹900 \(101\+\) · ₹800 \(301\+\)\s*from ₹800\s*per plate/);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });

  await test('a new menu: name, meals it suits, two price slabs, dishes; saved and backed up', async () => {
    await p.locator('#btn-menu-new').click(); await p.waitForSelector('#menu-edit-modal.active');
    await p.locator('#btn-me-save').click(); await p.waitForTimeout(300);
    assert.equal((await dump()).menus.length, 0, 'refused without a name and price');
    await p.fill('#me-name', 'Sample Breakfast Deluxe');
    await p.locator('#me-meals [data-me-meal="breakfast"]').click(); await p.locator('#me-meals [data-me-meal="hightea"]').click();
    await p.locator('#me-slabs [data-ms="0"] [data-k="min"]').fill('50'); await p.locator('#me-slabs [data-ms="0"] [data-k="rate"]').fill('300');
    await p.locator('#btn-me-slab').click(); await p.locator('#me-slabs [data-ms="1"] [data-k="min"]').fill('300'); await p.locator('#me-slabs [data-ms="1"] [data-k="rate"]').fill('260');
    await p.fill('#me-items', 'Poha\nUpma\n  \nMasala Tea');
    await p.locator('#btn-me-save').click(); await p.waitForSelector('#menus-modal.active');
    const m = (await dump()).menus.find(x => x.name === 'Sample Breakfast Deluxe');
    assert.deepEqual([m.meals, m.slabs, m.items], [['breakfast', 'hightea'], [{ min: 50, rate: 300 }, { min: 300, rate: 260 }], ['Poha', 'Upma', 'Masala Tea']]);
    // the same name twice is refused
    await p.locator('#btn-menu-new').click(); await p.fill('#me-name', 'sample breakfast deluxe'); await p.locator('#me-slabs [data-ms="0"] [data-k="rate"]').fill('1');
    await p.locator('#btn-me-save').click(); await p.waitForTimeout(300);
    assert.equal((await dump()).menus.length, 1);
    await p.locator('#menu-edit-modal [data-action="close-modal"]').click();
  });

  await test('editing a starter menu keeps its id (events keep working); "back to the starter menu" undoes it; hiding keeps it for old events', async () => {
    await openMenus(); await p.locator('#menus-body [data-menu-edit="golden"]').click(); await p.waitForSelector('#menu-edit-modal.active');
    await p.locator('#me-slabs [data-ms="0"] [data-k="rate"]').fill('950'); await p.locator('#btn-me-save').click(); await p.waitForSelector('#menus-modal.active');
    let g = (await dump()).menus.find(x => x.id === 'golden'); assert.equal(g.slabs[0].rate, 950);
    assert.equal(await p.evaluate(async () => (await import('./utils.js')).menuById('golden').slabs[0].rate), 950);
    await p.locator('#menus-body [data-menu-edit="golden"]').click(); await p.waitForSelector('#menu-edit-modal.active');
    await p.locator('#btn-me-reset').click(); await p.waitForSelector('#ask-modal.active'); await p.locator('#ask-actions button').first().click(); await p.waitForTimeout(500);
    assert.equal((await dump()).menus.some(x => x.id === 'golden'), false); assert.equal(await p.evaluate(async () => (await import('./utils.js')).menuById('golden').slabs[0].rate), 900);
    await openMenus(); await p.locator('#menus-body [data-menu-edit="standard"]').click(); await p.waitForSelector('#menu-edit-modal.active');
    await p.locator('#btn-me-hide').click(); await p.waitForSelector('#menus-modal.active');
    assert.match(await p.locator('#menus-body').innerText(), /Hidden[\s\S]*Standard/);
    const r = await p.evaluate(async () => { const u = await import('./utils.js'); return [u.allMenus().some(m => m.id === 'standard'), !!u.menuById('standard')]; });
    assert.deepEqual(r, [false, true], 'out of pickers, still resolves for events');
  });

  await test('event form: each meal picks from menus suited to it first; the rate fills from the slab; one menu picker, not two', async () => {
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="W"]:visible').click(); await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active');
    assert.equal(await p.locator('#ev-menu').isVisible(), true, 'no meals ticked: the event menu picker is there');
    await p.locator('#ev-meals [data-meal="breakfast"]').click(); await p.locator('#ev-meals [data-meal="dinner"]').click();
    assert.equal(await p.locator('#ev-menu').isVisible(), false, 'with meals, each meal has its own menu');
    await p.locator('#ev-mp summary').click().catch(() => {});
    const groups = await p.locator('#ev-mp-breakfast-m optgroup').evaluateAll(gs => gs.map(g => [g.label, [...g.children].map(o => o.textContent)]));
    assert.deepEqual(groups[0], ['For Breakfast', ['Sample Breakfast Deluxe']]);
    assert.equal(groups.flatMap(g => g[1]).includes('Standard'), false, 'hidden menus are not offered');
    await p.fill('#ev-mp-breakfast-g', '350'); await p.selectOption('#ev-mp-breakfast-m', { label: 'Sample Breakfast Deluxe' });
    assert.equal(await p.inputValue('#ev-mp-breakfast-r'), '260', '350 guests: the 300+ price');
    await p.fill('#ev-mp-dinner-g', '400'); await p.selectOption('#ev-mp-dinner-m', 'golden');
    await p.locator('#btn-save-event').click(); await p.waitForTimeout(500);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
    const e = (await dump()).events.find(x => x.id === 'W');
    assert.equal(e.mealPlan.breakfast.menu.startsWith('MN'), true); assert.equal(e.mealPlan.dinner.menu, 'golden');
    assert.equal(e.menu, 'golden', 'the main menu (for costing) is the biggest meal\'s');
  });

  await test('event page folds each meal\'s dishes; a quote can list them for the client', async () => {
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="W"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    assert.match(await p.locator('[data-meal-menu="breakfast"] summary').innerText(), /Breakfast · Sample Breakfast Deluxe menu · 3 dishes/);
    assert.match(await p.locator('[data-meal-menu="dinner"] summary').innerText(), /Dinner · Golden menu · 11 dishes/);
    await p.locator('[data-action="quote-open"]').click(); await p.waitForSelector('#quote-modal.active');
    await p.locator('#quote-items').check(); await p.evaluate(() => { window.open = () => null; });
    await p.locator('[data-action="quote-share"]').click(); await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-msg').innerText(), /Breakfast \(Sample Breakfast Deluxe menu\): 350 guests × ₹260 = ₹91,000\n\s*• Poha\n\s*• Upma\n\s*• Masala Tea/);
  });

  await test('backups: menus are included and restore exactly; a backup made before menus still verifies; bad menus are refused', async () => {
    const strip = rows => rows.map(({ _rev, ...x }) => x).sort((a, b) => a.id.localeCompare(b.id));
    const before = await dump(); assert.equal(before.manifest.counts.menus, before.menus.length); assert.equal(before.manifest.formatVersion, 2);
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData();
      const info = await db.inspectBackup(JSON.parse(JSON.stringify(d)));
      await db.importAllData(JSON.parse(JSON.stringify(d)), 'replace');
      // an old-format backup: no menus, manifest over the six original stores
      const { menus, manifest, ...old } = d; const enc = new TextEncoder().encode(JSON.stringify(['events', 'expenses', 'vendors', 'cPays', 'vPays', 'photos'].map(n => old[n] || [])));
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc))].map(b => b.toString(16).padStart(2, '0')).join('');
      const oldB = { ...old, manifest: { format: 'caterdesk-backup', formatVersion: 1, counts: Object.fromEntries(['events', 'expenses', 'vendors', 'cPays', 'vPays', 'photos'].map(n => [n, (old[n] || []).length])), sha256: sha } };
      const oldInfo = await db.inspectBackup(oldB);
      const out = [];
      for (const f of [x => { x.menus[0].slabs = []; }, x => { x.menus[0].meals = ['supper']; }, x => { x.menus[0].name = ''; }]) {
        const c = await db.exportAllData(); delete c.manifest; f(c); try { await db.importAllData(c, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message.split(':')[0]); } }
      return { verified: info.verified, oldVerified: oldInfo.verified, out }; });
    assert.deepEqual(r, { verified: true, oldVerified: true, out: ['Invalid menu', 'Invalid meals', 'Invalid menu'] });
    assert.deepEqual(strip((await dump()).menus), strip(before.menus));
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'menu library FAIL' : 'menu library: your menus, menu per meal, dishes in quotes, backups PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('menu library FAIL'); process.exitCode = 1; });
