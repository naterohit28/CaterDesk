// Menu names are text: a library menu name that looks like HTML is shown exactly as typed on the event page, in English,
// Marathi and both, and never becomes page markup. Before 4.31.8 five places put the name in unescaped: the meal card's
// "From … menu" and "Started from … menu" lines, the older single-menu summary, the past-events basis and "Cost vs
// usual". Found by the independent audit of 19 Nov (finding 1). 360px. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const NAME = 'Sample <b class="x-leak">Gold</b> Menu';
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [], vendors: [],
  menus: [{ id: 'MNx', name: NAME, meals: ['dinner'], slabs: [{ min: 0, rate: 650 }], items: ['Paneer Tikka', 'Dal Makhani'] }],
  events: [
    { id: 'A', name: 'Sample Meal Menu Event', date: day(9), venue: 'Sample Lawns', type: 'Wedding – लग्न', billing: 200000, guests: 300, meals: ['dinner'], photoIds: [],
      mealPlan: { dinner: { guests: 300, rate: 650, menu: 'MNx' } }, dishes: [] },
    { id: 'B', name: 'Sample Older Menu Event', date: day(10), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 50000, guests: 80, photoIds: [],
      menu: 'MNx', dishes: [] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  const open = async (id, lang) => {
    await p.evaluate(l => localStorage.setItem('ffv2_lang', l), lang);
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator(`#ev-list [data-action="evdetail"][data-id="${id}"]:visible`).click(); await p.waitForSelector('#tab-evdetail .detail-name');
  };

  for (const lang of ['en', 'mr', 'both']) {
    await test(`${lang}: a menu name with HTML in it is shown as typed and adds no markup`, async () => {
      await open('A', lang);
      assert.equal(await p.locator('.x-leak').count(), 0, 'the name must not become an element');
      const html = await p.locator('#tab-evdetail').innerHTML();
      assert.ok(html.includes('Sample &lt;b class="x-leak"&gt;Gold&lt;/b&gt; Menu'), 'the name is in the page as escaped text');
      await open('B', lang);
      assert.equal(await p.locator('.x-leak').count(), 0, 'older single-menu summary: no element either');
      assert.ok((await p.locator('#tab-evdetail').innerHTML()).includes('&lt;b class="x-leak"&gt;'));
    });
  }

  await test('English shows the name on the meal card exactly as typed', async () => {
    await open('A', 'en');
    assert.match(await p.locator('#tab-evdetail').innerText(), /From Sample <b class="x-leak">Gold<\/b> Menu menu/);
  });

  await test('no source line puts a menu name into the page unescaped', async () => {
    const src = await p.evaluate(async () => (await fetch('./app.js')).text());
    // Page text built with tr() (HTML); toasts, hints and WhatsApp text set plain text and are fine
    assert.doesNotMatch(src, /tr\(`[^`]*\$\{(s\.template\.name|menu\.name)\}/);
    assert.doesNotMatch(src, /`on the \$\{menuById\(ev\.menu\)\?\.name/);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})();
