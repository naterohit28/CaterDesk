// G-19: user-entered text containing HTML/JS stays inert on every screen and form (no CSP in the
// test server, so nothing masks an injection). Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('assert/strict');

const X = n => `<img src=x onerror="window.__xss=${n}"><svg onload="window.__xss=${n}"></svg>"><b data-xss="${n}">x</b>`;
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // local date, as the app uses
const DATA = {
  version: 'ffv2', photos: [],
  vendors: [{ id: 'v1', name: X(1), cat: 'Live Counter', specialty: X(2), phone: '9000000001', notes: X(3) }, { id: 'p1', name: X(4), kind: 'person', notes: X(5) }],
  events: [{ id: 'e1', name: X(6), date: day(1), venue: X(7), type: X(8), billing: 100000, guests: 100, mobile: '9000000002', notes: X(9), photoIds: [], menu: 'golden', meals: ['lunch'],
    dishes: [{ name: X(10), head: 'Chaat – चाट' }, { name: X(11), head: '' }, { name: X(26), head: X(27) }],
    orders: [{ id: 'o1', head: 'Chaat – चाट', venId: 'v1', plates: 100, date: day(1), time: '19:00', notes: X(12), status: 'sent', at: new Date().toISOString() }],
    labour: { rows: [{ id: 'l1', role: 'Boys – बॉईज', rate: 600, counts: { e: 10 } }, { id: 'l2', kind: 'x', extra: 'other', label: X(13), count: 1, rate: 200 }], pay: 'credit', mode: '', venId: 'v1', expIds: {} } },
    { id: 'e2', name: X(14), date: day(-30), venue: X(15), type: 'Wedding – लग्न', billing: 50000, guests: 50, menu: 'golden', photoIds: [] }],
  expenses: [{ id: 'x1', evId: 'e1', cat: 'Live Counter', head: X(16), amt: 1000, date: day(0), pay: 'credit', venId: 'v1', notes: X(17), dueDate: day(3) },
    { id: 'x2', evId: 'e2', cat: 'Live Counter', head: 'Chaat – चाट', amt: 900, date: day(-30), pay: 'paid', venId: 'v1', notes: X(18) },
    { id: 'x3', evId: 'e1', cat: 'Live Counter', head: 'Chaat – चाट', amt: 1500, date: day(0), pay: 'paid', venId: 'v1', notes: X(19) },
    { id: 'd1', draft: true, evId: 'e1', date: day(0), amt: 0, cat: '', head: '', pay: 'paid', mode: '', venId: '', notes: X(20), billIds: [], createdAt: new Date().toISOString() }],
  cPays: [{ id: 'c1', evId: 'e1', amt: 1000, date: day(0), mode: X(21), notes: X(22) }],
  vPays: [{ id: 'vp1', venId: 'v1', amt: 100, date: day(0), mode: X(23), notes: X(24), head: X(25) }]
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
  // A fresh install starts empty: no demo or seed records are ever written (P1-D demo-seeding safety)
  const fresh = await p.evaluate(async () => { const db = await import('./db.js'); const u = await import('./utils.js'); const all = await db.exportAllData();
    return { records: ['events', 'expenses', 'vendors', 'cPays', 'vPays', 'photos'].reduce((n, k) => n + (all[k] || []).length, 0), seedExport: 'SEED_DATA' in u }; });
  assert.deepEqual(fresh, { records: 0, seedExport: false }, 'fresh install has no records and no seed data');
  await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); }, DATA);
  await p.reload(); await p.waitForSelector('#kpi .card');
  const injected = where => p.evaluate(where => {
    const bad = [...document.querySelectorAll('img[src="x"], svg[onload], [data-xss], [onerror], [onload]')].filter(el => !el.closest('script'));
    return { where, xss: window.__xss ?? null, elements: bad.map(el => el.outerHTML.slice(0, 80)), wider: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  }, where);
  const seen = [];
  const visit = async (where, steps) => { await steps(); await p.waitForTimeout(250); seen.push(await injected(where)); };
  const tap = sel => p.locator(sel + ':visible').first().click();
  const close = async () => {   // close every open sheet the way a user would, then wait for the page lock to clear
    for (let i = 0; i < 4 && await p.evaluate(() => document.documentElement.classList.contains('modal-open')); i++) {
      const x = p.locator('.modal-ov.active [data-action="close-modal"]:visible');
      await (await x.count() ? x.first() : p.locator('#ask-actions button:visible').last()).click({ timeout: 2000 }).catch(() => {});
      await p.waitForTimeout(250);
    }
    assert.equal(await p.evaluate(() => document.documentElement.classList.contains('modal-open')), false, 'sheet closed');
  };
  for (const t of ['home', 'events', 'expenses', 'vendors', 'summary']) await visit(t, async () => { await tap('#n-' + t); if (t === 'summary') await tap('#tab-summary [data-period-seg] [data-id="all"]'); });
  await visit('event page', async () => { await tap('#n-events'); await tap('#ev-list [data-action="evdetail"][data-id="e1"]'); });
  for (const [where, sel] of [['labour sheet', '[data-action="lab-edit"]'], ['menu', '[data-action="menu-edit"]'], ['order', '[data-action="order-new"]'], ['edit event', '#hdr-edit'], ['edit payment', '[data-action="edit-cpay"]']])
    await visit(where, async () => { await tap(sel); await p.waitForTimeout(200); }), await close(), await p.waitForTimeout(200);
  await visit('order status', async () => { await tap('[data-action="order-status"]'); }); await close();
  await visit('vendor page', async () => { await tap('#n-vendors'); await tap('#ven-list [data-action="vendetail"][data-id="v1"]'); });
  await visit('vendor payment', async () => { await tap('[data-action="edit-vpay"]'); }); await close(); await p.waitForTimeout(200);
  await visit('edit vendor', async () => { await tap('#hdr-edit'); }); await close(); await p.waitForTimeout(200);
  await visit('person page', async () => { await tap('#n-vendors'); await tap('#ven-list [data-action="vendetail"][data-id="p1"]'); });
  await visit('expense form', async () => { await tap('#n-expenses'); await tap('#exp-list [data-action="edit-exp"]'); }); await close(); await p.waitForTimeout(200);
  await visit('bill draft', async () => { await tap('#n-home'); await tap('[data-action="fill-draft"]'); }); await close(); await p.waitForTimeout(200);
  // Data rendered into links must be URL-encoded (WhatsApp messages, receipts, dues)
  await tap('#n-events'); await tap('#ev-list [data-action="evdetail"][data-id="e1"]');
  const hrefs = await p.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => /^https:\/\/wa\.me\//.test(h)));
  for (const h of hrefs) assert(!/[<>"]/.test(h), 'WhatsApp link carries raw markup: ' + h.slice(0, 80));
  const hits = seen.filter(s => s.xss !== null || s.elements.length || s.wider);
  console.log(hits.length ? 'Injected markup found:\n' + JSON.stringify(hits, null, 1) : `XSS canaries inert on ${seen.length} screens and forms`);
  assert.equal(hits.length, 0, 'user text must render as text and never widen the page');
  assert.deepEqual(errors, []);
  console.log('xss canary (G-19) PASS');
  await browser.close();
})().catch(e => { console.error(e); console.log('xss canary (G-19) FAIL'); process.exitCode = 1; });
