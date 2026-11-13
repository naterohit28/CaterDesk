// Corrective release 4.4.1 (independent audit of 4.3.0 / 4.4.0): one focused test per finding. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const base = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [],
  vendors: [{ id: 'v1', name: 'Sample Chaat Counter', cat: 'Live Counter', phone: '9000000001' }, { id: 'v2', name: 'Sample Dosa Counter', cat: 'Live Counter', phone: '9000000002' },
    { id: 'v3', name: 'Sample Grocer', cat: 'Raw Material' }],
  events: [{ id: 'e1', name: 'Sample Reception', date: day(6), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 300000, guests: 300, meals: ['dinner'], photoIds: [],
    dishes: [{ name: 'Pani Puri', head: 'Chaat – चाट' }, { name: 'Masala Dosa', head: 'Dosa – डोसा' }],
    orders: [{ id: 'oc', head: 'Chaat – चाट', venId: 'v1', plates: 300, date: day(6), time: '19:00', status: 'confirmed', at: '2026-11-01T00:00:00.000Z' },
      { id: 'od', head: 'Dosa – डोसा', venId: 'v2', plates: 250, date: day(6), time: '19:00', status: 'cancelled', at: '2026-11-01T00:00:00.000Z' }] }],
  expenses: [] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  let opened = 0; ctx.on('page', pg => { if (pg !== p) { opened++; pg.close().catch(() => {}); } });   // WhatsApp tabs
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const ev = async id => (await dump()).events.find(e => e.id === id);
  const seed = async d => { await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d, 'replace'); }, d); await p.reload(); await p.waitForSelector('#kpi .card'); };
  const openEvent = async name => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"]:visible', { hasText: name }).first().click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  const saveMenu = async text => { await p.locator('[data-action="menu-edit"]').first().click(); await p.waitForSelector('#menu-modal.active');
    await p.fill('#menu-text', text); await p.waitForTimeout(450); await p.locator('#btn-save-menu').click(); await p.waitForTimeout(500); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');

  await test('1. orders stay visible when their counter, or every dish, leaves the menu', async () => {
    await seed(base()); await openEvent('Sample Reception');
    await saveMenu('Pani Puri');   // dosa counter removed (its order was cancelled)
    let card = await p.locator('#menu-orders').innerText();
    assert.match(card, /Orders for counters no longer on the menu[\s\S]*Dosa[\s\S]*Cancelled/, 'cancelled order of a removed counter still shown');
    await saveMenu('');            // every dish removed: the confirmed chaat order is now off the menu and flagged
    card = await p.locator('#menu-orders').innerText();
    assert.match(card, /No dishes on the menu/);
    assert.match(card, /Chaat[\s\S]*Menu changed · resend/); assert.match(card, /Dosa[\s\S]*Cancelled/);
    const e = await ev('e1'); assert.equal(e.orders.length, 2, 'no order deleted');
    // its status sheet still works from there
    await p.locator('[data-off-order="oc"] [data-action="order-status"]').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button').last().click(); await p.waitForTimeout(250);
  });

  await test('2. opening WhatsApp neither marks an order sent nor clears a menu-change warning', async () => {
    await seed(base()); await openEvent('Sample Reception');
    await saveMenu('Pani Puri\nSev Puri\nMasala Dosa');   // chaat dishes changed: confirmed order flagged
    assert.equal((await ev('e1')).orders.find(o => o.id === 'oc').menuChanged, true);
    // Resend opens WhatsApp: still flagged, status unchanged
    await p.locator('#menu-orders [data-action="order-status"]').first().click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Edit / send again' }).click(); await p.waitForSelector('#ord-modal.active');
    await p.evaluate(() => { window.__opens = []; window.open = url => { window.__opens.push(String(url)); return null; }; });
    await p.locator('#btn-send-ord').click(); await p.waitForTimeout(500);
    assert.match((await p.evaluate(() => window.__opens))[0] || '', /^https:\/\/wa\.me\/919000000001/, 'WhatsApp opened');
    let o = (await ev('e1')).orders.find(x => x.id === 'oc');
    assert.equal(o.menuChanged, true, 'warning stays after WhatsApp opened'); assert.equal(o.status, 'confirmed'); assert(o.openedAt);
    // Only "I have sent it" clears it
    await openEvent('Sample Reception');
    await p.locator('#menu-orders [data-action="order-status"]').first().click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'I have sent it' }).click(); await p.waitForTimeout(400);
    o = (await ev('e1')).orders.find(x => x.id === 'oc'); assert.equal(o.menuChanged, undefined); assert.equal(o.status, 'sent');
    // A new order: opened (not sent) when WhatsApp opens; prepared when the vendor has no phone
    await openEvent('Sample Reception');
    await p.locator('[data-action="order-new"]').first().click(); await p.waitForSelector('#ord-modal.active');
    await p.selectOption('#ord-ven', 'v2'); await p.locator('#btn-send-ord').click(); await p.waitForTimeout(500);
    const fresh = (await ev('e1')).orders.find(x => !['oc', 'od'].includes(x.id));
    assert.equal(fresh.status, 'opened');
    await openEvent('Sample Reception');
    assert.match(await p.locator('#menu-orders').innerText(), /WhatsApp opened/);
    await p.evaluate(async () => { const db = await import('./db.js'); await db.putOne('vendors', { id: 'v9', name: 'Sample No Phone', cat: 'Live Counter' }); });
    await openEvent('Sample Reception');
    await p.locator('#menu-orders [data-action="order-status"]', { hasText: 'WhatsApp opened' }).click(); await p.waitForSelector('#ask-modal.active');
    const acts = await p.locator('#ask-actions button').allInnerTexts();
    assert(acts.some(a => /I have sent it/.test(a)) && acts.some(a => /Vendor confirmed/.test(a)), 'both manual steps offered');
    await p.locator('#ask-actions button', { hasText: 'Vendor confirmed' }).click(); await p.waitForTimeout(400);
    assert.equal((await ev('e1')).orders.find(x => x.id === fresh.id).status, 'confirmed');
    // Legacy 'sent' orders keep their status
    const s = await p.evaluate(async () => (await import('./utils.js')).ACTIVE_ORDER); assert.deepEqual(s, ['prepared', 'opened', 'sent', 'confirmed']);
  });

  await test('3. the cost checklist takes its reference only from a reconciled event', async () => {
    const d = base(); d.events = [
      { id: 'old', name: 'Sample Old Golden', date: day(-40), venue: 'X', type: 'Wedding – लग्न', billing: 100000, guests: 100, menu: 'golden', photoIds: [] },
      { id: 'mid', name: 'Sample Partial Golden', date: day(-10), venue: 'X', type: 'Wedding – लग्न', billing: 100000, guests: 100, menu: 'golden', photoIds: [] },
      { id: 'now', name: 'Sample New Golden', date: day(-1), venue: 'X', type: 'Wedding – लग्न', billing: 100000, guests: 100, menu: 'golden', photoIds: [] }];
    d.expenses = [{ id: 'a', evId: 'old', cat: 'Labour', head: 'Cook – स्वयंपाकी', amt: 9000, date: day(-40), pay: 'paid' },
      { id: 'b', evId: 'old', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 30000, date: day(-40), pay: 'paid' },
      { id: 'c', evId: 'mid', cat: 'Labour', head: 'Cook – स्वयंपाकी', amt: 8000, date: day(-10), pay: 'paid' }];   // partial: grocery not yet in
    await seed(d);
    const ref = () => p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData();
      const c = u.costChecklist(d.events.find(e => e.id === 'now'), d.events, d.expenses); return c && { ref: c.ref?.id, items: c.list.map(i => i.head) }; });
    assert.equal(await ref(), null, 'no reconciled event: no checklist (the newer, partial event is not a reference)');
    await p.evaluate(async () => { const db = await import('./db.js'), u = await import('./utils.js'); const d = await db.exportAllData();
      const { _rev, ...e } = d.events.find(x => x.id === 'old'); await db.putOne('events', { ...e, ...u.reconcileFields(e, d.expenses, ['bills', 'shared', 'final']) }); });
    const r = await ref();
    assert.equal(r?.ref, 'old', 'checklist from the reconciled event, not the newer partial one');
    assert.match(JSON.stringify(r), /Grocery/, 'reference is the complete (reconciled) event, which has grocery');
  });

  await test('4. a cost moved to another vendor, category or item (same amount) reopens reconciliation', async () => {
    const d = base(); d.events[0] = { ...d.events[0], date: day(-2), orders: [] };
    d.expenses = [{ id: 'x1', evId: 'e1', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 20000, date: day(-2), pay: 'credit', venId: 'v3' }];
    await seed(d);
    const status = () => p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData(); return u.reconStatus(d.events[0], d.expenses); });
    await p.evaluate(async () => { const db = await import('./db.js'), u = await import('./utils.js'); const d = await db.exportAllData();
      const { _rev, ...e } = d.events[0]; await db.putOne('events', { ...e, ...u.reconcileFields(e, d.expenses, ['bills', 'shared', 'final']) }); });
    assert.equal((await status()).state, 'reconciled');
    for (const change of [{ venId: 'v1' }, { cat: 'Operations', head: 'Transport – वाहतूक' }, { head: 'Vegetables – भाजी' }]) {
      await p.evaluate(async ch => { const db = await import('./db.js'); const x = (await db.exportAllData()).expenses[0]; const { _rev, ...r } = x; await db.putOne('expenses', { ...r, ...ch }); }, change);
      const s = await status(); assert.equal(s.state, 'reopened', JSON.stringify(change)); assert.deepEqual(s.changes, [{ what: 'details' }]);
      await p.evaluate(async () => { const db = await import('./db.js'); const x = (await db.exportAllData()).expenses[0]; const { _rev, ...r } = x;
        await db.putOne('expenses', { ...r, cat: 'Raw Material', head: 'Grocery – किराणा', venId: 'v3' }); });
      assert.equal((await status()).state, 'reconciled', 'back to the reconciled details');
    }
    await openEvent('Sample Reception');
    await p.evaluate(async () => { const db = await import('./db.js'); const x = (await db.exportAllData()).expenses[0]; const { _rev, ...r } = x; await db.putOne('expenses', { ...r, venId: 'v1' }); });
    await openEvent('Sample Reception');
    assert.match(await p.locator('#recon-card').innerText(), /Changed after reconciling[\s\S]*vendor, category or item changed/);
    // A reconciliation made by 4.2–4.4 (no sig2) is not falsely reopened by the update
    const legacy = await p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData();
      const e = d.events[0]; const f = u.reconcileFields(e, d.expenses, ['bills']); delete f.recon.sig2; return u.reconStatus({ ...e, ...f }, d.expenses).state; });
    assert.equal(legacy, 'reconciled');
  });

  await test('5. one expense cannot mark two venue requirements as recorded', async () => {
    const d = base(); d.events[0] = { ...d.events[0], orders: [], logistics: { kitchen: 'temporary', equipment: 'rental', gas: 'none', access: 'restricted' } };   // two pairs share an item
    await seed(d);
    const prompts = () => p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData();
      return u.logisticsPrompts(d.events[0], d.expenses).map(x => [x.key, x.recorded]); });
    assert.deepEqual(await prompts(), [['kitchen', false], ['transport', false], ['equipment', false], ['access', false]]);
    // One rented-material expense typed by hand: counts for one requirement only
    await p.evaluate(async d => { const db = await import('./db.js'); await db.putOne('expenses', { id: 'r1', evId: 'e1', cat: 'Operations', head: 'Rented Material – भाड्याचे साहित्य', amt: 5000, date: d, pay: 'paid' }); }, day(0));
    assert.deepEqual((await prompts()).filter(x => x[1]).length, 1);
    // Added from the equipment reminder: tagged, so that one is recorded and the kitchen stays as before
    await openEvent('Sample Reception');
    const rows = p.locator('#logi-card .row');
    const idx = await rows.evaluateAll(rs => rs.findIndex(r => /Hired equipment/.test(r.innerText)));
    await rows.nth(idx).locator('[data-action="logi-add"]').click().catch(() => {});
    if (await p.locator('#exp-modal.active').count()) { await p.fill('#exp-amt', '7000'); await p.locator('#btn-save-exp').click(); await p.waitForTimeout(500); }
    const x = (await dump()).expenses.find(e => e.logi);
    if (x) assert.equal(x.logi, 'equipment');
    const after = Object.fromEntries(await prompts());
    assert.equal(after.equipment, true); assert.equal(after.kitchen, true, 'the hand-entered one now counts for the kitchen');
    assert.equal(after.transport, false); assert.equal(after.access, false);
    // One transport expense: only one of the two transport needs
    await p.evaluate(async d => { const db = await import('./db.js'); await db.putOne('expenses', { id: 't1', evId: 'e1', cat: 'Operations', head: 'Transport – वाहतूक', amt: 3000, date: d, pay: 'paid' }); }, day(0));
    assert.equal(Object.values(Object.fromEntries(await prompts())).filter(Boolean).length, 3);
  });

  await test('6. the repeat-venue suggestion is hidden when there is nothing to suggest and after it is used', async () => {
    const d = base(); d.events.push({ id: 'p1', name: 'Sample Past Ground', date: day(-30), venue: 'Sample Ground', type: 'Wedding – लग्न', billing: 1, photoIds: [], venueType: 'ground', logistics: { power: 'generator' } });
    await seed(d);
    const shown = () => p.locator('#ev-venue-hint').evaluate(h => ({ hidden: h.hidden, display: getComputedStyle(h).display, height: h.getBoundingClientRect().height }));
    await p.locator('#n-events:visible').click(); await p.locator('#fab').click(); await p.waitForSelector('#ev-modal.active');
    let s = await shown(); assert.deepEqual([s.hidden, s.display, s.height], [true, 'none', 0], 'empty form: hidden, takes no space');
    await p.fill('#ev-venue', 'Another Place'); await p.locator('#ev-venue').dispatchEvent('change');
    s = await shown(); assert.deepEqual([s.hidden, s.display], [true, 'none'], 'unknown venue: hidden');
    await p.fill('#ev-venue', 'Sample Ground'); await p.locator('#ev-venue').dispatchEvent('change');
    s = await shown(); assert.equal(s.hidden, false); assert.equal(s.display, 'flex'); assert(s.height > 0);
    await p.locator('[data-action="venue-fill"]').click();
    s = await shown(); assert.deepEqual([s.hidden, s.display], [true, 'none'], 'hidden after Use');
    await p.selectOption('#ev-vtype', ''); await p.selectOption('#ev-logi-power', ''); await p.locator('#ev-vtype').dispatchEvent('change');
    s = await shown(); assert.equal(s.hidden, false, 'offered again once the fields are cleared');
    await p.selectOption('#ev-vtype', 'hall'); await p.locator('#ev-vtype').dispatchEvent('change');
    s = await shown(); assert.deepEqual([s.hidden, s.display], [true, 'none'], 'hidden once you choose your own');
    // Reopening the form for another new event starts clean
    await p.locator('#ev-modal [data-action="close-modal"]').click(); await p.waitForTimeout(300);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
    await p.locator('#fab').click(); await p.waitForSelector('#ev-modal.active');
    s = await shown(); assert.deepEqual([s.hidden, s.display], [true, 'none']);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'audit 4.4.1 FAIL' : 'audit 4.4.1 corrective checks PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('audit 4.4.1 FAIL'); process.exitCode = 1; });
