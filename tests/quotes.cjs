// Phase 2 quotations (spec §6.1, §6.3–6.6, Q-01/G-03): versions that are never overwritten once sent, client-facing text
// without costs, explicit acceptance into the event's bill. No tax maths (O-01/O-02 open). Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // local date, as the app uses
const DATA = { version: 'ffv2', photos: [], vendors: [], vPays: [], cPays: [],
  expenses: [{ id: 'x1', evId: 'W', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 300000, date: day(-1), pay: 'paid' }],
  events: [{ id: 'W', name: 'Sample Wedding', date: day(20), venue: 'Sample Lawn', type: 'Wedding – लग्न', billing: 600000, guests: 900, photoIds: [], mobile: '9000000005',
    meals: ['breakfast', 'dinner'], mealPlan: { dinner: { guests: 900, rate: 800 }, breakfast: { guests: 35, rate: 150 } } }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const ev = async () => (await p.evaluate(async () => (await import('./db.js')).exportAllData())).events[0];
  const openQuote = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="W"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name');
    await p.evaluate(() => { window.__opens = []; window.open = url => { window.__opens.push(decodeURIComponent(String(url))); return null; }; });
    await p.locator('[data-action="quote-open"]').click(); await p.waitForSelector('#quote-modal.active'); };
  const line = (i, k) => p.locator(`#quote-lines [data-ql="${i}"] [data-k="${k}"]`);
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  await p.evaluate(async () => { const db = await import('./db.js'), u = await import('./utils.js'); const d = await db.exportAllData(); const { _rev, ...e } = d.events[0];
    await db.putOne('events', { ...e, ...u.reconcileFields(e, d.expenses, ['bills', 'shared', 'final']) }); });

  await test('G-03 / Q-01: a new quote starts from the meal plan – 900 × ₹800 + 35 × ₹150 = ₹7,25,250, each meal on its own rate', async () => {
    await openQuote();
    assert.match(await p.locator('#quote-total').innerText(), /Total ₹7,25,250 · before any applicable GST/);
    assert.deepEqual(await p.locator('#quote-lines [data-k="meal"]').evaluateAll(s => s.map(x => x.value)), ['breakfast', 'dinner']);
    await line(0, 'rate').fill('175');   // breakfast rate changes; dinner untouched
    assert.match(await p.locator('#quote-total').innerText(), /₹7,26,125/);
    assert.equal(await line(1, 'rate').inputValue(), '800');
  });

  await test('refused: a meal without a rate, the same meal twice, or a discount bigger than the quote', async () => {
    const check = qt => p.evaluate(q => import('./utils.js').then(u => u.checkQuote(q)), qt);
    assert.equal(await check({ lines: [{ kind: 'meal', meal: 'dinner', guests: 10, rate: '' }] }), 'Each meal needs guests and a rate');
    assert.equal(await check({ lines: [{ kind: 'meal', meal: 'dinner', guests: 10, rate: 5 }, { kind: 'meal', meal: 'dinner', guests: 2, rate: 5 }] }), 'Each meal can appear only once');
    assert.equal(await check({ lines: [{ kind: 'item', label: 'Decor', amt: 100 }, { kind: 'discount', label: 'x', amt: 200 }] }), 'The discount is more than the quote');
    assert.equal(await check({ lines: [{ kind: 'discount', label: 'x', amt: 1 }] }), 'Add at least one meal or item');
  });

  await test('share: saved first, client text has rates and total but no costs; WhatsApp only on tap; still a draft', async () => {
    await p.locator('[data-ql-add="item"]').click(); await line(2, 'label').fill('Transport'); await line(2, 'amt').fill('8000');
    await p.locator('[data-ql-add="discount"]').click(); await line(3, 'label').fill('Round figure'); await line(3, 'amt').fill('4125');
    await p.fill('#quote-terms', '50% advance to confirm');
    await p.locator('[data-action="quote-share"]').click(); await p.waitForSelector('#ask-modal.active');
    assert.deepEqual(await p.evaluate(() => window.__opens), []);
    const qv = (await ev()).quotes[0];
    assert.deepEqual([qv.v, qv.status, qv.lines.length], [1, 'draft', 4]);
    await p.locator('#ask-actions button', { hasText: 'Open WhatsApp' }).click(); await p.waitForTimeout(300);
    const [url] = await p.evaluate(() => window.__opens);
    assert.match(url, /^https:\/\/wa\.me\/919000000005\?text=Quotation \(version 1\) – Sample Wedding/);
    for (const re of [/Breakfast: 35 guests × ₹175 = ₹6,125/, /Dinner: 900 guests × ₹800 = ₹7,20,000/, /Transport: ₹8,000/, /Round figure: −₹4,125/, /Total: ₹7,30,000 \(before any applicable GST\)/, /50% advance to confirm/]) assert.match(url, re);
    assert.doesNotMatch(url, /3,00,000|cost|margin|profit/i, 'no internal figures');
    assert.equal((await ev()).quotes[0].status, 'draft', 'opening WhatsApp is not "sent"');
  });

  await test('totals only: hiding per-plate rates leaves just meals, items and the total', async () => {
    const text = await p.evaluate(async () => { const d = await (await import('./db.js')).exportAllData(); return d.events[0].quotes[0]; });
    await openQuote(); await p.locator('#quote-rates').uncheck(); await p.locator('[data-action="quote-share"]').click(); await p.waitForSelector('#ask-modal.active');
    const msg = await p.locator('#ask-msg').innerText();
    assert.match(msg, /Dinner: 900 guests\n/); assert.doesNotMatch(msg, /×|₹800|Transport: ₹/); assert.match(msg, /Total: ₹7,30,000/);
    await p.locator('#ask-actions button').last().click().catch(() => {}); await p.keyboard.press('Escape').catch(() => {});
    assert.equal(text.lines.length, 4);
  });

  await test('"I have sent it" locks v1; a change is a new version and v1 stays exactly as sent', async () => {
    await openQuote(); await p.locator('#quote-rates').check(); await p.locator('[data-action="quote-sent"]').click(); await p.waitForTimeout(500);
    const v1 = (await ev()).quotes[0]; assert.equal(v1.status, 'sent'); assert(v1.sentAt); assert.match(v1.text, /Total: ₹7,30,000/);
    assert.equal(await p.locator('#quote-lines').count(), 0, 'a sent version cannot be edited');
    await p.locator('[data-action="quote-new"]').click();
    await line(1, 'guests').fill('950'); await p.locator('[data-action="quote-sent"]').click(); await p.waitForTimeout(500);
    const qs = (await ev()).quotes;
    assert.deepEqual(qs.map(x => [x.v, x.status]), [[1, 'sent'], [2, 'sent']]);
    assert.deepEqual(qs[0], v1, 'v1 unchanged');
    assert.equal(qs[1].lines[1].guests, 950);
    await p.locator('#quote-versions [data-qv="1"]').click();
    assert.match(await p.locator('#quote-status').innerText(), /replaced by a later version/);
    assert.equal(await p.locator('[data-action="quote-accept"]').count(), 0, 'a replaced version cannot be accepted');
  });

  await test('accepting needs written/verbal evidence, then an explicit confirm that sets the bill and meals, logged; reconciliation reopens', async () => {
    await openQuote(); await p.locator('#quote-versions [data-qv="2"]').click();
    await p.locator('[data-action="quote-accept"]').click(); await p.waitForTimeout(250);
    assert.match(await p.locator('#toast-msg').innerText(), /written or verbal/);
    await p.selectOption('#quote-evidence', 'verbal'); await p.locator('[data-action="quote-accept"]').click(); await p.waitForTimeout(250);
    assert.match(await p.locator('#toast-msg').innerText(), /who accepted/);
    await p.fill('#quote-by', 'Sample Client, on call'); await p.locator('[data-action="quote-accept"]').click(); await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-msg').innerText(), /Bill ₹6,00,000 → ₹7,70,000 \(before any applicable GST\)\. Agreed meals: Breakfast 35 @ ₹175, Dinner 950 @ ₹800/);
    await p.locator('#ask-actions button').last().click(); await p.waitForTimeout(300);
    assert.equal((await ev()).billing, 600000, 'cancel changes nothing'); assert.equal((await ev()).quotes[1].status, 'sent');
    await p.locator('[data-action="quote-accept"]').click(); await p.waitForSelector('#ask-modal.active'); await p.locator('#ask-actions button').first().click(); await p.waitForTimeout(500);
    const e = await ev();
    assert.deepEqual([e.billing, e.quotes[1].status, e.quotes[1].evidence, e.quotes[1].by], [770000, 'accepted', 'verbal', 'Sample Client, on call']);
    assert.deepEqual(e.mealPlan, { breakfast: { guests: 35, rate: 175 }, dinner: { guests: 950, rate: 800 } });
    assert.deepEqual(e.billChanges.map(c => [c.from, c.to, c.reason]), [[600000, 770000, 'Quote v2 accepted']]);
    assert.equal(e.quotes[0].status, 'sent', 'the earlier version is kept as it was');
    const st = await p.evaluate(async () => { const u = await import('./utils.js'); const d = await (await import('./db.js')).exportAllData(); return u.reconStatus(d.events[0], d.expenses).state; });
    assert.equal(st, 'reopened');
    assert.match(await p.locator('#quote-line').innerText(), /Quote v2 · Accepted · ₹7,70,000 before tax/);
  });

  await test('backup keeps every version exactly; malformed quotes are refused', async () => {
    const strip = ({ _rev, ...e }) => e; const before = await ev();
    const after = await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); await db.importAllData(JSON.parse(JSON.stringify(d)), 'replace'); return (await db.exportAllData()).events[0]; });
    assert.deepEqual(strip(after), strip(before));
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const out = [];
      for (const f of [e => { e.quotes[0].status = 'won'; }, e => { e.quotes[0].lines[0].rate = -1; }, e => { e.quotes[1].v = 1; }, e => { e.quotes[0].lines[0] = { kind: 'tax', amt: 5 }; }]) {
        const d = await db.exportAllData(); delete d.manifest; f(d.events[0]);
        try { await db.importAllData(d, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message.split(':')[0].split('.')[0]); } }
      return out; });
    assert.deepEqual(r, ['Invalid quote', 'Invalid money amount', 'Invalid quote', 'Invalid quote']);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'quotes FAIL' : 'quotations: versions, client text, acceptance (G-03, Q-01) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('quotes FAIL'); process.exitCode = 1; });
