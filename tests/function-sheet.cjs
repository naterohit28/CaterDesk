// Phase 3 P3-G: count method agreed before the event, WhatsApp extra-plate request (opening is not approval),
// written vs verbal approval evidence (G-24), the light function sheet (spec §9.3) and backup round trip (G-38).
// Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // local date, as the app uses
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'vd', name: 'Sample Dosa Counter', cat: 'Live Counter', phone: '9000000001' }],
  events: [{ id: 'E', name: 'Sample Wedding', date: day(3), venue: 'Sample Lawn', locality: 'Sample Nagar', type: 'Wedding – लग्न', billing: 400000, guests: 500, mobile: '9000000005', photoIds: [],
    meals: ['dinner'], mealPlan: { dinner: { guests: 500, rate: 800 } }, notes: 'Jain food on one counter',
    logistics: { power: 'generator', cover: 'open' },
    dishes: [{ name: 'Masala Dosa', head: 'Dosa – डोसा' }, { name: 'Paneer Masala', head: '' }],
    orders: [{ id: 'o1', head: 'Dosa – डोसा', venId: 'vd', plates: 375, status: 'confirmed' }],
    labour: { rows: [{ id: 'r1', role: 'Boys – बॉईज', rate: 600, counts: { e: 12 } }], pay: 'credit', mode: '', expIds: {} } }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const ev = async () => (await dump()).events[0];
  const openEvent = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="E"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200);
    await p.evaluate(() => { window.__opens = []; window.open = url => { window.__opens.push(decodeURIComponent(String(url))); return null; };
      window.__shared = []; navigator.share = d => { window.__shared.push(d); return Promise.resolve(); }; }); };
  const openCounts = async () => { await openEvent(); await p.locator('[data-action="count-open"]').click(); await p.waitForSelector('#count-modal.active'); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);

  await test('the count method is recorded before the event; until the client agrees it is flagged', async () => {
    await openEvent();
    assert.match(await p.locator('#count-line').innerText(), /Count method not agreed with the client yet/);
    await p.locator('[data-action="count-open"]').click(); await p.waitForSelector('#count-modal.active');
    assert.equal(await p.locator('#count-policy').evaluate(d => d.open), true, 'open while not agreed');
    // Ticking "agreed" without a method is refused
    await p.locator('#cp-confirmed').check(); await p.locator('[data-action="count-policy-save"]').click(); await p.waitForTimeout(300);
    assert.equal((await ev()).countPolicy, undefined);
    await p.selectOption('#cp-method', 'tokens'); await p.fill('#cp-counter', 'our supervisor at the plate counter');
    await p.fill('#cp-rep', 'Sample Rep'); await p.fill('#cp-rep-phone', '9000000002'); await p.fill('#cp-rules', 'second servings not counted; kids under 5 free');
    await p.locator('[data-action="count-policy-save"]').click(); await p.waitForTimeout(400);
    const cp = (await ev()).countPolicy;
    assert.deepEqual({ ...cp, confirmedAt: !!cp.confirmedAt }, { method: 'tokens', counter: 'our supervisor at the plate counter', rep: 'Sample Rep', repPhone: '9000000002',
      rules: 'second servings not counted; kids under 5 free', confirmed: true, confirmedAt: true });
    assert.match(await p.locator('#count-policy summary').innerText(), /Count method: Plate tokens issued · agreed/);
    await openEvent(); assert.equal(await p.locator('#count-policy-flag').count(), 0, 'flag gone once agreed');
  });

  await test('asking approval opens WhatsApp to the representative with the agreed figures, and stays "requested"', async () => {
    await openCounts(); await p.fill('#count-n', '560'); await p.locator('[data-action="count-save"]').click(); await p.waitForTimeout(400);
    await p.locator('[data-action="count-request"]').click(); await p.waitForSelector('#ask-modal.active');
    assert.deepEqual(await p.evaluate(() => window.__opens), [], 'nothing is opened before the request is saved');
    assert.equal((await ev()).guestCounts.dinner.requests[0].status, 'requested', 'saved first');
    await p.locator('#ask-actions button', { hasText: 'Open WhatsApp' }).click(); await p.waitForTimeout(300);
    const opens = await p.evaluate(() => window.__opens);
    assert.equal(opens.length, 1); assert.match(opens[0], /^https:\/\/wa\.me\/919000000002\?text=/);
    const r = (await ev()).guestCounts.dinner.requests[0];
    assert.equal(r.status, 'requested', 'opening WhatsApp is not approval');
    assert.equal(opens[0].endsWith(r.text), true, 'the text kept is the text sent');
    assert.match(r.text, /Hello Sample Rep, for Sample Wedding dinner on .*, the confirmed quantity is 500 covers at ₹800 per additional cover, before any applicable tax\. Our plate tokens issued currently shows 560, i\.e\. 60 more \(estimated ₹48,000\)\. Please reply "Approved: 60 extra dinner covers at ₹800 each"/);
    assert.equal((await ev()).billing, 400000);
  });

  await test('G-24: an approval must say whether it is written or verbal; verbal needs who approved; labels stay distinct', async () => {
    await openCounts(); const id = (await ev()).guestCounts.dinner.requests[0].id;
    await p.fill(`[data-accept="${id}"]`, '60'); await p.locator(`[data-action="count-accept"][data-id="${id}"]`).click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#toast-msg').innerText(), /written or verbal/); assert.equal((await ev()).guestCounts.dinner.requests[0].status, 'requested');
    await p.selectOption(`[data-evidence="${id}"]`, 'verbal'); await p.locator(`[data-action="count-accept"][data-id="${id}"]`).click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#toast-msg').innerText(), /who approved/); assert.equal((await ev()).guestCounts.dinner.requests[0].status, 'requested');
    await p.fill(`[data-by="${id}"]`, 'Sample Rep, at the stage, 10:15 pm'); await p.locator(`[data-action="count-accept"][data-id="${id}"]`).click(); await p.waitForTimeout(400);
    const r = (await ev()).guestCounts.dinner.requests[0];
    assert.deepEqual([r.status, r.accepted, r.evidence, r.by], ['approved', 60, 'verbal', 'Sample Rep, at the stage, 10:15 pm']);
    assert.match(await p.locator('#count-body').innerText(), /accepted 60 · verbal \(Sample Rep, at the stage, 10:15 pm\)/);
    assert.equal((await ev()).billing, 400000, 'approval alone does not bill');
  });

  await test('function sheet: menu, vendors, staff, counting, setup and timings for the team, with no money on it', async () => {
    await openEvent(); await p.locator('[data-action="fs-open"]').click(); await p.waitForSelector('#fs-modal.active');
    await p.fill('#fs-timings', 'team reaches 4 pm, dinner 8–11 pm'); await p.fill('#fs-setup', '6 counters, sweets table');
    const t = await p.locator('#fs-text').innerText();
    for (const re of [/FUNCTION SHEET – Sample Wedding/, /Venue: Sample Lawn, Sample Nagar/, /Client phone: 9000000005/, /Timings: team reaches 4 pm, dinner 8–11 pm/,
      /GUESTS\n- Dinner: 500/, /Method: Plate tokens issued \(agreed with client\)/, /Who counts: our supervisor at the plate counter/, /Client representative: Sample Rep, 9000000002/,
      /- Dosa: Masala Dosa\n  Sample Dosa Counter \(9000000001\) · 375 plates · Confirmed/, /- Our kitchen: Paneer Masala/, /STAFF\n- Boys: 12/,
      /SETUP\n- Electricity: Generator required\n- Setting: Open air\n- 6 counters, sweets table/, /NOTES\nJain food on one counter/]) assert.match(t, re);
    assert.doesNotMatch(t, /₹|400000|4,00,000|800/, 'internal sheet carries no prices or bill');
    await p.locator('[data-action="fs-share"]').click(); await p.waitForTimeout(400);
    const shared = await p.evaluate(() => window.__shared);
    assert.equal(shared.length, 1); assert.equal(shared[0].text, t, 'shared exactly what is shown');
    assert.deepEqual((await ev()).functionSheet, { timings: 'team reaches 4 pm, dinner 8–11 pm', setup: '6 counters, sweets table' });
    await p.locator('#fs-modal [data-action="close-modal"]').click(); await p.waitForTimeout(250);
  });

  await test('an event without an agreed method says so on its function sheet', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const { _rev, countPolicy, ...e } = d.events[0]; await db.putOne('events', e); });
    await openEvent(); await p.locator('[data-action="fs-open"]').click(); await p.waitForSelector('#fs-modal.active');
    assert.match(await p.locator('#fs-text').innerText(), /Method: not set – NOT AGREED WITH CLIENT YET/);
    await p.locator('#fs-modal [data-action="close-modal"]').click(); await p.waitForTimeout(250);
  });

  await test('G-38: count method, approval evidence and function sheet survive backup and restore exactly; bad values are refused', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const { _rev, ...e } = d.events[0];
      await db.putOne('events', { ...e, countPolicy: { method: 'joint', rep: 'Sample Rep', confirmed: true, confirmedAt: '2026-01-01T10:00:00.000Z' } }); });
    const before = await ev(); const strip = ({ _rev, ...e }) => e;
    const after = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); await db.importAllData(JSON.parse(JSON.stringify(d)), 'replace'); return (await db.exportAllData()).events[0]; });
    assert.deepEqual(strip(after), strip(before));
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const out = [];
      for (const f of [e => { e.countPolicy = { method: 'guess' }; }, e => { e.functionSheet = { timings: 5 }; }, e => { e.guestCounts.dinner.requests[0].evidence = 'whatsapp-opened'; }]) {
        const d = await db.exportAllData(); delete d.manifest; f(d.events[0]);
        try { await db.importAllData(d, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message.split(':')[0].split('.')[0]); } }
      return out; });
    assert.deepEqual(r, ['Invalid count arrangement', 'Invalid function sheet', 'Invalid guest count']);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'function sheet FAIL' : 'count method, approval evidence and function sheet (G-24, G-38) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('function sheet FAIL'); process.exitCode = 1; });
