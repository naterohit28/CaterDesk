// CD5-VEN-01 venue details: occasion and venue type kept separate, optional area and logistics, costing
// prompts without automatic expenses, repeat-venue suggestion (G-39 to G-42). Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// A v4 event: custom type outside today's list, menu, orders, labour, photo, payment, no venue fields at all
const LEGACY = { id: 'legacy', name: 'Sample Legacy Wedding', date: day(-10), venue: 'Sample Lake Lawn', type: 'Thread ceremony – मुंज', billing: 150000, guests: 150, menu: 'golden', meals: ['lunch'],
  photoIds: ['ph1'], notes: 'keep me', futureField: { x: 1 },
  dishes: [{ name: 'Pani Puri', head: 'Chaat – चाट' }], orders: [{ id: 'o1', head: 'Chaat – चाट', venId: 'v1', plates: 150, date: day(-10), time: '13:00', status: 'delivered' }],
  labour: { rows: [{ id: 'r', role: 'Boys – बॉईज', rate: 600, counts: { m: 8 } }], pay: 'paid', mode: '', venId: '', expIds: {} } };
const DATA = { version: 'ffv2', vendors: [{ id: 'v1', name: 'Sample Counter', cat: 'Live Counter' }], vPays: [],
  events: [LEGACY], expenses: [{ id: 'x1', evId: 'legacy', cat: 'Live Counter', head: 'Chaat – चाट', amt: 15000, date: day(-10), pay: 'paid', venId: 'v1' }],
  cPays: [{ id: 'c1', evId: 'legacy', amt: 50000, date: day(-20), mode: 'UPI' }], photos: [{ id: 'ph1', eventId: 'legacy', data: PNG, createdAt: '2026-10-01T00:00:00.000Z' }] };

(async () => {
  const browser = await browser0();
  async function browser0() { return chromium.launch({ channel: 'msedge', headless: true }); }
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const stored = async id => (await dump()).events.find(e => e.id === id);
  const noRev = ({ _rev, ...r }) => r;
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  await p.reload(); await p.waitForSelector('#kpi .card');

  const newEvent = async (fill) => {
    await p.locator('#n-events:visible').click(); await p.locator('#fab').click(); await p.waitForSelector('#ev-modal.active');
    await fill(); await p.locator('#btn-save-event').click(); await p.waitForSelector('#ev-modal.active', { state: 'detached' }).catch(() => {});
    await p.waitForTimeout(400);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
  };
  // Opens an event by name from a fresh page (no pending history steps from a sheet that just closed)
  const openByName = async name => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"]:visible', { hasText: name }).first().click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  const basics = async (name, venue) => { await p.fill('#ev-name', name); await p.fill('#ev-date', day(-1)); await p.fill('#ev-venue', venue); await p.locator('#ev-venue').dispatchEvent('change'); await p.fill('#ev-billing', '100000'); };

  await test('G-40 legacy event without venue details survives opening, editing and saving unchanged', async () => {
    const before = await stored('legacy');
    await p.locator('#n-events:visible').click(); await p.locator('#ev-list [data-action="evdetail"][data-id="legacy"]:visible').click();
    await p.locator('#hdr-edit').click(); await p.waitForSelector('#ev-modal.active');
    assert.equal(await p.inputValue('#ev-type'), 'Thread ceremony – मुंज', 'a type outside the list stays selected');
    assert.equal(await p.inputValue('#ev-vtype'), ''); assert.equal(await p.inputValue('#ev-locality'), '');
    await p.locator('#btn-save-event').click(); await p.waitForTimeout(500);
    const after = await stored('legacy');
    assert.deepEqual(noRev(after), noRev(before), 'save without changes leaves every field as it was (no blank venue fields added)');
    for (const k of ['venueType', 'locality', 'logistics', 'typeOther', 'venueTypeOther']) assert.equal(k in after, false, k + ' not added');
    // and through a backup and restore
    const d = await dump();
    await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d, 'replace'); }, d);
    assert.deepEqual(noRev(await stored('legacy')), noRev(before));
  });

  await test('G-39 occasion and venue type stay independent, including custom ones', async () => {
    await newEvent(async () => { await basics('Sample Corporate Dinner', 'Sample Grand Hall'); await p.selectOption('#ev-type', 'Corporate – कॉर्पोरेट'); await p.selectOption('#ev-vtype', 'hall'); await p.fill('#ev-locality', 'Sample Area'); });
    await newEvent(async () => { await basics('Sample Home Wedding', 'Sample Residence'); await p.selectOption('#ev-type', 'Wedding – लग्न'); await p.selectOption('#ev-vtype', 'residence'); });
    await newEvent(async () => { await basics('Sample Naming', 'Sample Farm'); await p.selectOption('#ev-type', 'Other – इतर'); await p.fill('#ev-type-other', 'Naming ceremony');
      await p.selectOption('#ev-vtype', 'other'); await p.fill('#ev-vtype-other', 'Farmhouse'); });
    const ev = (await dump()).events;
    const by = n => ev.find(e => e.name === n);
    assert.deepEqual([by('Sample Corporate Dinner').type, by('Sample Corporate Dinner').venueType, by('Sample Corporate Dinner').locality], ['Corporate – कॉर्पोरेट', 'hall', 'Sample Area']);
    assert.deepEqual([by('Sample Home Wedding').type, by('Sample Home Wedding').venueType], ['Wedding – लग्न', 'residence']);
    assert.deepEqual([by('Sample Naming').type, by('Sample Naming').typeOther, by('Sample Naming').venueType, by('Sample Naming').venueTypeOther], ['Other – इतर', 'Naming ceremony', 'other', 'Farmhouse']);
    assert.equal('locality' in by('Sample Home Wedding'), false, 'blank optional fields are not stored');
    assert.equal('logistics' in by('Sample Corporate Dinner'), false);
    // Shown as written, nothing inferred from occasion or venue name
    await openByName('Sample Naming');
    const facts = await p.locator('#tab-evdetail .facts').first().innerText();
    assert.match(facts, /Naming ceremony/); assert.match(facts, /Farmhouse/);
  });

  await test('G-41 generator at an open ground prompts a cost but adds no expense; a hall with power does not', async () => {
    const count = async () => (await dump()).expenses.length;
    const n0 = await count();
    await newEvent(async () => { await basics('Sample Ground Party', 'Sample Open Ground'); await p.selectOption('#ev-vtype', 'ground');
      await p.locator('#ev-logi summary').click(); await p.selectOption('#ev-logi-power', 'generator'); await p.selectOption('#ev-logi-water', 'arrange'); });
    await newEvent(async () => { await basics('Sample Hall Party', 'Sample Power Hall'); await p.selectOption('#ev-vtype', 'hall');
      await p.locator('#ev-logi summary').click(); await p.selectOption('#ev-logi-power', 'venue'); });
    assert.equal(await count(), n0, 'no automatic expense');
    const ground = (await dump()).events.find(e => e.name === 'Sample Ground Party');
    assert.deepEqual(ground.logistics, { power: 'generator', water: 'arrange' }, 'only the recorded answers are stored; the rest stay unknown');
    await openByName('Sample Ground Party');
    const card = await p.locator('#logi-card').innerText();
    assert.match(card, /Generator required/); assert.match(card, /Water to arrange/); assert.match(card, /Not recorded yet/);
    // Adding the cost is the user's choice; afterwards the reminder shows as recorded
    await p.locator('#logi-card [data-action="logi-add"]').first().click(); await p.waitForSelector('#exp-modal.active');
    assert.equal(await p.inputValue('#exp-amt'), '', 'amount left for the user');
    await p.fill('#exp-amt', '4500'); await p.locator('#btn-save-exp').click(); await p.waitForTimeout(500);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
    assert.equal(await count(), n0 + 1);
    await openByName('Sample Ground Party');
    assert.match(await p.locator('#logi-card').innerText(), /Generator required[\s\S]*Recorded/);
    await openByName('Sample Hall Party');
    assert.equal(await p.locator('#logi-card').count(), 0, 'power provided: no prompt');
  });

  await test('G-42 repeat venue is suggested, can be overridden, and never changes the past event', async () => {
    const past = await stored((await dump()).events.find(e => e.name === 'Sample Ground Party').id);
    await p.locator('#n-events:visible').click(); await p.locator('#fab').click(); await p.waitForSelector('#ev-modal.active');
    await basics('Sample Return Visit', 'sample open ground ');   // same venue, different case and spacing
    assert.match(await p.locator('#ev-venue-hint').innerText(), /Used before[\s\S]*Open ground/);
    assert.equal(await p.inputValue('#ev-vtype'), '', 'nothing filled until the user chooses');
    await p.locator('[data-action="venue-fill"]').click();
    assert.equal(await p.inputValue('#ev-vtype'), 'ground'); assert.equal(await p.inputValue('#ev-logi-power'), 'generator');
    await p.selectOption('#ev-logi-power', 'venue'); await p.selectOption('#ev-logi-water', '');   // override for this event
    await p.locator('#btn-save-event').click(); await p.waitForTimeout(500);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
    const d = await dump();
    const mine = d.events.find(e => e.name === 'Sample Return Visit');
    assert.deepEqual([mine.venueType, mine.logistics], ['ground', { power: 'venue' }]);
    assert.deepEqual(noRev(d.events.find(e => e.id === past.id)), noRev(past), 'past event untouched');
    // Optional: an event with none of the extra fields saves fine
    await newEvent(async () => { await basics('Sample Plain Event', 'Sample Plain Hall'); });
    const plain = (await dump()).events.find(e => e.name === 'Sample Plain Event');
    assert(plain && !plain.venueType && !plain.logistics && !plain.locality);
  });

  await test('venue-type benchmarks use reconciled events only, with sample sizes', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'), u = await import('./utils.js'); const d = await db.exportAllData();
      const ev = d.events.find(e => e.name === 'Sample Ground Party'); const { _rev, ...e } = ev;
      await db.putOne('events', { ...e, guests: 100, ...u.reconcileFields({ ...e, guests: 100 }, d.expenses, ['bills', 'shared', 'final']) }); });
    await p.reload(); await p.waitForSelector('#kpi .card');
    await p.locator('#n-summary:visible').click(); await p.locator('#tab-summary [data-period-seg] [data-id="all"]').click();
    const rep = await p.locator('#summary-content').innerText();
    assert.match(rep, /Per plate by venue type[\s\S]*Open ground[\s\S]*1 event/);
    assert.doesNotMatch(rep.split('Per plate by venue type')[1].split('Per plate by event')[0], /Banquet|Residence|Farmhouse/, 'unreconciled venue types not averaged');
  });

  await test('import refuses malformed logistics', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest;
      d.events[0] = { ...d.events[0], logistics: { power: 5 } }; try { await db.importAllData(d, 'replace'); return 'accepted'; } catch (e) { return e.message; } });
    assert.equal(r, 'Invalid venue logistics');
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'venue details FAIL' : 'venue details (CD5-VEN-01, G-39 to G-42) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('venue details FAIL'); process.exitCode = 1; });
