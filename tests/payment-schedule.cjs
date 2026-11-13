// Phase 3 P3-B client payment milestones (spec §11.2, P-01, G-09). Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const DATA = { version: 'ffv2', photos: [], vPays: [], expenses: [], vendors: [],
  events: [{ id: 'p1', name: 'Sample Contract', date: day(20), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 400000, guests: 400, mobile: '9000000005', photoIds: [] },
    { id: 'old', name: 'Sample Past Party', date: day(-5), venue: 'Sample Lawn', type: 'Birthday – वाढदिवस', billing: 50000, guests: 50, photoIds: [] }],
  cPays: [{ id: 'c1', evId: 'p1', amt: 100000, date: day(-10), mode: 'UPI' }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const ev = async id => (await p.evaluate(async () => (await import('./db.js')).exportAllData())).events.find(e => e.id === id);
  const openEvent = async name => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"]:visible', { hasText: name }).first().click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  const row = i => p.locator(`#plan-rows [data-pm="${i}"]`);
  const remind = () => p.locator('#ev-contact a.btn-wa').getAttribute('href').then(h => decodeURIComponent(h));
  const homeChip = async name => { await p.locator('#n-home:visible').click(); return p.locator('#od-list .row', { hasText: name }).innerText(); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);

  await test('events without a schedule behave as before', async () => {
    await openEvent('Sample Past Party');
    assert.match(await p.locator('[data-action="plan-edit"]').innerText(), /Payment plan/);
    assert.match(await homeChip('Sample Past Party'), /Overdue 5d/);
    assert.equal('payPlan' in await ev('old'), false);
  });

  await test('G-09 / P-01: ₹4,00,000 contract, ₹1,00,000 advance received, ₹2,00,000 due later → outstanding ₹3,00,000, due now ₹0', async () => {
    await openEvent('Sample Contract'); await p.locator('[data-action="plan-edit"]').click(); await p.waitForSelector('#plan-modal.active');
    await row(0).locator('[data-k="amt"]').fill('100000');                                   // Advance · on booking (preset)
    await p.locator('#btn-plan-add').click();
    await row(1).locator('[data-k="label"]').fill('Second payment'); await row(1).locator('[data-k="amt"]').fill('200000'); await row(1).locator('[data-k="date"]').fill(day(5));
    assert.match(await p.locator('#plan-sum').innerText(), /Bill ₹4,00,000 · scheduled ₹3,00,000 · ₹1,00,000 left as balance after the event/);
    await p.locator('#btn-save-plan').click(); await p.waitForTimeout(500);
    const e = await ev('p1');
    assert.deepEqual(e.payPlan.map(m => [m.label, m.when, m.amt, m.date]), [['Advance', 'booking', 100000, undefined], ['Second payment', 'date', 200000, day(5)]]);
    const block = await p.locator('#pay-schedule').innerText();
    assert.match(block, /Due now ₹0/); assert.doesNotMatch(block, /overdue/i);
    assert.match(block, /Advance · On booking\s*₹1,00,000\s*Paid/); assert.match(block, /Second payment[\s\S]*₹2,00,000\s*Upcoming/);
    assert.match(block, /Balance ·[\s\S]*₹1,00,000\s*Upcoming/);
    assert.match(await p.locator('#tab-evdetail .metric', { hasText: 'Pending' }).first().innerText(), /₹3,00,000/, 'outstanding stays ₹3,00,000');
    assert.match(await homeChip('Sample Contract'), /On schedule/);
  });

  await test('on the second payment date: due now ₹2,00,000 (not ₹3,00,000); after it: overdue ₹2,00,000; reminder asks for the due amount', async () => {
    const e = await ev('p1'); const { _rev, ...r } = e;
    await p.evaluate(async r => { const db = await import('./db.js'); await db.putOne('events', r); }, { ...r, payPlan: r.payPlan.map(m => m.when === 'date' ? { ...m, date: day(0) } : m) });
    await openEvent('Sample Contract');
    assert.match(await p.locator('#pay-schedule').innerText(), /Due now ₹2,00,000/); assert.doesNotMatch(await p.locator('#pay-schedule').innerText(), /overdue/i);
    assert.match(await homeChip('Sample Contract'), /Due now ₹2,00,000/);
    await p.evaluate(async r => { const db = await import('./db.js'); await db.putOne('events', r); }, { ...r, payPlan: r.payPlan.map(m => m.when === 'date' ? { ...m, date: day(-1) } : m) });
    await openEvent('Sample Contract');
    assert.match(await p.locator('#pay-schedule').innerText(), /Due now ₹2,00,000 · overdue ₹2,00,000/);
    assert.match(await p.locator('#pay-schedule').innerText(), /Second payment[\s\S]*Overdue/);
    const msg = await remind();
    assert.match(msg, /₹2,00,000 is now due for Sample Contract[\s\S]*as per the payment schedule \(total balance ₹3,00,000\)/);
    assert.doesNotMatch(msg, /₹3,00,000 is (pending|now due)/, 'the whole outstanding is never asked for as due');
    assert.match(await homeChip('Sample Contract'), /Overdue ₹2,00,000/);
    // A part payment reduces what is due, applied to the earliest milestone
    await p.evaluate(async d => { const db = await import('./db.js'); await db.putOne('cPays', { id: 'c2', evId: 'p1', amt: 50000, date: d, mode: 'Cash' }); }, day(0));
    await openEvent('Sample Contract');
    assert.match(await p.locator('#pay-schedule').innerText(), /Due now ₹1,50,000 · overdue ₹1,50,000/);
    assert.match(await p.locator('#pay-schedule').innerText(), /Second payment[\s\S]*Overdue · ₹1,50,000/);
  });

  await test('percentages, validation, and removing the schedule', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js'); return u.paymentSchedule({ id: 'x', date: u.addDays(u.today(), 9), billing: 250000, payPlan: [{ id: 'a', when: 'booking', pct: 40 }, { id: 'b', when: 'before', days: 2, pct: 60 }] }, []); });
    assert.deepEqual([r.rows.map(x => x.amount), r.dueNow, r.unscheduled], [[100000, 150000], 100000, 0]);
    await openEvent('Sample Contract'); await p.locator('[data-action="plan-edit"]').click(); await p.waitForSelector('#plan-modal.active');
    await row(1).locator('[data-k="amt"]').fill('350000'); await p.locator('#btn-save-plan').click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#toast-msg').innerText(), /more than the bill/); assert.equal(await p.locator('#plan-modal.active').count(), 1);
    await row(1).locator('[data-k="amt"]').fill('200000'); await row(1).locator('[data-k="date"]').fill('');
    await p.locator('#btn-save-plan').click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#toast-msg').innerText(), /needs an amount/);
    await row(1).locator('[data-pm-del]').click(); await row(0).locator('[data-pm-del]').click();
    await p.locator('#btn-save-plan').click(); await p.waitForTimeout(500);
    assert.equal('payPlan' in await ev('p1'), false, 'schedule removed: field dropped, event back to before');
    const bad = await p.evaluate(async () => { const db = await import('./db.js'); const out = [];
      for (const pp of [[{ id: 'a', when: 'soon', amt: 1 }], [{ id: 'a', when: 'date', amt: 1 }], [{ id: 'a', when: 'booking', pct: 140 }], [{ id: 'a', when: 'after', amt: 1, days: -1 }]]) {
        const d = await db.exportAllData(); delete d.manifest; d.events[0].payPlan = pp;
        try { await db.importAllData(d, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message); } }
      return out; });
    assert.deepEqual(bad, Array(4).fill('Invalid payment schedule'));
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'payment schedule FAIL' : 'payment schedule (G-09, P-01) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('payment schedule FAIL'); process.exitCode = 1; });
