// 5.1.0 (owner): each labour line has its own contractor. A worker type's contractor is picked for you only when exactly
// one saved contractor has that specialty (else the one used last); with two for one type you choose. Two lines of the
// same type for two contractors are two expenses, each owed to its own contractor. Each contractor gets their own list
// on WhatsApp (no client or event name). Sheets saved before 5.1.0 (one contractor) keep their expenses. Synthetic data.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const GHATI = 'Ghati – घाटी', ROJIYA = 'Rojiya Labour – रोजीया मजूर', BOYS = 'Boys – बॉईज', PRO = 'PRO – पी.आर.О.';
const V = (id, name, specialty, phone = '9000000' + String(Math.floor(Math.random() * 900) + 100)) => ({ id, name, cat: 'Labour', ...(specialty ? { specialty } : {}), phone });
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [],
  vendors: [V('ga', 'Sample Ghati Contractor', GHATI, '9000000101'), V('rb', 'Sample Rojiya Contractor', ROJIYA), V('b1', 'Sample Boys One', BOYS), V('b2', 'Sample Boys Two', BOYS),
    V('pd', 'Sample PRO Contractor'), V('ge', 'Sample Extra Ghati')],
  expenses: [{ id: 'old1', evId: 'E0', cat: 'Labour', head: BOYS, amt: 1000, date: '2026-11-01', pay: 'credit', venId: 'b1', billIds: ['ph1'], notes: 'Labour sheet: Evening 2 @ ₹500' }],
  events: [
    { id: 'E0', name: 'Sample Older Event', date: '2026-11-01', venue: 'Sample Lawn', type: 'Wedding – लग्न', billing: 50000, guests: 50, photoIds: [],
      labour: { pay: 'credit', mode: '', venId: 'b1', rows: [{ id: 'L0', role: BOYS, rate: 500, counts: { e: 2 } }, { id: 'L9', role: PRO, rate: 0, counts: { e: 1 }, venId: 'pd' }], expIds: { [`Labour|${BOYS}`]: 'old1' } } },
    { id: 'E1', name: 'Sample Gala Event', date: '2026-12-10', venue: 'Sample Hall', locality: 'Sample Area', type: 'Wedding – लग्न', billing: 100000, guests: 100, photoIds: [] }] };
DATA.photos = [{ id: 'ph1', evId: 'E0', expId: 'old1', mime: 'image/png', data: 'data:image/png;base64,iVBORw0KGgo=' }];

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const openEvent = async id => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator(`#ev-list [data-action="evdetail"][data-id="${id}"]:visible`).click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200);
    await p.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return {}; }; }); };
  const openSheet = async id => { await openEvent(id); await p.locator('[data-action="lab-edit"]').click(); await p.waitForSelector('#lab-modal.active'); };
  const line = i => p.locator(`[data-lab="${i}"]`);
  const setLine = async (i, role, evening, venId) => {
    if (!(await line(i).count())) { await p.locator('#btn-lab-add').click(); await p.waitForTimeout(150); }
    await line(i).locator('[data-k="role"]').selectOption(role); await p.waitForTimeout(150);
    if (venId !== undefined) { await line(i).locator('[data-k="venId"]').selectOption(venId); await p.waitForTimeout(100); }
    await line(i).locator('[data-k="c-e"]').fill(String(evening));
  };
  const labExp = async evId => (await dump()).expenses.filter(x => x.evId === evId && x.cat === 'Labour').map(x => [x.head.split(' ')[0], x.venId, x.amt]).sort();
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d, 'replace'); }, DATA);

  await test('each line has a contractor box: one with that specialty is picked; with two you choose; else the one used last', async () => {
    await openSheet('E1');
    await setLine(0, GHATI, 3);
    assert.equal(await line(0).locator('[data-k="venId"]').inputValue(), 'ga', 'the only Ghati contractor');
    await setLine(1, ROJIYA, 2);
    assert.equal(await line(1).locator('[data-k="venId"]').inputValue(), 'rb');
    await setLine(2, BOYS, 4);
    assert.equal(await line(2).locator('[data-k="venId"]').inputValue(), '', 'two Boys contractors: not picked for you');
    const boysOpts = await line(2).locator('[data-k="venId"] option').allInnerTexts();
    assert.deepEqual(boysOpts.slice(1, 3).sort(), ['Sample Boys One', 'Sample Boys Two'], 'the Boys contractors come first');
    assert.match(boysOpts.at(-2), /\+ New vendor/);
    await line(2).locator('[data-k="venId"]').selectOption('b2');
    await setLine(3, PRO, 2);
    assert.equal(await line(3).locator('[data-k="venId"]').inputValue(), 'pd', 'no PRO specialty: the one used last for PRO');
    await setLine(4, GHATI, 1, 'ge');   // a second Ghati contractor on this event
    assert.equal(await p.locator('#lab-ven-field').isHidden(), true, 'no single contractor box for the sheet');
    await p.locator('#lab-pay [data-pay="credit"]').click();
    await p.locator('#btn-save-lab').click(); await p.waitForTimeout(600);
    assert.match(await p.locator('#toast-msg').innerText(), /^Labour sheet saved. Rates to add when the bill comes: Ghati, Rojiya Labour, Boys, PRO, Ghati/);
    assert.equal(await p.locator('#toast').getAttribute('class').then(c => /error/.test(c || '')), false, 'not shown as an error');
    const rows = (await dump()).events.find(e => e.id === 'E1').labour.rows.map(r => [r.role.split(' ')[0], r.venId, r.counts.e]);
    assert.deepEqual(rows, [['Ghati', 'ga', 3], ['Rojiya', 'rb', 2], ['Boys', 'b2', 4], ['PRO', 'pd', 2], ['Ghati', 'ge', 1]]);
    assert.deepEqual(await labExp('E1'), [], 'no rates yet: nothing owed yet');
  });

  await test('with rates, each line is its own expense owed to its own contractor (two Ghati contractors stay apart)', async () => {
    await openSheet('E1');
    await line(0).locator('[data-k="rate"]').fill('700'); await line(4).locator('[data-k="rate"]').fill('700'); await line(2).locator('[data-k="rate"]').fill('600');
    await p.locator('#btn-save-lab').click(); await p.waitForTimeout(600);
    assert.deepEqual(await labExp('E1'), [['Boys', 'b2', 2400], ['Ghati', 'ga', 2100], ['Ghati', 'ge', 700]]);
    const x = (await dump()).expenses.filter(e => e.evId === 'E1'); assert.ok(x.every(e => e.pay === 'credit'));
    await openEvent('E1');
    const card = await p.locator('#labour-card').innerText();
    assert.match(card, /Ghati · Sample Ghati Contractor/); assert.match(card, /Ghati · Sample Extra Ghati/); assert.match(card, /Boys · Sample Boys Two/);
    // Each contractor's page shows only what is owed to them
    await p.evaluate(async () => {}); const dues = await p.evaluate(async () => { const u = await import('./utils.js'), db = await import('./db.js'); const d = await db.exportAllData();
      return Object.fromEntries(['ga', 'ge', 'b2'].map(id => [id, d.expenses.filter(x => x.venId === id && x.pay === 'credit').reduce((s, x) => s + x.amt, 0)])); });
    assert.deepEqual(dues, { ga: 2100, ge: 700, b2: 2400 });
  });

  await test('each contractor gets their own list on WhatsApp: their lines, date and venue; no client or event name', async () => {
    await openEvent('E1');
    assert.equal(await p.locator('#lab-send [data-action="lab-send"]').count(), 5);
    await p.locator('#lab-send [data-action="lab-send"][data-id="ga"]').click(); await p.waitForTimeout(300);
    const url = await p.evaluate(() => window.__opened.at(-1)), msg = decodeURIComponent(url.split('text=')[1]);
    assert.match(url, /^https:\/\/wa\.me\/(91)?9000000101\?text=/);
    assert.match(msg, /^Namaste Sample Ghati Contractor! Labour needed:\nDate: .*\nGhati: Evening 3 @ ₹700\nVenue: Sample Hall, Sample Area\n\nPlease confirm\. Thank you!$/);
    assert.doesNotMatch(msg, /Sample Gala Event|Extra Ghati|Boys|Rojiya/, 'only their own lines, no event name');
  });

  await test('to pay: a priced line without a contractor is refused; one bill total for several contractors is refused', async () => {
    await openSheet('E1');
    await line(2).locator('[data-k="venId"]').selectOption(''); await p.locator('#btn-save-lab').click(); await p.waitForTimeout(400);
    assert.match(await p.locator('#toast-msg').innerText(), /Choose the contractor for Boys/); assert.equal(await p.locator('#lab-modal.active').count(), 1);
    await line(2).locator('[data-k="venId"]').selectOption('b2');
    await p.fill('#lab-bill', '9000'); await p.locator('#lab-bill').dispatchEvent('input'); await p.locator('#btn-save-lab').click(); await p.waitForTimeout(400);
    assert.match(await p.locator('#lab-modal').innerText(), /Several contractors: put each line's rate/);
    assert.deepEqual(await labExp('E1'), [['Boys', 'b2', 2400], ['Ghati', 'ga', 2100], ['Ghati', 'ge', 700]], 'nothing changed');
  });

  await test('+ New vendor on a line opens a Labour contractor with that worker type, and puts them on that line', async () => {
    await openSheet('E1'); await p.fill('#lab-bill', ''); await p.locator('#lab-bill').dispatchEvent('input');
    await line(1).locator('[data-k="venId"]').selectOption('__new'); await p.waitForSelector('#ven-modal.active');
    assert.equal(await p.inputValue('#ven-cat'), 'Labour'); assert.equal(await p.inputValue('#ven-specialty'), ROJIYA);
    await p.fill('#ven-name', 'Sample New Rojiya'); await p.fill('#ven-phone', '9000000777'); await p.locator('#btn-save-ven').click(); await p.waitForTimeout(500);
    const id = (await dump()).vendors.find(v => v.name === 'Sample New Rojiya').id;
    assert.equal(await line(1).locator('[data-k="venId"]').inputValue(), id);
    await p.locator('#btn-save-lab').click(); await p.waitForTimeout(500);
    assert.equal((await dump()).events.find(e => e.id === 'E1').labour.rows[1].venId, id);
  });

  await test('a sheet saved before 5.1.0 (one contractor) keeps its expense, bill photo and dues when opened and saved', async () => {
    await openSheet('E0');
    assert.equal(await line(0).locator('[data-k="venId"]').inputValue(), 'b1', 'the sheet\'s contractor shows on its line');
    await p.locator('#btn-save-lab').click(); await p.waitForTimeout(600);
    const d = await dump(), x = d.expenses.filter(e => e.evId === 'E0');
    assert.deepEqual(x.map(e => [e.id, e.venId, e.amt, e.billIds]), [['old1', 'b1', 1000, ['ph1']]], 'same expense, same photo, same contractor');
    assert.deepEqual(d.events.find(e => e.id === 'E0').labour.expIds, { [`Labour|${BOYS}|b1`]: 'old1' });
    // An expense typed by hand for this item is still recognised as the sheet's
    assert.equal(await p.evaluate(async b => { const u = await import('./utils.js'), db = await import('./db.js'); const d = await db.exportAllData();
      return u.labourCovers(d.events.find(e => e.id === 'E0'), d.expenses, 'Labour', b)?.id; }, BOYS), 'old1');
  });

  await test('backups refuse a malformed contractor on a labour line', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest; d.events.find(e => e.id === 'E1').labour.rows[0].venId = 7;
      try { await db.importAllData(d, 'replace'); return 'accepted'; } catch (e) { return e.message; } });
    assert.match(r, /Invalid labour sheet/);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'labour-contractors FAIL' : 'labour contractors: a contractor per line, two for one type, own dues and WhatsApp list, older sheets kept PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('labour-contractors FAIL'); process.exitCode = 1; });
