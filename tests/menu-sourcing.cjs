// Menu sourcing and purchase orders (4.28.0): every dish is made in our kitchen, bought ready-made, bought and finished
// by us, or served by a vendor's counter; old dishes keep their meaning. Bought items get purchase orders (supplier,
// quantity, unit, delivery, instructions, optional estimate) with WhatsApp history; no expense is made by itself; a
// delivered purchase's bill is recorded or linked once. Sourcing changes are internal for client approval; a sent
// purchase whose item changes is flagged, never resent. The ten scenarios of the brief. 360px. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const CHAAT = 'Chaat – चाट';
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'vs', name: 'Sample Sweet Mart', cat: 'Raw Material', phone: '9000000031' }, { id: 'vw', name: 'Sample Water Supply', cat: 'Raw Material', phone: '9000000032' },
    { id: 'vi', name: 'Sample Ice Cream Co', cat: 'Raw Material', phone: '9000000033' }, { id: 'vf', name: 'Sample Frozen Foods', cat: 'Raw Material', phone: '9000000034' },
    { id: 'vc', name: 'Sample Chaat Stall', cat: 'Live Counter', phone: '9000000035' }],
  events: [{ id: 'e1', name: 'Sample Sourcing Wedding', date: day(14), venue: 'Sample Lawns', type: 'Wedding – लग्न', billing: 400000, meals: ['lunch', 'dinner'], photoIds: [],
    mealPlan: { lunch: { guests: 250, rate: 0 }, dinner: { guests: 300, rate: 0 } }, services: [{ id: 'svc-lunch', meal: 'lunch', time: '12:30' }, { id: 'svc-dinner', meal: 'dinner', time: '20:00' }],
    dishes: [{ name: 'Gulab Jamun', head: '', src: 'buy', meal: 'lunch' }, { name: 'Dal Tadka', head: '', meal: 'lunch' },
      { name: 'Gulab Jamun', head: '', meal: 'dinner' }, { name: 'Ice Cream', head: '', src: 'buy', meal: 'dinner' }, { name: 'Spring Rolls', head: '', src: 'finish', meal: 'dinner' },
      { name: 'Pani Puri', head: CHAAT, meal: 'dinner' }, { name: 'Mineral Water', head: '', src: 'buy' }] }] };

const pickTime = async (p, id, hhmm = '19:30') => { if (await p.inputValue('#' + id)) return; const [h, m] = hhmm.split(':').map(Number); await p.selectOption('#' + id + '-h', String(h % 12 || 12)); await p.selectOption('#' + id + '-m', String(m).padStart(2, '0')); await p.selectOption('#' + id + '-ap', h < 12 ? 'AM' : 'PM'); };
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const ev = async () => (await dump()).events.find(e => e.id === 'e1');
  const openEvent = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="e1"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    await p.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return {}; }; }); };
  const buyRow = key => p.locator(`#buy-list [data-buy="${key}"]`);
  const lastMessage = async () => decodeURIComponent((await p.evaluate(() => window.__opened.at(-1))).split('text=')[1]);
  const order = async (key, { ven, qty, unit, est, notes }) => {
    await buyRow(key).locator('[data-action="buy-new"]').click(); await p.waitForSelector('#buy-modal.active');
    await p.selectOption('#buy-ven', ven); await p.fill('#buy-qty', String(qty)); await p.selectOption('#buy-unit', unit);
    if (est != null) await p.fill('#buy-est', String(est)); if (notes) await p.fill('#buy-notes', notes);
    await pickTime(p, 'buy-time'); await p.locator('#btn-send-buy').click(); await p.waitForTimeout(500); if (await p.locator('#ask-modal.active #ask-actions .btn-wa').count()) { await p.locator('#ask-modal.active #ask-actions .btn-wa').click(); await p.waitForTimeout(400); } };
  const status = async (key, label) => { await buyRow(key).locator('[data-action="buy-status"]').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: label }).click(); await p.waitForTimeout(500); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);

  await test('the menu lists bought items under To buy; kitchen dishes and the Chaat counter stay where they were (scenarios 5, 6, 7)', async () => {
    await openEvent();
    assert.deepEqual(await p.locator('#buy-list [data-buy]').evaluateAll(r => r.map(x => x.dataset.buy)),
      ['svc-lunch|gulab jamun', '*|mineral water', 'svc-dinner|ice cream', 'svc-dinner|spring rolls']);
    assert.match(await buyRow('svc-lunch|gulab jamun').innerText(), /Gulab Jamun\nLunch · Buy ready-made/);
    assert.match(await buyRow('svc-dinner|spring rolls').innerText(), /Spring Rolls\nDinner · Buy & finish/);
    assert.match(await buyRow('*|mineral water').innerText(), /Mineral Water\nEvery meal · Buy ready-made/);
    const kitchen = await p.locator('#menu-orders').innerText();
    assert.match(kitchen, /Our kitchen\nDal Tadka, Gulab Jamun/, 'Gulab Jamun at dinner is made by us; at lunch it is bought');
    assert.match(await p.locator(`#menu-orders [data-counter="svc-dinner|${CHAAT}"]`).innerText(), /Chaat · Dinner/, 'the counter is still a counter order');
    assert.equal(await p.locator('#buy-list').innerText().then(t => /Pani Puri|Dal Tadka/.test(t)), false);
  });

  await test('Gulab Jamun from a sweet supplier: quantity and unit, delivery from the meal, WhatsApp, no expense made (scenario 1)', async () => {
    await order('svc-lunch|gulab jamun', { ven: 'vs', qty: 300, unit: 'pcs', notes: 'Packed in boxes of 50' });
    const msg = await lastMessage();
    assert.match(msg, /^Namaste Sample Sweet Mart! Purchase order for Sample Sourcing Wedding:\nItem: Gulab Jamun\nQuantity: 300 pieces\nDate: .* \(Lunch\)\nDeliver by: 12:30 PM\nVenue: Sample Lawns\nNote: Packed in boxes of 50/);
    const pu = (await ev()).purchases[0];
    assert.deepEqual([pu.item, pu.src, pu.svc, pu.qty, pu.unit, pu.time, pu.status, pu.basis], ['Gulab Jamun', 'buy', 'svc-lunch', 300, 'pcs', '12:30', 'opened', { item: 'Gulab Jamun', src: 'buy', meal: 'lunch' }]);
    assert.equal((await dump()).expenses.length, 0, 'preparing or sending makes no expense');
    await openEvent(); assert.match(await buyRow('svc-lunch|gulab jamun').innerText(), /Sample Sweet Mart · 300 pieces\nWhatsApp opened/);
  });

  await test('mineral water in cartons and ice cream in tubs with an estimate that is never a cost (scenarios 2, 3)', async () => {
    await openEvent(); await order('*|mineral water', { ven: 'vw', qty: 20, unit: 'carton' });
    assert.match(await lastMessage(), /Item: Mineral Water\nQuantity: 20 cartons\n/);
    assert.equal((await ev()).purchases.at(-1).svc, undefined, 'one purchase for every meal');
    await openEvent(); await order('svc-dinner|ice cream', { ven: 'vi', qty: 10, unit: 'tub', est: 4500 });
    const pu = (await ev()).purchases.at(-1);
    assert.equal(pu.estCost, 4500); assert.doesNotMatch(await lastMessage(), /4500|4,500|estimate/i, 'the estimate stays internal');
    assert.equal((await dump()).expenses.length, 0);
  });

  await test('frozen spring rolls bought and fried by us; the function sheet lists bought items with supplier and quantity (scenario 4)', async () => {
    await openEvent(); await order('svc-dinner|spring rolls', { ven: 'vf', qty: 15, unit: 'kg' });
    await openEvent(); await p.locator('[data-action="fs-open"]').click(); await p.waitForSelector('#fs-modal.active');
    const fs = await p.locator('#fs-text').innerText();
    assert.match(fs, /- Buy & finish · Dinner: Spring Rolls\n  Sample Frozen Foods \(9000000034\) · 15 kg · WhatsApp opened/);
    assert.match(fs, /- Buy ready-made · Lunch: Gulab Jamun\n  Sample Sweet Mart/);
    assert.match(fs, /- Our kitchen: Dal Tadka, Gulab Jamun/);
    await p.locator('#fs-modal [data-action="close-modal"]').first().click();
  });

  await test('a purchase changed after it was sent: a new message version, back to WhatsApp opened, nothing resent by itself (scenario 9)', async () => {
    await openEvent(); await status('svc-lunch|gulab jamun', 'I have sent it');
    assert.equal((await ev()).purchases[0].status, 'sent');
    await openEvent(); await status('svc-lunch|gulab jamun', 'Edit / send again');
    await p.waitForSelector('#buy-modal.active'); assert.equal(await p.inputValue('#buy-qty'), '300');
    await p.fill('#buy-qty', '320'); await pickTime(p, 'buy-time'); await p.locator('#btn-send-buy').click(); await p.waitForTimeout(500); if (await p.locator('#ask-modal.active #ask-actions .btn-wa').count()) { await p.locator('#ask-modal.active #ask-actions .btn-wa').click(); await p.waitForTimeout(400); }
    const pu = (await ev()).purchases[0];
    assert.deepEqual([pu.qty, pu.status, pu.messages.length, pu.messages[0].status], [320, 'opened', 2, 'sent']);
    assert.match(pu.messages[1].text, /Quantity: 320 pieces/);
  });

  await test('sourcing changed after the menu is approved: not a client change; the sent purchase is flagged for review (scenario 8)', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'), u = await import('./utils.js'); const d = await db.exportAllData(); delete d.manifest;
      const e = d.events.find(x => x.id === 'e1'); e.menuApproved = [u.approvedVersion(e, { by: 'written' })];
      e.purchases = e.purchases.map(x => x.item === 'Ice Cream' ? { ...x, status: 'sent' } : x); delete e._rev; await db.importAllData(d, 'replace'); });
    await openEvent();
    await p.locator('.svc-card[data-meal-menu="dinner"] [data-action="svc-edit"]').click(); await p.waitForSelector('#svc-modal.active');
    const sel = p.locator('#svc-dishes .svc-dish').filter({ has: p.locator('input[data-k="name"][value="Ice Cream"]') }).locator('[data-k="head"]');
    assert.equal(await sel.inputValue(), '@buy');
    assert.deepEqual((await sel.locator('option').allInnerTexts()).slice(0, 3), ['Our kitchen', 'Buy ready-made', 'Buy & finish']);
    await sel.selectOption(''); await p.locator('#btn-save-svc').click(); await p.waitForTimeout(600);
    await openEvent();
    assert.match(await p.locator('#menu-approval').innerText(), /Approved v1/, 'sourcing is internal: no new client approval');
    const pu = (await ev()).purchases.find(x => x.item === 'Ice Cream');
    assert.equal(pu.changed, true); assert.equal(pu.status, 'sent', 'nothing resent');
    assert.match(await p.locator('#buy-list').innerText(), /Ice Cream\nNot on the current menu · 10 tubs\nMenu changed · review/);
    await p.locator('[data-action="menu-versions"]').click(); await p.waitForSelector('#mv-modal.active');
    await p.locator('#mv-modal [data-action="close-modal"]').first().click();
    const diff = await p.evaluate(async () => { const u = await import('./utils.js'), db = await import('./db.js'); const e = (await db.exportAllData()).events[0]; return u.menuSinceApproved(e); });
    assert.equal(diff.count, 0); assert.deepEqual(diff.meals.flatMap(m => m.changed).map(c => [c.name, c.what, c.from, c.to, c.internal]), [['Ice Cream', 'source', 'buy', 'kitchen', true]]);
    // marking it sent again (after reissuing) clears the flag
    await openEvent(); await p.locator('#buy-list [data-action="buy-status"]', { hasText: 'Menu changed' }).click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Cancel purchase' }).click(); await p.waitForTimeout(400);
    assert.equal((await ev()).purchases.find(x => x.item === 'Ice Cream').status, 'cancelled');
  });

  await test('delivered: its bill is recorded once and linked; a second bill is never added for it', async () => {
    await openEvent(); await status('*|mineral water', 'Delivered');
    await p.waitForSelector('#exp-modal.active');
    assert.equal(await p.inputValue('#exp-cat'), 'Raw Material');
    await p.fill('#exp-amt', '2400'); await p.locator('#btn-save-exp').click(); await p.waitForTimeout(600);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
    const d = await dump(), water = d.events[0].purchases.find(x => x.item === 'Mineral Water');
    const bills = d.expenses.filter(x => x.purchase === water.id);
    assert.equal(bills.length, 1); assert.deepEqual([bills[0].venId, bills[0].amt, bills[0].evId], ['vw', 2400, 'e1']);
    await openEvent(); assert.match(await buyRow('*|mineral water').innerText(), /Delivered · billed/);
    await buyRow('*|mineral water').locator('[data-action="buy-status"]').click(); await p.waitForSelector('#ask-modal.active');
    assert.equal(await p.locator('#ask-actions button', { hasText: 'Record / link its bill' }).count(), 0);
    await p.keyboard.press('Escape');
  });

  await test('backups keep purchases and links; old data restores unchanged; malformed purchases are refused, impossible links removed with the bill kept (scenario 10)', async () => {
    const r = await p.evaluate(async old => { const db = await import('./db.js'); const out = [];
      const d0 = await db.exportAllData(); delete d0.manifest;
      await db.importAllData(structuredClone(d0), 'replace');
      const back = await db.exportAllData(); out.push(JSON.stringify(back.events[0].purchases) === JSON.stringify(d0.events[0].purchases) && back.expenses.length === d0.expenses.length ? 'kept' : 'lost');
      const o = structuredClone(old); await db.importAllData(o, 'replace');
      const strip = x => { const y = structuredClone(x); delete y._rev; return y; };
      out.push(JSON.stringify((await db.exportAllData()).events.map(strip)) === JSON.stringify(old.events) ? 'old unchanged' : 'old changed');
      const tries = [d => { d.events[0].purchases[0].unit = 'crate'; }, d => { d.events[0].purchases[0].qty = 0; }, d => { d.events[0].purchases[0].src = 'counter'; },
        d => { d.events[0].dishes[0].head = 'Chaat – चाट'; }, d => { d.expenses[0].order = 'x1'; }, d => { d.expenses[0].purchase = 'nope'; }];
      // A link that cannot be right (also an order's, or a purchase not on its event) is removed on restore; the bill is kept (4.28.1)
      for (const t of tries) { const d = structuredClone(d0); t(d); try { const { repaired } = await db.importAllData(d, 'replace'); const x = (await db.exportAllData()).expenses[0];
        out.push(repaired ? `kept bill, link removed: ${repaired} ${x.amt === d0.expenses[0].amt && x.purchase === undefined}` : 'accepted'); } catch (e) { out.push(e.message.split(/[.:]/)[0]); } }
      await db.importAllData(d0, 'replace'); return out; },
      { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [], vendors: [], events: [{ id: 'old', name: 'Sample Old Event', date: day(40), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 100, photoIds: [],
        dishes: [{ name: 'Sample Rice', head: '' }, { name: 'Sample Chaat', head: CHAAT }], orders: [{ id: 'o1', head: CHAAT, venId: 'v', plates: 100, date: day(40), status: 'sent', at: '2026-11-01T10:00:00.000Z' }] }] });
    assert.deepEqual(r, ['kept', 'old unchanged', 'Invalid purchase', 'Invalid purchase', 'Invalid purchase', 'Invalid dish details', 'kept bill, link removed: 1 true', 'kept bill, link removed: 1 true']);
  });

  await test('360px: the To buy list and the purchase sheet fit in English, Marathi and both', async () => {
    for (const lang of ['en', 'mr', 'both']) {
      await p.evaluate(l => localStorage.setItem('ffv2_lang', l), lang); await openEvent();
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, `page ${lang}`);
      await buyRow('svc-dinner|spring rolls').locator('[data-action="buy-status"]').click(); await p.waitForSelector('#ask-modal.active');
      await p.locator('#ask-actions button', { hasText: /send again|बदला/ }).click(); await p.waitForSelector('#buy-modal.active');
      const sheet = await p.locator('#buy-modal .sheet').boundingBox();
      for (const id of ['#buy-ven', '#buy-qty', '#buy-unit', '#buy-est']) { const b = await p.locator(id).boundingBox(); assert.ok(b.x >= sheet.x && b.x + b.width <= sheet.x + sheet.width + 1, `${id} ${lang}`); }
      await p.locator('#buy-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(250);
    }
    await p.evaluate(() => localStorage.setItem('ffv2_lang', 'en'));
  });

  await test('a purchase bill split with another event keeps its link on one part only, and the backup still restores (Codex P1)', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest;
      d.events.push({ id: 'e2', name: 'Sample Second Event', date: d.events[0].date, venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 50000, guests: 80, photoIds: [] });
      await db.importAllData(d, 'replace'); });
    const water = (await ev()).purchases.find(x => x.item === 'Mineral Water'), bill = (await dump()).expenses.find(x => x.purchase === water.id);
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-expenses:visible').click();
    await p.locator(`#exp-list [data-action="edit-exp"][data-id="${bill.id}"]:visible`).first().click(); await p.waitForSelector('#exp-modal.active');
    await p.locator('#btn-share-exp').click(); await p.waitForSelector('#split-modal.active');
    if (!(await p.locator('#split-rows [data-sp="1"]').count())) await p.locator('#btn-split-add').click();
    await p.locator('#split-rows [data-sp="0"] [data-k="amt"]').fill('1200');
    await p.locator('#split-rows [data-sp="1"] [data-k="evId"]').selectOption('e2'); await p.locator('#split-rows [data-sp="1"] [data-k="amt"]').fill('1200');
    await p.locator('#btn-save-split').click(); await p.waitForTimeout(600);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
    const d = await dump(), parts = d.expenses.filter(x => x.split);
    assert.equal(parts.length, 2, 'split into two parts');
    assert.deepEqual(parts.filter(x => x.purchase).map(x => x.evId), ['e1'], 'only the part on the purchase\'s event keeps the link');
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const x = await db.exportAllData(); delete x.manifest; try { await db.importAllData(x, 'replace'); return 'restored'; } catch (e) { return e.message; } });
    assert.equal(r, 'restored');
  });

  await test('a sourcing-only edit in the meal sheet is not lost when switching meals (Codex P2)', async () => {
    await openEvent();
    await p.locator('.svc-card[data-meal-menu="dinner"] [data-action="svc-edit"]').click(); await p.waitForSelector('#svc-modal.active');
    const sel = p.locator('#svc-dishes .svc-dish').filter({ has: p.locator('input[data-k="name"][value="Spring Rolls"]') }).locator('[data-k="head"]');
    await sel.selectOption('@buy');
    const meal = await p.locator('#svc-meal option').evaluateAll(o => o.map(x => x.value));
    await p.selectOption('#svc-meal', meal.find(v => v.includes('lunch')));
    await p.waitForTimeout(300);
    assert.equal(await p.locator('#ask-modal.active').count(), 1, 'asks before discarding the change');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    await p.locator('#svc-modal [data-action="close-modal"]').first().click().catch(() => {});
  });

  await test('emptying the menu keeps purchases reachable, so a flagged one can still be reviewed (Codex P2)', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest;
      const e = d.events.find(x => x.id === 'e1'); e.dishes = []; delete e._rev; await db.importAllData(d, 'replace'); });
    await openEvent();
    assert.equal(await p.locator('#buy-list').count(), 1);
    assert.match(await p.locator('#buy-list').innerText(), /Gulab Jamun\nNot on the current menu/);
    assert.ok(await p.locator('#buy-list [data-action="buy-status"]').count() >= 1, 'a status control to review or cancel');
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'menu sourcing FAIL' : 'menu sourcing PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('menu sourcing FAIL'); process.exitCode = 1; });
