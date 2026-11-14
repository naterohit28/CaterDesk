// "Deleted · Undo" closes by itself after a short window; Undo inside the window restores, and after it closes the
// deletion stays. (4.4.1 and earlier: the message never closed.) Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // local date, as the app uses
const DATA = { version: 'ffv2', photos: [], cPays: [], vPays: [], vendors: [],
  events: [{ id: 'e1', name: 'Sample Party', date: day(-2), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 100, photoIds: [] }],
  expenses: [{ id: 'x1', evId: 'e1', cat: 'Labour', head: 'Cook – स्वयंपाकी', amt: 5000, date: day(-2), pay: 'paid' },
    { id: 'x2', evId: 'e1', cat: 'Labour', head: 'Boys – बॉईज', amt: 3000, date: day(-2), pay: 'paid' }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  try {
    await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
    await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
    await p.reload(); await p.waitForSelector('#kpi .card');
    const ids = () => p.evaluate(async () => (await (await import('./db.js')).exportAllData()).expenses.map(x => x.id).sort());
    const remove = async id => {
      await p.locator('#n-expenses:visible').click(); await p.locator(`#exp-list [data-action="edit-exp"][data-id="${id}"]:visible`).click();
      await p.waitForSelector('#exp-modal.active'); await p.locator('#btn-del-exp').click();
      if (await p.locator('#ask-modal.active').count() || await p.waitForSelector('#ask-modal.active', { timeout: 1500 }).catch(() => null)) await p.locator('#ask-actions button').first().click();
      await p.waitForSelector('#toast.show.has-action');
    };
    // Undo inside the window restores the record
    await remove('x1');
    assert.match(await p.locator('#toast-msg').innerText(), /Deleted/); assert.deepEqual(await ids(), ['x2']);
    await p.locator('#toast-action').click(); await p.waitForTimeout(500);
    assert.deepEqual(await ids(), ['x1', 'x2'], 'Undo restored the expense');
    // A routine notice arriving while Undo is on offer keeps the Undo button under the new message
    await remove('x1');
    await p.locator('#exp-list [data-action="edit-exp"][data-id="x2"]:visible').click(); await p.waitForSelector('#exp-modal.active');
    await p.fill('#exp-notes', 'note'); await p.locator('#btn-save-exp').click(); await p.waitForTimeout(400);
    assert.equal(await p.locator('#toast.show.has-action').count(), 1, 'Undo still offered after the "saved" notice');
    await p.locator('#toast-action').click(); await p.waitForTimeout(500);
    assert.deepEqual(await ids(), ['x1', 'x2'], 'Undo still restores');
    // Left alone, the message closes by itself and the deletion stays
    await remove('x2');
    await p.waitForTimeout(8600);
    assert.equal(await p.locator('#toast.show').count(), 0, 'message closed by itself');
    assert.equal(await p.locator('#toast-action').evaluate(b => b.onclick), null, 'Undo no longer active');
    assert.deepEqual(await ids(), ['x1'], 'deletion kept after the message closed');
    // A plain message still closes after its usual time
    await p.evaluate(() => window.FF_toast_probe = 1);
    assert.deepEqual(errors, []);
    console.log('Undo message closes by itself after the undo window PASS');
  } catch (e) { console.error(e); console.log('Undo message closes by itself after the undo window FAIL'); process.exitCode = 1; }
  finally { await browser.close(); }
})();
