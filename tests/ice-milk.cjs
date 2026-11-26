// 5.2.2 Ice and Milk & Dairy as separate expense items. Checked: new entries offer "Milk & Dairy" and "Ice", not the
// retired "Ice + Milk", "Paneer / Dairy" or "Ice Blocks"; an old "Ice + Milk" expense opens with its own item and is
// unchanged when saved; old records stay in totals, the expense list and backups; usual items and usual vendors count
// "Paneer / Dairy" / "Ice Blocks" history towards their successor, never "Ice + Milk"; the cost checklist treats an
// older event's "Ice + Milk" as covered by Milk & Dairy or Ice. Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const OLD = 'Ice + Milk – बर्फ + दूध', PANEER = 'Paneer / Dairy', BLOCKS = 'Ice Blocks', MILK = 'Milk & Dairy – दूध व दुग्धजन्य पदार्थ', ICE = 'Ice – बर्फ';
const X = (id, evId, cat, head, amt, extra = {}) => ({ id, evId, cat, head, amt, date: day(-3), pay: 'paid', mode: 'UPI', billIds: [], ...extra });
const EV = (id, name, n) => ({ id, name, date: day(n), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 100, photoIds: [] });
const DATA = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [],
  vendors: [{ id: 'vd', name: 'Sample Dairy', cat: 'Raw Material', specialty: PANEER }, { id: 'vi', name: 'Sample Ice Co', cat: 'Operations', specialty: BLOCKS }],
  events: [EV('E1', 'Sample Old Event', -10), EV('E2', 'Sample New Event', 2)],
  expenses: [X('old1', 'E1', 'Raw Material', OLD, 4200), X('old2', 'E1', 'Raw Material', OLD, 1800),
    X('p1', 'E1', 'Raw Material', PANEER, 3000, { venId: 'vd' }), X('p2', 'E1', 'Raw Material', PANEER, 2500, { venId: 'vd' }),
    X('b1', 'E1', 'Operations', BLOCKS, 900, { venId: 'vi' })] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const load = async d => { await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d, 'replace'); }, d); await p.reload(); await p.waitForSelector('#kpi .card'); };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const options = () => p.locator('#exp-head option').evaluateAll(os => os.map(o => o.value));
  const close = async () => { await p.locator('#exp-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(200); if (await p.locator('#ask-modal.active').count()) { await p.locator('#ask-actions button').last().click(); await p.waitForTimeout(150); } };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');

  await test('new entries offer Milk & Dairy and Ice; the retired items are not offered', async () => {
    await load(DATA());
    await p.locator('[data-action="quick"][data-id="expense"]').first().click(); await p.waitForSelector('#exp-modal.active');
    await p.locator('#exp-cats [data-cat="Raw Material"]').click();
    let o = await options(); assert.ok(o.includes(MILK) && o.includes(ICE), 'both new items'); assert.ok(!o.includes(OLD) && !o.includes(PANEER), 'no retired items');
    assert.ok(o.includes('Water – पाणी') && o.includes('Oil / Ghee'), 'water and oil/ghee stay separate');
    await p.locator('#exp-cats [data-cat="Operations"]').click();
    o = await options(); assert.ok(!o.includes(BLOCKS) && o.includes('Water Tanker'), 'no Ice Blocks; Water Tanker stays');
  });

  await test('usual items count "Paneer / Dairy" as Milk & Dairy and "Ice Blocks" as Ice; never offer "Ice + Milk"', async () => {
    await p.locator('#exp-cats [data-cat="Raw Material"]').click();
    const chips = await p.locator('#exp-item-quick [data-qhead]').evaluateAll(bs => bs.map(b => b.dataset.qhead));
    assert.deepEqual(chips, [MILK, ICE]);
    await p.locator(`#exp-item-quick [data-qhead="${MILK}"]`).click(); await p.waitForTimeout(150);
    assert.match(await p.locator('#exp-ven-quick').innerText(), /Sample Dairy/, 'the dairy supplier (speciality Paneer / Dairy) is the usual vendor');
    await p.locator(`#exp-item-quick [data-qhead="${ICE}"]`).click(); await p.waitForTimeout(150);
    assert.match(await p.locator('#exp-ven-quick').innerText(), /Sample Ice Co/, 'the ice supplier (Ice Blocks) is the usual vendor');
    await close();
  });

  await test('an old "Ice + Milk" expense opens with its own item and is unchanged when saved', async () => {
    const before = (await dump()).expenses.find(x => x.id === 'old1');
    await p.locator('#n-expenses:visible').click(); await p.waitForTimeout(300);
    await p.evaluate(() => { const b = document.querySelector('[data-action="edit-exp"][data-id="old1"]'); b.scrollIntoView(); b.click(); });
    await p.waitForSelector('#exp-modal.active'); await p.waitForTimeout(200);
    assert.equal(await p.inputValue('#exp-head'), OLD, 'not replaced by the first item in the list');
    await p.locator('#btn-save-exp').click(); await p.waitForTimeout(600);
    const after = (await dump()).expenses.find(x => x.id === 'old1');
    assert.deepEqual([after.cat, after.head, after.amt, after.pay], [before.cat, before.head, before.amt, before.pay]);
  });

  await test('old records stay in the event total, the expense list and a backup', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js'), db = await import('./db.js');
      const d = await db.exportAllData(); const total = u.calcEventExpenses('E1', d.expenses);
      await db.importAllData(JSON.parse(JSON.stringify(d)), 'replace');
      const back = await db.exportAllData(); return { total, heads: back.expenses.map(x => x.head).sort() }; });
    assert.equal(r.total, 4200 + 1800 + 3000 + 2500 + 900);
    assert.deepEqual(r.heads, [BLOCKS, OLD, OLD, PANEER, PANEER].sort());
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-expenses:visible').click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#exp-list').innerText(), /Ice \+ Milk/);
  });

  await test('a vendor with a retired speciality keeps it when edited', async () => {
    await p.locator('#n-vendors:visible').click(); await p.waitForTimeout(300);
    await p.locator('[data-action="vendetail"][data-id="vi"]:visible').first().click(); await p.waitForTimeout(300);
    await p.locator('[data-action="open-ven-edit"]').first().click(); await p.waitForSelector('#ven-modal.active');
    assert.equal(await p.inputValue('#ven-specialty'), BLOCKS);
    await p.locator('#btn-save-ven').click(); await p.waitForTimeout(500);
    assert.equal((await dump()).vendors.find(v => v.id === 'vi').specialty, BLOCKS);
  });

  await test('cost checklist: an older event\'s "Ice + Milk" is covered by Milk & Dairy or Ice; "Paneer / Dairy" is shown as Milk & Dairy', async () => {
    const r = await p.evaluate(async ([MILK, ICE, OLD]) => { const u = await import('./utils.js'), db = await import('./db.js');
      const d = await db.exportAllData();
      const ref = { ...d.events.find(e => e.id === 'E1') }; Object.assign(ref, u.reconcileFields(ref, d.expenses, ['bills', 'shared', 'final']));
      const cur = d.events.find(e => e.id === 'E2');
      const run = exps => { const c = u.costChecklist(cur, [ref, cur], exps); return c.list.map(i => [i.head, !!i.done]); };
      const none = run(d.expenses);
      const withMilk = run([...d.expenses, { id: 'n1', evId: 'E2', cat: 'Raw Material', head: MILK, amt: 500, date: '2026-01-01', pay: 'paid', billIds: [] }]);
      return { none, withMilk }; }, [MILK, ICE, OLD]);
    const find = (list, h) => list.find(i => i[0] === h);
    assert.deepEqual(find(r.none, OLD), [OLD, false]); assert.deepEqual(find(r.none, MILK), [MILK, false], 'Paneer / Dairy shown as Milk & Dairy');
    assert.equal(find(r.none, PANEER), undefined);
    assert.deepEqual(find(r.withMilk, OLD), [OLD, true], 'Milk & Dairy recorded: the old combined line is covered');
    assert.deepEqual(find(r.withMilk, MILK), [MILK, true]);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'ice-milk FAIL' : 'ice and milk & dairy separate; old records kept PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('ice-milk FAIL'); process.exitCode = 1; });
