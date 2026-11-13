// Phase 3 P3-C shared bills (spec §6.2 shared resources, G-13): one bill split across events, counted once.
// Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const DATA = { version: 'ffv2', cPays: [], vPays: [],
  vendors: [{ id: 'vt', name: 'Sample Tempo', cat: 'Operations' }, { id: 'vh', name: 'Sample Hire', cat: 'Operations' }, { id: 'vx', name: 'Sample Other Tempo', cat: 'Operations' }],
  events: [{ id: 'A', name: 'Sample Lunch Event', date: day(-3), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 100, photoIds: [] },
    { id: 'B', name: 'Sample Dinner Event', date: day(-3), venue: 'Sample Lawn', type: 'Birthday – वाढदिवस', billing: 80000, guests: 80, photoIds: [] }],
  expenses: [{ id: 't1', evId: 'A', cat: 'Operations', head: 'Transport – वाहतूक', amt: 8000, date: day(-3), pay: 'credit', venId: 'vt', dueDate: '', billIds: ['bill1'] },
    { id: 'h1', evId: 'A', cat: 'Operations', head: 'Rented Material – भाड्याचे साहित्य', amt: 5000, date: day(-3), pay: 'credit', venId: 'vh', dueDate: '', billIds: [] }],
  photos: [{ id: 'bill1', expenseId: 't1', data: PNG, createdAt: '2026-11-10T00:00:00.000Z' }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const totals = () => p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData();
    return { A: u.calcEventExpenses('A', d.expenses), B: u.calcEventExpenses('B', d.expenses), all: u.sumRupees(d.expenses),
      vt: u.calcVendorBalance('vt', d.expenses, d.vPays).balance, vh: u.calcVendorBalance('vh', d.expenses, d.vPays).balance }; });
  const fresh = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); };
  const openExpense = async id => { await fresh(); await p.locator('#n-expenses:visible').click(); await p.locator(`#exp-list [data-action="edit-exp"][data-id="${id}"]:visible`).first().click(); await p.waitForSelector('#exp-modal.active'); };
  const share = async (rows, { equal = false } = {}) => {
    await p.locator('#btn-share-exp').click(); await p.waitForSelector('#split-modal.active');
    for (let i = 0; i < rows.length; i++) {
      if (!(await p.locator(`#split-rows [data-sp="${i}"]`).count())) await p.locator('#btn-split-add').click();
      if (rows[i].evId) await p.locator(`#split-rows [data-sp="${i}"] [data-k="evId"]`).selectOption(rows[i].evId);
      if (rows[i].amt != null) await p.locator(`#split-rows [data-sp="${i}"] [data-k="amt"]`).fill(String(rows[i].amt));
    }
    if (equal) await p.locator('#btn-split-equal').click();
    await p.locator('#btn-save-split').click(); await p.waitForTimeout(500);
  };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);

  await test('G-13: ₹8,000 transport and ₹5,000 hire shared by two events are counted once (₹13,000) and split as entered', async () => {
    const before = await totals();
    await openExpense('t1'); await share([{ evId: 'A' }, { evId: 'B' }], { equal: true });
    await openExpense('h1'); await share([{ evId: 'A', amt: 3000 }, { evId: 'B', amt: 2000 }]);
    const t = await totals();
    assert.deepEqual(t, { A: 7000, B: 6000, all: 13000, vt: before.vt, vh: before.vh }, 'per-event parts, one total, vendors owed the same');
    const d = await dump();
    const tp = d.expenses.filter(x => x.split?.total === 8000);
    assert.equal(tp.length, 2); assert.deepEqual(tp.map(x => x.amt).sort(), [4000, 4000]);
    assert.equal(new Set(tp.map(x => x.split.id)).size, 1);
    assert.deepEqual(tp.find(x => x.id === 't1').billIds, ['bill1'], 'bill photo stays with the original');
    assert.deepEqual(tp.find(x => x.id !== 't1').billIds, []);
    assert(tp.every(x => x.venId === 'vt' && x.pay === 'credit' && x.head === 'Transport – वाहतूक'));
    await p.locator('#n-expenses:visible').click();
    assert.match(await p.locator('#exp-list').innerText(), /shared · ₹8,000 bill/);
  });

  await test('editing one part: amount and event are locked; vendor/date/payment apply to every part', async () => {
    const other = (await dump()).expenses.find(x => x.split?.total === 8000 && x.id !== 't1');
    await openExpense(other.id);
    assert.equal(await p.locator('#exp-amt').isDisabled(), true); assert.equal(await p.locator('#exp-ev').isDisabled(), true);
    assert.match(await p.locator('#exp-split-note').innerText(), /Shared bill: this event's part of ₹8,000 across 2 events/);
    await p.selectOption('#exp-vendor', 'vx'); await p.locator('#btn-save-exp').click(); await p.waitForTimeout(500);
    const parts = (await dump()).expenses.filter(x => x.split?.total === 8000);
    assert(parts.every(x => x.venId === 'vx'), 'vendor changed on both parts'); assert.deepEqual(parts.map(x => x.amt).sort(), [4000, 4000]);
    const t = await totals(); assert.equal(t.all, 13000); assert.equal(t.vt, 0, 'the whole transport bill moved to the other vendor');
    assert.equal(await p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData(); return u.calcVendorBalance('vx', d.expenses, d.vPays).balance; }), 8000, 'owed once: ₹8,000, not ₹16,000');
  });

  await test('a split must add up to the bill and use each event once', async () => {
    await openExpense('h1'); await p.locator('#btn-share-exp').click(); await p.waitForSelector('#split-modal.active');
    // The row order follows the part opened; find B's row by its event
    const bRow = await p.locator('#split-rows [data-sp]').evaluateAll(rs => rs.findIndex(r => r.querySelector('[data-k="evId"]').value === 'B'));
    await p.locator(`#split-rows [data-sp="${bRow}"] [data-k="amt"]`).fill('2500'); await p.locator('#btn-save-split').click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#toast-msg').innerText(), /add up to 5500, not the bill's 5000/); assert.equal(await p.locator('#split-modal.active').count(), 1);
    await p.locator(`#split-rows [data-sp="${bRow}"] [data-k="amt"]`).fill('2000'); await p.locator(`#split-rows [data-sp="${bRow}"] [data-k="evId"]`).selectOption('A');
    await p.locator('#btn-save-split').click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#toast-msg').innerText(), /only once/);
    assert.equal((await totals()).all, 13000, 'nothing changed');
    const eq = await p.evaluate(async () => (await import('./utils.js')).equalSplit(100.01, 3)); assert.deepEqual(eq, [33.33, 33.33, 33.35]);
  });

  await test('deleting a shared bill removes every part; Undo brings every part back', async () => {
    await openExpense('h1');
    await p.locator('#btn-del-exp').click(); await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-msg').innerText(), /shared across 2 events/);
    await p.locator('#ask-actions button').first().click(); await p.waitForSelector('#toast.show.has-action');
    assert.equal((await totals()).all, 8000);
    await p.locator('#toast-action').click(); await p.waitForTimeout(600);
    const t = await totals(); assert.equal(t.all, 13000); assert.deepEqual([t.A, t.B], [7000, 6000]);
  });

  await test('removing the other events puts the whole bill back on one event', async () => {
    await openExpense('t1'); await p.locator('#btn-share-exp').click(); await p.waitForSelector('#split-modal.active');
    await p.locator('#split-rows [data-sp-del="1"]').click();
    await p.locator('#split-rows [data-sp="0"] [data-k="amt"]').fill('8000'); await p.locator('#btn-save-split').click(); await p.waitForTimeout(500);
    const d = await dump(); const t1 = d.expenses.find(x => x.id === 't1');
    assert.equal(t1.amt, 8000); assert.equal('split' in t1, false); assert.equal(d.expenses.filter(x => x.head === 'Transport – वाहतूक').length, 1);
    const t = await totals(); assert.deepEqual([t.A, t.B, t.all], [11000, 2000, 13000]);
  });

  await test('import refuses a malformed shared bill', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest; d.expenses[0].split = { id: 5, total: 'x' };
      try { await db.importAllData(d, 'replace'); return 'accepted'; } catch (e) { return e.message; } });
    assert.equal(r, 'Invalid shared bill');
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'shared bills FAIL' : 'shared bills (G-13) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('shared bills FAIL'); process.exitCode = 1; });
