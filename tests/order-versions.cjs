// Phase 3 P3-E vendor order messages (G-10, G-26): every different message is kept with its own real status.
// Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // local date, as the app uses
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'vd', name: 'Sample Dosa Counter', cat: 'Live Counter', phone: '9000000001' }, { id: 'vn', name: 'Sample No Phone', cat: 'Live Counter' }],
  events: [{ id: 'E', name: 'Sample Wedding', date: day(8), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 300000, guests: 300, photoIds: [],
    dishes: [{ name: 'Masala Dosa', head: 'Dosa – डोसा' }, { name: 'Pani Puri', head: 'Chaat – चाट' }] }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const order = async head => (await p.evaluate(async () => (await import('./db.js')).exportAllData())).events[0].orders.find(o => o.head.startsWith(head));
  const openEvent = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="E"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name'); await p.waitForTimeout(200);
    await p.evaluate(() => { window.__opens = []; window.open = url => { window.__opens.push(decodeURIComponent(String(url))); return null; }; }); };
  const statusSheet = async head => { await p.locator('#menu-orders .row', { hasText: head }).locator('[data-action="order-status"]').click(); await p.waitForSelector('#ask-modal.active'); };
  const pick = async label => { await p.locator('#ask-actions button', { hasText: label }).click(); await p.waitForTimeout(400); };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);

  await test('G-10: opening WhatsApp and backing out leaves the order "WhatsApp opened", never sent', async () => {
    await openEvent(); await p.locator('[data-action="order-new"][data-id^="Dosa"]').click(); await p.waitForSelector('#ord-modal.active');
    await p.selectOption('#ord-ven', 'vd'); await p.fill('#ord-plates', '250'); await p.locator('#btn-send-ord').click(); await p.waitForTimeout(500);
    const o = await order('Dosa');
    assert.equal(o.status, 'opened'); assert.equal(o.messages.length, 1);
    assert.deepEqual([o.messages[0].v, o.messages[0].status], [1, 'opened']); assert.match(o.messages[0].text, /Dosa for 250 plates/);
    assert.equal((await p.evaluate(() => window.__opens))[0].includes('Dosa for 250 plates'), true, 'WhatsApp got the same text that was kept');
  });

  await test('G-26: a revised message after confirmation is a new version; the old one keeps "Vendor confirmed"', async () => {
    await openEvent(); await statusSheet('Dosa'); await pick('Vendor confirmed');
    let o = await order('Dosa'); assert.deepEqual([o.status, o.messages[0].status], ['confirmed', 'confirmed']); assert(o.messages[0].confirmedAt);
    // Same text again: no new version
    await openEvent(); await statusSheet('Dosa'); await pick('Edit / send again'); await p.waitForSelector('#ord-modal.active');
    await p.locator('#btn-send-ord').click(); await p.waitForTimeout(500);
    o = await order('Dosa'); assert.equal(o.messages.length, 1, 'unchanged message: no new version'); assert.equal(o.status, 'confirmed');
    // Revised: 280 plates
    await openEvent(); await statusSheet('Dosa'); await pick('Edit / send again'); await p.waitForSelector('#ord-modal.active');
    await p.fill('#ord-plates', '280'); await p.locator('#btn-send-ord').click(); await p.waitForTimeout(500);
    o = await order('Dosa');
    assert.equal(o.messages.length, 2);
    assert.deepEqual(o.messages.map(m => [m.v, m.status]), [[1, 'confirmed'], [2, 'opened']], 'old version keeps its real status');
    assert.match(o.messages[0].text, /250 plates/); assert.match(o.messages[1].text, /280 plates/);
    assert.equal(o.status, 'opened', 'the new instruction is not yet sent or confirmed');
    await openEvent(); assert.match(await p.locator('#menu-orders .row', { hasText: 'Dosa' }).innerText(), /WhatsApp opened · 280/);
    // You confirm you sent it: only the latest version changes
    await statusSheet('Dosa'); await pick('I have sent it');
    o = await order('Dosa'); assert.deepEqual(o.messages.map(m => m.status), ['confirmed', 'sent']); assert.equal(o.status, 'sent');
    // History shows both, newest first, with their own status
    await openEvent(); await statusSheet('Dosa'); await pick('Messages sent (2)'); await p.waitForSelector('#ask-modal.active');
    const h = await p.locator('#ask-msg').innerText();
    assert.match(h, /Version 2 · .* · Sent \(you confirmed\)[\s\S]*280 plates[\s\S]*Version 1 · .* · Vendor confirmed[\s\S]*250 plates/);
    await p.locator('#ask-actions button').last().click(); await p.waitForTimeout(250);
  });

  await test('a vendor without a phone: the message is kept as "Not sent yet"', async () => {
    await openEvent(); await p.locator('[data-action="order-new"][data-id^="Chaat"]').click(); await p.waitForSelector('#ord-modal.active');
    await p.selectOption('#ord-ven', 'vn'); await p.locator('#btn-send-ord').click(); await p.waitForTimeout(500);
    const o = await order('Chaat'); assert.deepEqual([o.status, o.messages[0].status], ['prepared', 'prepared']);
    const bad = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest; d.events[0].orders[0].messages = [{ text: 'x', status: 'delivered' }];
      try { await db.importAllData(d, 'replace'); return 'accepted'; } catch (e) { return e.message; } });
    assert.equal(bad, 'Invalid order messages');
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'order versions FAIL' : 'order message versions (G-10, G-26) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('order versions FAIL'); process.exitCode = 1; });
