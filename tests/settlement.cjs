// Phase 4 P4-C final settlement (spec §6.7, §10.3, G-35): a lower payment never changes the bill by itself;
// the rest stays owed (optionally disputed) until the owner agrees a logged discount/waiver/write-off. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const DATA = { version: 'ffv2', photos: [], vendors: [], vPays: [],
  events: [{ id: 'E', name: 'Sample Reception', date: day(-2), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 448000, guests: 560, photoIds: [] },
    { id: 'U', name: 'Sample Upcoming', date: day(10), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 100, photoIds: [] }],
  cPays: [{ id: 'c1', evId: 'E', amt: 100000, date: day(-20), mode: 'UPI' }, { id: 'c2', evId: 'E', amt: 340000, date: day(-1), mode: 'Cash – रोख' }],
  expenses: [{ id: 'x1', evId: 'E', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 300000, date: day(-2), pay: 'paid' }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const ev = async () => (await dump()).events.find(e => e.id === 'E');
  const status = () => p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData(); const e = d.events.find(x => x.id === 'E');
    return { ...u.settlementStatus(e, d.cPays), pl: u.calcEventPL(e, d.cPays, d.expenses).profit, recon: u.reconStatus(e, d.expenses).state }; });
  const openEvent = async id => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator(`#ev-list [data-action="evdetail"][data-id="${id}"]:visible`).click(); await p.waitForSelector('#tab-evdetail .detail-name'); };
  const openSettle = async () => { await openEvent('E'); await p.locator('[data-action="settle-open"]').click(); await p.waitForSelector('#settle-modal.active'); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  await p.evaluate(async () => { const db = await import('./db.js'), u = await import('./utils.js'); const d = await db.exportAllData(); const { _rev, ...e } = d.events.find(x => x.id === 'E');
    await db.putOne('events', { ...e, ...u.reconcileFields(e, d.expenses, ['bills', 'shared', 'final']) }); });

  await test('G-35: bill ₹4,48,000, client pays ₹4,40,000 → ₹8,000 still owed; nothing is changed by the payment', async () => {
    const s = await status();
    assert.deepEqual([s.billed, s.received, s.outstanding, s.adjusted, s.pl], [448000, 440000, 8000, 0, 148000]);
    await openSettle();
    const t = await p.locator('#settle-body').innerText();
    assert.match(t, /Bill now\s*₹4,48,000[\s\S]*Received\s*₹4,40,000[\s\S]*Still owed\s*₹8,000/);
    assert.match(t, /the rest stays owed until you decide/);
    await openEvent('U'); assert.equal(await p.locator('#settle-line').count(), 0, 'no settlement line before an event with nothing to settle');
  });

  await test('marking it disputed keeps it owed, with the reason', async () => {
    await openSettle(); await p.fill('#st-amt', '8000'); await p.fill('#st-reason', 'client says 10 plates were short');
    await p.locator('[data-action="settle-dispute"]').click(); await p.waitForTimeout(400);
    const e = await ev(); assert.deepEqual([e.billing, e.dispute.amt, e.dispute.reason], [448000, 8000, 'client says 10 plates were short']);
    assert.equal((await status()).disputed, 8000);
    await openEvent('E'); assert.match(await p.locator('#settle-line').innerText(), /Disputed ₹8,000 · client says 10 plates were short/);
  });

  await test('lowering the bill needs an amount within what is owed, a kind and a reason; Cancel changes nothing', async () => {
    await openSettle(); await p.fill('#st-amt', '9000'); await p.selectOption('#st-kind', 'discount'); await p.fill('#st-reason', 'round figure');
    await p.locator('[data-action="settle-adjust"]').click(); await p.waitForTimeout(300);
    assert.equal((await ev()).billing, 448000, 'more than owed: refused');
    await p.fill('#st-amt', '8000'); await p.selectOption('#st-kind', ''); await p.locator('[data-action="settle-adjust"]').click(); await p.waitForTimeout(300);
    assert.equal((await ev()).billing, 448000, 'no kind: refused');
    await p.selectOption('#st-kind', 'discount'); await p.fill('#st-reason', ''); await p.locator('[data-action="settle-adjust"]').click(); await p.waitForTimeout(300);
    assert.equal((await ev()).billing, 448000, 'no reason: refused');
    await p.fill('#st-reason', 'round figure agreed at handover'); await p.locator('[data-action="settle-adjust"]').click(); await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-msg').innerText(), /Discount agreed: bill ₹4,48,000 → ₹4,40,000\. The event's contribution falls by ₹8,000; payments received stay as they are[\s\S]*accountant's review/);
    await p.locator('#ask-actions button').last().click(); await p.waitForTimeout(300);
    assert.equal((await ev()).billing, 448000, 'cancel: nothing changed');
  });

  await test('an agreed discount lowers the bill with a logged reason, clears the dispute, reopens reconciliation and flags tax review', async () => {
    await p.selectOption('#st-ack', 'verbal'); await p.locator('[data-action="settle-adjust"]').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button').first().click(); await p.waitForTimeout(500);
    const e = await ev();
    assert.equal(e.billing, 440000); assert.equal(e.dispute, undefined, 'nothing left in dispute');
    const c = e.billChanges[0]; assert.deepEqual({ ...c, at: !!c.at }, { at: true, from: 448000, to: 440000, reason: 'round figure agreed at handover', kind: 'discount', ack: 'verbal', taxReview: true });
    const d = await dump(); assert.deepEqual(d.cPays.map(x => x.amt), [100000, 340000], 'receipts untouched');
    const s = await status();
    assert.deepEqual([s.outstanding, s.adjusted, s.original, s.pl, s.recon, s.taxReview], [0, 8000, 448000, 140000, 'reopened', true]);
    await openEvent('E');
    const line = await p.locator('#settle-line').innerText();
    assert.match(line, /Discount agreed ₹8,000 · round figure agreed at handover/); assert.match(line, /Tax \/ invoice review needed/);
    await p.locator('#n-summary:visible').click(); await p.locator('#tab-summary [data-period-seg] [data-id="all"]').click();
    assert.match(await p.locator('#books-check').innerText(), /Discounts \/ waivers \/ write-offs agreed \(tax review needed\)\s*₹8,000/);
  });

  await test('backup keeps the settlement exactly; invented kinds, increases and reasonless disputes are refused', async () => {
    const strip = ({ _rev, ...e }) => e;
    const before = await ev();
    const after = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); await db.importAllData(JSON.parse(JSON.stringify(d)), 'replace'); return (await db.exportAllData()).events.find(e => e.id === 'E'); });
    assert.deepEqual(strip(after), strip(before));
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const out = [];
      for (const f of [e => { e.billChanges[0].kind = 'roundoff'; }, e => { e.billChanges[0].to = 450000; }, e => { e.dispute = { amt: 100, reason: ' ', at: 'x' }; }]) {
        const d = await db.exportAllData(); delete d.manifest; f(d.events.find(e => e.id === 'E'));
        try { await db.importAllData(d, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message.split(':')[0].split('.')[0]); } }
      return out; });
    assert.deepEqual(r, ['Invalid bill history', 'Invalid bill history', 'Invalid dispute']);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'settlement FAIL' : 'final settlement: receipt vs bill vs agreed discount (G-35) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('settlement FAIL'); process.exitCode = 1; });
