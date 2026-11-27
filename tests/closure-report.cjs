// 5.6.0 (owner's requirements): the event closing report. Built only from the existing calculations; event costs
// apart from whole supplier balances, common stock and expenses on no event; incomplete costs listed and the
// contribution marked provisional until reconciled. Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const X = (id, extra) => ({ id, date: day(-3), pay: 'paid', mode: 'UPI', billIds: [], ...extra });
const DATA = () => ({ version: 'ffv2', photos: [], vPays: [],
  vendors: [{ id: 'gs', name: 'Sample Grocer', cat: 'Raw Material' }, { id: 'rj', name: 'Sample Rojiya Mukadam', cat: 'Labour' }, { id: 'vf', name: 'Sample Frozen Foods', cat: 'Raw Material' }],
  events: [{ id: 'E', name: 'Sample Closing Wedding', date: day(-3), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 200, photoIds: [], budget: 50000,
      gst: { rate: 5, taxable: 100000, amount: 5000 }, quotes: [{ v: 1, status: 'accepted', lines: [{ kind: 'meal', meal: 'dinner', guests: 200, rate: 500 }], gst: { rate: 5, taxable: 100000 } }],
      purchases: [{ id: 'PO1', item: 'Spring Rolls', src: 'finish', venId: 'vf', qty: 10, unit: 'kg', date: day(-3), status: 'delivered', estCost: 3000 }] },
    { id: 'F', name: 'Sample Other Party', date: day(-10), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 40000, guests: 80, photoIds: [] }],
  cPays: [{ id: 'p1', evId: 'E', amt: 60000, date: day(-5), mode: 'UPI' }],
  expenses: [X('g1', { evId: 'E', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 20000, venId: 'gs', pay: 'credit', mode: '' }),
    X('l1', { evId: 'E', cat: 'Labour', head: 'Rojiya Labour – रोजीया मजूर', amt: 8000, venId: 'rj', pay: 'credit', mode: '' }),
    X('s1', { evId: 'E', cat: 'Operations', head: 'Transport – वाहतूक', amt: 1500, split: { id: 'SP', total: 3000 } }),
    X('s2', { evId: 'F', cat: 'Operations', head: 'Transport – वाहतूक', amt: 1500, split: { id: 'SP', total: 3000 } }),
    X('g2', { evId: 'F', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 5000, venId: 'gs', pay: 'credit', mode: '' }),
    X('st', { evId: '', cat: 'Raw Material', head: 'Oil / Ghee', amt: 4000, stock: true }),
    X('dr', { evId: 'E', draft: true, amt: 0 })] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });
  await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA());
  await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' });

  await test('the figures: event costs only, the shared bill part, supplier balance across events apart, provisional', async () => {
    const r = await p.evaluate(async () => { const u = await import('./utils.js'), db = await import('./db.js'); const d = await db.exportAllData();
      return u.closureReport(d.events.find(e => e.id === 'E'), d); });
    assert.equal(r.costs, 29500); assert.equal(r.contribution, 70500); assert.equal(r.margin, 71);
    assert.deepEqual([r.bill, r.gst, r.due, r.received, r.outstanding], [100000, 5000, 105000, 60000, 45000]);
    assert.deepEqual(r.suppliers.map(v => [v.name, v.amt, v.credit]), [['Sample Grocer', 20000, 20000]]);
    assert.deepEqual(r.contractors.map(v => [v.name, v.amt]), [['Sample Rojiya Mukadam', 8000]]);
    assert.deepEqual(r.shared, [{ head: 'Transport – वाहतूक', part: 1500, total: 3000 }]);
    assert.deepEqual(r.context.balances.map(b => [b.name, b.balance]), [['Sample Grocer', 25000], ['Sample Rojiya Mukadam', 8000]], 'whole balances, all events');
    assert.deepEqual([r.context.stock, r.context.unallocated], [4000, 0]);
    assert.equal(r.provisional, true); assert.equal(r.recon, 'pending');
    assert.ok(r.open.some(o => o.kind === 'nobill') && r.open.some(o => o.kind === 'drafts'), JSON.stringify(r.open));
    assert.deepEqual(r.perPlate, { bill: 500, cost: 148, contribution: 353 });
  });

  await test('the report on the event page: provisional, readable sections, nothing outside the event added', async () => {
    await p.locator('#n-events:visible').click(); await p.waitForTimeout(300);
    await p.locator('#ev-list [data-action="evdetail"][data-id="E"]:visible').first().click(); await p.waitForSelector('#tab-evdetail.active');
    await p.locator('[data-action="close-open"]').click(); await p.waitForSelector('#closing-modal.active');
    const t = await p.locator('#close-text').innerText();
    for (const re of [/EVENT CLOSING REPORT – Sample Closing Wedding/, /Status: Not reconciled yet · figures are PROVISIONAL/, /Quotation v1, accepted: ₹1,00,000 \+ GST ₹5,000/,
      /Final bill \(income\): ₹1,00,000/, /Client pays: ₹1,05,000/, /Received: ₹60,000 \(1 payment\)/, /Outstanding: ₹45,000/, /Total costs: ₹29,500/,
      /Sample Grocer: ₹20,000 \(₹20,000 on credit\)/, /Transport: ₹1,500 of ₹3,000/, /Expected cost \(budget\): ₹50,000 · actual ₹29,500 · ₹20,500 under/,
      /Contribution \(provisional\): ₹70,500 · margin 71%/, /STILL OPEN[^]*Delivered, bill not recorded: Spring Rolls \(Sample Frozen Foods\)[^]*1 bill photo not filled in/,
      /FOR REFERENCE – NOT COUNTED IN THIS EVENT\n- Sample Grocer: ₹25,000 owed in total \(all events\)[^]*Common stock, not given to any event: ₹4,000$/]) assert.match(t, re, t);
    assert.equal(await p.locator('#close-note .due-note').count(), 1);
    await p.evaluate(() => { window.__shared = []; navigator.share = x => { window.__shared.push(x); return Promise.resolve(); }; });
    await p.locator('[data-action="close-share"]').click(); await p.waitForTimeout(300);
    assert.equal((await p.evaluate(() => window.__shared[0]?.text)), t, 'shares exactly what is shown');
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'closure-report FAIL' : 'event closing report PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('closure-report FAIL'); process.exit(1); });
