// 5.3.1 (owner's requirements, step 3): who supplies a dish is never guessed from its name. A new dish starts in our
// kitchen ("Paneer Tikka" is a starter, not a live counter) unless how it is supplied was confirmed before: chosen by
// hand, or its counter order was sent / confirmed / delivered. Every way is remembered (counter, at the venue, bought,
// bought and finished, part bought). Saved dishes are not changed. Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const STARTER = 'Starter – स्टार्टर', CHAAT = 'Chaat – चाट', DOSA = 'Dosa – डोसा';
const EV = (id, name, n, extra = {}) => ({ id, name, date: day(n), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 200, meals: ['dinner'], photoIds: [], ...extra });
const ORDER = (id, head, status) => ({ id, venId: 'v1', head, status, date: day(-20), plates: 200, svc: 'svc-dinner' });
const DATA = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'v1', name: 'Sample Counter Co', cat: 'Live Counter' }],
  events: [
    EV('P1', 'Sample Past Event', -20, {
      dishes: [
        { name: 'Veg Crispy', meal: 'dinner', head: STARTER, manual: true },               // chosen by hand
        { name: 'Pani Puri', meal: 'dinner', head: CHAAT },                                 // its order was confirmed
        { name: 'Masala Dosa', meal: 'dinner', head: DOSA },                                // its order was never sent
        { name: 'Hara Bhara Kabab', meal: 'dinner', head: '', src: 'finish', manual: true }, // bought frozen, finished by us
        { name: 'Live Jalebi', meal: 'dinner', head: '', at: 'venue', manual: true }       // cooked at the venue
      ],
      orders: [ORDER('o1', CHAAT, 'confirmed'), ORDER('o2', DOSA, 'prepared')] }),
    EV('N1', 'Sample New Event', 10)] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  await p.goto(BASE_URL); await p.waitForSelector('#kpi');
  await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA());
  await p.reload(); await p.waitForSelector('#kpi');

  await test('a dish name alone never picks a counter; confirmed choices are remembered', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js'), db = await import('./db.js');
      const L = u.learnedDishes((await db.exportAllData()).events);
      return ['Paneer Tikka', 'Chicken Kebab', 'Tomato Soup', 'Veg Crispy', 'Pani Puri', 'Masala Dosa', 'Hara Bhara Kabab', 'live jalebi'].map(n => u.dishSource(n, L)); });
    assert.deepEqual(r, [{ head: '' }, { head: '' }, { head: '' }, { head: STARTER }, { head: CHAAT }, { head: '' }, { head: '', src: 'finish' }, { head: '', at: 'venue' }]);
  });

  await test('pasted menu: new starters start in our kitchen; remembered choices are filled in and can be changed', async () => {
    await p.locator('#n-events:visible').click(); await p.waitForTimeout(300);
    await p.locator('#ev-list [data-action="evdetail"]', { hasText: 'Sample New Event' }).first().click(); await p.waitForSelector('#tab-evdetail.active');
    await p.locator('[data-action="menu-edit"]').first().click(); await p.waitForSelector('#menu-modal.active');
    await p.fill('#menu-text', 'Paneer Tikka\nVeg Crispy\nPani Puri\nMasala Dosa\nHara Bhara Kabab\nLive Jalebi'); await p.waitForTimeout(500);
    const who = n => p.locator('#menu-review .check-row', { hasText: n }).locator('[data-k="head"]').inputValue();
    assert.deepEqual([await who('Paneer Tikka'), await who('Veg Crispy'), await who('Pani Puri'), await who('Masala Dosa'), await who('Hara Bhara Kabab'), await who('Live Jalebi')],
      ['', STARTER, CHAAT, '', '@finish', '@venue']);
    await p.locator('#menu-review .check-row', { hasText: 'Paneer Tikka' }).locator('[data-k="head"]').selectOption(STARTER);   // the owner decides
    await p.locator('#btn-save-menu').click(); await p.waitForTimeout(600);
    const e = (await dump()).events.find(x => x.id === 'N1'), by = n => e.dishes.find(d => d.name === n);
    assert.equal(by('Paneer Tikka').head, STARTER); assert.equal(by('Paneer Tikka').manual, true);
    assert.equal(by('Masala Dosa').head, ''); assert.equal(by('Hara Bhara Kabab').src, 'finish'); assert.equal(by('Live Jalebi').at, 'venue');
  });

  await test('the earlier event\'s saved dishes are unchanged', async () => {
    const e = (await dump()).events.find(x => x.id === 'P1');
    assert.deepEqual(e.dishes.map(d => [d.name, d.head, d.src || '', d.at || '']), DATA().events[0].dishes.map(d => [d.name, d.head, d.src || '', d.at || '']));
  });

  await test('a specialist cook (starter, tandoor, Chinese) is a labour type, not an outsourced counter', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js'); return { labour: u.EXPENSE_HEADS.Labour, counter: u.EXPENSE_HEADS['Live Counter'] }; });
    assert.ok(r.labour.includes('Specialist Cook – स्पेशल आचारी')); assert.ok(!r.counter.some(h => /cook/i.test(h)));
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'dish-sourcing FAIL' : 'dish sourcing never guessed from the name PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('dish-sourcing FAIL'); process.exitCode = 1; });
