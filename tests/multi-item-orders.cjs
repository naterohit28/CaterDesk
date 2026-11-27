// 5.5.0 (owner's requirements): several items in one order to one supplier, e.g. a frozen-food supplier with three
// starters and a grocery item. Each item keeps its own quantity and unit (dozen and ladi added); one WhatsApp message
// lists them all; sending, confirming and delivery move together; the bill is linked once; nothing becomes an expense
// by itself. A cancel is one item. Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DATA = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'vf', name: 'Sample Frozen Foods', cat: 'Raw Material', phone: '9000000034' }],
  events: [{ id: 'e1', name: 'Sample Starter Party', date: day(10), venue: 'Sample Lawns', type: 'Wedding – लग्न', billing: 200000, meals: ['dinner'], photoIds: [],
    mealPlan: { dinner: { guests: 300, rate: 0 } }, services: [{ id: 'svc-dinner', meal: 'dinner', time: '20:00' }],
    dishes: [{ name: 'Spring Rolls', head: '', src: 'finish', meal: 'dinner' }, { name: 'Veg Crispy', head: '', src: 'finish', meal: 'dinner' },
      { name: 'Paneer Tikka', head: '', src: 'finish', meal: 'dinner' }, { name: 'Dal Tadka', head: '', meal: 'dinner' }] }] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const ev = async () => (await dump()).events.find(e => e.id === 'e1');
  const openEvent = async () => { await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' }); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="e1"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    await p.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return {}; }; }); };
  const buyRow = key => p.locator(`#buy-list [data-buy="${key}"]`);
  const more = name => p.locator('#buy-more [data-bm]', { hasText: name });
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });
  await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA());

  await test('one order for three starters and a grocery item: each with its own quantity, one WhatsApp message', async () => {
    await openEvent();
    await buyRow('svc-dinner|spring rolls').locator('[data-action="buy-new"]').click(); await p.waitForSelector('#buy-modal.active');
    assert.equal(await p.locator('#buy-more [data-bm]').count(), 2, 'the other bought items still to order, not the kitchen dish');
    await p.selectOption('#buy-ven', 'vf'); await p.fill('#buy-qty', '15'); await p.selectOption('#buy-unit', 'kg');
    await more('Veg Crispy').locator('[data-bk="qty"]').fill('10'); await more('Veg Crispy').locator('[data-bk="unit"]').selectOption('kg');
    await more('Paneer Tikka').locator('[data-bk="qty"]').fill('25'); await more('Paneer Tikka').locator('[data-bk="unit"]').selectOption('dozen');
    assert.equal(await more('Paneer Tikka').locator('[data-bk="on"]').isChecked(), true, 'typing a quantity ticks it');
    assert.deepEqual(await more('Paneer Tikka').locator('[data-bk="on"]').evaluate(c => [getComputedStyle(c).appearance !== 'none', c.getBoundingClientRect().width]), [true, 22], '5.5.1: shown as a tick box');
    await p.locator('#btn-buy-other').click(); await p.locator('#buy-more [data-bm]:last-child [data-bk="name"]').fill('Cooking Oil');
    await p.locator('#buy-more [data-bm]:last-child [data-bk="qty"]').fill('5'); await p.locator('#buy-more [data-bm]:last-child [data-bk="unit"]').selectOption('litre');
    const wide = await p.evaluate(() => document.querySelector('#buy-modal .sheet').scrollWidth > document.querySelector('#buy-modal .sheet').clientWidth + 1);
    assert.equal(wide, false, 'fits at 360px');
    await p.fill('#buy-time-t', '6:30'); await p.locator('#buy-time-pm').click();
    await p.locator('#btn-send-buy').click(); await p.waitForSelector('#ask-modal.active #ask-actions .btn-wa');
    const e1 = await ev(), ps = e1.purchases;
    assert.equal(ps.length, 4); assert.equal(new Set(ps.map(x => x.grp)).size, 1, 'one order'); assert.equal(ps[0].grp, ps[0].id, 'the first item leads');
    assert.deepEqual(ps.map(x => [x.item, x.qty, x.unit, x.status, !!x.extra]), [['Spring Rolls', 15, 'kg', 'prepared', false], ['Veg Crispy', 10, 'kg', 'prepared', false],
      ['Paneer Tikka', 25, 'dozen', 'prepared', false], ['Cooking Oil', 5, 'litre', 'prepared', true]]);
    await p.locator('#ask-modal.active #ask-actions .btn-wa').click(); await p.waitForTimeout(500);
    const msg = decodeURIComponent((await p.evaluate(() => window.__opened.at(-1))).split('text=')[1]);
    assert.match(msg, /Items:\n1\. Spring Rolls – 15 kg\n2\. Veg Crispy – 10 kg\n3\. Paneer Tikka – 25 dozen\n4\. Cooking Oil – 5 litres\nDate: .*\(Dinner\)\nDeliver by: 6:30/);
    assert.equal(await p.evaluate(() => window.__opened.length), 1, 'one message, not four');
    assert.deepEqual((await ev()).purchases.map(x => x.status), ['opened', 'opened', 'opened', 'opened']);
    assert.equal((await dump()).expenses.length, 0, 'an order is not an expense');
  });

  await test('marking one item sent marks the order; the grocery item shows as an other item', async () => {
    await openEvent();
    assert.match(await p.locator('#buy-list').innerText(), /Cooking Oil\nOther item · 5 litres · Sample Frozen Foods/);
    await buyRow('svc-dinner|veg crispy').locator('[data-action="buy-status"]').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'I have sent it' }).click(); await p.waitForTimeout(500);
    assert.deepEqual((await ev()).purchases.map(x => x.status), ['sent', 'sent', 'sent', 'sent']);
    await p.locator('[data-action="fs-open"]').first().click(); await p.waitForSelector('#fs-modal.active');
    assert.match(await p.locator('#fs-text').innerText(), /OTHER ITEMS\n- Cooking Oil: 5 litres\n  Sample Frozen Foods \(9000000034\) · Sent/, '5.5.1: on the function sheet');
    await p.locator('#fs-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(200);
  });

  await test('changing one quantity makes a new message version for the whole order, back to not sent', async () => {
    await openEvent();
    await buyRow('svc-dinner|paneer tikka').locator('[data-action="buy-status"]').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Edit / send again' }).click(); await p.waitForSelector('#buy-modal.active');
    assert.equal(await p.locator('#buy-more [data-bm]').count(), 3, 'the rest of the order is listed');
    await p.fill('#buy-qty', '30'); await p.locator('#btn-send-buy').click(); await p.waitForTimeout(600);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-modal.active [data-action="close-modal"], #ask-modal.active .btn-ghost').first().click().catch(() => {});
    const ps = (await ev()).purchases;
    assert.deepEqual(ps.map(x => x.status), ['prepared', 'prepared', 'prepared', 'prepared']);
    assert.ok(ps.every(x => x.messages.length === 2 && /3\. Paneer Tikka – 30 dozen/.test(x.messages.at(-1).text)));
  });

  await test('delivered: the whole order is delivered and its one bill goes to the first item', async () => {
    await openEvent();
    await buyRow('svc-dinner|spring rolls').locator('[data-action="buy-status"]').click(); await p.waitForSelector('#ask-modal.active');
    await p.locator('#ask-actions button', { hasText: 'Delivered' }).click(); await p.waitForTimeout(700);
    assert.deepEqual((await ev()).purchases.map(x => x.status), ['delivered', 'delivered', 'delivered', 'delivered']);
    await p.waitForSelector('#exp-modal.active');
    await p.locator('#exp-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(300);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
    // A bill linked to the first item counts for every item of the order
    const lead = (await ev()).purchases[0].id;
    await p.evaluate(async id => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest;
      d.expenses.push({ id: 'EXb', evId: 'e1', cat: 'Raw Material', head: 'Frozen Food', amt: 9000, date: d.events[0].date, pay: 'credit', venId: 'vf', purchase: id, billIds: [] });
      await db.importAllData(d, 'replace'); }, lead);
    await openEvent();
    const t = await p.locator('#buy-list').innerText();
    assert.equal((t.match(/Delivered · billed/g) || []).length, 4, t);
  });

  await test('backups: dozen, ladi and orders restore; a bad order link is refused', async () => {
    const d = await dump(); delete d.manifest;
    d.events[0].purchases[1].unit = 'ladi';
    await p.evaluate(async x => { await (await import('./db.js')).importAllData(x, 'replace'); }, d);
    d.events[0].purchases[1].grp = 42;
    const err = await p.evaluate(async x => { try { await (await import('./db.js')).importAllData(x, 'replace'); return ''; } catch (e) { return e.message; } }, d);
    assert.match(err, /purchase/i);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'multi-item-orders FAIL' : 'several items in one supplier order PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('multi-item-orders FAIL'); process.exit(1); });
