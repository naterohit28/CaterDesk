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
    assert.match(await p.locator('#quote-total').innerText(), /Total · before any GST\s*₹7,25,250/);
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
    assert.match(msg, /Breakfast: ₹6,125\nDinner: ₹7,20,000\nTransport: ₹8,000/, 'each line shows its amount'); assert.doesNotMatch(msg, /guests|×|₹800 /); assert.match(msg, /Total: ₹7,30,000/);
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
    assert.match(await p.locator('#ask-msg').innerText(), /Bill ₹6,00,000 → ₹7,70,000 \(before GST\)\. Agreed meals: Breakfast 35 @ ₹175, Dinner 950 @ ₹800/);
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

  await test('five meals in a day (incl. Late night), 4-digit guests and rates fit, and a discount row is clearly marked', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const { _rev, ...e } = d.events[0];
      await db.putOne('events', { ...e, id: 'F', name: 'Sample Five Meals', quotes: [], billChanges: [], recon: null, reconHistory: [], meals: ['breakfast', 'lunch', 'hightea', 'dinner', 'latenight'],
        mealPlan: { breakfast: { guests: 1200, rate: 1250 }, lunch: { guests: 1200, rate: 1450 }, hightea: { guests: 900, rate: 350 }, dinner: { guests: 1200, rate: 1850 }, latenight: { guests: 300, rate: 400 } } }); });
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="F"]:visible').click(); await p.locator('[data-action="quote-open"]').click(); await p.waitForSelector('#quote-modal.active');
    assert.deepEqual(await p.locator('#quote-lines [data-k="meal"]').evaluateAll(s => s.map(x => x.value)), ['breakfast', 'lunch', 'hightea', 'dinner', 'latenight']);
    assert.match(await p.locator('#quote-lines [data-k="meal"]').last().evaluate(s => s.selectedOptions[0].text), /Late night/);
    await p.locator('[data-ql-add="discount"]').click();
    assert.match(await p.locator('#quote-lines .q-line.discount .q-tag').innerText(), /Discount \(taken off the total\)/);
    await p.waitForTimeout(300);
    const clipped = await p.locator('#quote-lines select, #quote-lines input[type="number"]').evaluateAll(els => els.filter(el => { const cs = getComputedStyle(el), c = document.createElement('canvas').getContext('2d');
      c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; const t = el.tagName === 'SELECT' ? el.selectedOptions[0].text : '8888';
      return c.measureText(t).width > el.getBoundingClientRect().width - parseFloat(cs.borderLeftWidth) * 2 - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); }).map(el => [el.tagName, el.tagName === 'SELECT' ? el.selectedOptions[0].text : el.value, getComputedStyle(el).fontSize, el.clientWidth]));
    assert.deepEqual(clipped, [], 'every meal name and 4-digit number fits on a 360px screen');
  });

  await test('GST: owner-entered % on a chosen amount; client sees subtotal, GST and total; bill stays before GST, the client owes GST on top', async () => {
    const check = qt => p.evaluate(q => import('./utils.js').then(u => u.checkQuote(q)), qt);
    const base = [{ kind: 'meal', meal: 'dinner', guests: 100, rate: 1000 }];
    assert.equal(await check({ lines: base, gst: { rate: '', taxable: 100000 } }), 'Enter the GST % (e.g. 5)');
    assert.equal(await check({ lines: base, gst: { rate: 5, taxable: 200000 } }), 'GST is charged on more than the quote');
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const { _rev, ...e } = d.events[0];
      await db.putOne('events', { ...e, id: 'G', name: 'Sample GST Event', quotes: [], billChanges: [], recon: null, reconHistory: [], billing: 0, meals: ['dinner'], mealPlan: { dinner: { guests: 100, rate: 1000 } } }); });
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="G"]:visible').click(); await p.locator('[data-action="quote-open"]').click(); await p.waitForSelector('#quote-modal.active');
    await p.locator('[data-ql-add="item"]').click(); await line(1, 'label').fill('Counter setup'); await line(1, 'amt').fill('20000');
    await p.locator('[data-gst-add]').click(); await p.fill('[data-g="rate"]', '5');
    assert.equal(await p.locator('[data-g="taxable"]').inputValue(), '120000', 'GST is charged on the subtotal unless changed');
    assert.match(await p.locator('#quote-total').innerText(), /Subtotal\s*₹1,20,000\s*GST @ 5% on ₹1,20,000\s*₹6,000\s*Total incl\. GST\s*₹1,26,000/);
    await p.evaluate(() => { window.open = () => null; });
    await p.locator('[data-action="quote-share"]').click(); await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-msg').innerText(), /Counter setup: ₹20,000\n\nSubtotal: ₹1,20,000\nGST @ 5% on ₹1,20,000: ₹6,000\nTotal: ₹1,26,000/);
    await p.locator('#ask-actions button').first().click(); await p.waitForTimeout(300);
    await p.locator('[data-action="quote-sent"]').click(); await p.waitForTimeout(400);
    await p.selectOption('#quote-evidence', 'written'); await p.locator('[data-action="quote-accept"]').click(); await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-msg').innerText(), /Bill ₹0 → ₹1,20,000 \(before GST\)\. GST ₹6,000 \(5% on ₹1,20,000\) is added to what the client pays: ₹1,26,000\. GST is not your income/);
    await p.locator('#ask-actions button').first().click(); await p.waitForTimeout(500);
    const e = (await p.evaluate(async () => (await import('./db.js')).exportAllData())).events.find(x => x.id === 'G');
    assert.deepEqual([e.billing, e.gst], [120000, { rate: 5, taxable: 120000, amount: 6000, from: 'Quote v1' }]);
    const r = await p.evaluate(async () => { const u = await import('./utils.js'); const db = await import('./db.js');
      await db.putOne('cPays', { id: 'gp', evId: 'G', amt: 126000, date: u.today(), mode: 'UPI' });
      const d = await db.exportAllData(), ev = d.events.find(x => x.id === 'G'), pl = u.calcEventPL(ev, d.cPays, d.expenses), st = u.settlementStatus(ev, d.cPays);
      return [pl.profit, pl.pending, st.outstanding, st.over]; });
    assert.deepEqual(r, [120000, 0, 0, 0], 'contribution excludes GST; paying the GST-inclusive total settles it exactly');
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click(); await p.locator('#ev-list [data-action="evdetail"][data-id="G"]:visible').click();
    assert.match(await p.locator('#ev-gst').innerText(), /\+ GST ₹6,000/);
  });

  await test('an event with no bill yet is never "Paid": its card shows the sent quote instead', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const { _rev, ...e } = d.events[0];
      await db.putOne('events', { ...e, id: 'N', name: 'Sample No Bill', billing: 0, gst: undefined, billChanges: [], recon: null, reconHistory: [],
        quotes: [{ v: 1, status: 'sent', at: '2026-01-01T00:00:00.000Z', sentAt: '2026-01-01T00:00:00.000Z', showRates: true, lines: [{ kind: 'meal', meal: 'dinner', guests: 100, rate: 500 }] }] }); });
    await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    const card = p.locator('#ev-list [data-action="evdetail"][data-id="N"]');
    assert.match(await card.innerText(), /Quote sent[\s\S]*Quote v1\s*₹50,000/); assert.doesNotMatch(await card.innerText(), /Paid|Collected/);
    assert.equal(await card.locator('.prog').count(), 0);
  });

  await test('several options side by side: B does not replace A; accepting one marks the other "Not chosen"', async () => {
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); const { _rev, ...e } = d.events[0];
      await db.putOne('events', { ...e, id: 'O', name: 'Sample Options', quotes: [], billChanges: [], recon: null, reconHistory: [], billing: 0, gst: undefined, meals: ['dinner'], mealPlan: { dinner: { guests: 300, rate: 800, menu: 'golden' } } }); });
    const open = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
      await p.locator('#ev-list [data-action="evdetail"][data-id="O"]:visible').click(); await p.locator('[data-action="quote-open"]').click(); await p.waitForSelector('#quote-modal.active'); };
    await open(); await p.locator('[data-action="quote-sent"]').click(); await p.waitForTimeout(400);           // Option A v1 sent
    await p.locator('[data-action="quote-option"]').click();                                                      // Option B from it
    await line(0, 'rate').fill('650'); await p.locator('#quote-lines [data-k="meal"]').first().evaluate(s => s);
    await p.evaluate(() => { window.open = () => null; });
    await p.locator('[data-action="quote-share"]').click(); await p.waitForSelector('#ask-modal.active');
    assert.match(await p.locator('#ask-msg').innerText(), /^Quotation \(Option B, version 2\) – Sample Options/);
    await p.locator('#ask-actions button').first().click(); await p.waitForTimeout(300);
    await p.locator('[data-action="quote-sent"]').click(); await p.waitForTimeout(400);
    let qs = (await p.evaluate(async () => (await import('./db.js')).exportAllData())).events.find(e => e.id === 'O').quotes;
    assert.deepEqual(qs.map(x => [x.v, x.option || 'A', x.status]), [[1, 'A', 'sent'], [2, 'B', 'sent']]);
    assert.match(await p.locator('#quote-versions').innerText(), /A · v1 ·\s*Sent[\s\S]*B · v2 ·\s*Sent/, 'B does not replace A');
    await p.locator('#modal-close, #quote-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(300);
    const card = await (async () => { await p.locator('#n-events:visible').click(); return p.locator('#ev-list [data-action="evdetail"][data-id="O"]').innerText(); })();
    assert.match(card, /2 quote options\s*₹1,95,000 – ₹2,40,000/);
    await open(); await p.locator('#quote-versions [data-qv="2"]').click(); await p.selectOption('#quote-evidence', 'written');
    await p.locator('[data-action="quote-accept"]').click(); await p.waitForSelector('#ask-modal.active'); await p.locator('#ask-actions button').first().click(); await p.waitForTimeout(500);
    await open(); assert.match(await p.locator('#quote-versions').innerText(), /A · v1 ·\s*Not chosen[\s\S]*B · v2 ·\s*Accepted/);
    await p.locator('#quote-versions [data-qv="1"]').click();
    assert.match(await p.locator('#quote-status').innerText(), /not chosen \(client accepted Option B\)/); assert.equal(await p.locator('[data-action="quote-accept"]').count(), 0);
    assert.equal(await p.locator('[data-action="quote-new"], [data-action="quote-option"]').count(), 0, 'no new versions once a quote is accepted');
    assert.equal((await p.evaluate(async () => (await import('./db.js')).exportAllData())).events.find(e => e.id === 'O').billing, 195000);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'quotes FAIL' : 'quotations: versions, client text, acceptance (G-03, Q-01) PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('quotes FAIL'); process.exitCode = 1; });
