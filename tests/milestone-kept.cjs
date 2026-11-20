// Owner's decision on the pre-v5 audit (4.31.17): when the bill changes, a % milestone the client has already paid in
// full keeps the amount it had; the open milestones are worked out on the new bill and the rest is the balance after
// the event. Before this, a paid 25% booking milestone (₹56,250 of ₹2,25,000) became ₹60,000 and showed ₹3,750 "due"
// when the bill grew to ₹2,40,000. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const PLAN = [{ id: 'PMa', label: 'Booking', when: 'booking', pct: 25 }, { id: 'PMb', label: 'Before the event', when: 'before', days: 2, pct: 75 }];
const EV = { id: 'M1', name: 'Sample Milestone Wedding', date: day(20), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 225000, guests: 300, photoIds: [], payPlan: PLAN };
const PAY = { id: 'c1', evId: 'M1', amt: 56250, date: day(-3), mode: 'UPI' };
const DATA = { version: 'ffv2', photos: [], vPays: [], expenses: [], vendors: [], events: [EV], cPays: [PAY] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const stored = async () => (await p.evaluate(async () => (await import('./db.js')).exportAllData())).events.find(e => e.id === 'M1');
  const open = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="M1"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  const setBill = async v => { await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active');
    await p.fill('#ev-billing', String(v)); await p.locator('#btn-save-event').click(); await p.waitForTimeout(700); };
  const load = async () => { await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d, 'replace'); }, DATA); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');

  // The rules on synthetic records, in the app's own module
  const rule = (cases) => p.evaluate(async cases => { const u = await import('./utils.js');
    return cases.map(({ before, after, pays }) => { const ev = u.keepPaidMilestones(before, after, pays), s = u.paymentSchedule(ev, pays);
      return { plan: ev.payPlan, rows: s.rows.map(r => [r.label, r.amount, r.state, r.fixed]), dueNow: s.dueNow, over: s.overScheduled, total: s.rows.reduce((t, r) => t + r.amount, 0) }; }); }, cases);

  await test('the bill grows after the 25% booking milestone is paid: it stays ₹56,250 paid, nothing is due, the ₹3,750 is the balance', async () => {
    const [kept, legacy] = await rule([{ before: EV, after: { ...EV, billing: 240000 }, pays: [PAY] }, { before: null, after: { ...EV, billing: 240000 }, pays: [PAY] }]);
    assert.deepEqual(kept.plan.map(m => m.fixedAmt), [56250, undefined]);
    assert.deepEqual(kept.rows, [['Booking', 56250, 'paid', true], ['Before the event', 180000, 'upcoming', false], ['Balance', 3750, 'upcoming', false]]);
    assert.equal(kept.dueNow, 0);
    assert.equal(kept.total, 240000, 'the milestones still add up to the bill');
    assert.deepEqual(legacy.rows[0], ['Booking', 60000, 'due', false], 'without the rule (what 4.31.16 showed): ₹3,750 due on booking');
  });

  await test('the bill goes down: the paid milestone stays ₹56,250; the open one gives up the difference; nothing over-scheduled', async () => {
    const [r] = await rule([{ before: EV, after: { ...EV, billing: 200000 }, pays: [PAY] }]);
    assert.deepEqual(r.rows, [['Booking', 56250, 'paid', true], ['Before the event', 143750, 'upcoming', false]]);
    assert.equal(r.over, 0); assert.equal(r.total, 200000);
  });

  await test('nothing is kept when the milestone is not fully paid, or the bill did not change', async () => {
    const part = { ...PAY, amt: 50000 };
    const [unpaid, same] = await rule([{ before: EV, after: { ...EV, billing: 240000 }, pays: [part] }, { before: EV, after: { ...EV, venue: 'Sample Lawn' }, pays: [PAY] }]);
    assert.deepEqual(unpaid.plan.map(m => m.fixedAmt), [undefined, undefined]);
    assert.deepEqual(unpaid.rows[0], ['Booking', 60000, 'due', false], 'an unpaid milestone follows the new bill');
    assert.deepEqual(same.plan.map(m => m.fixedAmt), [undefined, undefined]);
  });

  await test('in the app: editing the bill keeps the paid milestone, shows "kept as paid" and nothing due', async () => {
    await load(); await open();
    await setBill(240000);
    const ev = await stored();
    assert.equal(ev.billing, 240000);
    assert.deepEqual(ev.payPlan.map(m => m.fixedAmt), [56250, undefined]);
    const box = await p.locator('#pay-schedule').innerText();
    assert.match(box, /Due now ₹0/);
    assert.match(box, /Booking · On booking · kept as paid/);
    assert.match(box, /₹56,250/); assert.match(box, /₹1,80,000/); assert.match(box, /₹3,750/);
  });

  await test('the plan editor keeps it when re-saved; changing that milestone\'s % works it out on the bill again', async () => {
    await p.locator('#pay-schedule [data-action="plan-edit"]').click(); await p.waitForSelector('#plan-modal.active');
    assert.match(await p.locator('#plan-sum').innerText(), /scheduled ₹2,36,250 · ₹3,750 left as balance after the event/);
    await p.locator('#btn-save-plan').click(); await p.waitForTimeout(500);
    assert.deepEqual((await stored()).payPlan.map(m => m.fixedAmt), [56250, undefined]);
    await p.locator('#pay-schedule [data-action="plan-edit"]').click(); await p.waitForSelector('#plan-modal.active');
    await p.locator('#plan-rows [data-pm="0"] [data-k="amt"]').fill('20');
    await p.locator('#plan-rows [data-pm="1"] [data-k="amt"]').fill('80');
    await p.locator('#btn-save-plan').click(); await p.waitForTimeout(500);
    assert.deepEqual((await stored()).payPlan.map(m => [m.pct, m.fixedAmt]), [[20, undefined], [80, undefined]]);
  });

  await test('the bill then drops below what was planned: the plan can still be re-saved', async () => {
    await load(); await open();
    await setBill(240000); await setBill(200000);
    assert.deepEqual((await stored()).payPlan.map(m => m.fixedAmt), [56250, undefined]);
    await p.locator('#pay-schedule [data-action="plan-edit"]').click(); await p.waitForSelector('#plan-modal.active');
    await p.locator('#btn-save-plan').click(); await p.waitForTimeout(500);
    assert.equal(await p.locator('#plan-modal.active').count(), 0, 'saved, not refused as more than the bill');
    assert.match(await p.locator('#pay-schedule').innerText(), /₹1,43,750/);
  });

  await test('backups keep the kept amount; a broken one is refused', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const all = await db.exportAllData();
      await db.importAllData(JSON.parse(JSON.stringify(all)), 'replace');
      const back = (await db.exportAllData()).events.find(e => e.id === 'M1').payPlan[0].fixedAmt;
      const bad = JSON.parse(JSON.stringify(all)); bad.events.find(e => e.id === 'M1').payPlan[0].fixedAmt = 'lots';
      let refused = ''; try { await db.importAllData(bad, 'replace'); } catch (e) { refused = e.message; }
      return { back, refused, still: (await db.exportAllData()).events.find(e => e.id === 'M1').payPlan[0].fixedAmt }; });
    assert.equal(r.back, 56250);
    assert.ok(r.refused, 'a non-number is refused');
    assert.equal(r.still, 56250, 'and nothing was replaced');
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'milestone-kept FAIL' : 'paid % milestones keep their amount when the bill changes PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('milestone-kept FAIL'); process.exitCode = 1; });
