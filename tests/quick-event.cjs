// 5.6.0 (owner's requirements): quick events. A small, one-time or outsourced job in a few fields, saved as an ordinary
// event with the same money rules; a bill, money received and an outsourced caterer's charge are optional and saved in
// one go; details are added later from the event. Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const DATA = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [], events: [],
  vendors: [{ id: 'oc', name: 'Sample Partner Caterer', cat: 'Operations', phone: '9000000044' }] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });
  await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA());
  await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' });
  const open = async () => { await p.locator('[data-action="quick"][data-id="qevent"]').click(); await p.waitForSelector('#qev-modal.active'); };

  await test('only a name and date are needed; the rest can wait', async () => {
    await open();
    await p.locator('#btn-save-qev').click(); await p.waitForTimeout(200);
    assert.equal((await dump()).events.length, 0, 'no name: not saved');
    await p.fill('#qev-name', 'Sample Office Lunch'); await p.locator('#btn-save-qev').click(); await p.waitForTimeout(700);
    const ev = (await dump()).events[0];
    assert.deepEqual([ev.name, ev.type, ev.billing, ev.quick, ev.venue], ['Sample Office Lunch', 'Other – इतर', 0, true, '']);
  });

  await test('with plates, bill and money received now: one save, the payment counted for the event', async () => {
    await open();
    await p.fill('#qev-name', 'Sample Tiffin Order'); await p.fill('#qev-guests', '30'); await p.fill('#qev-bill', '6000'); await p.fill('#qev-rec', '2000');
    assert.equal(await p.locator('#qev-mode-field').isVisible(), true);
    await p.selectOption('#qev-mode', 'UPI');
    await p.locator('#btn-save-qev').click(); await p.waitForTimeout(700);
    const d = await dump(), ev = d.events.find(e => e.name === 'Sample Tiffin Order');
    assert.deepEqual([ev.guests, ev.billing], [30, 6000]);
    assert.deepEqual(d.cPays.map(x => [x.evId, x.amt, x.mode]), [[ev.id, 2000, 'UPI']]);
  });

  await test('outsourced: the other caterer\'s charge is owed to them, as on the full form', async () => {
    await open();
    await p.fill('#qev-name', 'Sample Outsourced Pooja'); await p.fill('#qev-bill', '15000');
    await p.locator('#qev-out').check(); await p.selectOption('#qev-out-ven', 'oc'); await p.fill('#qev-out-charge', '11000');
    await p.locator('#btn-save-qev').click(); await p.waitForTimeout(700);
    const d = await dump(), ev = d.events.find(e => e.name === 'Sample Outsourced Pooja');
    assert.deepEqual([ev.outsourced, ev.outVenId], [true, 'oc']);
    assert.deepEqual(d.expenses.map(x => [x.evId, x.amt, x.venId, x.pay, x.head]), [[ev.id, 11000, 'oc', 'credit', 'Outsourced Event – आउटसोर्स कार्यक्रम']]);
  });

  await test('the quick event opens like any event, and details can be added later', async () => {
    await p.locator('#n-events:visible').click(); await p.waitForTimeout(300);
    await p.locator('#ev-list [data-action="evdetail"]', { hasText: 'Sample Tiffin Order' }).first().click(); await p.waitForSelector('#tab-evdetail.active');
    assert.match(await p.locator('#tab-evdetail').innerText(), /Sample Tiffin Order/);
    assert.ok(await p.locator('[data-action="close-open"]').count(), 'closing report available');
  });

  await test('a bad quick flag in a backup is refused', async () => {
    const d = DATA(); d.events.push({ id: 'Q', name: 'x', date: '2026-12-01', type: 'Other – इतर', venue: '', billing: 0, guests: 0, photoIds: [], quick: 'yes' });
    const err = await p.evaluate(async x => { try { await (await import('./db.js')).importAllData(x, 'replace'); return ''; } catch (e) { return e.message; } }, d);
    assert.match(err, /quick/i);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'quick-event FAIL' : 'quick events PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('quick-event FAIL'); process.exit(1); });
