// Owner's phone test (4.31.18): an event first saved for 10 guests, then given dinner for 300 at ₹2,25,000, showed
// "Bill/plate · 10 — ₹22,500". Once meals are chosen the form asks each meal's guests and the event's own number is
// no longer shown, so it kept the old 10. Per-plate figures now use the meals' own guests when set (the largest
// meal: people, not plates added up), and the event's number otherwise. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  const metric = label => p.locator('#tab-evdetail .metric', { hasText: label }).first().innerText();

  await test('the phone steps: saved for 10 guests, then dinner for 300 at ₹2,25,000 → Bill/plate · 300 is ₹750, not ₹22,500', async () => {
    await p.locator('#n-events:visible').click(); await p.locator('#fab').click(); await p.waitForSelector('#ev-modal.active');
    await p.fill('#ev-name', 'Sample Plate Event'); await p.fill('#ev-date', day(7)); await p.fill('#ev-venue', 'Sample Home');
    await p.fill('#ev-guests', '10'); await p.fill('#ev-billing', '7500');
    await p.locator('#btn-save-event').click(); await p.waitForTimeout(700);
    if (!(await p.locator('#tab-evdetail .detail-name').isVisible())) {
      await p.locator('#n-events:visible').click();
      await p.locator('#ev-list [data-action="evdetail"]:visible', { hasText: 'Sample Plate Event' }).first().click();
      await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(300);
    }
    assert.match(await metric('Bill/plate'), /Bill\/plate · 10\s*₹750/);
    await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active');
    await p.locator('#ev-meals [data-meal="dinner"]').click();
    if (!(await p.locator('#ev-mp-dinner-g').isVisible())) await p.locator('#ev-mp summary').click();
    await p.fill('#ev-mp-dinner-g', '300');
    await p.fill('#ev-billing', '225000');
    await p.locator('#btn-save-event').click(); await p.waitForTimeout(700);
    const ev = (await p.evaluate(async () => (await import('./db.js')).exportAllData())).events.find(e => e.name === 'Sample Plate Event');
    assert.equal(ev.mealPlan.dinner.guests, 300); assert.equal(ev.billing, 225000);
    assert.match(await metric('Bill/plate'), /Bill\/plate · 300\s*₹750/);
    assert.match(await metric('Contribution /'), /₹750/);
  });

  await test('the rule: meals\' own guests win (largest meal); otherwise the event\'s number, as before', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js');
      const g = u.eventGuests;
      return [g({ guests: 10, meals: ['dinner'], mealPlan: { dinner: { guests: 300 } } }),
        g({ guests: 200 }),
        g({ guests: 200, meals: ['dinner'] }),
        g({ guests: 0, mealPlan: { lunch: { guests: 150 } } }),
        g({ guests: 50, meals: ['lunch', 'dinner'], mealPlan: { lunch: { guests: 200 }, dinner: { guests: 300 } } }),
        g({ guests: 80, meals: ['lunch'], mealPlan: { dinner: { guests: 300 } } }),
        u.calcEventPL({ id: 'z', billing: 225000, guests: 10, meals: ['dinner'], mealPlan: { dinner: { guests: 300 } } }, [], []).billPerPlate]; });
    assert.deepEqual(r, [300, 200, 200, 150, 300, 80, 750]);
  });

  await test('past-event comparisons use the same number: a 300-guest dinner saved first for 10 counts as 300', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js');
      const peer = { id: 'old', menu: 'm1', type: 'Wedding', guests: 10, meals: ['dinner'], mealPlan: { dinner: { guests: 300 } } };
      const costs = new Map([['old', new Map([['Raw Material', 60000]])], ['new', new Map([['Raw Material', 30000]])]]);
      const cmp = u.costVsUsual({ id: 'new', menu: 'm1', type: 'Wedding', guests: 150 }, [peer], costs, new Set(['old']));
      return cmp.rows.map(x => [x.cat, x.mine, x.usual]); });
    assert.deepEqual(r, [['Raw Material', 200, 200]], 'usual ₹60,000 ÷ 300 = ₹200 a plate, not ÷ 10');
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'per-plate-guests FAIL' : 'per-plate figures use the meals\' guests PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('per-plate-guests FAIL'); process.exitCode = 1; });
