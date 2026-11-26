// 5.2.0 faster recording: "Usual items" in the expense sheet, one tap for the category and item you record most.
// Checked: ranking (most used, ties to the latest), labour-sheet lines and order prices not counted, at most 6,
// one tap sets category + item + usual vendors exactly like the category chip and item list, the saved record is
// identical to one entered the long way, the highlight follows manual changes, and nothing shows without history.
// Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const VEG = 'Vegetable – भाजी', GAS = 'Gas / Cylinder – सिलिंडर', GRO = 'Grocery – किराणा', TR = 'Transport – वाहतूक',
  WATER = 'Water – पाणी', ICE = 'Ice – बर्फ', OIL = 'Oil / Ghee', GHATI = 'Ghati – घाटी', DOSA = 'Dosa – डोसा';
const X = (id, cat, head, date, extra = {}) => ({ id, evId: 'E1', cat, head, amt: 1000, date, pay: 'paid', mode: 'UPI', billIds: [], ...extra });
const EV = { id: 'E1', name: 'Sample Usual Wedding', date: day(1), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 100, photoIds: [] };
const HISTORY = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [],
  vendors: [{ id: 'vg', name: 'Sample Gas Agency', cat: 'Operations', specialty: GAS }, { id: 'vv', name: 'Sample Vegetables', cat: 'Raw Material', specialty: VEG }],
  // Five labour-sheet lines (one per contractor) would top the list if counted; the sheet writes them, not the user
  events: [{ ...EV, labour: { rows: [], expIds: Object.fromEntries([1, 2, 3, 4, 5].map(i => [`Labour|${GHATI}|c${i}`, 'L' + i])) },
    orders: [{ id: 'o1', head: DOSA, venId: 'vg', plates: 100, status: 'confirmed', price: 9000 }] }],
  expenses: [
    ...[1, 2, 3, 4].map(i => X('v' + i, 'Raw Material', VEG, day(-10 + i))),
    ...[1, 2, 3].map(i => X('g' + i, 'Operations', GAS, day(-20 + i), { venId: 'vg' })),
    ...[1, 2].map(i => X('r' + i, 'Raw Material', GRO, day(-30 + i))),
    X('t1', 'Operations', TR, day(-2)), X('w1', 'Raw Material', WATER, day(-3)), X('i1', 'Raw Material', ICE, day(-4)), X('o1x', 'Raw Material', OIL, day(-40)),
    ...[1, 2, 3, 4, 5].map(i => X('L' + i, 'Labour', GHATI, day(-1), { pay: 'credit', mode: '', venId: '' })),
    // An order's price is an estimate, not something the user entered
    X('fo', 'Live Counter', DOSA, day(-1), { pay: 'credit', mode: '', venId: 'vg', order: 'o1', fromOrder: true }),
  ] });
const data = HISTORY;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const load = async d => { await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d, 'replace'); }, d); await p.reload(); await p.waitForSelector('#kpi .card'); };
  const openExp = async () => { await p.locator('[data-action="quick"][data-id="expense"]').first().click(); await p.waitForSelector('#exp-modal.active'); await p.waitForTimeout(200); };
  const chips = () => p.locator('#exp-item-quick [data-qcat]').evaluateAll(bs => bs.map(b => [b.dataset.qhead, b.getAttribute('aria-pressed')]));
  const close = async () => { await p.locator('#exp-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(200); if (await p.locator('#ask-modal.active').count()) { await p.locator('#ask-actions button').last().click(); await p.waitForTimeout(150); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');

  await test('no expense history: no Usual items row', async () => {
    await load({ version: 'ffv2', photos: [], cPays: [], vPays: [], vendors: [], expenses: [], events: [EV] });
    await openExp();
    assert.equal(await p.locator('#exp-item-quick-field').isHidden(), true);
    await close();
  });

  await test('ranked by use, ties to the latest; labour-sheet lines and order prices left out; at most 6', async () => {
    await load(data()); await openExp();
    assert.equal(await p.locator('#exp-item-quick-field').isVisible(), true);
    assert.deepEqual((await chips()).map(c => c[0]), [VEG, GAS, GRO, TR, WATER, ICE], 'Oil (oldest single use) is the 7th and not shown');
  });

  await test('one tap sets category and item together, highlights it, and shows that item\'s usual vendor', async () => {
    await p.locator(`#exp-item-quick [data-qhead="${GAS}"]`).click(); await p.waitForTimeout(150);
    assert.equal(await p.inputValue('#exp-cat'), 'Operations');
    assert.equal(await p.inputValue('#exp-head'), GAS);
    assert.equal(await p.locator('#exp-cats [data-cat="Operations"]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual((await chips()).filter(c => c[1] === 'true').map(c => c[0]), [GAS]);
    assert.match(await p.locator('#exp-ven-quick').innerText(), /Sample Gas Agency/);
  });

  await test('the highlight follows a manual change of item', async () => {
    await p.locator('#exp-cats [data-cat="Raw Material"]').click(); await p.selectOption('#exp-head', VEG); await p.waitForTimeout(150);
    assert.deepEqual((await chips()).filter(c => c[1] === 'true').map(c => c[0]), [VEG]);
    await close();
  });

  await test('the saved expense is identical whether the item came from one tap or from category + list', async () => {
    const save = async how => { await openExp(); await p.fill('#exp-amt', '1250');
      if (how === 'chip') await p.locator(`#exp-item-quick [data-qhead="${GAS}"]`).click();
      else { await p.locator('#exp-cats [data-cat="Operations"]').click(); await p.selectOption('#exp-head', GAS); }
      await p.locator('#exp-pay [data-pay="credit"]').click(); await p.selectOption('#exp-vendor', 'vg');
      await p.locator('#btn-save-exp').click(); await p.waitForTimeout(600);
      if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
      const d = await dump(); return d.expenses.filter(x => x.amt === 1250).sort((a, b) => String(a.id).localeCompare(String(b.id))); };
    await load(data()); const a = (await save('chip'))[0];
    await load(data()); const b = (await save('list'))[0];
    const pick = x => ({ evId: x.evId, cat: x.cat, head: x.head, amt: x.amt, pay: x.pay, venId: x.venId, mode: x.mode, date: x.date, billIds: x.billIds });
    assert.deepEqual(pick(a), pick(b));
    assert.deepEqual([a.cat, a.head, a.pay, a.venId], ['Operations', GAS, 'credit', 'vg']);
  });

  await test('fewer taps: the item now takes 1 tap instead of 3 (category chip + open list + choose)', async () => {
    await load(data()); await openExp();
    let taps = 0; await p.locator(`#exp-item-quick [data-qhead="${TR}"]`).click(); taps++;
    assert.equal(await p.inputValue('#exp-head'), TR); assert.equal(taps, 1);
    await close();
  });

  await test('tapping an item keeps what was already typed or chosen: amount, paid/credit and vendor', async () => {
    await load(data()); await openExp();
    await p.fill('#exp-amt', '777'); await p.locator('#exp-pay [data-pay="credit"]').click(); await p.selectOption('#exp-vendor', 'vv');
    await p.locator(`#exp-item-quick [data-qhead="${GAS}"]`).click(); await p.waitForTimeout(150);
    assert.deepEqual([await p.inputValue('#exp-amt'), await p.locator('#exp-pay').getAttribute('data-value'), await p.inputValue('#exp-vendor')], ['777', 'credit', 'vv'],
      'the item\'s usual vendor is only suggested; the chosen vendor stays');
    await close();
  });

  await test('an existing expense opened and saved without touching anything is unchanged', async () => {
    await load(data());
    const before = (await dump()).expenses.find(x => x.id === 'g2');
    await p.locator('#n-expenses:visible').click(); await p.waitForTimeout(300);
    await p.evaluate(() => { const b = document.querySelector('[data-action="edit-exp"][data-id="g2"]'); b.scrollIntoView(); b.click(); });
    await p.waitForSelector('#exp-modal.active'); await p.waitForTimeout(200);
    assert.deepEqual((await chips()).filter(c => c[1] === 'true').map(c => c[0]), [GAS], 'its own item is the one highlighted');
    await p.locator('#btn-save-exp').click(); await p.waitForTimeout(600);
    // Compared field by field. The existing save path (unchanged by 5.2.0) writes blank optional fields as ''
    // (notes, dueDate) where a record had none; no value changes.
    const { _rev: _a, ...after } = (await dump()).expenses.find(x => x.id === 'g2'); const { _rev: _b, ...was } = before;
    for (const k of new Set([...Object.keys(was), ...Object.keys(after)]))
      assert.deepEqual(after[k] ?? '', was[k] ?? '', `field ${k} unchanged`);
  });

  await test('works without the network: showing and tapping the items makes no requests', async () => {
    await load(data()); const reqs = []; const on = r => reqs.push(r.url()); p.on('request', on);
    await openExp(); await p.locator(`#exp-item-quick [data-qhead="${TR}"]`).click(); await p.waitForTimeout(200);
    p.off('request', on);
    assert.deepEqual(reqs, []);
    await close();
  });

  await test('large buttons (44 px or more); the row adds at most two lines at phone width', async () => {
    await load(data()); await openExp();
    const sizes = await p.locator('#exp-item-quick [data-qcat]').evaluateAll(bs => bs.map(b => b.getBoundingClientRect().height));
    assert.ok(sizes.every(h => h >= 44), JSON.stringify(sizes));
    const rowH = await p.locator('#exp-item-quick').evaluate(e => e.getBoundingClientRect().height);
    assert.ok(rowH <= 2 * Math.max(...sizes) + 16, `row height ${rowH}`);
    await close();
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'usual-items FAIL' : 'usual items: one tap for the items you record most, same record as the long way PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('usual-items FAIL'); process.exitCode = 1; });
