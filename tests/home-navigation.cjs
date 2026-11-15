// Tapping Home always lands on Home, also on a slow phone where closing a sheet's Back arrives late (after the app's
// 600 ms wait) and when the remembered history depth has drifted; Home is what the app remembers as the last screen.
// Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = []; let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const open = async ({ slowBackMs = 0 } = {}) => {
    const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
    // A slow phone: the browser's Back (used to close a sheet) takes effect late. History steps still happen in the
    // order they were asked for, as in a real browser: a later step waits for the slow one.
    if (slowBackMs) await ctx.addInitScript(ms => {
      const back = history.back.bind(history), go = history.go.bind(history); let chain = Promise.resolve();
      history.back = () => { chain = chain.then(() => new Promise(r => setTimeout(() => { back(); setTimeout(r, 50); }, ms))); };
      history.go = n => { chain = chain.then(() => new Promise(r => { go(n); setTimeout(r, 50); })); };
    }, slowBackMs);
    const p = await ctx.newPage(); p.setDefaultTimeout(10000); p.on('pageerror', e => errors.push(e.message));
    await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
    await p.evaluate(async () => { const db = await import('./db.js'); await db.importAllData({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [], vendors: [],
      events: [{ id: 'e1', name: 'Sample Nav Event', date: '2099-01-10', venue: 'Sample Hall', type: 'Party – पार्टी', billing: 1000, guests: 10, photoIds: [] }] }); });
    await p.reload(); await p.waitForSelector('#kpi .card');
    return { ctx, p };
  };
  const state = p => p.evaluate(() => ({ tab: document.querySelector('.tab.active')?.id, last: JSON.parse(localStorage.getItem('ffv2_last') || 'null')?.tab, hist: history.state }));

  await test('slow phone: close a sheet on Events, tap Home before the late Back arrives: Home stays, and is remembered', async () => {
    const { ctx, p } = await open({ slowBackMs: 900 });
    await p.locator('#n-events:visible').click(); await p.waitForSelector('#tab-events.active');
    await p.locator('#fab').click(); await p.waitForSelector('#ev-modal.active');
    await p.locator('#ev-modal [data-action="close-modal"]').click();
    await p.waitForTimeout(650);   // past the app's 600 ms wait, before the slow Back lands
    await p.locator('#n-home').click();
    await p.waitForTimeout(1500);  // let the late Back arrive
    const s = await state(p);
    assert.equal(s.tab, 'tab-home', 'still on Home after the late Back'); assert.equal(s.last, 'home', 'Home remembered as the last screen');
    // and the app keeps working: Events, an event, Home again
    await p.locator('#n-events:visible').click(); await p.locator('#ev-list [data-action="evdetail"]:visible').first().click(); await p.waitForSelector('#tab-evdetail.active');
    await p.locator('#n-home').click(); await p.waitForTimeout(1500);
    assert.equal((await state(p)).tab, 'tab-home');
    await ctx.close();
  });

  await test('slow phone: open and close several sheets, then Home from an event page lands on Home', async () => {
    const { ctx, p } = await open({ slowBackMs: 900 });
    await p.locator('#n-events:visible').click(); await p.locator('#ev-list [data-action="evdetail"]:visible').first().click(); await p.waitForSelector('#tab-evdetail.active');
    for (let i = 0; i < 3; i++) { await p.locator('#drawer-toggle').click(); await p.waitForSelector('#drawer.active'); await p.locator('#drawer-bg').click({ position: { x: 5, y: 5 } }); await p.waitForTimeout(700); }
    await p.waitForTimeout(1200);
    await p.locator('#n-home').click(); await p.waitForTimeout(2000);
    const s = await state(p);
    assert.equal(s.tab, 'tab-home'); assert.equal(s.last, 'home');
    await ctx.close();
  });

  await test('a drifted history depth (more than the real entries) still lands on Home', async () => {
    const { ctx, p } = await open();
    await p.locator('#n-events:visible').click(); await p.waitForSelector('#tab-events.active');
    await p.evaluate(() => history.replaceState({ ...history.state, depth: 7 }, ''));
    await p.locator('#n-home').click(); await p.waitForTimeout(1200);
    const s = await state(p);
    assert.equal(s.tab, 'tab-home'); assert.equal(s.last, 'home'); assert.equal(s.hist?.depth || 0, 0, 'history marked as the root again');
    await ctx.close();
  });

  await test('normal phone: Events → event → sheet → Home lands on Home; Back from an event still returns to Events', async () => {
    const { ctx, p } = await open();
    await p.locator('#n-events:visible').click(); await p.locator('#ev-list [data-action="evdetail"]:visible').first().click(); await p.waitForSelector('#tab-evdetail.active');
    await p.goBack(); await p.waitForTimeout(400); assert.equal((await state(p)).tab, 'tab-events', 'Back still goes to the previous page');
    await p.locator('#ev-list [data-action="evdetail"]:visible').first().click(); await p.waitForSelector('#tab-evdetail.active');
    await p.locator('#drawer-toggle').click(); await p.waitForSelector('#drawer.active'); await p.locator('#drawer-bg').click({ position: { x: 5, y: 5 } }); await p.waitForTimeout(300);
    await p.locator('#n-home').click(); await p.waitForTimeout(800);
    const s = await state(p);
    assert.equal(s.tab, 'tab-home'); assert.equal(s.hist?.depth || 0, 0); assert.equal(s.last, 'home');
    await ctx.close();
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'home navigation FAIL' : 'home navigation PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('home navigation FAIL'); process.exitCode = 1; });
