// 5.2.1 meal headings in pasted menus: English, Hindi and Marathi headings with short forms, guest counts, times, rates
// and descriptors are recognised; ordinary dishes are not mistaken for headings; dishes after a High Tea heading go to
// High Tea, not to the lunch above it (the reported fault); a line that looks like a heading but names no known meal
// stops the meal above and is shown for the user to choose. Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const HEADINGS = {
  breakfast: ['BF', 'Breakfast', 'Breakfast - 100 pax', 'Breakfast - 100pax', 'Breakfast @ ₹120/-', 'नाश्ता - १०० पाहुणे', 'Nashta'],
  lunch: ['Lunch', 'Lunch (12:30 pm)', 'Lunch - Maharashtrian Menu - 300pax', 'दुपारचे जेवण', 'दुपारचे जेवण - महाराष्ट्रीयन मेनू - २५० पाहुणे'],
  hightea: ['High Tea 100 pax', 'Hi-Tea –', 'Evening Tea / Coffee', 'Eve - Tea & Coffee 100pax', 'सायंकाळ - चहा व कॉफी १०० पाहुणे'],
  dinner: ['Dinner', 'Dinner menu:', 'Dinner 7pm - 11pm', 'Dinner - Platinum Menu - 650pax', 'रात्रीचं जेवण - प्लेटिनम मेनू - ७०० पाहुणे'],
  latenight: ['Late Night Snacks', 'LATE NIGHT MENU:', 'Midnight'],
};
const DISHES = ['Tea & Coffee', 'Kande Pohe', 'Welcome drink', 'Starters', 'Water Bottles', 'Thin Crust Farmhouse Pizza', 'Vanilla and 3 Sauces', 'Masala Dosa'];

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  const u = (fn, arg) => p.evaluate(async ([src, a]) => { const u = await import('./utils.js'); return new Function('u', 'a', `return (${src})(u, a)`)(u, a); }, [fn.toString(), arg]);

  await test('headings in English, Hindi and Marathi, with short forms, guest counts, times, rates and descriptors', async () => {
    const got = await u((u, H) => Object.fromEntries(Object.entries(H).map(([m, hs]) => [m, hs.map(h => u.mealHeading(h))])), HEADINGS);
    for (const [m, hs] of Object.entries(HEADINGS)) assert.deepEqual(got[m], hs.map(() => m), `${m}: ${hs.join(' / ')}`);
  });

  await test('ordinary dishes are not taken as headings (Tea & Coffee stays a dish)', async () => {
    assert.deepEqual(await u((u, D) => D.map(d => u.mealHeading(d)), DISHES), DISHES.map(() => ''));
  });

  await test('reported fault: dishes after "High Tea 100 pax" go to High Tea, not to the lunch above', async () => {
    const r = await u(u => u.parseMenu('BF\nKande Pohe\nLunch - 300 pax\nDal Tadka\nHigh Tea 100 pax\nSamosa\nTea & Coffee\nदुपारचे जेवण\nपुरणपोळी').map(d => `${d.meal}:${d.name}`));
    assert.deepEqual(r, ['breakfast:Kande Pohe', 'lunch:Dal Tadka', 'hightea:Samosa', 'hightea:Tea & Coffee', 'lunch:पुरणपोळी']);
  });

  await test('an unknown heading stops the meal above and is listed to check', async () => {
    const r = await u(u => { const x = u.parseMenu('Lunch\nDal\nSpecial Menu - 200 pax\nPaneer Tikka\nDinner\nNaan'); return { dishes: x.map(d => `${d.meal}:${d.name}`), unsure: x.unsure }; });
    assert.deepEqual(r.dishes, ['lunch:Dal', ':Paneer Tikka', 'dinner:Naan'], 'Paneer Tikka is not silently added to lunch');
    assert.deepEqual(r.unsure, ['Special Menu - 200 pax']);
  });

  await test('the menu sheet says which heading it could not read and asks for the meal', async () => {
    await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d, 'replace'); }, { version: 'ffv2', photos: [], cPays: [], vPays: [], vendors: [], expenses: [],
      events: [{ id: 'E1', name: 'Sample Heading Event', date: day(5), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 200, photoIds: [], meals: ['lunch', 'dinner'], mealPlan: { lunch: { guests: 200, rate: 300 }, dinner: { guests: 200, rate: 500 } } }] });
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="E1"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    await p.locator('[data-action="menu-edit"]').first().click(); await p.waitForSelector('#menu-modal.active');
    await p.fill('#menu-text', 'Lunch - 200 pax\nDal\nSpecial Menu - 200 pax\nPaneer Tikka'); await p.waitForTimeout(500);
    assert.match(await p.locator('[data-menu-unsure]').innerText(), /Not sure which meal: “Special Menu - 200 pax”/);
    await p.fill('#menu-text', 'Lunch - 200 pax\nDal\nDinner\nNaan'); await p.waitForTimeout(500);
    assert.equal(await p.locator('[data-menu-unsure]').count(), 0, 'no note when every heading is known');
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'meal-headings FAIL' : 'meal headings: English/Hindi/Marathi headings read, unknown headings flagged PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('meal-headings FAIL'); process.exitCode = 1; });
