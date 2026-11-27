/**
 * i18n.js — CaterDesk v2
 * Language display: 'both' (English – मराठी), 'en', 'mr' or 'hi' (Hinglish, 5.6.0).
 *
 * Hinglish: the English side, with the words people use every day swapped for familiar Roman-script Hindi
 * ("Kharcha jodo", "Udhaar"). Same rewriting of text nodes, same originals: stored data, typed names, documents and
 * WhatsApp messages are never changed (they do not pass through here). Phrases not in the list stay in English.
 *
 * The app's copy is written as "English – मराठी" pairs, and stored data
 * (expense heads, event types, payment modes) uses the same form. Rather than
 * rewrite every string, a MutationObserver rewrites text nodes as they are
 * rendered, keeping the original so switching language is instant.
 *
 * Sentences that don't split cleanly use <span class="t-en"> / <span class="t-mr">,
 * shown or hidden by CSS on html[data-lang].
 * Anything inside [data-nl] (user-typed names, notes) is never touched.
 */

const KEY   = 'ffv2_lang';
const MODES = ['both', 'en', 'mr', 'hi'];
const DEV   = /[ऀ-ॿ]/;
// "<English> – <Marathi>": English side has no Devanagari, Marathi side has some
const PAIR  = /^(\s*)([^ऀ-ॿ]*?\S)\s+–\s+(.*[ऀ-ॿ].*?)(\s*)$/s;

const HI = {
  'Home': 'Home',
  'Expenses': 'Kharche',
  'Today': 'Aaj',
  'Tomorrow': 'Kal',
  'Quick actions': 'Jaldi kaam',
  'New event': 'Naya event',
  'Add expense': 'Kharcha jodo',
  'Snap a bill': 'Bill ki photo lo',
  'Add vendor': 'Vendor jodo',
  'Quick event (small job)': 'Chhota event',
  'Quick event': 'Chhota event',
  'Pending work': 'Baaki kaam',
  'Nothing pending': 'Kuch baaki nahi',
  'Money overview': 'Paison ka hisaab',
  'Received': 'Mila',
  'Pending': 'Baaki',
  'Save': 'Save karo',
  'Cancel': 'Cancel karo',
  'Go back': 'Wapas jao',
  'Edit': 'Badlo',
  'Delete': 'Delete karo',
  'Share': 'Share karo',
  'Copy': 'Copy karo',
  'Back up': 'Backup lo',
  'Paid now': 'Abhi diya',
  'On credit': 'Udhaar',
  'Paid': 'Diya',
  'Rate not set': 'Rate nahi dala',
  'Guests': 'Mehmaan',
  'Date': 'Tareekh',
  'Venue': 'Jagah',
  'Event name': 'Event ka naam',
  'Amount': 'Raqam',
  'For': 'Kis liye',
  'Notes': 'Notes',
  'Labour': 'Labour',
  'Labour sheet': 'Labour sheet',
  'Worker': 'Kaamgaar',
  'Contractor': 'Thekedaar',
  'By order': 'Order pe',
  'By shift': 'Shift pe',
  'Meal': 'Khana',
  'People': 'Log',
  'Dishes from the menu': 'Menu ki dishes',
  'Other work': 'Aur kaam',
  'Closing report': 'Hisaab report',
  'Guest count': 'Mehmaan ginti',
  'Final settlement': 'Final hisaab',
  'Find item': 'Item dhundo',
  'Usual items': 'Roz ke items',
  'Menu by meal': 'Khane ke hisaab se menu',
  'Add menu': 'Menu jodo',
  'Use these dishes': 'Ye dishes lo',
  'Contractors': 'Thekedaar',
  'Send list': 'List bhejo',
  'Pay': 'Pay karo',
  'Send on WhatsApp': 'WhatsApp pe bhejo',
  'I have sent it': 'Bhej diya',
  'Supplier confirmed': 'Supplier ne pakka kiya',
  "What's new": 'Naya kya hai',
  'Language': 'Bhasha',
  'Record costs': 'Kharche likho',
  'Expense': 'Kharcha',
  'What': 'Kya',
  'Place': 'Jagah',
  'Plates': 'Plates',
  'Received now ₹': 'Abhi mila ₹',
  'Bill ₹': 'Bill ₹',
  'Items already entered? Attach this bill': 'Items pehle likhe? Ye bill jodo',
  'To buy': 'Kharidna hai',
  'Order': 'Order karo',
  'Transport included': 'Bhada shaamil',
  'Note': 'Note',
  'Agreed ₹': 'Tay ₹',
  'Final ₹ (later)': 'Final ₹ (baad mein)',
  'Transport ₹': 'Bhada ₹',
  'Asked for (people)': 'Kitne bulaye',
  'How many came in each shift': 'Har shift mein kitne aaye',
  'Category': 'Category',
  'Supplier': 'Supplier',
  'Quantity': 'Kitna',
  'Unit': 'Unit',
  'Delivery date': 'Delivery ki tareekh',
  'Deliver by': 'Kab tak',
  'Delivery instructions': 'Delivery ki baat',
  'More items in this order': 'Isi order mein aur',
  'Contractor confirmed (no charge yet is fine)': 'Thekedaar ne haan kaha',
  'Requested': 'Maanga',
  'Confirmed': 'Pakka',
  'Charge agreed': 'Rate tay',
  'Final charge': 'Final rate',
  'Dismiss': 'Hatao',
  "See what's new": 'Naya dekho',
  'Current version': 'Abhi ka version',
  'Function sheet': 'Function sheet',
  'Payment plan': 'Payment plan',
  'Quote': 'Quotation',
  'Received by': 'Kaise mila',
  'Who does it': 'Kaun karega',
};
const hi = s => Object.hasOwn(HI, s) ? HI[s] : s;
// A whole text node of plain English ("Save") or the English side of a pair ("Save – जतन"), spacing kept
function hinglish(text) {
  const m = PAIR.exec(text);
  if (m) return m[1] + hi(m[2]) + m[4];
  const t = /^(\s*)(.*?)(\s*)$/s.exec(text);
  return t[1] + hi(t[2]) + t[3];
}

let mode = 'en';   // default until the user picks a language in Settings
const originals = new WeakMap();   // text node → original "English – मराठी" string

export function L(text) {
  if (mode === 'hi' && text) return hinglish(text);
  if (mode === 'both' || !text || !DEV.test(text)) return text;
  const m = PAIR.exec(text);
  if (!m) return text;
  return m[1] + (mode === 'en' ? m[2] : m[3]) + m[4];
}

function skip(node) {
  const p = node.parentElement;
  return !p || p.closest('[data-nl], script, style, textarea');
}

function fixNode(node) {
  if (skip(node)) return;
  let orig = originals.get(node);
  // The app changed this node's text since we last saw it → that's the new original
  if (orig === undefined || node.data !== L(orig)) { orig = node.data; originals.set(node, orig); }
  const want = L(orig);
  if (node.data !== want) node.data = want;
}

function walk(root) {
  if (root.nodeType === Node.TEXT_NODE) { fixNode(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) fixNode(n);
}

export function initLang() {
  try { const s = localStorage.getItem(KEY); if (MODES.includes(s)) mode = s; } catch {}
  document.documentElement.dataset.lang = mode;
  walk(document.body);
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'characterData') fixNode(m.target);
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

export function getLang() { return mode; }

export function setLang(next) {
  if (!MODES.includes(next)) return;
  mode = next;
  document.documentElement.dataset.lang = mode;
  try { localStorage.setItem(KEY, mode); } catch {}
  // Re-derive every node from its stored original
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    if (skip(n)) continue;
    const orig = originals.get(n);
    if (orig !== undefined) n.data = L(orig); else fixNode(n);
  }
}
