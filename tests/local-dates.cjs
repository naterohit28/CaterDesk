// Local dates: timestamps are saved in UTC, but every date and time the owner sees is in the phone's own time. Before
// this fix, cutting the saved text showed the previous day (and a UTC clock time) for anything saved between midnight
// and 05:30 in India. Runs in Asia/Kolkata. 360px. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const EARLY = '2026-11-16T20:15:00.000Z';   // 17 Nov 2026, 01:45 in India; the saved text says 16 Nov, 20:15
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'v1', name: 'Sample Chaat Stall', cat: 'Live Counter', phone: '9000000001' }],
  events: [{ id: 'e1', name: 'Sample Tomorrow Wedding', date: day(1), venue: 'Sample Lawns', type: 'Wedding – लग्न', billing: 300000, guests: 300, meals: ['dinner'], photoIds: [],
    mealPlan: { dinner: { guests: 300, rate: 650 } }, dishes: [{ name: 'Pani Puri', head: 'Chaat – चाट', meal: 'dinner' }],
    orders: [{ id: 'o1', head: 'Chaat – चाट', venId: 'v1', plates: 250, date: day(1), time: '19:00', status: 'sent', at: '2026-11-01T10:00:00.000Z', reminded: [EARLY] }] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Kolkata' });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');

  await test('helpers give the India day and clock time for a timestamp saved after midnight', async () => {
    const r = await p.evaluate(async t => { const u = await import('./utils.js');
      return { day: u.localDay(t), time: u.localTime(t), stamp: u.localStamp(new Date(t)), plain: u.localDay('2026-11-16'), bad: u.localTime('not a time') }; }, EARLY);
    assert.deepEqual(r, { day: '2026-11-17', time: '01:45', stamp: '2026-11-17-0145', plain: '2026-11-16', bad: '' });
  });

  await test('Home shows when a vendor was reminded in local time, not UTC', async () => {
    await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
    await p.reload(); await p.waitForSelector('#deliveries');
    const want = await p.evaluate(async () => (await import('./utils.js')).fmtDate('2026-11-17'));
    const txt = await p.locator('#deliveries .dl-acts[data-order="o1"]').innerText();
    assert.match(txt, new RegExp(`Reminded ${want} 01:45`));
    assert.doesNotMatch(txt, /20:15/);
  });

  await test('no source code still cuts dates or times out of saved UTC text', async () => {
    const src = await p.evaluate(async () => (await fetch('./app.js')).text());
    assert.doesNotMatch(src, /\.slice\(11, ?16\)/, 'a UTC clock time is cut from saved text');
    assert.doesNotMatch(src, /toISOString\(\)\.slice\(0, ?1[06]\)/, 'a UTC date is used for something the owner sees');
    assert.doesNotMatch(src, /(at|At|lastExport)\)?\.slice\(0, ?10\)/, 'a saved timestamp is cut to its UTC day');
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})();
