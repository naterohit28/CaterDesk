// Phase 3 P3-F guest count / extra plates (spec §6.7, G-31–G-34, G-37). Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], vendors: [],
  events: [{ id: 'E', name: 'Sample Reception', date: day(-1), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 405250, guests: 500, photoIds: [],
    meals: ['breakfast', 'dinner'], mealPlan: { breakfast: { guests: 35, rate: 150 }, dinner: { guests: 500, rate: 800 } } }],
  expenses: [{ id: 'x1', evId: 'E', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 200000, date: day(-1), pay: 'paid' }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const ev = async () => (await p.evaluate(async () => (await import('./db.js')).exportAllData())).events[0];
  const status = key => p.evaluate(async k => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData(); return u.guestCountStatus(d.events[0], k); }, key);
  const openCounts = async meal => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="E"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    await p.locator('[data-action="count-open"]').click(); await p.waitForSelector('#count-modal.active');
    if (meal) await p.locator(`#count-meals [data-count-meal="${meal}"]`).click(); };
  const record = async (n, note = '') => { await p.fill('#count-n', String(n)); if (note) await p.fill('#count-note', note); await p.locator('[data-action="count-save"]').click(); await p.waitForTimeout(400); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  // Reconcile first, so the bill change later must reopen it
  await p.evaluate(async () => { const db = await import('./db.js'), u = await import('./utils.js'); const d = await db.exportAllData(); const { _rev, ...e } = d.events[0];
    await db.putOne('events', { ...e, ...u.reconcileFields(e, d.expenses, ['bills', 'shared', 'final']) }); });

  await test('G-31: 500 guaranteed, 560 counted, 60 asked: guarantee kept, 60 pending, nothing billed', async () => {
    await openCounts('dinner');
    assert.match(await p.locator('#count-body').innerText(), /Dinner · contracted 500 @ ₹800[\s\S]*Not counted yet/);
    await record(560, 'plates issued by 10 pm');
    let s = await status('dinner');
    assert.deepEqual([s.contracted, s.counted, s.extra, s.unrequested, s.requested], [500, 560, 60, 60, 0]);
    await p.locator('[data-action="count-request"]').click(); await p.waitForTimeout(400);
    s = await status('dinner');
    assert.deepEqual([s.requested, s.accepted, s.billed, s.unrequested], [60, 0, 0, 0]);
    assert.equal((await ev()).billing, 405250, 'no bill change from a request');
    assert.equal('guests' in (await ev()) && (await ev()).guests, 500, 'the guests field is not overwritten by the count');
  });

  await test('G-32: client acknowledges 530 (30 extra) of the claimed 560: 30 accepted, 30 disputed, both kept', async () => {
    await openCounts('dinner');
    const id = (await status('dinner')).requests[0].id;
    await p.fill(`[data-accept="${id}"]`, '30'); await p.locator(`[data-action="count-accept"][data-id="${id}"]`).click(); await p.waitForTimeout(400);
    const s = await status('dinner');
    assert.deepEqual([s.accepted, s.disputed, s.unbilled, s.billed], [30, 30, 30, 0]);
    assert.match(await p.locator('#count-body').innerText(), /accepted 30 · disputed 30/);
    assert.equal((await ev()).billing, 405250, 'accepting does not bill by itself');
  });

  await test('adding approved plates to the bill is explicit, logged, and reopens reconciliation', async () => {
    const before = await p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData(); return u.reconStatus(d.events[0], d.expenses).state; });
    assert.equal(before, 'reconciled');
    await openCounts('dinner');
    await p.locator('[data-action="count-bill"]').click(); await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-msg').innerText(), /30 approved extra dinner plates: bill ₹4,05,250 → ₹4,29,250/);
    await p.locator('#ask-actions button').last().click(); await p.waitForTimeout(300);   // Cancel: nothing changes
    assert.equal((await ev()).billing, 405250);
    await p.locator('[data-action="count-bill"]').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button').first().click(); await p.waitForTimeout(500);
    const e = await ev();
    assert.equal(e.billing, 429250);
    assert.deepEqual(e.billChanges, [{ at: e.billChanges[0].at, from: 405250, to: 429250, reason: '30 approved extra dinner plates' }]);
    const s = await status('dinner'); assert.deepEqual([s.billed, s.unbilled, s.disputed], [30, 0, 30]);
    const after = await p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData(); return u.reconStatus(d.events[0], d.expenses); });
    assert.equal(after.state, 'reopened'); assert.deepEqual(after.changes.map(c => c.what), ['bill']);
  });

  await test('G-33: a tally of 525 corrected to 520 keeps both, with the reason and time', async () => {
    await openCounts('dinner');
    await record(525, '');
    assert.match(await p.locator('#count-modal').innerText(), /Say why the count changed/, 'a change needs a reason');
    await record(525, 'gate count'); await record(520, 'double-counted one table');
    const s = await status('dinner');
    assert.deepEqual(s.counts.map(c => c.n), [560, 525, 520], 'every tally kept');
    assert.equal(s.counts[2].reason, 'double-counted one table'); assert.equal(s.counts[2].correctionOf, s.counts[1].at);
    assert.match(await p.locator('#count-body').innerText(), /Count history \(3\)/);
  });

  await test('G-37: the approval made for the 560 count is kept and marked as for an earlier count; a new extra needs a new request', async () => {
    let s = await status('dinner');
    assert.equal(s.requests[0].forOlderCount, true, 'request belongs to the 560 count');
    assert.equal(s.requests[0].accepted, 30, 'older approval retained');
    assert.deepEqual([s.extra, s.unrequested], [20, 20], 'at 520 the extra is 20 and needs its own request');
    await openCounts('dinner'); assert.match(await p.locator('#count-body').innerText(), /made for an earlier count[\s\S]*Ask approval for 20 extra/);
  });

  await test('G-34: breakfast is counted on its own (35 guaranteed @ ₹150); dinner extras never use the breakfast rate', async () => {
    await openCounts('breakfast'); assert.match(await p.locator('#count-body').innerText(), /Breakfast · contracted 35 @ ₹150/);
    await record(35);
    const b = await status('breakfast'), d = await status('dinner');
    assert.deepEqual([b.contracted, b.counted, b.extra, b.rate], [35, 35, 0, 150]); assert.equal(d.rate, 800);
    await p.locator('#count-modal [data-action="close-modal"]').click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#count-line').innerText(), /Breakfast: contracted 35 · counted 35[\s\S]*Dinner: contracted 500 · counted 520 · extra 20 · approved 30 · disputed 30 · billed 30/);
  });

  await test('import refuses malformed counts and bill history', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const out = [];
      for (const bad of [{ guestCounts: { supper: { contracted: 1, rate: 1, counts: [], requests: [] } } }, { guestCounts: { dinner: { contracted: 500, rate: 800, counts: [{ n: -1, at: 'x' }], requests: [] } } },
        { guestCounts: { dinner: { contracted: 500, rate: 800, counts: [], requests: [{ qty: 10, rate: 800, status: 'approved', accepted: 11 }] } } }, { billChanges: [{ from: 1, to: 'x', reason: '' }] }]) {
        const d = await db.exportAllData(); delete d.manifest; Object.assign(d.events[0], bad);
        try { await db.importAllData(d, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message.split(':')[0].split('.')[0]); } }
      return out; });
    assert.deepEqual(r, ['Invalid guest count', 'Invalid guest count', 'Invalid guest count', 'Invalid money amount']);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'guest counts FAIL' : 'guest counts and extra plates (G-31–G-34, G-37) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('guest counts FAIL'); process.exitCode = 1; });
