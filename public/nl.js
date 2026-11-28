/**
 * nl.js — v6.0-A: understanding one typed or spoken sentence (English, Hindi, Marathi, Hinglish).
 *
 * Pure functions: no screen, no database, no saving and no outside service. understand() only PROPOSES what the
 * sentence probably means; the review screen shows it and the normal forms check and save it (v6 rules in
 * docs/PRODUCT_ROADMAP.md):
 * - paid or credit is never guessed: a clear word (credit, उधार) may pre-select credit, "paid" counts only together
 *   with how (cash, UPI…), a word that may be misheard (उधर, baki) only hints and asks;
 * - an advance is a client payment, never the bill;
 * - two events or two vendors that fit are always asked about, never the first one picked;
 * - amounts arrive as digits, words, "50 thousand", "dedh hazaar", "साडेआठ हजार" or "8:30 hajar" (= ₹8,500).
 */
import { EXPENSE_HEADS, HEAD_WORDS, PAY_MODES } from './utils.js';

/* ── Shared vocabulary (one place for v6 voice and typed entry) ── */
const W = s => s.split(' ');
export const VOCAB = {
  credit: W('credit udhaar udhaari udhari udhaar उधार उधारी khate khata क्रेडिट खाते'),
  creditUnsure: W('udhar उधर baki baaki बाकी later baad'),          // may be a mishearing: hint only, ask
  give: W('diya diye di dila dile dili दिले दिला दिली दिया दिए दी paid pay payment chukaya'),
  receive: W('मिल मिला मिली मिले मिलें आया आए जमा received receive recieved mila mile mili milaa milale milala मिळाले मिळाला मिली मिला मिले jama जमा got collected aaya aaye aale आले'),
  advance: W('advance advans token bayana bayana isar isaar इसार ॲडव्हान्स अ‍ॅडव्हान्स एडवांस'),
  client: W('client clients grahak ग्राहक customer क्लाइंट क्लायंट कस्टमर पार्टी'),
  order: W('ऑर्डर मंगाओ मंगवाओ भेजो चाहिए order mangao mangwao mangwa mangva mangvo magva मागवा मंगवाओ bhejo bhej pathav pathva पाठवा send chahiye pahije पाहिजे'),
  newWord: W('naya nayi naye new navin navina नवीन नया नई नये न्यू'),
  vendorWord: W('supplier vendor contractor mukadam dukan dukaandar wala wale vala vale wali सप्लायर वेंडर व्हेंडर ठेकेदार मुकादम दुकानदार वाला वाले'),
  add: W('add jodo jod joda जोडा karo kar ऐड जोड़ो करो'),
  bulana: W('bulana bulao chahiye pahije बुलाना बुलाओ'),
  today: W('aaj aj today आज'), tomorrow: W('udya udyaa tomorrow उद्या'), yesterday: W('kaal yesterday काल'), kal: W('kal कल'),
  ka: W('ka ke ki का के की cha chi che चा ची चे'),
  // Not done, or not to be done (CTO review, v6.0): never a completed transaction
  neg: W("nahi nahin nahi nai nhi not dont don't didnt didn't never mat नहीं नही नाही नको मत नाय"),
  cancel: W('cancel cancelled canceled radd रद्द band बंद'),
  // Still to happen: a plan or a promise, not money that has moved
  future: W('dena dene deni denge dunga dungi dega degi dyayche dyaycha dyaychi dyayla dena_hai देना देने देंगे दूंगा दूँगा देगा देणार द्यायचे द्यायचा will shall karenge karna'),
  attended: W('aaye aaya aayi aye aale ale aali came attended present hajar haazir hazir हजर हाजिर आले आलेत आए आये आई'),
  plan: W('bulana bulao chahiye chahie pahije need needed required book पाहिजे चाहिए बुलाना बुलाओ हवे'),
  // Words that say what kind of entry it is but name nothing; with these and the vocabulary above, a word left over may
  // be a name the app does not know (a venue, a person), so the event is never guessed from "today" then
  plain: W('expense kharcha kharch kharchi खर्च paisa paise paise money bill bills payment pay paid hisab hisaab total entry record amount rs name naam number add kar karo kiya kiye ki kya hai hain he aahe आहे आहेत है हैं tha thi the hua hui ho gaya gayi zala zale abhi aata आता ab'),
  forWord: W('liye sathi saathi साठी लिए लिये for'),
  to: W('ko को la ला to'),
  join: W('aur and ani आणि और'),
  at: W('mein me mai madhe madhye मध्ये में at in'),
  change: W('se to ते वरून varun से'),
  changed: W('ho hua zale zala झाले झाला kar karo badha badhao vadha increase kam reduce हो गया हुआ बढ़ा बढा कम'),
};
const MODE_WORDS = [['UPI', 'upi gpay googlepay phonepe paytm bhim यूपीआय यूपीआई गूगलपे फोनपे पेटीएम'], ['Cash – रोख', 'cash nakad naqad rokh rokda रोख नकद कॅश कैश कॅश'],
  ['NEFT', 'neft rtgs imps'], ['Cheque – चेक', 'cheque check चेक'], ['Bank – बँक', 'bank transfer बँक']];
const MEAL_WORDS = [['breakfast', 'breakfast nashta nasta नाश्ता नाश्त्याला ब्रेकफास्ट'], ['lunch', 'lunch dopahar dupar दुपार लंच'], ['hightea', 'hightea high-tea tea chai'],
  ['dinner', 'dinner raat ratri रात्री रात डिनर'], ['latenight', 'latenight midnight']];
const EVENT_WORDS = [['Wedding – लग्न', 'wedding shaadi shadi lagna lagn लग्न शादी vivah वेडिंग विवाह'], ['Engagement – साखरपुडा', 'engagement sagai sakharpuda साखरपुडा सगाई एंगेजमेंट'],
  ['Reception – स्वागत समारंभ', 'reception रिसेप्शन'], ['Haldi – हळद', 'haldi हळद mehendi mehndi sangeet'], ['Birthday – वाढदिवस', 'birthday bday vadhdivas वाढदिवस janamdin बर्थडे जन्मदिन'],
  ['Anniversary – वर्धापनदिन', 'anniversary'], ['Corporate – कॉर्पोरेट', 'corporate office seminar conference'],
  ['Pooja / religious – पूजा', 'pooja puja पूजा satyanarayan havan हवन'], ['Other – इतर', 'party function karyakram कार्यक्रम event booking barsa बारसे munj पार्टी फंक्शन इवेंट बुकिंग']];
// Worker words → labour types (shift labour); cooking roles are assigned per job, not per shift
const WORKERS = [['Boys – बॉईज', 'boys boy waiter waiters ladke service वेटर बॉईज बॉयज मुले लड़के'], ['Ghati – घाटी', 'ghati घाटी'], ['Rojiya Labour – रोजीया मजूर', 'rojiya रोजीया मजूर'],
  ['Helper Staff', 'helper helpers हेल्पर'], ['Cleaner / Washing', 'cleaner cleaners washing bhandiwale'], ['Supervisor', 'supervisor captain'],
  ['Security – सुरक्षा', 'security guard guards watchman']];
const COOKS = [['Chinese Cook – चायनीज आचारी', 'chinese चायनीज चाइनीज'], ['Sweet Labour – मिठाई मजूर', 'sweet sweets mithai मिठाई halwai हलवाई'],
  ['Roti Cook (Puri / Phulka) – पोळी आचारी', 'roti puri phulka poli पोळी chapati रोटी पूरी फुलका चपाती'], ['Starter / Farsan Labour – स्टार्टर / फरसाण मजूर', 'starter starters farsan'],
  ['Cook – स्वयंपाकी', 'cook cooks aachari आचारी maharaj महाराज bawarchi swaypaki कुक रसोइया बावर्ची']];
const COOK_WORDS = new Set(COOKS.flatMap(([, w]) => w.split(' ')));
const PEOPLE = W('log logo people persons person jan jana janan जण जणं लोक लोग manus माणसं आदमी');
const GUESTS = W('plates plate pax guests guest thali ताट पाहुणे mehman प्लेट प्लेटें प्लेट्स गेस्ट मेहमान');
const UNITS = { kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', killo: 'kg', किलो: 'kg', litre: 'litre', litres: 'litre', liter: 'litre', liters: 'litre', ltr: 'litre', लिटर: 'litre',
  packet: 'packet', packets: 'packet', pkt: 'packet', puda: 'packet', bottle: 'bottle', bottles: 'bottle', carton: 'carton', cartons: 'carton', khoka: 'carton',
  tub: 'tub', tubs: 'tub', box: 'box', boxes: 'box', dozen: 'dozen', darjan: 'dozen', डझन: 'dozen', ladi: 'ladi', लडी: 'ladi', nag: 'pcs', pcs: 'pcs', piece: 'pcs', pieces: 'pcs', नग: 'pcs' };
const TIME_AFTER = W('baje bajey vajta vajata वाजता बजे pm am');
const DATE_NEAR = W('tarikh तारीख jan feb mar apr may jun jul aug sep oct nov dec january february march april june july august september october november december');
const RATE_BEFORE = W('rate @ per each dar दर');
const STOP = new Set(W('ka ke ki ko ne la ne se me mein hai he ho tha the aur and ani the a an of for to liye sathi saathi wala wale vala vale wali please plz bhai ji'));

/* ── Numbers ── */
const NUMW = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  ek: 1, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5, pach: 5, chhe: 6, che: 6, saha: 6, saat: 7, sat: 7, aath: 8, ath: 8, nau: 9, nav: 9, das: 10, daha: 10,
  gyarah: 11, barah: 12, pandrah: 15, bees: 20, vees: 20, pachees: 25, pachchis: 25, tees: 30, chalis: 40, pachas: 50, pannas: 50, saath: 60, sattar: 70, assi: 80,
  एक: 1, दोन: 2, दो: 2, तीन: 3, चार: 4, पाच: 5, पाँच: 5, पांच: 5, सहा: 6, छह: 6, सात: 7, आठ: 8, नऊ: 9, नौ: 9, दहा: 10, दस: 10, वीस: 20, बीस: 20, तीस: 30, पन्नास: 50, पचास: 50 };
const NUM_AMBIG = { do: 2, don: 2 };   // "kar do" is not two: a number only before a multiplier or a count word
const MULT = { hundred: 100, sau: 100, so: 100, shambhar: 100, सौ: 100, शंभर: 100, thousand: 1000, thousands: 1000, hazar: 1000, hazaar: 1000, hajar: 1000, hajaar: 1000,
  hazzar: 1000, hazaa: 1000, हजार: 1000, हज़ार: 1000, k: 1000, lakh: 100000, lakhs: 100000, lac: 100000, lacs: 100000, लाख: 100000, crore: 10000000, करोड: 10000000 };
const word = t => NUMW[t] ?? (/^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : undefined);
const r2 = v => Math.round(v * 100) / 100;

export function normalise(text) {
  let s = String(text || '').normalize('NFKC').replace(/\u093C/g, '').toLocaleLowerCase()
    .replace(/[०-९]/g, c => '०१२३४५६७८९'.indexOf(c))
    .replace(/(\d),(?=\d)/g, '$1')
    .replace(/₹|\brs\.?(?=\s*\d)|\brupees?\b|\brupaye\b|\brupaiye\b|रुपये|रुपए|रु\./g, ' ')
    .replace(/(\d)\s*k\b/g, '$1 k').replace(/(\d)(?=[a-zऀ-ॿ])/g, '$1 ')
    .replace(/[“”"!?;()]/g, ' ');
  // the keyboard's 🎤 turns "साडेआठ हजार" into "8:30 hajar"
  s = s.replace(/\b(\d+):30\s*(?=(hajar|hajaar|hazar|hazaar|thousand|हजार|हज़ार|lakh|लाख)\b)/g, (_, a) => ` ${Number(a) + 0.5} `);
  // sade / साडे n = n½, sava / सव्वा n = n¼, paune / पावणे n = n−¼, dedh = 1½, adhai = 2½ (also written joined: साडेआठ)
  s = s.replace(/(?:\bsava|\bsavva|सव्वा)\s+(?=(?:lakh|lac|लाख|hazar|hazaar|hajar|thousand|हजार|सौ|sau)(?![\p{L}\p{M}]))/gu, ' 1.25 ')
    .replace(/(?:\bpaune|\bpavne|पावणे|पौने)\s+(?=(?:lakh|lac|लाख|hazar|hazaar|hajar|thousand|हजार)(?![\p{L}\p{M}]))/gu, ' 0.75 ');
  const frac = (re, d) => { s = s.replace(re, (m, n) => { const v = word(n) ?? NUM_AMBIG[n]; return v === undefined ? m : ` ${v + d} `; }); };
  frac(/(?:\bsade|\bsaade|\bsadhe|\bsaadhe|साडे|साढ़े|साढे)\s*([a-z]+|\d+|[ऀ-ॿ]+)/g, 0.5);
  frac(/(?:\bsava|\bsavva|सव्वा)\s*([a-z]+|\d+|[ऀ-ॿ]+)/g, 0.25);
  frac(/(?:\bpaune|\bpavne|\bpaavne|पावणे|पौने)\s*([a-z]+|\d+|[ऀ-ॿ]+)/g, -0.25);
  s = s.replace(/(?:\bdedh\b|\bdeedh\b|डेढ़|डेढ|दीड)/g, ' 1.5 ').replace(/(?:\badhai\b|\bdhai\b|\badich\b|ढाई|अडीच)/g, ' 2.5 ');
  return s.replace(/[,.:](?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
}
const tokens = s => s.split(' ').filter(Boolean);
/* Numbers that are never money, taken out first (CTO review, v6.0): a mobile number ("9876543210", "+91 98765 43210"),
   a bill / invoice / receipt / challan / order number ("bill no 1452"), and a written date ("12/11", "12-11-2026").
   They are kept for the review (a phone for a new vendor; a date to be checked), never added to an amount. */
export function prep(text) {
  let s = normalise(text); const phones = [], refs = [], dates = [];
  s = s.replace(/(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, m => { phones.push(m.replace(/\D/g, '').slice(-10)); return ' '; });
  s = s.replace(/\b(?:bill|invoice|inv|receipt|ref|reference|challan|pavti|पावती|बिल)\s*(?:no|number|num|nos|#|क्रमांक|नंबर)?\s*#?\s*([a-z]{0,4}\d[\w/-]*)/g, (m, r) => { refs.push(r); return ' '; });
  s = s.replace(/\border\s*(?:no|number|#)\s*#?\s*([a-z]{0,4}\d[\w/-]*)/g, (m, r) => { refs.push(r); return ' '; });
  s = s.replace(/#\s*(\d[\w/-]*)/g, (m, r) => { refs.push(r); return ' '; });
  s = s.replace(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/g, m => { dates.push(m); return ' '; });
  return { s: s.replace(/\s+/g, ' ').trim(), phones, refs, dates };
}

// Every number in the sentence with where it sits: "two thousand five hundred", "50 thousand", "teen sau pachas"
export function numbers(textOrToks) {
  const toks = Array.isArray(textOrToks) ? textOrToks : tokens(normalise(textOrToks));
  const out = []; let cur = null, total = 0, start = -1, last = Infinity, words = true;
  const flush = end => { if (start >= 0) out.push({ v: r2(total + (cur ?? 0)), start, end, words }); cur = null; total = 0; start = -1; last = Infinity; words = true; };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i], nx = toks[i + 1];
    let n = word(t);
    if (n === undefined && NUM_AMBIG[t] !== undefined && nx && (MULT[nx] || PEOPLE.includes(nx) || GUESTS.includes(nx) || UNITS[nx])) n = NUM_AMBIG[t];
    if (n !== undefined) {
      const digit = /\d/.test(t);
      if (start < 0) { start = i; cur = n; words = !digit; continue; }
      if (cur === null && n < last) { cur = n; words = words && !digit; continue; }                       // "2 thousand 500"
      if (cur !== null && cur >= 100 && cur % 100 === 0 && n < 100 && !digit) { cur += n; continue; }      // "five hundred fifty"
      if (cur !== null && cur >= 20 && cur < 100 && cur % 10 === 0 && n < 10 && !digit) { cur += n; continue; }   // "twenty five"
      flush(i - 1); start = i; cur = n; words = !digit; continue;
    }
    if (MULT[t] && start >= 0) { const m = MULT[t];
      if (m === 100) cur = (cur ?? 1) * 100; else { total += (cur ?? 1) * m; cur = null; last = m; }
      words = false; continue; }
    if (VOCAB.join.includes(t) && start >= 0 && total > 0 && word(nx) !== undefined) continue;
    flush(i - 1);
  }
  flush(toks.length - 1);
  return out;
}

// What a number is about, from the word right after it (or "rate" just before it)
function numberRole(toks, g) {
  const nx = toks[g.end + 1] || '', pv = toks[g.start - 1] || '', pv2 = toks[g.start - 2] || '';
  if (GUESTS.includes(nx)) return 'guests';
  if (PEOPLE.includes(nx)) return 'people';
  if (UNITS[nx]) return 'qty';
  if (WORKERS.some(([, w]) => w.split(' ').includes(nx)) || COOKS.some(([, w]) => w.split(' ').includes(nx))) return 'workers';
  if (TIME_AFTER.includes(nx)) return 'time';
  if ((DATE_NEAR.includes(nx) || DATE_NEAR.includes(pv)) && g.v >= 1 && g.v <= 31) return 'date';
  if (RATE_BEFORE.includes(pv) || (pv === 'plate' && RATE_BEFORE.includes(pv2))) return 'rate';
  if ((nx === 'per' || nx === 'each') ) return 'rate';
  return 'money';
}

// The money amount: the largest number that is not guests, a quantity, workers, a time, a date or a rate
export function amountOf(text) {
  const toks = tokens(prep(text).s), gs = numbers(toks);
  const money = gs.filter(g => numberRole(toks, g) === 'money' && !(g.words && g.v < 10));
  return money.length ? Math.max(...money.map(g => g.v)) : 0;
}

/* ── Matching records ── */
const norm = v => String(v || '').normalize('NFKC').replace(/\u093C/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const has = (toks, list) => toks.some(t => list.includes(t));
// Word endings that hide the word: bhajiwala, भाजीवाल्याला, lagnasathi, पाटलांच्या
const SUFFIX = /(?:walyala|walyakade|walyane|wala|wale|wali|vala|vale|valyala|sathi|saathi|chya|cha|chi|che|kade|ne|la|वाल्याला|वाल्याकडे|वाल्याने|वाला|वाले|वाली|वाल्या|साठी|च्या|चा|ची|चे|कडे|ने|ला|ना)$/;
export const stem = t => { let x = t, y; for (let i = 0; i < 3 && (y = x.replace(SUFFIX, '')) !== x && y.length >= 2; i++) x = y; return x; };
// A rough sound skeleton, the same for "Patil" and "पाटील", "Kulkarni" and "कुलकर्णी": consonants only
const DEV = { क: 'k', ख: 'k', ग: 'g', घ: 'g', च: 'c', छ: 'c', ज: 'j', झ: 'j', ट: 't', ठ: 't', ड: 'd', ढ: 'd', ण: 'n', त: 't', थ: 't', द: 'd', ध: 'd', न: 'n',
  प: 'p', फ: 'p', ब: 'b', भ: 'b', म: 'm', र: 'r', ल: 'l', ळ: 'l', व: 'v', श: 's', ष: 's', स: 's', ञ: 'n', ङ: 'n', 'ं': 'n' };
const isDev = t => /[ऀ-ॿ]/.test(t);
export const skeleton = t => isDev(t) ? [...t.normalize('NFD')].map(c => DEV[c] || '').join('').replace(/(.)\1+/g, '$1')
  : t.replace(/([kgcjtdpbs])h/g, '$1').replace(/f/g, 'p').replace(/w/g, 'v').replace(/z/g, 'j').replace(/[aeiouyh]/g, '').replace(/(.)\1+/g, '$1');
// Does a word of a name appear in the sentence (also with an ending, or in the other script)?
const nameIn = (w, toks) => toks.some(x => { const sx = stem(x);
  if (x === w || sx === w || (w.length >= 4 && x.startsWith(w) && x.length - w.length <= 6)) return true;
  const a = skeleton(w), b = skeleton(sx);
  return isDev(w) !== isDev(x) && a.length >= 2 && a === b; });
const starts = (toks, list) => toks.some(t => list.some(w => w.length >= 4 ? t.startsWith(w) : t === w));
const pick = (toks, table) => (table.find(([, w]) => starts(toks, w.split(' '))) || [''])[0];
const GENERIC = new Set(W('sample the and new event wedding lagna party function caterers caterer foods food enterprises traders trader stores store shop supplier vendor contractor services service hall halls lawn lawns banquet banquets ground garden gardens club hotel resort mandir temple society sabhagruh karyalay mangal complex road nagar'));

// Hindi words in Devanagari, as the phone's Hindi speech recognition writes them (HEAD_WORDS has English and Marathi)
const HINDI_HEADS = { 'Vegetable': 'सब्जी सब्जियां सब्जीवाला प्याज आलू टमाटर', 'Grocery': 'किराना राशन चावल चीनी आटा दाल मैदा बेसन नमक', 'Oil / Ghee': 'तेल घी',
  'Milk & Dairy': 'दूध पनीर दही मलाई मक्खन खोया छाछ', 'Ice': 'बर्फ', 'Water': 'पानी', 'Fruits': 'फल केला सेब आम', 'Sweet': 'मिठाई लड्डू जलेबी',
  'Gas / Cylinder': 'गैस सिलेंडर', 'Transport': 'टेम्पो गाडी ट्रक भाडा ऑटो', 'Non-veg (Chicken / Mutton / Fish)': 'चिकन मटन मछली', 'Eggs': 'अंडे अंडा',
  'Flowers / Decoration': 'फूल सजावट', 'Spices / Masala': 'मसाला', 'Rented Material': 'टेंट मंडप कुर्सी', 'Charcoal / Firewood': 'कोयला लकडी' };
// Expense item: the first head whose name or everyday words appear in the sentence
export function headOf(toks) {
  for (const [cat, heads] of Object.entries(EXPENSE_HEADS)) for (const head of heads) {
    const en = head.split(' – ')[0], ws = norm(en + ' ' + (HEAD_WORDS[en] || '') + ' ' + (HINDI_HEADS[en] || '') + ' ' + (head.split(' – ')[1] || '')).split(' ').filter(w => w.length >= 3);
    if (ws.some(w => toks.some(t => word(t) === undefined && NUM_AMBIG[t] === undefined && !MULT[t] && (t === w || stem(t) === w || (w.length >= 4 && t.startsWith(w) && t.length - w.length <= 4))))) return { cat, head };
  }
  return null;
}

// Vendors the sentence names: by full name, else by a distinctive name word, else (hint only) by what they supply
export function matchVendor(text, vendors = [], hint = null) {
  const t = ' ' + norm(text) + ' ', toks = tokens(norm(text)), live = vendors.filter(v => v && v.name && !v.deleted);
  let c = live.filter(v => norm(v.name).length >= 3 && t.includes(' ' + norm(v.name) + ' '));
  let how = 'name';
  if (!c.length) { how = 'word';
    c = live.filter(v => norm(v.name).split(' ').some(w => w.length >= 3 && !GENERIC.has(w) && nameIn(w, toks))); }
  if (!c.length && hint) { how = 'supplies';
    c = live.filter(v => v.kind !== 'person' && (v.specialty === hint.head || (!v.specialty && v.cat === hint.cat))); }
  const list = c.slice(0, 6).map(v => ({ id: v.id, name: v.name }));
  return { id: list.length === 1 && how !== 'supplies' ? list[0].id : '', sure: list.length === 1 && how === 'name', how: list.length ? how : '', candidates: list };
}

/* Events the sentence points to: by a distinctive word of the name, the venue or the locality ("MLA Hall", "Vashi"),
   else by the day said; two that fit are asked about. A day that was said and does not match the event found is a
   conflict: nothing is chosen (CTO review, v6.0). */
export function matchEvent(toks, events = [], date = '') {
  const live = events.filter(e => e && e.name && !e.deleted);
  const words = e => norm([e.name, e.venue, e.locality].filter(Boolean).join(' ')).split(' ');
  let c = live.filter(e => words(e).some(w => w.length >= 3 && !GENERIC.has(w) && nameIn(w, toks)));
  let dateConflict = false;
  if (date) { const onDay = (c.length ? c : live).filter(e => e.date === date);
    if (c.length && !onDay.length) dateConflict = true; else c = onDay; }
  const list = c.slice(0, 6).map(e => ({ id: e.id, name: e.name, date: e.date }));
  return { id: list.length === 1 && !dateConflict ? list[0].id : '', candidates: list, ...(dateConflict ? { dateConflict: true } : {}) };
}

let KNOWN = null;
function isKnown(t) {
  if (!KNOWN) { KNOWN = new Set([...Object.values(VOCAB).flat(), ...MODE_WORDS.flatMap(([, w]) => w.split(' ')), ...MEAL_WORDS.flatMap(([, w]) => w.split(' ')),
    ...EVENT_WORDS.flatMap(([, w]) => w.split(' ')), ...WORKERS.flatMap(([, w]) => w.split(' ')), ...COOKS.flatMap(([, w]) => w.split(' ')), ...PEOPLE, ...GUESTS,
    ...Object.keys(UNITS), ...TIME_AFTER, ...DATE_NEAR, ...RATE_BEFORE, ...STOP, ...Object.keys(NUMW), ...Object.keys(MULT), ...Object.keys(NUM_AMBIG)].map(w => norm(w)));
    for (const heads of Object.values(EXPENSE_HEADS)) for (const h of heads) { const en = h.split(' – ')[0];
      for (const w of norm(h + ' ' + (HEAD_WORDS[en] || '') + ' ' + (HINDI_HEADS[en] || '')).split(' ')) KNOWN.add(w); } }
  return KNOWN.has(t) || KNOWN.has(stem(t)) || !!headOf([t]);
}
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const title = s => s.replace(/(^|\s)\S/g, m => m.toUpperCase());

/* ── Understanding a sentence ──
   understand(text, { events, vendors, today: 'YYYY-MM-DD' }) →
   { kind: 'expense' | 'cpay' | 'payven' | 'event' | 'labour' | 'cook' | 'order' | 'guests' | 'vendor' | 'unknown', text, amount, ... ,
     ask: [what the review screen must ask for] } */
export function understand(text, ctx = {}) {
  const { events = [], vendors = [], today = new Date().toISOString().slice(0, 10) } = ctx;
  const P = prep(text), s = P.s, toks = tokens(s), gs = numbers(toks);
  const roles = gs.map(g => ({ ...g, role: numberRole(toks, g) }));
  const money = roles.filter(g => g.role === 'money' && !(g.words && g.v < 10));
  const amount = money.length ? Math.max(...money.map(g => g.v)) : 0;
  const first = role => roles.find(g => g.role === role);
  const out = { kind: 'unknown', text: String(text || ''), amount, ask: [] };
  if (P.phones.length) out.phone = P.phones[0]; if (P.refs.length) out.ref = P.refs[0]; if (P.dates.length) { out.dateWritten = P.dates[0]; out.ask.push('date'); }
  const moneyNow = () => { const m = roles.filter(g => g.role === 'money' && !(g.words && g.v < 10)); return m.length ? Math.max(...m.map(g => g.v)) : 0; };

  // Payment words. Two ways of paying said ("cash or UPI"), or paid and credit together ("udhar UPI"): nothing is chosen
  const modes = MODE_WORDS.filter(([, w]) => has(toks, w.split(' '))).map(([m]) => m);
  const mode = modes.length === 1 ? modes[0] : '';
  if (modes.length > 1) out.modeConflict = modes;
  const credit = has(toks, VOCAB.credit), creditMaybe = !credit && has(toks, VOCAB.creditUnsure);
  const negated = has(toks, VOCAB.neg), cancelled = has(toks, VOCAB.cancel), future = has(toks, VOCAB.future);
  const gave = has(toks, VOCAB.give), got = has(toks, VOCAB.receive), adv = has(toks, VOCAB.advance), client = starts(toks, VOCAB.client);
  // The day: aaj / udya / kaal are clear; Hindi "kal" is both yesterday and tomorrow, so it follows the kind and is confirmed
  const day = has(toks, VOCAB.today) ? 0 : has(toks, VOCAB.tomorrow) ? 1 : has(toks, VOCAB.yesterday) ? -1 : has(toks, VOCAB.kal) ? 'kal' : null;
  out.daySaid = day !== null || !!P.dates.length;
  const meal = pick(toks, MEAL_WORDS);
  const head = headOf(toks);
  const evType = pick(toks, EVENT_WORDS);
  const futureDay = d => d === 'kal' ? addDays(today, 1) : d === null ? '' : addDays(today, d);
  const pastDay = d => d === 'kal' ? addDays(today, -1) : d === null ? '' : addDays(today, d);
  const withEvent = (d) => { const m = matchEvent(toks, events, d); out.event = m; if (!m.id) out.ask.push('event'); };
  // Words left that the app does not know (a venue or a name it has no record of): then "today's only event" is never assumed
  out.unknownWords = toks.filter(t => t.length >= 3 && word(t) === undefined && !MULT[t] && !isKnown(t)
    && !events.some(e => [e.name, e.venue, e.locality].some(x => x && nameIn(t, tokens(norm(x)))))
    && !vendors.some(v => v.name && nameIn(t, tokens(norm(v.name)))));
  const items = [];
  { // "25 kilo rice aur 10 kilo sugar"
    for (const g of roles.filter(g => g.role === 'qty')) {
      const unit = UNITS[toks[g.end + 1]], name = [];
      for (let i = g.end + 2; i < toks.length; i++) { const w = toks[i]; if (VOCAB.join.includes(w) || word(w) !== undefined || VOCAB.order.includes(w) || STOP.has(w) || MODE_WORDS.some(([, x]) => x.split(' ').includes(w))) break; name.push(w); }
      if (!name.length && has(toks, VOCAB.order)) for (let i = g.start - 1; i >= 0 && name.length < 3; i--) {   // "Bread ki 5 ladi mangao"
        const w = toks[i]; if (STOP.has(w) || VOCAB.ka.includes(w)) { if (name.length) break; continue; }
        if (VOCAB.join.includes(w) || word(w) !== undefined || VOCAB.order.includes(w) || VOCAB.to.includes(w)) break; name.unshift(w); }
      if (name.length) items.push({ name: title(name.join(' ')), qty: g.v, unit });
    }
    // "Order 100 dosa plates and 50 chaat plates": counter plates, only when an order word is said
    if (has(toks, VOCAB.order)) for (const g of roles.filter(g => g.role === 'money')) {
      const name = []; let i = g.end + 1;
      for (; i < toks.length && !GUESTS.includes(toks[i]) && !VOCAB.join.includes(toks[i]) && word(toks[i]) === undefined && name.length < 4; i++) name.push(toks[i]);
      if (name.length && GUESTS.includes(toks[i])) { items.push({ name: title(name.join(' ')), qty: g.v, unit: 'plates' }); g.role = 'qty'; }
    }
    if (has(toks, VOCAB.order)) for (const g of roles.filter(g => g.role === 'guests')) {   // "Chaat 300 plates order karo"
      const name = []; for (let i = g.start - 1; i >= 0 && name.length < 3; i--) { const w = toks[i];
        if (STOP.has(w) || VOCAB.join.includes(w) || word(w) !== undefined || VOCAB.order.includes(w) || VOCAB.ka.includes(w)) break; name.unshift(w); }
      if (name.length) { items.push({ name: title(name.join(' ')), qty: g.v, unit: 'plates' }); g.role = 'qty'; }
    }
  }

  if (items.some(x => x.unit === 'plates')) out.amount = moneyNow();
  const amt = out.amount;
  // Not done, not to be done, or cancelled: nothing is proposed (CTO review, v6.0)
  if (negated || cancelled) { out.kind = 'unclear'; out.reason = cancelled ? 'cancel' : 'negative'; out.ask = ['rewrite']; return out; }
  // Two or more amounts of money: one entry at a time ("Gas 1200 cash aur sabzi 4500 cash"); never the larger one alone
  const moneyGroups = roles.filter(g => g.role === 'money' && !(g.words && g.v < 10));
  if (moneyGroups.length > 1) { out.kind = 'multi'; out.amounts = moneyGroups.map(g => g.v); out.amount = 0; out.ask = ['one-at-a-time']; return out; }
  // 1. A new vendor: "Naya vegetable supplier add karo"
  if (has(toks, VOCAB.newWord) && starts(toks, VOCAB.vendorWord) && !amt) {
    out.kind = 'vendor'; out.cat = head?.cat || (pick(toks, WORKERS) || pick(toks, COOKS) ? 'Labour' : ''); out.specialty = head?.head || '';
    const named = String(text).match(/\b(?:naam|name|named|नाव|नाम)\s+([A-Za-zऀ-ॿ][\wऀ-ॿ ]{1,40}?)(?=\s+(?:hai|he|aahe|है|आहे|phone|number|\d)|[,.]|$)/i);
    const after = named ? null : String(text).match(/\b(?:supplier|vendor|contractor|mukadam|सप्लायर|वेंडर|ठेकेदार)\s+(?!(?:add|jodo|joda|karo|kar|ka|ki|ke|hai|ko)\b)([A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F]+(?:\s+[A-Z][A-Za-z]+)?)(?=\s+(?:phone|mobile|number|no|ka|ki|ke|add|jodo|karo|का|की)\b|\s*[,.]|\s*\+?\d|\s*$)/i);
    out.name = (named ? named[1].trim() : after ? after[1].trim() : '').replace(/\s+(?:phone|mobile|number|no|ka|ki|ke)$/i, ''); if (!out.name) out.ask.push('name');
    return out;
  }

  // 2. A guest-count change: "Dinner 350 se 400 plates ho gaya" (an amendment for approval, never applied directly)
  { const i = toks.findIndex((t, k) => VOCAB.change.includes(t) && word(toks[k - 1]) !== undefined && word(toks[k + 1]) !== undefined);
    if (i > 0 && (has(toks, GUESTS) || has(toks, PEOPLE) || has(toks, VOCAB.changed)) && !mode && !gave && !got) {
      out.kind = 'guests'; out.amount = 0; out.from = word(toks[i - 1]); out.to = word(toks[i + 1]); out.meal = meal; if (!meal) out.ask.push('meal');
      withEvent(day === null ? '' : futureDay(day)); return out; } }

  // 3. Several items with quantities, to a supplier: a draft supplier order (never sent by itself)
  if (items.length && (has(toks, VOCAB.order) || has(toks, VOCAB.to) || !amt) && !gave && !got) {
    out.kind = 'order'; out.items = items; out.meal = meal; out.counter = items.some(x => x.unit === 'plates');
    const vh = head || headOf(tokens(norm(items.map(x => x.name).join(' '))));
    out.vendor = matchVendor(text, vendors, vh); out.supplies = vh?.head || ''; if (!out.vendor.id) out.ask.push('vendor');
    out.date = day === null ? '' : futureDay(day); withEvent(out.date); return out;
  }

  // 4. Cooking work by job: "Chinese ke liye noodles aur Manchurian, 2 log"
  const people = first('people'), workersN = first('workers');
  const cookRole = pick(toks, COOKS);
  if (!amt && cookRole && (people || (workersN && COOKS.some(([, w]) => w.split(' ').includes(toks[workersN.end + 1]))))) {
    out.kind = 'cook'; out.role = cookRole; out.people = (people || workersN).v; out.meal = meal;
    const f = toks.findIndex(t => VOCAB.forWord.includes(t)), stop = (people || workersN).start;
    const seg = f >= 0 && f < stop ? toks.slice(f + 1, stop) : [];
    out.dishes = seg.join(' ').split(new RegExp(`\\s(?:${VOCAB.join.join('|')})\\s`)).map(x => x.split(' ').filter(w => !STOP.has(w) && !COOK_WORDS.has(w)).join(' ').trim()).filter(Boolean).map(title);   // "Chinese noodles": Chinese is the cook
    if (!out.dishes.length) out.ask.push('dishes');
    withEvent(day === null ? '' : futureDay(day)); if (!meal) out.ask.push('meal'); return out;
  }

  // 5. Shift labour: "Dinner ke liye 15 boys bulana"
  const worker = pick(toks, WORKERS);
  if (worker && workersN && !(amt && gave)) {
    out.kind = 'labour'; out.role = worker; out.count = workersN.v; out.meal = meal; const rate = first('rate'); if (rate) out.rate = rate.v;
    // "15 boys bulana" is a requirement; "12 boys aaye" is attendance. Not said: a requirement (it changes no cost)
    out.labour = has(toks, VOCAB.attended) && !has(toks, VOCAB.plan) ? 'came' : 'asked';
    if (!meal) out.ask.push('meal'); withEvent(day === null ? '' : futureDay(day)); return out;
  }

  // 6. A new booking or quick event: "Kal Vashi mein 100 plates ka birthday hai"
  const guests = first('guests');
  const booking = toks.some(t => /^(book|booking|बुकिंग)$/.test(t));
  if (evType && (booking || (!amt && (guests || day !== null)))) {
    out.kind = 'event'; out.type = evType; out.guests = guests?.v || 0; out.date = day === null ? '' : futureDay(day); out.meal = meal;
    if (day === 'kal') out.dateCheck = true;
    const a = toks.findIndex(t => VOCAB.at.includes(t));
    out.venue = a > 0 && !['at', 'in'].includes(toks[a]) ? title(toks.slice(Math.max(0, a - 2), a).filter(w => !STOP.has(w) && word(w) === undefined && ![...VOCAB.today, ...VOCAB.tomorrow, ...VOCAB.kal, ...VOCAB.yesterday].includes(w)).join(' '))
      : a >= 0 ? title(toks.slice(a + 1, a + 3).filter(w => !STOP.has(w) && word(w) === undefined && !GUESTS.includes(w)).join(' ')) : '';
    // An advance said with the booking is recorded as a client payment after the event is saved, never as the bill
    out.advance = (adv || got) && amt ? amt : 0; out.amount = out.advance; out.mode = mode;
    const pp = first('rate'); if (pp) out.perPlate = pp.v;
    if (!out.date) out.ask.push('date'); if (!out.guests) out.ask.push('guests'); if (out.advance && !mode) out.ask.push('mode');
    return out;
  }

  if (!amt) { out.ask.push('amount'); return out; }
  out.mode = mode;
  // "Ramesh ko 5000 dena hai", "kal dunga": still to be paid, not paid (CTO review, v6.0)
  if (future && !got) { out.kind = 'unclear'; out.reason = 'future'; out.ask = ['rewrite']; return out; }
  // The date of this money: said ("kaal", "kal" = yesterday for money already moved, checked) or written; else today in the form
  out.txDate = day === null ? '' : pastDay(day); if (day === 'kal' || out.txDate > today) out.dateCheck = true;   // money dated in the future: checked

  // 7. Money from the client: "Client ne 50 thousand advance diya", "received 25000 via UPI as advance"
  const toIdx = toks.findIndex(t => VOCAB.to.includes(t) && t !== 'to');
  const paidTo = toks.findIndex((t, k) => t === 'to' && k > 0 && (has(toks.slice(0, k), VOCAB.give)));
  if ((client || got || (adv && !gave)) && !(toIdx > 0 && gave && !client)) {
    out.kind = 'cpay'; out.advance = adv; if (!mode) out.ask.push('mode');
    withEvent(day === null ? '' : pastDay(day)); return out;
  }

  // 8. Money given to someone: "Ramesh ko 10 hazaar diye", "paid 4500 to Ghati contractor by UPI".
  //    It may settle what is owed or be a new purchase: proposed as a payment, with a one-tap switch to an expense
  if (gave && (toIdx > 0 || paidTo > 0) && !credit && !creditMaybe) {
    const BY = ['by', 'via', 'through', 'from', 'se', 'for', 'in', ...MODE_WORDS.flatMap(([, w]) => w.split(' '))];
    let who = toIdx > 0 ? toks.slice(Math.max(0, toIdx - 3), toIdx) : toks.slice(paidTo + 1, paidTo + 4);
    if (paidTo > 0 && !(toIdx > 0)) { const k = who.findIndex(w => BY.includes(w)); if (k >= 0) who = who.slice(0, k); }
    else { const k = who.map(w => BY.includes(w) || word(w) !== undefined || !!MULT[w]).lastIndexOf(true); if (k >= 0) who = who.slice(k + 1); }
    const whoHint = headOf(who);
    out.kind = 'payven'; out.alt = 'expense'; out.advance = adv; out.who = title(who.filter(w => !STOP.has(w) && word(w) === undefined && !MULT[w]).join(' '));
    out.vendor = matchVendor(who.join(' '), vendors, whoHint);
    if (!out.vendor.id) out.vendor = matchVendor(text, vendors, whoHint);
    if (!out.vendor.id) out.ask.push('vendor'); if (!mode) out.ask.push('mode');
    out.head = whoHint || head; withEvent(day === null ? '' : pastDay(day)); return out;
  }

  // 9. Otherwise a bill: "Sabzi ka 4500 cash diya", "Bay of Snacks ka 2490 udhaar hai"
  out.kind = 'expense';
  const paidWord = (gave || mode) && !!mode;
  if ((credit || creditMaybe) && (paidWord || modes.length)) { out.pay = ''; out.payConflict = true; }   // "udhar UPI": which is it?
  else out.pay = credit ? 'credit' : paidWord ? 'paid' : '';
  if (creditMaybe && !out.pay && !out.payConflict) out.payHint = 'credit';
  out.vendor = matchVendor(text, vendors, head);
  // no item said: the named supplier's usual item, shown for checking
  const vSpec = out.vendor.id && vendors.find(v => v.id === out.vendor.id)?.specialty;
  out.head = head || (vSpec ? { cat: Object.keys(EXPENSE_HEADS).find(c => EXPENSE_HEADS[c].includes(vSpec)) || '', head: vSpec, fromVendor: true } : null);
  if (!out.head) out.ask.push('item'); if (!out.pay) out.ask.push('pay'); if (out.pay !== 'credit' && !mode) out.ask.push('mode');
  if (out.pay === 'credit' && !out.vendor.id) out.ask.push('vendor');
  withEvent(day === null ? '' : pastDay(day));
  return out;
}

export const MODES = PAY_MODES;
