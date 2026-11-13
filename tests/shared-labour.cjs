// 4.8.1: a labour-sheet expense that has been shared across events must never let the parts exceed the bill when the
// sheet is saved again; and Share bill cannot move the sheet's own entry off its event. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'muk', name: 'Sample Mukadam', cat: 'Labour' }],
  events: [{ id: 'A', name: 'Sample Lunch Event', date: day(-2), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 200000, guests: 200, photoIds: [],
      labour: { rows: [{ id: 'r1', role: 'Boys – बॉईज', rate: 600, counts: { e: 10 } }], pay: 'credit', mode: '', venId: 'muk', expIds: {} } },
    { id: 'B', name: 'Sample Dinner Event', date: day(-2), venue: 'Sample Lawn', type: 'Birthday – वाढदिवस', billing: 80000, guests: 80, photoIds: [] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const boys = async () => (await dump()).expenses.filter(x => x.head === 'Boys – बॉईज');
  const total = list => Math.round(list.reduce((s, x) => s + x.amt * 100, 0)) / 100;
  const fresh = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); };
  const openEvent = async id => { await fresh(); await p.locator('#n-events:visible').click(); await p.locator(`#ev-list [data-action="evdetail"][data-id="${id}"]:visible`).click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  const openSheet = async () => { await openEvent('A'); await p.locator('[data-action="lab-edit"]').click(); await p.waitForSelector('#lab-modal.active'); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);

  await test('sharing a labour-sheet bill, then saving the sheet again, never makes the parts exceed the bill', async () => {
    await openSheet(); await p.locator('#btn-save-lab').click(); await p.waitForTimeout(500);   // ₹6,000 boys entry on A
    const sheetId = (await dump()).events.find(e => e.id === 'A').labour.expIds['Labour|Boys – बॉईज'];
    // Share ₹6,000 as ₹4,000 (A) + ₹2,000 (B)
    await fresh(); await p.locator('#n-expenses:visible').click(); await p.locator(`#exp-list [data-action="edit-exp"][data-id="${sheetId}"]:visible`).first().click();
    await p.waitForSelector('#exp-modal.active'); await p.locator('#btn-share-exp').click(); await p.waitForSelector('#split-modal.active');
    await p.locator('#split-rows [data-sp="0"] [data-k="amt"]').fill('4000');
    await p.locator('#split-rows [data-sp="1"] [data-k="evId"]').selectOption('B'); await p.locator('#split-rows [data-sp="1"] [data-k="amt"]').fill('2000');
    await p.locator('#btn-save-split').click(); await p.waitForTimeout(500);
    assert.deepEqual((await boys()).map(x => [x.evId, x.amt]).sort(), [['A', 4000], ['B', 2000]]);
    // Saving the sheet again with no change: still ₹6,000 in all
    await openSheet(); await p.locator('#btn-save-lab').click(); await p.waitForTimeout(500);
    assert.equal(await p.locator('#lab-modal.active').count(), 0, 'the sheet saved (not refused)');
    let b = await boys();
    assert.equal(total(b), 6000, 'parts still add up to the ₹6,000 bill (not ₹6,000 + ₹2,000)');
    assert.deepEqual(b.map(x => [x.evId, x.amt]).sort(), [['A', 4000], ['B', 2000]]);
    assert(b.every(x => x.split.total === 6000));
    // The sheet bill grows to ₹7,200 (12 boys): the bill is ₹7,200, B keeps its ₹2,000, A takes the rest
    await openSheet(); await p.locator('#lab-rows [data-lab="0"] [data-k="c-e"]').fill('12');
    await p.locator('#btn-save-lab').click(); await p.waitForTimeout(500);
    b = await boys();
    assert.equal(total(b), 7200); assert.deepEqual(b.map(x => [x.evId, x.amt]).sort(), [['A', 5200], ['B', 2000]]);
    assert(b.every(x => x.split.total === 7200), 'every part knows the new bill');
    // Shrinking the bill below the other events' parts is refused, nothing changes
    await openSheet(); await p.locator('#lab-rows [data-lab="0"] [data-k="c-e"]').fill('3'); await p.locator('#btn-save-lab').click(); await p.waitForTimeout(400);
    assert.match(await p.locator('#toast-msg').innerText(), /shared with other events/);
    assert.equal(await p.locator('#lab-modal.active').count(), 1);
    assert.equal(total(await boys()), 7200, 'unchanged');
    await p.locator('#lab-modal [data-action="close-modal"]').click(); await p.waitForTimeout(300);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
  });

  await test('Share bill cannot move a labour-sheet entry off the event whose sheet it belongs to', async () => {
    const sheetId = (await dump()).events.find(e => e.id === 'A').labour.expIds['Labour|Boys – बॉईज'];
    await fresh(); await p.locator('#n-expenses:visible').click(); await p.locator(`#exp-list [data-action="edit-exp"][data-id="${sheetId}"]:visible`).first().click();
    await p.waitForSelector('#exp-modal.active'); await p.locator('#btn-share-exp').click(); await p.waitForSelector('#split-modal.active');
    const rowA = await p.locator('#split-rows [data-sp]').evaluateAll(rs => rs.findIndex(r => r.querySelector('[data-k="evId"]').value === 'A'));
    await p.locator(`#split-rows [data-sp="${rowA}"] [data-k="evId"]`).selectOption('');
    await p.locator('#btn-save-split').click(); await p.waitForTimeout(400);
    assert.match(await p.locator('#toast-msg').innerText(), /labour sheet/); assert.equal(total(await boys()), 7200);
    const ids = (await dump()).events.find(e => e.id === 'A').labour.expIds;
    assert((await boys()).some(x => x.id === ids['Labour|Boys – बॉईज'] && x.evId === 'A'), 'sheet entry still on its event');
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'shared labour FAIL' : 'shared labour-sheet bill stays within the bill PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('shared labour FAIL'); process.exitCode = 1; });
