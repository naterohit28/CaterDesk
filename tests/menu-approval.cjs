// Client-approved menu versions (PR 4): approving keeps an unchangeable copy of every meal's menu (numbered, with how
// and by whom); later changes are listed meal by meal against the last approved version and approved as a new one;
// earlier versions never change; library menus shown but not used are left out and named. 360px. Synthetic data.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [], vendors: [],
  events: [{ id: 'e1', name: 'Sample Approval Wedding', date: day(9), venue: 'Sample Lawns', type: 'Wedding – लग्न', billing: 300000, guests: 300, meals: ['lunch', 'dinner'], photoIds: [],
    mealPlan: { lunch: { guests: 250, rate: 450 }, dinner: { guests: 300, rate: 650, menu: 'golden' } },
    dishes: [{ name: 'Jeera Rice', head: '', meal: 'lunch' }, { name: 'Pani Puri', head: 'Chaat – चाट', meal: 'lunch' }, { name: 'Dal Tadka', head: '', meal: 'lunch', diet: ['jain'] }, { name: 'Mineral Water', head: '' }] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const ev = async id => (await dump()).events.find(e => e.id === id);
  const openEvent = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"]:visible', { hasText: 'Sample Approval Wedding' }).first().click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  const bar = () => p.locator('#menu-approval').innerText();
  const sheetDish = name => p.locator('#svc-dishes .svc-dish').filter({ has: p.locator(`input[data-k="name"][value="${name}"]`) });
  const fmt = d => p.evaluate(async x => (await import('./utils.js')).fmtDate(x), d);
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  let v1;

  await test('first approval: written or verbal (with who), a copy of every meal kept; an unconfirmed library menu is left out and named', async () => {
    await openEvent();
    assert.match(await bar(), /Not approved by the client yet/);
    await p.locator('[data-action="menu-approve"]').click(); await p.waitForSelector('#ma-modal.active');
    assert.match(await p.locator('#ma-body').innerText(), /First approved version: 2 meals, 4 dishes\./);
    assert.match(await p.locator('#ma-body').innerText(), /Not included: Dinner only has a library menu shown, not confirmed/);
    assert.match(await p.locator('#ma-body').innerText(), /Nothing is sent to anyone/);
    await p.locator('#btn-save-approval').click(); await p.waitForTimeout(200);
    assert.match(await p.locator('#ma-modal .field-error').innerText(), /Written or verbal/);
    await p.selectOption('#ma-by', 'verbal'); await p.locator('#btn-save-approval').click(); await p.waitForTimeout(200);
    assert.match(await p.locator('#ma-modal .field-error').innerText(), /write who approved/);
    assert.equal((await ev('e1')).menuApproved, undefined, 'nothing saved yet');
    await p.selectOption('#ma-by', 'written'); await p.locator('#btn-save-approval').click(); await p.waitForTimeout(600);
    assert.match(await p.locator('#toast-msg').innerText(), /Menu approved as version 1/);
    const e = await ev('e1'); v1 = e.menuApproved[0];
    assert.equal(e.menuApproved.length, 1); assert.equal(v1.n, 1); assert.equal(v1.by, 'written');
    assert.deepEqual(v1.services.map(s => [s.id, s.guests, s.rate, s.dishes.map(d => d.name)]), [['svc-lunch', 250, 450, ['Jeera Rice', 'Pani Puri', 'Dal Tadka']], ['svc-dinner', 300, 650, []]]);
    assert.deepEqual(v1.services[0].dishes.find(d => d.name === 'Dal Tadka'), { name: 'Dal Tadka', head: '', diet: ['jain'] });
    assert.deepEqual(v1.shared, [{ name: 'Mineral Water', head: '' }]); assert.deepEqual(v1.pending, ['svc-dinner'], 'library menu not used: left out, named');
    await openEvent();
    assert.match(await bar(), new RegExp(`^Approved v1 · ${await fmt(day(0))} · written$`, 'm'));
    // The line is shown as words in the chosen language, never as markup (4.31.3: it was escaped and showed both)
    assert.doesNotMatch(await bar(), /<span|t-en|t-mr|मान्य/, 'English only, no visible markup');
    assert.equal(await p.locator('#menu-approval .ma-text .t-mr').count(), 1, 'the Marathi half is a hidden element, not text');
    assert.equal(await p.locator('[data-action="menu-approve"]').count(), 0, 'nothing to approve');
  });

  await test('later changes are listed meal by meal against the approved version and approved as version 2; version 1 never changes', async () => {
    await p.locator('.svc-card[data-meal-menu="lunch"] [data-action="svc-edit"]').click(); await p.waitForSelector('#svc-modal.active');
    await sheetDish('Pani Puri').locator('[data-sd-del]').click();
    await sheetDish('Jeera Rice').locator('[data-k="head"]').selectOption('Chaat – चाट');
    await p.fill('#svc-add', 'Gulab Jamun'); await p.locator('#btn-svc-add').click();
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(600);
    // and a guest change on the event form
    await openEvent(); await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active');
    if (await p.locator('#ev-mp').getAttribute('open') === null) await p.locator('#ev-mp summary').click();
    await p.fill('#ev-mp-lunch-g', '260'); await p.locator('#btn-save-event').click(); await p.waitForTimeout(500);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
    await openEvent();
    assert.match(await bar(), /Changed since approved v1 · 3 changes/, 'Jeera Rice moving to a counter is internal, not a client change');
    await p.locator('[data-action="menu-approve"]').click(); await p.waitForSelector('#ma-modal.active');
    const body = await p.locator('#ma-body').innerText();
    assert.match(body, /Changes since approved version 1:/);
    assert.match(body, /Lunch\n~\nGuests 250 → 260\n\+\nGulab Jamun\n−\nPani Puri\n~\nJeera Rice: sourcing Our kitchen → Counter \(internal, not for the client\)/);
    assert.doesNotMatch(body, /^Dinner$/m, "no dinner changes listed (dinner is only named as not included)");
    await p.selectOption('#ma-by', 'verbal'); await p.fill('#ma-who', 'Sample Client <b>Father</b>');
    assert.equal(await p.locator('#btn-save-approval').innerText(), 'Save approved version 2');
    await p.locator('#btn-save-approval').click(); await p.waitForTimeout(600);
    const e = await ev('e1');
    assert.equal(e.menuApproved.length, 2); assert.deepEqual(e.menuApproved[0], v1, 'version 1 exactly as approved');
    assert.deepEqual(e.menuApproved[1].services[0].dishes.map(d => [d.name, d.head]), [['Jeera Rice', 'Chaat – चाट'], ['Dal Tadka', ''], ['Gulab Jamun', '']]);
    assert.deepEqual([e.menuApproved[1].by, e.menuApproved[1].who, e.menuApproved[1].services[0].guests], ['verbal', 'Sample Client <b>Father</b>', 260]);
    await openEvent();
    assert.match(await bar(), /Approved v2 · .* · verbal \(Sample Client <b>Father<\/b>\)/, 'a typed name is shown as typed, not run as markup');
    assert.equal(await p.locator('#menu-approval b').count(), 0);
  });

  await test('versions: newest first, each with what changed from the one before', async () => {
    await p.locator('[data-action="menu-versions"]').click(); await p.waitForSelector('#mv-modal.active');
    const vers = p.locator('#mv-body .mv-ver');
    assert.equal(await vers.count(), 2);
    assert.match(await vers.nth(0).innerText(), /^Version 2\n.* · verbal \(Sample Client <b>Father<\/b>\) · 4 dishes\nChanges from version 1:/);
    assert.match(await vers.nth(0).innerText(), /\+\nGulab Jamun/);
    await vers.nth(1).locator('summary').click();
    assert.match(await vers.nth(1).innerText(), /^Version 1\n.* · written · 4 dishes\nLunch · new\n\+\nJeera Rice\n\+\nPani Puri\n\+\nDal Tadka[\s\S]*Every meal\n\+\nMineral Water/);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  });

  await test('a dish changed from veg to non-veg (or a new course) after approval needs approval again', async () => {
    // Food type and course are kept from before (the sheet no longer asks for them); set them as saved data
    const setDish = (name, fields) => p.evaluate(async ([n, f]) => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest;
      const e = d.events.find(x => x.id === 'e1'); e.dishes = e.dishes.map(x => x.name === n ? { ...x, ...f } : x); delete e._rev; await db.importAllData(d, 'replace'); }, [name, fields]);
    await setDish('Gulab Jamun', { type: 'veg' });
    await openEvent(); await p.locator('[data-action="menu-approve"]').click(); await p.waitForSelector('#ma-modal.active');
    await p.selectOption('#ma-by', 'written'); await p.locator('#btn-save-approval').click(); await p.waitForTimeout(600);
    await openEvent(); assert.match(await bar(), /Approved v3/);
    await setDish('Gulab Jamun', { type: 'nonveg' });
    await openEvent();
    assert.match(await bar(), /Changed since approved v3 · 1 change/, 'veg → non-veg is not "unchanged since approval"');
    const u = await p.evaluate(async () => { const u = await import('./utils.js'), db = await import('./db.js'); const e = (await db.exportAllData()).events[0]; return u.menuSinceApproved(e).count; });
    assert.equal(u, 1);
    await p.locator('[data-action="menu-approve"]').click(); await p.waitForSelector('#ma-modal.active');
    assert.match(await p.locator('#ma-body').innerText(), /Lunch\n~\nGulab Jamun: food type Veg → Non-veg/);
    await p.locator('#ma-modal [data-action="close-modal"]').click();
    await setDish('Gulab Jamun', { type: 'veg', cat: 'dessert' });
    await openEvent();
    assert.match(await bar(), /Changed since approved v3 · 1 change/, 'a new course needs approval too');
    await p.locator('[data-action="menu-approve"]').click(); await p.waitForSelector('#ma-modal.active');
    assert.match(await p.locator('#ma-body').innerText(), /Gulab Jamun: course not set → Dessert/);
    await p.locator('#ma-modal [data-action="close-modal"]').click();
  });

  await test('moving the event to another date after approval needs approval again (each meal keeps the date it was approved for)', async () => {
    await openEvent(); await p.locator('[data-action="menu-approve"]').click(); await p.waitForSelector('#ma-modal.active');
    await p.selectOption('#ma-by', 'written'); await p.locator('#btn-save-approval').click(); await p.waitForTimeout(600);
    await openEvent(); assert.match(await bar(), /Approved v4/);
    const kept = (await ev('e1')).menuApproved.at(-1);
    assert.deepEqual(kept.services.map(s => s.date), [day(9), day(9)], 'meals on the event date keep that date in the copy');
    await p.evaluate(async nd => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest;
      const e = d.events.find(x => x.id === 'e1'); e.date = nd; delete e._rev; await db.importAllData(d, 'replace'); }, day(12));
    await openEvent();
    assert.match(await bar(), /Changed since approved v4 · 2 changes/, 'a new event date is not "unchanged since approval"');
    await p.locator('[data-action="menu-approve"]').click(); await p.waitForSelector('#ma-modal.active');
    const body = await p.locator('#ma-body').innerText(), from = await fmt(day(9)), to = await fmt(day(12));
    assert.ok(body.includes(`Date ${from} → ${to}`), body);
    await p.locator('#ma-modal [data-action="close-modal"]').click();
    assert.deepEqual((await ev('e1')).menuApproved.at(-1).services.map(s => s.date), [day(9), day(9)], 'the approved copy still has the old date');
  });

  await test('two dishes with the same name (Jain and plain) are told apart; a very long dish name never makes a backup unrestorable', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'), u = await import('./utils.js'); const out = {};
      const d0 = await db.exportAllData(); delete d0.manifest;
      const d = structuredClone(d0), e = d.events.find(x => x.id === 'e1'); delete e._rev;
      e.dishes = [...e.dishes, { name: 'Sample Rice', head: '', meal: 'lunch', diet: ['jain'] }, { name: 'Sample Rice', head: '', meal: 'lunch' }, { name: 'Sample ' + 'Long Dish '.repeat(25), head: '', meal: 'dinner' }];
      e.menuApproved = [...e.menuApproved, u.approvedVersion(e, { by: 'written' })];
      out.approved = u.menuSinceApproved(e).count;
      try { await db.importAllData(structuredClone(d), 'replace'); out.restore = 'ok'; } catch (x) { out.restore = x.message; }
      e.dishes = e.dishes.filter(x => !(x.name === 'Sample Rice' && x.diet));   // the Jain rice is dropped
      const diff = u.menuSinceApproved(e); out.count = diff.count; out.removed = diff.meals.flatMap(m => m.removed);
      await db.importAllData(d0, 'replace'); return out; });
    assert.equal(r.approved, 0); assert.equal(r.restore, 'ok', 'a backup with a long approved dish name restores');
    assert.equal(r.count, 1, 'removing the Jain variant is a change'); assert.deepEqual(r.removed, ['Sample Rice']);
  });

  await test('backups keep approved versions; malformed ones are refused', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const out = [];
      const d0 = await db.exportAllData(); delete d0.manifest;
      await db.importAllData(structuredClone(d0), 'replace');
      out.push(JSON.stringify((await db.exportAllData()).events[0].menuApproved) === JSON.stringify(d0.events[0].menuApproved) ? 'kept' : 'lost');
      const [a, b] = d0.events[0].menuApproved;
      for (const bad of [[b, a], [{ ...a, by: 'email' }], [{ ...a, n: 2 }], [a, { ...b, id: a.id }], [{ ...a, services: [{ ...a.services[0], dishes: [{ name: '' }] }] }], [{ ...a, services: [{ ...a.services[0], guests: -1 }] }], 'x']) {
        const d = structuredClone(d0); d.events[0].menuApproved = bad;
        try { await db.importAllData(d, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message.split('.')[0]); } }
      await db.importAllData(d0, 'replace'); return out; });
    assert.deepEqual(r, ['kept', ...Array(7).fill('Invalid approved menu')]);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'approved menu versions FAIL' : 'approved menu versions PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('approved menu versions FAIL'); process.exitCode = 1; });
