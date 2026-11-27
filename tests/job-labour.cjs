// 5.4.1 (owner, 27 Nov 2026): cooking labour (cooks, roti, starters / farsan, sweets, Chinese and other specialist cooks)
// comes per order, not per shift: e.g. 2 people for 2 Chinese items, paid a labour amount for the job plus transport.
// Rojiya, Ghati, Boys and the rest stay by shift. A by-order line saves its labour under the worker type and its
// transport under Transport, both owed to its contractor. Lines saved before keep their shifts and amounts.
// Synthetic sample data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const CHINESE = 'Chinese Cook – चायनीज आचारी', ROJIYA = 'Rojiya Labour – रोजीया मजूर', COOK = 'Cook – स्वयंपाकी', TRANSPORT = 'Transport – वाहतूक';
const EV = (id, name, extra = {}) => ({ id, name, date: day(2), venue: 'Sample Hall', type: 'Wedding – लग्न', billing: 100000, guests: 200, photoIds: [], ...extra });
const DATA = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  vendors: [{ id: 'cc', name: 'Sample Chinese Team', cat: 'Labour', specialty: CHINESE, phone: '9000000011' }, { id: 'rj', name: 'Sample Rojiya Mukadam', cat: 'Labour', specialty: ROJIYA }],
  events: [EV('E', 'Sample Function'),
    // saved before 5.4.1: a Cook line by shifts (2 shifts × ₹800)
    EV('O', 'Sample Older Function', { labour: { rows: [{ id: 'old1', role: COOK, rate: 800, counts: { f: 2 } }] } })] });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  const openEvent = async name => { await p.locator('#n-events:visible').click(); await p.waitForTimeout(300);
    await p.locator('#ev-list [data-action="evdetail"]', { hasText: name }).first().click(); await p.waitForSelector('#tab-evdetail.active'); };
  const line = i => p.locator(`#lab-rows [data-lab="${i}"]`);
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });
  await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA());
  await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' });

  await test('a shift worker keeps shifts; a cooking worker starts "by order" with people, labour for the job and transport', async () => {
    await openEvent('Sample Function'); await p.locator('[data-action="lab-edit"]').click(); await p.waitForSelector('#lab-modal.active');
    await line(0).locator('[data-k="role"]').selectOption(ROJIYA); await p.waitForTimeout(150);
    assert.equal(await line(0).locator('[data-lab-job]').count(), 0, 'Rojiya has no by-order choice');
    await line(0).locator('[data-k="c-f"]').fill('5'); await line(0).locator('[data-k="rate"]').fill('700');
    await p.locator('#btn-lab-add').click(); await p.waitForTimeout(150);
    await line(1).locator('[data-k="role"]').selectOption(CHINESE); await p.waitForTimeout(150);
    assert.equal(await line(1).locator('[data-lab-job][data-v="true"]').getAttribute('aria-pressed'), 'true', 'starts by order');
    assert.equal(await line(1).locator('[data-k^="c-"]').count(), 0, 'no shifts asked');
    await line(1).locator('[data-k="people"]').fill('2'); await line(1).locator('[data-k="rate"]').fill('3000'); await line(1).locator('[data-k="fare"]').fill('400');
    assert.match(await line(1).locator('[data-lab-line]').innerText(), /2 people · labour ₹3,000 \+ transport ₹400 = ₹3,400/);
    assert.match(await p.locator('#lab-total').innerText(), /₹6,900/, '5 × ₹700 + ₹3,400');
  });

  await test('saved: labour under the worker type and transport under Transport, both owed to the Chinese contractor', async () => {
    await p.locator('#btn-save-lab').click(); await p.waitForTimeout(700);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').first().click();
    const d = await dump(), mine = d.expenses.filter(x => x.evId === 'E').map(x => [x.head, x.amt, x.venId, x.pay]).sort();
    assert.deepEqual(mine, [[CHINESE, 3000, 'cc', 'credit'], [ROJIYA, 3500, 'rj', 'credit'], [TRANSPORT, 400, 'cc', 'credit']].sort());
    const row = d.events.find(e => e.id === 'E').labour.rows.find(r => r.role === CHINESE);
    assert.deepEqual([row.job, row.people, row.rate, row.fare], [true, 2, 3000, 400]);
  });

  await test('the labour card shows it by order, and the Chinese contractor is owed ₹3,400', async () => {
    const t = (await p.locator('#labour-card').innerText()).replace(/\s+/g, ' ');
    assert.match(t, /Chinese Cook .*By order · 2 people · labour ₹3,000 \+ transport ₹400 ₹3,400/);
    assert.match(t, /Total · 5 shifts ₹6,900/);
    assert.match(await p.locator('[data-lab-contractor="cc"] [data-lab-due]').innerText(), /₹3,400 to pay/);
  });

  await test('the WhatsApp list to the contractor asks for people, not shifts', async () => {
    const msg = await p.evaluate(() => new Promise(res => { setTimeout(() => res('no WhatsApp opened'), 3000); window.open = u => { res(decodeURIComponent(u)); return {}; }; document.querySelector('[data-action="lab-send"][data-id="cc"]').click(); }));
    assert.match(msg, /Chinese Cook: 2 people \(for the menu\)/);
  });

  await test('reopening keeps it by order; switching to By shift and back works', async () => {
    await p.locator('[data-action="lab-edit"]').click(); await p.waitForSelector('#lab-modal.active');
    const i = await p.locator('#lab-rows [data-lab]').evaluateAll((els, c) => els.findIndex(e => e.querySelector('[data-k="role"]').value === c), CHINESE);
    assert.equal(await line(i).locator('[data-k="people"]').inputValue(), '2');
    await line(i).locator('[data-lab-job][data-v="false"]').click(); await p.waitForTimeout(150);
    assert.ok(await line(i).locator('[data-k="c-f"]').count(), 'shift boxes shown');
    await line(i).locator('[data-lab-job][data-v="true"]').click(); await p.waitForTimeout(150);
    assert.equal(await line(i).locator('[data-k="fare"]').inputValue(), '400', 'values kept while switching');
    await p.locator('#lab-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(200);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
  });

  await test('a Cook line saved by shifts before stays by shifts with its amount', async () => {
    await openEvent('Sample Older Function');
    assert.match((await p.locator('#labour-card').innerText()).replace(/\s+/g, ' '), /Cook .*₹800 each ₹1,600/);
    await p.locator('[data-action="lab-edit"]').click(); await p.waitForSelector('#lab-modal.active');
    assert.equal(await line(0).locator('[data-lab-job][data-v="false"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await line(0).locator('[data-k="c-f"]').inputValue(), '2');
    await p.locator('#lab-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(200);
    if (await p.locator('#ask-modal.active').count()) await p.locator('#ask-actions button').last().click();
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'job-labour FAIL' : 'cooking labour by order, shift labour by shift PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('job-labour FAIL'); process.exit(1); });
