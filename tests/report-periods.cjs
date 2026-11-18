// Report periods: "This month", "3 months" and "This FY" end where they say they end. Before 4.31.4 a period had only a
// start, so an event booked for a later month or year (with its payments and costs) counted in this period's totals on
// Home and Reports. Checks the month and financial-year edges and Home's figures. 360px. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Kolkata' });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');

  // Dates around today's edges, worked out in the page (its own clock and time zone)
  const E = await p.evaluate(async () => {
    const u = await import('./utils.js');
    const d = new Date(u.today()), y = d.getFullYear(), m = d.getMonth();
    const day = (yy, mm, dd) => u.localDay(new Date(yy, mm, dd));
    const fyStartY = m >= 3 ? y : y - 1;
    return {
      monthFirst: day(y, m, 1), monthLast: day(y, m + 1, 0), nextMonthFirst: day(y, m + 1, 1), prevMonthLast: day(y, m, 0),
      threeFirst: day(y, m - 2, 1), beforeThree: day(y, m - 2, 0),
      fyFirst: day(fyStartY, 3, 1), fyLast: day(fyStartY + 1, 2, 31), nextFyFirst: day(fyStartY + 1, 3, 1), nextYear: day(y + 1, m, 15),
      start: { month: u.periodStart('month'), '3m': u.periodStart('3m'), fy: u.periodStart('fy') },
      end: { month: u.periodEnd('month'), '3m': u.periodEnd('3m'), fy: u.periodEnd('fy'), all: u.periodEnd('all') } };
  });

  await test('each period has an end: next month for month and 3 months, 1 April for the financial year', async () => {
    assert.equal(E.end.month, E.nextMonthFirst); assert.equal(E.end['3m'], E.nextMonthFirst);
    assert.equal(E.end.fy, E.nextFyFirst); assert.equal(E.end.all, '');
    assert.equal(E.start.month, E.monthFirst); assert.equal(E.start['3m'], E.threeFirst); assert.equal(E.start.fy, E.fyFirst);
  });

  const ev = (id, date) => ({ id, name: `Sample ${id}`, date, venue: 'Sample Hall', type: 'Party – पार्टी', billing: 10000, guests: 50, photoIds: [] });
  const DATES = { mFirst: E.monthFirst, mLast: E.monthLast, nextM: E.nextMonthFirst, prevM: E.prevMonthLast, threeFirst: E.threeFirst,
    beforeThree: E.beforeThree, fyFirst: E.fyFirst, fyLast: E.fyLast, nextFy: E.nextFyFirst, nextYear: E.nextYear };
  const DATA = { version: 'ffv2', photos: [], vendors: [], vPays: [],
    events: Object.entries(DATES).map(([id, date]) => ev(id, date)),
    expenses: Object.keys(DATES).map((id, i) => ({ id: `x${i}`, evId: id, date: DATES[id], amt: 1000, cat: 'Operations', head: 'Transport – वाहतूक', pay: 'paid', billIds: [] })),
    cPays: Object.keys(DATES).map((id, i) => ({ id: `c${i}`, evId: id, date: DATES[id], amt: 2000, mode: 'UPI' })) };

  await test('only events inside the period count, with their payments and costs; later bookings wait for their own period', async () => {
    const r = await p.evaluate(async d => { const u = await import('./utils.js'); const out = {};
      for (const k of ['month', '3m', 'fy', 'all']) { const s = u.sliceByPeriod(d, k);
        out[k] = { ev: s.events.map(e => e.id).sort(), x: s.expenses.length, c: s.cPays.length }; }
      return out; }, DATA);
    const inRange = (a, b) => Object.keys(DATES).filter(id => DATES[id] >= a && DATES[id] < b).sort();
    assert.deepEqual(r.month.ev, inRange(E.monthFirst, E.nextMonthFirst));
    assert.ok(r.month.ev.includes('mFirst') && r.month.ev.includes('mLast'), 'first and last day of the month count');
    assert.ok(!r.month.ev.includes('nextM') && !r.month.ev.includes('nextYear'), 'next month and next year do not');
    assert.deepEqual(r['3m'].ev, inRange(E.threeFirst, E.nextMonthFirst)); assert.ok(!r['3m'].ev.includes('beforeThree'));
    assert.deepEqual(r.fy.ev, inRange(E.fyFirst, E.nextFyFirst));
    assert.ok(r.fy.ev.includes('fyFirst') && r.fy.ev.includes('fyLast') && !r.fy.ev.includes('nextFy'), '1 April to 31 March');
    for (const k of ['month', '3m', 'fy']) { assert.equal(r[k].x, r[k].ev.length, `${k}: costs of those events only`); assert.equal(r[k].c, r[k].ev.length, `${k}: payments of those events only`); }
    assert.equal(r.all.ev.length, Object.keys(DATES).length, 'All time keeps everything');
  });

  await test("Home's \"This month\" figures leave out an event booked for next year", async () => {
    await p.evaluate(async d => { localStorage.setItem('ffv2_period', '"month"'); const db = await import('./db.js'); await db.importAllData(d); }, DATA);
    await p.reload(); await p.waitForSelector('#kpi .card');
    const n = DATA.events.filter(e => e.date >= E.monthFirst && e.date < E.nextMonthFirst).length;
    const sub = await p.locator('.hero-sub').innerText();
    assert.match(sub, new RegExp(`· ${n} event${n > 1 ? 's' : ''}`), `Home counts ${n} events this month: ${sub}`);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})();
