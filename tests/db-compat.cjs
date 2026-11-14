// Database compatibility: the app keeps database version 4 (an older app still open elsewhere can keep saving), and a
// database that v4.18.0 moved to version 5 still opens, with its menus moved into the settings store once. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');

  await test('a new database stays at version 4; menus are saved in the settings store and read back as menus', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js');
      await db.putOne('menus', { id: 'MN1', name: 'Sample Menu', slabs: [{ min: 1, rate: 500 }], items: ['Dal'] });
      const conn = await db.openDB();
      return { version: conn.version, stores: [...conn.objectStoreNames].sort(), menus: (await db.getAll('menus')).map(m => m.id), metaKey: !!(await db.getOne('meta', 'menu:MN1')), events: (await db.getAll('events')).length }; });
    assert.equal(r.version, 4); assert.equal(r.stores.includes('menus'), false);
    assert.deepEqual(r.menus, ['MN1']); assert.equal(r.metaKey, true);
  });

  await test('a version-5 database from v4.18.0 opens; its menus move into the settings store once; records are kept', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); db.resetDB();
      await new Promise((res, rej) => { const d = indexedDB.deleteDatabase('FlavorFusionDB'); d.onsuccess = res; d.onerror = rej; d.onblocked = res; });
      await new Promise((res, rej) => { const o = indexedDB.open('FlavorFusionDB', 5);
        o.onupgradeneeded = () => { const x = o.result; for (const n of ['events', 'expenses', 'vendors', 'cPays', 'vPays', 'photos', 'menus', 'meta']) x.createObjectStore(n, { keyPath: 'id' });
          const ph = o.transaction.objectStore('photos'); ph.createIndex('eventId', 'eventId'); ph.createIndex('expenseId', 'expenseId'); };
        o.onsuccess = () => { const x = o.result, tx = x.transaction(['events', 'menus', 'meta'], 'readwrite');
          tx.objectStore('events').put({ id: 'E', name: 'Sample Kept Event', date: '2026-12-01', venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 1000, photoIds: [], mealPlan: { dinner: { guests: 10, rate: 100, menu: 'MNold' } } });
          tx.objectStore('menus').put({ id: 'MNold', name: 'Sample Old Menu', meals: ['dinner'], slabs: [{ min: 1, rate: 100 }], items: ['Paneer'] });
          tx.objectStore('meta').put({ id: 'app_version', value: '4.18.0' });
          tx.oncomplete = () => { x.close(); res(); }; tx.onerror = rej; }; o.onerror = rej; }); });
    await p.reload(); await p.waitForSelector('#kpi .card');
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const conn = await db.openDB();
      const legacy = await new Promise(res => { const tx = conn.transaction('menus', 'readonly'); const q = tx.objectStore('menus').getAll(); q.onsuccess = () => res(q.result.length); });
      return { version: conn.version, menus: (await db.getAll('menus')).map(m => m.name), legacy, events: (await db.getAll('events')).map(e => e.name) }; });
    assert.deepEqual(r, { version: 5, menus: ['Sample Old Menu'], legacy: 0, events: ['Sample Kept Event'] });
    assert.equal(await p.evaluate(async () => (await import('./utils.js')).menuById('MNold')?.name), 'Sample Old Menu', 'the event still finds its menu');
    // and a backup of it carries the menu
    const b = await p.evaluate(async () => (await (await import('./db.js')).exportAllData()));
    assert.deepEqual(b.menus.map(m => m.id), ['MNold']); assert.equal(b.manifest.counts.menus, 1);
  });

  await test('replacing data from a backup removes only menus, never other settings', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); await db.setMeta('keep-this', 'yes');
      const d = await db.exportAllData(); d.menus = [{ id: 'MNnew', name: 'Sample New Menu', slabs: [{ min: 1, rate: 200 }], items: [] }]; delete d.manifest;
      await db.importAllData(d, 'replace'); return { menus: (await db.getAll('menus')).map(m => m.id), kept: await db.getMeta('keep-this') }; });
    assert.deepEqual(r, { menus: ['MNnew'], kept: 'yes' });
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'db compat FAIL' : 'database compatibility: version 4 kept, version 5 opens, menus moved once PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('db compat FAIL'); process.exitCode = 1; });
