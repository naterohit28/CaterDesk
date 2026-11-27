// 5.4.2 (owner, 27 Nov 2026): "What's new" in the menu (☰): recent updates in plain words, newest first, the running
// version marked. After an update the app says so once ("Updated to …") with a button to the list; a first install
// with no records is not told. Synthetic sample data only.
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
  const build = () => p.evaluate(async () => (await import('./db.js')).APP_VERSION);
  const toast = async () => { await p.waitForTimeout(1800); return (await p.locator('#toast.show, #toast.active, #toast:not([hidden])').count()) ? (await p.locator('#toast-msg').innerText()).trim() : ''; };
  const reload = async () => { await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' }); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });
  const v = await build();

  await test('a first install with no records is not told about an update', async () => {
    assert.ok(!(await toast()).startsWith('Updated to'));
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('ffv2_seen_build'))), v);
  });

  await test('after an update the app says so once, with a button to the list', async () => {
    await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); localStorage.setItem('ffv2_seen_build', JSON.stringify('5.4.1')); }, DATA);
    await reload();
    assert.match(await toast(), new RegExp(`^Updated to ${v.replace(/\./g, '\\.')}`));
    assert.match(await p.locator('#toast-action').innerText(), /See what's new/);
    await p.locator('#toast-action').click(); await p.waitForSelector('#whatsnew-modal.active');
    await p.locator('#whatsnew-modal [data-action="close-modal"]').click(); await p.waitForTimeout(300);
    await reload();
    assert.ok(!(await toast()).startsWith('Updated to'), 'only once');
  });

  await test('someone who used the app before this list existed is told too', async () => {
    await p.evaluate(() => localStorage.removeItem('ffv2_seen_build')); await reload();
    assert.match(await toast(), /^Updated to/);
  });

  await test("What's new in the menu lists recent updates, newest first, the running version marked", async () => {
    await p.locator('#drawer-toggle').click(); await p.locator('#open-whatsnew').click(); await p.waitForSelector('#whatsnew-modal.active');
    const rows = await p.locator('#whatsnew-list .whatsnew-row').allInnerTexts();
    assert.ok(rows.length >= 10);
    assert.match(rows[0], new RegExp(`Version ${v.replace(/\./g, '\\.')}\\s*This version`));
    assert.match(rows.find(r => /Version 5\.4\.1/.test(r)), /Cooking labour .* by order/);
    assert.ok(!rows.join(' ').includes('<'), 'no markup shown as text');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'fits the phone width');
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'whats-new FAIL' : "what's new list and one-time update note PASS");
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('whats-new FAIL'); process.exit(1); });
