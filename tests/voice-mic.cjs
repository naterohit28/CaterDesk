// v6.0-C: the page microphone in "Type it in words". A stand-in speech engine replaces the browser's (a test browser
// cannot hear), so this checks CaterDesk's side: the button only where speech recognition exists and the phone is
// online; the privacy note before first use; the chosen language is used and remembered; what is heard goes into the
// text box and is understood like typed text; errors say what to do; offline points to the keyboard's 🎤; closing the
// sheet stops listening; nothing is saved from speech. Real speech on Android is checked on the phone. Synthetic data.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const DATA = () => ({ version: 'ffv2', photos: [], cPays: [], vPays: [], expenses: [],
  events: [{ id: 'P', name: 'Sample Patil Wedding', date: iso(0), type: 'Wedding – लग्न', venue: 'Sample Lawns', billing: 100000, guests: 200, photoIds: [] }],
  vendors: [{ id: 'veg', name: 'Sample Bhaji Supplier', cat: 'Raw Material', specialty: 'Vegetable – भाजी' }] });
// The stand-in: records each start (language, settings) and plays back what the test scripts for it
const FAKE = () => {
  window.__mic = { starts: [], script: { final: 'Patil lagnasathi bhajiwala', final2: '8:30 hajar udhar' }, error: '' };
  window.SpeechRecognition = class { constructor() { this.lang = ''; }
    start() { window.__mic.starts.push({ lang: this.lang, interim: this.interimResults, continuous: this.continuous }); const m = window.__mic;
      setTimeout(() => { if (m.error) { this.onerror?.({ error: m.error }); this.onend?.(); return; }
        const r = (t, fin) => Object.assign([{ transcript: t }], { isFinal: fin });
        this.onresult?.({ resultIndex: 0, results: [r(m.script.final, false)] });
        this.onresult?.({ resultIndex: 0, results: [r(m.script.final, true), r(m.script.final2, true)] });
        if (!m.hold) this.onend?.(); else window.__micObj = this; }, 50); }
    stop() { setTimeout(() => this.onend?.(), 10); } abort() { window.__mic.aborted = true; } };
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 } });
  await ctx.addInitScript(FAKE);
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  const dump = () => p.evaluate(async () => (await import('./db.js')).exportAllData());
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });
  await p.evaluate(async d => { await (await import('./db.js')).importAllData(d, 'replace'); }, DATA());
  await p.reload(); await p.waitForSelector('#kpi', { state: 'attached' });
  const open = async () => {
    for (let i = 0; i < 3 && await p.locator('.modal-ov.active').count(); i++) { await p.locator('.modal-ov.active [data-action="close-modal"]').first().click(); await p.waitForTimeout(250); }
    await p.locator('[data-action="quick"][data-id="say"]').click(); await p.waitForSelector('#say-modal.active'); };

  await test('online with speech recognition: the 🎤 button, the privacy note before first use; other languages behind a link', async () => {
    await open();
    assert.equal(await p.locator('#say-mic-row').isVisible(), true);
    assert.match(await p.locator('#say-mic-note').innerText(), /keeps no audio/);
    assert.equal(await p.locator('#say-lang').isVisible(), false, 'no language to choose each time (phone test)');
    await p.locator('#btn-say-langs').click();
    assert.deepEqual(await p.locator('#say-lang button').allInnerTexts(), ['English', 'हिंदी', 'मराठी']);
  });

  await test('speaking fills the text box and shows what was understood; nothing is saved', async () => {
    await p.locator('#say-lang [data-say-lang="mr-IN"]').click();
    await p.locator('#btn-say-mic').click(); await p.waitForTimeout(400);
    assert.equal(await p.inputValue('#say-text'), 'Patil lagnasathi bhajiwala 8:30 hajar udhar');
    const t = await p.locator('#say-result').innerText(); assert.match(t, /I understood/); assert.match(t, /₹8,500/);
    const s = await p.evaluate(() => window.__mic.starts.at(-1)); assert.deepEqual(s, { lang: 'mr-IN', interim: true, continuous: false });
    assert.equal(await p.locator('#say-mic-note').innerText(), '', 'the note is shown until the microphone is first used');
    assert.equal((await dump()).expenses.length, 0, 'nothing saved from speech');
  });

  await test('the microphone listens in the app language: English, मराठी, English–मराठी, हिंदी; a one-off choice is not kept', async () => {
    const langOf = async mode => { await p.evaluate(async m => (await import('./i18n.js')).setLang(m), mode); await open();
      await p.locator('#btn-say-mic').click(); await p.waitForTimeout(300); return p.evaluate(() => window.__mic.starts.at(-1).lang); };
    assert.deepEqual([await langOf('en'), await langOf('mr'), await langOf('both'), await langOf('hi')], ['en-IN', 'mr-IN', 'mr-IN', 'hi-IN']);
    await p.evaluate(async () => (await import('./i18n.js')).setLang('en'));
  });

  await test('blocked microphone or no network: says what to do, keyboard 🎤 offered', async () => {
    await open(); await p.evaluate(() => { window.__mic.error = 'not-allowed'; });
    await p.locator('#btn-say-mic').click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#say-mic-note').innerText(), /blocked for CaterDesk[^]*keyboard's 🎤/);
    await p.evaluate(() => { window.__mic.error = 'network'; }); await p.locator('#btn-say-mic').click(); await p.waitForTimeout(300);
    assert.match(await p.locator('#say-mic-note').innerText(), /No connection to the speech service/);
    await p.evaluate(() => { window.__mic.error = ''; });
  });

  await test('closing the sheet while listening stops the microphone', async () => {
    await open(); await p.evaluate(() => { window.__mic.hold = true; window.__mic.aborted = false; });
    await p.locator('#btn-say-mic').click(); await p.waitForTimeout(200);
    assert.equal(await p.locator('#btn-say-mic').getAttribute('aria-pressed'), 'true');
    await p.locator('#say-modal [data-action="close-modal"]').first().click(); await p.waitForTimeout(300);
    assert.equal(await p.evaluate(() => window.__mic.aborted), true);
    await p.evaluate(() => { window.__mic.hold = false; });
  });

  await test('CTO: results that arrive after the sheet was closed, or after a language switch, change nothing', async () => {
    await open(); await p.evaluate(() => { window.__mic.hold = true; });
    await p.locator('#btn-say-mic').click(); await p.waitForTimeout(150);
    await p.locator('#btn-say-langs').click(); await p.locator('#say-lang [data-say-lang="en-IN"]').click(); await p.waitForTimeout(100);   // switching stops the old session
    await p.evaluate(() => { const o = window.__micObj; o.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'Gas 9999 cash' }], { isFinal: true })] }); o.onend?.(); });
    await p.waitForTimeout(200);
    assert.doesNotMatch(await p.inputValue('#say-text'), /9999/, 'a stale session cannot write'); assert.equal(await p.locator('#btn-say-go').count(), 0);
    await p.evaluate(() => { window.__mic.hold = false; });
  });

  await test('CTO: going to the background stops listening and keeps what was already heard', async () => {
    await open(); await p.fill('#say-text', 'Patil'); await p.evaluate(() => { window.__mic.hold = true; window.__mic.aborted = false; });
    await p.locator('#btn-say-mic').click(); await p.waitForTimeout(250);   // the stand-in has delivered its final words and holds
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(150);
    assert.equal(await p.evaluate(() => window.__mic.aborted), true);
    assert.equal(await p.inputValue('#say-text'), 'Patil Patil lagnasathi bhajiwala 8:30 hajar udhar', 'typed text and heard words kept');
    await p.evaluate(() => { delete document.hidden; window.__mic.hold = false; });
  });

  await test('offline: no page microphone; the keyboard 🎤 is suggested', async () => {
    await ctx.setOffline(true); await open();
    assert.equal(await p.locator('#say-mic-row').isVisible(), false);
    assert.match(await p.locator('#say-mic-note').innerText(), /Offline: tap 🎤 on your keyboard/);
    await ctx.setOffline(false);
  });

  await test('a browser without speech recognition: the keyboard 🎤 is suggested', async () => {
    await p.evaluate(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; }); await open();
    assert.equal(await p.locator('#say-mic-row').isVisible(), false);
    assert.match(await p.locator('#say-mic-note').innerText(), /tap 🎤 on your keyboard/);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'voice-mic FAIL' : 'voice microphone PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('voice-mic FAIL'); process.exit(1); });
