// Owner's audit findings (v4.6 payment reminders and Phase 3 counts), each reproduced and fixed. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // local date, as the app uses
const ev = (id, name, date, extra = {}) => ({ id, name, date, venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 400000, guests: 500, photoIds: [], mobile: '9000000005', ...extra });
const DATA = { version: 'ffv2', photos: [], vendors: [], vPays: [], expenses: [],
  events: [
    // Plan: advance paid; next ₹2,00,000 due in 10 days; balance after the event. Event was yesterday → nothing is due today except... the after-event balance tomorrow.
    ev('P', 'Sample Planned', day(-1), { payPlan: [{ id: 'a', label: 'Advance', when: 'booking', amt: 100000 }, { id: 'b', label: 'Second', when: 'date', date: day(10), amt: 200000 }, { id: 'c', label: 'Final', when: 'date', date: day(20), amt: 100000 }] }),
    ev('N', 'Sample Unplanned', day(-3)),
    ev('Q', 'Sample Percent', day(30), { billing: 100000.01, payPlan: [{ id: 'x', when: 'booking', pct: 50 }, { id: 'y', when: 'before', days: 1, pct: 50 }] }),
    ev('C', 'Sample Count', day(-1), { meals: ['dinner'], mealPlan: { dinner: { guests: 500, rate: 800 } }, countPolicy: { method: 'tokens', counter: 'supervisor', rules: 'kids free', confirmed: true, confirmedAt: '2026-01-01T00:00:00.000Z' },
      guestCounts: { dinner: { contracted: 500, rate: 800, counts: [{ at: '2026-01-02T00:00:00.000Z', n: 560 }], requests: [{ id: 'r1', at: '2026-01-02T00:00:00.000Z', qty: 60, rate: 800, countAt: '2026-01-02T00:00:00.000Z', status: 'approved', accepted: 60, evidence: 'written' }] } } })],
  cPays: [{ id: 'p1', evId: 'P', amt: 100000, date: day(-30), mode: 'UPI' }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const openEvent = async id => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator(`#ev-list [data-action="evdetail"][data-id="${id}"]:visible`).click(); await p.waitForSelector('#tab-evdetail .detail-name'); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);

  await test('F1: with a payment plan and nothing due yet, there is no reminder asking for the whole ₹3,00,000', async () => {
    await openEvent('P');
    assert.equal(await p.locator('#ev-contact a', { hasText: 'Remind' }).count(), 0, 'no Remind button while nothing is due');
    assert.equal(await p.locator('#ev-contact a', { hasText: 'WhatsApp' }).count(), 1, 'plain WhatsApp instead');
    // Without a plan, the balance after the event can still be reminded
    await openEvent('N'); const href = await p.locator('#ev-contact a', { hasText: 'Remind' }).getAttribute('href');
    assert.match(decodeURIComponent(href), /₹4,00,000 is pending for Sample Unplanned/);
  });

  await test('F1: once a milestone is due, the reminder asks for that amount only', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const { _rev, ...e } = d.events.find(x => x.id === 'P');
      e.payPlan[1].date = (await import('./utils.js')).today(); await db.putOne('events', e); });
    await openEvent('P'); const msg = decodeURIComponent(await p.locator('#ev-contact a', { hasText: 'Remind' }).getAttribute('href'));
    assert.match(msg, /₹2,00,000 is now due for Sample Planned .* as per the payment schedule \(total balance ₹3,00,000\)/);
  });

  await test('F2: Pending is red only when the plan has something overdue, not merely because the event date passed', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const { _rev, ...e } = d.events.find(x => x.id === 'P');
      const u = await import('./utils.js'); e.payPlan[1].date = u.addDays(u.today(), 10); await db.putOne('events', e); });
    await openEvent('P'); assert.equal(await p.locator('#ev-pending').getAttribute('class'), 'amt-md due', 'event is past but nothing overdue: amber');
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const { _rev, ...e } = d.events.find(x => x.id === 'P');
      const u = await import('./utils.js'); e.payPlan[1].date = u.addDays(u.today(), -2); await db.putOne('events', e); });
    await openEvent('P'); assert.equal(await p.locator('#ev-pending').getAttribute('class'), 'amt-md neg', 'a milestone is overdue: red');
    await openEvent('N'); assert.equal(await p.locator('#ev-pending').getAttribute('class'), 'amt-md neg', 'no plan, event over: red as before');
  });

  await test('F3: % milestones add up to the bill exactly (₹1,00,000.01 in 50% + 50%)', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData();
      const s = u.paymentSchedule(d.events.find(e => e.id === 'Q'), d.cPays);
      const odd = u.paymentSchedule({ id: 'z', date: '2030-01-01', billing: 1000, payPlan: [{ when: 'booking', pct: 33.33 }, { when: 'booking', pct: 33.33 }, { when: 'booking', pct: 33.34 }] }, []);
      return { rows: s.rows.map(x => x.amount), over: s.overScheduled, rest: s.unscheduled, odd: odd.rows.map(x => x.amount), oddOver: odd.overScheduled, oddRest: odd.unscheduled }; });
    assert.equal(Math.round(r.rows.reduce((a, b) => a + b, 0) * 100), 10000001); assert.deepEqual([r.over, r.rest], [0, 0]);
    assert.deepEqual([...r.rows].sort((a, b) => a - b), [50000, 50000.01]);
    assert.equal(Math.round(r.odd.reduce((a, b) => a + b, 0) * 100), 100000); assert.deepEqual([r.oddOver, r.oddRest], [0, 0]);
  });

  await test('F5: changing the agreed counting terms needs the client to agree again', async () => {
    await openEvent('C'); await p.locator('[data-action="count-open"]').click(); await p.waitForSelector('#count-modal.active');
    await p.locator('#count-policy summary').click().catch(() => {});
    assert.equal(await p.locator('#cp-confirmed').isChecked(), true);
    await p.fill('#cp-rules', 'kids under 5 free; second servings not counted');
    assert.equal(await p.locator('#cp-confirmed').isChecked(), false, 'editing a term un-ticks the agreement');
    await p.locator('[data-action="count-policy-save"]').click(); await p.waitForTimeout(400);
    let cp = (await dump()).events.find(e => e.id === 'C').countPolicy;
    assert.equal(cp.confirmed, undefined, 'saved as not agreed');
    if (!(await p.locator('#count-policy').evaluate(d => d.open))) await p.locator('#count-policy summary').click();
    await p.locator('#cp-confirmed').check(); await p.locator('[data-action="count-policy-save"]').click(); await p.waitForTimeout(400);
    cp = (await dump()).events.find(e => e.id === 'C').countPolicy;
    assert.equal(cp.confirmed, true); assert.notEqual(cp.confirmedAt, '2026-01-01T00:00:00.000Z', 'a new agreement time, not the old one');
  });

  await test('F7: if saving the bill change fails, no "Bill is now…" success message and the bill is unchanged', async () => {
    await openEvent('C'); await p.locator('[data-action="count-open"]').click(); await p.waitForSelector('#count-modal.active');
    await p.locator('[data-action="count-bill"]').click(); await p.waitForSelector('#ask-modal.active');
    // Make the save fail: another window changed the event meanwhile
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const { _rev, ...e } = d.events.find(x => x.id === 'C'); await db.putOne('events', { ...e, notes: 'changed elsewhere' }); });
    await p.locator('#ask-actions button').first().click(); await p.waitForTimeout(600);
    assert.doesNotMatch(await p.locator('#toast-msg').innerText(), /Bill is now/);
    const e = (await dump()).events.find(x => x.id === 'C');
    assert.equal(e.billing, 400000); assert.equal(e.billChanges, undefined);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'money fixes FAIL' : 'audit findings F1–F3, F5–F7 fixed PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('money fixes FAIL'); process.exitCode = 1; });
