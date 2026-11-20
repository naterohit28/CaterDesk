// Found in the owner's phone run (4.31.19): 1 — the reconcile sheet said "₹66,400 still on credit" after every vendor
// was paid: it now shows what is still to pay after vendor payments; 2 — moving an event gave no hint that orders and
// purchases were sent for the old date: a notice lists them after saving, and each row says so; 3 — a new Live Counter
// vendor got the first specialty ("Chaat") without being asked: specialty now starts as Not set. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const EV = { id: 'E1', name: 'Sample Moved Event', date: day(7), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 100, photoIds: [],
  meals: ['dinner'], mealPlan: { dinner: { guests: 100, rate: 1000 } },
  dishes: [{ name: 'Masala Dosa', head: 'Dosa – डोसा', meal: 'dinner' }, { name: 'Gulab Jamun', src: 'buy', meal: 'dinner' }],
  orders: [{ id: 'O1', head: 'Dosa – डोसा', venId: 'vd', plates: 80, date: day(7), status: 'sent', messages: [] },
    { id: 'O2', head: 'Chaat – चाट', venId: 'vc', plates: 50, date: day(7), status: 'delivered', messages: [] }],
  purchases: [{ id: 'P1', item: 'Gulab Jamun', svc: 'svc-dinner', src: 'buy', venId: 'vs', qty: 100, unit: 'pcs', date: day(7), status: 'confirmed' }] };
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [{ id: 'vp1', venId: 'vd', amt: 6000, date: day(0), mode: 'UPI' }],
  vendors: [{ id: 'vd', name: 'Sample Dosa Counter', cat: 'Live Counter', specialty: 'Dosa – डोसा', phone: '9000000001' },
    { id: 'vc', name: 'Sample Chaat Counter', cat: 'Live Counter', phone: '9000000002' }, { id: 'vs', name: 'Sample Sweet Shop', cat: 'Raw Material', phone: '9000000005' }],
  expenses: [{ id: 'x1', evId: 'E1', cat: 'Live Counter', head: 'Dosa – डोसा', amt: 10000, date: day(0), pay: 'credit', venId: 'vd', billIds: [] },
    { id: 'x2', evId: 'E1', cat: 'Raw Material', head: 'Vegetable – भाजी', amt: 2000, date: day(0), pay: 'paid', mode: 'UPI', billIds: [] }],
  events: [EV, { id: 'E2', name: 'Sample Quiet Event', date: day(10), venue: 'Sample Lawn', type: 'Birthday – वाढदिवस', billing: 20000, guests: 20, photoIds: [] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const all = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const openEvent = async id => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator(`#ev-list [data-action="evdetail"][data-id="${id}"]:visible`).click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d, 'replace'); }, DATA);

  await test('2: moving an event lists the open order and purchase sent for the old date; each row says so; delivered ones are not listed', async () => {
    await openEvent('E1');
    assert.equal(await p.locator('[data-off-date]').count(), 0, 'no warning while the dates match');
    await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active');
    await p.fill('#ev-date', day(-1)); await p.locator('#btn-save-event').click();
    await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-title').innerText(), /Tell your vendors about the new date/);
    const msg = await p.locator('#ask-msg').innerText();
    assert.doesNotMatch(msg + await p.locator('#ask-title').innerText(), /<|class=/, 'plain words on screen, no markup (phone run 4.31.19)');
    assert.match(msg, /The event is now on/);
    assert.match(msg, /Dosa · Sample Dosa Counter/); assert.match(msg, /Gulab Jamun · Sample Sweet Shop/);
    assert.doesNotMatch(msg, /Chaat/, 'a delivered order is not listed');
    await p.locator('#ask-actions button').first().click(); await p.waitForTimeout(300);
    const ev = (await all()).events.find(e => e.id === 'E1');
    assert.equal(ev.date, day(-1)); assert.deepEqual(ev.orders.map(o => o.date), [day(7), day(7)], 'orders keep the date they were sent with');
    assert.equal(await p.locator('[data-counter] [data-off-date]').count(), 1, 'the dosa row says it was sent for another date');
    assert.match(await p.locator('#buy-list').innerText(), /Sent for .*not the event date/);
  });

  await test('1: the reconcile sheet shows what is still to pay after vendor payments, and nothing once all is paid', async () => {
    await openEvent('E1');
    await p.locator('[data-action="recon-open"]').first().click(); await p.waitForSelector('#recon-modal.active');
    const sum = (await p.locator('#recon-sum').innerText()).replace(/\s+/g, ' ');
    assert.match(sum, /₹4,000 still to pay to vendors \(counted\)/, '₹10,000 on credit, ₹6,000 paid');
    assert.doesNotMatch(sum, /still on credit/);
    assert.match(sum, /100 guests/);
    await p.evaluate(async () => { const db = await import('./db.js'); await db.putOne('vPays', { id: 'vp2', venId: 'vd', amt: 4000, date: '2026-01-01', mode: 'UPI' }); });
    await openEvent('E1');
    await p.locator('[data-action="recon-open"]').first().click(); await p.waitForSelector('#recon-modal.active');
    assert.doesNotMatch(await p.locator('#recon-sum').innerText(), /still to pay|still on credit/, 'all paid: no figure');
    await p.locator('#recon-modal [data-action="close-modal"]').first().click();
  });

  await test('2: an event with nothing sent moves without a notice', async () => {
    await openEvent('E2');
    await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active');
    await p.fill('#ev-date', day(12)); await p.locator('#btn-save-event').click(); await p.waitForTimeout(700);
    assert.equal(await p.locator('#ask-modal.active').count(), 0);
    assert.equal((await all()).events.find(e => e.id === 'E2').date, day(12));
  });

  await test('3: a new vendor\'s specialty starts as Not set; a chosen one is kept; an existing one is unchanged', async () => {
    await p.reload(); await p.waitForSelector('#kpi .card');
    await p.locator('#n-vendors:visible').click(); await p.locator('#fab').click(); await p.waitForSelector('#ven-modal.active');
    await p.fill('#ven-name', 'Sample New Counter'); await p.selectOption('#ven-cat', 'Live Counter'); await p.waitForTimeout(200);
    assert.equal(await p.locator('#ven-specialty').inputValue(), '', 'nothing chosen for you');
    assert.match(await p.locator('#ven-specialty option').first().innerText(), /Not set/);
    await p.fill('#ven-phone', '9000000009'); await p.locator('#btn-save-ven').click(); await p.waitForTimeout(500);
    let d = await all();
    assert.equal(d.vendors.find(v => v.name === 'Sample New Counter').specialty, '');
    await p.locator('#fab').click(); await p.waitForSelector('#ven-modal.active');
    await p.fill('#ven-name', 'Sample Pani Puri Counter'); await p.selectOption('#ven-cat', 'Live Counter'); await p.waitForTimeout(200);
    await p.selectOption('#ven-specialty', 'Chaat – चाट'); await p.fill('#ven-phone', '9000000010'); await p.locator('#btn-save-ven').click(); await p.waitForTimeout(500);
    d = await all();
    assert.equal(d.vendors.find(v => v.name === 'Sample Pani Puri Counter').specialty, 'Chaat – चाट');
    assert.equal(d.vendors.find(v => v.id === 'vd').specialty, 'Dosa – डोसा');
    assert.doesNotMatch(await p.locator('#ven-list').innerText(), /Sample New Counter\s*Live Counter · /, 'the list shows no specialty for it');
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'phone-findings FAIL' : 'phone run findings: still to pay, moved-event notice, no default specialty PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('phone-findings FAIL'); process.exitCode = 1; });
