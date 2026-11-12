// D-2 strict redaction: error reports carry only fixed technical fields. Canary strings (a fake name, phone,
// amount and note) placed in error messages, stacks, URLs and extra fields must never be sent, logged or
// forwarded to the alert webhook. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const handler = require('../api/client-error.js');

const CANARIES = ['Canary Client Name', '9000099999', '987654', 'secret-note-xyz', 'CanaryVenue'];
const FIELDS = ['browser', 'code', 'column', 'file', 'kind', 'line', 'release'];
const clean = (what, text) => { for (const c of CANARIES) assert(!String(text).includes(c), `${what} leaked "${c}": ${String(text).slice(0, 160)}`); };

async function serverSide() {
  const logs = [], hooks = [];
  const realError = console.error, realWarn = console.warn, realFetch = global.fetch;
  console.error = (...a) => logs.push(a.join(' ')); console.warn = (...a) => logs.push(a.join(' '));
  global.fetch = async (url, opts) => { hooks.push(opts.body); return { ok: true }; };
  process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.invalid/canary';
  const call = async (body, headers = {}) => {
    const res = { code: 0, headers: {}, status(c) { this.code = c; return this; }, json() { return this; }, end() { return this; }, setHeader(k, v) { this.headers[k] = v; } };
    await handler({ method: 'POST', headers: { host: 'app.test', 'x-forwarded-for': '10.0.0.' + Math.floor(Math.random() * 250), ...headers }, body }, res);
    return res.code;
  };
  try {
    // An older app version (v4.0.2) sending free text: accepted but reduced to the allowed fields
    assert.equal(await call({ kind: 'error', message: `Cannot save Canary Client Name 9000099999 ₹987654`, stack: 'Error: secret-note-xyz\n at https://app.test/app.js?CanaryVenue:12:5',
      source: 'https://app.test/app.js', line: 12, column: 5, path: '/CanaryVenue', release: '4.0.2', userAgent: 'Mozilla/5.0 Canary Client Name', at: '2026-11-12' }), 204);
    // A forged report: every field abused, plus unknown fields
    assert.equal(await call(JSON.stringify({ kind: 'Canary Client Name', code: 'Canary Client Name 9000099999', file: '../secret-note-xyz.js', line: '987654', column: -1,
      release: '4.0.3 CanaryVenue', browser: 'secret-note-xyz', name: 'Canary Client Name', phone: '9000099999', events: [{ amt: 987654 }] })), 204);
    // A current-format report keeps its fields
    assert.equal(await call({ kind: 'unhandledrejection', code: 'TypeError', file: 'db.js', line: 40, column: 7, release: '4.0.3', browser: 'android-webview' }), 204);
    assert.equal(await call('not json'), 400);
    assert.equal(await call([1, 2]), 400);
    assert.equal(await call({ code: 'Error' }, { origin: 'https://evil.example' }), 403);
  } finally { console.error = realError; console.warn = realWarn; global.fetch = realFetch; delete process.env.ALERT_WEBHOOK_URL; }
  const reports = logs.filter(l => l.startsWith('[client-error] ')).map(l => JSON.parse(l.slice(15)));
  assert.equal(reports.length, 3);
  for (const r of reports) assert.deepEqual(Object.keys(r).sort(), FIELDS);
  assert.deepEqual(reports[0], { kind: 'error', code: 'Error', file: 'app.js', line: 12, column: 5, release: '4.0.2', browser: 'other' });
  assert.deepEqual(reports[1], { kind: 'error', code: 'Error', file: 'other', line: null, column: null, release: 'unknown', browser: 'other' });
  assert.deepEqual(reports[2], { kind: 'unhandledrejection', code: 'TypeError', file: 'db.js', line: 40, column: 7, release: '4.0.3', browser: 'android-webview' });
  assert.equal(hooks.length, 3, 'one alert per distinct error');
  for (const l of logs) clean('server log', l);
  for (const h of hooks) { clean('webhook', h); assert(!h.includes('hooks.example.invalid')); }
  console.log('diagnostics redaction, server: logs and alerts carry allow-listed fields only PASS');
}

async function clientSide() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    // Serve the app under a non-local test host so the reporter is active, and capture what it sends
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const sent = [];
    await ctx.route('https://caterdesk.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/client-error') { sent.push(route.request().postData() || ''); return route.fulfill({ status: 204 }); }
      const r = await fetch(BASE_URL + url.pathname);
      return route.fulfill({ status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'text/plain' }, body: Buffer.from(await r.arrayBuffer()) });
    });
    const p = await ctx.newPage(); p.setDefaultTimeout(8000);
    await p.goto('https://caterdesk.test/'); await p.waitForSelector('#kpi .card');
    await p.evaluate(() => {
      setTimeout(() => { throw new TypeError('Cannot read Canary Client Name 9000099999'); });
      Promise.reject(new RangeError('Amount 987654 for CanaryVenue'));
      Promise.reject('secret-note-xyz Canary Client Name');
      window.caterDeskErrorReporter.report(new Error('Handled: secret-note-xyz 9000099999'));
    });
    await p.waitForTimeout(800);
    assert(sent.length >= 4, 'reports sent: ' + sent.length);
    const parsed = sent.map(s => JSON.parse(s));
    for (const s of sent) clean('client report', s);
    for (const r of parsed) assert.deepEqual(Object.keys(r).sort(), FIELDS);
    assert(parsed.some(r => r.code === 'TypeError' && r.kind === 'error'));
    assert(parsed.some(r => r.code === 'RangeError' && r.kind === 'unhandledrejection'));
    assert(parsed.some(r => r.code === 'NonError'));
    assert(parsed.some(r => r.kind === 'handled'));
    assert(parsed.every(r => r.release === '4.0.3' && typeof r.browser === 'string'));
    await ctx.close();

    // On the local test server nothing is sent at all
    const local = await browser.newContext(); const lp = await local.newPage(); const posts = [];
    lp.on('request', r => { if (r.url().includes('/api/client-error')) posts.push(r.url()); });
    await lp.goto(BASE_URL); await lp.waitForSelector('#kpi .card');
    await lp.evaluate(() => { Promise.reject(new Error('local Canary Client Name')); window.caterDeskErrorReporter.report(new Error('x')); });
    await lp.waitForTimeout(400);
    assert.deepEqual(posts, []);
    const built = await lp.evaluate(() => window.caterDeskErrorReporter.build('handled', new Error('Canary Client Name 9000099999')));
    assert.deepEqual(Object.keys(built).sort(), FIELDS); clean('build()', JSON.stringify(built));
    console.log('diagnostics redaction, client: reports carry no message, stack, path or browser string PASS');
  } finally { await browser.close(); }
}

(async () => { await serverSide(); await clientSide(); })().catch(e => { console.error(e); console.log('diagnostics redaction FAIL'); process.exitCode = 1; });
