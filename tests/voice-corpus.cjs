// The permanent multilingual corpora, understood by public/nl.js inside the app (tests/corpus/score.cjs):
// - voice-corpus.json: 104 sentences each in English, Hindi, Marathi and Hinglish, scored per language and per field;
// - independent-140.json: the owner's reviewer's own 140 commands (35 per language), kept separate and scored by its own notes.
// Release gates (multilingual audits, 28 Nov 2026): at least 95% of sentences fully right in every language of both sets,
// and zero safety violations: completed money where none may be made, a wrong amount, the wrong kind of money entry
// (expense / settlement / receipt), wrong paid/credit, a wrong way of paying, a wrong date on money, a booking's bill or
// advance wrong, an event or vendor picked that is not the one meant, a phone number read as money, or workers asked for
// treated as came. Every future change to sentence understanding (v6.5, v7...) must keep this green. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const corpus = require('./corpus/voice-corpus.json');
const independent = require('./corpus/independent-140.json');
const { score, table, scoreIndependent } = require('./corpus/score.cjs');
const LANGS = ['en', 'hi', 'mr', 'hg'];

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await browser.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });
  const results = await p.evaluate(async c => { const nl = await import('./nl.js'); return c.sentences.map(s => nl.understand(s.text, c.context)); }, corpus);
  const r = score(corpus, results);
  console.log(table(r));
  const ires = await p.evaluate(async c => { const nl = await import('./nl.js'); return c.sentences.map(s => nl.understand(s.text, c.contexts[s.context])); }, independent);
  const ir = scoreIndependent(independent, ires);
  console.log('independent 140: ' + Object.entries(ir.by).map(([l, v]) => `${l} ${v.pass}/${v.n}`).join('  '));
  const list = (ws, lang) => ws.filter(w => w.id.startsWith(lang + '-')).map(w => `${w.id} | ${w.text} | ${(w.fields || []).join(',')} | want ${JSON.stringify(w.expect)} | got ${JSON.stringify(w.got)}`).join('\n');

  await test('the corpus has 104 sentences in each of English, Hindi, Marathi and Hinglish', async () => {
    assert.deepEqual(Object.fromEntries(Object.entries(r.by).map(([l, v]) => [l, v.n])), { en: 104, hi: 104, mr: 104, hg: 104 });
  });
  await test('zero safety violations', async () => { assert.deepEqual(r.bad, []); });
  for (const lang of LANGS)
    await test(`${lang}: at least 95% of sentences fully right`, async () => {
      const L = r.by[lang]; assert.ok(L.all.pass >= Math.ceil(0.95 * L.n), `${L.all.pass}/${L.n} right:\n${list(r.wrong, lang)}`);
    });

  await test('independent 140: 35 per language, zero safety violations', async () => {
    assert.deepEqual(Object.fromEntries(Object.entries(ir.by).map(([l, v]) => [l, v.n])), { en: 35, hi: 35, mr: 35, hg: 35 });
    assert.deepEqual(ir.bad, []);
  });
  for (const lang of LANGS)
    await test(`independent 140, ${lang}: at least 95% right`, async () => {
      const L = ir.by[lang]; assert.ok(L.pass >= Math.ceil(0.95 * L.n), `${L.pass}/${L.n}:\n${list(ir.wrong, lang)}`);
    });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'voice-corpus FAIL' : 'multilingual corpus PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('voice-corpus FAIL'); process.exit(1); });
