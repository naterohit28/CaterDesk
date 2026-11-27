// 5.4.2 (owner's requirements): "What's new" in the menu (☰): the current version with its release date and a plain
// explanation, then earlier versions folded under an expandable history, in English and Marathi, bundled in the app.
// No popup after updates: only a notable update shows a small Home card once, which can be dismissed. A first install
// with no records sees nothing. Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [], vendors: [],
  events: [{ id: 'E', name: 'Sample Function', date: '2026-12-01', venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 50000, guests: 80, photoIds: [] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const reload = async () => { await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' }); await p.waitForTimeout(600); };
  const card = () => p.locator('#whatsnew-intro').count();
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' }); await p.waitForTimeout(600);
  const v = await p.evaluate(async () => (await import('./db.js')).APP_VERSION);

  await test('a first install with no records sees no card and no popup', async () => {
    assert.equal(await card(), 0);
    assert.ok(!/Updated to/.test(await p.locator('#toast-msg').innerText().catch(() => '')));
  });

  await test('after a notable update: a small Home card, no popup; See what\'s new opens the list and the card goes for good', async () => {
    await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); localStorage.setItem('ffv2_seen_build', JSON.stringify('5.4.1')); localStorage.removeItem('ffv2_intro_seen'); }, DATA);
    await reload();
    assert.equal(await card(), 1); assert.match(await p.locator('#whatsnew-intro').innerText(), new RegExp(`New in ${v.replace(/\./g, '\\.')}`));
    assert.ok(!/Updated to/.test(await p.locator('#toast-msg').innerText().catch(() => '')), 'no toast');
    await p.locator('[data-action="whatsnew-open"]').click(); await p.waitForSelector('#whatsnew-modal.active');
    assert.equal(await card(), 0);
    await p.locator('#whatsnew-modal [data-action="close-modal"]').click(); await reload();
    assert.equal(await card(), 0, 'not shown again');
  });

  await test('the card can be dismissed', async () => {
    await p.evaluate(() => localStorage.removeItem('ffv2_intro_seen')); await reload();
    assert.equal(await card(), 1);
    await p.locator('[data-action="whatsnew-dismiss"]').click(); assert.equal(await card(), 0);
    await reload(); assert.equal(await card(), 0);
  });

  await test("What's new: current version and release date, earlier versions folded away, English and Marathi", async () => {
    await p.locator('#drawer-toggle').click(); await p.locator('#open-whatsnew').click(); await p.waitForSelector('#whatsnew-modal.active');
    assert.match(await p.locator('#whatsnew-current').innerText(), new RegExp(`Current version\\s*${v.replace(/\./g, '\\.')}`));
    const cur = await p.locator('#whatsnew-list').innerText();
    assert.match(cur, new RegExp(`Version ${v.replace(/\./g, '\\.')}\\s*This version[\\s\\S]*Released \\d`));
    assert.equal(await p.locator('#whatsnew-history').getAttribute('open'), null, 'history folded');
    await p.locator('#whatsnew-history summary').click();
    const hist = await p.locator('#whatsnew-history').innerText();
    assert.match(hist, /Earlier versions \(\d+\)/); assert.match(hist, /Version 5\.4\.1[\s\S]*Cooking labour/); assert.match(hist, /Version 5\.2\.0/);
    const html = await p.locator('#whatsnew-body').innerHTML(); assert.match(html, /class="t-mr"/, 'Marathi text present');
    assert.ok(!(await p.locator('#whatsnew-body').innerText()).includes('<'), 'no markup shown as text');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'whats-new FAIL' : "what's new with release dates, history and a dismissible card PASS");
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('whats-new FAIL'); process.exit(1); });
