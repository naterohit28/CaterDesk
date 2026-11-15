// Opening the app starts on Home. The installed app goes back to the last screen only when reopened within 10 minutes
// (Android closed it in the background); a browser tab always starts on Home. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = []; let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  // installed: the page reports display-mode standalone, as the app added to the home screen does
  const open = async installed => {
    const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
    if (installed) await ctx.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = q => /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); });
    const p = await ctx.newPage(); p.setDefaultTimeout(10000); p.on('pageerror', e => errors.push(e.message));
    await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
    await p.evaluate(async () => { const db = await import('./db.js'); await db.importAllData({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [], vendors: [],
      events: [{ id: 'e1', name: 'Sample Start Event', date: '2099-01-10', venue: 'Sample Hall', type: 'Party – पार्टी', billing: 1000, guests: 10, photoIds: [] }] }); });
    return { ctx, p };
  };
  // Leave the app on a screen some minutes ago, then reopen it
  const reopen = async (p, last, minutesAgo) => {
    await p.evaluate(([l, m]) => localStorage.setItem('ffv2_last', JSON.stringify({ ...l, at: Date.now() - m * 60e3 })), [last, minutesAgo]);
    await p.reload(); await p.waitForSelector('#kpi .card', { state: 'attached' }); await p.waitForTimeout(400);   // loaded, whichever screen shows
    return p.evaluate(() => document.querySelector('.tab.active')?.id);
  };

  await test('installed app reopened after 30 minutes (or the next day) starts on Home, not the last tab', async () => {
    const { ctx, p } = await open(true);
    assert.equal(await reopen(p, { tab: 'events', ref: null }, 30), 'tab-home');
    assert.equal(await reopen(p, { tab: 'events', ref: null }, 60 * 9), 'tab-home');
    await ctx.close();
  });

  await test('installed app reopened within a few minutes (closed in the background) goes back to where you were', async () => {
    const { ctx, p } = await open(true);
    assert.equal(await reopen(p, { tab: 'events', ref: null }, 2), 'tab-events');
    assert.equal(await reopen(p, { tab: 'evdetail', ref: 'e1' }, 3), 'tab-evdetail');
    assert.match(await p.locator('#tab-evdetail .detail-name').innerText(), /Sample Start Event/);
    assert.equal(await reopen(p, { tab: 'evdetail', ref: 'gone' }, 1), 'tab-home', 'a deleted event: Home');
    await ctx.close();
  });

  await test('in a browser tab a reload always starts on Home', async () => {
    const { ctx, p } = await open(false);
    assert.equal(await reopen(p, { tab: 'events', ref: null }, 1), 'tab-home');
    await ctx.close();
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'start screen FAIL' : 'start screen PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('start screen FAIL'); process.exitCode = 1; });
