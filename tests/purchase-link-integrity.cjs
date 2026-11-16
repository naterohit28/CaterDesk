// Purchase-linked bills stay on the purchase's event (4.28.1, Codex P1 on #66): the expense sheet cannot move a
// purchase's bill to another event; the database refuses any save that would; a bill 4.28.0 already moved keeps its
// amount and loses only the impossible link when edited or restored; such a backup restores in full on another device.
// Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const PO = { id: 'PO1', item: 'Mineral Water', src: 'buy', venId: 'vw', qty: 20, unit: 'carton', date: day(10), status: 'delivered', at: '2026-11-10T10:00:00.000Z',
  basis: { item: 'Mineral Water', src: 'buy' }, messages: [{ v: 1, text: 'Sample order', status: 'sent', at: '2026-11-10T10:00:00.000Z' }] };
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [],
  vendors: [{ id: 'vw', name: 'Sample Water Supply', cat: 'Raw Material', phone: '9000000032' }],
  events: [{ id: 'e1', name: 'Sample Purchase Wedding', date: day(10), venue: 'Sample Lawns', type: 'Wedding – लग्न', billing: 200000, guests: 200, photoIds: [],
      dishes: [{ name: 'Mineral Water', head: '', src: 'buy' }], purchases: [PO] },
    { id: 'e2', name: 'Sample Other Party', date: day(12), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 50000, guests: 60, photoIds: [] }],
  expenses: [{ id: 'x1', evId: 'e1', cat: 'Raw Material', head: 'Water – पाणी', amt: 2400, date: day(-1), pay: 'paid', mode: 'UPI', venId: 'vw', billIds: [], purchase: 'PO1' }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = page => page.evaluate(async () => (await import('./db.js')).exportAllData());
  const bill = async (page, id) => (await dump(page)).expenses.find(x => x.id === id);
  const openBill = async id => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-expenses:visible').click();
    await p.locator(`#exp-list [data-action="edit-exp"][data-id="${id}"]:visible`).first().click(); await p.waitForSelector('#exp-modal.active'); };
  const save = async () => { await p.locator('#btn-save-exp').click(); await p.waitForTimeout(600);
    while (await p.locator('#ask-modal.active').count()) { await p.locator('#ask-actions button').first().click(); await p.waitForTimeout(400); } };
  // What 4.28.0 could leave behind: a purchase's bill moved to another event (written straight to the database)
  const plantMovedBill = page => page.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open('FlavorFusionDB');
    r.onsuccess = () => { const tx = r.result.transaction('expenses', 'readwrite');
      tx.objectStore('expenses').put({ id: 'x9', evId: 'e2', cat: 'Raw Material', head: 'Water – पाणी', amt: 900, date: '2026-11-11', pay: 'paid', mode: 'Cash', venId: 'vw', billIds: [], purchase: 'PO1', _rev: 1 });
      tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error); }; r.onerror = () => rej(r.error); }));

  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA);

  await test('a purchase\'s bill: its event cannot be changed in the expense sheet, and saving keeps it on the purchase\'s event', async () => {
    await openBill('x1');
    assert.equal(await p.locator('#exp-ev').isDisabled(), true, 'event locked');
    await p.evaluate(() => { const s = document.getElementById('exp-ev'); s.disabled = false; s.value = 'e2'; s.dispatchEvent(new Event('change', { bubbles: true })); });   // forced past the lock
    await p.fill('#exp-amt', '2500'); await save();
    const x = await bill(p, 'x1'); assert.deepEqual([x.evId, x.purchase, x.amt], ['e1', 'PO1', 2500]);
  });

  await test('a new purchase bill saved with + Next: the next, ordinary expense can choose its event again (Codex P2 on #67)', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest;
      d.events[0].dishes.push({ name: 'Sample Ice', head: '', src: 'buy' });
      d.events[0].purchases.push({ ...d.events[0].purchases[0], id: 'PO2', svc: 'svc-all', item: 'Sample Ice', basis: { item: 'Sample Ice', src: 'buy' }, status: 'delivered' }); delete d.events[0]._rev; await db.importAllData(d, 'replace'); });
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="e1"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    await p.locator('#buy-list [data-buy="svc-all|sample ice"] [data-action="buy-status"]').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Record / link its bill' }).click(); await p.waitForSelector('#exp-modal.active');
    while (await p.locator('#ask-modal.active').count()) { await p.locator('#ask-actions button').last().click(); await p.waitForTimeout(300); }
    assert.equal(await p.locator('#exp-ev').isDisabled(), true, 'locked for the purchase bill');
    await p.fill('#exp-amt', '700'); await p.locator('#btn-save-exp-next').click(); await p.waitForTimeout(700);
    while (await p.locator('#ask-modal.active').count()) { await p.locator('#ask-actions button').first().click(); await p.waitForTimeout(300); }
    assert.equal(await p.locator('#exp-ev').isDisabled(), false, 'the next entry can choose its event');
    await p.selectOption('#exp-ev', 'e2'); await p.fill('#exp-amt', '300'); await save();
    const d = await dump(p), ice = d.expenses.filter(x => x.purchase === 'PO2'), other = d.expenses.find(x => x.amt === 300);
    assert.deepEqual([ice.length, ice[0].evId, other.evId, other.purchase], [1, 'e1', 'e2', undefined]);
  });

  await test('the database refuses a save that puts a purchase link on another event, or on an order\'s bill; nothing is written', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'), out = [];
      const before = (await db.exportAllData()).expenses, x = before.find(e => e.id === 'x1');
      const tries = [{ ...x, evId: 'e2' }, { ...x, id: 'x2', _rev: undefined, evId: 'e2' }, { ...x, order: 'o1' }, { ...x, purchase: 'PO-none' }];
      for (const rec of tries) { try { await db.commitChanges([{ store: 'expenses', record: rec, expected: rec.id === 'x1' ? x : null }], { check: true }); out.push('saved'); } catch (e) { out.push(e.message); } }
      // in one save with its event: the event's own purchases decide
      const e2 = (await db.exportAllData()).events.find(e => e.id === 'e2');
      try { await db.commitChanges([{ store: 'events', record: { ...e2, notes: 'Sample' }, expected: e2 }, { store: 'expenses', record: { ...x, evId: 'e2' }, expected: x }], { check: true }); out.push('saved'); } catch (e) { out.push(e.message); }
      const now = await db.exportAllData();
      return { out, same: JSON.stringify(now.expenses) === JSON.stringify(before) && !now.events.find(e => e.id === 'e2').notes }; });
    assert.deepEqual(r.out, Array(5).fill('This bill is linked to a purchase on another event. Nothing was saved.'));
    assert.equal(r.same, true, 'nothing written');
  });

  await test('a bill 4.28.0 already moved: on start it keeps the bill and amount, losing only the impossible link; later saves work', async () => {
    await plantMovedBill(p);
    await p.reload(); await p.waitForSelector('#kpi .card');   // the start-up check runs and says so
    await p.waitForSelector('#toast-msg:has-text("linked to a purchase on another event")');
    assert.match(await p.locator('#toast-msg').innerText(), /^1 bill was linked to a purchase on another event\. The link was removed; the bill, amount and photos are unchanged/);
    const after = await bill(p, 'x9'); assert.deepEqual([after.evId, after.amt, after.purchase], ['e2', 900, undefined], 'repaired on start');
    // a note on the bill records what was removed, when and why
    assert.deepEqual({ ...after.linkRepair, at: typeof after.linkRepair.at }, { at: 'string', purchase: 'PO1', reason: 'other-event', from: 'start' });
    await openBill('x9');
    assert.match(await p.locator('#exp-repair-note').innerText(), /^Purchase link removed on .+ \(by the app.s data check\): the purchase is on another event\. The bill and amount were not changed\.$/);
    assert.equal(await p.locator('#exp-repair-note').isVisible(), true);
    assert.equal(await p.locator('#exp-ev').isDisabled(), false, 'an ordinary bill again');
    await p.fill('#exp-notes', 'Sample note'); await save();
    const x = await bill(p, 'x9'); assert.deepEqual([x.evId, x.amt, x.purchase, x.notes, x.linkRepair.from], ['e2', 900, undefined, 'Sample note', 'start'], 'the note stays with the bill');
    await openBill('x1'); assert.equal(await p.locator('#exp-repair-note').isVisible(), false, 'no note on a valid bill');
    await p.keyboard.press('Escape');
    assert.equal((await bill(p, 'x1')).purchase, 'PO1', 'the real bill keeps its link');
  });

  await test('export and restore on another device: a backup with a moved bill restores every record; the bill is kept, only its link removed', async () => {
    await plantMovedBill(p);   // put the bad link back, as a 4.28.0 phone would have it
    const file = path.join('test-artifacts', 'purchase-link-backup.json');
    const backup = await dump(p); fs.writeFileSync(file, JSON.stringify(backup));
    assert.equal(backup.expenses.find(x => x.id === 'x9').purchase, 'PO1', 'the backup carries the old link');
    const ctx2 = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } });
    const p2 = await ctx2.newPage(); p2.setDefaultTimeout(15000); p2.on('pageerror', e => errors.push(e.message));
    await p2.goto(BASE_URL); await p2.waitForSelector('#kpi .card');
    await p2.locator('#import-input').setInputFiles(file); await p2.waitForSelector('#ask-modal.active');
    assert.match(await p2.locator('#ask-msg').innerText(), /2 events · 4 expenses[\s\S]*Checked: complete and undamaged/);
    await p2.locator('#ask-actions button', { hasText: 'Replace all data' }).click();
    await p2.waitForSelector('#toast-msg:has-text("Imported")');
    assert.match(await p2.locator('#toast-msg').innerText(), /1 bill was linked to a purchase on another event; the bill is kept, the link removed/);
    const strip = d => JSON.stringify(Object.fromEntries(['events', 'expenses', 'vendors', 'cPays', 'vPays', 'photos'].map(s => [s, d[s].map(({ _rev, ...r }) => r)])));
    const want = structuredClone(backup), w9 = want.expenses.find(x => x.id === 'x9'); delete w9.purchase;
    const got = await dump(p2), g9 = got.expenses.find(x => x.id === 'x9');
    assert.deepEqual({ ...g9.linkRepair, at: typeof g9.linkRepair.at }, { at: 'string', purchase: 'PO1', reason: 'other-event', from: 'restore' }, 'the restore leaves its note');
    w9.linkRepair = g9.linkRepair;
    assert.equal(strip(got), strip(want), 'every record identical except the one removed link and its note');
    // and the restored data saves and backs up again cleanly
    const again = await p2.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); return (await db.importAllData(d, 'replace')).repaired; });
    assert.equal(again, 0);
    await ctx2.close(); fs.unlinkSync(file);
  });

  await test('a repair note must be complete and well-formed to be restored', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'), out = [];
      const d0 = await db.exportAllData(); delete d0.manifest;
      const tries = [n => ({ ...n, reason: 'made-up' }), n => ({ ...n, from: 'elsewhere' }), n => ({ ...n, purchase: 7 }), () => 'text'];
      const base = { at: '2026-11-15T10:00:00.000Z', purchase: 'PO1', reason: 'other-event', from: 'start' };
      for (const t of [n => n, ...tries]) { const d = structuredClone(d0); d.expenses.find(x => x.id === 'x1').linkRepair = t(base);
        try { await db.importAllData(d, 'replace'); out.push('ok'); } catch (e) { out.push(e.message); } }
      await db.importAllData(d0, 'replace'); return out; });
    assert.deepEqual(r, ['ok', ...Array(4).fill('Invalid link repair note')]);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'purchase link integrity FAIL' : 'purchase link integrity PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('purchase link integrity FAIL'); process.exitCode = 1; });
