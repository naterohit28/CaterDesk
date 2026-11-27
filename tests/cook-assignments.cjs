// 5.4.3 (owner's requirements, 27 Nov 2026): menu-linked cooking assignments. A cook paid by order is given several of
// the meal's own kitchen dishes at once by ticking them (no order per dish, not an outsourced counter). Requested,
// confirmed, agreed and final stay distinguishable; ticking dishes or confirming adds no expense. The WhatsApp list
// carries the meal's guests and opens for the owner to send. Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const CHINESE = 'Chinese Cook – चायनीज आचारी', COOK = 'Cook – स्वयंपाकी', CHAAT = 'Chaat – चाट';
const DATA = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'cc', name: 'Sample Chinese Team', cat: 'Labour', specialty: CHINESE, phone: '9000000011' }],
  events: [{ id: 'E', name: 'Sample Function', date: day(2), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 200, photoIds: [],
    meals: ['lunch', 'dinner'], mealPlan: { lunch: { guests: 120, rate: 300 }, dinner: { guests: 150, rate: 400 } },
    dishes: [{ name: 'Hakka Noodles', meal: 'dinner', head: '' }, { name: 'Manchurian', meal: 'dinner', head: '' }, { name: 'Dal Tadka', meal: 'dinner', head: '' },
      { name: 'Pani Puri', meal: 'dinner', head: CHAAT }, { name: 'Puri Bhaji', meal: 'lunch', head: '' }] }] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const line = i => p.locator(`#lab-rows [data-lab="${i}"]`);
  const chips = i => line(i).locator('[data-lab-dish]').evaluateAll(els => els.map(e => e.dataset.name));
  const save = async () => { await p.locator('#btn-save-lab').click(); await p.waitForTimeout(700); if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click(); await p.waitForTimeout(200); };
  const edit = async () => { await p.locator('[data-action="lab-edit"]').click(); await p.waitForSelector('#lab-modal.active'); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });
  await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA());
  await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' });
  await p.locator('#n-events:visible').click(); await p.waitForTimeout(300);
  await p.locator('#ev-list [data-action="evdetail"]', { hasText: 'Sample Function' }).first().click(); await p.waitForSelector('#tab-evdetail.active');

  await test('the dinner\'s own kitchen dishes can be ticked for the Chinese cook; outsourced and lunch dishes are not offered', async () => {
    await edit();
    await line(0).locator('[data-k="role"]').selectOption(CHINESE); await p.waitForTimeout(150);
    await line(0).locator('[data-k="meal"]').selectOption('dinner'); await p.waitForTimeout(150);
    assert.deepEqual(await chips(0), ['Hakka Noodles', 'Manchurian', 'Dal Tadka']);
    await line(0).locator('[data-lab-dish][data-name="Hakka Noodles"]').click(); await line(0).locator('[data-lab-dish][data-name="Manchurian"]').click();
    assert.equal(await line(0).locator('[data-lab-dish][data-name="Manchurian"]').getAttribute('aria-pressed'), 'true');
    await line(0).locator('[data-k="people"]').fill('2');
    assert.equal(await line(0).locator('[data-stage]').getAttribute('data-stage'), 'requested');
  });

  await test('saved as a requirement: dishes kept, no expense, the card says Requested', async () => {
    await save();
    const d = await dump(), row = d.events[0].labour.rows[0];
    assert.deepEqual([row.job, row.meal, row.dishes, row.people], [true, 'dinner', ['Hakka Noodles', 'Manchurian'], 2]);
    assert.equal(d.expenses.length, 0, 'ticking dishes adds no expense');
    const t = (await p.locator('#labour-card').innerText()).replace(/\s+/g, ' ');
    assert.match(t, /Requested By order · Dinner · Hakka Noodles, Manchurian/);
  });

  await test('the WhatsApp list names the dishes and the dinner\'s guests; WhatsApp only opens', async () => {
    const msg = await p.evaluate(() => new Promise(res => { setTimeout(() => res('no WhatsApp opened'), 3000); window.open = u => { res(decodeURIComponent(u)); return {}; }; document.querySelector('[data-action="lab-send"][data-id="cc"]').click(); }));
    assert.match(msg, /Chinese Cook: Dinner · Hakka Noodles, Manchurian · 150 guests · 2 people/);
    assert.equal((await dump()).expenses.length, 0);
  });

  await test('another cook sees whose dish is already given; confirming adds no expense', async () => {
    await edit();
    await line(0).locator('[data-k="confirmed"]').check(); await p.waitForTimeout(150);
    assert.equal(await line(0).locator('[data-stage]').getAttribute('data-stage'), 'confirmed');
    await p.locator('#btn-lab-add').click(); await p.waitForTimeout(150);
    await line(1).locator('[data-k="role"]').selectOption(COOK); await p.waitForTimeout(150);
    await line(1).locator('[data-k="meal"]').selectOption('dinner'); await p.waitForTimeout(150);
    assert.match(await line(1).locator('[data-lab-dish][data-name="Hakka Noodles"]').innerText(), /Chinese Cook/);
    await line(1).locator('[data-lab-dish][data-name="Dal Tadka"]').click();
    await save();
    const d = await dump();
    assert.equal(d.expenses.length, 0);
    assert.equal(d.events[0].labour.rows[0].confirmed, true);
    assert.deepEqual(d.events[0].labour.rows[1].dishes, ['Dal Tadka']);
    assert.match((await p.locator('#labour-card').innerText()).replace(/\s+/g, ' '), /Confirmed By order · Dinner · Hakka Noodles, Manchurian/);
  });

  await test('an agreed charge becomes one amount owed with the dishes in its note; a final charge replaces it', async () => {
    await edit();
    await line(0).locator('[data-k="rate"]').fill('3000'); await p.waitForTimeout(100);
    assert.equal(await line(0).locator('[data-stage]').getAttribute('data-stage'), 'agreed');
    await save();
    let d = await dump();
    assert.deepEqual(d.expenses.map(x => [x.head, x.amt, x.venId, x.pay]), [[CHINESE, 3000, 'cc', 'credit']]);
    assert.match(d.expenses[0].notes, /Chinese Cook by order \(Dinner · Hakka Noodles, Manchurian\), 2 people: agreed ₹3,000/);
    await edit(); await line(0).locator('[data-k="final"]').fill('3200'); await save();
    d = await dump();
    assert.deepEqual(d.expenses.map(x => x.amt), [3200]);
    assert.match((await p.locator('#labour-card').innerText()).replace(/\s+/g, ' '), /Final charge By order/);
    assert.match(await p.locator('[data-lab-contractor="cc"] [data-lab-due]').innerText(), /₹3,200 to pay/, 'settlement shown apart');
  });

  await test('5.5.0: the function sheet goes meal by meal, with the cooks given work for that meal and no money', async () => {
    await p.locator('[data-action="fs-open"]').first().click(); await p.waitForSelector('#fs-modal.active');
    const t = await p.locator('#fs-text').innerText();
    assert.match(t, /LUNCH · 120 guests\n- Our kitchen: Puri Bhaji\n\nDINNER · 150 guests\n- Our kitchen: Hakka Noodles, Manchurian, Dal Tadka\n- Chinese Cook \(Sample Chinese Team\): Hakka Noodles, Manchurian · 2 people · Final charge\n- Cook: Dal Tadka · Requested\n- Chaat: Pani Puri\n  No vendor order yet/, t);
    assert.doesNotMatch(t, /₹|3,200|3200/);
    await p.locator('#fs-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(200);
  });

  await test('a backup with a bad dish list is refused', async () => {
    const bad = DATA(); bad.events[0].labour = { rows: [{ id: 'x', role: CHINESE, job: true, dishes: 'Hakka Noodles' }] };
    const err = await p.evaluate(async d => { try { await (await import('./db.js')).importAllData(d, 'replace'); return ''; } catch (e) { return e.message; } }, bad);
    assert.match(err, /labour/i);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'cook-assignments FAIL' : 'cooking assignments from the menu PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('cook-assignments FAIL'); process.exit(1); });
