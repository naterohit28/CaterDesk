// 5.3.2 (owner's rate card): 8 Breakfast or High-Tea combinations as starter menus, offered first for breakfast and high
// tea. Choosing one fills the meal's dishes (nothing saved before Save); each dish then has the same choices as lunch and
// dinner: who makes it (our kitchen, at the venue, bought ready-made, bought and finished, a counter) and diet marks.
// Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DATA = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [], vendors: [],
  events: [{ id: 'e1', name: 'Sample Two Day Wedding', date: day(10), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 300000, guests: 300, photoIds: [],
    meals: ['breakfast', 'lunch', 'hightea'], mealPlan: { breakfast: { guests: 120, rate: 0 }, lunch: { guests: 300, rate: 700 }, hightea: { guests: 90, rate: 0 } } }] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const ev = async () => p.evaluate(async () => (await (await import('./db.js')).exportAllData()).events.find(e => e.id === 'e1'));
  const dish = name => p.locator('#svc-dishes .svc-dish').filter({ has: p.locator(`input[data-k="name"][value="${name}"]`) });
  await p.goto(BASE_URL); await p.waitForSelector('#kpi');
  await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA());
  await p.reload(); await p.waitForSelector('#kpi');
  await p.locator('#n-events:visible').click(); await p.waitForTimeout(300);
  await p.locator('#ev-list [data-action="evdetail"]').first().click(); await p.waitForSelector('#tab-evdetail.active');
  const openSheet = async svc => { await p.locator('[data-action="svc-add"]').click(); await p.waitForSelector('#svc-modal.active'); await p.selectOption('#svc-meal', svc); };

  await test('the 8 combinations are starter menus for breakfast and high tea, dishes only', async () => {
    const r = await p.evaluate(async () => (await import('./utils.js')).allMenus().filter(m => m.id.startsWith('bf-')).map(m => [m.name, m.meals, m.items.length]));
    assert.equal(r.length, 8); assert.ok(r.every(([, meals]) => JSON.stringify(meals) === '["breakfast","hightea"]'));
    assert.ok(r.every(([n]) => n.startsWith('Breakfast / High Tea – ')));
  });

  await test('breakfast: listed first; choosing one fills the dishes, nothing saved before Save', async () => {
    const before = await ev();
    await openSheet('svc-breakfast');
    const first = await p.locator('#svc-tpl optgroup').first().evaluate(g => [g.label, [...g.children].map(o => o.value)]);
    assert.equal(first[0], 'For Breakfast'); assert.equal(first[1].filter(v => v.startsWith('bf-')).length, 8);
    await p.selectOption('#svc-tpl', 'bf-idli-vada'); await p.waitForTimeout(200);
    assert.deepEqual(await p.locator('#svc-dishes input[data-k="name"]').evaluateAll(i => i.map(x => x.value)), ['Idli', 'Medu Vada', 'Chutney', 'Sambhar', 'Tea', 'Coffee']);
    assert.deepEqual(await ev(), before, 'nothing saved yet');
  });

  await test('each breakfast dish has the same choices as lunch and dinner: who makes it and diet marks', async () => {
    const opts = await dish('Medu Vada').locator('[data-k="head"] option').evaluateAll(o => o.map(x => x.value));
    for (const v of ['', '@venue', '@buy', '@finish']) assert.ok(opts.includes(v), 'option ' + v);
    assert.ok(opts.some(v => v.startsWith('Dosa')), 'a vendor counter can be chosen');
    await dish('Medu Vada').locator('[data-k="head"]').selectOption('@finish');
    await dish('Idli').locator('[data-k="head"]').selectOption('@venue');
    await dish('Coffee').locator('[data-k="head"]').selectOption('@buy');
    await dish('Idli').locator('[data-diet-toggle]').click(); await dish('Idli').locator('[data-diet="jain"]').click();
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(700);
    const e = await ev(), bf = e.dishes.filter(d => d.meal === 'breakfast'), by = n => bf.find(d => d.name === n);
    assert.equal(bf.length, 6);
    assert.equal(by('Medu Vada').src, 'finish'); assert.equal(by('Idli').at, 'venue'); assert.equal(by('Coffee').src, 'buy'); assert.deepEqual(by('Idli').diet, ['jain']);
    assert.equal(by('Chutney').head, '', 'the rest start in our kitchen');
    assert.equal(e.dishes.filter(d => d.meal === 'lunch').length, 0, 'other meals untouched');
  });

  await test('high tea gets the same combinations, listed first', async () => {
    await openSheet('svc-hightea');
    const first = await p.locator('#svc-tpl optgroup').first().evaluate(g => [g.label, [...g.children].map(o => o.value)]);
    assert.equal(first[0], 'For High tea'); assert.equal(first[1].filter(v => v.startsWith('bf-')).length, 8);
    await p.selectOption('#svc-tpl', 'bf-jalebi-fafda'); await p.waitForTimeout(200);
    assert.deepEqual(await p.locator('#svc-dishes input[data-k="name"]').evaluateAll(i => i.map(x => x.value)), ['Jalebi', 'Fafda', 'Papaya Mirchi', 'Khaman Dhokla', 'Bread Butter', 'Tea', 'Coffee']);
    await p.locator('#btn-save-svc').click(); await p.waitForTimeout(700);
    assert.equal((await ev()).dishes.filter(d => d.meal === 'hightea').length, 7);
  });

  await test('for lunch they come after the lunch and any-meal menus', async () => {
    await openSheet('svc-lunch');
    const labels = await p.locator('#svc-tpl optgroup').evaluateAll(gs => gs.map(g => [g.label, [...g.children].some(o => o.value.startsWith('bf-'))]));
    assert.deepEqual(labels.at(-1), ['Other meals', true]); assert.ok(labels.slice(0, -1).every(([, has]) => !has));
    await p.locator('#svc-modal [data-action="close-modal"]').click();
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'breakfast-templates FAIL' : 'breakfast and high tea combinations with every sourcing and diet option PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('breakfast-templates FAIL'); process.exitCode = 1; });
