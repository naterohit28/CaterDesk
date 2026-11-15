// Client documents (PR 5): quotation only, quotation with a menu annexure, and the menu on its own (PDF or WhatsApp),
// each from a chosen approved version (or the current menu, marked as a draft). Client documents never show kitchens,
// counters, vendors, costs or margins. What was sent is kept and prints again unchanged; quotes sent before copies were
// kept say they are rebuilt. 360px. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const EVENT = { id: 'W', name: 'Sample Document Wedding', date: day(15), venue: 'Sample Lawns', type: 'Wedding – लग्न', billing: 300000, guests: 300, mobile: '9000000011', meals: ['lunch', 'dinner'], photoIds: [],
  mealPlan: { lunch: { guests: 250, rate: 450 }, dinner: { guests: 300, rate: 650 } },
  dishes: [{ name: 'Jeera Rice', head: '', meal: 'lunch' }, { name: 'Pani Puri', head: 'Chaat – चाट', meal: 'lunch' }, { name: 'Dal Tadka', head: '', meal: 'lunch', diet: ['jain'] },
    { name: 'Paneer Tikka', head: 'Barbeque / Tandoor – तंदूर', meal: 'dinner' }, { name: 'Mineral Water', head: '' }],
  // sent before CaterDesk kept copies of issued quotes
  quotes: [{ v: 1, status: 'sent', sentAt: '2026-11-01T10:00:00.000Z', lines: [{ kind: 'meal', meal: 'lunch', guests: 250, rate: 450 }], showRates: true, terms: '' }] };
const INTERNAL = /Chaat|Tandoor|Barbeque|Our kitchen|cost|margin|contribution|vendor|counter/i;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const ev = async () => (await dump()).events.find(e => e.id === 'W');
  const stub = () => p.evaluate(() => { window.__printed = []; window.__opened = []; window.print = () => window.__printed.push({ text: document.querySelector('#print-doc').innerText, html: document.querySelector('#print-doc').innerHTML }); window.open = u => { window.__opened.push(u); return null; }; });
  const openEvent = async () => { await p.reload(); await p.waitForSelector('#kpi .card'); await p.locator('#n-events:visible').click();
    await p.locator('#ev-list [data-action="evdetail"][data-id="W"]:visible').click(); await p.waitForSelector('#tab-evdetail .detail-name'); await stub(); };
  const openQuote = async () => { await openEvent(); await p.locator('[data-action="quote-open"]').click(); await p.waitForSelector('#quote-modal.active'); };
  const printed = () => p.evaluate(() => window.__printed.at(-1));
  const annexOf = text => text.slice(text.indexOf('Menu – annexure to the quotation'));
  // Approve the current menu as the next version (as the approval sheet does)
  const approve = (by = 'written') => p.evaluate(async b => { const db = await import('./db.js'), u = await import('./utils.js');
    const d = await db.exportAllData(); delete d.manifest; const e = d.events.find(x => x.id === 'W');
    e.menuApproved = [...(e.menuApproved || []), u.approvedVersion(e, { by: b })]; delete e._rev; await db.importAllData(d, 'replace'); }, by);
  const addDish = (name, meal) => p.evaluate(async ([n, m]) => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest;
    const e = d.events.find(x => x.id === 'W'); e.dishes.push({ name: n, head: '', meal: m }); delete e._rev; await db.importAllData(d, 'replace'); }, [name, meal]);
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  await p.evaluate(async e => { localStorage.setItem('ffv2_profile', JSON.stringify({ name: 'Sample Caterers', phone: '9000000009' }));
    const db = await import('./db.js'); await db.importAllData({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [], vendors: [], events: [e] }); }, EVENT);
  await approve();

  await test('a quote sent before copies were kept prints with a "rebuilt from current data" label', async () => {
    await openQuote(); await p.locator('[data-action="quote-print"]').click(); await p.waitForTimeout(300);
    assert.match((await printed()).text, /Rebuilt from current data: this quotation was sent before CaterDesk kept copies/);
    assert.doesNotMatch((await printed()).text, /annexure/);
  });

  await test('quotation + menu annexure: a new version takes the approved menu; the annexure shows meals, dishes and diet marks, nothing internal', async () => {
    await p.locator('[data-action="quote-new"]').click(); await p.waitForTimeout(300);
    const v1 = (await ev()).menuApproved[0];
    assert.equal(await p.inputValue('#quote-annex'), v1.id, 'latest approved version chosen');
    assert.deepEqual(await p.locator('#quote-annex option').allInnerTexts(), ['No menu annexure', `Menu version 1 · approved ${await p.evaluate(async d => (await import('./utils.js')).fmtDate(d), day(0))}`, 'Current menu – not yet approved']);
    await p.locator('[data-action="quote-print"]').click(); await p.waitForTimeout(300);
    const { text, html } = await printed(), annex = annexOf(text);
    assert.match(text, /^[\s\S]*QUOTATION[\s\S]*Lunch[\s\S]*Total[\s\S]*MENU – ANNEXURE TO THE QUOTATION/i);
    assert.match(annex, /Menu version 1 · approved/);
    assert.match(annex, /Lunch\s*250 guests\s*Jeera Rice\s*Pani Puri\s*Dal Tadka \(Jain\)/);
    assert.match(annex, /Served at every meal\s*Mineral Water/); assert.match(annex, /Paneer Tikka/);
    assert.doesNotMatch(annex, INTERNAL, 'no kitchens, counters, vendors, costs'); assert.doesNotMatch(annex, /₹/, 'no rates or amounts in the menu');
    assert.match(html, /class="pd pd-break"/, 'the menu starts on its own page');
    await p.selectOption('#quote-annex', 'draft'); await p.locator('[data-action="quote-print"]').click(); await p.waitForTimeout(300);
    assert.match(annexOf((await printed()).text), /Draft menu – not yet approved by the client/);
    await p.selectOption('#quote-annex', ''); await p.locator('[data-action="quote-print"]').click(); await p.waitForTimeout(300);
    assert.doesNotMatch((await printed()).text, /annexure/, 'quotation only');
  });

  await test('sending the quote keeps its annexure; a later menu change and approval never alter it; the next version takes the new approved menu', async () => {
    await p.selectOption('#quote-annex', (await ev()).menuApproved[0].id);
    await p.locator('[data-action="quote-share"]').click(); await p.waitForSelector('#ask-modal.active');
    const shareText = await p.locator('#ask-msg').innerText();
    assert.match(shareText, /— Menu —\nMenu version 1 · approved[\s\S]*\*Lunch\* · 250 guests\n• Jeera Rice\n• Pani Puri\n• Dal Tadka \(Jain\)/);
    assert.doesNotMatch(shareText.slice(shareText.indexOf('— Menu —')), INTERNAL);
    await p.locator('#ask-actions button', { hasText: 'Cancel' }).click(); await p.waitForTimeout(300);
    await p.locator('[data-action="quote-sent"]').click(); await p.waitForTimeout(600);
    let q2 = (await ev()).quotes.find(x => x.v === 2);
    assert.equal(q2.status, 'sent'); assert.equal(q2.snap.layout, 1); assert.match(q2.snap.annex.label, /^Menu version 1/);
    assert.equal(q2.snap.annex.meals[0].dishes.some(d => 'head' in d), false, 'no kitchen/counter even inside the kept copy');
    await addDish('Gulab Jamun', 'lunch'); await approve('written');
    await openQuote(); await p.locator('#quote-versions [data-qv="2"]').click(); await p.waitForTimeout(200);
    assert.match(await p.locator('#quote-body').innerText(), /With menu annexure: Menu version 1 · approved/);
    await p.locator('[data-action="quote-print"]').click(); await p.waitForTimeout(300);
    const kept = annexOf((await printed()).text);
    assert.match(kept, /Menu version 1/); assert.doesNotMatch(kept, /Gulab Jamun/, 'sent annexure unchanged');
    assert.doesNotMatch((await printed()).text, /Rebuilt from current data/);
    await p.locator('[data-action="quote-new"]').click(); await p.waitForTimeout(300);
    assert.equal(await p.inputValue('#quote-annex'), (await ev()).menuApproved[1].id, 'new version: approved version 2');
  });

  await test('menu on its own: choose a version, PDF without DRAFT for an approved menu, WhatsApp text, nothing internal', async () => {
    await openEvent();
    await p.locator('[data-action="menu-send"]').click(); await p.waitForSelector('#md-modal.active');
    assert.match((await p.locator('#md-ver option').allInnerTexts()).join('|'), /^Version 2 · approved .*\|Version 1 · approved .*\|Current menu – not yet approved$/);
    const preview = await p.locator('#md-preview').innerText();
    assert.match(preview, /^Menu version 2 · approved[\s\S]*• Gulab Jamun/); assert.doesNotMatch(preview, INTERNAL);
    await p.locator('#btn-md-print').click(); await p.waitForTimeout(300);
    const { text } = await printed();
    assert.match(text, /Sample Caterers[\s\S]*MENU[\s\S]*Sample Document Wedding[\s\S]*Menu version 2 · approved[\s\S]*Gulab Jamun/i);
    assert.doesNotMatch(text, /DRAFT/); assert.doesNotMatch(text, INTERNAL); assert.doesNotMatch(text, /₹/);
    await p.selectOption('#md-ver', 'draft'); await p.locator('#btn-md-print').click(); await p.waitForTimeout(300);
    assert.match((await printed()).text, /DRAFT – menu not yet approved by the client/);
    await p.selectOption('#md-ver', (await ev()).menuApproved[1].id);
    await p.locator('#btn-md-wa').click(); await p.waitForTimeout(200);
    const url = await p.evaluate(() => window.__opened.at(-1)), wa = decodeURIComponent(url.split('text=')[1]);
    assert.match(url, /^https:\/\/wa\.me\/919000000011\?text=|^https:\/\/wa\.me\/9000000011\?text=/);
    assert.match(wa, /^Menu for Sample Document Wedding – .*\n\nMenu version 2 · approved/); assert.doesNotMatch(wa, INTERNAL);
    assert.equal((await ev()).menuDocs, undefined, 'opening WhatsApp is not sending: nothing kept yet');
  });

  await test('"I have sent it" keeps the exact menu sent; printing it again after the menu changes shows the same menu', async () => {
    await p.locator('#btn-md-sent').click(); await p.waitForTimeout(600);
    const doc = (await ev()).menuDocs[0];
    assert.equal(doc.layout, 1); assert.match(doc.menu.label, /^Menu version 2/); assert.match(doc.text, /Gulab Jamun/);
    assert.equal(await p.locator('#md-issued [data-md-reprint]').count(), 1);
    await p.locator('#md-issued [data-md-reprint]').click(); await p.waitForTimeout(300);
    const first = (await printed()).text;
    await addDish('Rasmalai', 'dinner'); await approve('verbal');
    await openEvent(); await p.locator('[data-action="menu-send"]').click(); await p.waitForSelector('#md-modal.active');
    assert.match(await p.locator('#md-preview').innerText(), /Rasmalai/, 'the new menu is offered');
    await p.locator('#md-issued [data-md-reprint]').click(); await p.waitForTimeout(300);
    assert.equal((await printed()).text, first, 'the menu sent before prints exactly as it was');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  });

  await test('a menu sent before approval prints again with its DRAFT warning; an approved one without', async () => {
    await openEvent(); await p.locator('[data-action="menu-send"]').click(); await p.waitForSelector('#md-modal.active');
    await p.selectOption('#md-ver', 'draft'); await p.locator('#btn-md-sent').click(); await p.waitForTimeout(600);
    const docs = (await ev()).menuDocs;
    assert.equal(docs.at(-1).v, 'draft');
    const rows = p.locator('#md-issued [data-md-reprint]');
    await rows.first().click(); await p.waitForTimeout(300);   // newest first: the draft just sent
    assert.match((await printed()).text, /DRAFT – menu not yet approved by the client/);
    await rows.last().click(); await p.waitForTimeout(300);    // the approved version 2 sent earlier
    assert.doesNotMatch((await printed()).text, /DRAFT/);
  });

  await test('a quotation with a menu annexure never also lists the library menu\'s dishes; without one it does', async () => {
    const golden = await p.evaluate(async () => (await import('./utils.js')).menuById('golden').items);
    // A draft whose lunch line uses the Golden library menu, with "list each menu's dishes" on and the approved annexure
    await p.evaluate(async () => { const db = await import('./db.js'); const d = await db.exportAllData(); delete d.manifest; const e = d.events[0];
      e.quotes = e.quotes.filter(x => x.status !== 'draft');
      e.quotes.push({ v: 9, status: 'draft', lines: [{ kind: 'meal', meal: 'lunch', guests: 250, rate: 450, menu: 'golden' }], showRates: true, showItems: true, terms: '', annex: e.menuApproved.at(-1).id });
      delete e._rev; await db.importAllData(d, 'replace'); });
    await openQuote();
    await p.locator('[data-action="quote-print"]').click(); await p.waitForTimeout(300);
    const withAnnex = (await printed()).text, quotePart = withAnnex.slice(0, withAnnex.indexOf('Menu – annexure'));
    assert.match(quotePart, /Lunch – Golden menu[\s\S]*Dishes: see the menu annexure/);
    for (const n of golden.slice(0, 3)) assert.doesNotMatch(withAnnex, new RegExp(n.replace(/[()]/g, '.')), 'no library dish list beside the approved menu');
    assert.match(annexOf(withAnnex), /Gulab Jamun/, 'the dishes come from the approved event menu');
    await p.locator('[data-action="quote-share"]').click(); await p.waitForSelector('#ask-modal.active');
    const share = await p.locator('#ask-msg').innerText();
    for (const n of golden.slice(0, 3)) assert.doesNotMatch(share, new RegExp(n.replace(/[()]/g, '.')));
    assert.match(share, /— Menu —[\s\S]*Gulab Jamun/);
    await p.locator('#ask-actions button').last().click(); await p.waitForTimeout(300);
    await p.selectOption('#quote-annex', ''); await p.locator('[data-action="quote-print"]').click(); await p.waitForTimeout(300);
    const noAnnex = (await printed()).text;
    assert.match(noAnnex, new RegExp(golden[0].replace(/[()]/g, '.')), 'without an annexure the chosen library menu is listed, as before');
    assert.doesNotMatch(noAnnex, /annexure/);
  });

  await test('backups keep menus sent and quote annexures; malformed ones are refused', async () => {
    const r = await p.evaluate(async () => { const db = await import('./db.js'); const out = [];
      const d0 = await db.exportAllData(); delete d0.manifest;
      await db.importAllData(structuredClone(d0), 'replace');
      const now = (await db.exportAllData()).events[0];
      out.push(JSON.stringify([now.menuDocs, now.quotes]) === JSON.stringify([d0.events[0].menuDocs, d0.events[0].quotes]) ? 'kept' : 'lost');
      const md = d0.events[0].menuDocs[0], q2 = d0.events[0].quotes.find(x => x.v === 2);
      for (const bad of [e => { e.menuDocs = [{ ...md, menu: { ...md.menu, meals: [{ ...md.menu.meals[0], dishes: [{ name: 'x', head: 'Chaat' }] }] } }]; }, e => { e.menuDocs = 'x'; },
        e => { e.menuDocs = [{ ...md, layout: 'one' }]; }, e => { e.quotes.find(x => x.v === 2).annex = 5; }, e => { e.quotes.find(x => x.v === 2).snap = { ...q2.snap, annex: { label: 'x' } }; }]) {
        const d = structuredClone(d0); bad(d.events[0]);
        try { await db.importAllData(d, 'replace'); out.push('accepted'); } catch (e) { out.push(e.message.split('.')[0]); } }
      await db.importAllData(d0, 'replace'); return out; });
    assert.deepEqual(r, ['kept', 'Invalid menu sent to client', 'Invalid menu sent to client', 'Invalid menu sent to client', 'Invalid quote', 'Invalid quote']);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? 'client documents FAIL' : 'client documents PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('client documents FAIL'); process.exitCode = 1; });
