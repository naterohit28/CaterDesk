// Owner (4.31.22): ordering from an event, the vendor box offers "+ New vendor" (the normal vendor sheet, opened over
// the order with its counter filled in; back in the order with the vendor picked) and "+ One-time vendor" (kept for its
// bills, payments and dues, labelled one-time, never suggested for other orders). Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'vc', name: 'Sample Chaat Counter', cat: 'Live Counter', specialty: 'Chaat – चाट', phone: '9000000002' }],
  events: [{ id: 'E1', name: 'Sample Vendor Event', date: day(6), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 160000, photoIds: [],
    meals: ['dinner'], mealPlan: { dinner: { guests: 200, rate: 800 } },
    dishes: [{ name: 'Masala Dosa', head: 'Dosa – डोसा', meal: 'dinner' }, { name: 'Pani Puri', head: 'Chaat – चाट', meal: 'dinner' }, { name: 'Gulab Jamun', src: 'buy', meal: 'dinner' }] }] };
const pickTime = async (p, id) => { await p.fill(`#${id}-t`, '7:30'); await p.locator(`#${id}-pm`).click(); };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const openEvent = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="E1"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200); };
  const options = sel => p.locator(`${sel} option`).allInnerTexts();
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d, 'replace'); }, DATA);

  await test('the order vendor box ends with + New vendor and + One-time vendor', async () => {
    await openEvent();
    await p.locator('[data-action="order-new"][data-id^="Dosa"]').click(); await p.waitForSelector('#ord-modal.active');
    const o = await options('#ord-ven');
    assert.match(o.at(-2), /^\+ New vendor/); assert.match(o.at(-1), /^\+ One-time vendor/);
  });

  await test('+ New vendor: the vendor sheet opens over the order with Live Counter · Dosa filled in; saving goes back with it picked', async () => {
    await p.selectOption('#ord-ven', '__new'); await p.waitForSelector('#ven-modal.active');
    assert.equal(await p.locator('#ord-modal.active').count(), 1, 'the order stays open underneath');
    assert.match(await p.locator('#ven-mtitle').innerText(), /New vendor/);
    assert.equal(await p.inputValue('#ven-cat'), 'Live Counter'); assert.equal(await p.inputValue('#ven-specialty'), 'Dosa – डोसा');
    assert.equal(await p.locator('#ven-onetime-note').isHidden(), true);
    await p.fill('#ven-name', 'Sample Anna Dosa'); await p.fill('#ven-phone', '9000000011'); await p.locator('#btn-save-ven').click(); await p.waitForTimeout(600);
    assert.equal(await p.locator('#ven-modal.active').count(), 0); assert.equal(await p.locator('#ord-modal.active').count(), 1, 'back in the order');
    const v = (await dump()).vendors.find(x => x.name === 'Sample Anna Dosa');
    assert.equal(await p.inputValue('#ord-ven'), v.id, 'the new vendor is picked');
    assert.deepEqual([v.cat, v.specialty, v.oneTime], ['Live Counter', 'Dosa – डोसा', undefined]);
  });

  await test('+ One-time vendor: marked as such, picked, and the order is saved with it', async () => {
    await p.selectOption('#ord-ven', '__once'); await p.waitForSelector('#ven-modal.active');
    assert.match(await p.locator('#ven-mtitle').innerText(), /One-time vendor/);
    assert.match(await p.locator('#ven-onetime-note').innerText(), /For this order only/);
    await p.fill('#ven-name', 'Sample Roadside Dosa Wala'); await p.fill('#ven-phone', '9000000012'); await p.locator('#btn-save-ven').click(); await p.waitForTimeout(600);
    const v = (await dump()).vendors.find(x => x.name === 'Sample Roadside Dosa Wala');
    assert.equal(v.oneTime, true);
    assert.equal(await p.inputValue('#ord-ven'), v.id);
    assert.match(await p.locator('#ord-ven option:checked').innerText(), /\(one-time\)/);
    await p.fill('#ord-plates', '120'); await pickTime(p, 'ord-time');
    await p.locator('#btn-save-ord').click(); await p.waitForTimeout(600);
    const o = (await dump()).events[0].orders.find(x => /^Dosa/.test(x.head));
    assert.equal(o.venId, v.id);
  });

  await test('a one-time vendor is not suggested for other orders or purchases, but stays on its own order; Vendors says One-time', async () => {
    const once = (await dump()).vendors.find(x => x.oneTime).id;
    await openEvent();
    await p.locator('[data-action="order-new"][data-id^="Chaat"]').click(); await p.waitForSelector('#ord-modal.active');
    assert.equal((await options('#ord-ven')).some(t => /Roadside/.test(t)), false, 'not offered for the chaat order');
    await p.locator('#ord-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(300);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
    const dosa = (await dump()).events[0].orders.find(x => /^Dosa/.test(x.head));
    await p.locator(`[data-action="order-status"][data-id="${dosa.id}"]`).click(); await p.locator('#ask-modal.active #ask-actions button', { hasText: 'Edit / send again' }).click();
    await p.waitForSelector('#ord-modal.active');
    assert.equal(await p.inputValue('#ord-ven'), once, 'its own order still shows it');
    await p.locator('#ord-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(300);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
    await p.locator('[data-action="buy-new"]').first().click(); await p.waitForSelector('#buy-modal.active');
    assert.equal((await options('#buy-ven')).some(t => /Roadside/.test(t)), false, 'not offered for purchases');
    await p.locator('#buy-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(300);
    await p.locator('#n-vendors:visible').click(); await p.waitForTimeout(400);
    assert.match(await p.locator('#ven-list').innerText(), /Sample Roadside Dosa Wala\s*One-time · Live Counter/);
  });

  await test('purchase: + New vendor opens with Raw Material and comes back picked', async () => {
    await openEvent();
    await p.locator('[data-action="buy-new"]').first().click(); await p.waitForSelector('#buy-modal.active');
    await p.selectOption('#buy-ven', '__new'); await p.waitForSelector('#ven-modal.active');
    assert.equal(await p.inputValue('#ven-cat'), 'Raw Material');
    await p.fill('#ven-name', 'Sample Chitale Sweets'); await p.fill('#ven-phone', '9000000013'); await p.locator('#btn-save-ven').click(); await p.waitForTimeout(600);
    assert.equal(await p.locator('#buy-modal.active').count(), 1);
    assert.equal(await p.inputValue('#buy-ven'), (await dump()).vendors.find(x => x.name === 'Sample Chitale Sweets').id);
  });

  await test('closing the vendor sheet without saving leaves the order as it was', async () => {
    await p.locator('#buy-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(300);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
    await openEvent();
    await p.locator('[data-action="order-new"][data-id^="Chaat"]').click(); await p.waitForSelector('#ord-modal.active');
    const before = await p.inputValue('#ord-ven');
    await p.selectOption('#ord-ven', '__new'); await p.waitForSelector('#ven-modal.active');
    await p.locator('#ven-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(300);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
    assert.equal(await p.locator('#ord-modal.active').count(), 1); assert.equal(await p.inputValue('#ord-ven'), before);
    // and the next new vendor from elsewhere is a normal one
    assert.equal(await p.evaluate(() => typeof window.newVendorOneTime), 'undefined');
  });

  await test('backups keep the one-time mark; a broken one is refused', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData();
      const bad = JSON.parse(JSON.stringify(d)); bad.vendors.find(v => v.oneTime).oneTime = 'yes';
      let refused = ''; try { await db.importAllData(bad, 'replace'); } catch (e) { refused = e.message; }
      await db.importAllData(JSON.parse(JSON.stringify(d)), 'replace');
      return { refused, kept: (await db.exportAllData()).vendors.filter(v => v.oneTime).length }; });
    assert.ok(r.refused, 'a changed backup is refused'); assert.equal(r.kept, 1);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'order-vendors FAIL' : 'new and one-time vendors from an order PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('order-vendors FAIL'); process.exitCode = 1; });
