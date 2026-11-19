// Usual-vendor picks on the expense sheet: a very long vendor name wraps inside its chip and stays on the screen,
// in English and Marathi. Before 4.31.x it ran off the chip's edge (noted in the 19 Nov handover). 360px. Synthetic data.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const LONG = 'Sample Shree Mahalaxmi Ice Cream and Kulfi Suppliers Wholesale Retail Distribution Company';
const LONG_MR = 'नमुना श्री महालक्ष्मी आइस्क्रीम आणि कुल्फी पुरवठादार घाऊक किरकोळ वितरण कंपनी';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  const ice = await p.evaluate(async () => { const u = await import('./utils.js'); return (u.HEADS?.['Live Counter'] || []).find(h => /Ice Cream/.test(h)); });
  const headFor = async () => ice || p.locator('#exp-head option').evaluateAll(os => os.map(o => o.value).find(v => /Ice Cream/.test(v)));

  for (const [label, name] of [['English', LONG], ['Marathi', LONG_MR]]) {
    await test(`${label}: a long usual-vendor name wraps inside its chip and stays on the screen`, async () => {
      await p.evaluate(async n => { const db = await import('./db.js');
        await db.importAllData({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
          events: [{ id: 'e', name: 'Sample Event', date: new Date().toISOString().slice(0, 10), venue: 'Sample Hall', type: 'Party – पार्टी', billing: 50000, guests: 100, photoIds: [] }],
          vendors: [{ id: 'long', name: n, cat: 'Live Counter', specialty: 'Ice Cream' }, { id: 'short', name: 'Sample Kulfi', cat: 'Live Counter', specialty: 'Ice Cream' }] }); }, name);
      await p.reload(); await p.waitForSelector('#kpi .card');
      await p.locator('[data-action="quick"][data-id="expense"]').click(); await p.waitForSelector('#exp-modal.active');
      await p.locator('#exp-cats [data-cat="Live Counter"]').click();
      await p.locator('#exp-head').selectOption(await headFor());
      const chip = p.locator('#exp-ven-quick [data-ven="long"]');
      await chip.waitFor();
      const m = await chip.evaluate(b => { const r = b.getBoundingClientRect(), row = b.parentElement.getBoundingClientRect();
        return { right: r.right, rowRight: row.right, vw: innerWidth, sw: b.scrollWidth, cw: b.clientWidth, text: b.textContent }; });
      assert.equal(m.text, name, 'the full name is in the chip');
      assert.ok(m.sw <= m.cw + 1, `text fits inside the chip (${m.sw} > ${m.cw})`);
      assert.ok(m.right <= m.rowRight + 1 && m.right <= m.vw, `chip stays on the screen (${m.right} / ${m.vw})`);
      await chip.click(); assert.equal(await p.locator('#exp-vendor').inputValue(), 'long', 'tapping it still picks the vendor');
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      const ask = p.getByRole('button', { name: /Discard/ }); if (await ask.count()) await ask.first().click();
    });
  }

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})();
