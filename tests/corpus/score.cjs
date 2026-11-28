// Scores understand() results against tests/corpus/voice-corpus.json. Shared by tests/voice-corpus.cjs (in the browser,
// as part of the suite) and quick local runs. Two things are measured:
// - accuracy per language and per field (kind of entry, amount, event, vendor, paid/credit, date, clarification...);
// - safety violations, which must be zero: a completed money entry where none may be made, a wrong amount, a wrong
//   paid/credit choice, an event or vendor picked that is not the one meant, a phone number read as money, or workers
//   asked for treated as workers who came.
const MONEY = ['expense', 'cpay', 'payven'];
const FIELDS = {
  kind: (r, e) => r.kind === e.kind,
  amount: (r, e) => (r.amount || 0) === e.amount,
  amounts: (r, e) => JSON.stringify(r.amounts || []) === JSON.stringify(e.amounts),
  pay: (r, e) => (r.pay || '') === e.pay,
  mode: (r, e) => (r.mode || '') === e.mode,
  head: (r, e) => r.head?.head === e.head,
  event: (r, e) => (r.event?.id || '') === e.event,
  vendor: (r, e) => (r.vendor?.id || '') === e.vendor,
  advance: (r, e) => typeof e.advance === 'number' ? r.advance === e.advance : !!r.advance === e.advance,   // a booking's advance: the exact amount
  bill: (r, e) => (r.bill || 0) === e.bill,
  itemNames: (r, e) => JSON.stringify((r.items || []).map(i => String(i.name).toLowerCase())) === JSON.stringify(e.itemNames),
  name: (r, e) => r.name === e.name,
  reason: (r, e) => r.reason === e.reason,
  payConflict: (r, e) => !!r.payConflict === e.payConflict,
  modeConflict: (r, e) => !!(r.modeConflict && r.modeConflict.length) === e.modeConflict,
  guests: (r, e) => r.guests === e.guests,
  date: (r, e) => (r.date || r.txDate || '') === e.date,
  count: (r, e) => r.count === e.count,
  labour: (r, e) => r.labour === e.labour,
  meal: (r, e) => r.meal === e.meal,
  people: (r, e) => r.people === e.people,
  role: (r, e) => r.role === e.role,
  items: (r, e) => JSON.stringify((r.items || []).map(i => [i.qty, i.unit])) === JSON.stringify(e.items),
  from: (r, e) => r.from === e.from,
  to: (r, e) => r.to === e.to,
  phone: (r, e) => r.phone === e.phone,
};
function violations(r, e, strictEvent = true) {   // strictEvent: every event that should be found is listed (the 400); the 140 lists only some
  const v = [];
  if (MONEY.includes(r.kind) && ['unclear', 'multi'].includes(e.kind)) v.push('money proposed where none may be');
  if (MONEY.includes(r.kind) && r.amount > 0 && e.amount !== undefined && r.amount !== e.amount) v.push(`wrong amount ${r.amount}`);
  // The wrong kind of money entry (a new expense instead of a settlement, a payment instead of a receipt) is a money mistake
  if (MONEY.includes(r.kind) && MONEY.includes(e.kind) && r.kind !== e.kind) v.push(`${r.kind} instead of ${e.kind}`);
  if (r.mode && e.mode !== undefined && r.mode !== e.mode) v.push(`wrong way of paying ${r.mode}`);
  if (r.txDate && e.date !== undefined && r.txDate !== e.date) v.push(`wrong date on money ${r.txDate}`);
  if (r.kind === 'event' && e.kind === 'event' && ((e.bill !== undefined && (r.bill || 0) !== e.bill) || (typeof e.advance === 'number' && r.advance !== e.advance))) v.push('booking bill or advance wrong');
  if (r.pay && e.pay !== undefined && r.pay !== e.pay) v.push(`wrong paid/credit ${r.pay}`);
  if (r.event?.id && (e.event !== undefined || strictEvent) && r.event.id !== (e.event || '')) v.push(`event picked ${r.event.id}`);
  if (r.vendor?.id && e.vendor !== undefined && r.vendor.id !== e.vendor) v.push(`vendor picked ${r.vendor.id}`);
  if (e.kind === 'vendor' && r.amount > 0) v.push('phone number read as money');
  if (e.labour === 'asked' && r.labour === 'came') v.push('asked for treated as came');
  return v;
}
function score(corpus, results) {
  const by = {}, bad = [], wrong = [];
  corpus.sentences.forEach((s, i) => {
    const r = results[i], L = (by[s.lang] ||= { n: 0, fields: {} });
    L.n++;
    let ok = true;
    const missed = [];
    for (const f of Object.keys(s.expect)) {
      const pass = FIELDS[f] ? FIELDS[f](r, s.expect) : false;   // an expectation the scorer does not know is a failure, never skipped
      const c = (L.fields[FIELDS[f] ? f : 'unknown:' + f] ||= { pass: 0, n: 0 }); c.n++; if (pass) c.pass++; else { ok = false; missed.push(f); }
    }
    // A miss is a safe clarification (the app asks or declines), incomplete (a value left empty), or wrong (a value given that is wrong)
    const got = { kind: r.kind, amount: r.amount, pay: r.pay, mode: r.mode, head: r.head?.head, event: r.event?.id, vendor: r.vendor?.id, date: r.date || r.txDate, name: r.name, bill: r.bill, advance: r.advance };
    const cls = !missed.length ? '' : ['unclear', 'unknown', 'multi'].includes(r.kind) && !['unclear', 'multi'].includes(s.expect.kind) ? 'clarification'
      : missed.every(f => [undefined, '', 0, null, false].includes(got[f])) ? 'incomplete' : 'wrong';
    if (cls) (L.cls ||= {})[cls] = ((L.cls || {})[cls] || 0) + 1;
    if (!ok) wrong.push({ cls, fields: missed, id: s.id, text: s.text, expect: s.expect, got: { kind: r.kind, amount: r.amount, pay: r.pay, mode: r.mode, event: r.event?.id, vendor: r.vendor?.id, date: r.date || r.txDate, reason: r.reason } });
    const v = violations(r, s.expect); if (v.length) bad.push({ id: s.id, text: s.text, v });
    (L.all ||= { pass: 0 }); if (ok) L.all.pass++;
  });
  return { by, bad, wrong };
}
function table({ by }) {
  const langs = Object.keys(by), fields = [...new Set(langs.flatMap(l => Object.keys(by[l].fields)))];
  const pct = c => c ? `${Math.round(100 * c.pass / c.n)}%` : '–';
  const rows = [['field', ...langs].join('\t'), ['all fields right', ...langs.map(l => `${by[l].all.pass}/${by[l].n}`)].join('\t'),
    ...['clarification', 'incomplete', 'wrong'].map(k => [`misses: ${k}`, ...langs.map(l => (by[l].cls || {})[k] || 0)].join('\t'))];
  for (const f of fields) rows.push([f, ...langs.map(l => pct(by[l].fields[f]))].join('\t'));
  return rows.join('\n');
}
module.exports = { score, table, violations };

/* The reviewer's independent 140 commands (tests/corpus/independent-140.json): scored by its own notes, unchanged.
   Kept separate from the 400 so the two sets stay independent. */
const lower = v => String(v ?? '').toLowerCase().replace(/वाशी/g, 'vashi');
const SAFE = ['unclear', 'unknown', 'multi'];
const IND = {
  kind: (r, e) => r.kind === e.kind, amount: (r, e) => (r.amount || 0) === e.amount, pay: (r, e) => (r.pay || '') === e.pay, mode: (r, e) => (r.mode || '') === e.mode,
  event: (r, e) => (r.event?.id || '') === e.event, vendor: (r, e) => (r.vendor?.id || '') === e.vendor,
  head: (r, e) => (r.head?.head || '').split(' – ')[0] === e.head, items: (r, e) => JSON.stringify((r.items || []).map(i => [i.qty, i.unit])) === JSON.stringify(e.items),
  meal: (r, e) => r.meal === e.meal, count: (r, e) => r.count === e.count, labour: (r, e) => r.labour === e.labour, advance: (r, e) => !!r.advance === !!e.advance,
  guests: (r, e) => r.guests === e.guests, date: (r, e) => (r.date || '') === e.date, txDate: (r, e) => (r.txDate || '') === e.txDate, phone: (r, e) => r.phone === e.phone,
  name: (r, e, s) => (s.context === 'A' ? String(r.name || '').replace('राज', 'Raj') : r.name) === e.name,
  venue: (r, e) => lower(r.venue) === lower(e.venue), people: (r, e) => r.people === e.people, dishes: (r, e) => (r.dishes || []).length === e.dishes,
  counter: (r, e) => !!r.counter === e.counter, from: (r, e) => r.from === e.from, to: (r, e) => r.to === e.to,
  dateReview: (r) => !!(r.dateWritten || r.dateCheck || (r.ask || []).includes('date') || r.txDate || r.date),
  safe: (r) => SAFE.includes(r.kind), bookingSafe: (r) => r.kind === 'multi' || (r.kind === 'event' && r.bill === 25000 && r.advance === 5000),
};
function scoreIndependent(corpus, results) {
  const by = {}, wrong = [], bad = [];
  corpus.sentences.forEach((s, i) => {
    const r = results[i], L = (by[s.lang] ||= { n: 0, pass: 0 }); L.n++;
    const miss = Object.keys(s.expect).filter(f => !IND[f] || !IND[f](r, s.expect[f] !== undefined ? s.expect : {}, s));
    if (miss.length) wrong.push({ id: s.id, text: s.text, fields: miss, expect: s.expect, got: { kind: r.kind, amount: r.amount, event: r.event?.id, vendor: r.vendor?.id, name: r.name, venue: r.venue } }); else L.pass++;
    const v = violations(r, { ...s.expect, kind: s.expect.safe ? 'unclear' : s.expect.kind }, false);
    if (v.length) bad.push({ id: s.id, text: s.text, v });
  });
  return { by, wrong, bad };
}
module.exports.scoreIndependent = scoreIndependent;
