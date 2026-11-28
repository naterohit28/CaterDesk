// v6.0-A: understanding one typed or spoken sentence (nl.js). Pure: nothing is saved here, the result only proposes.
// The reviewer's target sentences, the Stage 0 phone sentences and the prototype review sentences are regression
// tests; so are the v6 safety rules (paid/credit never guessed, an advance is never the bill, two matches are asked).
// Synthetic sample names only.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const CTX = { today: '2026-11-28',
  events: [{ id: 'P', name: 'Sample Patil Wedding', date: '2026-11-29' }, { id: 'D', name: 'Sample Desai Reception', date: '2026-11-29' },
    { id: 'K', name: 'Sample Kulkarni Pooja', date: '2026-11-28' }],
  vendors: [{ id: 'bos', name: 'Bay of Snacks', cat: 'Live Counter', specialty: 'Starter – स्टार्टर' },
    { id: 'veg', name: 'Sample Bhaji Supplier', cat: 'Raw Material', specialty: 'Vegetable – भाजी' },
    { id: 'gro', name: 'Sample Kirana Store', cat: 'Raw Material', specialty: 'Grocery – किराणा' },
    { id: 'ram', name: 'Ramesh Mukadam', cat: 'Labour', specialty: 'Boys – बॉईज' },
    { id: 'sh1', name: 'Sample Shinde Tempo', cat: 'Operations', specialty: 'Transport – वाहतूक' },
    { id: 'sh2', name: 'Sample Shinde Tempo', cat: 'Operations', specialty: 'Transport – वाहतूक' }] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await browser.newPage(); p.setDefaultTimeout(10000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(name + ' PASS'); } catch (e) { failed++; console.error(e); console.log(name + ' FAIL'); } };
  await p.goto(BASE_URL); await p.waitForSelector('#kpi', { state: 'attached' });
  const U = (texts, ctx = CTX) => p.evaluate(async ([t, c]) => { const nl = await import('./nl.js'); return t.map(x => nl.understand(x, c)); }, [texts, ctx]);
  const A = texts => p.evaluate(async t => { const nl = await import('./nl.js'); return t.map(x => nl.amountOf(x)); }, texts);

  await test('Indian amounts: digits, words, thousand/hazaar/lakh, dedh, adhai, sade, साडेआठ, 8:30 hajar', async () => {
    assert.deepEqual(await A(['4500', '₹2,490', 'Rs. 2490.50', '50 thousand', '10 hazaar', 'dedh lakh', 'adhai hazar', 'sade aath hazaar', 'साडेआठ हजार',
      '8:30 hajar', 'eight thousand five hundred', 'teen sau pachas', '२५०० रुपये', '2.5k', 'do hazaar', 'sava do lakh', 'paune teen hazaar', 'दीड हजार']),
    [4500, 2490, 2490.5, 50000, 10000, 150000, 2500, 8500, 8500, 8500, 8500, 350, 2500, 2500, 2000, 225000, 2750, 1500]);
  });

  await test('guests, quantities, workers, times, dates and rates are not the money amount', async () => {
    assert.deepEqual(await A(['300 guests ke liye 45000 advance', '25 kilo rice 1500', '15 boys 9000', '7 baje 2000 cash', '12 dec ko 5000', 'rate 450 per plate 200 plates', 'kar do 500']),
      [45000, 1500, 9000, 2000, 5000, 0, 500]);
  });

  await test('the reviewer\'s ten target sentences', async () => {
    const r = await U(['Sabzi ka 4500 cash diya', 'Bay of Snacks ka 2490 udhaar hai', 'Client ne 50 thousand advance diya', 'Ramesh ko 10 hazaar diye',
      'Kal Vashi mein 100 plates ka birthday hai', 'Dinner ke liye 15 boys bulana', 'Chinese ke liye noodles aur Manchurian, 2 log',
      'Kirana wale ko 25 kilo rice aur 10 kilo sugar', 'Dinner 350 se 400 plates ho gaya', 'Naya vegetable supplier add karo']);
    assert.deepEqual([r[0].kind, r[0].amount, r[0].pay, r[0].mode, r[0].head.head], ['expense', 4500, 'paid', 'Cash – रोख', 'Vegetable – भाजी'], 'paid vegetables');
    assert.deepEqual([r[1].kind, r[1].amount, r[1].pay, r[1].vendor.id, r[1].vendor.sure], ['expense', 2490, 'credit', 'bos', true], 'credit with that supplier');
    assert.deepEqual([r[2].kind, r[2].amount, r[2].advance, r[2].ask.includes('mode')], ['cpay', 50000, true, true], 'client receipt, mode asked');
    assert.deepEqual([r[3].kind, r[3].alt, r[3].amount, r[3].vendor.candidates.map(v => v.id), r[3].vendor.sure], ['payven', 'expense', 10000, ['ram'], false], 'possible settlement, confirmed');
    assert.deepEqual([r[4].kind, r[4].type, r[4].guests, r[4].date, r[4].dateCheck, r[4].venue], ['event', 'Birthday – वाढदिवस', 100, '2026-11-29', true, 'Vashi'], 'quick event; Hindi "kal" checked');
    assert.deepEqual([r[5].kind, r[5].role, r[5].count, r[5].meal], ['labour', 'Boys – बॉईज', 15, 'dinner'], 'shift labour need');
    assert.deepEqual([r[6].kind, r[6].role, r[6].people, r[6].dishes], ['cook', 'Chinese Cook – चायनीज आचारी', 2, ['Noodles', 'Manchurian']], 'cooking assignment');
    assert.deepEqual([r[7].kind, r[7].items, r[7].vendor.candidates.map(v => v.id)], ['order', [{ name: 'Rice', qty: 25, unit: 'kg' }, { name: 'Sugar', qty: 10, unit: 'kg' }], ['gro']], 'multi-item order');
    assert.deepEqual([r[8].kind, r[8].from, r[8].to, r[8].meal, r[8].amount], ['guests', 350, 400, 'dinner', 0], 'guest change for approval');
    assert.deepEqual([r[9].kind, r[9].cat, r[9].specialty, r[9].ask], ['vendor', 'Raw Material', 'Vegetable – भाजी', ['name']], 'vendor form');
  });

  await test('Stage 0 phone sentences: romanised and Devanagari Marathi', async () => {
    const [a, b] = await U(['Patil lagnasathi bhajiwala 8:30 hajar udhar', 'पाटील लग्नासाठी भाजीवाल्याला साडेआठ हजार उधार']);
    assert.deepEqual([a.kind, a.amount, a.event.id, a.head.head, a.pay, a.payHint], ['expense', 8500, 'P', 'Vegetable – भाजी', '', 'credit'], '"udhar" may be misheard: hint, then ask');
    assert.deepEqual([b.kind, b.amount, b.event.id, b.head.head, b.pay], ['expense', 8500, 'P', 'Vegetable – भाजी', 'credit'], 'पाटील matches Patil; उधार is clear');
  });

  await test('prototype review sentences: advances, tokens, payments to, labour with a rate, counter orders', async () => {
    const r = await U(['received 25000 via UPI as advance', 'advance received 25000', 'client gave 10000 token', 'Paid 4500 to Ghati contractor by UPI',
      'Add labour 5 waiters for Patil wedding rate 1000', 'Order 100 dosa plates and 50 chaat plates for Patil wedding', 'Received 25000 advance from Desai by UPI']);
    assert.deepEqual(r.slice(0, 3).map(x => [x.kind, x.amount, x.advance]), [['cpay', 25000, true], ['cpay', 25000, true], ['cpay', 10000, true]]);
    assert.deepEqual([r[3].kind, r[3].who, r[3].mode, r[3].head.head], ['payven', 'Ghati Contractor', 'UPI', 'Ghati – घाटी']);
    assert.deepEqual([r[4].kind, r[4].count, r[4].rate, r[4].event.id, r[4].amount], ['labour', 5, 1000, 'P', 0], 'a rate is not an expense');
    assert.deepEqual([r[5].kind, r[5].counter, r[5].items.map(i => [i.name, i.qty, i.unit])], ['order', true, [['Dosa', 100, 'plates'], ['Chaat', 50, 'plates']]]);
    assert.deepEqual([r[6].kind, r[6].event.id, r[6].mode], ['cpay', 'D', 'UPI']);
  });

  await test('paid or credit is never guessed: "paid" needs how; nothing said leaves it to the user', async () => {
    const r = await U(['Add 8500 vegetable expense for Patil wedding', 'Sabzi ka 4500 diya', 'gas 1200 baki', 'tempo 900 upi', 'मासे 3000 उधार']);
    assert.deepEqual(r.map(x => [x.kind, x.pay, x.payHint || '', x.ask.includes('pay')]),
      [['expense', '', '', true], ['expense', '', '', true], ['expense', '', 'credit', true], ['expense', 'paid', '', false], ['expense', 'credit', '', false]]);
  });

  await test('an advance with a booking is a client payment after the event, never the bill', async () => {
    const [r] = await U(['Book Sample Joshi wedding 300 guests at Vashi kal, 25000 advance received']);
    assert.deepEqual([r.kind, r.guests, r.advance, r.amount, r.bill], ['event', 300, 25000, 25000, undefined]);
  });

  await test('two events or two vendors that fit are asked about, never the first one picked', async () => {
    const [a, b, c] = await U(['udya ke liye 10 boys', 'Shinde tempo 2000 cash', 'Desai aur Patil dono ke liye 3000 tempo']);
    assert.deepEqual([a.event.id, a.event.candidates.map(e => e.id).sort(), a.ask.includes('event')], ['', ['D', 'P'], true]);
    assert.deepEqual([b.vendor.id, b.vendor.candidates.length], ['', 2]);
    assert.deepEqual([c.event.id, c.event.candidates.length], ['', 2]);
  });

  await test('Marathi and Hindi words for workers, meals, cooks and events', async () => {
    const r = await U(['आज 20 वेटर पाहिजे डिनरसाठी', 'चायनीज साठी नूडल्स आणि मंचुरियन 2 जण', 'उद्या वाशी मध्ये 150 ताट वाढदिवस', 'कुलकर्णी पूजेसाठी गॅस सिलिंडर 1200 रोख दिले']);
    assert.deepEqual([r[0].kind, r[0].count, r[0].meal, r[0].event.id], ['labour', 20, 'dinner', 'K']);
    assert.deepEqual([r[1].kind, r[1].people, r[1].dishes.length], ['cook', 2, 2]);
    assert.deepEqual([r[2].kind, r[2].guests, r[2].date, r[2].venue], ['event', 150, '2026-11-29', 'वाशी']);
    assert.deepEqual([r[3].kind, r[3].amount, r[3].pay, r[3].event.id, r[3].head.head], ['expense', 1200, 'paid', 'K', 'Gas / Cylinder – सिलिंडर']);
  });

  await test('Hindi in Devanagari, as the phone’s Hindi speech recognition writes it (ज़ and ज alike)', async () => {
    const r = await U(['सब्ज़ी का 4500 कैश दिया', 'क्लाइंट ने 50 हज़ार एडवांस दिया', 'रमेश को 10 हज़ार दिए', 'कल वाशी में 100 प्लेट का बर्थडे है', 'डिनर के लिए 15 वेटर बुलाना',
      'चाइनीज़ के लिए नूडल्स और मंचूरियन, 2 लोग', 'किराना वाले को 25 किलो चावल और 10 किलो चीनी', 'डिनर 350 से 400 प्लेट हो गया']);
    assert.deepEqual([r[0].kind, r[0].amount, r[0].pay, r[0].head.head], ['expense', 4500, 'paid', 'Vegetable – भाजी']);
    assert.deepEqual([r[1].kind, r[1].amount, r[1].advance], ['cpay', 50000, true]);
    assert.deepEqual([r[2].kind, r[2].vendor.candidates.map(v => v.id)], ['payven', ['ram']], 'रमेश matches Ramesh');
    assert.deepEqual([r[3].kind, r[3].type, r[3].guests, r[3].venue], ['event', 'Birthday – वाढदिवस', 100, 'वाशी']);
    assert.deepEqual([r[4].kind, r[4].count, r[4].meal], ['labour', 15, 'dinner']);
    assert.deepEqual([r[5].kind, r[5].role, r[5].people, r[5].dishes.length], ['cook', 'Chinese Cook – चायनीज आचारी', 2, 2]);
    assert.deepEqual([r[6].kind, r[6].items.map(i => [i.qty, i.unit]), r[6].supplies], ['order', [[25, 'kg'], [10, 'kg']], 'Grocery – किराणा']);
    assert.deepEqual([r[7].kind, r[7].from, r[7].to, r[7].amount], ['guests', 350, 400, 0]);
  });

  await test('nothing understood: the review asks, nothing is made up', async () => {
    const r = await U(['', 'hello', 'kar do']);
    assert.deepEqual(r.map(x => [x.kind, x.amount, x.ask]), [['unknown', 0, ['amount']], ['unknown', 0, ['amount']], ['unknown', 0, ['amount']]]);
  });

  await test('no page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(failed ? 'nl-understand FAIL' : 'sentence understanding PASS');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); console.log('nl-understand FAIL'); process.exit(1); });
