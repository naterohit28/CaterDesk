// The permanent multilingual corpus (tests/corpus/voice-corpus.json, 100 sentences each in English, Hindi, Marathi and
// Hinglish), understood by public/nl.js inside the app and scored per language and per field (tests/corpus/score.cjs).
// Release gates (multilingual audit, 28 Nov 2026): at least 95% of sentences fully right in every language, and zero
// safety violations (completed money where none may be made, a wrong amount, wrong paid/credit, an event or vendor
// picked that is not the one meant, a phone number read as money, workers asked for treated as came).
// Every future change to sentence understanding (v6.5, v7...) must keep this green. Synthetic data only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const corpus = require('./corpus/voice-corpus.json');
const { score, table } = require('./corpus/score.cjs');

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

  await test('the corpus has 100 sentences in each of English, Hindi, Marathi and Hinglish', async () => {
    assert.deepEqual(Object.fromEntries(Object.entries(r.by).map(([l, v]) => [l, v.n])), { en: 100, hi: 100, mr: 100, hg: 100 });
  });

  await test('zero safety violations', async () => {
    assert.deepEqual(r.bad, []);
  });

  for (const lang of ['en', 'hi', 'mr', 'hg'])
    await test(`${lang}: at least 95% of sentences fully right`, async () => {
      const L = r.by[lang];
      assert.ok(L.all.pass >= 95, `${L.all.pass}/100 right:\n` + r.wrong.filter(w => w.id.startsWith(lang + '-')).map(w => `${w.id} | ${w.text} | want ${JSON.stringify(w.expect)} | got ${JSON.stringify(w.got)}`).join('\n'));
    });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'voice-corpus FAIL' : 'multilingual corpus PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('voice-corpus FAIL'); process.exit(1); });
