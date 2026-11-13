// Phase 3 P3-D mukadam bill (spec §9.1, G-14): a labour sheet that includes staff and travel is not counted twice,
// and the negotiated bill total is kept exactly. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // local date, as the app uses
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'muk', name: 'Sample Mukadam', cat: 'Labour' }],
  events: [{ id: 'E', name: 'Sample Wedding', date: day(-2), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 300000, guests: 300, photoIds: [],
    labour: { rows: [{ id: 'r1', role: 'Boys – बॉईज', rate: 600, counts: { e: 10 } }, { id: 'r2', role: 'Cook – स्वयंपाकी', rate: 1200, counts: { f: 2 } },
      { id: 'x1', kind: 'x', extra: 'travel', label: '', count: 1, rate: 2000 }], pay: 'credit', mode: '', venId: 'muk', expIds: {}, billTotal: 10000 } }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const exps = async () => (await dump()).expenses.filter(x => x.evId === 'E');
  const sum = list => Math.round(list.reduce((s, x) => s + x.amt * 100, 0)) / 100;
  const openEvent = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="E"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  const saveSheet = async () => { await openEvent(); await p.locator('[data-action="lab-edit"]').click(); await p.waitForSelector('#lab-modal.active'); await p.locator('#btn-save-lab').click(); await p.waitForTimeout(500); };
  const typeExpense = async (cat, head, amt) => {
    await openEvent(); await p.locator('[data-action="open-exp"][data-id="E"]').first().click(); await p.waitForSelector('#exp-modal.active');
    await p.fill('#exp-amt', String(amt)); await p.locator(`#exp-cats [data-cat="${cat}"]`).click(); await p.selectOption('#exp-head', head);
    await p.locator('#btn-save-exp').click(); await p.waitForTimeout(400);
  };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);

  await test('G-14: a mukadam bill with staff and travel is saved once, at the negotiated total exactly', async () => {
    await saveSheet();
    const e = await exps();
    assert.deepEqual(e.map(x => `${x.cat}|${x.head}`).sort(), ['Labour|Boys – बॉईज', 'Labour|Cook – स्वयंपाकी', 'Operations|Transport – वाहतूक']);
    assert.equal(sum(e), 10000, 'lines ₹10,400, negotiated bill ₹10,000: saved total is exactly the bill');
    assert.match(e.find(x => x.head === 'Boys – बॉईज').notes, /bill adjustment −₹400 \(bill ₹10,000\)/, 'the override is explained');
    await saveSheet();   // saving again changes nothing
    assert.equal((await exps()).length, 3); assert.equal(sum(await exps()), 10000);
  });

  await test('typing travel or a sheet role by hand asks first: Cancel saves nothing, "extra" saves it marked', async () => {
    await typeExpense('Operations', 'Transport – वाहतूक', 2000);
    await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-msg').innerText(), /labour sheet already includes Transport: ₹2,000/);
    await p.locator('#ask-actions button').last().click(); await p.waitForTimeout(300);   // Cancel
    assert.equal((await exps()).length, 3, 'not saved'); assert.equal(await p.locator('#exp-modal.active').count(), 1, 'form still open');
    await p.locator('#btn-save-exp').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'It is extra' }).click(); await p.waitForTimeout(500);
    const extra = (await exps()).find(x => x.additional);
    assert(extra && extra.head === 'Transport – वाहतूक' && extra.amt === 2000, 'saved and marked extra');
    // A labour role the sheet already has asks too; a role it does not have does not
    await typeExpense('Labour', 'Boys – बॉईज', 500);
    assert.equal(await p.locator('#ask-modal.active').count(), 1); await p.locator('#ask-actions button').last().click(); await p.waitForTimeout(300);
    await p.locator('#exp-modal [data-action="close-modal"]').click(); await p.waitForTimeout(300);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
    const n = (await exps()).length;
    await typeExpense('Labour', 'Helper Staff', 800);
    assert.equal(await p.locator('#ask-modal.active').count(), 0, 'not in the sheet: no question');
    assert.equal((await exps()).length, n + 1);
  });

  await test('saving the sheet when the same item was typed by hand asks first; nothing is deleted', async () => {
    // A hand-typed cook expense (no flag), as if entered before the sheet had a cook line
    await p.evaluate(async d => { const db = await import('./db.js'); await db.putOne('expenses', { id: 'hand', evId: 'E', cat: 'Labour', head: 'Cook – स्वयंपाकी', amt: 1500, date: d, pay: 'paid', mode: 'UPI' }); }, day(-2));
    await openEvent(); await p.locator('[data-action="lab-edit"]').click(); await p.waitForSelector('#lab-modal.active'); await p.locator('#btn-save-lab').click();
    await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-msg').innerText(), /Cook ₹1,500 was entered separately/);
    await p.locator('#ask-actions button').last().click(); await p.waitForTimeout(300);   // Cancel
    let e = await exps(); assert.equal(e.find(x => x.id === 'hand').additional, undefined); assert.equal(await p.locator('#lab-modal.active').count(), 1, 'sheet still open');
    await p.locator('#btn-save-lab').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Keep both' }).click(); await p.waitForTimeout(500);
    e = await exps();
    assert.equal(e.find(x => x.id === 'hand').additional, true, 'kept and marked extra, not deleted');
    const sheetIds = Object.values((await dump()).events[0].labour.expIds);
    assert.equal(sum(e.filter(x => sheetIds.includes(x.id))), 10000, 'the sheet itself still holds exactly the negotiated total');
    await p.locator('#n-expenses:visible').click(); assert.match(await p.locator('#exp-list').innerText(), /extra to labour sheet/);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'labour no duplicates FAIL' : 'labour bill without duplicates (G-14) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('labour no duplicates FAIL'); process.exitCode = 1; });
