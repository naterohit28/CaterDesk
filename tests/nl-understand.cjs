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
    assert.deepEqual([r.kind, r.guests, r.advance, r.amount, r.bill], ['event', 300, 25000, 25000, 0], 'no bill said: none set');
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

  await test('CTO review: negation, cancellation, money still to be paid', async () => {
    const r = await U(['Gas 1200 cash nahi diya', 'Client ne 2000 nahi diya', 'Ramesh ko 5000 UPI mat dena', 'गॅस 1200 रोख दिले नाही', 'पैसे नको देऊ 5000', 'Gas 1200 order cancel', 'Ramesh ko 5000 dena hai', 'kal 3000 dunga']);
    assert.deepEqual(r.map(x => [x.kind, x.reason]), [['unclear', 'negative'], ['unclear', 'negative'], ['unclear', 'negative'], ['unclear', 'negative'], ['unclear', 'negative'], ['unclear', 'cancel'], ['unclear', 'future'], ['unclear', 'future']]);
  });

  await test('CTO review: several amounts are never reduced to the largest; one Indian number stays one', async () => {
    const r = await U(['Gas 1200 cash aur sabzi 4500 cash', 'Gas 1200 aur sabzi 4500', 'do hazaar aur paanch sau gas', 'Ramesh 10 hazaar 500']);
    assert.deepEqual(r.map(x => [x.kind, x.amounts || x.amount]), [['multi', [1200, 4500]], ['multi', [1200, 4500]], ['expense', 2500], ['expense', 10500]], '"10 hazaar 500" is ₹10,500');
  });

  await test('CTO review: phone, bill and written-date numbers are never money', async () => {
    const r = await U(['New supplier name Raj phone 9876543210', 'Naya supplier Raj phone +91 98765 43210', 'Gas bill no 1452 amount 1200 cash', 'Sabzi 4500 cash 12/11', 'Ramesh 9876543210 ko 2000 diye']);
    assert.deepEqual([r[0].kind, r[0].name, r[0].phone, r[0].amount], ['vendor', 'Raj', '9876543210', 0]);
    assert.deepEqual([r[1].phone, r[1].amount], ['9876543210', 0]);
    assert.deepEqual([r[2].amount, r[2].ref], [1200, '1452']);
    assert.deepEqual([r[3].amount, r[3].txDate, r[3].dateCheck], [4500, '2026-11-12', true], 'a written date is the date of the entry, to check (no year said)');
    assert.deepEqual([r[4].kind, r[4].amount], ['payven', 2000]);
  });

  await test('CTO review: credit with a way of paying, or two ways of paying: nothing chosen', async () => {
    const r = await U(['Gas 1200 udhar UPI', 'Gas 1200 credit cash', 'Gas 1200 cash or UPI']);
    assert.deepEqual([r[0].pay, r[0].payConflict, r[1].pay, r[1].payConflict], ['', true, '', true]);
    assert.deepEqual([r[2].mode, r[2].modeConflict, r[2].ask.includes('mode')], ['', ['UPI', 'Cash – रोख'], true]);
  });

  await test('CTO review: venue and locality find the event; a stated day that conflicts chooses nothing; transaction date', async () => {
    const ctx = { ...CTX, events: [...CTX.events, { id: 'M', name: 'Sample Joshi Reception', date: '2026-11-27', venue: 'MLA Hall', locality: 'Nerul' }] };
    const r = await U(['MLA Hall sabzi 4500 cash', 'Nerul gas 1200 cash', 'Kulkarni 1200 gas udya', 'Kal gas ka 1500 cash diya', 'Sabzi ka 4500 cash diya'], ctx);
    assert.deepEqual([r[0].event.id, r[1].event.id], ['M', 'M']);
    assert.deepEqual([r[2].event.id, r[2].event.dateConflict, r[2].event.candidates.map(e => e.id)], ['', true, ['K']]);
    assert.deepEqual([r[3].txDate, r[3].dateCheck, r[3].daySaid], ['2026-11-27', true, true]);
    assert.deepEqual([r[4].txDate, r[4].daySaid, r[4].unknownWords], ['', false, []]);
  });

  await test('CTO review: workers asked for or came', async () => {
    const r = await U(['Dinner ke liye 15 boys bulana', 'उद्या डिनरसाठी 15 बॉईज पाहिजे', 'Dinner mein 12 boys aaye', 'डिनरला 12 वेटर आले', 'Dinner 15 boys']);
    assert.deepEqual(r.map(x => [x.kind, x.count, x.labour]), [['labour', 15, 'asked'], ['labour', 15, 'asked'], ['labour', 12, 'came'], ['labour', 12, 'came'], ['labour', 15, 'asked']]);
  });

  await test('CTO review: the twenty phone acceptance sentences (understanding only)', async () => {
    const r = await U(['Sabzi ka saadhe chaar hazaar cash diya', 'पनीरचे साडेआठ हजार उधार आहेत', 'Tempo ka dedh hazaar GPay kiya', 'MLA Hall ka gas 1200 cash', 'Client ne sava lakh advance diya',
      'Ramesh ko paanch hazaar diye', 'Gas 1200 cash nahi diya', 'Client ne abhi advance nahi diya', 'Sabzi 4500 udhar UPI', 'Gas 1200 aur sabzi 4500', 'Kal Vashi mein 100 plates ka birthday hai',
      'उद्या डिनरसाठी 15 बॉईज पाहिजे', 'Dinner mein 12 boys aaye', 'Chinese ke liye noodles Manchurian, do log', 'Kirana 25 kilo rice aur 10 kilo sugar', 'Bread ki 5 ladi mangao',
      'Chaat 300 plates order karo', 'Dinner 350 se 400 plates ho gaya', 'Naya supplier Raj phone 9876543210', 'Kal gas ka 1500 cash diya']);
    const got = r.map(x => [x.kind, x.amount || 0]);
    assert.deepEqual(got, [['expense', 4500], ['expense', 8500], ['expense', 1500], ['expense', 1200], ['cpay', 125000], ['payven', 5000], ['unclear', 1200], ['unclear', 0], ['expense', 4500], ['multi', 0],
      ['event', 0], ['labour', 0], ['labour', 0], ['cook', 0], ['order', 0], ['order', 0], ['order', 0], ['guests', 0], ['vendor', 0], ['expense', 1500]]);
    assert.deepEqual([r[0].pay, r[1].pay, r[1].head.head, r[2].mode, r[2].pay, r[5].ask.includes('mode'), r[8].payConflict, r[10].dateCheck, r[11].labour, r[12].labour],
      ['paid', 'credit', 'Milk & Dairy – दूध व दुग्धजन्य पदार्थ', 'UPI', 'paid', true, true, true, 'asked', 'came']);
    assert.deepEqual([r[15].items, r[16].counter, r[16].items[0].name, r[17].from, r[17].to, r[18].phone, r[19].txDate],
      [[{ name: 'Bread', qty: 5, unit: 'ladi' }], true, 'Chaat', 350, 400, '9876543210', '2026-11-27']);
  });

  await test('audit: Marathi and English payees, refunds, money still to come, Marathi negation, a bill to be made', async () => {
    const r = await U(['रमेशला पाच हजार यूपीआय दिले', 'रमेशला दोन हजार ॲडव्हान्स रोख दिले', 'Paid Ramesh 5000 by UPI', 'Gas 1200 cash refunded', 'ग्राहक से 5000 आने वाले हैं', 'गॅसचे 1200 रोख दिले नाहीत', 'Patil ko 25000 bill banana']);
    assert.deepEqual(r.slice(0, 3).map(x => [x.kind, x.amount, x.vendor.id, !!x.advance]), [['payven', 5000, 'ram', false], ['payven', 2000, 'ram', true], ['payven', 5000, 'ram', false]]);
    assert.deepEqual(r.slice(3).map(x => [x.kind, x.reason]), [['unclear', 'refund'], ['unclear', 'future'], ['unclear', 'negative'], ['unclear', 'document']]);
  });

  await test('audit: a bill amount is money, a bill number is not; a booking keeps its bill and its advance apart', async () => {
    const r = await U(['Patil gas bill 1200 paid cash', 'Patil client receipt 20000 cash', 'Gas bill no 1452 1200 cash', 'Gas invoice INV-88 1200 cash', 'Birthday tomorrow at Vashi, 50 guests, bill 25000, advance 5000 cash']);
    assert.deepEqual([r[0].kind, r[0].amount, r[0].pay, r[0].head.head], ['expense', 1200, 'paid', 'Gas / Cylinder – सिलिंडर']);
    assert.deepEqual([r[1].kind, r[1].amount, r[1].mode], ['cpay', 20000, 'Cash – रोख']);
    assert.deepEqual([r[2].amount, r[2].ref, r[3].amount, r[3].ref], [1200, '1452', 1200, 'inv-88']);
    assert.deepEqual([r[4].kind, r[4].bill, r[4].advance, r[4].guests, r[4].date], ['event', 25000, 5000, 50, '2026-11-29']);
  });

  await test('audit: Indian numbers 0–99 in Hindi and Marathi, joined Marathi hundreds, fractions', async () => {
    assert.deepEqual(await A(['सवा लाख', 'सत्ताईस सौ', 'चौदह सौ', 'पैंतालीस सौ', 'सत्तावीसशे', 'चौदाशे', 'पाचशे', 'अडीचशे', 'निन्यानवे हजार', 'नव्व्याण्णव हजार', 'chhattis sau', 'paintalis sau', '2490.29']),
      [125000, 2700, 1400, 4500, 2700, 1400, 500, 250, 99000, 99000, 3600, 4500, 2490.29]);
    const r = await U(['पंधरा वेटर पाहिजे डिनरसाठी', 'पंद्रह वेटर बुलाओ डिनर', 'पाऊण किलो पनीर मागवा', 'अर्धा किलो तूप मागवा', 'सव्वा किलो साखर मागवा', 'दीड लिटर दूध मागवा', 'अडीच किलो कांदा मागवा', 'दोन डझन केळी मागवा', 'पाच लडी पाव मागवा']);
    assert.deepEqual([r[0].count, r[1].count], [15, 15]);
    assert.deepEqual(r.slice(2).map(x => x.items.map(i => [i.qty, i.unit])[0]), [[0.75, 'kg'], [0.5, 'kg'], [1.25, 'kg'], [1.5, 'litre'], [2.5, 'kg'], [2, 'dozen'], [5, 'ladi']]);
  });

  await test('audit: calendar dates in English, Hindi and Marathi; a year is never money', async () => {
    const r = await U(['New birthday at Vashi on 12 Dec 2026 for 100 guests', '12 नवंबर को वाशी में 100 प्लेट की शादी', '१२ डिसेंबरला वाशीत 100 पाहुण्यांचे लग्न', 'Gas 1200 cash on 25 nov', 'gas 1200 cash 12/11/2026', 'gas 1200 cash 20 tarikh']);
    assert.deepEqual([r[0].kind, r[0].date, r[0].dateCheck, r[0].amount], ['event', '2026-12-12', undefined, 0]);
    assert.deepEqual([r[1].kind, r[1].date, r[1].dateCheck], ['event', '2027-11-12', true], 'no year: the next 12 November, to check');
    assert.deepEqual([r[2].kind, r[2].date, r[2].guests], ['event', '2026-12-12', 100]);
    assert.deepEqual([r[3].amount, r[3].txDate, r[4].txDate, r[5].txDate, r[5].dateCheck], [1200, '2026-11-25', '2026-11-12', '2026-11-20', true]);
  });

  await test('phone test (28 Nov 2026): what the phone actually heard', async () => {
    const r = await U(['vegetables of Rs 2500 paid by cash', 'ped 5000 to Ramesh by upi', 'पाटिल शादी के लिए पनीर के 8:30 हजार रुपए उधार', 'पाटील लग्नासाठी शे भाडी भाजीचे साडेचार हजार रोग दिले',
      'रमेश ला दोन हजार रुपये ऍडव्हान्स रोग घेतले', 'कल वाशी में सो प्लेट का बर्थडे है', 'new supplier Raj new supplier Raj phone number 9867 543 210', 'गॅस शे 1200 दिले नाहीत', 'ग्राहक के 5000 आने वाले हैं']);
    assert.deepEqual([r[0].kind, r[0].amount, r[0].pay, r[0].mode], ['expense', 2500, 'paid', 'Cash – रोख'], '"paid by cash" names nobody');
    assert.deepEqual([r[1].kind, r[1].amount, r[1].vendor.candidates.map(v => v.id), r[1].mode], ['payven', 5000, ['ram'], 'UPI'], '"ped" is paid');
    assert.deepEqual([r[2].kind, r[2].amount, r[2].pay, r[2].event.id], ['expense', 8500, 'credit', 'P'], '"8:30 हजार" = ₹8,500');
    assert.deepEqual([r[3].kind, r[3].amount, r[3].pay, r[3].mode], ['expense', 4500, 'paid', 'Cash – रोख'], '"रोग" heard for रोख');
    assert.deepEqual([r[4].kind, r[4].amount, r[4].advance, r[4].vendor.candidates.map(v => v.id)], ['payven', 2000, true, ['ram']], 'रमेश ला … ऍडव्हान्स … घेतले');
    assert.deepEqual([r[5].kind, r[5].guests], ['event', 100], '"सो प्लेट" = 100 plates');
    assert.deepEqual([r[6].kind, r[6].phone, r[6].amount, r[6].name], ['vendor', '9867543210', 0, 'Raj'], 'a phone said in groups is never money');
    assert.deepEqual([r[7].kind, r[8].kind], ['unclear', 'unclear']);
  });

  await test('several expenses in one sentence are split into entries; nothing dropped, no item word carried over', async () => {
    const r = await U(['Gas 1200 cash aur sabzi 4500 cash', 'gas 1200 cash aur sabzi 4500 cash Patil ke liye', 'गॅस 1200 रोख आणि भाजी 4500 रोख, टेम्पो 800 यूपीआय', 'Patil client ne 5000 advance diya aur 2000 balance diya']);
    assert.deepEqual(r[0].parts.map(p => [p.amount, p.head]), [[1200, 'Gas / Cylinder – सिलिंडर'], [4500, 'Vegetable – भाजी']]);
    assert.deepEqual(r[1].parts.map(p => [p.amount, p.head, p.event]), [[1200, 'Gas / Cylinder – सिलिंडर', 'P'], [4500, 'Vegetable – भाजी', 'P']]);
    assert.deepEqual(r[2].parts.map(p => p.amount), [1200, 4500, 800]);
    assert.deepEqual([r[3].kind, r[3].parts], ['multi', undefined], 'a receipt with a payment is not split');
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
