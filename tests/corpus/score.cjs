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
  advance: (r, e) => !!r.advance === e.advance,
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
  named: (r, e) => !!r.name === e.named,
};
function violations(r, e) {
  const v = [];
  if (MONEY.includes(r.kind) && ['unclear', 'multi'].includes(e.kind)) v.push('money proposed where none may be');
  if (MONEY.includes(r.kind) && r.amount > 0 && e.amount !== undefined && r.amount !== e.amount) v.push(`wrong amount ${r.amount}`);
  if (r.pay && e.pay !== undefined && r.pay !== e.pay) v.push(`wrong paid/credit ${r.pay}`);
  if (r.event?.id && r.event.id !== (e.event || '')) v.push(`event picked ${r.event.id}`);
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
    for (const [f, want] of Object.entries(s.expect)) {
      if (!FIELDS[f]) continue;
      const pass = FIELDS[f](r, s.expect); const c = (L.fields[f] ||= { pass: 0, n: 0 }); c.n++; if (pass) c.pass++; else ok = false;
    }
    if (!ok) wrong.push({ id: s.id, text: s.text, expect: s.expect, got: { kind: r.kind, amount: r.amount, pay: r.pay, mode: r.mode, event: r.event?.id, vendor: r.vendor?.id, date: r.date || r.txDate, reason: r.reason } });
    const v = violations(r, s.expect); if (v.length) bad.push({ id: s.id, text: s.text, v });
    (L.all ||= { pass: 0 }); if (ok) L.all.pass++;
  });
  return { by, bad, wrong };
}
function table({ by }) {
  const langs = Object.keys(by), fields = [...new Set(langs.flatMap(l => Object.keys(by[l].fields)))];
  const pct = c => c ? `${Math.round(100 * c.pass / c.n)}%` : '–';
  const rows = [['field', ...langs].join('\t'), ['all fields right', ...langs.map(l => `${by[l].all.pass}/${by[l].n}`)].join('\t')];
  for (const f of fields) rows.push([f, ...langs.map(l => pct(by[l].fields[f]))].join('\t'));
  return rows.join('\n');
}
module.exports = { score, table, violations };
