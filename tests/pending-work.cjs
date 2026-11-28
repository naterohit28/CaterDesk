// 5.6.0 (owner's requirements, Today's work): Home lists the pending actions Home did not show yet — cooking jobs to
// confirm, supplier orders to confirm, labour costs without a rate, events to reconcile — in one compact list from the
// existing records; each row opens the event concerned. Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const EV = (id, name, n, extra = {}) => ({ id, name, date: day(n), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 80000, guests: 100, photoIds: [], ...extra });
const DATA = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [{ id: 'x1', evId: 'P', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 9000, date: day(-6), pay: 'paid', mode: 'UPI', billIds: [] }],
  vendors: [{ id: 'v1', name: 'Sample Chaat Stall', cat: 'Live Counter', phone: '9000000001' }],
  events: [EV('U', 'Sample Coming Wedding', 6, { labour: { rows: [{ id: 'j1', role: 'Chinese Cook – चायनीज आचारी', job: true, people: 2, rate: 0, fare: 0, dishes: ['Hakka Noodles'] },
      { id: 'j2', role: 'Sweet Labour – मिठाई मजूर', job: true, people: 1, rate: 0, fare: 0, confirmed: true }] },
      orders: [{ id: 'o1', venId: 'v1', head: 'Chaat – चाट', status: 'sent', date: day(6), plates: 100 }] }),
    EV('P', 'Sample Past Party', -6, { labour: { rows: [{ id: 'r1', role: 'Rojiya Labour – रोजीया मजूर', rate: 0, counts: { f: 4 } }] } })] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });

  await test('an empty app lists no pending work', async () => { assert.equal(await p.locator('#pending-list').count(), 0); });

  await test('Home lists cooks to confirm, orders to confirm, labour without a rate and events to reconcile', async () => {
    await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA());
    await p.reload(); await p.waitForSelector('#pending-list');
    const rows = await p.locator('#pending-list [data-pending]').evaluateAll(r => r.map(x => [x.dataset.pending, x.innerText.replace(/\s+/g, ' ').trim()]));
    assert.deepEqual(rows, [['cooks', '1 cooking job to confirm Sample Coming Wedding'], ['orders', '1 supplier order to confirm Sample Coming Wedding'],
      ['labour', '1 labour cost without a rate Sample Past Party'], ['recon', '1 event to reconcile Sample Past Party']]);
    const wide = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); assert.equal(wide, false, 'fits at 360px');
  });

  await test('a row opens the event concerned', async () => {
    await p.locator('#pending-list [data-pending="recon"]').click(); await p.waitForSelector('#tab-evdetail.active');
    assert.match(await p.locator('#tab-evdetail .detail-name').innerText(), /Sample Past Party/);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'pending-work FAIL' : 'pending work on Home PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('pending-work FAIL'); process.exit(1); });
