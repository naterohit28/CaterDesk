// 5.3.0 Today: Home opens with today's and tomorrow's events and what is still open for each (vendor orders to
// confirm, no labour list, client balance to collect), then the quick actions and to-do cards; the money overview is
// below them. With no event today or tomorrow, the next event is shown. Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const EV = (id, name, n, extra = {}) => ({ id, name, date: day(n), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 150, photoIds: [], ...extra });
const DATA = (events, cPays = []) => ({ version: 'ffv2', photos: [], vPays: [], expenses: [], cPays,
  vendors: [{ id: 'v1', name: 'Sample Caterer', cat: 'Live Counter' }, { id: 'c1', name: 'Sample Contractor', cat: 'Labour' }], events });
const ORDER = (id, status, n) => ({ id, venId: 'v1', head: 'Starter Counter', status, date: day(n), plates: 150 });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const load = async d => { await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d, 'replace'); }, d); await p.reload(); await p.waitForSelector('#today .sec'); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi');

  await test('today\'s and tomorrow\'s events come first, with what is still open', async () => {
    await load(DATA([
      EV('T1', 'Sample Today Event', 0, { orders: [ORDER('o1', 'sent', 0), ORDER('o2', 'confirmed', 0), ORDER('o3', 'prepared', 0)] }),
      EV('T2', 'Sample Tomorrow Event', 1, { labour: { rows: [{ id: 'r1', role: 'Waiter', venId: 'c1', count: 4 }] } }),
      EV('T3', 'Sample Later Event', 5)],
      [{ id: 'p1', evId: 'T1', amt: 40000, date: day(-2), mode: 'UPI' }, { id: 'p2', evId: 'T2', amt: 100000, date: day(-2), mode: 'UPI' }]));
    const rows = await p.locator('#today-list .today-ev').evaluateAll(rs => rs.map(r => r.innerText.replace(/\s+/g, ' ')));
    assert.equal(rows.length, 2, 'only today and tomorrow');
    assert.match(rows[0], /Today · Sample Today Event/); assert.match(rows[0], /2 orders to confirm/); assert.match(rows[0], /No labour list/); assert.match(rows[0], /60,000 to collect/);
    assert.match(rows[1], /Tomorrow · Sample Tomorrow Event/); assert.match(rows[1], /Nothing pending/);
    assert.ok(!rows.join(' ').includes('Later'), 'later events are not in Today');
  });

  await test('tapping an event opens it', async () => {
    await p.locator('#today-list .today-ev').first().click();
    await p.waitForSelector('#tab-evdetail.active'); assert.match(await p.locator('#tab-evdetail').innerText(), /Sample Today Event/);
    await p.locator('#n-home:visible').click(); await p.waitForSelector('#tab-home.active');
  });

  await test('Home order: Today, quick actions, to-do cards, collections, then the money overview', async () => {
    const order = await p.evaluate(() => ['today', 'nudges', 'od-list', 'kpi', 'insights-wrap'].map(id => document.getElementById(id))
      .concat([document.querySelector('#tab-home .qa-grid')]).map(el => [...document.querySelectorAll('#tab-home *')].indexOf(el)));
    const [today, nudges, od, kpi, ins, qa] = order;
    assert.ok(today < qa && qa < nudges && nudges < od && od < kpi && kpi < ins, JSON.stringify(order));
    assert.ok(await p.locator('#kpi .card.hero').count(), 'the money overview is still there');
  });

  await test('every meal of the day is listed in order with its own guests', async () => {
    const plan = { breakfast: { guests: 100, rate: 150 }, lunch: { guests: 250, rate: 500 }, hightea: { guests: 80, rate: 120 }, dinner: { guests: 300, rate: 600 }, latenight: { guests: 40, rate: 200 } };
    await load(DATA([EV('M1', 'Sample Five Meals', 0, { meals: ['dinner', 'breakfast', 'latenight', 'hightea', 'lunch'], mealPlan: plan })]));
    const t = (await p.locator('#today-list .today-meals').innerText()).replace(/\s+/g, ' ');
    assert.equal(t, 'Breakfast 100 · Lunch 250 · High tea 80 · Dinner 300 · Late night 40');
  });

  await test('no event today or tomorrow: the next one is shown', async () => {
    await load(DATA([EV('L1', 'Sample Later Event', 6), EV('L2', 'Sample Past Event', -3)]));
    const t = (await p.locator('#today-list').innerText()).replace(/\s+/g, ' ');
    assert.match(t, /No events today or tomorrow/); assert.match(t, /Next: Sample Later Event/);
    await load(DATA([]));
    assert.match(await p.locator('#today-list').innerText(), /No upcoming events/);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'today FAIL' : 'today: today\'s work first on Home PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('today FAIL'); process.exitCode = 1; });
