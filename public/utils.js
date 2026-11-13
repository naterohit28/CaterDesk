/**
 * utils.js — Flavor Fusion v2
 * Helpers, validation, constants, and expense taxonomy
 */

/* ── APP CONSTANTS ───────────────────────────────── */
export const EXPENSE_HEADS = {
  'Raw Material': [
    'Grocery – किराणा','Other Grocery – इतर किराणा','Vegetable – भाजी','Fruits',
    'Juice – ज्यूस','Water – पाणी','Ice + Milk – बर्फ + दूध','Bread – ब्रेड',
    'Pickle – लोणचे','Sweet – मिठाई','Dry Fruits','Spices / Masala',
    'Oil / Ghee','Paneer / Dairy',
    'Banana Leaves – केळीची पाने','Coconut – नारळ','Papad / Fryums – पापड','Farsan / Namkeen – फरसाण'
  ],
  'Live Counter': [
    'Chaat – चाट','Starter – स्टार्टर','Dosa – डोसा','Chinese – चायनीज',
    'Ice Cream – आईस्क्रीम','Paan Mukhwas – पान मुखवास','Counter Setup – काउंटर',
    'Pav Bhaji Counter','Pizza / Italian Counter','Dessert Counter','Beverage Counter',
    'Soup Station – सूप','Barbeque / Tandoor – तंदूर','Kulfi / Ice Gola – कुल्फी','Fruit Counter – फळ काउंटर',
    'Salad Counter – सॅलड','Fusion Counter – फ्यूजन'
  ],
  'Labour': [
    'Rojiya Labour – रोजीया मजूर','Boys – बॉईज','Ghati – घाटी','Cook – स्वयंपाकी',
    'Helper Staff','Roti Labour – रोटी मजूर','Cleaner / Washing',
    'PRO – पी.आर.О.','Supervisor','Loading / Unloading Labour',
    'Staff Tips – स्टाफ टीप','Vendor Staff Tips – विक्रेता स्टाफ टीप',
    'Contractor Fee – मुकादमगिरी','Other Labour Work – इतर काम'
  ],
  'Operations': [
    'Transport – वाहतूक','Fuel / Diesel','Gas / Cylinder – सिलिंडर',
    'Rented Material – भाड्याचे साहित्य','Disposable – डिस्पोजेबल',
    'Packaging Material','New Utensils – नवीन भांडी','Equipment Repair',
    'Generator / Power','Ice Blocks','Water Tanker','Outsourced Event – आउटसोर्स कार्यक्रम',
    'Nadaswaram / Music – सनई','Thamboolam / Return Gift Bags – तांबूलम'
  ],
  'Admin': [
    'Royalty – रॉयल्टी','Office Expense','Phone / Internet',
    'Printing / Stationery','Permission / License','Commission',
    'Marketing Expense','Tips – टीप / बक्षीस','Misc – इतर खर्च','Unaccounted'
  ],
  'Adjustment': [
    'Damage / Breakage','Refund / Compensation','Staff Advance','Cash Difference'
  ]
};

export const CAT_ICONS = {
  'Raw Material':'🥘','Live Counter':'🍽','Labour':'👷',
  'Operations':'🚚','Admin':'📋','Adjustment':'🔄'
};

export const EVENT_TYPES = [
  'Wedding – लग्न','Engagement – साखरपुडा','Reception – स्वागत समारंभ','Haldi – हळद',
  'Birthday – वाढदिवस','Anniversary – वर्धापनदिन','Corporate – कॉर्पोरेट','Pooja / religious – पूजा','Other – इतर'
];

/* ── PRICING ARITHMETIC (spec §6.3) ──────────────── */
/* Margin and markup are different things and are never interchanged:
     margin = contribution / price      markup = contribution / cost
   Price for a target margin m: cost / (1 − m). Price for a target markup u: cost × (1 + u).
   e.g. cost ₹700: 30% margin → ₹1,000; 30% markup → ₹910 (a 23.08% margin).
   No price is suggested without a positive cost, or when the margin is 100% or more. Amounts round up to the
   rupee for a price (never below the target) and percentages to two decimals. */
export function priceForMargin(cost, marginPct) {
  const c = Number(cost), m = Number(marginPct) / 100;
  if (!(c > 0) || !Number.isFinite(m) || m < 0 || m >= 1) return null;
  return Math.ceil(Math.round(c * 100) / (1 - m) / 100 - 1e-9);
}
export function priceForMarkup(cost, markupPct) {
  const c = Number(cost), u = Number(markupPct) / 100;
  if (!(c > 0) || !Number.isFinite(u) || u < 0) return null;
  return Math.ceil(Math.round(c * 100) * (1 + u) / 100 - 1e-9);
}
export const marginPct = (price, cost) => Number(price) > 0 ? Math.round((price - cost) / price * 10000) / 100 : null;
export const markupPct = (price, cost) => Number(cost) > 0 ? Math.round((price - cost) / cost * 10000) / 100 : null;

/* Per-meal pricing (§6.4, Q-01): each meal has its own guests and rate; totals add in paise. Guests of different
   meals are never added up as people (35 at breakfast and 900 at dinner are not 935 guests). */
export const MEAL_ORDER = ['breakfast', 'lunch', 'hightea', 'dinner'];
export function mealPlanTotal(plan) {
  const lines = MEAL_ORDER.filter(m => plan?.[m]).map(m => {
    const guests = Number(plan[m].guests) || 0, rate = Number(plan[m].rate) || 0;
    return { meal: m, guests, rate, totalPaise: guests * toPaise(rate) };
  }).filter(l => l.guests > 0 && l.rate > 0);
  const totalPaise = lines.reduce((s, l) => s + l.totalPaise, 0);
  return { lines: lines.map(l => ({ ...l, total: fromPaise(l.totalPaise) })), total: fromPaise(totalPaise), totalPaise };
}

// Order states: prepared (saved, not opened), opened (WhatsApp opened: not proof it was sent), sent (you
// confirmed you sent it), confirmed (the vendor confirmed), delivered, cancelled. Older orders are 'sent'.
export const ACTIVE_ORDER = ['prepared', 'opened', 'sent', 'confirmed'];
/* Menu changed after orders were sent (G-11): which active orders' counters had dishes added, removed or moved
   to another meal. Nothing is sent; the orders are only marked for the user to reissue. */
export function menuChangeImpact(before = [], after = [], orders = []) {
  const sig = (dishes, head) => dishes.filter(d => (d.head || '') === head).map(d => `${String(d.name).trim().toLowerCase()}|${d.meal || ''}`).sort().join('\n');
  return orders.filter(o => ACTIVE_ORDER.includes(o.status) && sig(before, o.head) !== sig(after, o.head)).map(o => o.id);
}

/* ── SHARED BILLS (spec §6.2 shared resources, G-13) ── */
/* One bill (e.g. transport ₹8,000 for two events) is entered once and split into parts, one per event. Each part is
   an expense on its event carrying `split: { id, total }`; the parts always add up to the bill, so the cost is counted
   once in every total and the vendor is owed it once. Vendor, item, date and payment are the same on every part. */
export const splitParts = (expenses, splitId) => expenses.filter(x => x.split?.id === splitId);
export function checkSplit(rows, totalRupees) {
  const totalP = toPaise(totalRupees);
  if (rows.length < 1) return 'Add at least one event';
  if (new Set(rows.map(r => r.evId)).size !== rows.length || rows.some(r => !r.evId)) return 'Each event can appear only once';
  if (rows.some(r => !(Number(r.amt) > 0) || Math.abs(Number(r.amt) * 100 - Math.round(Number(r.amt) * 100)) > .001)) return 'Each part needs an amount';
  const sumP = rows.reduce((s, r) => s + toPaise(r.amt), 0);
  if (sumP !== totalP) return `The parts add up to ${fromPaise(sumP)}, not the bill's ${fromPaise(totalP)}`;
  return '';
}
// Equal parts in paise; the last part takes any leftover paise so the parts add up exactly
export function equalSplit(totalRupees, n) {
  const totalP = toPaise(totalRupees), each = Math.floor(totalP / n);
  return Array.from({ length: n }, (_, i) => fromPaise(i === n - 1 ? totalP - each * (n - 1) : each));
}

/* ── CLIENT PAYMENT MILESTONES (spec §11.2, scenario P-01, G-09) ── */
/* A schedule (`payPlan`) splits the bill into milestones: on booking, on a date, N days before the event or N days
   after it; each an amount or a % of the bill. Five figures are kept apart: billed, received, outstanding (billed −
   received), due now (milestones whose time has come, less what is received) and overdue (milestones past their
   date and still unpaid). Payments are applied to milestones in order. A part of the bill not on the schedule is due
   after the event, as for events without a schedule. Outstanding is never shown as overdue just because it is unpaid. */
export const PAY_WHEN = ['booking', 'date', 'before', 'after'];
export function paymentSchedule(ev, cPays, now = today()) {
  const billP = toPaise(ev.billing);
  const recP = cPays.filter(p => p.evId === ev.id).reduce((s, p) => s + toPaise(p.amt), 0);
  const outstandingP = Math.max(0, billP - recP);
  const plan = Array.isArray(ev.payPlan) ? ev.payPlan : [];
  const out = (o) => ({ ...o, billed: fromPaise(billP), received: fromPaise(recP), outstanding: fromPaise(outstandingP) });
  if (!plan.length) {   // no schedule: everything is due once the event is over (as before)
    const late = daysSince(ev.date) > 0;
    return out({ scheduled: false, rows: [], dueNow: late ? fromPaise(outstandingP) : 0, overdue: late ? fromPaise(outstandingP) : 0, unscheduled: 0, overScheduled: 0 });
  }
  const dueDateOf = m => m.when === 'booking' ? '' : m.when === 'date' ? m.date : m.when === 'before' ? addDays(ev.date, -(m.days || 0)) : addDays(ev.date, m.days || 0);
  let rows = plan.map(m => ({ id: m.id, label: m.label || '', when: m.when, pct: m.pct, amtP: m.pct != null ? Math.round(billP * m.pct / 100) : toPaise(m.amt), dueDate: dueDateOf(m) }));
  const plannedP = rows.reduce((s, r) => s + r.amtP, 0);
  if (plannedP < billP) rows.push({ id: '__rest', label: 'Balance (not on the schedule)', when: 'after', unscheduled: true, amtP: billP - plannedP, dueDate: addDays(ev.date, 1) });
  rows.sort((a, b) => (a.dueDate === '' ? -1 : b.dueDate === '' ? 1 : a.dueDate.localeCompare(b.dueDate)));
  let left = recP, dueP = 0, overP = 0;
  rows = rows.map(r => {
    const paidP = Math.min(left, r.amtP); left -= paidP;
    const restP = r.amtP - paidP;
    const reached = r.dueDate === '' || r.dueDate <= now, past = r.dueDate !== '' && r.dueDate < now;
    if (reached) dueP += restP;
    if (past) overP += restP;
    const state = restP === 0 ? 'paid' : past ? 'overdue' : reached ? 'due' : 'upcoming';
    return { id: r.id, label: r.label, when: r.when, pct: r.pct, unscheduled: !!r.unscheduled, amount: fromPaise(r.amtP), paid: fromPaise(paidP), rest: fromPaise(restP), dueDate: r.dueDate, state };
  });
  return out({ scheduled: true, rows, dueNow: fromPaise(Math.min(dueP, outstandingP)), overdue: fromPaise(Math.min(overP, outstandingP)),
    unscheduled: fromPaise(Math.max(0, billP - plannedP)), overScheduled: fromPaise(Math.max(0, plannedP - billP)) });
}

/* ── COUNTER PLANNING (spec §5.4, scenarios C-01 / C-02, G-06) ── */
/* Portions for one counter are planned from the guests of the meal it serves, not the event total, times the share
   of guests expected at that counter (take-up). Take-up is the owner's figure for this counter: nothing is assumed,
   and counters' take-ups need not add up to 100% (one guest may visit both chaat and dosa). A vendor minimum lifts the
   proposal (C-02). The ordered quantity stays the owner's choice; what was actually served stays unknown until
   recorded, and is never taken from the order. */
export function counterGuests(ev, head) {
  const meals = [...new Set((ev.dishes || []).filter(d => (d.head || '') === head && d.meal).map(d => d.meal))];
  const g = meals.length === 1 ? Number(ev.mealPlan?.[meals[0]]?.guests) || 0 : 0;
  return g > 0 ? { guests: g, meal: meals[0] } : { guests: Number(ev.guests) || 0, meal: '' };
}
export function counterSuggestion(guests, takeUpPct, minimum = 0) {
  const g = Number(guests) || 0, t = Number(takeUpPct), m = Math.max(0, Math.floor(Number(minimum) || 0));
  if (!(g > 0) || !(t > 0) || t > 100) return null;
  const forecast = Math.ceil(g * t / 100 - 1e-9);
  return { forecast, proposed: Math.max(forecast, m), minimumApplied: m > forecast };
}
// The plan used for this counter at the latest other event, offered as a starting point only
export function lastCounterPlan(events, head, excludeId = '') {
  const e = events.filter(x => x.id !== excludeId && x.counterPlan?.[head]).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  return e ? { ...e.counterPlan[head], from: e.id } : null;
}

/* ── VENUE DETAILS (CD5-VEN-01) ──────────────────── */
/* The occasion (event `type`) and the physical venue (`venueType`) are separate. Venue type and logistics are
   stored as fixed ids, independent of the English/Marathi labels, and only when the user picks them. Nothing
   is inferred from the occasion or the venue name. */
export const VENUE_TYPES = [
  { id: 'hall',       en: 'Banquet / marriage hall', mr: 'हॉल / मंगल कार्यालय' },
  { id: 'lawn',       en: 'Lawn',                    mr: 'लॉन' },
  { id: 'ground',     en: 'Open ground',             mr: 'मैदान' },
  { id: 'residence',  en: 'Residence / house party', mr: 'घर' },
  { id: 'society',    en: 'Society / clubhouse',     mr: 'सोसायटी / क्लबहाऊस' },
  { id: 'hotel',      en: 'Hotel / resort',          mr: 'हॉटेल / रिसॉर्ट' },
  { id: 'office',     en: 'Corporate office',        mr: 'ऑफिस' },
  { id: 'school',     en: 'School / college',        mr: 'शाळा / कॉलेज' },
  { id: 'community',  en: 'Community hall',          mr: 'समाज मंदिर' },
  { id: 'terrace',    en: 'Terrace / rooftop',       mr: 'टेरेस' },
  { id: 'restaurant', en: 'Restaurant / private dining', mr: 'रेस्टॉरंट' },
  { id: 'other',      en: 'Other',                   mr: 'इतर' }
];
export function venueTypeLabel(ev) {
  if (!ev?.venueType) return '';
  if (ev.venueType === 'other') return ev.venueTypeOther || 'Other';
  return VENUE_TYPES.find(v => v.id === ev.venueType)?.en || '';
}

// Optional logistics; a key that is absent means "unknown" (never recorded, never assumed)
export const LOGISTICS = [
  { id: 'kitchen',   en: 'Kitchen',            mr: 'किचन',      opts: [['available', 'Available', 'आहे'], ['temporary', 'Temporary needed', 'तात्पुरते लागेल'], ['none', 'None', 'नाही']] },
  { id: 'gas',       en: 'Cooking at venue',   mr: 'स्वयंपाक',  opts: [['allowed', 'Gas allowed', 'गॅस चालेल'], ['induction', 'Induction only', 'फक्त इंडक्शन'], ['none', 'No cooking', 'स्वयंपाक नाही']] },
  { id: 'power',     en: 'Electricity',        mr: 'वीज',       opts: [['venue', 'Venue provides', 'ठिकाणी आहे'], ['generator', 'Generator required', 'जनरेटर लागेल']] },
  { id: 'water',     en: 'Water',              mr: 'पाणी',      opts: [['venue', 'Venue provides', 'ठिकाणी आहे'], ['arrange', 'Arrange separately', 'वेगळे आणावे']] },
  { id: 'equipment', en: 'Equipment',          mr: 'साहित्य',   opts: [['venue', 'Venue', 'ठिकाणचे'], ['own', 'Own', 'आपले'], ['rental', 'Rental', 'भाड्याचे'], ['mixed', 'Mixed', 'मिश्र']] },
  { id: 'access',    en: 'Parking & loading',  mr: 'पार्किंग',  opts: [['easy', 'Easy', 'सोपे'], ['restricted', 'Restricted', 'अडचणीचे']] },
  { id: 'cover',     en: 'Setting',            mr: 'जागा',      opts: [['indoor', 'Indoor', 'आत'], ['covered', 'Covered outdoor', 'छताखाली बाहेर'], ['open', 'Open air', 'उघड्यावर']] }
];

/* Costing reminders from the logistics recorded for an event (G-41). They are prompts only: nothing is added
   as an expense. `recorded` is true once the event has an expense under the matching item. */
const LOGISTIC_PROMPTS = [
  { key: 'generator', when: l => l.power === 'generator',  en: 'Generator required: add its rent and diesel',          mr: 'जनरेटर लागेल: भाडे व डिझेल नोंदवा', head: 'Generator / Power' },
  { key: 'kitchen', when: l => l.kitchen === 'temporary', en: 'Temporary kitchen: add setup and hired material',      mr: 'तात्पुरते किचन: साहित्य भाडे नोंदवा', head: 'Rented Material – भाड्याचे साहित्य' },
  { key: 'transport', when: l => l.gas === 'none',          en: 'No cooking at the venue: add transport of cooked food', mr: 'ठिकाणी स्वयंपाक नाही: वाहतूक नोंदवा', head: 'Transport – वाहतूक' },
  { key: 'water', when: l => l.water === 'arrange',     en: 'Water to arrange: add tanker or cans',                 mr: 'पाणी आणावे: टँकर नोंदवा', head: 'Water Tanker' },
  { key: 'equipment', when: l => ['rental', 'mixed'].includes(l.equipment), en: 'Hired equipment: add the rental',      mr: 'भाड्याचे साहित्य: भाडे नोंदवा', head: 'Rented Material – भाड्याचे साहित्य' },
  { key: 'access', when: l => l.access === 'restricted', en: 'Restricted parking/loading: allow extra transport or loading', mr: 'पार्किंग अडचण: जास्त वाहतूक/हमाली', head: 'Transport – वाहतूक' }
];
/* Each requirement needs its own expense: one added from a reminder carries that reminder's key (`logi`); an
   expense entered by hand under the same item counts for one reminder only, so one generator bill can never also
   mark the hired equipment as recorded. */
export function logisticsPrompts(ev, expenses) {
  const l = ev?.logistics; if (!l || typeof l !== 'object') return [];
  const mine = expenses.filter(x => x.evId === ev.id && !x.draft && x.cat === 'Operations');
  const active = LOGISTIC_PROMPTS.filter(p => p.when(l));
  const tagged = new Set(mine.filter(x => x.logi).map(x => x.logi));
  const spare = new Map();   // untagged expenses per item, handed out one per reminder
  for (const x of mine) if (!x.logi || !active.some(p => p.key === x.logi)) spare.set(x.head, (spare.get(x.head) || 0) + 1);
  return active.map(p => {
    let recorded = tagged.has(p.key);
    if (!recorded && spare.get(p.head) > 0) { spare.set(p.head, spare.get(p.head) - 1); recorded = true; }
    return { key: p.key, en: p.en, mr: p.mr, cat: 'Operations', head: p.head, recorded };
  });
}

// Repeat venue (G-42): details from the latest other event at the same venue name, to *suggest* only
export function venueSuggestion(events, venue, excludeId = '') {
  const key = String(venue || '').trim().toLowerCase(); if (!key) return null;
  const past = events.filter(e => e.id !== excludeId && String(e.venue || '').trim().toLowerCase() === key && (e.venueType || e.locality || (e.logistics && Object.keys(e.logistics).length)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  if (!past) return null;
  return { from: past.id, date: past.date, venueType: past.venueType || '', venueTypeOther: past.venueTypeOther || '', locality: past.locality || '', logistics: { ...(past.logistics || {}) } };
}

/* Menu packages from the rate card. A slab's rate applies from `min` guests up; below the
   smallest slab the smallest slab's rate is used. The bill stays editable on every event. */
export const MENUS = [
  { id: 'party', name: 'Party Special', slabs: [{ min: 100, rate: 750 }], items: [
    '1 Mocktail, 1 Fruit Juice', '2 Starters', '1 Chaat Counter', 'Any 1 (Paav Bhaji / Puri & Vegetable Gravy)',
    '1 South Indian Live Counter', 'Any 1 Live Counter (Pasta or Chinese or Pizza)', '1 Dessert (Cold / Ice Gola / Kulfi Candy)',
    'Russian Salad / Corn Salad, Papad', 'Water Bottles', 'Mukhwas'] },
  { id: 'standard', name: 'Standard', slabs: [{ min: 101, rate: 600 }], items: [
    '2 Flavoured Drinks', '2 Starters', '2 Veg Preparation', '(Any 1) Puri, Rumali, Phulka, Tawa Paratha', '1 Rice, 1 Dal',
    '1 Basic Sweet', 'Ice Cream (V / S / P)', 'Koshimbir, Papad, Pickle, Chutney', 'Water Bottles', 'Mukhwas'] },
  { id: 'silver', name: 'Silver', slabs: [{ min: 101, rate: 775 }, { min: 301, rate: 675 }], items: [
    '1 Mocktail, 1 Fruit Juice', '2 Starters', '2 Veg Preparation', '(Any 2) Puri, Rumali, Phulka, Tawa Paratha', '1 Rice, 1 Dal',
    '2 Indian Sweet (Basic, Milk)', 'Ice Cream (V / S / P)', 'Green Salad, Papad, Pickle, Chutney', 'Water Bottles', 'Mukhwas'] },
  { id: 'golden', name: 'Golden', slabs: [{ min: 101, rate: 900 }, { min: 301, rate: 800 }], items: [
    '1 Mocktail, 1 Fruit Juice', '2 Starters', '2 Veg Preparation', '(Any 2) Puri, Rumali, Phulka, Tawa Paratha', '1 Rice, 1 Dal',
    '2 Indian Sweet (Basic, Milk)', '(Any 2 Live) 1 Chaat / 2 Chinese / 2 Dakshin', '1 Special Ice Cream',
    'Green Salad, Papad, Pickle, Chutney', 'Water Bottles', 'Mukhwas'] },
  { id: 'platinum', name: 'Platinum', slabs: [{ min: 101, rate: 1100 }, { min: 301, rate: 1000 }], items: [
    '1 Mocktail, 2 Fruit Juice', '3 Starters', '1 Soup Station (Standard)', '3 Veg Preparation',
    '3 Roti (Puri, Rumali, Tawa Paratha, Tandoor Basket)', '2 Rice, 1 Dal', '3 Indian Sweets (1 Basic, 2 Milk)',
    '(Any 3 Live) 2 Chat / 2 Pasta / 2 Wok / 2 Dakshin', 'Sundae Ice Cream', 'Raita, Special Mix Salad, Papad, Pickle, Chutney',
    'Branded Water Bottles', 'Mukhwas Counter'] },
  { id: 'diamond', name: 'Diamond', slabs: [{ min: 101, rate: 1400 }, { min: 301, rate: 1300 }], items: [
    '2 Mocktail, 2 Fruit Juice', '4 Starters or Barbeque', '2 Soup Station (Standard & Special)', '3 Veg Preparation (Live Setup)',
    '3 Roti (Puri, Ulta Tawa Roti, Tandoor Basket)', '2 Rice, 2 Dal', '3 Indian Sweets (1 Basic, 1 Milk, 1 Special)',
    '(Any 4 Live) 2 Chat / 2 Dakshin / 2 Wok / 2 Fusion', '3 Types Ice Cream Parlour', 'Fruit Counter 5 Indian or 3 Dessert Station',
    'Special Salad Counter (5 items), PPC', 'Branded Water Bottles', 'Special Paan / Mukhwas Counter'] },
  // Traditional menus served on banana leaf: 50–150 and 151–300 pax slabs
  { id: 'udupi', leaf: true, name: 'Udupi (Basic)', slabs: [{ min: 50, rate: 700 }, { min: 151, rate: 650 }], items: [
    '1 Mocktail, 1 Fruit Juice', 'Payasa (Kadle Bele / Hesaru Bele)', '1 Dry Veg, 1 Ghasi', '1 Dry Veg, 1 Ghasi', '1 Flavored Rice',
    '1 Plain Rice', 'Tove (Dal), Ghee', 'Saaru (Rasam)', 'Huli (Sambar)', 'Papad', 'Menaskai (Sweet & Sour)',
    'Holige (Puranpoli) or Boondi Laddoo', 'Butter Milk', 'Water Bottles'] },
  { id: 'udupi-special', leaf: true, name: 'Udupi (Special)', slabs: [{ min: 50, rate: 775 }, { min: 151, rate: 725 }], items: [
    '1 Mocktail, 1 Fruit Juice', 'Payasa (Kadle Bele / Hesaru Bele)', 'Salt, Pickle, Chutney, Kosambari', 'Raita', '1 Dry Veg, 1 Ghasi',
    '1 Flavored Rice', '1 Plain Rice', 'Tove (Dal), Ghee', 'Tambuli or Udina Hittu', 'Saaru (Rasam)', 'Huli (Sambar)',
    'Menaskai (Sweet & Sour)', 'Papad, 2 Khara Item', 'Any 2 Basic Sweets', 'Curd & Butter Milk', 'Pan Supari or Beeda',
    'Water Bottles', 'Puri or Chapati (Optional)'] },
  { id: 'onam', leaf: true, name: 'Onam Sadhya', slabs: [{ min: 50, rate: 750 }, { min: 151, rate: 700 }], items: [
    '1 Mocktail, 1 Fruit Juice', 'Salt, Pickle', 'Puli Inji', 'Thair Pachadi, Sweet Pachadi', 'Kalan, Olan', 'Thoran', 'Avial',
    'Erissery or Kootu Curry', 'Banana Cut Chips, Jaggery Chips', 'Plain Rice', 'Sambhar', 'Paruppu, Ghee', 'Rasam', 'Papadam',
    'Pal Ada Payasam or Ada Pradhaman', 'Butter Milk', 'Yellow Banana', 'Water Bottles'] },
  { id: 'tamil', leaf: true, name: 'Tamil (Special)', slabs: [{ min: 50, rate: 750 }, { min: 151, rate: 700 }], items: [
    '1 Mocktail, 1 Fruit Juice', 'Pickle, Chutney', 'Sweet Pachadi, Thair Pachadi', 'Aviyal', 'Vatha Kuzhambu', 'Mor Kulambu', 'Rasam',
    'Kadamba Sambhar', 'Plain Rice, Paruppu, Ghee', 'Appalam', 'Pal Payasam', '1 Sweet Item', '1 Fried Item', '1 Flavored Rice',
    'Curd & Butter Milk', 'Mor Milagai (Curd Chilly)', 'Beeda, Water Bottles'] },
  { id: 'hubli', leaf: true, name: 'Hubli / Dharwad', slabs: [{ min: 50, rate: 750 }, { min: 151, rate: 700 }], items: [
    '1 Mocktail, 1 Fruit Juice', 'Salt, Pickle, Chutney, Kosambari', 'Kayirasa', 'Raita', 'Mudde Palya', 'Palya', 'Rice, Tove, Ghee',
    'Huli (Sambhar)', 'Saaru (Rasam)', '1 Flavored Rice', 'Holige (Puranpoli Gud), Milk, Ghee', 'Mix Bhajiya (Burburi)', 'Payasa',
    'Butter Milk', 'Ambika Appalam', 'Pan Supari, Water Bottles', 'Puri or Chapati (Optional)'] },
  { id: 'gsb', leaf: true, name: 'GSB', slabs: [{ min: 50, rate: 750 }, { min: 151, rate: 700 }], items: [
    '1 Mocktail, 1 Fruit Juice', 'Salt, Pickle, Chutney, Raita', '1 Upkari', '1 Ghasi', 'Fruit Saasam', 'Puri', 'Rice', 'Dali Toy, Ghee',
    'Saaru (Rasam)', 'Fried Papad', '1 Basic Sweet, Laddoo', 'Mix Bhajiya / Fodi', 'Butter Milk', 'Beeda or Mukhwas', 'Water Bottles',
    'Optional: Saat, Boondi Laddoo, Mixture Packet, Kaju Kadi'] },
  { id: 'maharashtrian', leaf: true, name: 'Maharashtrian', slabs: [{ min: 50, rate: 800 }, { min: 151, rate: 750 }], items: [
    '1 Mocktail, 1 Fruit Juice', 'Salt, Pickle, 2 Chutney (Sweet, Spicy)', 'Koshimbir, Papad, Kurdya', 'Any 1 (Mix Bhajya, Vadi)',
    'Any 2 (Puri, Phulka, Bhakri, Vade)', '1 Usal (Gravy Bhaji)', '1 Dry Veg, 1 Kurma / Mix Bhaji', 'Sadha Bhaat', 'Varan, Tup or Amti',
    'Masale Bhaat / Pulav', 'Tomato Saar / Kadhi', '2 Sweet (Basic, Milk)', 'Chaas or Mattha or Solkadhi', 'Water Bottles'] }
];

export function menuById(id) {
  return MENUS.find(m => m.id === id) || null;
}

// Per-plate rate of a menu for a guest count
export function menuRate(menu, guests) {
  if (!menu) return 0;
  const slabs = [...menu.slabs].sort((a, b) => a.min - b.min);
  let rate = slabs[0].rate;
  for (const s of slabs) if ((Number(guests) || 0) >= s.min) rate = s.rate;
  return rate;
}

export const PAY_MODES =['Cash – रोख','UPI','NEFT','Cheque – चेक','Bank – बँक'];

/* ── ID / DATE ───────────────────────────────────── */
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
}

// Local date, not UTC — toISOString() returns yesterday before 05:30 IST
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysSince(d) {
  if (!d) return 0;
  return Math.floor((new Date(today()) - new Date(d)) / 86400000);
}

/* ── HTML ESCAPING ───────────────────────────────── */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
}

export function fmtDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return '—';
  return date.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}

export function fmtCurrency(n) {
  const v = Number(n || 0);
  return (v < 0 ? '-₹' : '₹') + Math.abs(v).toLocaleString('en-IN');
}

/* ── VALIDATION ──────────────────────────────────── */
export function validate(rules, data) {
  const errors = {};

  for (const [field, checks] of Object.entries(rules)) {
    const val = data[field];

    if (checks.required && (val === undefined || val === null || String(val).trim() === '')) {
      errors[field] = checks.requiredMsg || `${field} is required`;
      continue;
    }

    if (checks.numeric && val !== undefined && val !== '') {
      const num = Number(val);
      if (!Number.isFinite(num) || num < 0 || num > 1e12 || Math.abs(num * 100 - Math.round(num * 100)) > .001) {
        errors[field] = checks.numericMsg || `${field} must be a positive number`;
        continue;
      }
      if (checks.min !== undefined && num < checks.min) {
        errors[field] = checks.minMsg || `${field} must be at least ${checks.min}`;
        continue;
      }
      if (checks.max !== undefined && num > checks.max) {
        errors[field] = checks.maxMsg || `${field} must be at most ${checks.max}`;
        continue;
      }
      if (checks.integer && !Number.isSafeInteger(num)) {
        errors[field] = `${field} must be a whole number`;
      }
    }

    if (checks.phone && val && val.trim()) {
      const digits = val.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 13) {
        errors[field] = 'Enter a valid mobile number';
      }
    }

    if (checks.date && val) {
      const d = new Date(val);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(val) || isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== val) {
        errors[field] = 'Enter a valid date';
      }
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export const EVENT_RULES = {
  name:    { required: true, requiredMsg: 'Event name – नाव आवश्यक आहे' },
  date:    { required: true, date: true, requiredMsg: 'Date – दिनांक आवश्यक आहे' },
  venue:   { required: true, requiredMsg: 'Venue – ठिकाण आवश्यक आहे' },
  billing: { required: true, numeric: true, min: 1, requiredMsg: 'Billing amount – बिल रक्कम आवश्यक आहे', minMsg: 'Billing must be > 0' },
  budget:  { numeric: true, min: 0 },
  guests:  { numeric: true, integer: true, min: 0 },
  mobile:  { phone: true }
};

export const EXPENSE_RULES = {
  evId: { required: true, requiredMsg: 'Select an event – कार्यक्रम निवडा' },
  amt:  { required: true, numeric: true, min: 1, requiredMsg: 'Amount – रक्कम आवश्यक आहे', minMsg: 'Amount must be > 0' },
  date: { required: true, date: true, requiredMsg: 'Date – दिनांक आवश्यक आहे' }
};

export const PAYMENT_RULES = {
  evId: { required: true, requiredMsg: 'Select an event – कार्यक्रम निवडा' },
  amt:  { required: true, numeric: true, min: 1, requiredMsg: 'Amount – रक्कम आवश्यक आहे', minMsg: 'Amount must be > 0' },
  date: { required: true, date: true, requiredMsg: 'Date – दिनांक आवश्यक आहे' }
};

export const VENDOR_RULES = {
  name:   { required: true, requiredMsg: 'Vendor name – विक्रेत्याचे नाव आवश्यक आहे' },
  phone:  { phone: true }
};

export const VPAY_RULES = {
  venId: { required: true, requiredMsg: 'Select a vendor – विक्रेता निवडा' },
  amt:   { required: true, numeric: true, min: 1, requiredMsg: 'Amount – रक्कम आवश्यक आहे', minMsg: 'Amount must be > 0' },
  date:  { required: true, date: true, requiredMsg: 'Date – दिनांक आवश्यक आहे' }
};

/* ── MONEY IN PAISE ──────────────────────────────── */
// Amounts are stored in rupees (up to two decimals, as validated on import and entry). Totals are added
// in whole paise so they are exact (no 0.1 + 0.2 drift). One rounding rule: half a paisa or more rounds
// away from zero.
export function toPaise(rupees) {
  const n = Number(rupees);
  if (!Number.isFinite(n)) return 0;
  const [whole, frac] = Math.abs(n).toFixed(6).split('.');
  const p = Number(whole) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0);
  return n < 0 ? -p : p;
}
export const fromPaise = p => p / 100;
export const sumRupees = (list, get = x => x.amt) => fromPaise(list.reduce((s, x) => s + toPaise(get(x)), 0));

/* ── BUSINESS CALCULATIONS ───────────────────────── */
export function calcEventReceived(eventId, cPays) {
  return sumRupees(cPays.filter(p => p.evId === eventId));
}

// Every recorded expense counts, paid or still on credit: an unpaid bill is a recorded cost (D-4)
export function calcEventExpenses(eventId, expenses) {
  return sumRupees(expenses.filter(x => x.evId === eventId && !x.draft));
}

// `profit` is the event's contribution (bill − its recorded costs), before company overheads
export function calcEventPL(ev, cPays, expenses) {
  const received = calcEventReceived(ev.id, cPays);
  const expTotal = calcEventExpenses(ev.id, expenses);
  const pending  = fromPaise(toPaise(ev.billing) - toPaise(received));
  const profit   = fromPaise(toPaise(ev.billing) - toPaise(expTotal));
  const margin   = ev.billing > 0 ? Math.round(profit / ev.billing * 100) : 0;
  const pctPaid  = ev.billing > 0 ? Math.min(100, received / ev.billing * 100) : 0;
  // Per-plate figures need a guest count; budget figures need an expected cost
  const guests   = Number(ev.guests) || 0;
  const budget   = Number(ev.budget) || 0;
  const perPlate = n => guests ? Math.round(n / guests) : null;
  return {
    received, expTotal, pending, profit, margin, pctPaid,
    guests, billPerPlate: perPlate(ev.billing), costPerPlate: perPlate(expTotal), profitPerPlate: perPlate(profit),
    budget, budgetUsed: budget ? Math.round(expTotal / budget * 100) : null, overBudget: budget ? expTotal - budget : 0
  };
}

/* Cost per plate by category for an event, against its usual: the same categories averaged
   over the other events on the same menu (else the same type) that have guests and costs.
   `costs` is a Map evId → Map cat → amount, built once by the caller. */
export function costByCategory(events, expenses) {
  const costs = new Map();
  for (const x of expenses) {
    if (x.draft) continue;
    if (!costs.has(x.evId)) costs.set(x.evId, new Map());
    const m = costs.get(x.evId);
    m.set(x.cat || 'Other', fromPaise(toPaise(m.get(x.cat || 'Other') || 0) + toPaise(x.amt)));
  }
  return costs;
}

// "Usual" comes only from reconciled events (`done`: their ids), whose costs are known to be complete
export function costVsUsual(ev, events, costs, done = new Set()) {
  const guests = Number(ev.guests) || 0;
  const mine = costs.get(ev.id);
  if (ev.outsourced || !guests || !mine) return null;
  const usable = e => e.id !== ev.id && !e.outsourced && Number(e.guests) > 0 && costs.has(e.id) && done.has(e.id);
  let peers = ev.menu ? events.filter(e => usable(e) && e.menu === ev.menu) : [];
  let basis = peers.length ? 'menu' : 'type';
  if (!peers.length) peers = events.filter(e => usable(e) && e.type === ev.type);
  if (!peers.length) return null;
  const plates = peers.reduce((s, e) => s + Number(e.guests), 0);
  const usual = new Map();
  for (const e of peers) for (const [cat, amt] of costs.get(e.id)) usual.set(cat, (usual.get(cat) || 0) + amt);
  const cats = new Set([...mine.keys(), ...usual.keys()]);
  const rows = [...cats].map(cat => {
    const m = Math.round((mine.get(cat) || 0) / guests), u = Math.round((usual.get(cat) || 0) / plates);
    return { cat, mine: m, usual: u, diff: m - u, pct: u ? Math.round((m - u) / u * 100) : null };
  }).sort((a, b) => b.diff - a.diff);
  return { basis, n: peers.length, guests, rows };
}

/* Vendor spend per guest: for each vendor and item, what you paid per plate at their latest event against
   their average per plate at earlier events. This is spend per guest, not the vendor's unit price: a
   change of menu, quantity or service also moves it. Reconciled events only (a half-entered event would
   look like a change); outsourced events and events without guests are left out. Flags rises of 8%+. */
export function priceCreep(expenses, events, minPct = 8) {
  const done = reconciledIds(events, expenses);
  const evs = new Map(events.filter(e => Number(e.guests) > 0 && !e.outsourced && done.has(e.id)).map(e => [e.id, e]));
  const sums = new Map();   // venId|head → Map evId → amount
  for (const x of expenses) {
    if (!x.venId || !x.head || !evs.has(x.evId)) continue;
    const k = x.venId + '|' + x.head;
    if (!sums.has(k)) sums.set(k, new Map());
    const m = sums.get(k); m.set(x.evId, (m.get(x.evId) || 0) + (Number(x.amt) || 0));
  }
  const out = [];
  for (const [k, byEv] of sums) {
    const rows = [...byEv].map(([evId, amt]) => ({ ev: evs.get(evId), pp: amt / Number(evs.get(evId).guests) }))
      .sort((a, b) => a.ev.date.localeCompare(b.ev.date));
    if (rows.length < 2) continue;
    const latest = rows.at(-1), before = rows.slice(0, -1);
    const avg = before.reduce((s, r) => s + r.pp, 0) / before.length;
    const pct = Math.round((latest.pp - avg) / avg * 100);
    if (pct >= minPct) {
      const [venId, head] = k.split('|');
      out.push({ venId, head, latest: Math.round(latest.pp), avg: Math.round(avg), pct, n: before.length, ev: latest.ev });
    }
  }
  return out.sort((a, b) => b.pct - a.pct);
}

/* What a menu has actually cost per plate: reconciled events on that menu with a guest count. Events whose
   costs are still pending would understate the cost (G-22). */
export function menuCostPerPlate(menuId, events, expenses, excludeId = '') {
  const done = reconciledIds(events, expenses);
  const spent = new Map();
  for (const x of expenses) if (!x.draft) spent.set(x.evId, (spent.get(x.evId) || 0) + toPaise(x.amt));
  let guests = 0, cost = 0, n = 0;
  for (const e of events) {
    if (e.menu !== menuId || e.id === excludeId || e.outsourced || !(Number(e.guests) > 0) || !spent.get(e.id) || !done.has(e.id)) continue;
    guests += Number(e.guests); cost += spent.get(e.id); n++;
  }
  return n ? { n, perPlate: Math.round(fromPaise(cost) / guests) } : null;
}

/* ── RECONCILIATION (D-4, P1-B) ──────────────────── */
/* Two separate things:
   - Operational status, from the date only: upcoming, today or held. Never stored.
   - Financial reconciliation, stored on the event as `recon` when the owner confirms that every cost is in
     (the checks below). Until then the event's contribution is provisional. `recon` keeps a snapshot of
     everything that decides the contribution: each cost (id and paise), the bill and the guest count. If any
     of them changes afterwards, the event is "reopened": provisional again, with what changed shown, and
     nothing rewritten. Each reconcile and reopen is appended to `reconHistory`, which is never edited.
   Paid or unpaid makes no difference: an unpaid bill is a recorded cost. Old events have no `recon` and are
   simply pending; no existing record is changed. */
export const RECON_CHECKS = [
  { id: 'bills',  en: 'All supplier and vendor bills for this event are entered, paid or not', mr: 'या कार्यक्रमाची सर्व विक्रेता बिले नोंदवली (भरलेली असो वा नसो)' },
  { id: 'shared', en: 'Shared purchases (stock or one bill for several events) have this event’s share entered', mr: 'एकत्र खरेदीचा (साठा / अनेक कार्यक्रमांचे एक बिल) या कार्यक्रमाचा वाटा नोंदवला' },
  { id: 'final',  en: 'Final guest count, extra plates and bill adjustments with the client are entered', mr: 'अंतिम पाहुणे, जास्त ताटे व ग्राहकाशी बिलातील बदल नोंदवले' }
];

export function eventStage(ev) {
  const d = daysSince(ev.date);
  return d < 0 ? 'upcoming' : d === 0 ? 'today' : 'held';
}

function costRows(evId, expenses) { return expenses.filter(x => x.evId === evId && !x.draft); }
const fnv = keys => { let h = 2166136261; for (const ch of keys.join('|')) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };
function snapshotOf(ev, rows) {
  // sig: each cost's id and amount (reconciliations made by 4.2–4.4 hold only this one)
  // sig2: also its vendor, category and item, so a cost moved to another vendor or item with the same amount is caught
  return { n: rows.length, costPaise: rows.reduce((s, x) => s + toPaise(x.amt), 0),
    sig: fnv(rows.map(x => `${x.id}:${toPaise(x.amt)}`).sort()),
    sig2: fnv(rows.map(x => `${x.id}:${toPaise(x.amt)}:${x.venId || ''}:${x.cat || ''}:${x.head || ''}`).sort()),
    billPaise: toPaise(ev.billing), guests: Number(ev.guests) || 0 };
}
export function reconSnapshot(ev, expenses) { return snapshotOf(ev, costRows(ev.id, expenses)); }

function compare(ev, snap) {
  const r = ev.recon;
  if (!r || typeof r !== 'object') return { state: 'pending', changes: [] };
  const changes = [];
  if (snap.sig !== r.sig || snap.n !== r.n || snap.costPaise !== r.costPaise) changes.push({ what: 'costs', from: fromPaise(r.costPaise || 0), to: fromPaise(snap.costPaise) });
  else if (r.sig2 && snap.sig2 !== r.sig2) changes.push({ what: 'details' });   // same amounts, but a vendor, category or item changed
  if (snap.billPaise !== r.billPaise) changes.push({ what: 'bill', from: fromPaise(r.billPaise || 0), to: fromPaise(snap.billPaise) });
  if (snap.guests !== r.guests) changes.push({ what: 'guests', from: r.guests || 0, to: snap.guests });
  return changes.length ? { state: 'reopened', changes, at: r.at } : { state: 'reconciled', changes, at: r.at };
}
// { state: 'pending' | 'reconciled' | 'reopened', changes: [{ what: 'costs'|'bill'|'guests', from, to }], at }
export function reconStatus(ev, expenses) { return compare(ev, reconSnapshot(ev, expenses)); }

export function reconciledIds(events, expenses) {
  const by = new Map();
  for (const x of expenses) { if (x.draft) continue; if (!by.has(x.evId)) by.set(x.evId, []); by.get(x.evId).push(x); }
  return new Set(events.filter(e => e.recon && compare(e, snapshotOf(e, by.get(e.id) || [])).state === 'reconciled').map(e => e.id));
}

// What stops an event being reconciled right now (shown in the checklist; the ticks are the owner's to give)
export function reconBlockers(ev, expenses, drafts = []) {
  const out = [];
  if (eventStage(ev) === 'upcoming') out.push({ en: 'The event has not happened yet', mr: 'कार्यक्रम अजून झालेला नाही' });
  if (!costRows(ev.id, expenses).length) out.push({ en: 'No costs are recorded for this event', mr: 'या कार्यक्रमाचा खर्च नोंदवलेला नाही' });
  const open = drafts.filter(d => d.evId === ev.id).length;
  if (open) out.push({ en: `${open} bill photo${open > 1 ? 's' : ''} for this event still to be filled in`, mr: `या कार्यक्रमाची ${open} बिले भरायची बाकी` });
  return out;
}

// The record fields to save when the owner reconciles: a new snapshot, and the history with this entry added
export function reconcileFields(ev, expenses, checks, at = new Date().toISOString()) {
  const snap = reconSnapshot(ev, expenses);
  const prior = compare(ev, snap);
  const history = Array.isArray(ev.reconHistory) ? [...ev.reconHistory] : [];
  if (prior.state === 'reopened') history.push({ action: 'reopened', at, since: prior.at, changes: prior.changes });
  history.push({ action: 'reconciled', at, checks: [...checks], costPaise: snap.costPaise, billPaise: snap.billPaise, guests: snap.guests });
  return { recon: { at, checks: [...checks], ...snap }, reconHistory: history };
}

// The owner reopens a reconciled event by hand (e.g. a late bill is expected): the snapshot is removed, the history kept
export function reopenFields(ev, reason = 'manual', at = new Date().toISOString()) {
  const history = Array.isArray(ev.reconHistory) ? [...ev.reconHistory] : [];
  history.push({ action: 'reopened', at, since: ev.recon?.at || '', reason });
  return { recon: null, reconHistory: history };
}

/* Usual costs for an event, taken from the latest other event with costs on the same menu
   (else of the same type): one line per item, with what it cost there and whether this
   event has it recorded yet. Catches costs that were forgotten. */
export function costChecklist(ev, events, expenses) {
  if (ev.outsourced) return null;
  const norm = v => String(v || '').split(' – ')[0].trim().toLowerCase();
  // The reference is the latest *reconciled* event: its costs are known to be complete
  const done = reconciledIds(events, expenses);
  const others = events.filter(e => e.id !== ev.id && !e.outsourced && done.has(e.id)).sort((a, b) => b.date.localeCompare(a.date));
  const ref = (ev.menu && others.find(e => e.menu === ev.menu)) || others.find(e => e.type === ev.type);
  if (!ref) return null;
  const items = new Map();
  for (const x of expenses.filter(x => x.evId === ref.id).sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
    const key = norm(x.head || x.cat);
    const it = items.get(key) || { cat: x.cat, head: x.head, amt: 0, venId: '' };
    it.amt += Number(x.amt) || 0;
    if (x.venId) it.venId = x.venId;
    items.set(key, it);
  }
  const mine = new Map();
  for (const x of expenses.filter(x => x.evId === ev.id)) {
    const key = norm(x.head || x.cat);
    mine.set(key, (mine.get(key) || 0) + (Number(x.amt) || 0));
  }
  const list = [...items].map(([key, it]) => ({ ...it, done: mine.get(key) || 0 }))
    .sort((a, b) => (!!a.done - !!b.done) || (b.amt - a.amt));
  return { ref, list, missing: list.filter(i => !i.done).length };
}

/* Credit purchases still unpaid, each with what's left on it. Vendor payments aren't
   tied to a particular purchase, so they settle that vendor's oldest credit first. */
export function unpaidCredit(expenses, vPays) {
  const byVendor = new Map();
  for (const x of expenses) {
    if (!isOnCredit(x) || !x.venId) continue;
    const vId = String(x.venId).trim();
    if (!byVendor.has(vId)) byVendor.set(vId, []);
    byVendor.get(vId).push(x);
  }
  const out = [];
  for (const [venId, xs] of byVendor) {
    let pool = vPays.filter(p => String(p.venId ?? '').trim() === venId).reduce((s, p) => s + (Number(p.amt) || 0), 0);
    xs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    for (const x of xs) {
      const covered = Math.min(pool, x.amt || 0);
      pool -= covered;
      const left = (Number(x.amt) || 0) - covered;
      if (left > 0) out.push({ x, left });
    }
  }
  return out;
}

// Days from today until a YYYY-MM-DD date (negative = past)
export function daysUntil(d) {
  return -daysSince(d);
}

export function addDays(iso, n) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* An expense is either paid on the spot (pay: 'paid') or taken on credit from
   its vendor (pay: 'credit'). Older records have no `pay` field; a vendor-linked
   one was always treated as owed, so it stays credit. */
/* ── EVENT MENU → COUNTER ORDERS ─────────────────── */
// Words in a dish name that tell which live counter supplies it. Anything not matched is
// cooked in your own kitchen. Your own choices (tap a dish → counter) win over this list.
const DISH_WORDS = [
  ['Chaat', ['pani puri', 'panipuri', 'golgappa', 'gol gappa', 'sev puri', 'dahi puri', 'bhel', 'ragda', 'chaat', 'chat', 'papdi', 'aloo tikki', 'dahi vada', 'dahi bhalla', 'basket']],
  ['Dosa', ['dosa', 'idli', 'uttapam', 'uthappam', 'appam', 'medu vada', 'dakshin', 'south indian']],
  ['Chinese', ['noodle', 'manchurian', 'hakka', 'schezwan', 'szechuan', 'chopsuey', 'chop suey', 'wok', 'spring roll', 'momo', 'chilli paneer', 'chilli potato']],
  ['Pav Bhaji Counter', ['pav bhaji', 'pavbhaji']],
  ['Pizza / Italian Counter', ['pizza', 'pasta', 'garlic bread', 'lasagna', 'italian']],
  ['Soup Station', ['soup']],
  ['Barbeque / Tandoor', ['barbeque', 'barbecue', 'bbq', 'tandoor']],
  ['Starter', ['tikka', 'kebab', 'kabab', 'cutlet', 'starter', 'crispy', 'nuggets', 'shashlik']],
  ['Kulfi / Ice Gola', ['kulfi', 'gola']],
  ['Ice Cream', ['ice cream', 'icecream', 'sundae', 'gelato']],
  ['Paan Mukhwas', ['paan', 'mukhwas', 'beeda', 'meetha pan']],
  ['Beverage Counter', ['mocktail', 'mojito', 'cold coffee', 'shake', 'lassi', 'soda', 'beverage']],
  ['Fruit Counter', ['fruit counter', 'fruit platter', 'cut fruit']],
  ['Salad Counter', ['salad counter']],
  ['Dessert Counter', ['jalebi', 'rabdi', 'malpua', 'dessert counter']],
  ['Fusion Counter', ['fusion', 'taco', 'nachos', 'burger', 'sizzler']]
];

const dishKey = name => String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();

// The full Live Counter item for a short name ('Chaat' → 'Chaat – चाट')
export function counterHead(short) {
  return EXPENSE_HEADS['Live Counter'].find(h => h.split(' – ')[0] === short) || '';
}

// What you have assigned dishes to before (latest wins), from every event's menu
export function learnedDishes(events) {
  const map = new Map();
  for (const e of [...events].sort((a, b) => (a.date || '').localeCompare(b.date || '')))
    for (const d of e.dishes || []) if (d.manual) map.set(dishKey(d.name), d.head || '');
  return map;
}

export function dishCounter(name, learned) {
  const k = dishKey(name);
  if (learned?.has(k)) return learned.get(k);
  for (const [short, words] of DISH_WORDS) if (words.some(w => k.includes(w))) return counterHead(short);
  return '';
}

// Pasted menu text (WhatsApp message, Google Lens copy, a typed list) → dish names
export function parseMenu(text) {
  const seen = new Set(), out = [];
  for (let line of String(text || '').split(/\n|,|;|•|·|\|/)) {
    line = line.replace(/^\s*(\d+[.)]|[-*–>]+)\s*/, '').replace(/\s+/g, ' ').trim();
    if (/:./.test(line)) line = line.slice(line.lastIndexOf(':') + 1).trim();   // "Welcome drink: Mango mojito
    if (line.length < 2 || line.length > 60 || line.endsWith(':')) continue;
    const k = dishKey(line);
    if (!seen.has(k)) { seen.add(k); out.push(line); }
  }
  return out;
}

/* The vendors store also holds people who aren't suppliers — a friend, relative or
   financier who lent money or paid a bill for you (kind: 'person'). They share the
   vendors' credit and repayment records but never appear as suggested suppliers. */
export function isPerson(v) {
  return v?.kind === 'person';
}

export function isOnCredit(x) {
  return x.pay ? x.pay === 'credit' : !!x.venId;
}

export function calcVendorBalance(vendorId, expenses, vPays) {
  const vIdStr   = String(vendorId ?? '').trim();
  const mine     = expenses.filter(x => String(x.venId ?? '').trim() === vIdStr);
  const pays     = vPays.filter(p => String(p.venId ?? '').trim() === vIdStr);
  const supplied = mine.reduce((s, x) => s + (Number(x.amt) || 0), 0);
  const credit   = mine.filter(isOnCredit).reduce((s, x) => s + (Number(x.amt) || 0), 0);
  const paidNow  = supplied - credit;
  const paid     = paidNow + pays.reduce((s, p) => s + (Number(p.amt) || 0), 0);
  return {
    supplied, credit, paid,
    credited: supplied,              // kept for older callers
    balance: credit - (paid - paidNow),
    entries: mine.length + pays.length
  };
}

/* ── PERIODS ─────────────────────────────────────── */
export const PERIODS = {
  month: 'This month – हा महिना',
  '3m':  '3 months – ३ महिने',
  fy:    'This FY – हे आर्थिक वर्ष',
  all:   'All time – सर्व'
};

// Start date (YYYY-MM-DD) of a period, or '' for all time. FY runs April–March.
export function periodStart(period) {
  const d = new Date(today());
  const y = d.getFullYear(), m = d.getMonth();
  const iso = (yy, mm) => `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
  if (period === 'month') return iso(y, m);
  if (period === '3m')    { const s = new Date(y, m - 2, 1); return iso(s.getFullYear(), s.getMonth()); }
  if (period === 'fy')    return iso(m >= 3 ? y : y - 1, 3);
  return '';
}

// Events dated in the period, plus the payments and expenses that belong to them
export function sliceByPeriod(D, period) {
  const start = periodStart(period);
  if (!start) return D;
  const events = D.events.filter(e => (e.date || '') >= start);
  const ids = new Set(events.map(e => e.id));
  return {
    ...D, events,
    expenses: D.expenses.filter(x => ids.has(x.evId)),
    cPays:    D.cPays.filter(p => ids.has(p.evId))
  };
}

// Past events with no expense recorded — their profit figure is not real yet
export function eventsMissingCosts(events, expenses) {
  const withCosts = new Set(expenses.map(x => x.evId));
  return events.filter(e => isOverdue(e) && !withCosts.has(e.id) && !e.outsourced)
               .sort((a, b) => b.date.localeCompare(a.date));
}

/* ── INSIGHTS ────────────────────────────────────── */
export function generateInsights(events, cPays, expenses, vendors, vPays = []) {
  if (!events.length) return [];
  const insights = [];

  const evPL = events.map(ev => ({
    ev,
    ...calcEventPL(ev, cPays, expenses)
  }));

  // Each insight carries an English and a Marathi sentence (HTML-escaped; <b> marks names/amounts)
  const b = t => `<b>${t}</b>`;

  // Costing gaps first — without expenses an event's profit is overstated
  const missing = eventsMissingCosts(events, expenses);
  if (missing.length) {
    insights.push({ type: 'alert', icon: 'receipt',
      en: `${b(missing.length)} past event${missing.length > 1 ? 's have' : ' has'} no expenses recorded — profit is overstated`,
      mr: `${b(missing.length)} मागील कार्यक्रमांचा खर्च नोंदवलेला नाही — नफा जास्त दिसतो` });
  }

  // Best event: reconciled events only, whose contribution is final (a provisional figure can look best)
  const done = reconciledIds(events, expenses);
  const costed = evPL.filter(r => done.has(r.ev.id));
  const best = costed.length ? costed.reduce((a, c) => a.profit > c.profit ? a : c, costed[0]) : null;
  if (best && best.profit > 0) {
    const n = b(esc(best.ev.name)), amt = b(fmtCurrency(best.profit));
    insights.push({ type: 'success', icon: 'trophy',
      en: `Best reconciled event: ${n} with ${amt} contribution`,
      mr: `सर्वोत्तम जुळवलेला कार्यक्रम: ${n} — ${amt} योगदान` });
  }

  // Loss-making events
  const losses = evPL.filter(r => r.profit < 0).sort((a, c) => a.profit - c.profit).slice(0, 3);
  if (losses.length) {
    const names = losses.map(r => b(esc(r.ev.name))).join(', ');
    insights.push({ type: 'alert', icon: 'warn',
      en: `${losses.length} event${losses.length > 1 ? 's' : ''} made a loss: ${names}`,
      mr: `तोट्यातील कार्यक्रम (${losses.length}): ${names}` });
  }

  // Highest expense category
  const byCat = {};
  expenses.forEach(x => { byCat[x.cat] = (byCat[x.cat] || 0) + x.amt; });
  const topCat = Object.entries(byCat).sort((a, c) => c[1] - a[1])[0];
  if (topCat) {
    const amt = b(fmtCurrency(topCat[1]));
    insights.push({ type: 'info', icon: 'chart',
      en: `Biggest cost: ${b(esc(topCat[0]))} at ${amt}`,
      mr: `सर्वाधिक खर्च: ${b(esc(topCat[0]))} — ${amt}` });
  }

  // Overdue collections — only events whose date has passed
  const overdue = evPL.filter(r => r.pending > 0 && isOverdue(r.ev));
  if (overdue.length) {
    const amt = b(fmtCurrency(overdue.reduce((s, r) => s + r.pending, 0)));
    insights.push({ type: 'alert', icon: 'alert',
      en: `${amt} overdue from ${overdue.length} event${overdue.length > 1 ? 's' : ''}`,
      mr: `${overdue.length} कार्यक्रमांची ${amt} थकीत वसुली` });
  }

  // Events that have spent more than their expected cost
  const over = evPL.filter(r => r.budget && r.overBudget > 0).sort((a, c) => c.overBudget - a.overBudget);
  if (over.length) {
    const top = over[0];
    const n = b(esc(top.ev.name)), amt = b(fmtCurrency(top.overBudget));
    insights.push({ type: 'alert', icon: 'warn',
      en: over.length > 1 ? `${over.length} events are over budget — ${n} by ${amt}` : `${n} is ${amt} over budget`,
      mr: over.length > 1 ? `${over.length} कार्यक्रम बजेटपेक्षा जास्त — ${n} ${amt} ने` : `${n} बजेटपेक्षा ${amt} जास्त` });
  }

  // Vendor dues — net of payments made; advances to one vendor don't offset dues to another
  const totalVenBal = vendors.reduce((s, v) => {
    const { balance } = calcVendorBalance(v.id, expenses, vPays);
    return s + Math.max(0, balance);
  }, 0);
  if (totalVenBal > 0) {
    const amt = b(fmtCurrency(totalVenBal));
    insights.push({ type: 'warning', icon: 'store',
      en: `You owe vendors ${amt}`,
      mr: `विक्रेत्यांची थकबाकी: ${amt}` });
  }

  return insights;
}

// An event's balance is overdue once the event date has passed
export function isOverdue(ev) {
  return daysSince(ev.date) > 0;
}

/* ── PIN HELPERS ─────────────────────────────────── */
// Old format (v2.0): a 32-bit string hash. Kept only to verify PINs set before v2.1.
function legacyHash(pin) {
  let h = 0;
  for (let i = 0; i < pin.length; i++) {
    h = ((h << 5) - h) + pin.charCodeAt(i);
    h = h & h;
  }
  return `ffpin_${Math.abs(h).toString(36)}_${pin.length}`;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Salted SHA-256, stored as "sha256$<salt>$<hex>". A 4-digit PIN is still guessable
// offline by someone with the device's storage; this stops casual reading of the hash.
export async function hashPin(pin) {
  if (!crypto?.subtle) return legacyHash(pin); // non-secure context (e.g. file://)
  const salt = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
  return `sha256$${salt}$${await sha256Hex(salt + pin)}`;
}

export async function verifyPin(input, stored) {
  if (!stored) return false;
  if (stored.startsWith('sha256$')) {
    const [, salt, hex] = stored.split('$');
    return crypto?.subtle ? (await sha256Hex(salt + String(input))) === hex : false;
  }
  return legacyHash(String(input)) === stored;
}

export function isLegacyPinHash(stored) {
  return !!stored && !stored.startsWith('sha256$');
}

