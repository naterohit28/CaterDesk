// Old app caches are cleaned up: when a new release activates, release caches that no open tab uses are deleted
// (they used to pile up on the phone forever), the current one is kept, and saved records are untouched.
// Old tabs keeping their own release is covered by release-update.cjs. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(15000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };

  await test('stale release caches and closed-tab pins are removed when the new release activates; the current one stays', async () => {
    // Before the app (and its service worker) ever loads: two old release caches and a pin for a tab long closed
    await p.goto(BASE_URL + '/manifest.json');
    await p.evaluate(async () => {
      for (const k of ['flavor-fusion-v2-cache-v1', 'flavor-fusion-v2-cache-v40']) await (await caches.open(k)).put('/old.txt', new Response('old'));
      await (await caches.open('caterdesk-client-releases')).put(new Request(location.origin + '/__client_release__/gone-tab'), new Response('flavor-fusion-v2-cache-v40'));
      await (await caches.open('unrelated-cache')).put('/x.txt', new Response('x'));
    });
    await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
    await p.evaluate(async () => { const db = await import('./db.js'); await db.importAllData({ version: 'ffv2', photos: [], cPays: [], vPays: [], vendors: [], expenses: [],
      events: [{ id: 'e', name: 'Sample Kept Event', date: '2026-12-01', venue: 'Sample Hall', type: 'Party – पार्टी', billing: 1000, guests: 10, photoIds: [] }] }); });
    await p.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated');
    const current = await p.evaluate(async () => (await (await fetch('./sw.js')).text()).match(/CACHE_NAME = '([^']+)'/)[1]);
    // v1 is used by no tab, so it must go. v40 is the newest old release: the first install may pin this very test page
    // to it (an open tab keeps its release), so it may stay only while an open tab's pin points at it (Codex on #82).
    await p.waitForFunction(async c => { const k = await caches.keys(); return k.includes(c) && !k.includes('flavor-fusion-v2-cache-v1'); }, current);
    const keys = await p.evaluate(() => caches.keys());
    assert.ok(keys.includes(current), 'the current release cache stays');
    const pinned = await p.evaluate(async () => { const pins = await caches.open('caterdesk-client-releases');
      return Promise.all((await pins.keys()).map(async r => (await pins.match(r)).text())); });
    for (const k of keys.filter(k => /^flavor-fusion-v2-cache-v\d+$/.test(k) && k !== current))
      assert.ok(pinned.includes(k), `${k} is kept only because an open tab still uses it`);
    assert.ok(keys.includes('unrelated-cache'), 'caches that are not app releases are left alone');
    const pins = await p.evaluate(async () => (await (await caches.open('caterdesk-client-releases')).keys()).map(r => r.url));
    assert.ok(!pins.some(u => u.endsWith('/gone-tab')), 'the closed tab’s pin is removed');
    await p.reload(); await p.waitForSelector('#kpi .card');
    assert.equal(await p.evaluate(async () => (await (await import('./db.js')).exportAllData()).events.length), 1, 'saved records untouched');
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})();
