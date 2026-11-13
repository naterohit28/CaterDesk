// Phase 4 P4-A supplier bills (spec §10.1–10.4, scenarios I-01/I-02, G-07, G-08, G-25): one bill = one payable,
// parts to events or common stock, conserved on every reallocation; bill numbers warn on duplicates. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // local date, as the app uses
const ev = (id, name, date, billing) => ({ id, name, date, venue: 'Sample Hall', type: 'Wedding – लग्न', billing, guests: 100, photoIds: [] });
const DATA = { version: 'ffv2', photos: [], cPays: [],
  vendors: [{ id: 'vg', name: 'Sample Grocer', cat: 'Raw Material' }, { id: 'vm', name: 'Sample Mandap', cat: 'Operations' }, { id: 'vl', name: 'Sample Old Supplier', cat: 'Raw Material' }],
  events: [ev('S', 'Sample Event One', day(-6), 100000), ev('P', 'Sample Event Two', day(-5), 80000), ev('R', 'Sample Event Three', day(-4), 90000),
    ev('L', 'Sample Later Event', day(-2), 60000), ev('M', 'Sample Mandap Event', day(-3), 200000)],
  // A legacy credit purchase (no `pay` field, vendor-linked = owed) and a legacy repayment, as older backups hold them
  expenses: [{ id: 'g1', evId: 'S', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 40000, date: day(-6), pay: 'credit', venId: 'vg', dueDate: '', billIds: [] },
    { id: 'm1', evId: 'M', cat: 'Operations', head: 'Mandap – मंडप', amt: 100000, date: day(-3), pay: 'credit', venId: 'vm', dueDate: '', billIds: [] },
    { id: 'old1', evId: 'L', cat: 'Raw Material', head: 'Vegetables – भाजी', amt: 12000, date: day(-2), venId: 'vl', billIds: [] },
    { id: 'l2', evId: 'L', cat: 'Raw Material', head: 'Milk – दूध', amt: 3000, date: day(-2), pay: 'paid', mode: 'Cash – रोख', billIds: [] }],
  vPays: [{ id: 'vp-old', venId: 'vl', amt: 5000, date: day(-1), mode: 'Cash – रोख' }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const figures = () => p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData();
    const cost = id => u.calcEventExpenses(id, d.expenses), bal = id => u.calcVendorBalance(id, d.expenses, d.vPays).balance;
    return { S: cost('S'), P: cost('P'), R: cost('R'), L: cost('L'), M: cost('M'), stock: u.stockTotal(d.expenses), all: u.sumRupees(d.expenses),
      vg: bal('vg'), vm: bal('vm'), vl: bal('vl'), periodExp: u.sumRupees(u.sliceByPeriod(d, 'all').expenses) }; });
  const fresh = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); };
  const openExpense = async id => { await fresh(); await p.locator('#n-expenses:visible').click(); await p.locator(`#exp-list [data-action="edit-exp"][data-id="${id}"]:visible`).first().click(); await p.waitForSelector('#exp-modal.active'); };
  const share = async rows => {
    await p.locator('#btn-share-exp').click(); await p.waitForSelector('#split-modal.active');
    for (let i = 0; i < rows.length; i++) {
      if (!(await p.locator(`#split-rows [data-sp="${i}"]`).count())) await p.locator('#btn-split-add').click();
      await p.locator(`#split-rows [data-sp="${i}"] [data-k="evId"]`).selectOption(rows[i].evId);
      await p.locator(`#split-rows [data-sp="${i}"] [data-k="amt"]`).fill(String(rows[i].amt));
    }
    while (await p.locator(`#split-rows [data-sp="${rows.length}"]`).count()) await p.locator(`#split-rows [data-sp-del="${rows.length}"]`).click();
    await p.locator('#btn-save-split').click(); await p.waitForTimeout(500);
  };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  // Event L is reconciled before anything moves onto it, so a later cost must reopen it (I-03)
  await p.evaluate(async () => { const db = await import('./db.js'), u = await import('./utils.js'); const d = await db.exportAllData(); const e = d.events.find(x => x.id === 'L'); const { _rev, ...r } = e;
    await db.putOne('events', { ...r, ...u.reconcileFields(r, d.expenses, ['bills', 'shared', 'final']) }); });

  await test('G-07 / I-01: one ₹40,000 grocery bill → 14k / 9k / 11k to three events and 6k common stock; owed ₹40,000 once', async () => {
    await openExpense('g1'); await share([{ evId: 'S', amt: 14000 }, { evId: 'P', amt: 9000 }, { evId: 'R', amt: 11000 }, { evId: '__stock', amt: 6000 }]);
    assert.match(await p.locator('#toast-msg').innerText(), /₹6,000 kept as common stock/);
    const f = await figures();
    assert.deepEqual([f.S, f.P, f.R, f.stock, f.vg], [14000, 9000, 11000, 6000, 40000]);
    assert.equal(f.all - f.periodExp, 6000, 'stock is in the money spent but in no event or period total');
    const parts = (await dump()).expenses.filter(x => x.split?.total === 40000);
    assert.equal(parts.length, 4); assert.equal(new Set(parts.map(x => x.split.id)).size, 1);
    const st = parts.find(x => x.stock); assert.equal(st.evId, ''); assert.equal(st.amt, 6000);
    const log = parts.find(x => x.id === 'g1').allocLog;
    assert.equal(log.length, 1); assert.deepEqual(log[0].from, [{ evId: 'S', amt: 40000 }]);
    assert.deepEqual(log[0].parts, [{ evId: 'S', amt: 14000 }, { evId: 'P', amt: 9000 }, { evId: 'R', amt: 11000 }, { evId: '', amt: 6000 }]);
    assert(parts.filter(x => x.id !== 'g1').every(x => !x.allocLog), 'history kept once, on the bill photo part');
    // Shown as stock, not as an event
    await p.locator('#exp-modal [data-action="close-modal"]').click().catch(() => {});
    await fresh(); await p.locator('#n-expenses:visible').click();
    await p.locator('#exp-ev-filter').selectOption('__stock');
    const list = await p.locator('#exp-list').innerText();
    assert.match(list, /Common stock/); assert.match(list, /6,000/); assert.doesNotMatch(list, /14,000/);
  });

  await test('the stock part opens locked to stock; the summary lists stock apart from contribution', async () => {
    const st = (await dump()).expenses.find(x => x.stock);
    await openExpense(st.id);
    assert.equal(await p.locator('#exp-ev').isDisabled(), true); assert.equal(await p.locator('#exp-amt').isDisabled(), true);
    assert.match(await p.locator('#exp-ev').innerText(), /Common stock/);
    assert.match(await p.locator('#exp-split-note').innerText(), /common-stock part of ₹40,000/);
    await p.fill('#exp-notes', 'kept in store room'); await p.locator('#btn-save-exp').click(); await p.waitForTimeout(400);
    const after = (await dump()).expenses.find(x => x.id === st.id);
    assert.deepEqual([after.evId, after.stock, after.amt, after.notes], ['', true, 6000, 'kept in store room']);
    await fresh(); await p.locator('#n-summary:visible').click(); await p.locator('#tab-summary [data-period-seg] [data-id="all"]').click();
    await p.waitForSelector('#books-check');
    assert.match(await p.locator('#books-check').innerText(), /Bills ₹1,55,000 = event costs ₹1,49,000 \+ common stock ₹6,000/);
  });

  await test('moving ₹4,000 of stock to a later event: bill and payable unchanged, history kept, reconciled event reopens', async () => {
    await openExpense('g1');
    await share([{ evId: 'S', amt: 14000 }, { evId: 'P', amt: 9000 }, { evId: 'R', amt: 11000 }, { evId: '__stock', amt: 2000 }, { evId: 'L', amt: 4000 }]);
    const f = await figures();
    assert.deepEqual([f.S, f.P, f.R, f.L, f.stock, f.vg], [14000, 9000, 11000, 19000, 2000, 40000]);
    const parts = (await dump()).expenses.filter(x => x.split?.total === 40000);
    assert.equal(parts.reduce((s, x) => s + x.amt, 0), 40000, 'conserved');
    const logged = parts.filter(x => x.allocLog); assert.equal(logged.length, 1, 'history on one part only'); const log = logged[0].allocLog;
    assert.equal(log.length, 2); assert(log[1].from.some(x => x.evId === '' && x.amt === 6000)); assert(log[1].parts.some(x => x.evId === 'L' && x.amt === 4000));
    const st = await p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData(); return u.reconStatus(d.events.find(e => e.id === 'L'), d.expenses).state; });
    assert.equal(st, 'reopened');
    // A split that does not add up is refused and nothing changes
    await openExpense('g1'); await share([{ evId: 'S', amt: 14000 }, { evId: '__stock', amt: 1 }]);
    assert.match(await p.locator('#toast-msg').textContent(), /add up to 14001, not the bill's 40000/);
    assert.equal((await figures()).stock, 2000);
  });

  await test("G-08 / I-02: ₹1,00,000 bill, ₹40,000 paid → ₹60,000 owed; the event's cost stays ₹1,00,000; overpaying shows an advance", async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); await db.putOne('vPays', { id: 'vp1', venId: 'vm', amt: 40000, date: new Date().toISOString().slice(0, 10), mode: 'UPI' }); });
    let f = await figures(); assert.deepEqual([f.vm, f.M], [60000, 100000]);
    await p.evaluate(async () => { const db = await import('./db.js'); await db.putOne('vPays', { id: 'vp2', venId: 'vm', amt: 70000, date: new Date().toISOString().slice(0, 10), mode: 'UPI' }); });
    f = await figures(); assert.deepEqual([f.vm, f.M], [-10000, 100000]);
    await fresh(); await p.locator('#n-vendors:visible').click(); await p.locator('[data-action="vendetail"][data-id="vm"]:visible').first().click();
    await p.waitForTimeout(300);
    assert.match(await p.locator('#tab-vendetail').innerText(), /Advance\n₹10,000/);
  });

  await test('G-25: legacy credit (no pay field) and repayment sit beside v5 bills; balances and costs add up with nothing twice', async () => {
    const f = await figures();
    assert.equal(f.vl, 7000, 'legacy ₹12,000 owed − ₹5,000 repaid');
    assert.equal(f.L, 12000 + 3000 + 4000, 'legacy, paid and moved-stock costs on one event');
    assert.equal(f.S + f.P + f.R + f.L + f.M + f.stock, f.all, 'every rupee is on exactly one event or in stock');
    assert.equal(f.vg + f.vm + f.vl, 40000 + (100000 - 110000) + 7000, 'payables are bills minus payments, each bill once');
    const legacy = (await dump()).expenses.find(x => x.id === 'old1');
    assert.equal(legacy.pay, undefined, 'legacy record left as it was');
  });

  await test('bill numbers: the same vendor bill number again is warned, not blocked; Cancel saves nothing', async () => {
    await openExpense('g1'); await p.fill('#exp-billno', 'INV-101'); await p.locator('#btn-save-exp').click(); await p.waitForTimeout(400);
    let d = await dump(); assert(d.expenses.filter(x => x.split?.total === 40000).every(x => x.billNo === 'INV-101'), 'bill number on every part');
    // A different credit purchase from the same grocer, typed with the same number
    await p.evaluate(async () => { const db = await import('./db.js'); await db.putOne('expenses', { id: 'g2', evId: 'P', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 40000, date: new Date().toISOString().slice(0, 10), pay: 'credit', venId: 'vg', dueDate: '', billIds: [] }); });
    await openExpense('g2'); await p.fill('#exp-billno', 'inv 101'); await p.locator('#btn-save-exp').click(); await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-msg').innerText(), /Sample Grocer: bill no\. inv 101 is already recorded on .* for ₹40,000\. If it is the same bill, saving it again counts it twice/);
    await p.locator('#ask-actions button').last().click(); await p.waitForTimeout(300);
    assert.equal((await dump()).expenses.find(x => x.id === 'g2').billNo, undefined, 'cancel: nothing saved');
    await p.locator('#btn-save-exp').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button').first().click(); await p.waitForTimeout(400);
    assert.equal((await dump()).expenses.find(x => x.id === 'g2').billNo, 'inv 101', 'a genuinely different bill can still be saved');
    // Unchanged number: no second warning
    await openExpense('g2'); await p.fill('#exp-notes', 'second load'); await p.locator('#btn-save-exp').click(); await p.waitForTimeout(400);
    assert.equal(await p.locator('#ask-modal.active').count(), 0);
    // Clearing it removes it
    await openExpense('g2'); await p.fill('#exp-billno', ''); await p.locator('#btn-save-exp').click(); await p.waitForTimeout(400);
    assert.equal('billNo' in (await dump()).expenses.find(x => x.id === 'g2'), false);
  });

  await test('conservation: any split in paise adds back to the bill; equal splits never lose a paisa', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js'); let bad = 0, seed = 7; const rnd = n => (seed = (seed * 16807) % 2147483647) % n;
      for (let i = 0; i < 400; i++) {
        const total = (1 + rnd(50000000)) / 100, n = 1 + rnd(6), parts = u.equalSplit(total, n);
        const rows = parts.map((amt, j) => ({ evId: j === n - 1 && n > 1 ? u.STOCK : 'E' + j, amt }));
        for (let k = rows.length - 1; k > 0; k--) { const j = rnd(k + 1); [rows[k], rows[j]] = [rows[j], rows[k]]; }
        if (u.checkSplit(rows, total) !== '') bad++;
        if (rows.length > 1 && u.checkSplit(rows.map((r, j) => j ? r : { ...r, amt: Math.round((r.amt + 0.01) * 100) / 100 }), total) === '') bad++;
      }
      return bad; });
    assert.equal(r, 0);
  });

  await test('backup keeps bill parts, stock, bill numbers and history exactly; malformed values are refused', async () => {
    const strip = d => d.expenses.map(({ _rev, ...x }) => x).sort((a, b) => a.id.localeCompare(b.id));
    const before = await dump();
    const after = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); await db.importAllData(JSON.parse(JSON.stringify(d)), 'replace'); return db.exportAllData(); });
    assert.deepEqual(strip(after), strip(before));
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const out = [];
      for (const f of [x => { x.stock = true; x.evId = 'S'; }, x => { x.billNo = 101; }, x => { x.allocLog = [{ at: 'x', parts: [{ evId: 'S', amt: -1 }] }]; }, x => { x.evId = ''; delete x.stock; }]) {
        const d = await db.exportAllData(); delete d.manifest; f(d.expenses.find(x => x.id === 'g1'));
        try { await db.importAllData(d, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message.split(':')[0].split('.')[0]); } }
      return out; });
    assert.deepEqual(r, ['Invalid common stock entry', 'Invalid bill number', 'Invalid money amount', 'Missing events reference in expenses']);
    assert.deepEqual(strip(await dump()), strip(before), 'refused imports change nothing');
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'supplier bills FAIL' : 'supplier bills, common stock and payables (G-07, G-08, G-25) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('supplier bills FAIL'); process.exitCode = 1; });
