// 5.6.2 (owner): event pickers say where and when. Expense entry, the expense filter, shared-bill rows and vendor
// payments show "Venue, Locality · Date"; the locality is not repeated when the venue already says it; two events at the
// same venue on the same day add the start time that tells them apart, else the event name; no venue: name and date as
// before. Presentation only: the value stays the event ID, the order is unchanged, and saving links the same event.
// Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const ev = (id, name, date, x = {}) => ({ id, name, date, type: 'Other – इतर', venue: '', billing: 10000, guests: 50, photoIds: [], ...x });
const DATA = () => ({ version: 'ffv2', photos: [], vPays: [], expenses: [],
  vendors: [{ id: 'g', name: 'Sample Grocer', cat: 'Raw Material', phone: '9000000011' }], cPays: [{ id: 'cp', evId: 'A', amt: 5000, date: '2026-11-20', mode: 'UPI' }],
  events: [
    ev('A', 'Sample Joshi Wedding', '2026-12-12', { venue: 'Sample Lawns', locality: 'Vashi', mobile: '9000000012' }),
    ev('B', 'Sample Rao Reception', '2026-12-12', { venue: 'Sample Grand Hall', locality: 'Nerul', services: [{ id: 's1', meal: 'lunch', time: '12:30' }] }),
    ev('C', 'Sample Mehta Sangeet', '2026-12-12', { venue: 'Sample Grand Hall', locality: 'Nerul', services: [{ id: 's2', meal: 'dinner', time: '19:30' }] }),
    ev('D', 'Sample Shah Pooja', '2026-12-10', { venue: 'Sample Vashi Gymkhana', locality: 'Vashi' }),
    ev('E', 'Sample Office Lunch', '2026-12-09'),
    ev('F', 'Sample Kale Birthday', '2026-12-08', { venue: 'Sample Club', locality: '' }),
    ev('G', 'Sample Iyer Haldi', '2026-12-07', { venue: 'Sample Banquet', locality: 'Thane' }),
    ev('H', 'Sample Nair Haldi', '2026-12-07', { venue: 'Sample Banquet', locality: 'Thane' }),
    ev('L', 'Sample Long', '2026-12-06', { venue: 'Sample Shree Mahalaxmi Banquets and Lawns Complex', locality: 'Kharghar Sector 21' }) ] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const opts = sel => p.locator(sel + ' option').evaluateAll(os => os.map(o => [o.value, o.textContent]));
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });
  await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA());
  await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' });
  await p.locator('#n-expenses:visible').click(); await p.waitForSelector('#tab-expenses.active');
  await p.locator('#fab').click(); await p.waitForSelector('#exp-modal.active'); await p.waitForTimeout(300);

  await test('expense entry: venue and date, newest first, values still the event IDs', async () => {
    const o = (await opts('#exp-ev')).filter(([v]) => v);
    assert.deepEqual(o.map(([v]) => v), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'L'], 'same order as before');
    const l = Object.fromEntries(o);
    assert.match(l.A, /^Sample Lawns, Vashi · /, 'locality added');
    assert.match(l.D, /^Sample Vashi Gymkhana · /, 'locality already in the venue: not repeated');
    assert.match(l.B, /^Sample Grand Hall, Nerul · .* · 12:30 PM$/, 'same venue and day: told apart by time');
    assert.match(l.C, /^Sample Grand Hall, Nerul · .* · 7:30 PM$/);
    assert.match(l.G, / · Sample Iyer Haldi$/, 'no time to tell them apart: the name');
    assert.match(l.H, / · Sample Nair Haldi$/);
    assert.match(l.E, /^Sample Office Lunch · /, 'no venue: name and date as before');
    assert.match(l.F, /^Sample Club · /, 'no locality');
    assert.doesNotMatch(l.A, /Joshi/, 'one event at that venue that day: no name needed');
    assert.equal(l.L.startsWith('Sample Shree Mahalaxmi Banquets and Lawns Complex · '), true, 'a long venue drops the locality');
  });

  await test('choosing by venue saves the same event as before', async () => {
    await p.locator('#exp-cats [data-cat="Raw Material"]').click().catch(() => {});
    await p.fill('#exp-amt', '1500'); await p.selectOption('#exp-ev', 'C');
    await p.locator('#exp-pay [data-pay="credit"]').click(); await p.selectOption('#exp-vendor', 'g');
    await p.locator('#btn-save-exp').click(); await p.waitForTimeout(700);
    const x = (await dump()).expenses.find(e => e.amt === 1500);
    assert.equal(x?.evId, 'C');
  });

  await test('the expense filter and vendor payment pickers use the same words', async () => {
    const f = Object.fromEntries(await opts('#exp-ev-filter'));
    assert.match(f.A, /^Sample Lawns, Vashi · /); assert.match(f.E, /^Sample Office Lunch · /);
    await p.locator('#n-vendors:visible').click(); await p.waitForTimeout(300);
    await p.locator('#ven-list [data-action="vendetail"]', { hasText: 'Sample Grocer' }).first().click(); await p.waitForSelector('#tab-vendetail.active');
    await p.locator('#fab').click(); await p.waitForSelector('#vpay-modal.active');   // Pay vendor
    const v = Object.fromEntries(await opts('#vpay-ev'));
    assert.match(v.C, /^Sample Grand Hall, Nerul · .* · 7:30 PM$/); assert.match(v[''], /No event/);
  });

  await test('nothing sideways on a 360px phone with the long venue chosen', async () => {
    await p.locator('#vpay-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(300);
    await p.locator('#n-expenses:visible').click(); await p.waitForTimeout(200);
    await p.locator('#fab').click(); await p.waitForSelector('#exp-modal.active'); await p.waitForTimeout(300);
    await p.selectOption('#exp-ev', 'L'); await p.waitForTimeout(200);
    const r = await p.evaluate(() => { const s = document.getElementById('exp-ev'), sh = document.querySelector('#exp-modal .sheet');
      return { size: parseFloat(getComputedStyle(s).fontSize), page: document.documentElement.scrollWidth <= innerWidth, sheet: sh.scrollWidth <= sh.clientWidth }; });
    assert.deepEqual(r, { size: 16, page: true, sheet: true });
  });

  await test('WhatsApp: vendor account names venue and date, never the event; client receipt adds them after the event name', async () => {
    await p.locator('#exp-modal [data-action="close-modal"]').first().click().catch(() => {}); await p.waitForTimeout(300);
    await p.locator('#n-vendors:visible').click(); await p.waitForTimeout(300);
    await p.locator('#ven-list [data-action="vendetail"]', { hasText: 'Sample Grocer' }).first().click(); await p.waitForSelector('#tab-vendetail.active');
    const dues = decodeURIComponent(await p.locator('#tab-vendetail a[href*="As%20per%20my%20records"]').first().getAttribute('href'));
    assert.match(dues, /• .* – Sample Grand Hall, Nerul · .*: ₹1,500/);
    assert.doesNotMatch(dues, /Mehta|Sangeet/, 'no event or client name to a vendor');
    await p.locator('#n-events:visible').click(); await p.waitForTimeout(300);
    await p.locator('#ev-list [data-action="evdetail"]', { hasText: 'Sample Joshi Wedding' }).first().click(); await p.waitForSelector('#tab-evdetail.active');
    const rec = decodeURIComponent(await p.locator('a[aria-label="Send receipt on WhatsApp"]').first().getAttribute('href'));
    assert.match(rec, /Payment receipt for Sample Joshi Wedding \(Sample Lawns, Vashi · [^)]+\)/);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'event-picker-labels FAIL' : 'event picker labels PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('event-picker-labels FAIL'); process.exit(1); });
