/**
 * app.js — CaterDesk v2
 * UI logic: rendering, sheets, navigation, events
 * Imports from db.js, utils.js, icons.js and i18n.js
 */

import {
  getAll, putOne, putChecked, commitChanges, deleteOne, getMeta, setMeta,
  savePhoto, saveEventPhotos, getPhotosForEvent, deletePhoto, saveBill, getBillsForExpense,
  exportAllData, importAllData, inspectBackup, checkAndMigrate
} from './db.js';

import {
  EXPENSE_HEADS, EVENT_TYPES, VENUE_TYPES, LOGISTICS, venueTypeLabel, logisticsPrompts, venueSuggestion, PAY_MODES, PERIODS, MENUS, menuById, menuRate, menuCostPerPlate, costChecklist,
  uid, today, daysSince, fmtDate, fmtCurrency, esc,
  validate, EVENT_RULES, EXPENSE_RULES, PAYMENT_RULES, VENDOR_RULES, VPAY_RULES,
  calcEventReceived, calcEventPL, toPaise, calcVendorBalance, isOnCredit, isPerson, unpaidCredit, unpaidBills, billKeyOf, daysUntil, addDays,
  sliceByPeriod, eventsMissingCosts, costByCategory, costVsUsual, priceCreep, sumRupees,
  RECON_CHECKS, ACTIVE_ORDER, COUNT_MEALS, COUNT_METHODS, countPolicyAgreed, countKey, contractedFor, guestCountStatus, addOrderMessage, markOrderMessage, labourCovers, labourDuplicates, splitParts, checkSplit, equalSplit, settlementStatus, SETTLE_KINDS, booksCheck, STOCK, duplicateBill, paymentSchedule, PAY_WHEN, counterGuests, counterSuggestion, lastCounterPlan, priceForMargin, priceForMarkup, marginPct, mealPlanTotal, MEAL_ORDER, menuChangeImpact, eventStage, reconStatus, reconciledIds, reconBlockers, reconcileFields, reopenFields, parseMenu, dishCounter, learnedDishes,
  generateInsights, isOverdue, hashPin, verifyPin, isLegacyPinHash
} from './utils.js';

import { icon, hydrateIcons, CAT_ICON } from './icons.js';
import { initLang, getLang, setLang } from './i18n.js';

// Shown in Settings; bump with each release so the phone can confirm which code it runs
const APP_BUILD = '4.15.0';

/* ── STATE ───────────────────────────────────────── */
// drafts: bills snapped but not filled in yet. Stored in the expenses store with
// draft: true, but kept out of D.expenses so they never touch totals or costing.
let D = { events: [], expenses: [], drafts: [], vendors: [], cPays: [], vPays: [] };
let CT = 'home';
let curRef = null;          // id shown on a detail page (event / vendor)
let launched = false;
let pendingPhotoEvId = null;
let lightboxState    = { evId: null, photoIds: [], idx: 0 };
let pinBuffer        = '';
let pinFails = 0, pinLockedUntil = 0;
let pinBusy = false, hasPin = false, hiddenAt = 0;
let expensePage = 1; const PAGE_SIZE = 100;
const activeSaves = new Set();
const changesChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ff-data') : null;
let reloadPending = false;
let overlayTrigger = null;
document.addEventListener('click', e => { overlayTrigger = e.target.closest('button, [role="button"], a[href]'); }, true);
let lastExport = null;      // ISO time of the last backup export
let pickVendorForExpense = null;  // set while "+ New vendor" is opened from the expense sheet
let pickVendorForEvent = false;   // ... or from an outsourced event's "Done by"
let billTarget = 'sheet';         // where the next bill photo goes: the open expense sheet, or a new draft ('snap')
let lbOnDelete = null;            // what the lightbox Delete button does for the photo on show

// The expense being edited in the sheet. Bills are saved to storage as soon as they're
// taken (under this id); `added` are discarded if the sheet is closed without saving,
// `removed` are only deleted from storage once the expense is saved.
let expWork = { id: '', bills: [], added: [], removed: [], saved: false };

// List filters (kept while the app is open)
const F = { evQ: '', ev: 'all', expQ: '', exp: 'all', expEv: '', venQ: '' };
let period = 'all';

/* ── SMALL HELPERS ───────────────────────────────── */
function q(id)  { return document.getElementById(id); }
function qv(id) { return q(id).value.trim(); }
function qf(id) { return Number(q(id).value) || (q(id).value.trim() ? NaN : 0); }

// A phrase in both languages, shown per the language setting (see i18n.js)
function tr(en, mr) { return `<span class="t-en">${en}</span><span class="t-mr">${mr}</span>`; }
// Same, from a stored "English – मराठी" pair
function trPair(pair) { const [en, mr] = pair.split(' – '); return mr ? tr(en, mr) : pair; }

function catIcon(cat, size = 18) { return icon(CAT_ICON[cat] || 'receipt', size); }

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}

function emptyState({ ic, text, action, tone = '', compact = false }) {
  return `<div class="empty${compact ? ' compact' : ''}">
    <div class="empty-ic ${tone}">${icon(ic, 26)}</div>
    <div class="empty-tx">${text}</div>
    ${action || ''}
  </div>`;
}

function rowsOrEmpty(rows, text) {
  return rows || `<div class="list-empty">${text}</div>`;
}

/* Edit forms keep the exact record they were opened with. Saving applies only the fields the
   form controls on top of that record, so anything else on it (menu, orders, labour sheet,
   photos, fields added by newer versions) is kept; `drop` removes fields the form turned off.
   The same snapshot is the save's expected version, so a record changed elsewhere since the
   form opened is refused instead of overwritten. It is an independent copy: the in-memory
   record can be updated in place later (a save stamps its new revision on it), and a shared
   reference would follow those changes and let a stale form through. */
const formBase = { ev: null, exp: null, cpay: null, ven: null, vpay: null };
const snapshot = rec => rec ? structuredClone(rec) : null;
function editedRecord(base, fields, drop = []) {
  const record = { ...(base || {}), ...fields };
  for (const k of drop) delete record[k];
  delete record._rev;   // the database assigns the next revision
  return record;
}

function readPref(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writePref(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function matches(query, ...fields) {
  if (!query) return true;
  const hay = fields.join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).every(w => hay.includes(w));
}

// Indian mobile → digits for tel:/wa.me (10-digit numbers get the 91 country code)
function phoneDigits(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 10 ? '91' + d : d;
}


async function runSave(key, task) {
  if (activeSaves.has(key)) return;
  activeSaves.add(key);
  const buttons = [...document.querySelectorAll('[id^="btn-save-"]')];
  buttons.forEach(b => b.disabled = true);
  try {
    // The database transaction owns cancellation. Releasing this lock before
    // the task settles would allow a second write and a late completion.
    await task();
    changesChannel?.postMessage('changed');
  } catch (e) {
    console.error(e);
    const msg = e.message?.includes('changed in another')
      ? e.message
      : (e.message && e.message !== 'full'
          ? 'Could not save: ' + e.message + ' – जतन झाले नाही'
          : 'Could not save. Your entry is still here. Check free storage and try again. – जतन झाले नाही');
    showToast(msg, 'error');
  } finally {
    activeSaves.delete(key);
    if (!activeSaves.size) buttons.forEach(b => b.disabled = false);
  }
}
window.addEventListener('ffdb-update-needed', () => showToast('A storage update is available. Finish your entry, then close and reopen the app.', 'error'));
window.addEventListener('pageshow', syncOverlayAccessibility);
window.addEventListener('focus', syncOverlayAccessibility);
window.addEventListener('ff-migration-error', e => showToast('Legacy data could not be migrated. Originals were kept. ' + e.detail, 'error'));
window.addEventListener('unhandledrejection', e => {
  e.preventDefault(); console.error(e.reason); showLoading(false);
  showToast(e.reason?.message || 'Operation failed. Your data has not been confirmed saved.', 'error');
});
changesChannel?.addEventListener('message', async () => {
  if (!launched || overlays.length || activeSaves.size || q('pin-screen').classList.contains('active')) {
    reloadPending = true; return;
  }
  await loadAll(); refreshCurrent();
});

/* ── BOOT ────────────────────────────────────────── */
async function boot() {
  q('app-build').textContent = 'v' + APP_BUILD;
  let readyRelease = null;
  q('check-app-update').addEventListener('click', async () => {
    const button = q('check-app-update'), status = q('app-update-status');
    if (readyRelease) {
      if (activeSaves.size || document.querySelector('.modal-ov.active, #lightbox.active') || q('pin-screen').classList.contains('active')) {
        status.textContent = 'Save or close your entry and unlock the app before reloading.';
        return;
      }
      location.reload(); return;
    }
    button.disabled = true; status.textContent = 'Checking for updates…';
    try {
      const release = await window.caterDeskUpdate();
      if (release !== APP_BUILD) {
        readyRelease = release; button.textContent = 'Reload saved app';
        status.textContent = `v${release} is ready. Save or close any entry, then reload.`;
      } else status.textContent = `You are using CaterDesk v${APP_BUILD}.`;
    } catch (error) { status.textContent = error.message || 'Cannot check updates. Try again online.'; }
    finally { button.disabled = false; }
  });
  hydrateIcons();
  initTheme();
  initLang();
  syncSettingsUI();
  period = readPref('ffv2_period', 'all');
  if (!PERIODS[period]) period = 'all';
  // Storage normally opens in well under a second. If it hasn't after 4s, an older copy
  // of the app is holding it (the browser only signals "blocked" to the first waiter),
  // so explain what to do instead of spinning silently.
  const explainStuck = () => {
    q('loading-text').innerHTML = 'Updating the app…<br>Close any other open CaterDesk tab or app window, then reopen this one.' +
      '<br><span lang="mr">अ‍ॅप अपडेट होत आहे… इतर उघडे CaterDesk टॅब/विंडो बंद करा आणि हे पुन्हा उघडा.</span>';
  };
  window.addEventListener('ffdb-blocked', explainStuck);
  const stuckTimer = setTimeout(explainStuck, 4000);
  showLoading(true);
  try {
    await checkAndMigrate();
    clearTimeout(stuckTimer);
    window.removeEventListener('ffdb-blocked', explainStuck);
    await loadAll();
    lastExport = await getMeta('last_export');

    const pin = await getMeta('pin_hash');
    hasPin = !!pin;
    pinLockedUntil = Number(await getMeta('pin_locked_until')) || 0;
    if (pin) {
      showPinScreen('unlock');
      syncOverlayAccessibility();
    } else {
      launchApp();
    }
  } catch (err) {
    clearTimeout(stuckTimer);
    console.error('[Boot]', err);
    showToast('App failed to start. Please refresh.', 'error');
  } finally {
    clearTimeout(stuckTimer);
    showLoading(false);
  }
  autoUpdateOnStart();
}

/* A newer release found while the app is starting is switched to at once, so the phone never
   keeps showing the old version. Only in the first seconds and only with nothing open or
   saving; otherwise it waits for Settings › Reload or the next start, as before. */
async function autoUpdateOnStart() {
  let release;
  try { release = await window.caterDeskUpdate?.(); } catch { return; }
  if (!release || release === APP_BUILD) return;
  const key = 'ff_autoupdate_' + release;
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { return; }  // never loop
  const busy = activeSaves.size || document.querySelector('.modal-ov.active, #lightbox.active') || history.state?.depth > 0;
  if (busy || performance.now() > 20000) {   // 20s after the page opened
    showToast(`CaterDesk v${release} is ready. It opens next time, or reload from Settings.`);
    return;
  }
  location.reload();
}

/* Reload every record from storage (entries made in another window or tab) and check for an
   app update; a newer release is switched to when nothing is open. */
let refreshing = false;
async function refreshNow() {
  if (refreshing) return;
  refreshing = true;
  q('hdr-refresh').classList.add('spin');
  try {
    if (!overlays.length && !activeSaves.size) { await loadAll(); refreshCurrent(); }
    let release = null;
    try { release = await window.caterDeskUpdate?.(); } catch {}
    if (release && release !== APP_BUILD && !overlays.length && !activeSaves.size) { location.reload(); return; }
    // Quiet when nothing changed; speak only when an update is waiting on an open entry
    if (release && release !== APP_BUILD) showToast(`v${release} ready – close your entry to update`);
  } finally { refreshing = false; q('hdr-refresh').classList.remove('spin'); }
}

function initPullToRefresh() {
  const ind = q('ptr');
  let start = null, pull = 0;
  const show = (y, text) => { ind.style.transform = `translate(-50%, ${y}px)`; if (text) ind.textContent = text; };
  window.addEventListener('touchstart', e => {
    start = window.scrollY <= 0 && !overlays.length && e.touches.length === 1 ? e.touches[0].clientY : null; pull = 0;
  }, { passive: true });
  window.addEventListener('touchmove', e => {
    if (start === null) return;
    pull = e.touches[0].clientY - start;
    if (pull > 10) show(Math.min(pull, 110) * .6 - 40, pull > 80 ? '↻ Release to refresh – सोडा' : '↓ Pull to refresh – ओढा');
  }, { passive: true });
  window.addEventListener('touchend', () => {
    if (start !== null && pull > 80) { show(16, '↻ Refreshing… – रिफ्रेश'); refreshNow().finally(() => setTimeout(() => show(-60), 600)); }
    else show(-60);
    start = null; pull = 0;
  });
}

async function loadAll() {
  const [events, allExpenses, vendors, cPays, vPays] = await Promise.all([
    getAll('events'), getAll('expenses'), getAll('vendors'),
    getAll('cPays'), getAll('vPays')
  ]);
  const expenses = allExpenses.filter(x => !x.draft);
  const drafts   = allExpenses.filter(x => x.draft).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  D = { events, expenses, drafts, vendors, cPays, vPays };
  if (typeof window !== 'undefined') window.D = D;
}

// Drafts are "expenses" in storage but a separate list in memory
function storeOf(type) { return type === 'drafts' ? 'expenses' : type; }

/* Reopen the screen used last (within 12 hours) above Home, so Back still returns Home,
   and offer to continue an expense that was being typed when the app was closed. */
function resumeWhereLeft(last) {
  // Only in the installed app; in a browser tab a reload is just a refresh of Home
  const installed = window.matchMedia?.('(display-mode: standalone)').matches;
  if (installed && last && last.tab !== 'home' && Date.now() - (last.at || 0) < 12 * 3600e3) {
    if (last.tab === 'evdetail' && D.events.some(e => e.id === last.ref)) showEvDetail(last.ref);
    else if (last.tab === 'vendetail' && D.vendors.some(v => v.id === last.ref)) showVenDetail(last.ref);
    else if (TOP_TABS.includes(last.tab)) go(last.tab);
  }
  const snap = readPref('ffv2_expdraft', null);
  if (snap && (snap.amt || snap.notes) && Date.now() - (snap.at || 0) < 24 * 3600e3) {
    showToast(`Unsaved expense${snap.amt ? ' ' + fmtCurrency(snap.amt) : ''} – न जतन केलेला खर्च`, 'success',
      { label: 'Continue – पुढे', run: () => openExpModal({ resume: snap }) });
    setTimeout(hideToast, 15000);
  }
}

// While a new expense is being typed, keep a copy so closing the app doesn't lose it
function saveExpSnapshot() {
  if (!q('exp-modal').classList.contains('active') || qv('exp-id')) return;
  if (!qv('exp-amt') && !qv('exp-notes')) { try { localStorage.removeItem('ffv2_expdraft'); } catch {} return; }
  writePref('ffv2_expdraft', { amt: qv('exp-amt'), pay: q('exp-pay').dataset.value, cat: qv('exp-cat'), head: qv('exp-head'),
    evId: qv('exp-ev'), venId: qv('exp-vendor').startsWith('__new') ? '' : qv('exp-vendor'), mode: qv('exp-mode'),
    date: qv('exp-date'), dueDate: qv('exp-due'), notes: qv('exp-notes'), at: Date.now() });
}

function launchApp() {
  if (launched) return;   // setting a PIN later must not re-bind every listener
  launched = true;
  bindAllEvents();
  history.replaceState({ tab: 'home', ref: null, depth: 0 }, '');
  const last = readPref('ffv2_last', null);
  go('home', { fromHistory: true });
  resumeWhereLeft(last);
  syncOverlayAccessibility();
}

/* ── LOADING ─────────────────────────────────────── */
function showLoading(show) {
  q('loading').classList.toggle('active', show);
}

/* ── TOAST ───────────────────────────────────────── */
// action: optional { label, run } — shows a button (e.g. Undo) and keeps the toast up longer
const TOAST_ACTION_MS = 8000;
function showToast(msg, type = 'success', action = null) {
  const t   = q('toast');
  const btn = q('toast-action');
  q('toast-ic').innerHTML = icon(type === 'error' ? 'alert' : 'check', 18);
  q('toast-msg').textContent = msg;
  t.className = 'show ' + type + (action ? ' has-action' : '');
  btn.textContent = action ? action.label : '';
  btn.onclick = action ? () => { hideToast(); action.run(); } : null;
  clearTimeout(t._t);
  // A message with a button (e.g. Undo) stays a little longer, then closes by itself. The change it offers to undo
  // is already saved, so closing it only ends the chance to undo; it never loses or changes data.
  t._t = setTimeout(hideToast, action ? TOAST_ACTION_MS : type === 'error' ? 10000 : 4000);
}

function hideToast() {
  clearTimeout(q('toast')._t);
  q('toast').className = '';
  q('toast-action').onclick = null;
}

/* ── THEME / LANGUAGE ────────────────────────────── */
// Status bar colour matches the header, which is the page background
const THEME_BAR = { dark: '#0D2425', light: '#F8F4EA' };

function applyTheme(t) {
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.classList.add(t);
  q('theme-color-meta').content = THEME_BAR[t];
  syncSettingsUI();
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('ffv2_theme'); } catch {}
  applyTheme(saved || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
}

function setTheme(t) {
  applyTheme(t);
  try { localStorage.setItem('ffv2_theme', t); } catch {}
}

function syncSettingsUI() {
  const theme = document.documentElement.classList.contains('light') ? 'light' : 'dark';
  document.querySelectorAll('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeSet === theme)));
  document.querySelectorAll('[data-lang-set]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.langSet === getLang())));
  const diag = readPref('ffv2_diagnostics', false) === true ? 'on' : 'off';   // error reports: off until the user turns them on
  document.querySelectorAll('[data-diag-set]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.diagSet === diag)));
}

/* ── PIN LOCK ────────────────────────────────────── */
function showPinScreen(mode) {
  pinBuffer = '';
  const screen = q('pin-screen');
  screen.dataset.mode = mode;
  q('pin-title').textContent =
    mode === 'unlock' ? 'Enter PIN – पिन टाका' :
    mode === 'set'    ? 'Set new PIN – नवीन पिन' :
                        'Confirm PIN – पिन पुष्टी करा';
  q('pin-sub').textContent =
    mode === 'unlock' ? 'Enter your 4-digit PIN' :
    mode === 'set'    ? 'Choose a 4-digit PIN for your app' : 'Re-enter your PIN';
  q('pin-error').textContent = '';
  q('pin-alt').style.display = mode === 'unlock' ? 'block' : 'none';
  renderPinDots();
  screen.classList.add('active');
}

function renderPinDots() {
  document.querySelectorAll('.pin-dot').forEach((d, i) => {
    d.className = 'pin-dot' + (i < pinBuffer.length ? ' filled' : '');
  });
}

function pinKey(val) {
  if (Date.now() < pinLockedUntil) return;
  if (val === 'del') {
    pinBuffer = pinBuffer.slice(0, -1);
    renderPinDots();
    return;
  }
  if (pinBusy || val === 'ok' || pinBuffer.length >= 4) return;
  pinBuffer += val;
  renderPinDots();

  if (pinBuffer.length === 4) {
    setTimeout(() => handlePinComplete().catch(e => showToast(e.message, 'error')), 200);
  }
}

async function handlePinComplete() {
  if (pinBusy) return;
  pinBusy = true;
  try {
  const screen = q('pin-screen');
  const mode   = screen.dataset.mode;
  const errEl  = q('pin-error');

  if (mode === 'unlock') {
    const stored = await getMeta('pin_hash');
    if (await verifyPin(pinBuffer, stored)) {
      pinFails = 0;
      await setMeta('pin_locked_until', 0);
      // PINs set before v2.1 used a weak hash — upgrade it now that we know the PIN
      if (isLegacyPinHash(stored)) await setMeta('pin_hash', await hashPin(pinBuffer));
      hasPin = true;
      screen.classList.remove('active');
      launchApp();
    } else {
      pinFails++;
      // After 5 wrong tries, pause input for 30 seconds
      if (pinFails >= 5) {
        pinFails = 0;
        pinLockedUntil = Date.now() + 30000;
        await setMeta('pin_locked_until', pinLockedUntil);
        errEl.textContent = 'Too many tries — wait 30 seconds – ३० सेकंद थांबा';
        setTimeout(() => { errEl.textContent = ''; }, 30000);
      } else {
        errEl.textContent = 'Wrong PIN – चुकीचा पिन';
        setTimeout(() => { if (Date.now() >= pinLockedUntil) errEl.textContent = ''; }, 800);
      }
      document.querySelectorAll('.pin-dot').forEach(d => d.className = 'pin-dot error');
      setTimeout(() => { pinBuffer = ''; renderPinDots(); }, 800);
    }
  } else if (mode === 'set') {
    screen.dataset.firstPin = pinBuffer;
    pinBuffer = '';
    renderPinDots();
    showPinScreen('confirm');
  } else if (mode === 'confirm') {
    if (pinBuffer === screen.dataset.firstPin) {
      await setMeta('pin_hash', await hashPin(pinBuffer));
      hasPin = true;
      screen.classList.remove('active');
      showToast('PIN set – पिन सेट झाला');
      launchApp();
    } else {
      errEl.textContent = 'PINs do not match – पिन जुळत नाही';
      document.querySelectorAll('.pin-dot').forEach(d => d.className = 'pin-dot error');
      setTimeout(() => { pinBuffer = ''; showPinScreen('set'); }, 800);
    }
  }
  } finally { pinBusy = false; syncOverlayAccessibility(); }
}

async function removePin() {
  if (!await getMeta('pin_hash')) { showToast('No PIN set – पिन सेट नाही'); return; }
  const ok = await askSheet({
    title: 'Remove PIN? – पिन काढायचा?',
    message: 'Anyone with this phone will be able to open the app.',
    actions: [{ label: 'Remove PIN – पिन काढा', value: true, style: 'btn-danger' }]
  });
  if (!ok) return;
  await setMeta('pin_hash', null);
  hasPin = false;
  showToast('PIN removed – पिन काढला');
}

/* ── OVERLAYS + HISTORY ──────────────────────────────
   Every sheet, the settings panel and the lightbox push a history entry, so
   the phone's Back button closes them instead of leaving the app. Pages push
   entries too (depth counts steps above Home).                         */
const overlays   = [];  // stack of { hide, after }
const popWaiters = [];  // resolvers for history.back() calls we started

window.addEventListener('popstate', onPopState);
function getActiveOverlay() {
  if (q('ask-modal').classList.contains('active')) return q('ask-modal');
  if (q('pin-screen').classList.contains('active')) return q('pin-screen');
  return [...document.querySelectorAll('#drawer.active, .modal-ov.active, #lightbox.active')].at(-1) || null;
}
function syncOverlayAccessibility() {
  const top = getActiveOverlay();
  for (const root of [q('hdr'), document.querySelector('main'), document.querySelector('nav'), q('fab')]) if (root) root.inert = !!top;
  for (const root of document.querySelectorAll('#drawer, .modal-ov, #lightbox, #pin-screen')) root.inert = !!top && root !== top;
  if (top && !top.contains(document.activeElement)) (top.querySelector('input:not([type=hidden]), button:not([disabled]), [tabindex="0"]'))?.focus({ preventScroll: true });
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const modal = getActiveOverlay();
  if (!modal) return;
  const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([type=hidden]), select, textarea, a[href], [tabindex="0"]')].filter(el => el.getClientRects().length && !el.closest('[inert]'));
  const first = focusable[0], last = focusable.at(-1);
  if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
  } else {
    if (hasPin && hiddenAt && Date.now() - hiddenAt > 60000 && !activeSaves.size) {
      showPinScreen('unlock');
      syncOverlayAccessibility();
    } else if (hiddenAt && Date.now() - hiddenAt > 30000 && !activeSaves.size && !overlays.length) {
      loadAll().then(refreshCurrent).catch(err => console.warn('Wake refresh error:', err));
    }
    // Never clear an in-flight save just because the app became visible.
    syncOverlayAccessibility();

  }
});
function openOverlay(hide, after) {
  const previous = overlayTrigger || document.activeElement;
  document.documentElement.classList.add('modal-open');   // page behind stays still while a sheet is up
  overlays.push({ hide: () => {
    hide(); syncOverlayAccessibility();
    if (!overlays.length) document.documentElement.classList.remove('modal-open');
    const target = previous?.isConnected && previous.getClientRects().length && !previous.closest('[inert]') ? previous : q('fab');
    if (target?.getClientRects().length && !target.closest('[inert]')) target.focus({ preventScroll: true });
  }, after });
  queueMicrotask(syncOverlayAccessibility);
  const st = history.state || { tab: CT, ref: curRef, depth: 0 };
  history.pushState({ ...st, overlay: true, depth: (st.depth || 0) + 1 }, '');
}

// Close the top overlay from the UI; resolves once history has settled
function closeOverlay() {
  const o = overlays.pop();
  if (!o) return Promise.resolve();
  o.hide();
  if (reloadPending && !overlays.length) { reloadPending = false; loadAll().then(refreshCurrent); }
  if (!history.state?.overlay) { o.after?.(); return Promise.resolve(); }
  return new Promise(res => {
    let done = false;
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer);
      const index = popWaiters.indexOf(finish); if (index >= 0) popWaiters.splice(index, 1);
      if (history.state?.overlay) history.replaceState({ tab: CT, ref: curRef, depth: 0 }, '');
      o.after?.(); syncOverlayAccessibility(); res();
    };
    const timer = setTimeout(finish, 600);
    popWaiters.push(finish);
    history.back();
  });
}

// Hide every overlay without touching history (the next go() replaces the entry)
function dropOverlays() {
  while (overlays.length) { const o = overlays.pop(); o.hide(); o.after?.(); }
}

function onPopState(e) {
  if (popWaiters.length) { popWaiters.shift()(); return; }
  if (overlays.length) { const o = overlays.pop(); o.hide(); o.after?.(); return; }
  const st = e.state;
  if (st?.overlay) { history.back(); return; }   // stale entry reached via Forward
  restorePage(st || { tab: 'home', ref: null });
}

function restorePage(st) {
  if (st.tab === 'evdetail' && st.ref)       showEvDetail(st.ref, { fromHistory: true });
  else if (st.tab === 'vendetail' && st.ref) showVenDetail(st.ref, { fromHistory: true });
  else go(st.tab || 'home', { fromHistory: true });
}

/* ── NAVIGATION ──────────────────────────────────── */
const TOP_TABS = ['home', 'events', 'expenses', 'vendors', 'summary'];

const PAGE_TITLE = {
  home: 'CaterDesk', events: 'Events – कार्यक्रम', expenses: 'Expenses – खर्च',
  vendors: 'Vendors – विक्रेते', summary: 'Reports – अहवाल'
};

// The floating button: recording an expense is one tap from almost everywhere
const FAB = {
  home:      { en: 'Add expense', mr: 'खर्च जोडा',      run: () => openExpModal() },
  events:    { en: 'New event',   mr: 'नवीन कार्यक्रम', run: () => openEvModal() },
  evdetail:  { en: 'Add expense', mr: 'खर्च जोडा',      run: () => openExpModal(curRef) },
  expenses:  { en: 'Add expense', mr: 'खर्च जोडा',      run: () => openExpModal(F.expEv && F.expEv !== STOCK ? F.expEv : undefined) },
  vendors:   { en: 'Add vendor',  mr: 'विक्रेता जोडा',  run: () => openVenModal() },
  vendetail: { en: 'Pay vendor',  mr: 'देयक द्या',      run: () => openVPayModal(curRef) }
};

function go(id, { ref = null, fromHistory = false } = {}) {
  const changed = id !== CT || ref !== curRef;

  if (!fromHistory && changed) {
    const st = history.state || { depth: 0 };
    const depth = st.depth || 0;
    if (id === 'home' && depth > 0) {
      // Home is the root: unwind to it so Back from Home exits, like a native app
      dropOverlays();
      history.go(-depth);
      return;
    }
    const entry = { tab: id, ref };
    const tabToTab = TOP_TABS.includes(id) && TOP_TABS.includes(CT) && CT !== 'home';
    if (st.overlay || tabToTab) history.replaceState({ ...entry, depth }, '');
    else history.pushState({ ...entry, depth: depth + 1 }, '');
  }

  document.querySelectorAll('.tab, .nav-it').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-it').forEach(el => el.removeAttribute('aria-current'));
  q('tab-' + id)?.classList.add('active');
  // Detail pages keep their parent tab selected
  const navId = id === 'evdetail' ? 'events' : id === 'vendetail' ? 'vendors' : id;
  q('n-' + navId)?.classList.add('active');
  q('n-' + navId)?.setAttribute('aria-current', 'page');

  const fab = FAB[id];
  q('fab').hidden = !fab;
  if (fab) q('fab-label').innerHTML = tr(fab.en, fab.mr);

  CT = id;
  curRef = ref;
  writePref('ffv2_last', { tab: id, ref, at: Date.now() });
  setHeader();
  renderPage(id);
  if (changed) window.scrollTo(0, 0);
}

function setHeader() {
  const detail = CT === 'evdetail' || CT === 'vendetail';
  const rec = CT === 'evdetail' ? D.events.find(e => e.id === curRef)
            : CT === 'vendetail' ? D.vendors.find(v => v.id === curRef) : null;
  const txt = q('hdr-text');
  // Names are user content — never split by the language filter
  txt.toggleAttribute('data-nl', detail);
  q('hdr').classList.toggle('on-detail', detail);
  txt.textContent = detail ? (rec?.name || '') : PAGE_TITLE[CT];
  q('hdr-back').hidden = !detail;
  q('hdr-edit').hidden = !detail;
  q('hdr-delete').hidden = !detail;
  q('hdr-refresh').hidden = detail;   // detail pages already carry back/edit/delete; refresh lives on the main tabs
}

function goBack(fallback) {
  if ((history.state?.depth || 0) > 0 && !history.state.overlay) history.back();
  else go(fallback);
}

// expense id → amount still unpaid on that credit purchase (recomputed on every render)
let CREDIT_LEFT = new Map();
function refreshCredit() {
  CREDIT_LEFT = new Map(unpaidCredit(D.expenses, D.vPays).map(u => [u.x.id, u.left]));
}

function renderPage(id) {
  refreshCredit();
  if (id === 'home')     rHome();
  if (id === 'events')   rEvents();
  if (id === 'expenses') rExp();
  if (id === 'vendors')  rVen();
  if (id === 'summary')  rSummary();
}

// Re-render whatever is on screen after data changes
function refreshCurrent() {
  refreshCredit();
  if (CT === 'evdetail')  { showEvDetail(curRef, { fromHistory: true }); return; }
  if (CT === 'vendetail') { showVenDetail(curRef, { fromHistory: true }); return; }
  renderPage(CT);
}

function renderPeriodSegs() {
  document.querySelectorAll('[data-period-seg]').forEach(seg => {
    seg.innerHTML = Object.entries(PERIODS).map(([k, label]) =>
      `<button type="button" data-action="period" data-id="${k}" aria-pressed="${k === period}">${trPair(label)}</button>`).join('');
  });
}

function periodLabel() {
  const [en, mr] = PERIODS[period].split(' – ');
  return { en, mr };
}

/* ── HOME ────────────────────────────────────────── */
function rHome() {
  renderPeriodSegs();
  const P = sliceByPeriod(D, period);
  const tb = sumRupees(P.events, e => e.billing);
  const te = sumRupees(P.expenses);
  const rc = sumRupees(P.cPays);
  const profit  = (Math.round(tb * 100) - Math.round(te * 100)) / 100;
  const done = reconciledIds(P.events, P.expenses);
  const provisional = P.events.filter(e => !done.has(e.id)).length;
  const pending = Math.max(0, tb - rc);
  const margin  = tb > 0 ? Math.round(profit / tb * 100) : 0;
  const collected = tb > 0 ? Math.min(100, rc / tb * 100) : 0;
  const pl = periodLabel();

  q('kpi').innerHTML = `
    <div class="card hero">
      <div class="label">${tr(`Event contribution · ${pl.en}`, `कार्यक्रम योगदान · ${pl.mr}`)}</div>
      <div class="amt-xl ${profit < 0 ? 'neg' : ''}" style="margin-top:4px">${fmtCurrency(profit)}</div>
      <div class="hero-sub">${P.events.length ? tr(
        `${margin}% margin on ${fmtCurrency(tb)} billed · ${P.events.length} event${P.events.length > 1 ? 's' : ''}${provisional ? ` · ${provisional} provisional` : ''}`,
        `${fmtCurrency(tb)} बिलावर ${margin}% मार्जिन · ${P.events.length} कार्यक्रम${provisional ? ` · ${provisional} अंदाजे` : ''}`)
        : tr('No events in this period', 'या कालावधीत कार्यक्रम नाहीत')}</div>
      <div class="metrics">
        <div class="metric"><div class="label">Received – मिळाले</div><div class="amt-md pos">${fmtCurrency(rc)}</div></div>
        <div class="metric"><div class="label">Pending – बाकी</div><div class="amt-md ${pending > 0 ? 'due' : 'muted'}">${fmtCurrency(pending)}</div></div>
        <div class="metric"><div class="label">Expenses – खर्च</div><div class="amt-md">${fmtCurrency(te)}</div></div>
      </div>
      <div class="prog" style="margin-top:var(--s4)" aria-label="Collected ${Math.round(collected)}%"><span style="width:${collected}%"></span></div>
      <div class="meta" style="margin-top:6px">${tr(`${Math.round(collected)}% of billing collected`, `बिलाच्या ${Math.round(collected)}% वसुली`)}</div>
    </div>
  `;

  q('kpi').insertAdjacentHTML('beforeend', cashCard());

  // Nudges: events with no costs recorded, and an overdue backup
  const missing = eventsMissingCosts(D.events, D.expenses);
  const backupDays = lastExport ? daysSince(lastExport.slice(0, 10)) : null;
  const needBackup = D.events.length && (backupDays === null || backupDays >= 7);
  q('nudges').innerHTML = deliveriesCard() + draftsCard() + payVendorsCard() + checkCostsCard() +
    (missing.length ? `
      <div class="sec"><span class="sec-title">Record costs – खर्च नोंदवा</span><span class="meta">${missing.length}</span></div>
      <div class="card">
        <div class="note alert"><span class="note-ic">${icon('receipt', 16)}</span>
          <div>${tr('These events have no expenses yet, so their contribution is overstated.', 'या कार्यक्रमांचा खर्च नोंदवलेला नाही, त्यामुळे योगदान जास्त दिसते.')}</div></div>
        <div class="list">${missing.slice(0, 5).map(e => `
          <div class="row" role="button" tabindex="0" data-action="evdetail" data-id="${esc(e.id)}">
            <div class="row-body"><div class="title-sm trunc" data-nl>${esc(e.name)}</div><div class="meta">${fmtDate(e.date)}</div></div>
            <button type="button" class="btn-sm" data-action="open-exp" data-id="${esc(e.id)}">${icon('plus', 16)}${tr('Expense', 'खर्च')}</button>
          </div>`).join('')}</div>
      </div>` : '') +
    (needBackup ? `
      <div class="card" style="margin-top:var(--s3)">
        <div class="note warning" style="align-items:center"><span class="note-ic">${icon('download', 16)}</span>
          <div style="flex:1">${backupDays === null
            ? tr('You have never backed up. If this phone is lost, your data is gone.', 'तुम्ही कधीही बॅकअप घेतलेला नाही.')
            : tr(`Last backup ${backupDays} days ago`, `शेवटचा बॅकअप ${backupDays} दिवसांपूर्वी`)}</div>
          <button type="button" class="btn-sm" data-action="export">${tr('Back up', 'बॅकअप')}</button></div>
      </div>` : '');

  // Insights (all time)
  const insights = generateInsights(D.events, D.cPays, D.expenses, D.vendors, D.vPays)
    .filter(i => i.icon !== 'receipt'); // the costs nudge above already says this
  q('insights-wrap').innerHTML = insights.length ? `
    <div class="sec"><span class="sec-title">Insights – माहिती</span></div>
    <div class="card" data-nl>
      ${insights.map(i => `<div class="note ${i.type}">
        <span class="note-ic">${icon(i.icon, 16)}</span>
        <div>${tr(i.en, i.mr)}</div>
      </div>`).join('')}
    </div>` : '';

  // Pending collections (all time) — overdue first, then upcoming
  const od = D.events
    .map(e => { const s = paymentSchedule(e, D.cPays); return { ...e, _p: s.outstanding, _late: s.overdue > 0, _due: s.dueNow, _od: s.overdue, _sched: s.scheduled }; })
    .filter(e => e._p > 0)
    .sort((a, b) => (b._late - a._late) || (b._p - a._p));

  q('od-list').innerHTML = od.length ? `<div class="card list">${od.map(e => `
    <div class="row" role="button" tabindex="0" data-action="evdetail" data-id="${esc(e.id)}">
      <div class="row-body">
        <div class="title-sm trunc" data-nl>${esc(e.name)}</div>
        <div class="meta trunc">${fmtDate(e.date)} · <span data-nl>${esc(e.venue)}</span></div>
      </div>
      <div class="row-end">
        <div class="amt-sm ${e._late ? 'neg' : 'due'}">${fmtCurrency(e._p)}</div>
        ${e._sched
          ? (e._late ? `<span class="chip neg">${tr(`Overdue ${fmtCurrency(e._od)}`, `थकीत ${fmtCurrency(e._od)}`)}</span>`
            : e._due > 0 ? `<span class="chip due">${tr(`Due now ${fmtCurrency(e._due)}`, `आता देय ${fmtCurrency(e._due)}`)}</span>`
            : `<span class="chip">${tr('On schedule', 'वेळापत्रकानुसार')}</span>`)
          : e._late
          ? `<span class="chip neg">${tr(`Overdue ${daysSince(e.date)}d`, `${daysSince(e.date)} दिवस थकीत`)}</span>`
          : `<span class="chip">${tr('Upcoming', 'आगामी')}</span>`}
      </div>
    </div>`).join('')}</div>`
    : `<div class="card">${emptyState({ ic: 'check', tone: 'pos', compact: true, text: 'All payments collected – सर्व वसुली झाली' })}</div>`;
}

// Money in and out over the next 30 days: client balances for events up to 30 days ahead
// (and overdue ones), against credit due within 30 days or with no pay-by date
function cashCard() {
  const limit = addDays(today(), 30);
  const collect = D.events.filter(e => e.date <= limit)
    .reduce((s, e) => s + Math.max(0, e.billing - calcEventReceived(e.id, D.cPays)), 0);
  const pay = pendingCredit().filter(u => !u.x.dueDate || u.x.dueDate <= limit).reduce((s, u) => s + u.left, 0);
  if (!collect && !pay) return '';
  const net = collect - pay;
  return `<div class="card pad" id="cash-30">
    <div class="label">${tr('Next 30 days', 'पुढील ३० दिवस')}</div>
    <div class="metrics" style="margin:var(--s2) 0 0;padding:0;border:0">
      <div class="metric"><div class="label">To collect – येणे</div><div class="amt-md pos">${fmtCurrency(collect)}</div></div>
      <div class="metric"><div class="label">To pay – देणे</div><div class="amt-md due">${fmtCurrency(pay)}</div></div>
      <div class="metric"><div class="label">Net – शिल्लक</div><div class="amt-md ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${fmtCurrency(net)}</div></div>
    </div></div>`;
}

// All unpaid credit, most urgent first: by pay-by date (overdue first), then undated, oldest purchase first
function pendingCredit() {
  return unpaidCredit(D.expenses, D.vPays).sort((a, b) =>
    (a.x.dueDate || '9999').localeCompare(b.x.dueDate || '9999') || (a.x.date || '').localeCompare(b.x.date || ''));
}

// The same, one row per bill: a shared bill's parts are one bill, owed once
function pendingBills() {
  return unpaidBills(D.expenses, D.vPays).sort((a, b) =>
    (a.x.dueDate || '9999').localeCompare(b.x.dueDate || '9999') || (a.x.date || '').localeCompare(b.x.date || ''));
}
// Where a bill went: its event, "Common stock", or "3 events"
function billWhere(b) {
  if (b.parts.length === 1) { const x = b.parts[0], ev = D.events.find(e => e.id === x.evId);
    return ev ? `<span data-nl>${esc(ev.name)}</span>` : x.stock ? tr('Common stock', 'साठा') : ''; }
  const evs = new Set(b.parts.filter(x => x.evId).map(x => x.evId)).size, stock = b.parts.some(x => x.stock);
  return tr(`${evs} event${evs === 1 ? '' : 's'}${stock ? ' + stock' : ''}`, `${evs} कार्यक्रम${stock ? ' + साठा' : ''}`);
}

// "4 vendors, 1 person" — who the unpaid credit is owed to
function payeeCount(items) {
  const ids = [...new Set(items.map(u => u.x.venId))];
  const people = ids.filter(id => isPerson(D.vendors.find(v => v.id === id))).length;
  const vendors = ids.length - people;
  return [vendors ? `${vendors} vendor${vendors > 1 ? 's' : ''}` : '', people ? `${people} ${people > 1 ? 'people' : 'person'}` : ''].filter(Boolean).join(', ');
}

// Expenses tab, top: everything still owed to vendors and lenders, each with a one-tap Pay
function toPayCard(evId = '') {
  // For one event: its own share of each bill. Otherwise: each bill once, whatever events it covers.
  const items = evId ? pendingCredit().filter(u => u.x.evId === evId).map(u => ({ ...u, key: billKeyOf(u.x), parts: [u.x] })) : pendingBills();
  if (!items.length) return '';
  const total = items.reduce((s, u) => s + u.left, 0);
  return `
    <div class="sec"><span class="sec-title">To pay – देणे बाकी</span>
      <span class="meta">${tr(`${fmtCurrency(total)} · ${payeeCount(items)}`, `${fmtCurrency(total)} · ${new Set(items.map(u => u.x.venId)).size} जणांना`)}</span></div>
    <div class="card list" id="to-pay-list">${items.map(b => {
      const { x, left } = b, ven = D.vendors.find(v => v.id === x.venId), where = billWhere(b);
      return `<div class="row" role="button" tabindex="0" data-action="edit-exp" data-id="${esc(x.id)}">
        <div class="avatar" data-nl style="width:36px;height:36px;font-size:13px">${esc(initials(ven?.name))}</div>
        <div class="row-body">
          <div class="title-sm trunc" data-nl>${esc(ven?.name || '—')}</div>
          <div class="meta trunc">${esc(short(x.head || x.cat))}${x.billNo ? ` · #${esc(x.billNo)}` : ''}${where ? ` · ${where}` : ''} · ${fmtDate(x.date)}</div>
        </div>
        <div class="row-end"><div class="amt-sm">${fmtCurrency(left)}</div>${creditChip(x)}</div>
        <button type="button" class="btn-sm" data-action="open-vpay" data-id="${esc(x.venId)}" data-bill="${esc(b.key)}">${tr('Pay', 'द्या')}</button>
      </div>`;
    }).join('')}</div>`;
}

// Home: credit due within a week (or overdue), plus a link to everything still owed
function payVendorsCard() {
  const all = pendingBills();
  if (!all.length) return '';
  const due = all.filter(u => u.x.dueDate && daysUntil(u.x.dueDate) <= 7);
  const total = all.reduce((s, u) => s + u.left, 0);
  const more = all.length - due.length;
  const seeAll = more ? `<div class="row" role="button" tabindex="0" data-action="go" data-id="expenses" style="min-height:48px">
      <div class="row-body title-sm">${tr(`See all ${all.length} to pay`, `सर्व ${all.length} देणी पाहा`)}</div>${icon('chevron', 18)}</div>` : '';
  return `
    <div class="sec"><span class="sec-title">Pay vendors – विक्रेत्यांना द्या</span><span class="meta">${fmtCurrency(total)}</span></div>
    <div class="card list">${due.map(({ x, left }) => {
      const ven = D.vendors.find(v => v.id === x.venId);
      return `<div class="row" role="button" tabindex="0" data-action="vendetail" data-id="${esc(x.venId)}">
        <div class="avatar" data-nl style="width:36px;height:36px;font-size:13px">${esc(initials(ven?.name))}</div>
        <div class="row-body">
          <div class="title-sm trunc" data-nl>${esc(ven?.name || '—')}</div>
          <div class="meta trunc">${esc(x.head || x.cat)} · ${fmtDate(x.date)}</div>
        </div>
        <div class="row-end"><div class="amt-sm">${fmtCurrency(left)}</div>${creditChip(x)}</div>
      </div>`;
    }).join('')}${seeAll}</div>`;
}

// Bills snapped earlier that still need an amount — shown on Home and Expenses
function draftsCard() {
  if (!D.drafts.length) return '';
  return `
    <div class="sec"><span class="sec-title">Bills to fill in – बिल भरा</span><span class="meta">${D.drafts.length}</span></div>
    <div class="card list">${D.drafts.map(d => {
      const ev = D.events.find(e => e.id === d.evId);
      return `<div class="row" role="button" tabindex="0" data-action="fill-draft" data-id="${esc(d.id)}">
        <div class="row-ic" style="background:var(--due-soft);color:var(--due)">${icon('camera', 18)}</div>
        <div class="row-body">
          <div class="title-sm">${tr('Bill photo', 'बिल फोटो')}${(d.billIds || []).length > 1 ? ` ×${d.billIds.length}` : ''}</div>
          <div class="meta trunc">${fmtDate(d.date)}${ev ? ` · <span data-nl>${esc(ev.name)}</span>` : ''}</div>
        </div>
        <span class="btn-sm">${tr('Fill in', 'भरा')}</span>
      </div>`;
    }).join('')}</div>`;
}

/* ── EVENTS ──────────────────────────────────────── */
function eventStatus(ev) {
  const { received: rec, pending: pend } = calcEventPL(ev, D.cPays, D.expenses);
  const noCosts = isOverdue(ev) && !ev.outsourced && !D.expenses.some(x => x.evId === ev.id);
  return { rec, pend, noCosts, overdue: paymentSchedule(ev, D.cPays).overdue > 0 };
}

function eventCard(ev) {
  const { received: rec, pending: pend, pctPaid: pct, budget, overBudget } = calcEventPL(ev, D.cPays, D.expenses);
  const st = eventStatus(ev);
  let chip;
  if (pend <= 0)          chip = `<span class="chip pos">${tr('Paid', 'पूर्ण')}</span>`;
  else if (st.overdue)    chip = `<span class="chip neg">${tr('Overdue', 'थकीत')}</span>`;
  else if (rec > 0)       chip = `<span class="chip due">${tr('Partial', 'अंशतः')}</span>`;
  else                    chip = `<span class="chip">${tr('Unpaid', 'बाकी')}</span>`;

  return `<div class="card item" role="button" tabindex="0" data-action="evdetail" data-id="${esc(ev.id)}">
    <div class="item-top">
      <div style="min-width:0">
        <div class="title-sm trunc" data-nl>${esc(ev.name)}</div>
        <div class="meta trunc">${fmtDate(ev.date)} · <span data-nl>${esc(ev.venue)}</span>${ev.meals?.length ? ' · ' + esc(mealLabel(ev)) : ''} · ${esc(ev.type)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        ${chip}
        ${ev.outsourced ? `<span class="chip info">${tr('Outsourced', 'आउटसोर्स')}</span>` : ''}
        ${st.noCosts ? `<span class="chip neg">${tr('No costs', 'खर्च नाही')}</span>` : ''}
        ${budget && overBudget > 0 ? `<span class="chip neg">${tr('Over budget', 'बजेट ओलांडले')}</span>` : ''}
      </div>
    </div>
    <div class="item-foot">
      ${pend > 0
        ? `<div><div class="label">To collect – बाकी</div><div class="amt-md ${st.overdue ? 'neg' : 'due'}">${fmtCurrency(pend)}</div></div>`
        : `<div><div class="label">Collected – मिळाले</div><div class="amt-md pos">${fmtCurrency(rec)}</div></div>`}
      ${pend > 0 ? `<div class="meta">${tr(`${fmtCurrency(rec)} of ${fmtCurrency(ev.billing)}`, `${fmtCurrency(ev.billing)} पैकी ${fmtCurrency(rec)}`)}</div>` : ''}
    </div>
    <div class="prog"><span style="width:${pct}%"></span></div>
  </div>`;
}

const EV_FILTERS = {
  all:     { label: 'All – सर्व',              test: () => true },
  collect: { label: 'To collect – बाकी',       test: s => s.pend > 0 },
  overdue: { label: 'Overdue – थकीत',          test: s => s.overdue },
  nocost:  { label: 'No costs – खर्च नाही',    test: s => s.noCosts },
  paid:    { label: 'Paid – पूर्ण',            test: s => s.pend <= 0 }
};

function rEvents() {
  if (!D.events.length) {
    q('ev-filters').innerHTML = '';
    q('ev-list').innerHTML = emptyState({
      ic: 'calendar', text: 'No events yet – अजून कार्यक्रम नाही',
      action: `<button type="button" class="btn btn-primary" data-action="quick" data-id="event">${icon('plus', 18)}New event – नवीन कार्यक्रम</button>`
    });
    return;
  }
  const status = new Map(D.events.map(e => [e.id, eventStatus(e)]));
  q('ev-filters').innerHTML = Object.entries(EV_FILTERS).map(([k, f]) => {
    const n = D.events.filter(e => f.test(status.get(e.id))).length;
    if (k !== 'all' && !n) return '';
    return `<button type="button" class="f-chip" data-action="ev-filter" data-id="${k}" aria-pressed="${F.ev === k}">${trPair(f.label)}<span class="n">${n}</span></button>`;
  }).join('');

  const list = D.events.filter(e => EV_FILTERS[F.ev].test(status.get(e.id)) && matches(F.evQ, e.name, e.venue, e.type, e.mobile));
  if (!list.length) {
    q('ev-list').innerHTML = emptyState({ ic: 'search', text: 'No matching events – काहीही सापडले नाही' });
    return;
  }
  const t = today();
  // Latest date first throughout: the newest booking is always at the top
  const upcoming = list.filter(e => e.date >= t).sort((a, b) => b.date.localeCompare(a.date));
  const past     = list.filter(e => e.date <  t).sort((a, b) => b.date.localeCompare(a.date));
  q('ev-list').innerHTML =
    (upcoming.length ? `<div class="sec"><span class="sec-title">Upcoming – आगामी</span><span class="meta">${upcoming.length}</span></div>${upcoming.map(eventCard).join('')}` : '') +
    (past.length     ? `<div class="sec"><span class="sec-title">Past – मागील</span><span class="meta">${past.length}</span></div>${past.map(eventCard).join('')}` : '');
}

/* ── EVENT DETAIL ────────────────────────────────── */
// Per-plate figures and budget progress for an event; a nudge to add them if missing
function costingBlock(pl, noCosts) {
  const plate = pl.guests ? `
    <div class="metrics">
      <div class="metric"><div class="label">${tr(`Bill/plate · ${pl.guests}`, `बिल/ताट · ${pl.guests}`)}</div><div class="amt-md">${fmtCurrency(pl.billPerPlate)}</div></div>
      <div class="metric"><div class="label">Cost/plate – खर्च/ताट</div><div class="amt-md">${fmtCurrency(pl.costPerPlate)}</div></div>
      <div class="metric"><div class="label">Contribution / plate – योगदान / ताट</div><div class="amt-md ${noCosts ? 'muted' : pl.profitPerPlate >= 0 ? 'pos' : 'neg'}">${fmtCurrency(pl.profitPerPlate)}</div></div>
    </div>` : '';
  const used = pl.budgetUsed || 0;
  const tone = used > 100 ? 'neg' : used >= 90 ? 'due' : 'pos';
  const budget = pl.budget ? `
    <div style="margin-top:var(--s4);padding-top:var(--s4);border-top:1px solid var(--line)">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:var(--s2)">
        <span class="label">${tr(`Budget ${fmtCurrency(pl.budget)}`, `बजेट ${fmtCurrency(pl.budget)}`)}</span>
        <span class="amt-sm ${tone}">${pl.overBudget > 0
          ? tr(`${fmtCurrency(pl.overBudget)} over`, `${fmtCurrency(pl.overBudget)} जास्त`)
          : tr(`${fmtCurrency(-pl.overBudget)} left`, `${fmtCurrency(-pl.overBudget)} शिल्लक`)}</span>
      </div>
      <div class="prog" style="margin-top:6px"><span style="width:${Math.min(100, used)}%;background:var(--${tone})"></span></div>
      <div class="meta" style="margin-top:4px">${tr(`${used}% of expected cost spent`, `अंदाजे खर्चाच्या ${used}% खर्च झाला`)}</div>
    </div>` : '';
  const ask = !pl.guests || !pl.budget ? `
    <button type="button" class="btn-sm" style="margin-top:var(--s3)" data-action="open-ev-edit">${icon('plus', 16)}${
      !pl.guests && !pl.budget ? tr('Add guests & budget', 'पाहुणे व बजेट जोडा')
      : !pl.guests ? tr('Add guest count', 'पाहुणे जोडा') : tr('Add budget', 'बजेट जोडा')}</button>` : '';
  return plate + budget + ask;
}

// Vendor page: items whose spend per plate has risen against this vendor's own past reconciled events.
// Spend per guest, not the vendor's unit rate: menu, quantity or service changes also move it.
function priceCheckCard(vn) {
  const rises = priceCreep(D.expenses, D.events).filter(r => r.venId === vn.id);
  if (!rises.length) return '';
  const phone = phoneDigits(vn.phone);
  return `<div class="sec"><span class="sec-title">Price check – दर तपासणी</span></div>
    <div class="card list" id="price-check">${rises.map(r => {
      const item = short(r.head);
      const msg = `Namaste ${vn.name}! For ${item}, my recent bill (${r.ev.name}) came to ${fmtCurrency(r.latest)} per plate, against about ${fmtCurrency(r.avg)} per plate before. Has your rate changed? Thank you!`;
      return `<div class="row" style="min-height:52px">
        <div class="row-body"><div class="title-sm trunc">${esc(item)}</div>
          <div class="meta">${tr(`Spend ${fmtCurrency(r.latest)}/plate now · ${fmtCurrency(r.avg)} before (${r.n} event${r.n > 1 ? 's' : ''})`, `खर्च आता ${fmtCurrency(r.latest)}/ताट · आधी ${fmtCurrency(r.avg)}`)}</div></div>
        <div class="meta" style="font-variant-numeric:tabular-nums">↑ +${r.pct}%</div>
        ${phone ? `<a class="del-btn" data-action="ext" href="https://wa.me/${esc(phone)}?text=${esc(encodeURIComponent(msg))}" target="_blank" rel="noopener" aria-label="Discuss rate on WhatsApp">${icon('message', 16)}</a>` : ''}
      </div>`;
    }).join('')}</div>`;
}

/* Vendor's account as a WhatsApp message: totals, then each unpaid credit purchase.
   Opens WhatsApp with the text filled in; nothing is sent until you press send. */
function vendorDuesLink(vn, bal) {
  const items = pendingCredit().filter(u => u.x.venId === vn.id).map(({ x, left }) => {
    const ev = D.events.find(e => e.id === x.evId);
    return `• ${(x.head || x.cat || '').split(' – ')[0]}${ev ? ' – ' + ev.name : ''} (${fmtDate(x.date)}): ${fmtCurrency(left)}`;
  });
  const msg = `Namaste ${vn.name}! As per my records:\n`
    + `${isPerson(vn) ? 'Lent / paid for me' : 'Supplied'}: ${fmtCurrency(bal.supplied)}\nPaid: ${fmtCurrency(bal.paid)}\n` + (bal.credits ? `Credit notes: ${fmtCurrency(bal.credits)}\n` : '')
    + `Balance due to you: ${fmtCurrency(bal.balance)}\n`
    + (items.length ? `\nPending:\n${items.join('\n')}\n` : '')
    + `\nPlease check and confirm. Thank you!`;
  return `https://wa.me/${phoneDigits(vn.phone)}?text=${encodeURIComponent(msg)}`;
}

/* Payment receipt for the client on WhatsApp: this payment, then the event's account so far.
   Opens WhatsApp with the text filled in; nothing is sent until you press send. */
function receiptLink(ev, p) {
  // "Paid so far" as of this payment, so a receipt for an older payment ignores later ones
  const upTo = D.cPays.filter(x => x.evId === ev.id && (x.date < p.date || (x.date === p.date && x.id <= p.id)) || x.id === p.id);
  const received = upTo.reduce((s, x) => s + (Number(x.amt) || 0), 0), left = Math.max(0, ev.billing - received);
  const mode = String(p.mode || 'Cash').split(' – ')[0];
  const msg = `Namaste! Payment receipt for ${ev.name} (${fmtDate(ev.date)})
`
    + `Received: ${fmtCurrency(p.amt)} on ${fmtDate(p.date)} by ${mode}${p.notes ? ' · ' + p.notes : ''}

`
    + `Total bill: ${fmtCurrency(ev.billing)}
Paid so far: ${fmtCurrency(received)}
`
    + (left ? `Balance: ${fmtCurrency(left)}` : `Fully paid – thank you!`) + `

Thank you!

`
    + `नमस्कार! ${ev.name} साठी ${fmtCurrency(p.amt)} मिळाले. एकूण मिळाले ${fmtCurrency(received)}`
    + (left ? `, बाकी ${fmtCurrency(left)}.` : `, पूर्ण देयक झाले.`) + ` धन्यवाद!`;
  return `https://wa.me/${phoneDigits(ev.mobile)}?text=${encodeURIComponent(msg)}`;
}

function reminderLink(ev, pending) {
  // With a schedule, ask only for what is due now (never the whole outstanding as if it were overdue)
  const s = paymentSchedule(ev, D.cPays);
  const msg = s.scheduled && s.dueNow > 0 && s.dueNow < s.outstanding
    ? `Namaste! A gentle reminder from CaterDesk: ${fmtCurrency(s.dueNow)} is now due for ${ev.name} (${fmtDate(ev.date)}) as per the payment schedule (total balance ${fmtCurrency(s.outstanding)}). Kindly arrange the payment. Thank you!\n\n`
      + `नमस्कार! ${ev.name} साठी ठरलेल्या हप्त्यानुसार ${fmtCurrency(s.dueNow)} आता देय आहे (एकूण बाकी ${fmtCurrency(s.outstanding)}). धन्यवाद!`
    : `Namaste! A gentle reminder from CaterDesk: ${fmtCurrency(pending)} is pending for ${ev.name} (${fmtDate(ev.date)}). Kindly arrange the payment. Thank you!\n\n`
      + `नमस्कार! ${ev.name} साठी ${fmtCurrency(pending)} बाकी आहे. कृपया देयक करावे. धन्यवाद!`;
  return `https://wa.me/${phoneDigits(ev.mobile)}?text=${encodeURIComponent(msg)}`;
}

async function showEvDetail(id, { fromHistory = false } = {}) {
  const ev = D.events.find(e => e.id === id); if (!ev) return;
  refreshCredit();
  const pays = D.cPays.filter(p => p.evId === id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const exps = D.expenses.filter(x => x.evId === id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const plFull = calcEventPL(ev, D.cPays, D.expenses);
  const { received: rec, expTotal: exTot, pending: pend, profit, margin, pctPaid: pct } = plFull;
  const photos = await getPhotosForEvent(id);
  const phone = phoneDigits(ev.mobile);
  const noCosts = isOverdue(ev) && !ev.outsourced && !exps.length;
  const outVen = ev.outsourced ? D.vendors.find(v => v.id === ev.outVenId) : null;
  const menu = menuById(ev.menu);
  const recon = reconStatus(ev, D.expenses);

  q('tab-evdetail').innerHTML = `
    <div class="card pad">
      <div class="detail-name" data-nl>${esc(ev.name)}</div>
      <div class="facts">
        <span class="fact">${icon('calendar', 16)}${fmtDate(ev.date)}</span>
        <span class="fact" data-nl>${icon('pin', 16)}${esc(ev.venue)}${ev.locality ? `, ${esc(ev.locality)}` : ''}</span>
        ${ev.typeOther ? `<span class="chip" data-nl>${esc(ev.typeOther)}</span>` : `<span class="chip">${esc(ev.type)}</span>`}
        ${ev.venueType ? `<span class="chip" data-nl>${esc(venueTypeLabel(ev))}</span>` : ''}
        ${ev.meals?.length ? `<span class="chip">${esc(mealLabel(ev))}</span>` : ''}
        ${menu ? `<span class="chip info">${esc(menu.name)}</span>` : ''}
        ${ev.outsourced ? `<span class="chip info">${tr('Outsourced', 'आउटसोर्स')}${outVen ? ` · <span data-nl>${esc(outVen.name)}</span>` : ''}</span>` : ''}
        ${phone ? `<a class="fact" href="tel:+${esc(phone)}">${icon('phone', 16)}${esc(ev.mobile)}</a>` : ''}
      </div>
    </div>

    ${noCosts ? `<div class="card">
      <div class="note alert"><span class="note-ic">${icon('receipt', 16)}</span>
        <div>${tr('No expenses recorded yet — the contribution below is not real until you add them.', 'अजून खर्च नोंदवलेला नाही — खर्च जोडेपर्यंत खालील नफा खरा नाही.')}</div></div>
    </div>` : ''}

    <div class="card pad">
      <div class="metrics" style="margin:0;padding:0;border:0">
        <div class="metric"><div class="label">Bill – बिल</div><div class="amt-md">${fmtCurrency(ev.billing)}</div></div>
        <div class="metric"><div class="label">Received – मिळाले</div><div class="amt-md pos">${fmtCurrency(rec)}</div></div>
        <div class="metric"><div class="label">Pending – बाकी</div><div class="amt-md ${pend > 0 ? (isOverdue(ev) ? 'neg' : 'due') : 'muted'}">${fmtCurrency(Math.max(0, pend))}</div></div>
      </div>
      <div class="prog" style="margin-top:var(--s3)"><span style="width:${pct}%"></span></div>
      ${mealPlanLine(ev)}
      ${scheduleBlock(ev)}
      ${settleLine(ev)}
      ${countLine(ev)}
      <div class="metrics">
        <div class="metric"><div class="label">Expenses – खर्च</div><div class="amt-md">${fmtCurrency(exTot)}</div></div>
        <div class="metric"><div class="label">${contributionLabel(ev, recon)}</div><div class="amt-md ${noCosts ? 'muted' : profit >= 0 ? 'pos' : 'neg'}">${fmtCurrency(profit)}</div></div>
        <div class="metric"><div class="label">Margin – मार्जिन</div><div class="amt-md ${noCosts ? 'muted' : profit >= 0 ? 'pos' : 'neg'}">${ev.billing > 0 ? margin + '%' : '—'}</div></div>
      </div>
      ${ev.outsourced ? '' : costingBlock(plFull, noCosts)}
      ${phone ? `<div class="btn-row" style="margin-top:var(--s4)" id="ev-contact">
        <a class="btn btn-secondary" href="tel:+${esc(phone)}">${icon('phone', 18)}${tr('Call', 'कॉल')}</a>
        ${pend > 0
          ? `<a class="btn btn-wa" href="${esc(reminderLink(ev, pend))}" target="_blank" rel="noopener">${icon('message', 18)}${tr('Remind', 'आठवण')}</a>`
          : `<a class="btn btn-wa" href="https://wa.me/${esc(phone)}" target="_blank" rel="noopener">${icon('message', 18)}WhatsApp</a>`}
      </div>` : ''}
    </div>

    ${reconCard(ev, recon)}

    ${logisticsCard(ev)}

    <div class="btn-row" style="margin:0 0 var(--s3)"><button type="button" class="btn btn-secondary" data-action="fs-open">${icon('clipboard', 18)}${tr('Function sheet', 'फंक्शन शीट')}</button></div>

    ${ev.notes ? `<div class="card pad"><div class="label">Notes – नोंदी</div><div class="notes-text" data-nl>${esc(ev.notes)}</div></div>` : ''}

    ${menu ? `<details class="card pad"><summary class="label" style="cursor:pointer">${tr(`${menu.name} menu · ${menu.items.length} items`, `${menu.name} मेनू · ${menu.items.length}`)}</summary>
      <ul class="notes-text" data-nl style="margin:var(--s2) 0 0;padding-left:1.2em">${menu.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></details>` : ''}

    ${menuOrdersCard(ev)}

    ${labourCard(ev)}

    ${costVsUsualCard(ev)}

    ${checklistCard(ev)}

    <div class="sec"><span class="sec-title">Expenses – खर्च</span>
      <button type="button" class="btn-sm" data-action="open-exp" data-id="${esc(ev.id)}">${icon('plus', 16)}Add – जोडा</button></div>
    <div class="card list">
      ${rowsOrEmpty(exps.map(x => expenseRow(x, { showEvent: false })).join('') +
        (exps.length > 1 ? `<div class="row" style="min-height:48px"><div class="row-body title-sm">Total – एकूण</div><div class="amt-sm">${fmtCurrency(exTot)}</div></div>` : ''),
      'No expenses yet – खर्च नाही')}
    </div>

    <div class="sec"><span class="sec-title">Payments received – मिळालेली देयके</span>
      <button type="button" class="btn-sm" data-action="open-cpay" data-id="${esc(ev.id)}">${icon('plus', 16)}Add – जोडा</button></div>
    <div class="card list">
      ${rowsOrEmpty(pays.map(p => `<div class="row" role="button" tabindex="0" data-action="edit-cpay" data-id="${esc(p.id)}">
        <div class="row-ic" style="background:var(--pos-soft);color:var(--pos)">${icon('wallet', 18)}</div>
        <div class="row-body">
          <div class="amt-sm pos">${fmtCurrency(p.amt)}</div>
          <div class="meta trunc">${fmtDate(p.date)} · ${esc(p.mode || 'Cash')}${p.notes ? ` · <span data-nl>${esc(p.notes)}</span>` : ''}</div>
        </div>
        ${phone ? `<a class="del-btn" data-action="ext" href="${esc(receiptLink(ev, p))}" target="_blank" rel="noopener" aria-label="Send receipt on WhatsApp" style="color:var(--pos)">${icon('message', 16)}</a>` : ''}
        <button type="button" class="del-btn" data-action="delete" data-type="cPays" data-id="${esc(p.id)}" aria-label="Delete payment">${icon('trash', 16)}</button>
      </div>`).join(''), 'No payments yet – देयक नाही')}
    </div>

    <div class="sec"><span class="sec-title">Photos – फोटो</span><span class="meta">${photos.length || ''}</span></div>
    <div class="card pad">
      <div class="photo-strip">
        ${photos.map(p => `<img class="photo-thumb" src="${esc(p.data)}" loading="lazy" alt="Event photo" role="button" tabindex="0" data-action="lightbox" data-photoid="${esc(p.id)}" data-evid="${esc(id)}">`).join('')}
        <button type="button" class="photo-add" data-action="add-photo" data-id="${esc(id)}">${icon('camera', 22)}Add – जोडा</button>
      </div>
    </div>
  `;

  q('tab-evdetail').dataset.evid = id;
  go('evdetail', { ref: id, fromHistory });
}

/* ── MEAL ────────────────────────────────────────── */
// Any mix of meals, always shown in the order of the day
const MEALS = { breakfast: 'Breakfast', lunch: 'Lunch', hightea: 'High tea', dinner: 'Dinner' };
const mealLabel = ev => Object.keys(MEALS).filter(m => (ev.meals || []).includes(m)).map(m => MEALS[m]).join(' + ');
const evMeals = () => [...q('ev-meals').querySelectorAll('[aria-pressed="true"]')].map(b => b.dataset.meal);
function setEvMeals(meals) {
  q('ev-meals').querySelectorAll('[data-meal]').forEach(b => b.setAttribute('aria-pressed', String(meals.includes(b.dataset.meal))));
}

/* ── LABOUR SHEET ────────────────────────────────── */
// Worker types are the Labour items (tips and the contractor's extras are not worker types)
const LAB_ROLES = () => EXPENSE_HEADS.Labour.filter(h => !/tips|contractor fee|other labour work/i.test(h));
/* Shift columns as on contractors' bills (लोडिंग, नाईट, सकाळी, सायंकाळी, लेट). Not every worker
   does every shift, so each worker type has its own headcount per shift, like the bill:
   Rojiya — Night 4, Morning 9, Evening 5 → 18 shifts × ₹600. */
const SHIFTS = { m: 'Morning – सकाळ', e: 'Evening – संध्याकाळ', n: 'Night – रात्र', f: 'Full day – पूर्ण दिवस',
                 l: 'Loading – लोडिंग', t: 'Late – लेट' };
/* Extra lines a contractor adds below the head count, each saved under the item it really is:
   travel/fare (गाडी भाडे), the mukadam's own fee (मुकादमगिरी), and small jobs such as
   ice-cream cutting (with your own note). count × rate, e.g. 11 people × ₹24 fare. */
const EXTRAS = {
  travel: { name: 'Travel – गाडी भाडे / प्रवास भत्ता', cat: 'Operations', head: 'Transport – वाहतूक' },
  fee:    { name: 'Mukadam fee – मुकादमगिरी', cat: 'Labour', head: 'Contractor Fee – मुकादमगिरी' },
  other:  { name: 'Other work – इतर काम', cat: 'Labour', head: 'Other Labour Work – इतर काम' }
};
let labRows = [];
const isExtra = r => r.kind === 'x';
const money = n => Math.round(n * 100) / 100;   // stored amounts keep at most two decimals

// Sheets saved before shift counts (one shift × count × shifts each) open as shift counts
function labRow(r) {
  if (isExtra(r) || r.counts) return { ...r, counts: r.counts && { ...r.counts } };
  const { count, shift, shifts, ...rest } = r;
  return { ...rest, counts: { [shift || 'f']: money((Number(count) || 0) * (Number(shifts) || 1)) } };
}
const heads = r => Object.values(r.counts || {}).reduce((s, n) => s + (Number(n) || 0), 0);
const lineAmt = r => money(isExtra(r) ? Math.round(Number(r.count) || 0) * (Number(r.rate) || 0) : heads(r) * (Number(r.rate) || 0));
const shiftList = r => Object.keys(SHIFTS).filter(k => Number(r.counts?.[k]) > 0).map(k => `${SHIFTS[k].split(' – ')[0]} ${r.counts[k]}`).join(' · ');
const lineText = r => isExtra(r)
  ? `${r.count} × ${fmtCurrency(r.rate)} = ${fmtCurrency(lineAmt(r))}`
  : `${heads(r)} shift${heads(r) === 1 ? '' : 's'} × ${fmtCurrency(r.rate)} = ${fmtCurrency(lineAmt(r))}`;

// The rate you used last time for this worker type (or this extra), from earlier sheets
function lastLabourRate(role, extra) {
  for (const e of [...D.events].sort((a, b) => b.date.localeCompare(a.date)))
    for (const r of e.labour?.rows || [])
      if (r.rate && (extra ? isExtra(r) && r.extra === extra : !isExtra(r) && r.role === role)) return r.rate;
  return '';
}
const labName = r => isExtra(r) ? (r.label || short(EXTRAS[r.extra].name)) : short(r.role);

function labourCard(ev) {
  if (ev.outsourced) return '';
  const rows = (ev.labour?.rows || []).map(labRow);
  const lines = money(rows.reduce((s, r) => s + lineAmt(r), 0));
  const bill = ev.labour?.billTotal || 0, adj = bill ? money(bill - lines) : 0;
  const shifts = rows.filter(r => !isExtra(r)).reduce((s, r) => s + heads(r), 0);
  return `
    <div class="sec"><span class="sec-title">Labour – मजूर</span>
      <button type="button" class="btn-sm" data-action="lab-edit">${icon(rows.length ? 'pencil' : 'plus', 16)}${rows.length ? tr('Edit', 'बदला') : tr('Labour sheet', 'मजूर यादी')}</button></div>
    ${rows.length ? `<div class="card list" id="labour-card">${rows.map(r => `
      <div class="row" style="min-height:52px">
        <div class="row-ic">${icon(isExtra(r) ? (r.extra === 'travel' ? 'truck' : 'clipboard') : 'users', 18)}</div>
        <div class="row-body"><div class="title-sm trunc" data-nl>${esc(labName(r))}</div>
          <div class="meta">${isExtra(r)
            ? `${r.count > 1 ? `${r.count} × ` : ''}${fmtCurrency(r.rate)}`
            : `${esc(shiftList(r))} · ${fmtCurrency(r.rate)} ${tr('each', 'प्रत्येकी')}`}</div></div>
        <div class="amt-sm">${fmtCurrency(lineAmt(r))}</div>
      </div>`).join('')}
      ${adj ? `<div class="row" style="min-height:44px">
        <div class="row-ic">${icon('pencil', 18)}</div>
        <div class="row-body"><div class="title-sm">${tr('Bill adjustment', 'बिल फरक')}</div><div class="meta">${tr(`Contractor's bill ${fmtCurrency(bill)}`, `ठेकेदाराचे बिल ${fmtCurrency(bill)}`)}</div></div>
        <div class="amt-sm">${adj > 0 ? '+' : '−'}${fmtCurrency(Math.abs(adj))}</div>
      </div>` : ''}
      <div class="row" style="min-height:48px"><div class="row-body title-sm">${tr(`Total · ${shifts} shift${shifts === 1 ? '' : 's'}`, `एकूण · ${shifts} शिफ्ट`)}</div><div class="amt-md">${fmtCurrency(bill || lines)}</div></div>
    </div>` : `<div class="card pad"><div class="meta">${tr('Add workers by type with how many came for each shift — the app remembers your rates and saves the total as Labour expenses.', 'प्रकारानुसार प्रत्येक शिफ्टचे मजूर जोडा — दर लक्षात राहतात व एकूण खर्च म्हणून नोंदवला जातो.')}</div></div>`}`;
}

function renderLabRows() {
  const roles = LAB_ROLES();
  const del = i => `<button type="button" class="del-btn" data-lab-del="${i}" aria-label="Remove">${icon('trash', 16)}</button>`;
  q('lab-rows').innerHTML = labRows.map((r, i) => isExtra(r) ? `
    <div class="card pad" style="margin-bottom:var(--s3)" data-lab="${i}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--s2);margin-bottom:var(--s2)">
        <div class="field" style="margin:0"><label>Extra – जादा</label><select data-k="extra">${Object.entries(EXTRAS).map(([k, x]) => `<option value="${k}"${k === r.extra ? ' selected' : ''}>${esc(short(x.name))}</option>`).join('')}</select></div>
        <div class="field" style="margin:0"><label>Note – नोंद</label><input type="text" data-k="label" placeholder="${r.extra === 'other' ? 'e.g. Ice cream cutting' : 'optional'}" value="${esc(r.label || '')}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--s2)">
        <div class="field" style="margin:0"><label>Count – संख्या</label><input type="number" data-k="count" min="1" step="1" inputmode="numeric" value="${r.count || ''}"></div>
        <div class="field" style="margin:0"><label>Rate ₹ – दर</label><input type="number" data-k="rate" min="1" inputmode="decimal" value="${r.rate || ''}"></div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--s2);margin-top:var(--s2)">
        <div class="meta" data-lab-line="${i}">${r.count && r.rate ? lineText(r) : ''}</div>${del(i)}
      </div>
    </div>` : `
    <div class="card pad" style="margin-bottom:var(--s3)" data-lab="${i}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--s2);margin-bottom:var(--s2)">
        <div class="field" style="margin:0"><label>Worker – मजूर</label><select data-k="role" aria-label="Worker type">${roles.map(h => `<option value="${esc(h)}"${h === r.role ? ' selected' : ''}>${esc(h)}</option>`).join('')}</select></div>
        <div class="field" style="margin:0"><label>Rate ₹ per shift – दर</label><input type="number" data-k="rate" min="1" inputmode="decimal" value="${r.rate || ''}"></div>
      </div>
      <div class="label" style="margin-bottom:6px">${tr('How many in each shift', 'प्रत्येक शिफ्टमध्ये किती')}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s2)">${Object.entries(SHIFTS).map(([k, l]) => `
        <div class="field" style="margin:0"><label>${esc(l.split(' – ')[0])}</label><input type="number" data-k="c-${k}" min="0" step="0.5" inputmode="decimal" placeholder="0" value="${r.counts?.[k] || ''}"></div>`).join('')}
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--s2);margin-top:var(--s2)">
        <div class="meta" data-lab-line="${i}">${heads(r) && r.rate ? lineText(r) : ''}</div>${del(i)}
      </div>
    </div>`).join('') || `<div class="meta" style="margin-bottom:var(--s3)">${tr('No workers yet.', 'अजून मजूर नाहीत.')}</div>`;
  updateLabTotal();
}

function updateLabTotal() {
  const lines = money(labRows.reduce((s, r) => s + lineAmt(r), 0)), bill = Number(qv('lab-bill')) || 0;
  q('lab-total').textContent = fmtCurrency(bill || lines);
  q('lab-bill-hint').textContent = bill && bill !== lines
    ? `Lines ${fmtCurrency(lines)} · bill adjustment ${bill > lines ? '+' : '−'}${fmtCurrency(Math.abs(bill - lines))}`
    : '';
}

function setLabPay(pay) {
  q('lab-pay').dataset.value = pay;
  q('lab-pay').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pay === pay)));
  q('lab-mode-field').hidden = pay === 'credit';
  q('lab-ven-field').hidden = pay !== 'credit';
}

function newWorkerRow(role) { return { id: uid('LB'), role, rate: lastLabourRate(role), counts: {} }; }

function openLabModal() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const sheet = ev.labour || {};
  labRows = (sheet.rows || []).map(labRow);
  if (!labRows.length) labRows = [newWorkerRow(LAB_ROLES()[0])];
  const prev = D.events.filter(e => e.id !== ev.id && e.labour?.rows?.length).sort((a, b) => b.date.localeCompare(a.date))[0];
  q('btn-lab-copy').hidden = !prev;
  q('btn-lab-copy').dataset.from = prev?.id || '';
  populateSelect('lab-mode', PAY_MODES, sheet.mode || '');
  populateSelect('lab-ven', [{ v: '', l: 'Choose contractor – ठेकेदार निवडा' },
    ...D.vendors.filter(v => !isPerson(v)).sort((a, b) => String(a.name).localeCompare(String(b.name))).map(v => ({ v: v.id, l: v.name }))], sheet.venId || '');
  setLabPay(sheet.pay || 'paid');
  q('lab-bill').value = sheet.billTotal || '';
  renderLabRows();
  clearFieldErrors();
  openSheet('lab-modal');
}

/* Save the sheet, and keep one expense per worker type (and per extra) in step with it:
   changed ones are updated, new ones added, removed ones deleted — all in one save.
   With a bill total, the difference goes on the biggest line so the total matches the bill. */
async function saveLabour() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const clean = c => Object.fromEntries(Object.entries(c || {}).map(([k, n]) => [k, money(Number(n) || 0)]).filter(([, n]) => n > 0));
  const rows = labRows.map(r => isExtra(r)
      ? { id: r.id, kind: 'x', extra: r.extra, label: String(r.label || '').trim(), count: Math.round(Number(r.count) || 0), rate: Number(r.rate) || 0 }
      : { id: r.id, role: r.role, rate: Number(r.rate) || 0, counts: clean(r.counts) })
    .filter(r => r.rate > 0 && (isExtra(r) ? r.count > 0 : heads(r) > 0));
  const pay = q('lab-pay').dataset.value || 'paid';
  const venId = pay === 'credit' ? qv('lab-ven') : '';
  if (pay === 'credit' && !venId) { showFieldErrors({ 'lab-ven': 'Choose the contractor you owe – ठेकेदार निवडा' }); return; }
  const oldIds = ev.labour?.expIds || {};
  const byKey = new Map();   // "cat|head" → lines saved as that expense
  for (const r of rows) {
    const key = isExtra(r) ? `${EXTRAS[r.extra].cat}|${EXTRAS[r.extra].head}` : `Labour|${r.role}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  // Items already typed in by hand for this event (G-14): the sheet would count them twice. Never deleted here.
  const dupes = labourDuplicates(ev, D.expenses, [...byKey.keys()]);
  if (dupes.length) {
    const keep = await askSheet({ title: 'Already entered by hand – आधी नोंदवले',
      message: `${dupes.map(x => `${short(x.head)} ${fmtCurrency(x.amt)}`).join(', ')} ${dupes.length > 1 ? 'were' : 'was'} entered separately for this event, and this sheet includes the same item${dupes.length > 1 ? 's' : ''}. Keep both only if ${dupes.length > 1 ? 'they are' : 'it is'} extra, on top of the contractor's bill; otherwise delete the separate entry first.`,
      actions: [{ label: 'Keep both: it is extra – दोन्ही ठेवा', value: true, style: 'btn-secondary' }] });
    if (!keep) return;
  }
  const changes = [], expIds = {}, saved = [];
  for (const d of dupes) { const { _rev, ...r } = d; changes.push({ store: 'expenses', record: { ...r, additional: true }, expected: d }); }
  for (const [key, rs] of byKey) {
    const [cat, head] = key.split('|');
    const old = D.expenses.find(x => x.id === oldIds[key]);
    const record = { ...(old || {}), id: old?.id || uid('EX'), evId: ev.id, cat, head,
      amt: money(rs.reduce((s, r) => s + lineAmt(r), 0)), date: old?.date || ev.date, pay, mode: pay === 'paid' ? qv('lab-mode') : '',
      venId, dueDate: pay === 'credit' ? old?.dueDate || '' : '', billIds: old?.billIds || [],
      notes: 'Labour sheet: ' + rs.map(r => isExtra(r)
        ? `${labName(r)} ${r.count > 1 ? r.count + ' × ' : ''}${fmtCurrency(r.rate)}`
        : `${shiftList(r)} @ ${fmtCurrency(r.rate)}`).join(', ') };
    delete record._rev;
    changes.push({ store: 'expenses', record, expected: old || null });
    expIds[key] = record.id; saved.push(record);
  }
  const billTotal = money(Number(qv('lab-bill')) || 0), lines = money(saved.reduce((s, r) => s + r.amt, 0));
  if (billTotal && saved.length && billTotal !== lines) {
    const big = saved.reduce((a, b) => b.amt > a.amt ? b : a);
    if (big.amt + billTotal - lines <= 0) { showFieldErrors({ 'lab-bill': 'Bill total is far below the lines – check the counts' }); return; }
    big.amt = money(big.amt + billTotal - lines);
    big.notes += ` · bill adjustment ${billTotal > lines ? '+' : '−'}${fmtCurrency(Math.abs(billTotal - lines))} (bill ${fmtCurrency(billTotal)})`;
  }
  // A sheet entry that was shared with other events (Share bill): the sheet line is the whole bill. The other events
  // keep their parts and this event takes the rest, so the parts always add up to the bill and never exceed it.
  for (const r of saved.slice()) {   // the sheet's own entries only (other events' parts are added below)
    const old = D.expenses.find(x => x.id === r.id);
    if (!old?.split) continue;
    const others = splitParts(D.expenses, old.split.id).filter(x => x.id !== r.id);
    const billP = toPaise(r.amt), othersP = others.reduce((s, x) => s + toPaise(x.amt), 0);
    if (billP - othersP <= 0) {
      showToast(`${short(r.head)} is shared with other events (${fmtCurrency(othersP / 100)} on them), more than this sheet's ${fmtCurrency(r.amt)}. Change the split first (Expenses → Share bill). Nothing was saved.`, 'error');
      return;
    }
    r.split = { ...old.split, total: r.amt };
    r.amt = (billP - othersP) / 100;
    for (const o of others) { const { _rev, ...rec } = o; changes.push({ store: 'expenses', record: { ...rec, split: { ...o.split, total: r.split.total } }, expected: o }); saved.push({ ...rec, split: { ...o.split, total: r.split.total } }); }
  }
  const removed = Object.entries(oldIds).filter(([key, id]) => !byKey.has(key) && D.expenses.some(x => x.id === id)).map(([, id]) => id);
  for (const id of removed) changes.push({ store: 'expenses', id, expected: D.expenses.find(x => x.id === id) });
  const evRecord = { ...ev, labour: { rows, pay, mode: pay === 'paid' ? qv('lab-mode') : '', venId, expIds, ...(billTotal && rows.length ? { billTotal } : {}) } };
  await commitChanges([{ store: 'events', record: evRecord, expected: ev }, ...changes], { check: true, extraStores: ['vendors'] });
  D.events = D.events.map(e => e.id === ev.id ? evRecord : e);
  D.expenses = D.expenses.filter(x => !removed.includes(x.id) && !saved.some(r => r.id === x.id)).concat(saved)
    .map(x => dupes.some(d => d.id === x.id) ? { ...x, additional: true } : x);
  closeModals();
  showToast(rows.length ? `Labour ${fmtCurrency(saved.reduce((s, r) => s + r.amt, 0))} saved – मजूर खर्च जतन` : 'Labour sheet cleared – मजूर यादी काढली');
  refreshCurrent();
}

/* ── EVENT MENU & VENDOR ORDERS ──────────────────── */
const ORDER_STATUS = {
  prepared:  { en: 'Not sent yet', mr: 'पाठवायची', tone: 'due' },
  opened:    { en: 'WhatsApp opened', mr: 'WhatsApp उघडले', tone: 'due' },
  sent:      { en: 'Sent', mr: 'पाठवले', tone: '' },
  confirmed: { en: 'Confirmed', mr: 'पक्के', tone: 'info' },
  delivered: { en: 'Delivered', mr: 'आले', tone: 'pos' },
  cancelled: { en: 'Cancelled', mr: 'रद्द', tone: 'neg' }
};
const short = head => String(head || '').split(' – ')[0];
// A delivered order says whether its bill is in yet (an outsourced event's charge was recorded at booking)
function orderStatus(o, ev) {
  const st = ORDER_STATUS[o.status] || ORDER_STATUS.sent;
  if (o.status !== 'delivered' || ev?.outsourced) return st;
  return D.expenses.some(x => x.order === o.id) ? { en: 'Delivered · billed', mr: 'आले · बिल', tone: 'pos' } : { en: 'Delivered · bill not in', mr: 'आले · बिल नाही', tone: 'due' };
}

// The event's dishes grouped by the counter that supplies them ('' = your own kitchen)
const OUT_HEAD = 'Outsourced Event – आउटसोर्स कार्यक्रम';
function dishGroups(ev) {
  if (ev.outsourced) return new Map((ev.dishes || []).length ? [[OUT_HEAD, ev.dishes.map(d => d.name)]] : []);
  const groups = new Map();
  for (const d of ev.dishes || []) {
    if (!groups.has(d.head || '')) groups.set(d.head || '', []);
    groups.get(d.head || '').push(d.name);
  }
  return groups;
}

// Usual vendor for a counter: listed speciality or who supplied it before. No guess beyond that.
function counterVendor(head) {
  return rankVendors('Live Counter', head)[0][0]?.id || '';
}

// Counter row: planned portions and what was ordered; actual served is never inferred from the order
function counterPlanLine(ev, head, o) {
  const plan = ev.counterPlan?.[head]; if (ev.outsourced || !plan?.takeUp) return '';
  const { guests } = counterGuests(ev, head), s = counterSuggestion(guests, plan.takeUp, plan.minimum);
  if (!s) return '';
  return `<div class="meta">${tr(`Plan ${s.proposed} (${plan.takeUp}% of ${guests})${o?.plates && o.plates !== s.proposed ? ` · ordered ${o.plates}` : ''}${o?.belowMinimum ? ' · below minimum' : ''}`,
    `नियोजन ${s.proposed} (${guests} चे ${plan.takeUp}%)${o?.plates && o.plates !== s.proposed ? ` · ऑर्डर ${o.plates}` : ''}`)}</div>`;
}

// Orders whose counter is no longer on the menu (dishes removed): kept in view with their status or warning
function offMenuOrders(ev) {
  const onMenu = new Set(dishGroups(ev).keys());
  const latest = new Map();
  for (const o of ev.orders || []) if (!onMenu.has(o.head)) latest.set(o.head, o);   // the newest per counter
  if (!latest.size) return '';
  return `<div class="meta" style="padding:var(--s3) var(--s4) 0">${tr('Orders for counters no longer on the menu', 'मेनूत नसलेल्या काउंटरच्या ऑर्डर')}</div>`
    + [...latest.values()].map(o => {
      const ven = D.vendors.find(v => v.id === o.venId), st = orderStatus(o, ev);
      return `<div class="row" style="min-height:56px" data-off-order="${esc(o.id)}">
        <div class="row-ic">${icon('utensils', 18)}</div>
        <div class="row-body"><div class="title-sm trunc">${esc(short(o.head))}${ven ? ` · <span data-nl>${esc(ven.name)}</span>` : ''}</div>
          <div class="meta">${tr('Not on the current menu', 'सध्याच्या मेनूत नाही')}</div></div>
        <button type="button" class="chip ${o.menuChanged ? 'due' : st.tone}" data-action="order-status" data-id="${esc(o.id)}">${o.menuChanged ? tr('Menu changed · resend', 'मेनू बदलला · पुन्हा पाठवा') : (x => tr(st.en + x, st.mr + x))(o.plates ? ' · ' + o.plates : '')}</button>
      </div>`; }).join('');
}

function menuOrdersCard(ev) {
  const dishes = ev.dishes || [];
  if (!dishes.length && !(ev.orders || []).length) return `
    <div class="sec"><span class="sec-title">Menu & orders – मेनू व ऑर्डर</span></div>
    <div class="card pad"><div class="meta">${tr('Add the dishes agreed with the client. Counter items become vendor orders you can send on WhatsApp.', 'ग्राहकाशी ठरलेले पदार्थ जोडा. काउंटरचे पदार्थ विक्रेत्यांना ऑर्डर म्हणून WhatsApp वर पाठवता येतात.')}</div>
      <button type="button" class="btn-sm" style="margin-top:var(--s3)" data-action="menu-edit">${icon('plus', 16)}${tr('Add menu', 'मेनू जोडा')}</button></div>`;
  const groups = dishGroups(ev);
  const orders = ev.orders || [];
  const counters = [...groups].filter(([head]) => head).map(([head, names]) => {
    const o = [...orders].reverse().find(x => x.head === head && x.status !== 'cancelled');
    const ven = D.vendors.find(v => v.id === (o?.venId || (ev.outsourced ? ev.outVenId : counterVendor(head))));
    const st = o && orderStatus(o, ev);
    return `<div class="row" style="min-height:56px">
      <div class="row-ic">${icon('utensils', 18)}</div>
      <div class="row-body"><div class="title-sm trunc">${ev.outsourced ? tr('Whole event', 'संपूर्ण कार्यक्रम') : esc(short(head))}${ven ? ` · <span data-nl>${esc(ven.name)}</span>` : ''}</div>
        <div class="meta trunc" data-nl>${esc(names.join(', '))}</div>${counterPlanLine(ev, head, o)}</div>
      ${o ? `<button type="button" class="chip ${o.menuChanged ? 'due' : st.tone}" data-action="order-status" data-id="${esc(o.id)}">${o.menuChanged ? tr('Menu changed · resend', 'मेनू बदलला · पुन्हा पाठवा') : (x => tr(st.en + x, st.mr + x))(o.plates ? ' · ' + o.plates : '')}</button>`
          : `<button type="button" class="btn-sm" data-action="order-new" data-id="${esc(head)}">${icon('message', 16)}${tr('Order', 'ऑर्डर')}</button>`}
    </div>`;
  }).join('');
  const kitchen = groups.get('') || [];
  return `
    <div class="sec"><span class="sec-title">Menu & orders – मेनू व ऑर्डर</span>
      <button type="button" class="btn-sm" data-action="menu-edit">${icon('pencil', 16)}${tr('Edit', 'बदला')}</button></div>
    <div class="card list" id="menu-orders">
      ${counters || (dishes.length ? '' : `<div class="list-empty">${tr('No dishes on the menu.', 'मेनूमध्ये पदार्थ नाहीत.')}</div>`) || `<div class="list-empty">${tr('No counter items found. Tap a dish below to say which counter supplies it.', 'काउंटरचे पदार्थ सापडले नाहीत. खालील पदार्थावर टॅप करा.')}</div>`}
      ${kitchen.length ? `<div class="row" style="min-height:48px"><div class="row-ic">${icon('basket', 18)}</div>
        <div class="row-body"><div class="title-sm">${tr('Our kitchen', 'आपले किचन')}</div><div class="meta" data-nl>${esc(kitchen.join(', '))}</div></div></div>` : ''}
      ${ev.outsourced ? `<div class="meta" style="padding:var(--s3) var(--s4)">${tr('Outsourced event: the full menu goes to the caterer doing the event.', 'आउटसोर्स कार्यक्रम: संपूर्ण मेनू त्या केटररला जातो.')}</div>` : `<div style="padding:var(--s3) var(--s4)">
        <div class="meta" style="margin-bottom:var(--s2)">${tr('Tap a dish to change where it comes from', 'पदार्थ कुठून येतो ते बदलण्यासाठी टॅप करा')}</div>
        <div class="chips-row" style="margin:0;padding:0;flex-wrap:wrap">${dishes.map((d, i) =>
          `<button type="button" class="f-chip" data-action="dish-assign" data-id="${i}" data-nl style="max-width:100%;overflow:hidden;text-overflow:ellipsis">${esc(d.name)}${d.head ? ` · ${esc(short(d.head))}` : ''}${d.meal ? ` · ${esc(MEALS[d.meal] || '')}` : ''}</button>`).join('')}</div>
      </div>`}
      ${offMenuOrders(ev)}
    </div>`;
}

// Save changed menu/orders on the event currently open
async function patchEvent(id, patch, drop = []) {
  const ev = D.events.find(e => e.id === id); if (!ev) return null;
  const record = { ...ev, ...patch };
  for (const k of drop) delete record[k];
  await putChecked('events', record, ev);
  D.events = D.events.map(e => e.id === id ? record : e);
  return record;
}

/* Menu: paste or type the dishes; each is shown for review (counter, meal) before saving. Earlier choices for
   dishes that stay are kept; new dishes are matched to counters from what you chose before. */
let menuDraft = [];
function openMenuModal() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  menuDraft = (ev.dishes || []).map(d => ({ ...d }));
  q('menu-text').value = menuDraft.map(d => d.name).join('\n');
  renderMenuReview();
  openSheet('menu-modal');
  q('menu-text').focus({ preventScroll: true });
}
function readMenuText() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const learned = learnedDishes(D.events);
  const known = new Map([...(ev.dishes || []), ...menuDraft].map(d => [d.name.toLowerCase(), d]));
  const meals = MEAL_ORDER.filter(m => (ev.meals || []).includes(m));
  menuDraft = parseMenu(qv('menu-text')).map(name => {
    const d = known.get(name.toLowerCase());
    return d ? { ...d, name } : { name, head: dishCounter(name, learned), ...(meals.length === 1 ? { meal: meals[0] } : {}) };
  });
  renderMenuReview();
}
function renderMenuReview() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const meals = MEAL_ORDER.filter(m => (ev.meals || []).includes(m));
  const heads = EXPENSE_HEADS['Live Counter'].filter(h => !/counter setup/i.test(h));
  const sel = (i, k, opts, v) => `<select data-md="${i}" data-k="${k}" style="flex:1;min-width:0">${opts.map(([val, label]) => `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
  q('menu-review').innerHTML = menuDraft.length ? `<div class="label" style="margin:var(--s2) 0">${tr(`Check ${menuDraft.length} dish${menuDraft.length > 1 ? 'es' : ''}`, `${menuDraft.length} पदार्थ तपासा`)}</div>`
    + menuDraft.map((d, i) => `<div class="check-row" style="flex-direction:column;align-items:stretch;gap:6px;cursor:default">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--s2)"><span class="title-sm trunc" data-nl>${esc(d.name)}</span>
        <button type="button" class="icon-btn" data-md-del="${i}" aria-label="Remove dish">${icon('x', 16)}</button></div>
      <div style="display:flex;gap:var(--s2)">
        ${ev.outsourced ? '' : sel(i, 'head', [['', 'Our kitchen – आपले किचन'], ...heads.map(h => [h, h])], d.head || '')}
        ${meals.length > 1 ? sel(i, 'meal', [['', 'All meals – सर्व जेवण'], ...meals.map(m => [m, MEALS[m]])], d.meal || '') : ''}
      </div></div>`).join('') : '';
}

async function saveMenu() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  if (parseMenu(qv('menu-text')).join('\n').toLowerCase() !== menuDraft.map(d => d.name).join('\n').toLowerCase()) readMenuText();
  const meals = MEAL_ORDER.filter(m => (ev.meals || []).includes(m));
  const dishes = menuDraft.map(d => { const x = { ...d }; if (!x.meal || !meals.includes(x.meal)) delete x.meal; return x; });
  const before = ev.dishes || [];
  const changed = JSON.stringify(before) !== JSON.stringify(dishes);
  const patch = { dishes };
  if (changed && before.length) {
    // Keep the previous menu (G-11) and mark sent/confirmed orders whose counter's dishes changed; nothing is re-sent
    patch.menuVersions = [...(ev.menuVersions || []), { at: new Date().toISOString(), dishes: before }].slice(-20);
    const hit = new Set(menuChangeImpact(before, dishes, ev.orders || []));
    if (hit.size) patch.orders = ev.orders.map(o => hit.has(o.id) ? { ...o, menuChanged: true } : o);
  }
  await patchEvent(ev.id, patch);
  closeModals();
  const flagged = (patch.orders || []).filter(o => o.menuChanged).length;
  const n = ev.outsourced ? 1 : new Set(dishes.filter(d => d.head).map(d => d.head)).size;
  showToast(flagged ? `Menu saved · ${flagged} order${flagged > 1 ? 's' : ''} sent earlier may need updating – ऑर्डर तपासा`
    : n ? `Menu saved · ${n} counter order${n > 1 ? 's' : ''} to send – ${n} ऑर्डर` : 'Menu saved – मेनू जतन झाला', flagged ? 'error' : 'success');
  refreshCurrent();
}

async function assignDish(i) {
  const ev = D.events.find(e => e.id === curRef); const d = ev?.dishes?.[i]; if (!d) return;
  const heads = EXPENSE_HEADS['Live Counter'].filter(h => !/counter setup/i.test(h));
  const head = await askSheet({
    title: `${d.name} – comes from?`,
    actions: [{ label: 'Our kitchen – आपले किचन', value: '__kitchen', style: 'btn-secondary' },
              ...heads.map(h => ({ label: h, value: h, style: h === d.head ? 'btn-primary' : 'btn-secondary' }))]
  });
  if (!head) return;
  const dishes = ev.dishes.map((x, j) => j === i ? { ...x, head: head === '__kitchen' ? '' : head, manual: true } : x);
  await patchEvent(ev.id, { dishes });
  refreshCurrent();
}

function openOrderModal({ head, orderId }) {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const o = orderId ? (ev.orders || []).find(x => x.id === orderId) : null;
  head = o?.head || head;
  q('ord-id').value = o?.id || '';
  q('ord-head').value = head;
  q('ord-mtitle').textContent = ev.outsourced ? 'Menu to caterer – केटररला मेनू' : `${short(head)} order – ऑर्डर`;
  q('ord-items').textContent = (dishGroups(ev).get(head) || []).join(', ');
  const [usual, inCat, others] = rankVendors('Live Counter', head);
  const opt = v => ({ v: v.id, l: v.name + (v.phone ? '' : ' (no phone)') });
  populateSelect('ord-ven', [{ v: '', l: 'Choose vendor – विक्रेता निवडा' }, ...[...usual, ...inCat, ...others].map(opt)],
    o?.venId || (ev.outsourced ? ev.outVenId : counterVendor(head)));
  // Counter plan: this event's, else the last one used for this counter (a starting point; nothing assumed)
  const own = ev.counterPlan?.[head], prev = own ? null : lastCounterPlan(D.events, head, ev.id);
  const plan = own || prev || {};
  q('ord-plan-fields').hidden = !!ev.outsourced;
  q('ord-takeup').value = !ev.outsourced && plan.takeUp ? plan.takeUp : '';
  q('ord-min').value = !ev.outsourced && plan.minimum ? plan.minimum : '';
  ordAuto = '';
  q('ord-plates').value = o?.plates || '';
  updateCounterPlan();
  // No plan: start from this counter's guests (its meal's count if known), still replaceable by a plan
  if (!q('ord-plates').value) { const g = counterGuests(ev, head).guests || ''; q('ord-plates').value = g; ordAuto = String(g); }
  q('ord-date').value = o?.date || ev.date;
  q('ord-time').value = o?.time || '';
  q('ord-notes').value = o?.notes || '';
  q('btn-cancel-ord').hidden = !o;
  clearFieldErrors();
  openSheet('ord-modal');
}

let ordAuto = '';   // plates last filled from the plan, so a number typed by hand is never replaced
function updateCounterPlan() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const hint = q('ord-plan');
  if (ev.outsourced) { hint.hidden = true; return; }
  const { guests, meal } = counterGuests(ev, qv('ord-head'));
  const s = counterSuggestion(guests, qv('ord-takeup'), qv('ord-min'));
  const plates = Number(qv('ord-plates')) || 0, min = Math.floor(Number(qv('ord-min')) || 0);
  if (s && (!qv('ord-plates') || qv('ord-plates') === ordAuto)) { q('ord-plates').value = String(s.proposed); ordAuto = String(s.proposed); }
  const parts = [];
  if (s) parts.push(tr(`${guests} ${meal ? MEALS[meal].toLowerCase() + ' ' : ''}guests × ${Number(qv('ord-takeup'))}% = ${s.forecast} suggested`, `${guests} पाहुणे × ${Number(qv('ord-takeup'))}% = ${s.forecast}`)
    + (s.minimumApplied ? tr(` · vendor minimum ${min}`, ` · किमान ${min}`) : ''));
  if (min && plates && plates < min) parts.push(`<span class="due">${tr(`Below the vendor minimum of ${min}: add a note why`, `किमान ${min} पेक्षा कमी: कारण लिहा`)}</span>`);
  hint.innerHTML = parts.join('<br>'); hint.hidden = !parts.length;
}

function orderMessage(ev, o, ven) {
  const items = (dishGroups(ev).get(o.head) || []).join(', ');
  return `Namaste ${ven.name}! Order for ${ev.name}:\n`
    + `Date: ${fmtDate(o.date)}${o.time ? ', ' + o.time : ''}${ev.meals?.length ? ' (' + mealLabel(ev) + ')' : ''}\nVenue: ${ev.venue || '-'}\n`
    + (ev.outsourced ? `Full event catering for ${o.plates || '-'} guests\n` + (items ? `Menu: ${items}\n` : '')
                     : `${short(o.head)} for ${o.plates || '-'} plates\n` + (items ? `Items: ${items}\n` : ''))
    + (o.notes ? `Note: ${o.notes}\n` : '') + `\nPlease confirm. Thank you!`;
}

async function sendOrder() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const venId = qv('ord-ven');
  if (!venId) { showFieldErrors({ 'ord-ven': 'Choose a vendor – विक्रेता निवडा' }); return; }
  const ven = D.vendors.find(v => v.id === venId);
  const takeUp = Number(qv('ord-takeup')) || 0, minimum = Math.floor(Number(qv('ord-min')) || 0);
  if (!ev.outsourced && qv('ord-takeup') && !(takeUp > 0 && takeUp <= 100)) { showFieldErrors({ 'ord-takeup': 'Between 1 and 100 – १ ते १००' }); return; }
  const below = !ev.outsourced && minimum > 0 && (Number(qv('ord-plates')) || 0) < minimum;
  if (below && !qv('ord-notes')) { showFieldErrors({ 'ord-notes': `Below the vendor minimum of ${minimum}: add a note why – कारण लिहा` }); return; }
  const id = qv('ord-id') || uid('OR');
  const old = (ev.orders || []).find(x => x.id === id);
  const phoneOk = !!phoneDigits(ven?.phone);
  // Opening WhatsApp is not proof the message was sent: a new order is 'opened' (or 'prepared' without a phone),
  // and only you mark it sent, or the vendor's confirmation, moves it on. A menu-change warning stays until then.
  const status = !old || old.status === 'cancelled' ? (phoneOk ? 'opened' : 'prepared') : old.status === 'prepared' && phoneOk ? 'opened' : old.status;
  const o = { ...(old || {}), id, head: qv('ord-head'), venId, plates: Number(qv('ord-plates')) || 0, date: qv('ord-date'), time: qv('ord-time'),
              notes: qv('ord-notes'), status, at: new Date().toISOString(), ...(phoneOk ? { openedAt: new Date().toISOString() } : {}) };
  // Keep every different message sent for this order (G-26); the latest version starts as opened/prepared
  const now = new Date().toISOString();
  const versioned = addOrderMessage(old?.messages, orderMessage(ev, o, ven), phoneOk, now);
  o.messages = versioned.messages;
  // A new instruction is not yet sent or confirmed. An order from before message versions (no recorded messages) can't
  // be shown to be unchanged, so a resend of it is treated the same way.
  const unproven = old && !(old.messages || []).length;
  if ((versioned.changed || unproven) && old && ['sent', 'confirmed'].includes(old.status)) o.status = phoneOk ? 'opened' : 'prepared';
  if (below) o.belowMinimum = minimum; else delete o.belowMinimum;
  const sugg = ev.outsourced ? null : counterSuggestion(counterGuests(ev, o.head).guests, takeUp, minimum);
  if (sugg) o.suggested = sugg.proposed; else delete o.suggested;   // what the plan proposed; the order (plates) is yours
  const orders = old ? ev.orders.map(x => x.id === id ? o : x) : [...(ev.orders || []), o];
  const patch = { orders };
  if (!ev.outsourced && (takeUp || minimum)) patch.counterPlan = { ...(ev.counterPlan || {}), [o.head]: { ...(takeUp ? { takeUp } : {}), ...(minimum ? { minimum } : {}) } };
  const saved = await patchEvent(ev.id, patch);
  closeModals();
  refreshCurrent();
  const phone = phoneDigits(ven?.phone);
  if (phone) window.open(`https://wa.me/${phone}?text=${encodeURIComponent(o.messages.at(-1).text)}`, '_blank', 'noopener');
  else showToast(`Order saved. ${ven?.name || 'This vendor'} has no phone number – add it to send on WhatsApp.`, 'error');
}

async function orderAction(orderId) {
  const ev = D.events.find(e => e.id === curRef); const o = ev?.orders?.find(x => x.id === orderId); if (!o) return;
  const ven = D.vendors.find(v => v.id === o.venId);
  const next = await askSheet({
    title: `${short(o.head)} · ${ven?.name || ''} – ${ORDER_STATUS[o.status].en}`,
    actions: [
      ...(['prepared', 'opened'].includes(o.status) || o.menuChanged ? [{ label: 'I have sent it – पाठवले', value: 'sent', style: 'btn-secondary' }] : []),
      ...(['prepared', 'opened', 'sent'].includes(o.status) || o.menuChanged ? [{ label: 'Vendor confirmed – पक्के', value: 'confirmed', style: 'btn-secondary' }] : []),
      ...(o.status !== 'delivered' ? [{ label: 'Delivered · record bill – आले, बिल नोंदवा', value: 'delivered', style: 'btn-primary' }] : []),
      { label: 'Edit / send again – बदला', value: 'edit', style: 'btn-secondary' },
      ...((o.messages || []).length ? [{ label: `Messages sent (${o.messages.length}) – पाठवलेले संदेश`, value: 'history', style: 'btn-secondary' }] : []),
      ...(o.status === 'delivered' && !orderBillOf(o) ? [{ label: 'Record / link its bill – बिल नोंदवा', value: 'bill', style: 'btn-primary' }] : []),
      ...(o.status !== 'delivered' ? [{ label: 'Cancel order – रद्द', value: 'cancelled', style: 'btn-danger' }] : [])
    ]
  });
  if (!next) return;
  if (next === 'edit') { openOrderModal({ orderId }); return; }
  if (next === 'bill') { orderBill(ev, o); return; }
  if (next === 'history') {
    const MSG = { prepared: 'Not sent yet', opened: 'WhatsApp opened (not confirmed sent)', sent: 'Sent (you confirmed)', confirmed: 'Vendor confirmed' };
    await askSheet({ title: `${short(o.head)} · messages – संदेश`,
      message: [...o.messages].reverse().map(m => `Version ${m.v} · ${fmtDate(m.at.slice(0, 10))} ${m.at.slice(11, 16)} · ${MSG[m.status]}\n${m.text}`).join('\n\n— — —\n\n'), actions: [] });
    return;
  }
  // Marking it sent or vendor-confirmed is what clears a menu-change warning (the latest menu went out)
  await patchEvent(ev.id, { orders: ev.orders.map(x => { if (x.id !== orderId) return x; const y = { ...x, status: next };
    if (['sent', 'confirmed'].includes(next)) { delete y.menuChanged; if (y.messages?.length) y.messages = markOrderMessage(y.messages, next, new Date().toISOString()); }
    return y; }) });
  refreshCurrent();
  if (next !== 'delivered') return;
  // Outsourced: their charge was recorded when the event was booked; don't count it twice
  if (ev.outsourced && D.expenses.some(x => x.evId === ev.id && x.venId === o.venId)) { showToast('Done. Their charge is already recorded for this event.'); return; }
  orderBill(D.events.find(e => e.id === ev.id) || ev, o);
}

// The bill recorded for an order (an expense carrying `order: id`)
const orderBillOf = o => D.expenses.find(x => x.order === o.id) || null;
/* Delivered: the vendor's actual bill. If a bill from this vendor is already on the event (entered from the bill
   itself, or a shared bill), link it instead of recording it again (G-23); otherwise record it, linked. */
async function orderBill(ev, o) {
  if (orderBillOf(o)) { showToast('Its bill is already recorded – बिल आधीच नोंदवले'); return; }
  const ven = D.vendors.find(v => v.id === o.venId);
  const open = D.expenses.filter(x => x.evId === ev.id && x.venId === o.venId && !x.order && !x.draft).slice(0, 3);
  if (open.length) {
    const pick = await askSheet({ title: 'Bill already recorded? – बिल आधीच नोंदवले?',
      message: `${ven?.name || 'This vendor'} already has ${open.length === 1 ? 'a bill' : 'bills'} on this event. If the delivery's bill is one of these, link it so it is not counted twice.`,
      actions: [...open.map(x => ({ label: `Link: ${short(x.head || x.cat)} · ${fmtCurrency(x.split?.total ?? x.amt)} · ${fmtDate(x.date)}`, value: x.id, style: 'btn-primary' })),
        { label: 'No, record a new bill – नवीन बिल', value: 'new', style: 'btn-secondary' }] });
    if (!pick) return;
    if (pick !== 'new') {
      const x = D.expenses.find(e => e.id === pick); if (!x) return;
      const { _rev, ...rec } = x;
      await commitChanges([{ store: 'expenses', record: { ...rec, order: o.id }, expected: x }], { check: true, extraStores: ['events', 'vendors'] });
      await loadAll(); refreshCurrent();
      showToast('Bill linked to the order – बिल ऑर्डरला जोडले'); return;
    }
  }
  openExpModal({ prefill: { evId: ev.id, cat: ev.outsourced ? 'Operations' : 'Live Counter', head: o.head, venId: o.venId, order: o.id } });
}

async function cancelOrderFromSheet() {
  const id = qv('ord-id'); const ev = D.events.find(e => e.id === curRef); if (!ev || !id) return;
  await patchEvent(ev.id, { orders: ev.orders.map(x => x.id === id ? { ...x, status: 'cancelled' } : x) });
  closeModals(); refreshCurrent();
}

// Home: orders due today or tomorrow that haven't arrived yet
function deliveriesCard() {
  const t = today(), tm = addDays(t, 1);
  const due = D.events.flatMap(ev => (ev.orders || []).filter(o => ACTIVE_ORDER.includes(o.status) && (o.date === t || o.date === tm)).map(o => ({ ev, o })))
    .sort((a, b) => (a.o.date + (a.o.time || '')).localeCompare(b.o.date + (b.o.time || '')));
  if (!due.length) return '';
  return `
    <div class="sec"><span class="sec-title">Deliveries – पुरवठा</span><span class="meta">${due.length}</span></div>
    <div class="card list" id="deliveries">${due.map(({ ev, o }) => {
      const ven = D.vendors.find(v => v.id === o.venId), st = ORDER_STATUS[o.status];
      return `<div class="row" role="button" tabindex="0" data-action="evdetail" data-id="${esc(ev.id)}">
        <div class="row-ic">${icon('truck', 18)}</div>
        <div class="row-body"><div class="title-sm trunc">${o.date === t ? tr('Today', 'आज') : tr('Tomorrow', 'उद्या')}${o.time ? ' ' + esc(o.time) : ''} · <span data-nl>${esc(ven?.name || '')}</span></div>
          <div class="meta trunc">${esc(short(o.head))} · ${o.plates || ''} ${tr('plates', 'ताट')} · <span data-nl>${esc(ev.name)}</span></div></div>
        <span class="chip ${st.tone}">${tr(st.en, st.mr)}</span>
      </div>`;
    }).join('')}</div>`;
}

// Quiet comparison, per category, of this event's cost per plate with the usual for its menu/type
// Costing reminders from the venue logistics (prompts only; nothing is added by itself)
function logisticsCard(ev) {
  const list = logisticsPrompts(ev, D.expenses);
  if (!list.length) return '';
  return `<div class="sec"><span class="sec-title">Venue costs to check – ठिकाणाचा खर्च</span></div>
    <div class="card list" id="logi-card">${list.map((p, i) => `<div class="row" style="min-height:52px">
      <div class="row-ic">${icon(p.recorded ? 'check' : 'alert', 18)}</div>
      <div class="row-body"><div class="title-sm">${tr(p.en, p.mr)}</div><div class="meta">${p.recorded ? tr('Recorded', 'नोंदवले') : tr('Not recorded yet', 'अजून नोंदवले नाही')}</div></div>
      ${p.recorded ? '' : `<button type="button" class="btn-sm" data-action="logi-add" data-id="${i}">${icon('plus', 16)}${tr('Cost', 'खर्च')}</button>`}
    </div>`).join('')}</div>`;
}

/* ── FINAL SETTLEMENT (spec §6.7, G-35) ── */
// Event page: once the event is over, what is settled and what is still owed or disputed
function settleLine(ev) {
  const st = settlementStatus(ev, D.cPays);
  if (ev.date > today() && !st.adjustments.length) return '';
  if (!st.outstanding && !st.over && !st.adjustments.length) return '';
  const lines = [
    ...st.adjustments.map(c => `${SETTLE_KINDS[c.kind][0]} ${fmtCurrency(c.from - c.to)} · <span data-nl>${esc(c.reason)}</span>`),
    ...(st.disputed ? [`<span class="due">${tr(`Disputed ${fmtCurrency(st.disputed)}`, `वादग्रस्त ${fmtCurrency(st.disputed)}`)}</span> · <span data-nl>${esc(ev.dispute.reason)}</span>`] : []),
    ...(st.over ? [`<span class="due">${tr(`Received ${fmtCurrency(st.over)} more than the bill`, `बिलापेक्षा ${fmtCurrency(st.over)} जास्त मिळाले`)}</span>`] : []),
    ...(st.taxReview ? [`<span class="due">${tr('Tax / invoice review needed (ask your accountant)', 'कर / बिल तपासणी आवश्यक')}</span>`] : [])];
  return `<div style="margin-top:var(--s3)" id="settle-line">${lines.map(l => `<div class="meta">${l}</div>`).join('')}
    <button type="button" class="btn-sm" style="margin-top:var(--s2)" data-action="settle-open">${icon('check', 16)}${tr('Final settlement', 'अंतिम हिशोब')}</button></div>`;
}
function openSettle() { renderSettle(); openSheet('settle-modal'); }
function renderSettle() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const st = settlementStatus(ev, D.cPays);
  const row = (l, v, cls = '') => `<div style="display:flex;justify-content:space-between;gap:var(--s2);margin-top:6px"><span class="meta">${l}</span><span class="amt-sm ${cls}">${v}</span></div>`;
  q('settle-body').innerHTML = `
    ${st.changes.length ? row(tr('Bill as agreed', 'मूळ बिल'), fmtCurrency(st.original)) : ''}
    ${st.changes.map(c => row(`${c.kind ? SETTLE_KINDS[c.kind][0] : tr('Change', 'बदल')} · <span data-nl>${esc(c.reason)}</span> · ${fmtDate(String(c.at).slice(0, 10))}${c.ack ? ` · ${c.ack === 'none' ? tr('client not acknowledged', 'ग्राहकाची संमती नाही') : tr(`client ${c.ack}`, c.ack)}` : ''}`,
      `${c.to >= c.from ? '+' : '−'}${fmtCurrency(Math.abs(c.to - c.from))}`)).join('')}
    ${row(tr('Bill now', 'आताचे बिल'), fmtCurrency(st.billed))}
    ${row(tr('Received', 'मिळाले'), fmtCurrency(st.received), 'pos')}
    ${row(tr('Still owed', 'बाकी'), fmtCurrency(st.outstanding), st.outstanding ? 'due' : 'muted')}
    ${st.over ? `<div class="meta due" style="margin-top:var(--s2)">${tr(`Received ${fmtCurrency(st.over)} more than the bill. Check for a refund due or a bill change.`, `बिलापेक्षा ${fmtCurrency(st.over)} जास्त मिळाले.`)}</div>` : ''}
    ${st.outstanding ? `
    <div class="ask-msg" style="margin:var(--s4) 0 var(--s2)">${tr('If the client paid less, the rest stays owed until you decide. Only an agreed discount, waiver or write-off lowers the bill; payments received are never changed.', 'ग्राहकाने कमी दिल्यास, तुम्ही ठरवेपर्यंत बाकी तशीच राहते.')}</div>
    <div class="f2">
      <div class="field"><label for="st-amt">Amount ₹ – रक्कम</label><input type="number" id="st-amt" min="0" inputmode="decimal" value="${st.outstanding}"></div>
      <div class="field"><label for="st-kind">What was agreed – काय ठरले</label><select id="st-kind"><option value="">Choose – निवडा</option>${Object.entries(SETTLE_KINDS).map(([k, [en, mr]]) => `<option value="${k}">${en} – ${mr}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label for="st-reason">Reason – कारण</label><input type="text" id="st-reason" maxlength="300" placeholder="e.g. client paid a round figure" value="${esc(ev.dispute?.reason || '')}"></div>
    <div class="field"><label for="st-ack">Client agreed – ग्राहकाची संमती</label><select id="st-ack"><option value="written">In writing (message / signed)</option><option value="verbal">Verbally</option><option value="none">Not acknowledged</option></select></div>
    <div class="btn-row">
      <button type="button" class="btn btn-secondary" data-action="settle-dispute">${ev.dispute ? tr('Update dispute', 'वाद बदला') : tr('Mark disputed', 'वादग्रस्त')}</button>
      <button type="button" class="btn btn-primary" data-action="settle-adjust">${tr('Lower the bill', 'बिल कमी करा')}</button>
    </div>
    ${ev.dispute ? `<button type="button" class="btn-sm" style="margin-top:var(--s2)" data-action="settle-undispute">${tr('Dispute resolved – clear it', 'वाद मिटला')}</button>` : ''}` : ''}`;
}
async function settleAction(action) {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const st = settlementStatus(ev, D.cPays), now = new Date().toISOString();
  if (action === 'settle-undispute') { await patchEvent(ev.id, {}, ['dispute']); refreshCurrent(); renderSettle(); return; }
  const amt = qf('st-amt'), reason = qv('st-reason').trim();
  if (!(amt > 0) || toPaise(amt) > toPaise(st.outstanding)) { showFieldErrors({ 'st-amt': `Up to ${fmtCurrency(st.outstanding)} still owed – बाकीपर्यंत` }); return; }
  if (!reason) { showFieldErrors({ 'st-reason': 'Write the reason – कारण लिहा' }); return; }
  if (action === 'settle-dispute') {
    await patchEvent(ev.id, { dispute: { amt, reason, at: now } }); refreshCurrent(); renderSettle();
    showToast(`${fmtCurrency(amt)} marked disputed; still owed – वादग्रस्त`); return;
  }
  const kind = qv('st-kind'), ack = qv('st-ack');
  if (!kind) { showFieldErrors({ 'st-kind': 'Choose what was agreed – निवडा' }); return; }
  const to = fromPaiseLocal(toPaise(ev.billing) - toPaise(amt));
  const ok = await askSheet({ title: 'Lower the bill? – बिल कमी करायचे?',
    message: `${SETTLE_KINDS[kind][0]}: bill ${fmtCurrency(ev.billing)} → ${fmtCurrency(to)}. The event's contribution falls by ${fmtCurrency(amt)}; payments received stay as they are. A reconciled event becomes provisional again. GST / invoice treatment of this change needs your accountant's review.`,
    actions: [{ label: `Lower by ${fmtCurrency(amt)} – कमी करा`, value: true, style: 'btn-primary' }] });
  if (!ok) return;
  const left = toPaise(st.outstanding) - toPaise(amt);
  await patchEvent(ev.id, { billing: to, billChanges: [...(ev.billChanges || []), { at: now, from: ev.billing, to, reason, kind, ack, taxReview: true }],
    ...(ev.dispute && left > 0 ? { dispute: { ...ev.dispute, amt: Math.min(ev.dispute.amt, left / 100) } } : {}) }, ev.dispute && left <= 0 ? ['dispute'] : []);
  closeModals(); refreshCurrent(); showToast(`Bill is now ${fmtCurrency(to)} – बिल अद्ययावत`);
}
const fromPaiseLocal = p => p / 100;

/* ── GUEST COUNT / EXTRA PLATES (spec §6.7) ── */
const MEAL_NAME = k => k === 'all' ? 'Guests' : MEALS[k];
const countKeys = ev => ev.meals?.length ? COUNT_MEALS.filter(m => ev.meals.includes(m)) : ['all'];
// Event page: one concise line per counted meal, plus the action
function countLine(ev) {
  const lines = countKeys(ev).map(k => ({ k, s: guestCountStatus(ev, k) })).filter(x => x.s.started);
  return `<div style="margin-top:var(--s3)" id="count-line">${lines.map(({ k, s }) => `<div class="meta" data-nl>${MEAL_NAME(k)}: ${tr(`contracted ${s.contracted} · counted ${s.counted ?? '—'}${s.extra ? ` · extra ${s.extra}` : ''}${s.accepted ? ` · approved ${s.accepted}` : ''}${s.disputed ? ` · disputed ${s.disputed}` : ''}${s.billed ? ` · billed ${s.billed}` : ''}`,
    `करार ${s.contracted} · मोजले ${s.counted ?? '—'}${s.extra ? ` · जास्त ${s.extra}` : ''}`)}</div>`).join('')}
    ${ev.date >= today() && !countPolicyAgreed(ev.countPolicy) ? `<div class="meta due" id="count-policy-flag">${tr('Count method not agreed with the client yet', 'मोजणीची पद्धत ग्राहकाशी ठरलेली नाही')}</div>` : ''}
    <button type="button" class="btn-sm" style="margin-top:var(--s2)" data-action="count-open">${icon('users', 16)}${tr('Guest count / Extra plates', 'पाहुणे / जास्त ताटे')}</button></div>`;
}
let countMeal = 'all';
function openCountModal() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const keys = countKeys(ev);
  if (!keys.includes(countMeal)) countMeal = keys.includes('dinner') ? 'dinner' : keys[0];
  renderCount(); openSheet('count-modal');
}
function renderCount() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const keys = countKeys(ev), k = countMeal, s = guestCountStatus(ev, k);
  q('count-meals').innerHTML = keys.length > 1 ? keys.map(m => `<button type="button" class="f-chip" data-count-meal="${m}" aria-pressed="${m === k}">${MEALS[m]}</button>`).join('') : '';
  const fmtAt = at => `${fmtDate(at.slice(0, 10))} ${at.slice(11, 16)}`;
  const reqRows = s.requests.map(r => `<div class="meta" style="margin-top:6px" data-req="${esc(r.id)}">
    ${tr(`Asked ${r.qty} extra @ ${fmtCurrency(r.rate)} on ${fmtAt(r.at)}`, `${r.qty} जास्त @ ${fmtCurrency(r.rate)} विचारले`)}${r.forOlderCount ? ` · <span class="due">${tr('made for an earlier count', 'आधीच्या मोजणीसाठी')}</span>` : ''}
    ${r.status === 'requested'
      ? `<div class="f2" style="margin-top:4px"><div class="field" style="margin:0"><input type="number" data-accept="${esc(r.id)}" min="0" max="${r.qty}" inputmode="numeric" placeholder="Accepted" aria-label="Extra plates the client accepted"></div>
           <div class="field" style="margin:0"><select data-evidence="${esc(r.id)}" aria-label="How the client approved"><option value="">Written / verbal?</option><option value="written">Written reply / signed sheet</option><option value="verbal">Verbal (said in person or on call)</option></select></div></div>
         <div style="display:flex;gap:var(--s2);align-items:center;margin-top:4px"><div class="field" style="margin:0;flex:1"><input type="text" data-by="${esc(r.id)}" maxlength="200" placeholder="Who approved / ref." aria-label="Who approved, or a reference to the reply"></div>
         <button type="button" class="btn-sm" data-action="count-accept" data-id="${esc(r.id)}">${tr('Record', 'नोंदवा')}</button></div>`
      : ` · <b>${tr(`accepted ${r.accepted}`, `मान्य ${r.accepted}`)}</b>${r.evidence ? ` · ${r.evidence === 'written' ? tr('written', 'लेखी') : tr('verbal', 'तोंडी')}${r.by ? ` (<span data-nl>${esc(r.by)}</span>)` : ''}` : ''}${r.disputed ? ` · <span class="neg">${tr(`disputed ${r.disputed}`, `वाद ${r.disputed}`)}</span>` : ''}${r.billedAt ? ` · ${tr('added to bill', 'बिलात जोडले')}` : ''}`}
  </div>`).join('');
  const cp = ev.countPolicy || {}, agreed = countPolicyAgreed(cp);
  q('count-body').innerHTML = `
    <details class="card pad" id="count-policy" style="margin:0 0 var(--s3)"${agreed || ev.date <= today() ? '' : ' open'}>
      <summary class="label" style="cursor:pointer">${agreed ? tr(`Count method: ${COUNT_METHODS.find(m => m.id === cp.method).en} · agreed`, `मोजणी: ${COUNT_METHODS.find(m => m.id === cp.method).mr} · ठरले`) : tr('Count method not agreed with the client yet', 'मोजणीची पद्धत ठरलेली नाही')}</summary>
      <div class="field" style="margin-top:var(--s2)"><label for="cp-method">${tr('How plates are counted', 'मोजणीची पद्धत')}</label><select id="cp-method"><option value="">Choose – निवडा</option>${COUNT_METHODS.map(m => `<option value="${m.id}"${m.id === cp.method ? ' selected' : ''}>${esc(m.en + ' – ' + m.mr)}</option>`).join('')}</select></div>
      <div class="field"><label for="cp-counter">${tr('Who counts, and where', 'कोण व कुठे मोजणार')}</label><input type="text" id="cp-counter" maxlength="200" value="${esc(cp.counter || '')}" placeholder="e.g. supervisor at plate counter"></div>
      <div class="f2"><div class="field"><label for="cp-rep">${tr('Client representative', 'ग्राहक प्रतिनिधी')}</label><input type="text" id="cp-rep" maxlength="100" value="${esc(cp.rep || '')}" placeholder="Name"></div>
        <div class="field"><label for="cp-rep-phone">${tr('Their phone', 'फोन')}</label><input type="tel" id="cp-rep-phone" maxlength="20" inputmode="tel" value="${esc(cp.repPhone || '')}" placeholder="Mobile"></div></div>
      <div class="field"><label for="cp-rules">${tr('Rules agreed', 'ठरलेले नियम')}</label><textarea id="cp-rules" rows="2" maxlength="1000" placeholder="Second servings, kids, staff and vendor meals, tolerance">${esc(cp.rules || '')}</textarea></div>
      <label class="check-row"><input type="checkbox" id="cp-confirmed"${cp.confirmed ? ' checked' : ''}><span>${tr('The client agreed to this method', 'ग्राहकाने ही पद्धत मान्य केली')}</span></label>
      <button type="button" class="btn btn-secondary" style="width:100%;margin-top:var(--s2)" data-action="count-policy-save">${tr('Save count method', 'पद्धत जतन')}</button>
    </details>
    <div class="card pad" style="margin:0 0 var(--s3)">
      <div class="label">${tr(`${MEAL_NAME(k)} · contracted ${s.contracted} @ ${fmtCurrency(s.rate)}`, `करार ${s.contracted} @ ${fmtCurrency(s.rate)}`)}</div>
      <div class="meta" style="margin-top:4px">${s.counted == null ? tr('Not counted yet', 'अजून मोजले नाही') : tr(`Counted ${s.counted} (${fmtAt(s.last.at)})`, `मोजले ${s.counted}`)}${s.extra ? ` · <b>${tr(`${s.extra} over the contract (proposed, not billed)`, `${s.extra} जास्त (प्रस्तावित)`)}</b>` : ''}</div>
      ${s.counts.length > 1 ? `<details style="margin-top:6px"><summary class="meta" style="cursor:pointer">${tr(`Count history (${s.counts.length})`, `मोजणी इतिहास (${s.counts.length})`)}</summary>
        ${[...s.counts].reverse().map(x => `<div class="meta" data-nl>${fmtAt(x.at)} · ${x.n}${x.reason ? ` · ${tr('correction', 'दुरुस्ती')}: ${esc(x.reason)}` : x.note ? ` · ${esc(x.note)}` : ''}</div>`).join('')}</details>` : ''}
      ${reqRows}
    </div>
    <div class="f2"><div class="field"><label for="count-n">${tr('New count', 'नवीन मोजणी')}</label><input type="number" id="count-n" min="0" inputmode="numeric" placeholder="${s.counted ?? s.contracted}"></div>
      <div class="field"><label for="count-note">${tr(s.counted == null ? 'Note (optional)' : 'Reason if correcting', 'कारण')}</label><input type="text" id="count-note" placeholder="${s.counted == null ? 'e.g. plates issued at 9 pm' : 'e.g. recount at the gate'}"></div></div>
    <div class="btn-row">
      <button type="button" class="btn btn-secondary" data-action="count-save">${tr('Save count', 'मोजणी जतन')}</button>
      ${s.unrequested ? `<button type="button" class="btn btn-secondary" data-action="count-request">${tr(`Ask approval for ${s.unrequested} extra`, `${s.unrequested} जास्त मान्यता`)}</button>` : ''}
    </div>
    ${s.unbilled ? `<button type="button" class="btn btn-primary" style="width:100%;margin-top:var(--s3)" data-action="count-bill">${tr(`Add ${s.unbilled} approved plates to the bill (+${fmtCurrency(s.requests.filter(r => r.unbilled).reduce((t, r) => t + toPaise(r.rate) * r.unbilled, 0) / 100)})`, `${s.unbilled} मान्य ताटे बिलात जोडा`)}</button>` : ''}`;
}
async function saveGuestCounts(mutate, extra = {}) {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return null;
  const k = countMeal, all = structuredClone(ev.guestCounts || {});
  if (!all[k]) { const d = contractedFor(ev, k); all[k] = { contracted: d.contracted, rate: d.rate, counts: [], requests: [] }; }   // the guarantee as it stands now, kept from here on
  const res = mutate(all[k], ev);
  if (res === false) return null;
  try { return await patchEvent(ev.id, { guestCounts: all, ...(typeof extra === 'function' ? extra(all[k], ev) : extra) }); }
  catch (e) { showToast(e.message || 'Could not save. Nothing was changed.', 'error'); return null; }
}
async function countAction(action, id) {
  const now = new Date().toISOString();
  if (action === 'count-save') {
    const raw = qv('count-n'), n = Math.floor(Number(raw)), note = qv('count-note');
    if (raw === '' || !(n >= 0)) { showFieldErrors({ 'count-n': 'Enter the count – संख्या लिहा' }); return; }
    const had = guestCountStatus(D.events.find(e => e.id === curRef), countMeal).counted;
    if (had != null && !note) { showFieldErrors({ 'count-note': 'Say why the count changed – कारण लिहा' }); return; }
    await saveGuestCounts(c => { c.counts.push({ at: now, n, ...(had != null ? { reason: note, correctionOf: c.counts.at(-1).at } : note ? { note } : {}) }); });
  } else if (action === 'count-request') {
    const ev = D.events.find(e => e.id === curRef), s = guestCountStatus(ev, countMeal); if (!s.unrequested) return;
    const text = extraPlatesMessage(ev, countMeal, s, s.unrequested);
    const phone = phoneDigits(ev.countPolicy?.repPhone) || phoneDigits(ev.mobile);
    if (phone) window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');   // inside the tap
    await saveGuestCounts(c => { c.requests.push({ id: uid('XR'), at: now, qty: s.unrequested, rate: c.rate, countAt: c.counts.at(-1).at, status: 'requested', text }); });
    showToast(phone ? 'Request kept. Opening WhatsApp is not approval: record the client\'s reply when it comes. – विनंती नोंदवली'
      : 'Approval request recorded. Nothing is billed until the client accepts and you add it. – विनंती नोंदवली');
  } else if (action === 'count-accept') {
    const input = document.querySelector(`[data-accept="${CSS.escape(id)}"]`); const n = Math.floor(Number(input?.value));
    const r = (D.events.find(e => e.id === curRef).guestCounts?.[countMeal]?.requests || []).find(x => x.id === id);
    if (!r || input.value === '' || !(n >= 0) || n > r.qty) { showToast(`Enter 0 to ${r?.qty ?? ''} plates – संख्या तपासा`, 'error'); return; }
    const evidence = document.querySelector(`[data-evidence="${CSS.escape(id)}"]`)?.value || '', by = (document.querySelector(`[data-by="${CSS.escape(id)}"]`)?.value || '').trim();
    if (!evidence) { showToast('Say how the client approved: written or verbal – मान्यता कशी मिळाली?', 'error'); return; }
    if (evidence === 'verbal' && !by) { showToast('For a verbal approval, write who approved – कोणी मान्य केले?', 'error'); return; }
    await saveGuestCounts(c => { const x = c.requests.find(y => y.id === id); Object.assign(x, { status: 'approved', accepted: n, acceptedAt: now, evidence, ...(by ? { by } : {}) }); });
  } else if (action === 'count-bill') {
    const ev = D.events.find(e => e.id === curRef), s = guestCountStatus(ev, countMeal);
    const add = s.requests.filter(r => r.unbilled).reduce((t, r) => t + toPaise(r.rate) * r.unbilled, 0);
    if (!add) return;
    const to = (toPaise(ev.billing) + add) / 100;
    const ok = await askSheet({ title: 'Add to the bill? – बिलात जोडायचे?',
      message: `${s.unbilled} approved extra ${MEAL_NAME(countMeal).toLowerCase()} plates: bill ${fmtCurrency(ev.billing)} → ${fmtCurrency(to)}. A reconciled event becomes provisional again.`,
      actions: [{ label: `Add ${fmtCurrency(add / 100)} – जोडा`, value: true, style: 'btn-primary' }] });
    if (!ok) return;
    await saveGuestCounts(c => { for (const r of c.requests) if (r.status === 'approved' && !r.billedAt && r.accepted > 0) r.billedAt = now; },
      (c, e) => ({ billing: to, billChanges: [...(e.billChanges || []), { at: now, from: e.billing, to, reason: `${s.unbilled} approved extra ${MEAL_NAME(countMeal).toLowerCase()} plates` }] }));
    closeModals(); refreshCurrent(); showToast(`Bill is now ${fmtCurrency(to)} – बिल अद्ययावत`); return;
  }
  refreshCurrent(); renderCount();
}

async function saveCountPolicy() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const p = { method: qv('cp-method'), counter: qv('cp-counter'), rep: qv('cp-rep'), repPhone: qv('cp-rep-phone'), rules: qv('cp-rules') };
  for (const k of Object.keys(p)) if (!p[k]) delete p[k];
  const confirmed = q('cp-confirmed').checked;
  if (confirmed && !p.method) { showFieldErrors({ 'cp-method': 'Choose the method the client agreed – पद्धत निवडा' }); return; }
  const old = ev.countPolicy || {};
  if (confirmed) { p.confirmed = true; p.confirmedAt = old.confirmed && old.method === p.method ? old.confirmedAt : new Date().toISOString(); }
  try { await patchEvent(ev.id, Object.keys(p).length ? { countPolicy: p } : {}, Object.keys(p).length ? [] : ['countPolicy']); }
  catch (e) { showToast(e.message || 'Could not save. Nothing was changed.', 'error'); return; }
  refreshCurrent(); renderCount(); showToast('Count method saved – मोजणी पद्धत जतन');
}
// Prefilled, editable request to the client's representative; amounts come from the agreed data (spec §11.5)
function extraPlatesMessage(ev, k, s, qty) {
  const cp = ev.countPolicy || {}, meal = MEAL_NAME(k).toLowerCase(), method = COUNT_METHODS.find(m => m.id === cp.method);
  return `Hello${cp.rep ? ' ' + cp.rep : ''}, for ${ev.name}${k === 'all' ? '' : ' ' + meal} on ${fmtDate(ev.date)}, the confirmed quantity is ${s.contracted} covers at ${fmtCurrency(s.rate)} per additional cover, before any applicable tax. `
    + `Our ${method ? method.en.toLowerCase() : 'count'} currently shows ${s.counted}, i.e. ${qty} more (estimated ${fmtCurrency(toPaise(s.rate) * qty / 100)}). `
    + `Please reply "Approved: ${qty} extra ${k === 'all' ? '' : meal + ' '}covers at ${fmtCurrency(s.rate)} each" (or call us to discuss) so we can record your approval.`;
}

/* ── FUNCTION SHEET (spec §9.3): one light internal summary for the team; no money on it ── */
function functionSheetText(ev, extra = ev.functionSheet || {}) {
  const L = [], line = (label, v) => { if (v) L.push(`${label}: ${v}`); };
  L.push(`FUNCTION SHEET – ${ev.name}`);
  line('Date', fmtDate(ev.date));
  line('Event', ev.typeOther || short(ev.type));
  line('Venue', [ev.venue, ev.locality].filter(Boolean).join(', ') + (ev.venueType ? ` (${venueTypeLabel(ev).split(' – ')[0]})` : ''));
  line('Client phone', ev.mobile);
  L.push(`Timings: ${extra.timings || 'not set'}`);
  const plan = ev.mealPlan || {}, meals = countKeys(ev).filter(k => k !== 'all');
  L.push('', 'GUESTS');
  if (meals.length) for (const m of meals) L.push(`- ${MEALS[m]}: ${plan[m]?.guests || ev.guests || '—'}`);
  else L.push(`- ${ev.guests || '—'}`);
  const cp = ev.countPolicy || {}, method = COUNT_METHODS.find(m => m.id === cp.method);
  L.push('', 'COUNTING');
  L.push(`- Method: ${method ? method.en : 'not set'}${countPolicyAgreed(cp) ? ' (agreed with client)' : ' – NOT AGREED WITH CLIENT YET'}`);
  if (cp.counter) L.push(`- Who counts: ${cp.counter}`);
  if (cp.rep) L.push(`- Client representative: ${cp.rep}${cp.repPhone ? ', ' + cp.repPhone : ''}`);
  if (cp.rules) L.push(`- Rules: ${cp.rules}`);
  const groups = dishGroups(ev), menu = menuById(ev.menu);
  L.push('', 'MENU');
  if (groups.size) for (const [head, names] of groups) {
    if (!head) { L.push(`- Our kitchen: ${names.join(', ')}`); continue; }
    const o = [...(ev.orders || [])].reverse().find(x => x.head === head && x.status !== 'cancelled');
    const ven = D.vendors.find(v => v.id === o?.venId);
    L.push(`- ${ev.outsourced ? 'Whole event' : short(head)}: ${names.join(', ')}`);
    L.push(`  ${ven ? `${ven.name}${ven.phone ? ' (' + ven.phone + ')' : ''}` : 'No vendor order yet'}${o ? ` · ${o.plates ? o.plates + ' plates · ' : ''}${ORDER_STATUS[o.status]?.en || o.status}` : ''}`);
  } else if (menu) L.push(`- ${menu.name}: ${menu.items.join(', ')}`);
  else L.push('- Not entered');
  const staff = (ev.labour?.rows || []).map(labRow).filter(r => !isExtra(r) && heads(r));
  if (staff.length) { L.push('', 'STAFF'); for (const r of staff) L.push(`- ${short(r.role)}: ${heads(r)}`); }
  const logi = ev.logistics || {}, setup = LOGISTICS.filter(x => logi[x.id] && logi[x.id] !== 'unknown').map(x => `${x.en}: ${(x.opts.find(o => o[0] === logi[x.id]) || [, logi[x.id]])[1]}`);
  if (setup.length || extra.setup) { L.push('', 'SETUP'); for (const s of setup) L.push(`- ${s}`); if (extra.setup) L.push(`- ${extra.setup}`); }
  if (ev.notes) L.push('', 'NOTES', ev.notes);
  return L.join('\n');
}
function openFunctionSheet() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  q('fs-timings').value = ev.functionSheet?.timings || ''; q('fs-setup').value = ev.functionSheet?.setup || '';
  renderFunctionSheet(); openSheet('fs-modal');
}
const fsDraft = () => { const t = qv('fs-timings'), s = qv('fs-setup'); return { ...(t ? { timings: t } : {}), ...(s ? { setup: s } : {}) }; };
function renderFunctionSheet() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  q('fs-text').textContent = functionSheetText(ev, fsDraft());
}
async function saveFunctionSheet(quiet) {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const d = fsDraft(), old = ev.functionSheet || {};
  if ((old.timings || '') === (d.timings || '') && (old.setup || '') === (d.setup || '')) { if (!quiet) showToast('Function sheet saved – जतन'); return; }
  try { await patchEvent(ev.id, Object.keys(d).length ? { functionSheet: d } : {}, Object.keys(d).length ? [] : ['functionSheet']); }
  catch (e) { showToast(e.message || 'Could not save. Nothing was changed.', 'error'); return; }
  if (!quiet) showToast('Function sheet saved – जतन');
}
function shareFunctionSheet() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const text = functionSheetText(ev, fsDraft());
  if (navigator.share) navigator.share({ title: `Function sheet – ${ev.name}`, text }).catch(() => {});   // inside the tap
  else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  saveFunctionSheet(true);
}
async function copyFunctionSheet() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  try { await navigator.clipboard.writeText(functionSheetText(ev, fsDraft())); showToast('Copied – कॉपी केले'); }
  catch { showToast('Could not copy. Use Share instead. – कॉपी झाले नाही', 'error'); }
  saveFunctionSheet(true);
}

/* ── SHARED BILL EDITOR (G-13) ── */
let splitDraft = null;   // { anchor: the expense that holds the bill photo, total, rows: [{ id?, evId, amt }] }
function openSplitModal() {
  const id = qv('exp-id'); const ex = D.expenses.find(x => x.id === id); if (!ex) return;
  const parts = ex.split ? splitParts(D.expenses, ex.split.id) : [ex];
  const anchor = parts.find(x => (x.billIds || []).length) || parts[0];
  splitDraft = { anchorId: anchor.id, total: ex.split ? ex.split.total : ex.amt,
    rows: [anchor, ...parts.filter(x => x.id !== anchor.id)].map(x => ({ id: x.id, evId: x.stock ? STOCK : x.evId, amt: x.amt })) };
  if (splitDraft.rows.length === 1) splitDraft.rows.push({ evId: '', amt: '' });
  closeOverlay().then(() => { renderSplitRows(); openSheet('split-modal'); });
}
function renderSplitRows() {
  const opts = [...eventOptions(), { v: STOCK, l: 'Common stock (no event yet) – साठा' }];
  q('split-rows').innerHTML = splitDraft.rows.map((r, i) => `<div class="f2" data-sp="${i}" style="align-items:end;margin-bottom:var(--s2)">
    <div class="field" style="margin:0"><select data-k="evId" aria-label="Event">${[{ v: '', l: 'Choose event – कार्यक्रम' }, ...opts].map(o => `<option value="${esc(o.v)}"${o.v === r.evId ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select></div>
    <div style="display:flex;gap:var(--s2);align-items:center"><div class="field" style="margin:0;flex:1;min-width:0"><input type="number" data-k="amt" aria-label="Amount for this event" min="0" inputmode="decimal" value="${r.amt === '' ? '' : r.amt}" placeholder="₹"></div>
      ${i ? `<button type="button" class="icon-btn" data-sp-del="${i}" aria-label="Remove event">${icon('x', 16)}</button>` : '<span style="width:var(--tap)"></span>'}</div></div>`).join('');
  updateSplitSum();
}
function updateSplitSum() {
  const sumP = splitDraft.rows.reduce((s, r) => s + toPaise(r.amt || 0), 0), totalP = toPaise(splitDraft.total);
  const left = (totalP - sumP) / 100;
  q('split-sum').textContent = `Bill ${fmtCurrency(splitDraft.total)} · split ${fmtCurrency(sumP / 100)}` + (left > 0 ? ` · ${fmtCurrency(left)} still to assign` : left < 0 ? ` · ${fmtCurrency(-left)} too much` : ' · all assigned');
}
async function saveSplit() {
  const rows = splitDraft.rows.filter(r => r.evId || r.amt !== '');
  // A labour-sheet entry stays on the event whose sheet made it (re-saving the sheet updates that entry)
  const sheetOwner = id => D.events.find(e => Object.values(e.labour?.expIds || {}).includes(id));
  for (const r of splitDraft.rows) {
    const owner = r.id && sheetOwner(r.id);
    if (owner && !rows.some(x => x.id === r.id && x.evId === owner.id)) {
      showToast(`This entry comes from ${owner.name}'s labour sheet, so its part stays on that event – मजूर यादीचा भाग त्याच कार्यक्रमावर`, 'error'); return;
    }
  }
  const err = checkSplit(rows, splitDraft.total);
  if (err) { showToast(err + ' – रक्कम तपासा', 'error'); return; }
  const anchor = D.expenses.find(x => x.id === splitDraft.anchorId); if (!anchor) return;
  const before = anchor.split ? splitParts(D.expenses, anchor.split.id) : [anchor];
  const groupId = anchor.split?.id || uid('SP');
  const shared = rows.length > 1;
  const strip = ({ _rev, ...r }) => r;
  const common = strip(anchor);
  // Who got what, each time the bill is (re)divided: moving value out of common stock leaves a trail (spec I-01)
  const dest = r => ({ evId: r.evId === STOCK ? '' : r.evId, amt: Number(r.amt) });
  const prevLog = before.find(x => x.allocLog)?.allocLog || [];
  const allocLog = [...prevLog, { at: new Date().toISOString(), from: before.map(x => ({ evId: x.evId || '', amt: x.amt })), parts: rows.map(dest) }].slice(-50);
  const changes = rows.map((r, i) => {
    const old = r.id ? before.find(x => x.id === r.id) : null;
    const { evId, amt } = dest(r);
    const rec = old ? { ...strip(old), evId, amt } : { ...common, id: uid('EX'), evId, amt, billIds: [] };
    if (i !== 0) rec.billIds = old ? old.billIds || [] : [];   // the bill photo stays with the first part
    if (shared) rec.split = { id: groupId, total: Number(splitDraft.total) }; else delete rec.split;
    if (r.evId === STOCK) rec.stock = true; else delete rec.stock;
    if (i === 0 && (shared || prevLog.length || r.evId === STOCK)) rec.allocLog = allocLog; else delete rec.allocLog;
    delete rec.logi;
    return { store: 'expenses', record: rec, expected: old || null };
  });
  const kept = new Set(changes.map(c => c.record.id));
  const drops = before.filter(x => !kept.has(x.id)).map(x => ({ store: 'expenses', id: x.id, expected: x }));
  try { await commitChanges([...changes, ...drops], { check: true, extraStores: ['events', 'vendors'] }); }
  catch (e) { showToast(e.message || 'Could not save. Nothing was changed.', 'error'); return; }
  await loadAll(); changesChannel?.postMessage('changed');
  closeModals(); refreshCurrent();
  const stockP = rows.filter(r => r.evId === STOCK).reduce((t, r) => t + toPaise(r.amt), 0);
  showToast(stockP ? `${fmtCurrency(stockP / 100)} kept as common stock, on no event – साठ्यात ठेवले`
    : shared ? `Bill shared across ${rows.length} events – बिल वाटले` : 'Bill is on one event again – एका कार्यक्रमावर');
}

/* ── RECONCILIATION (D-4) ── */
// Event contribution = bill − this event's recorded costs, before overheads. Provisional until reconciled.
function contributionLabel(ev, recon) {
  const base = ev.outsourced ? ['Commission', 'कमिशन'] : ['Contribution', 'योगदान'];
  return recon.state === 'reconciled' ? `${base[0]} – ${base[1]}` : `${base[0]} · provisional – ${base[1]} · अंदाजे`;
}

const RECON_WHAT = { costs: ['Costs', 'खर्च'], bill: ['Bill', 'बिल'], guests: ['Guests', 'पाहुणे'] };
function changeText(c) {
  if (c.what === 'details') return tr('A cost’s vendor, category or item changed', 'खर्चाचा विक्रेता/प्रकार/वस्तू बदलली');
  const v = n => c.what === 'guests' ? String(n) : fmtCurrency(n);
  return tr(`${RECON_WHAT[c.what][0]} ${v(c.from)} → ${v(c.to)}`, `${RECON_WHAT[c.what][1]} ${v(c.from)} → ${v(c.to)}`);
}

function reconHistoryList(ev) {
  const h = Array.isArray(ev.reconHistory) ? ev.reconHistory : [];
  if (!h.length) return '';
  const line = e => e.action === 'reconciled'
    ? tr(`Reconciled · costs ${fmtCurrency((e.costPaise || 0) / 100)} · bill ${fmtCurrency((e.billPaise || 0) / 100)}`, `जुळवले · खर्च ${fmtCurrency((e.costPaise || 0) / 100)}`)
    : (e.changes?.length ? tr('Reopened: ', 'पुन्हा उघडले: ') + e.changes.map(changeText).join(', ') : tr('Reopened by you', 'तुम्ही पुन्हा उघडले'));
  return `<details style="margin-top:var(--s3)"><summary class="meta" style="cursor:pointer">${tr(`History (${h.length})`, `इतिहास (${h.length})`)}</summary>
    ${[...h].reverse().map(e => `<div class="meta" style="margin-top:4px">${fmtDate(String(e.at || '').slice(0, 10))} · ${line(e)}</div>`).join('')}</details>`;
}

function reconCard(ev, recon) {
  if (eventStage(ev) === 'upcoming') return '';
  const head = (chip, text) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--s2)">${chip}${text}</div>`;
  if (recon.state === 'reconciled') return `<div class="card pad" id="recon-card">
    ${head(`<span class="chip pos">${tr('Reconciled', 'जुळवले')}</span>`, `<button type="button" class="btn-sm" data-action="recon-reopen">${tr('Reopen', 'पुन्हा उघडा')}</button>`)}
    <div class="meta" style="margin-top:var(--s2)">${tr(`All costs confirmed on ${fmtDate(String(recon.at).slice(0, 10))}. This contribution is final for the event (before overheads).`, `${fmtDate(String(recon.at).slice(0, 10))} रोजी सर्व खर्च निश्चित. हे योगदान अंतिम आहे.`)}</div>
    ${reconHistoryList(ev)}</div>`;
  const reopened = recon.state === 'reopened';
  return `<div class="card pad" id="recon-card">
    ${head(`<span class="chip ${reopened ? 'neg' : 'due'}">${reopened ? tr('Changed after reconciling', 'जुळवल्यानंतर बदल') : tr('Costs pending', 'खर्च बाकी')}</span>`,
      `<button type="button" class="btn-sm" data-action="recon-open">${reopened ? tr('Review', 'तपासा') : tr('Reconcile', 'जुळवा')}</button>`)}
    <div class="meta" style="margin-top:var(--s2)">${reopened
      ? `${recon.changes.map(changeText).join(' · ')} · ${tr(`since you reconciled on ${fmtDate(String(recon.at).slice(0, 10))}. The contribution is provisional again until you review it.`, 'पुन्हा तपासेपर्यंत योगदान अंदाजे.')}`
      : tr('The contribution is provisional until you confirm every bill is in. Unpaid bills count as costs.', 'सर्व बिले आल्याचे निश्चित करेपर्यंत योगदान अंदाजे आहे. न भरलेली बिलेही खर्चच.')}</div>
    ${reconHistoryList(ev)}</div>`;
}

let reconBase = null;   // the event as it was when the checklist opened
function openReconModal() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  reconBase = structuredClone(ev);
  const pl = calcEventPL(ev, D.cPays, D.expenses);
  const exps = D.expenses.filter(x => x.evId === ev.id);
  const credit = sumRupees(exps.filter(x => x.pay === 'credit'));
  const blockers = reconBlockers(ev, D.expenses, D.drafts);
  q('recon-sum').innerHTML = `
    <div>${tr(`Costs recorded: <b>${fmtCurrency(pl.expTotal)}</b> in ${exps.length} entr${exps.length === 1 ? 'y' : 'ies'}`, `नोंदलेला खर्च: <b>${fmtCurrency(pl.expTotal)}</b> (${exps.length})`)}${credit ? tr(` · ${fmtCurrency(credit)} still on credit (counted)`, ` · ${fmtCurrency(credit)} उधारीवर (मोजले)`) : ''}</div>
    <div>${tr(`Bill <b>${fmtCurrency(ev.billing)}</b>${ev.guests ? ` · ${ev.guests} guests` : ''} · contribution <b>${fmtCurrency(pl.profit)}</b>${ev.billing > 0 ? ` (${pl.margin}%)` : ''}`, `बिल <b>${fmtCurrency(ev.billing)}</b> · योगदान <b>${fmtCurrency(pl.profit)}</b>`)}</div>`;
  q('recon-block').innerHTML = blockers.map(b => `<div class="note alert" style="margin-top:var(--s2)"><span class="note-ic">${icon('alert', 16)}</span><div>${tr(b.en, b.mr)}</div></div>`).join('');
  q('recon-checks').innerHTML = RECON_CHECKS.map(c => `<label class="check-row"><input type="checkbox" data-check="${c.id}"${blockers.length ? ' disabled' : ''}><span>${tr(c.en, c.mr)}</span></label>`).join('');
  updateReconSave();
  openSheet('recon-modal');
}
function updateReconSave() {
  const boxes = [...document.querySelectorAll('#recon-checks input')];
  q('btn-save-recon').disabled = !boxes.length || boxes.some(b => !b.checked || b.disabled);
}
async function saveRecon() {
  const ev = D.events.find(e => e.id === curRef); if (!ev || !reconBase) return;
  const checks = [...document.querySelectorAll('#recon-checks input:checked')].map(b => b.dataset.check);
  if (checks.length !== RECON_CHECKS.length || reconBlockers(ev, D.expenses, D.drafts).length) return;
  // Costs, bill or guests changed while the checklist was open: show the new figures instead of confirming old ones
  const changed = JSON.stringify(reconStatus(reconBase, D.expenses)) !== JSON.stringify(reconStatus(ev, D.expenses))
    || ev.billing !== reconBase.billing || ev.guests !== reconBase.guests || ev._rev !== reconBase._rev;
  if (changed) { showToast('This event changed while the checklist was open. Check the figures again.', 'error'); openReconModal(); return; }
  try {
    await patchEvent(ev.id, reconcileFields(ev, D.expenses, checks));
  } catch (e) { showToast(e.message || 'Could not save. Nothing was changed.', 'error'); return; }
  closeModals(); refreshCurrent();
  showToast('Reconciled: contribution is final – जुळवले: योगदान अंतिम');
}
async function reopenRecon() {
  const ev = D.events.find(e => e.id === curRef); if (!ev?.recon) return;
  const ok = await askSheet({ title: 'Reopen reconciliation? – पुन्हा उघडायचे?',
    message: 'The contribution becomes provisional until you reconcile again. The history is kept.',
    actions: [{ label: 'Reopen – पुन्हा उघडा', value: true, style: 'btn-primary' }] });
  if (!ok) return;
  try { await patchEvent(ev.id, reopenFields(ev)); } catch (e) { showToast(e.message || 'Could not save. Nothing was changed.', 'error'); return; }
  refreshCurrent();
}

function costVsUsualCard(ev) {
  const cmp = costVsUsual(ev, D.events, costByCategory(D.events, D.expenses), reconciledIds(D.events, D.expenses));
  if (!cmp) return '';
  const basis = cmp.basis === 'menu' ? (menuById(ev.menu)?.name || 'menu') : (ev.type || '').split(' – ')[0];
  return `
    <div class="sec"><span class="sec-title">Cost vs usual – नेहमीच्या तुलनेत</span><span class="meta">${tr(`per plate · ${basis}, ${cmp.n} event${cmp.n > 1 ? 's' : ''}`, `प्रति ताट · ${cmp.n} कार्यक्रम`)}</span></div>
    <div class="card list" id="cost-vs-usual">${cmp.rows.map(r => `
      <div class="row" style="min-height:48px">
        <div class="row-ic">${catIcon(r.cat)}</div>
        <div class="row-body"><div class="title-sm trunc">${esc(r.cat)}</div>
          <div class="meta">${tr(`${fmtCurrency(r.mine)} · usual ${fmtCurrency(r.usual)}`, `${fmtCurrency(r.mine)} · नेहमी ${fmtCurrency(r.usual)}`)}</div></div>
        <div class="meta" style="font-variant-numeric:tabular-nums">${r.pct === null ? tr('new', 'नवीन') : r.pct === 0 ? '±0%' : (r.pct > 0 ? '↑ +' : '↓ ') + r.pct + '%'}</div>
      </div>`).join('')}</div>`;
}

// Usual costs (from the last similar event) not yet recorded here, each one tap from the form
let CHECKLIST = [];
function checklistCard(ev) {
  const cl = costChecklist(ev, D.events, D.expenses);
  CHECKLIST = cl ? cl.list.filter(i => !i.done) : [];
  if (!cl || !cl.list.length) return '';
  const done = cl.list.length - cl.missing;
  return `
    <div class="sec"><span class="sec-title">Cost checklist – खर्च यादी</span>
      <span class="meta">${cl.missing ? tr(`${cl.missing} to check`, `${cl.missing} तपासा`) : tr('All recorded', 'सर्व नोंदवले')}</span></div>
    <div class="card list">
      <div class="meta" style="padding:var(--s3) var(--s4)${CHECKLIST.length ? ' 0' : ''}">${CHECKLIST.length ? '' : icon('check', 14) + ' '}${tr('Usual costs, from', 'नेहमीचे खर्च, यावरून:')} <span data-nl>${esc(cl.ref.name)}</span>${done ? tr(` · ${done} already recorded`, ` · ${done} नोंदवले`) : ''}</div>
      ${CHECKLIST.map((it, i) => {
        const ven = D.vendors.find(v => v.id === it.venId);
        return `<div class="row">
          <div class="row-ic">${catIcon(it.cat)}</div>
          <div class="row-body"><div class="title-sm trunc">${esc(it.head || it.cat)}</div>
            <div class="meta trunc">${tr(`Last time ${fmtCurrency(it.amt)}`, `मागील वेळी ${fmtCurrency(it.amt)}`)}${ven ? ` · <span data-nl>${esc(ven.name)}</span>` : ''}</div></div>
          <button type="button" class="btn-sm" data-action="check-add" data-id="${i}">${icon('plus', 16)}${tr('Add', 'जोडा')}</button>
        </div>`;
      }).join('')}
    </div>`;
}

// Home: events in the last two weeks that have costs, but fewer than usual
function checkCostsCard() {
  const recent = D.events.filter(e => isOverdue(e) && daysSince(e.date) <= 14 && D.expenses.some(x => x.evId === e.id))
    .map(e => ({ e, cl: costChecklist(e, D.events, D.expenses) })).filter(r => r.cl?.missing);
  if (!recent.length) return '';
  return `
    <div class="sec"><span class="sec-title">Check costs – खर्च तपासा</span><span class="meta">${recent.length}</span></div>
    <div class="card list">${recent.map(({ e, cl }) => `
      <div class="row" role="button" tabindex="0" data-action="evdetail" data-id="${esc(e.id)}">
        <div class="row-ic" style="background:var(--due-soft);color:var(--due)">${icon('receipt', 18)}</div>
        <div class="row-body"><div class="title-sm trunc" data-nl>${esc(e.name)}</div>
          <div class="meta">${tr(`${cl.missing} usual cost${cl.missing > 1 ? 's' : ''} not recorded`, `${cl.missing} नेहमीचे खर्च नोंदवले नाहीत`)}</div></div>
        ${icon('chevron', 18)}
      </div>`).join('')}</div>`;
}

/* ── EXPENSES ────────────────────────────────────── */
// One expense row; tap to edit, bin to delete (with Undo)
function expenseRow(x, { showEvent = true } = {}) {
  const ev  = D.events.find(e => e.id === x.evId);
  const ven = D.vendors.find(v => v.id === x.venId);
  const bits = [
    showEvent ? (x.stock ? tr('Common stock', 'साठा') : `<span data-nl>${esc(ev?.name || '—')}</span>`) : '',
    fmtDate(x.date),
    ven ? `<span data-nl>${esc(ven.name)}</span>` : '',
    x.split ? tr(`shared · ${fmtCurrency(x.split.total)} bill`, `वाटलेले · ${fmtCurrency(x.split.total)}`) : '',
    x.additional ? tr('extra to labour sheet', 'मजूर यादीशिवाय') : ''
  ].filter(Boolean).join(' · ');
  return `<div class="row" role="button" tabindex="0" data-action="edit-exp" data-id="${esc(x.id)}">
    <div class="row-ic">${catIcon(x.cat)}</div>
    <div class="row-body">
      <div class="title-sm trunc">${esc(x.head || x.cat)}${(x.billIds || []).length ? `<span class="clip" aria-label="Bill attached">${icon('paperclip', 14)}</span>` : ''}</div>
      <div class="meta trunc">${bits}</div>
    </div>
    <div class="row-end">
      <div class="amt-sm">${fmtCurrency(x.amt)}</div>
      ${creditChip(x)}
    </div>
    <button type="button" class="del-btn" data-action="delete" data-type="expenses" data-id="${esc(x.id)}" aria-label="Delete expense">${icon('trash', 16)}</button>
  </div>`;
}

// Credit status on an expense row: paid off, overdue, due on a date, or just "credit"
function creditChip(x) {
  if (!isOnCredit(x)) return '';
  const left = CREDIT_LEFT.get(x.id) || 0;
  if (left <= 0) return `<span class="chip pos">${tr('Credit paid', 'उधार फेडले')}</span>`;
  if (x.dueDate) {
    const d = daysUntil(x.dueDate);
    if (d < 0)  return `<span class="chip neg">${tr(`Overdue ${-d}d`, `${-d} दिवस थकीत`)}</span>`;
    if (d === 0) return `<span class="chip neg">${tr('Due today', 'आज द्यायचे')}</span>`;
    return `<span class="chip due">${tr(`Due ${fmtDate(x.dueDate).slice(0, 6)}`, `${fmtDate(x.dueDate).slice(0, 6)} पर्यंत`)}</span>`;
  }
  return `<span class="chip due">${tr('Credit', 'उधार')}</span>`;
}

function vendorDuesTotal() {
  return D.vendors.reduce((s, v) => s + Math.max(0, calcVendorBalance(v.id, D.expenses, D.vPays).balance), 0);
}

function rExp() {
  const cats = Object.keys(EXPENSE_HEADS).filter(c => D.expenses.some(x => x.cat === c));
  const creditN = D.expenses.filter(isOnCredit).length;
  q('exp-filters').innerHTML = D.expenses.length ? [
    `<button type="button" class="f-chip" data-action="exp-filter" data-id="all" aria-pressed="${F.exp === 'all'}">${tr('All', 'सर्व')}</button>`,
    creditN ? `<button type="button" class="f-chip" data-action="exp-filter" data-id="credit" aria-pressed="${F.exp === 'credit'}">${tr('On credit', 'उधार')}<span class="n">${creditN}</span></button>` : '',
    ...cats.map(c => `<button type="button" class="f-chip" data-action="exp-filter" data-id="${esc(c)}" aria-pressed="${F.exp === c}">${catIcon(c, 15)}${esc(c)}</button>`)
  ].join('') : '';

  const hasStock = D.expenses.some(x => x.stock);
  if (F.expEv && !D.events.some(e => e.id === F.expEv) && !(F.expEv === STOCK && hasStock)) F.expEv = '';
  populateSelect('exp-ev-filter', [{ v: '', l: 'All events – सर्व कार्यक्रम' }, ...eventOptions(), ...(hasStock ? [{ v: STOCK, l: 'Common stock – साठा' }] : [])], F.expEv);
  q('exp-ev-filter').parentElement.hidden = !D.events.length;
  const list = D.expenses
    .filter(x => !F.expEv || (F.expEv === STOCK ? x.stock : x.evId === F.expEv))
    .filter(x => F.exp === 'all' || (F.exp === 'credit' ? isOnCredit(x) : x.cat === F.exp))
    .filter(x => {
      if (!F.expQ) return true;
      const ev = D.events.find(e => e.id === x.evId), ven = D.vendors.find(v => v.id === x.venId);
      return matches(F.expQ, x.head, x.cat, x.notes, ev?.name, ven?.name, x.amt);
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  q('exp-tot').textContent    = fmtCurrency(list.reduce((s, x) => s + x.amt, 0));
  q('exp-credit').textContent = fmtCurrency(vendorDuesTotal());

  if (!D.expenses.length) {
    q('exp-list').innerHTML = draftsCard() + emptyState({
      ic: 'receipt', text: 'No expenses yet – खर्च नाही',
      action: `<button type="button" class="btn btn-primary" data-action="quick" data-id="expense">${icon('plus', 18)}Add expense – खर्च जोडा</button>`
    });
    return;
  }
  if (!list.length) {
    q('exp-list').innerHTML = emptyState({ ic: 'search', text: 'No matching expenses – काहीही सापडले नाही' });
    return;
  }

  // Group by month, newest first
  const groups = new Map();
  expensePage = Math.max(1, Math.min(expensePage, Math.ceil(list.length / PAGE_SIZE)));
  list.slice((expensePage - 1) * PAGE_SIZE, expensePage * PAGE_SIZE).forEach(x => {
    const k = (x.date || '').slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  });

  // Pending first: what's still owed, then bills waiting to be filled in, then the history
  const top = (F.exp === 'all' && !F.expQ ? toPayCard(F.expEv) : '') + (F.expEv ? '' : draftsCard());
  q('exp-list').innerHTML = top + [...groups].map(([k, xs]) => {
    const d = new Date(k + '-01');
    const month = !isNaN(d)
      ? tr(d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }), d.toLocaleDateString('mr-IN', { month: 'long', year: 'numeric' }))
      : 'No date – दिनांक नाही';
    return `<div class="sec"><span class="sec-title">${month}</span><span class="meta">${fmtCurrency(xs.reduce((s, x) => s + x.amt, 0))}</span></div>
    <div class="card list">${xs.map(x => expenseRow(x)).join('')}</div>`;
  }).join('') + (list.length > PAGE_SIZE ? `<div class="btn-row" style="margin:16px 0"><button type="button" class="btn btn-secondary" data-action="expense-prev" ${expensePage === 1 ? 'disabled' : ''}>Previous – मागील</button><span role="status">${expensePage} / ${Math.ceil(list.length / PAGE_SIZE)}</span><button type="button" class="btn btn-secondary" data-action="expense-next" ${expensePage * PAGE_SIZE >= list.length ? 'disabled' : ''}>Next – पुढील</button></div>` : '');
}

/* ── VENDORS ─────────────────────────────────────── */
function balanceView({ balance: bal, entries }) {
  // A vendor with nothing recorded isn't "settled" — there's simply no history
  if (!entries) return `<span class="chip">${tr('No entries', 'नोंद नाही')}</span>`;
  if (bal > 0)  return `<div class="amt-sm due">${fmtCurrency(bal)}</div><div class="meta">${tr('to pay', 'देणे')}</div>`;
  if (bal < 0)  return `<div class="amt-sm info">${fmtCurrency(-bal)}</div><div class="meta">${tr('advance', 'आगाऊ')}</div>`;
  return `<span class="chip pos">${tr('Settled', 'पूर्ण')}</span>`;
}

function rVen() {
  if (!D.vendors.length) {
    q('ven-list').innerHTML = emptyState({
      ic: 'store', text: 'No vendors yet – विक्रेते नाही',
      action: `<button type="button" class="btn btn-primary" data-action="quick" data-id="vendor">${icon('plus', 18)}Add vendor – विक्रेता जोडा</button>`
    });
    return;
  }
  const list = D.vendors
    .filter(v => matches(F.venQ, v.name, v.cat, v.specialty, v.phone))
    .map(v => ({ v, b: calcVendorBalance(v.id, D.expenses, D.vPays) }))
    // Vendors you owe come first, then by name
    .sort((a, b) => (Math.max(0, b.b.balance) - Math.max(0, a.b.balance)) || a.v.name.localeCompare(b.v.name));
  if (!list.length) {
    q('ven-list').innerHTML = emptyState({ ic: 'search', text: 'No matching vendors – काहीही सापडले नाही' });
    return;
  }
  const row = ({ v, b }) => `
    <div class="row" role="button" tabindex="0" data-action="vendetail" data-id="${esc(v.id)}">
      <div class="avatar" data-nl>${esc(initials(v.name))}</div>
      <div class="row-body">
        <div class="title-sm trunc" data-nl>${esc(v.name)}</div>
        <div class="meta trunc">${isPerson(v) ? tr('Other person', 'इतर व्यक्ती') : esc(v.cat) + (v.specialty ? ' · ' + esc(v.specialty) : '')}</div>
      </div>
      <div class="row-end">${balanceView(b)}</div>
    </div>`;
  const vendors = list.filter(r => !isPerson(r.v)), people = list.filter(r => isPerson(r.v));
  q('ven-list').innerHTML =
    (vendors.length ? `<div class="card list">${vendors.map(row).join('')}</div>` : '') +
    (people.length ? `<div class="sec"><span class="sec-title">Other people – इतर व्यक्ती</span><span class="meta">${tr('lent or paid for you', 'उधार / तुमच्यासाठी भरले')}</span></div>
      <div class="card list">${people.map(row).join('')}</div>` : '');
}

/* ── VENDOR DETAIL ───────────────────────────────── */
function showVenDetail(id, { fromHistory = false } = {}) {
  const vn = D.vendors.find(v => v.id === id); if (!vn) return;
  refreshCredit();
  const exps = D.expenses.filter(x => x.venId === id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const pays = D.vPays.filter(p => p.venId === id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const bal = calcVendorBalance(id, D.expenses, D.vPays);
  const phone = phoneDigits(vn.phone);

  q('tab-vendetail').innerHTML = `
    <div class="card pad" style="display:flex;gap:var(--s3);align-items:center">
      <div class="avatar" style="width:52px;height:52px;font-size:18px" data-nl>${esc(initials(vn.name))}</div>
      <div style="min-width:0">
        <div class="detail-name" data-nl>${esc(vn.name)}</div>
        <div class="facts" style="margin-top:4px">
          <span class="chip">${isPerson(vn) ? tr('Other person', 'इतर व्यक्ती') : esc(vn.cat) + (vn.specialty ? ' · ' + esc(vn.specialty) : '')}</span>
          ${phone ? `<a class="fact" href="tel:+${esc(phone)}">${icon('phone', 16)}${esc(vn.phone)}</a>` : ''}
        </div>
      </div>
    </div>
    ${vn.notes ? `<div class="card pad"><div class="label">Notes – नोंदी</div><div class="notes-text" data-nl>${esc(vn.notes)}</div></div>` : ''}

    <div class="card pad">
      ${bal.entries ? `<div class="metrics" style="margin:0;padding:0;border:0">
        <div class="metric"><div class="label">${isPerson(vn) ? 'Lent / paid – उधार दिले' : 'Supplied – पुरवले'}</div><div class="amt-md">${fmtCurrency(bal.supplied)}</div></div>
        <div class="metric"><div class="label">Paid – दिले</div><div class="amt-md pos">${fmtCurrency(bal.paid)}</div></div>
        <div class="metric"><div class="label">${bal.balance < 0 ? 'Advance – आगाऊ' : 'You owe – देणे'}</div><div class="amt-md ${bal.balance > 0 ? 'due' : bal.balance < 0 ? 'info' : 'muted'}">${fmtCurrency(Math.abs(bal.balance))}</div></div>
      </div>${bal.credits ? `<div class="meta" style="margin-top:var(--s2)">${tr(`Credit notes ${fmtCurrency(bal.credits)} lower what you owe; event costs stay as billed.`, `क्रेडिट नोट ${fmtCurrency(bal.credits)} देणे कमी करतात.`)}</div>` : ''}`
      : `<div class="meta">${tr('Nothing recorded with this vendor yet. Add an expense and pick this vendor, or record a payment.', 'या विक्रेत्याची अजून नोंद नाही.')}</div>`}
      ${phone ? `<div class="btn-row" style="margin-top:var(--s4)" id="ven-contact">
        <a class="btn btn-secondary" href="tel:+${esc(phone)}">${icon('phone', 18)}${tr('Call', 'कॉल')}</a>
        <a class="btn btn-wa" href="https://wa.me/${esc(phone)}" target="_blank" rel="noopener">${icon('message', 18)}WhatsApp</a>
      </div>
      ${bal.balance > 0 ? `<a class="btn btn-ghost" style="margin-top:var(--s2);width:100%" href="${esc(vendorDuesLink(vn, bal))}" target="_blank" rel="noopener">${icon('message', 18)}${tr('Share dues on WhatsApp', 'देणे WhatsApp वर पाठवा')}</a>` : ''}`
      : `<button type="button" class="btn-sm" style="margin-top:var(--s3)" data-action="open-ven-edit" data-id="${esc(vn.id)}">${icon('phone', 16)}${tr('Add phone for Call / WhatsApp', 'कॉल / WhatsApp साठी नंबर जोडा')}</button>`}
    </div>

    ${priceCheckCard(vn)}

    <div class="sec"><span class="sec-title">${isPerson(vn) ? 'Paid for you – तुमच्यासाठी भरलेले खर्च' : 'Supplied – पुरवलेले खर्च'}</span>
      <button type="button" class="btn-sm" data-action="open-link" data-id="${esc(vn.id)}">${icon('link', 16)}Link – जोडा</button></div>
    <div class="card list">
      ${rowsOrEmpty(exps.map(x => expenseRow(x)).join(''), 'No expenses linked – खर्च नाही')}
    </div>

    <div class="sec"><span class="sec-title">Payments made – दिलेली देयके</span>
      <button type="button" class="btn-sm" data-action="open-vpay" data-id="${esc(vn.id)}">${icon('plus', 16)}Add – जोडा</button></div>
    <div class="card list">
      ${rowsOrEmpty(pays.map(p => {
        const ev = D.events.find(e => e.id === p.evId);
        const bill = p.billKey ? D.expenses.find(x => billKeyOf(x) === p.billKey) : null;
        return `<div class="row" role="button" tabindex="0" data-action="edit-vpay" data-id="${esc(p.id)}">
          <div class="row-ic">${icon(p.kind === 'credit' ? 'receipt' : 'wallet', 18)}</div>
          <div class="row-body">
            <div class="amt-sm">${fmtCurrency(p.amt)}${p.kind === 'credit' ? ` <span class="chip info">${tr('Credit note', 'क्रेडिट नोट')}</span>` : ''}</div>
            <div class="meta trunc">${fmtDate(p.date)}${p.mode ? ' · ' + esc(p.mode) : ''}${bill ? ` · ${tr('for', 'साठी')} ${esc(short(bill.head || bill.cat))}${bill.billNo ? ' #' + esc(bill.billNo) : ''}` : ''}${ev ? ` · <span data-nl>${esc(ev.name)}</span>` : ''}${p.head ? ' · ' + esc(p.head) : ''}${p.kind === 'credit' && p.notes ? ' · ' + esc(p.notes) : ''}</div>
          </div>
          <button type="button" class="del-btn" data-action="delete" data-type="vPays" data-id="${esc(p.id)}" aria-label="Delete payment">${icon('trash', 16)}</button>
        </div>`;
      }).join(''), 'No payments yet – देयक नाही')}
    </div>
  `;

  q('tab-vendetail').dataset.vnid = id;
  go('vendetail', { ref: id, fromHistory });
}

/* ── REPORTS ─────────────────────────────────────── */
// Cost and profit per plate: by event type (what to quote next time), then per event.
// Only events with a guest count and recorded costs count.
// Menus by profit per plate (bill − cost), with margin; the most rewarding package first
function menuRanking(rows) {
  const by = new Map();
  for (const r of rows) {
    const m = menuById(r.ev.menu); if (!m) continue;
    const g = by.get(m.name) || { n: 0, guests: 0, cost: 0, bill: 0 };
    g.n++; g.guests += r.guests; g.cost += r.expTotal; g.bill += r.ev.billing;
    by.set(m.name, g);
  }
  return [...by].map(([name, g]) => ({ name, ...g, profit: Math.round((g.bill - g.cost) / g.guests), margin: Math.round((g.bill - g.cost) / g.bill * 100) }))
    .sort((a, b) => b.profit - a.profit).map((g, i) => `
    <div class="row" style="min-height:52px">
      <div class="row-body"><div class="title-sm">${i + 1}. ${esc(g.name)}</div>
        <div class="meta">${tr(`${g.n} event${g.n > 1 ? 's' : ''} · bill ${fmtCurrency(Math.round(g.bill / g.guests))} · cost ${fmtCurrency(Math.round(g.cost / g.guests))} per plate`,
          `${g.n} कार्यक्रम · बिल ${fmtCurrency(Math.round(g.bill / g.guests))} · खर्च ${fmtCurrency(Math.round(g.cost / g.guests))} प्रति ताट`)}</div></div>
      <div class="row-end"><div class="amt-sm ${g.profit >= 0 ? 'pos' : 'neg'}">${fmtCurrency(g.profit)}</div><div class="meta">${tr(`contribution/plate · ${g.margin}%`, `योगदान/ताट · ${g.margin}%`)}</div></div>
    </div>`).join('');
}

// Reports: vendors whose cost per plate has gone up (all time), largest rise first
function priceCreepReport() {
  const list = priceCreep(D.expenses, D.events).slice(0, 6);
  if (!list.length) return '';
  return `<div class="card pad" style="padding-bottom:var(--s2)" id="price-creep">
    <div class="chart-title">${icon('store', 18)}Vendor spend per plate rising – प्रति ताट खर्च वाढ</div>
    <div class="meta">${tr('Spend per plate at the latest reconciled event against the same vendor’s earlier ones. Not the vendor’s rate: menu or quantity changes also move it.', 'त्याच विक्रेत्याच्या आधीच्या जुळवलेल्या कार्यक्रमांशी प्रति ताट खर्च तुलना. हा विक्रेत्याचा दर नव्हे.')}</div>
    ${list.map(r => {
      const ven = D.vendors.find(v => v.id === r.venId);
      return `<div class="row" role="button" tabindex="0" data-action="vendetail" data-id="${esc(r.venId)}" style="min-height:48px">
        <div class="row-body"><div class="title-sm trunc"><span data-nl>${esc(ven?.name || '')}</span> · ${esc(short(r.head))}</div>
          <div class="meta">${fmtCurrency(r.latest)}/plate · ${tr('before', 'आधी')} ${fmtCurrency(r.avg)}</div></div>
        <div class="meta" style="font-variant-numeric:tabular-nums">↑ +${r.pct}%</div>
      </div>`;
    }).join('')}</div>`;
}

// Categories that cost more than usual in this period, summed over events (shown quietly)
function costsHigherReport(P) {
  const costs = costByCategory(D.events, D.expenses), done = reconciledIds(D.events, D.expenses);
  const over = new Map();
  for (const ev of P.events) {
    const cmp = costVsUsual(ev, D.events, costs, done); if (!cmp) continue;
    for (const r of cmp.rows) if (r.diff > 0 && r.usual) {
      const o = over.get(r.cat) || { amt: 0, events: 0 };
      o.amt += r.diff * cmp.guests; o.events++; over.set(r.cat, o);
    }
  }
  const list = [...over].sort((a, b) => b[1].amt - a[1].amt).slice(0, 5);
  if (!list.length) return '';
  return `<div class="card pad" style="padding-bottom:var(--s2)" id="costs-higher">
    <div class="chart-title">${icon('chart', 18)}Where costs ran higher – जास्त खर्च कुठे</div>
    <div class="meta">${tr('Compared with your usual cost per plate for the same menu or event type.', 'त्याच मेनू/प्रकाराच्या नेहमीच्या प्रति ताट खर्चाशी तुलना.')}</div>
    ${list.map(([cat, o]) => `<div class="row" style="min-height:48px">
      <div class="row-ic">${catIcon(cat)}</div>
      <div class="row-body"><div class="title-sm trunc">${esc(cat)}</div><div class="meta">${tr(`in ${o.events} event${o.events > 1 ? 's' : ''}`, `${o.events} कार्यक्रमांत`)}</div></div>
      <div class="row-end"><div class="amt-sm">${fmtCurrency(Math.round(o.amt))}</div><div class="meta">${tr('more than usual', 'नेहमीपेक्षा जास्त')}</div></div>
    </div>`).join('')}</div>`;
}

function perPlateReport(P, missing) {
  const done = reconciledIds(D.events, D.expenses);
  const rows = P.events
    .map(ev => ({ ev, ...calcEventPL(ev, P.cPays, P.expenses), final: done.has(ev.id) }))
    .filter(r => r.guests && !r.ev.outsourced && !missing.has(r.ev.id) && r.expTotal > 0);
  const finals = rows.filter(r => r.final);   // menu and type benchmarks: reconciled events only (G-22)
  if (!rows.length) {
    return `<div class="card pad"><div class="chart-title">${icon('utensils', 18)}Per plate – प्रति ताट</div>
      <div class="meta">${tr('Add a guest count to your events to see cost and contribution per plate here.', 'प्रति ताट खर्च पाहण्यासाठी कार्यक्रमात पाहुण्यांची संख्या जोडा.')}</div></div>`;
  }
  const group = keyOf => {
    const by = new Map();
    finals.forEach(r => {
      const t = keyOf(r.ev); if (!t) return;
      const g = by.get(t) || { n: 0, guests: 0, cost: 0, bill: 0 };
      g.n++; g.guests += r.guests; g.cost += r.expTotal; g.bill += r.ev.billing;
      by.set(t, g);
    });
    return [...by].sort((a, b) => b[1].n - a[1].n).map(([t, g]) => `
    <div class="row" style="min-height:52px">
      <div class="row-body"><div class="title-sm">${esc(t)}</div><div class="meta">${tr(`${g.n} event${g.n > 1 ? 's' : ''} · avg bill ${fmtCurrency(Math.round(g.bill / g.guests))}/plate`, `${g.n} कार्यक्रम · सरासरी बिल ${fmtCurrency(Math.round(g.bill / g.guests))}/ताट`)}</div></div>
      <div class="row-end"><div class="amt-sm">${fmtCurrency(Math.round(g.cost / g.guests))}</div><div class="meta">${tr('cost/plate', 'खर्च/ताट')}</div></div>
    </div>`).join('');
  };
  const menuRows = menuRanking(finals);
  const typeRows = group(ev => (ev.typeOther || ev.type || 'Other').split(' – ')[0]);
  const venueRows = group(ev => venueTypeLabel(ev));   // only events with a venue type, reconciled only
  const noFinal = finals.length ? '' : `<div class="meta">${tr('Menu and type averages use reconciled events only. Reconcile finished events to see them.', 'मेनू व प्रकार सरासरी फक्त जुळवलेल्या कार्यक्रमांवरून.')}</div>`;
  const eventRows = rows.sort((a, b) => b.profitPerPlate - a.profitPerPlate).map(r => `
    <div class="row" role="button" tabindex="0" data-action="evdetail" data-id="${esc(r.ev.id)}" style="min-height:52px">
      <div class="row-body"><div class="title-sm trunc" data-nl>${esc(r.ev.name)}</div><div class="meta">${tr(`${r.guests} plates · cost ${fmtCurrency(r.costPerPlate)}/plate${r.final ? '' : ' · provisional'}`, `${r.guests} ताट · खर्च ${fmtCurrency(r.costPerPlate)}/ताट${r.final ? '' : ' · अंदाजे'}`)}</div></div>
      <div class="row-end"><div class="amt-sm ${r.profitPerPlate >= 0 ? 'pos' : 'neg'}">${fmtCurrency(r.profitPerPlate)}</div><div class="meta">${tr('contribution/plate', 'योगदान/ताट')}</div></div>
    </div>`).join('');
  return `<div class="card pad" style="padding-bottom:var(--s2)">
    ${menuRows ? `<div class="chart-title">${icon('utensils', 18)}Menu contribution ranking – मेनू योगदान क्रम</div>${menuRows}
    <div class="chart-title" style="margin-top:var(--s4)">` : '<div class="chart-title">'}${icon('utensils', 18)}Per plate by type – प्रकारानुसार प्रति ताट</div>${typeRows || noFinal}
    ${venueRows ? `<div class="chart-title" style="margin-top:var(--s4)">${icon('pin', 18)}Per plate by venue type – ठिकाणानुसार प्रति ताट</div>${venueRows}` : ''}
    <div class="chart-title" style="margin-top:var(--s4)">${icon('calendar', 18)}Per plate by event – कार्यक्रमनिहाय</div>${eventRows}
  </div>`;
}

/* Reports: does the money add up? All time, one line each; a red line is something to look at */
function booksCard(b) {
  if (!b.spent && !b.receivable && !b.owed && !b.advance) return '';
  const line = (ok, en, mr, amt = '') => `<div class="row" style="min-height:44px"><div class="row-ic" style="color:var(${ok ? '--pos' : '--due'})">${icon(ok ? 'check' : 'alert', 16)}</div>
    <div class="row-body"><div class="meta" style="color:var(--ink)">${tr(en, mr)}</div></div>${amt ? `<div class="amt-sm">${amt}</div>` : ''}</div>`;
  return `<div class="card" style="margin-top:var(--s3)" id="books-check"><div class="chart-title" style="padding:var(--s3) var(--s4) 0">${icon('receipt', 18)}${tr('Books check · all time', 'हिशोब तपासणी')}</div><div class="list">
    ${line(!b.unplaced, b.unplaced ? `${fmtCurrency(b.unplaced)} of bills is on no event and not in stock` : `Bills ${fmtCurrency(b.spent)} = event costs ${fmtCurrency(b.eventCosts)}${b.stock ? ` + common stock ${fmtCurrency(b.stock)}` : ''}`, 'बिले = कार्यक्रम खर्च + साठा')}
    ${b.splits ? line(!b.badSplits, b.badSplits ? `${b.badSplits} shared bill${b.badSplits > 1 ? 's do' : ' does'} not add up to its parts` : `${b.splits} shared bill${b.splits > 1 ? 's' : ''}, every part adds up`, 'वाटलेली बिले जुळतात') : ''}
    ${line(true, `Owed to vendors${b.creditNotes ? ` (after ${fmtCurrency(b.creditNotes)} credit notes)` : ''}`, 'विक्रेत्यांना देणे', fmtCurrency(b.owed))}
    ${b.advance ? line(true, 'Advances paid to vendors', 'विक्रेत्यांना आगाऊ', fmtCurrency(b.advance)) : ''}
    ${line(true, `Clients still owe${b.disputed ? `, ${fmtCurrency(b.disputed)} disputed` : ''}`, 'ग्राहकांकडून येणे', fmtCurrency(b.receivable))}
    ${b.overReceived ? line(false, 'Received more than the bill (refund or bill change?)', 'बिलापेक्षा जास्त मिळाले', fmtCurrency(b.overReceived)) : ''}
    ${b.adjusted ? line(false, 'Discounts / waivers / write-offs agreed (tax review needed)', 'सवलत / माफी (कर तपासणी)', fmtCurrency(b.adjusted)) : ''}
    ${b.unbilled ? line(false, `${b.unbilled} delivered order${b.unbilled > 1 ? 's have' : ' has'} no bill yet`, 'आलेल्या ऑर्डरचे बिल नाही') : ''}
  </div></div>`;
}

function rSummary() {
  renderPeriodSegs();
  const P = sliceByPeriod(D, period);
  const totalBill = sumRupees(P.events, e => e.billing);
  const totalExp  = sumRupees(P.expenses);
  const profit    = (Math.round(totalBill * 100) - Math.round(totalExp * 100)) / 100;
  const done      = reconciledIds(P.events, P.expenses);
  const noData    = t => `<div class="list-empty">${t}</div>`;
  const missing   = new Set(eventsMissingCosts(P.events, P.expenses).map(e => e.id));
  const books     = booksCheck(D.events, D.expenses, D.cPays, D.vPays);

  const byCat = {};
  P.expenses.forEach(x => { byCat[x.cat] = (byCat[x.cat] || 0) + x.amt; });
  const maxCat = Math.max(...Object.values(byCat), 1);
  const catBars = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => `
    <div class="bar-row">
      <div class="bar-label trunc">${esc(cat)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${amt / maxCat * 100}%;background:var(--text-3)"></div></div>
      <div class="bar-val">${fmtCurrency(amt)}</div>
    </div>`).join('') || noData('No data – माहिती नाही');

  const evPL = P.events.map(ev => ({ ev, ...calcEventPL(ev, P.cPays, P.expenses) })).sort((a, b) => b.profit - a.profit);
  // Bar length is the size of the profit (or loss) relative to the largest one
  const maxAbsPL = Math.max(...evPL.map(r => Math.abs(r.profit)), 1);
  const plRows = evPL.map(r => `
    <div class="bar-row" role="button" tabindex="0" data-action="evdetail" data-id="${esc(r.ev.id)}">
      <div style="min-width:0"><div class="bar-label trunc" style="color:var(--text)" data-nl>${esc(r.ev.name)}</div>
        <div class="meta">${missing.has(r.ev.id) ? `<span class="neg">${tr('no costs', 'खर्च नाही')}</span>` : fmtDate(r.ev.date) + (done.has(r.ev.id) ? '' : tr(' · provisional', ' · अंदाजे'))}</div></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.abs(r.profit) / maxAbsPL * 100}%;background:var(${missing.has(r.ev.id) ? '--line-strong' : r.profit >= 0 ? '--pos' : '--neg'})"></div></div>
      <div class="bar-val ${missing.has(r.ev.id) ? 'muted' : r.profit >= 0 ? 'pos' : 'neg'}">${fmtCurrency(r.profit)}</div>
    </div>`).join('') || noData('No events – कार्यक्रम नाही');

  const byMode = {};
  P.cPays.forEach(p => { byMode[p.mode] = (byMode[p.mode] || 0) + p.amt; });
  const maxMode = Math.max(...Object.values(byMode), 1);
  const modeRows = Object.entries(byMode).sort((a, b) => b[1] - a[1]).map(([m, a]) => `
    <div class="bar-row">
      <div class="bar-label trunc">${esc(m)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${a / maxMode * 100}%;background:var(--pos)"></div></div>
      <div class="bar-val">${fmtCurrency(a)}</div>
    </div>`).join('') || noData('No data – माहिती नाही');

  const board = [...P.events].sort((a, b) => b.billing - a.billing).slice(0, 10).map((e, i) => `
    <div class="row" role="button" tabindex="0" data-action="evdetail" data-id="${esc(e.id)}">
      <div class="rank ${i < 3 ? 'top' : ''}">${i + 1}</div>
      <div class="row-body"><div class="title-sm trunc" data-nl>${esc(e.name)}</div><div class="meta trunc">${fmtDate(e.date)} · <span data-nl>${esc(e.venue)}</span></div></div>
      <div class="amt-sm">${fmtCurrency(e.billing)}</div>
    </div>`).join('');

  q('summary-content').innerHTML = `
    <div class="metric-tiles">
      <div class="card"><div class="label">Contribution – योगदान</div><div class="amt-lg ${profit >= 0 ? 'pos' : 'neg'}">${fmtCurrency(profit)}</div></div>
      <div class="card"><div class="label">Margin – मार्जिन</div><div class="amt-lg ${totalBill > 0 ? (profit >= 0 ? 'pos' : 'neg') : 'muted'}">${totalBill > 0 ? Math.round(profit / totalBill * 100) + '%' : '—'}</div></div>
      <div class="card"><div class="label">Billed – बिल</div><div class="amt-lg">${fmtCurrency(totalBill)}</div></div>
      <div class="card"><div class="label">Events – कार्यक्रम</div><div class="amt-lg">${P.events.length}</div></div>
    </div>
    ${missing.size ? `<div class="card" style="margin-top:var(--s3)"><div class="note alert"><span class="note-ic">${icon('receipt', 16)}</span>
      <div>${tr(`${missing.size} event${missing.size > 1 ? 's have' : ' has'} no expenses, so contribution here is overstated.`, `${missing.size} कार्यक्रमांचा खर्च नोंदवलेला नाही, त्यामुळे नफा जास्त दिसतो.`)}</div></div></div>` : ''}
    ${P.events.length ? `<div class="card" style="margin-top:var(--s3)"><div class="note"><span class="note-ic">${icon('receipt', 16)}</span>
      <div>${tr(`${done.size} of ${P.events.length} event${P.events.length > 1 ? 's' : ''} reconciled; the rest are provisional. Contribution is bills minus each event's costs, before overheads, salaries and tax, so it is not company net profit.`, `${P.events.length} पैकी ${done.size} कार्यक्रम जुळवले; बाकी अंदाजे. योगदान = बिल − कार्यक्रमाचा खर्च (ओव्हरहेड, पगार, कर आधी), हा कंपनीचा निव्वळ नफा नव्हे.`)}</div></div></div>` : ''}
    ${booksCard(books)}
    <div class="sec"></div>
    ${perPlateReport(P, missing)}
    ${costsHigherReport(P)}
    ${priceCreepReport()}
    <div class="card pad"><div class="chart-title">${icon('calendar', 18)}Contribution by event – कार्यक्रमनिहाय नफा</div>${plRows}</div>
    <div class="card pad"><div class="chart-title">${icon('receipt', 18)}Spending by category – खर्चाचे प्रकार</div>${catBars}</div>
    <div class="card pad"><div class="chart-title">${icon('wallet', 18)}Collections by mode – पद्धतीनुसार वसुली</div>${modeRows}</div>
    <div class="card pad" style="padding-bottom:var(--s2)"><div class="chart-title">${icon('trophy', 18)}Biggest events – सर्वात मोठे कार्यक्रम</div>
      <div>${board || noData('No events – कार्यक्रम नाही')}</div></div>
  `;
}

/* ── SHEETS ──────────────────────────────────────── */
function openSheet(id, after) {
  const el = q(id);
  el.classList.add('active');
  el.querySelector('.sheet').scrollTop = 0;
  openOverlay(() => el.classList.remove('active'), after);
}

function closeModals() {
  return closeOverlay();
}

// In-app replacement for confirm(): resolves to the chosen action's value, or null on Cancel / Back.
// An action with `run` calls it inside the tap itself (Android allows some things, like the share menu,
// only directly from a tap) and resolves to what it returns.
function askSheet({ title, message = '', actions }) {
  return new Promise(resolve => {
    let result = null;
    q('ask-title').textContent = title;
    q('ask-msg').textContent   = message;
    const box = q('ask-actions');
    box.innerHTML = '';
    [...actions, { label: 'Cancel – रद्द करा', value: null, style: 'btn-ghost' }].forEach(a => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.style || 'btn-primary');
      b.textContent = a.label;
      b.addEventListener('click', () => { result = a.run ? a.run() : a.value; closeOverlay(); });
      box.appendChild(b);
    });
    openSheet('ask-modal', () => resolve(result));
  });
}

function populateSelect(id, options, selected = '') {
  q(id).innerHTML = options.map(o =>
    typeof o === 'string'
      ? `<option value="${esc(o)}"${o === selected ? ' selected' : ''}>${esc(o)}</option>`
      : `<option value="${esc(o.v)}"${o.v === selected ? ' selected' : ''}>${esc(o.l)}</option>`
  ).join('');
}

function clearFieldErrors() {
  document.querySelectorAll('.field-error').forEach(el => el.remove());
  document.querySelectorAll('.field .error').forEach(el => el.classList.remove('error'));
}

function showFieldErrors(errors) {
  clearFieldErrors();
  for (const [field, msg] of Object.entries(errors)) {
    if (!msg) continue;
    const inp = document.getElementById(field) || document.querySelector(`[name="${field}"]`);
    if (!inp) continue;
    inp.classList.add('error');
    const err = document.createElement('div');
    err.className = 'field-error'; err.textContent = msg;
    inp.parentNode.appendChild(err);
  }
  const first = document.querySelector('.field-error');
  if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function eventOptions() {
  return [...D.events].sort((a, b) => b.date.localeCompare(a.date))
    .map(e => ({ v: e.id, l: `${e.name} · ${fmtDate(e.date)}` }));
}

/* ── EVENT SHEET ─────────────────────────────────── */
function openEvModal(id) {
  const ev = id ? D.events.find(e => e.id === id) : null;
  formBase.ev = snapshot(ev);
  q('ev-id').value      = ev?.id      || '';
  q('ev-name').value    = ev?.name    || '';
  q('ev-date').value    = ev?.date    || '';
  q('ev-venue').value   = ev?.venue   || '';
  q('ev-billing').value = ev?.billing || '';
  q('ev-mobile').value  = ev?.mobile  || '';
  q('ev-guests').value  = ev?.guests  || '';
  q('ev-budget').value  = ev?.budget  || '';
  q('ev-notes').value   = ev?.notes   || '';
  // A type not in today's list (older or custom) stays selectable, so editing never changes it
  populateSelect('ev-type', ev?.type && !EVENT_TYPES.includes(ev.type) ? [...EVENT_TYPES, ev.type] : EVENT_TYPES, ev?.type || '');
  q('ev-type-other').value = ev?.typeOther || '';
  populateSelect('ev-vtype', [{ v: '', l: 'Not set – निवडलेले नाही' }, ...VENUE_TYPES.map(t => ({ v: t.id, l: `${t.en} – ${t.mr}` }))], ev?.venueType || '');
  q('ev-vtype-other').value = ev?.venueTypeOther || '';
  q('ev-locality').value = ev?.locality || '';
  fillLogistics(ev?.logistics || {});
  q('ev-logi').open = !!(ev?.logistics && Object.keys(ev.logistics).length);
  syncEvTypeFields(); updateVenueHint();
  setEvMeals(ev?.meals || []);
  mpAuto = '';
  renderMealPlan(ev?.mealPlan || {});
  q('ev-mp').open = !!(ev?.mealPlan && Object.keys(ev.mealPlan).length);
  const menuOpts = leaf => MENUS.filter(m => !!m.leaf === leaf).map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  q('ev-menu').innerHTML = '<option value="">No package – पॅकेज नाही</option>'
    + `<optgroup label="Buffet – बुफे">${menuOpts(false)}</optgroup><optgroup label="Banana leaf – केळीचे पान">${menuOpts(true)}</optgroup>`;
  q('ev-menu').value = menuById(ev?.menu) ? ev.menu : '';
  evAuto = { bill: '', budget: '' };
  updateMenuHint();
  // Advance only when booking; later payments go through the event's "Payments received"
  q('ev-adv-field').hidden = !!ev;
  fillOutVendors(ev?.outVenId || '');
  q('ev-out-charge').value = '';
  q('ev-out-charge-field').hidden = !!ev;   // their bill is an expense once saved; edit it there
  setEvHandling(ev?.outsourced ? 'out' : 'own');
  q('ev-adv').value = '';
  populateSelect('ev-adv-mode', PAY_MODES, '');
  q('ev-mtitle').textContent = ev ? 'Edit event – संपादित करा' : 'New event – नवीन कार्यक्रम';
  clearFieldErrors();
  openSheet('ev-modal');
}

// Event page: client payment schedule (due now vs outstanding vs overdue)
const PAY_STATE = { paid: ['Paid', 'भरले', 'pos'], due: ['Due now', 'आता देय', 'due'], overdue: ['Overdue', 'थकीत', 'neg'], upcoming: ['Upcoming', 'आगामी', ''] };
function whenText(r) {
  if (r.when === 'booking') return tr('On booking', 'बुकिंगला');
  return fmtDate(r.dueDate) + (r.when === 'before' ? tr(' · before event', ' · आधी') : r.when === 'after' && !r.unscheduled ? tr(' · after event', ' · नंतर') : '');
}
function scheduleBlock(ev) {
  const s = paymentSchedule(ev, D.cPays);
  if (!s.scheduled) return `<button type="button" class="btn-sm" style="margin-top:var(--s3)" data-action="plan-edit">${icon('calendar', 16)}${tr('Payment schedule', 'हप्ते ठरवा')}</button>`;
  return `<div id="pay-schedule" style="margin-top:var(--s4);padding-top:var(--s4);border-top:1px solid var(--line)">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--s2)">
      <span class="label">${tr(`Due now ${fmtCurrency(s.dueNow)}`, `आता देय ${fmtCurrency(s.dueNow)}`)}${s.overdue > 0 ? ` · <span class="neg">${tr(`overdue ${fmtCurrency(s.overdue)}`, `थकीत ${fmtCurrency(s.overdue)}`)}</span>` : ''}</span>
      <button type="button" class="btn-sm" data-action="plan-edit">${icon('pencil', 16)}${tr('Edit', 'बदला')}</button></div>
    ${s.rows.map(r => `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:var(--s2);margin-top:6px">
      <div class="meta" style="min-width:0"><span data-nl>${esc(r.label || (r.unscheduled ? 'Balance (not on the schedule)' : 'Milestone'))}</span> · ${whenText(r)}</div>
      <div style="white-space:nowrap"><span class="amt-sm">${fmtCurrency(r.amount)}</span> <span class="chip ${PAY_STATE[r.state][2]}">${(rest => tr(PAY_STATE[r.state][0] + rest, PAY_STATE[r.state][1] + rest))(r.paid > 0 && r.rest > 0 ? ` · ${fmtCurrency(r.rest)}` : '')}</span></div></div>`).join('')}
    ${s.overScheduled > 0 ? `<div class="meta due" style="margin-top:6px">${tr(`The schedule adds up to ${fmtCurrency(s.overScheduled)} more than the bill`, `हप्ते बिलापेक्षा ${fmtCurrency(s.overScheduled)} जास्त`)}</div>` : ''}
  </div>`;
}

let planDraft = [];
function openPlanModal() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  planDraft = (ev.payPlan || []).map(m => ({ ...m }));
  if (!planDraft.length) planDraft = [{ id: uid('PM'), label: 'Advance', when: 'booking', amt: '' }];
  renderPlanRows();
  openSheet('plan-modal');
}
function renderPlanRows() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const whenOpts = [['booking', 'On booking – बुकिंगला'], ['date', 'On a date – तारखेला'], ['before', 'Days before event – आधी'], ['after', 'Days after event – नंतर']];
  q('plan-rows').innerHTML = planDraft.map((m, i) => `<div data-pm="${i}" style="display:flex;flex-direction:column;gap:var(--s2);padding:var(--s3) 0;border-bottom:1px solid var(--line)">
    <div style="display:flex;gap:var(--s2);align-items:center"><div class="field" style="flex:1;min-width:0;margin:0"><input type="text" data-k="label" aria-label="Milestone name" value="${esc(m.label || '')}" placeholder="e.g. Second payment"></div>
      <button type="button" class="icon-btn" data-pm-del="${i}" aria-label="Remove milestone">${icon('x', 16)}</button></div>
    <div class="f2" style="margin:0"><div class="field" style="margin:0"><input type="text" data-k="amt" aria-label="Amount in rupees or percent" inputmode="decimal" value="${m.pct != null ? m.pct + '%' : esc(String(m.amt ?? ''))}" placeholder="₹ or % of bill"></div>
      <div class="field" style="margin:0"><select data-k="when" aria-label="When it is due">${whenOpts.map(([v, l]) => `<option value="${v}"${m.when === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
    ${m.when === 'date' ? `<div class="field" style="margin:0"><input type="date" data-k="date" aria-label="Due date" value="${esc(m.date || '')}"></div>` : ['before', 'after'].includes(m.when) ? `<div class="field" style="margin:0"><input type="number" data-k="days" aria-label="Days" min="0" inputmode="numeric" placeholder="Days ${m.when === 'before' ? 'before' : 'after'} the event" value="${m.days ?? ''}"></div>` : ''}
  </div>`).join('');
  updatePlanSum();
}
function readPlanRow(m) {
  const raw = String(m.amtRaw ?? (m.pct != null ? m.pct + '%' : m.amt ?? '')).trim();
  const out = { id: m.id, label: (m.label || '').trim(), when: m.when };
  if (/%$/.test(raw)) out.pct = Number(raw.slice(0, -1)); else out.amt = raw === '' ? NaN : Number(raw);
  if (m.when === 'date') out.date = m.date || '';
  if (['before', 'after'].includes(m.when)) out.days = m.days === '' || m.days == null ? NaN : Math.floor(Number(m.days));
  if (!out.label) delete out.label;
  return out;
}
function updatePlanSum() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const rows = planDraft.map(readPlanRow);
  const total = rows.reduce((s, r) => s + (r.pct != null ? Math.round(toPaise(ev.billing) * r.pct / 100) : toPaise(r.amt || 0)), 0) / 100;
  const diff = Math.round(ev.billing * 100) / 100 - total;
  q('plan-sum').textContent = `Bill ${fmtCurrency(ev.billing)} · scheduled ${fmtCurrency(total)}` + (diff > 0 ? ` · ${fmtCurrency(diff)} left as balance after the event` : diff < 0 ? ` · ${fmtCurrency(-diff)} more than the bill` : ' · all of the bill');
}
async function savePlan() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const rows = planDraft.map(readPlanRow).filter(r => !(r.pct == null && Number.isNaN(r.amt) && !r.label));
  for (const r of rows) {
    const bad = r.pct != null ? !(r.pct > 0 && r.pct <= 100) : !(r.amt > 0) || Math.abs(r.amt * 100 - Math.round(r.amt * 100)) > .001;
    if (bad || (r.when === 'date' && !r.date) || (['before', 'after'].includes(r.when) && !(r.days >= 0))) {
      showToast('Each milestone needs an amount (₹ or % of the bill) and when it is due – रक्कम व तारीख लिहा', 'error'); return;
    }
  }
  const total = rows.reduce((s, r) => s + (r.pct != null ? Math.round(toPaise(ev.billing) * r.pct / 100) : toPaise(r.amt)), 0);
  if (total > toPaise(ev.billing)) { showToast('The schedule is more than the bill – हप्ते बिलापेक्षा जास्त', 'error'); return; }
  try { await patchEvent(ev.id, { payPlan: rows }, rows.length ? [] : ['payPlan']); } catch (e) { showToast(e.message || 'Could not save. Nothing was changed.', 'error'); return; }
  closeModals(); refreshCurrent();
  showToast(rows.length ? 'Payment schedule saved – हप्ते जतन' : 'Payment schedule removed – हप्ते काढले');
}

// Event page: the bill by meal; the bill itself stays the one commercial amount
function mealPlanLine(ev) {
  const t = mealPlanTotal(ev.mealPlan || {}); if (!t.lines.length) return '';
  const diff = Math.round(Number(ev.billing) * 100) - t.totalPaise;
  return `<div class="meta" id="meal-plan" data-nl style="margin-top:var(--s3)">${t.lines.map(l => `${MEALS[l.meal]} ${l.guests} × ${fmtCurrency(l.rate)} = ${fmtCurrency(l.total)}`).join(' · ')}${t.lines.length > 1 ? ` · ${tr('meals total', 'एकूण')} ${fmtCurrency(t.total)}` : ''}
    ${diff ? `<div class="due">${tr(`Bill is ${fmtCurrency(Math.abs(diff) / 100)} ${diff > 0 ? 'more' : 'less'} than the meal prices (extras or a discount?)`, `बिल जेवणाच्या दरांपेक्षा ${fmtCurrency(Math.abs(diff) / 100)} ${diff > 0 ? 'जास्त' : 'कमी'}`)}</div>` : ''}</div>`;
}

/* ── Price by meal in the event form (spec §6.4) ── */
let mpAuto = '';   // the bill value last filled from the meal total, so a typed bill is never overwritten
function readMealPlan() {
  const plan = {};
  document.querySelectorAll('#ev-mp-rows [data-mp]').forEach(row => {
    const g = row.querySelector('[data-k="guests"]').value, r = row.querySelector('[data-k="rate"]').value;
    if (g || r) plan[row.dataset.mp] = { guests: g === '' ? 0 : Math.max(0, Math.floor(Number(g))), rate: r === '' ? 0 : Number(r) };
  });
  return plan;
}
function renderMealPlan(values) {
  const meals = MEAL_ORDER.filter(m => evMeals().includes(m));
  q('ev-mp').hidden = !meals.length;
  q('ev-mp-rows').innerHTML = meals.map(m => `<div class="f2" data-mp="${m}">
    <div class="field"><label for="ev-mp-${m}-g">${MEALS[m]} guests – पाहुणे</label><input type="number" id="ev-mp-${m}-g" data-k="guests" min="0" inputmode="numeric" placeholder="${esc(qv('ev-guests') || '0')}" value="${values[m]?.guests || ''}"></div>
    <div class="field"><label for="ev-mp-${m}-r">₹ / plate – दर</label><input type="number" id="ev-mp-${m}-r" data-k="rate" min="0" inputmode="decimal" placeholder="0" value="${values[m]?.rate || ''}"></div></div>`).join('');
  updateMealPlan();
}
// Only meals still ticked, with both guests and a rate, are kept
function mealPlanFields(meals) {
  const plan = readMealPlan(), out = {};
  for (const m of meals) if (plan[m]?.guests > 0 && plan[m]?.rate > 0) out[m] = { guests: plan[m].guests, rate: Math.round(plan[m].rate * 100) / 100 };
  return out;
}
function updateMealPlan() {
  const t = mealPlanTotal(mealPlanFields(MEAL_ORDER.filter(m => evMeals().includes(m))));
  q('ev-mp-total').innerHTML = t.lines.length ? t.lines.map(l => `${MEALS[l.meal]} ${l.guests} × ${fmtCurrency(l.rate)} = ${fmtCurrency(l.total)}`).join(' · ')
    + ` · <b>${tr('Total', 'एकूण')} ${fmtCurrency(t.total)}</b> ${tr('(before tax)', '(कराआधी)')}` : '';
  // The meal total fills the bill only if the bill is empty or still holds the last filled total
  const bill = q('ev-billing').value;
  if (t.total > 0 && (!bill || bill === mpAuto || bill === evAuto.bill)) { q('ev-billing').value = String(t.total); mpAuto = String(t.total); evAuto.bill = ''; updateQuote(); }
}

/* ── Venue details in the event form (CD5-VEN-01) ── */
function fillLogistics(values) {
  q('ev-logi-fields').innerHTML = LOGISTICS.map(g => `<div class="field" style="flex:1 1 45%"><label for="ev-logi-${g.id}">${g.en} – ${g.mr}</label>
    <select id="ev-logi-${g.id}" data-logi="${g.id}"><option value="">Unknown – माहीत नाही</option>${g.opts.map(([v, en, mr]) => `<option value="${v}"${values[g.id] === v ? ' selected' : ''}>${en} – ${mr}</option>`).join('')}</select></div>`).join('');
}
function readLogistics() {
  const out = {};
  document.querySelectorAll('#ev-logi-fields [data-logi]').forEach(s => { if (s.value) out[s.dataset.logi] = s.value; });
  return out;
}
function syncEvTypeFields() {
  q('ev-type-other-field').hidden = qv('ev-type') !== 'Other – इतर';
  q('ev-vtype-other-field').hidden = qv('ev-vtype') !== 'other';
}
// Only what the user chose is stored; blanks are left out so older events are not given empty fields
function venueFields() {
  const f = {}, vt = qv('ev-vtype'), logi = readLogistics();
  if (vt) f.venueType = vt;
  if (vt === 'other' && qv('ev-vtype-other')) f.venueTypeOther = qv('ev-vtype-other');
  if (qv('ev-locality')) f.locality = qv('ev-locality');
  if (qv('ev-type') === 'Other – इतर' && qv('ev-type-other')) f.typeOther = qv('ev-type-other');
  if (Object.keys(logi).length) f.logistics = logi;
  return f;
}
function emptyVenueFields() {
  const f = venueFields();
  return ['venueType', 'venueTypeOther', 'locality', 'typeOther', 'logistics'].filter(k => !(k in f));
}
// Repeat venue: offer the last event's details there; the user decides, and past events are never changed
let venueOffer = null;
function updateVenueHint() {
  const hint = q('ev-venue-hint');
  const filled = qv('ev-vtype') || qv('ev-locality') || Object.keys(readLogistics()).length;
  const offer = filled ? null : venueSuggestion(D.events, qv('ev-venue'), qv('ev-id'));
  // Same suggestion already showing: leave it as it is. Re-drawing it here (this runs when the venue box loses
  // focus, i.e. on the way to tapping "Use") would replace the button under the finger and lose the tap.
  if (offer && venueOffer && offer.from === venueOffer.from && !hint.hidden) return;
  venueOffer = offer;
  hint.hidden = !venueOffer;
  if (!venueOffer) { hint.innerHTML = ''; return; }
  const what = [venueTypeLabel(venueOffer), venueOffer.locality, Object.keys(venueOffer.logistics).length ? `${Object.keys(venueOffer.logistics).length} logistics` : ''].filter(Boolean).join(' · ');
  hint.innerHTML = `<span>${tr(`Used before (${fmtDate(venueOffer.date)}): ${esc(what)}`, `आधी वापरले (${fmtDate(venueOffer.date)}): ${esc(what)}`)}</span>
    <button type="button" class="btn-sm" data-action="venue-fill">${tr('Use', 'वापरा')}</button>`;
}
function useVenueOffer() {
  if (!venueOffer) return;
  q('ev-vtype').value = venueOffer.venueType; q('ev-vtype-other').value = venueOffer.venueTypeOther;
  q('ev-locality').value = venueOffer.locality; fillLogistics(venueOffer.logistics);
  q('ev-logi').open = !!Object.keys(venueOffer.logistics).length;
  syncEvTypeFields(); venueOffer = null; q('ev-venue-hint').hidden = true;
}

let expLogi = '';
let expOrder = '';

// Values the menu last filled in, so a changed menu or guest count updates them
// but never overwrites a figure typed by hand
let evAuto = { bill: '', budget: '' };

/* Quote helper, from your own events (never the card alone):
   what this menu (or event type) usually costs per plate, the margin at the bill typed,
   the lowest per-plate price for a 30% margin, and what you have actually billed on this menu. */
const TARGET_MARGIN = 30;               // own events: minimum margin
const COMMISSION_MARGIN = [10, 20];     // outsourced (commission) work: usual range
function updateQuote() {
  const box = q('ev-quote');
  const id = qv('ev-id'), menu = menuById(qv('ev-menu')), type = qv('ev-type');
  const guests = Number(qv('ev-guests')) || 0, bill = Number(qv('ev-billing')) || 0;
  if (q('ev-handling').dataset.value === 'out') { box.hidden = true; return; }
  const spent = new Map();
  for (const x of D.expenses) spent.set(x.evId, (spent.get(x.evId) || 0) + x.amt);
  const peers = D.events.filter(e => e.id !== id && !e.outsourced && Number(e.guests) > 0);
  const avg = (list, val) => {
    const g = list.reduce((s, e) => s + Number(e.guests), 0);
    return g ? { n: list.length, perPlate: Math.round(list.reduce((s, e) => s + val(e), 0) / g) } : null;
  };
  const done = reconciledIds(D.events, D.expenses);
  const costed = peers.filter(e => spent.get(e.id) && done.has(e.id));   // reconciled: complete costs only
  const byMenu = menu ? costed.filter(e => e.menu === menu.id) : [];
  const basis = byMenu.length ? menu.name : (type || '').split(' – ')[0];
  const cost = avg(byMenu.length ? byMenu : costed.filter(e => e.type === type), e => spent.get(e.id));
  const billed = menu ? avg(peers.filter(e => e.menu === menu.id), e => e.billing) : null;
  const lines = [];
  if (cost) {
    lines.push(`${esc(basis)} usually costs you <b>${fmtCurrency(cost.perPlate)}/plate</b> (${cost.n} reconciled event${cost.n > 1 ? 's' : ''})`);
    if (bill && guests) {
      const pp = Math.round(bill / guests), m = Math.round((pp - cost.perPlate) / pp * 100);
      lines.push(`At ${fmtCurrency(pp)}/plate your margin is about <b class="${m < TARGET_MARGIN ? 'due' : 'pos'}">${m}%</b> · minimum ${TARGET_MARGIN}%`);
    }
    const pm = priceForMargin(cost.perPlate, TARGET_MARGIN), pu = priceForMarkup(cost.perPlate, TARGET_MARGIN);
    lines.push(`For a ${TARGET_MARGIN}% margin, quote at least <b>${fmtCurrency(pm)}/plate</b>`);
    lines.push(`<span class="meta">(${TARGET_MARGIN}% markup on cost would be only ${fmtCurrency(pu)}/plate, a ${marginPct(pu, cost.perPlate)}% margin)</span>`);
  }
  if (billed) lines.push(`Card ${fmtCurrency(menuRate(menu, guests))} · you actually billed <b>${fmtCurrency(billed.perPlate)}/plate</b> on average (${billed.n} event${billed.n > 1 ? 's' : ''})`);
  box.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
  box.hidden = !lines.length;
}

function updateMenuHint() {
  const menu = menuById(qv('ev-menu'));
  const guests = Number(qv('ev-guests')) || 0;
  const hint = q('ev-menu-hint');
  if (!menu) { hint.hidden = true; updateQuote(); return; }
  const rate = menuRate(menu, guests);
  const past = menuCostPerPlate(menu.id, D.events, D.expenses, qv('ev-id'));
  const fill = (id, key, value) => {
    const cur = q(id).value;
    if (value && (!cur || cur === evAuto[key])) { q(id).value = String(value); evAuto[key] = String(value); }
  };
  if (guests) {
    fill('ev-billing', 'bill', rate * guests);
    if (past) fill('ev-budget', 'budget', past.perPlate * guests);
  }
  hint.textContent = `${menu.name} @ ${fmtCurrency(rate)}/plate` + (guests ? ` × ${guests} = ${fmtCurrency(rate * guests)}` : ' · add guests to fill the bill')
    + (past ? ` · usually costs ${fmtCurrency(past.perPlate)}/plate (${past.n} reconciled event${past.n > 1 ? 's' : ''})` : ' · cost per plate shows once an event on this menu is reconciled');
  hint.hidden = false;
  updateQuote();
}

// "Done by" choices for an outsourced event, with "+ New vendor" to add one without leaving the form
function fillOutVendors(selected) {
  populateSelect('ev-out-ven', [{ v: '', l: 'Choose vendor – विक्रेता निवडा' },
    ...D.vendors.filter(v => !isPerson(v)).sort((a, b) => String(a.name).localeCompare(String(b.name))).map(v => ({ v: v.id, l: v.name })),
    { v: '__new', l: '+ New vendor – नवीन विक्रेता' }], selected);
  q('ev-out-ven').dataset.prev = q('ev-out-ven').value;
}

function setEvHandling(h) {
  q('ev-handling').dataset.value = h;
  q('ev-handling').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.h === h)));
  q('ev-out-field').hidden = h !== 'out';
  updateOutHint();
  updateQuote();
}

// Outsourced: what you keep = bill − their charge (or, once saved, − the event's costs)
function updateOutHint() {
  const hint = q('ev-out-hint');
  if (q('ev-handling').dataset.value !== 'out') { hint.hidden = true; return; }
  const bill = Number(qv('ev-billing')) || 0;
  const id = qv('ev-id');
  const cost = id ? D.expenses.filter(x => x.evId === id).reduce((s, x) => s + x.amt, 0) : Number(qv('ev-out-charge')) || 0;
  const pct = bill && cost ? Math.round((bill - cost) / bill * 100) : null;
  hint.innerHTML = pct !== null
    ? `Your commission ${fmtCurrency(bill - cost)} · <b class="${pct < COMMISSION_MARGIN[0] ? 'due' : 'pos'}">${pct}%</b> · target ${COMMISSION_MARGIN[0]}–${COMMISSION_MARGIN[1]}%`
    : 'Bill = what the client pays. Their charge is saved as credit to the vendor. If the client pays them directly, enter your commission as the bill and leave their charge blank.';
  hint.hidden = false;
}

/* Fill a name and number from the phone's contact list (Contact Picker API, Android Chrome).
   Only the contact chosen is shared with the app. The name fills an empty name field only. */
const canPickContact = 'contacts' in navigator && 'ContactsManager' in window;
function cleanPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}
async function pickContact(nameId, phoneId) {
  let picked;
  try { [picked] = await navigator.contacts.select(['name', 'tel'], { multiple: false }); }
  catch { showToast('Could not open contacts – संपर्क उघडता आले नाहीत', 'error'); return; }
  if (!picked) return;
  const numbers = [...new Set((picked.tel || []).map(cleanPhone).filter(Boolean))];
  const phone = numbers.length > 1
    ? await askSheet({ title: 'Which number? – कोणता नंबर?', actions: numbers.map(n => ({ label: n, value: n, style: 'btn-secondary' })) })
    : numbers[0];
  if (phone) { q(phoneId).value = phone; q(phoneId).dispatchEvent(new Event('input')); }
  const name = (picked.name || [])[0];
  if (name && !qv(nameId)) q(nameId).value = name;
}

async function saveEvent() {
  const data = {
    name:    qv('ev-name'),
    date:    qv('ev-date'),
    venue:   qv('ev-venue'),
    billing: qf('ev-billing'),
    mobile:  qv('ev-mobile'),
    budget: qf('ev-budget'),
    guests: qf('ev-guests')
  };
  const id = qv('ev-id');
  const adv = id || !qv('ev-adv') ? '' : qf('ev-adv');   // optional: blank means no advance
  const { valid, errors } = validate({ ...EVENT_RULES, adv: { numeric: true, min: 1, minMsg: 'Advance must be > 0' } }, { ...data, adv });
  if (!errors.adv && !errors.billing && adv !== '' && Number(adv) > Number(data.billing)) errors.adv = 'Advance is more than the total bill – अॅडव्हान्स बिलापेक्षा जास्त';
  // Rule keys are field names; the inputs are ev-<name>
  const out = q('ev-handling').dataset.value === 'out';
  const outVenId = out ? qv('ev-out-ven') : '';
  const charge = out && !id && qv('ev-out-charge') ? qf('ev-out-charge') : '';
  if (out && !outVenId) errors['out-ven'] = 'Choose who does the event – विक्रेता निवडा';
  if (charge !== '' && !(charge > 0)) errors['out-charge'] = 'Enter their charge – रक्कम लिहा';
  else if (charge !== '' && !errors.billing && charge > Number(data.billing)) errors['out-charge'] = 'Their charge is more than the bill – बिलापेक्षा जास्त';
  if (!valid || errors.adv || errors['out-ven'] || errors['out-charge']) { showFieldErrors(Object.fromEntries(Object.entries(errors).map(([k, v]) => ['ev-' + k, v]))); return; }

  const base = id ? formBase.ev : null;
  const meals = Object.keys(MEALS).filter(m => evMeals().includes(m));
  const record = editedRecord(base, {
    id:       id || uid('EV'),
    name:     data.name,
    date:     data.date,
    type:     qv('ev-type'),
    ...(meals.length ? { meals } : {}),
    venue:    data.venue,
    ...venueFields(),
    ...(Object.keys(mealPlanFields(meals)).length ? { mealPlan: mealPlanFields(meals) } : {}),
    billing:  data.billing,
    mobile:   data.mobile,
    guests:   data.guests,
    budget:   data.budget,
    menu:     qv('ev-menu'),
    ...(out ? { outsourced: true, outVenId } : {}),
    notes:    qv('ev-notes'),
    photoIds: base?.photoIds || [],
    _v: 2
  }, [...(meals.length ? [] : ['meals']), ...(out ? [] : ['outsourced', 'outVenId']), ...emptyVenueFields(), ...(Object.keys(mealPlanFields(meals)).length ? [] : ['mealPlan']),
      // Older events keep their shape: an empty mobile or budget, or the format marker, is not added to them
      ...['mobile', 'notes', 'menu'].filter(k => !(base && k in base) && !{ mobile: data.mobile, notes: qv('ev-notes'), menu: qv('ev-menu') }[k]),
      ...(!(Number(data.budget) > 0) && !(base && 'budget' in base) ? ['budget'] : []),
      ...(base && !('_v' in base) ? ['_v'] : [])]);

  // The advance is saved with the event in one go, as its first payment received
  const advance = adv !== '' ? { id: uid('CP'), evId: record.id, amt: adv, date: today(), mode: qv('ev-adv-mode'), notes: 'Advance – अॅडव्हान्स' } : null;
  // An outsourced event's vendor charge is one credit expense to that vendor, saved with the event
  const vendorBill = charge !== '' ? { id: uid('EX'), evId: record.id, cat: 'Operations', head: 'Outsourced Event – आउटसोर्स कार्यक्रम', amt: charge,
    date: record.date, pay: 'credit', mode: '', venId: outVenId, dueDate: '', notes: '', billIds: [] } : null;
  if (advance || vendorBill) await commitChanges([{ store: 'events', record, expected: null },
      ...(advance ? [{ store: 'cPays', record: advance, expected: null }] : []),
      ...(vendorBill ? [{ store: 'expenses', record: vendorBill, expected: null }] : [])], { check: true, extraStores: ['vendors'] });
  else await putChecked('events', record, id ? base : null);
  if (id) D.events = D.events.map(e => e.id === id ? record : e);
  else    D.events.push(record);
  if (advance) D.cPays.push(advance);
  if (vendorBill) D.expenses.push(vendorBill);

  closeModals();
  const msg = advance ? `Event saved with ${fmtCurrency(advance.amt)} advance – अॅडव्हान्ससह जतन` : 'Event saved – कार्यक्रम जतन झाला';
  // A new event saved from another page: one tap to open it
  showToast(msg, 'success', !id && CT !== 'evdetail' ? { label: 'Open – उघडा', run: () => showEvDetail(record.id) } : null);
  if (!id && CT !== 'evdetail') setTimeout(hideToast, 6000);
  refreshCurrent();
}

/* ── EXPENSE SHEET ───────────────────────────────── */
// The event an expense most likely belongs to: the one whose date is nearest today
// (catering costs land in the days just before and after an event).
function defaultEventId() {
  if (!D.events.length) return '';
  const t = new Date(today());
  let best = null;
  for (const e of D.events) {
    const d = Math.abs(new Date(e.date) - t);
    if (!best || d < best.d || (d === best.d && e.date > best.e.date)) best = { e, d };
  }
  return best.e.id;
}

function setExpCat(cat, head = '') {
  q('exp-cat').value = cat;
  q('exp-cats').innerHTML = Object.keys(EXPENSE_HEADS).map(c =>
    `<button type="button" class="cat-chip" data-cat="${esc(c)}" aria-pressed="${c === cat}">${catIcon(c, 20)}${esc(c)}</button>`).join('');
  populateSelect('exp-head', headsByUse(cat), head);
  populateVendorSelect(qv('exp-vendor'));
}

// Compare category / item names ignoring the Marathi half, spacing and case
const normal = value => String(value || '').normalize('NFKC').split(' – ')[0].trim().replace(/\s+/g, ' ').toLocaleLowerCase();

// A category's items with the ones you record most at the top (the rest keep their usual order)
function headsByUse(cat) {
  const heads = EXPENSE_HEADS[cat] || [];
  const uses = new Map();
  for (const x of D.expenses) if (x.cat === cat && x.head) uses.set(x.head, (uses.get(x.head) || 0) + 1);
  return heads.map((h, i) => ({ h, i, n: uses.get(h) || 0 })).sort((a, b) => (b.n - a.n) || (a.i - b.i)).map(r => r.h);
}

/* Vendors ranked for the chosen category and item:
   [0] usual for this item — its listed speciality, or who has supplied it before
   [1] same category        — listed category, or who has supplied this category before
   [2] everyone else
   Within a group: speciality match first, then most used, then name. */
function rankVendors(cat, head) {
  const c = normal(cat), h = normal(head);
  const usesFor = new Map(), usesIn = new Map();
  for (const x of D.expenses) {
    if (!x.venId) continue;
    if (c && normal(x.cat) === c) {
      usesIn.set(x.venId, (usesIn.get(x.venId) || 0) + 1);
      if (h && normal(x.head) === h) usesFor.set(x.venId, (usesFor.get(x.venId) || 0) + 1);
    }
  }
  const groups = [[], [], []];
  for (const v of D.vendors) {
    if (isPerson(v)) continue;
    const specialty = c && h && normal(v.cat) === c && normal(v.specialty) === h;
    const forItem = specialty || usesFor.has(v.id);
    const inCat = (c && normal(v.cat) === c) || usesIn.has(v.id);
    groups[forItem ? 0 : inCat ? 1 : 2].push({ v, specialty, n: (usesFor.get(v.id) || 0) * 100 + (usesIn.get(v.id) || 0) });
  }
  const order = (a, b) => (b.specialty - a.specialty) || (b.n - a.n) || String(a.v.name || '').localeCompare(String(b.v.name || ''));
  return groups.map(g => g.sort(order).map(r => r.v));
}

// One-tap buttons for the usual vendors (or, if none yet, the category's vendors)
function renderVendorQuick() {
  const [usual, inCat] = rankVendors(qv('exp-cat'), qv('exp-head'));
  const picks = (usual.length ? usual : inCat).slice(0, 4);
  q('exp-ven-quick-field').hidden = !picks.length;
  q('exp-ven-quick').innerHTML = picks.map(v =>
    `<button type="button" class="f-chip" data-ven="${esc(String(v.id))}" aria-pressed="${String(v.id) === qv('exp-vendor')}" data-nl>${esc(v.name)}</button>`).join('');
}

function setExpDue(date) {
  q('exp-due').value = date || '';
  const days = date ? daysUntil(date) : '';
  q('exp-due-chips').querySelectorAll('[data-due]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.due === '' ? !date : Number(b.dataset.due) === days)));
}

// One line under the event picker: how much this event has cost so far, against its budget
function updateExpEvHint() {
  const ev = D.events.find(e => e.id === qv('exp-ev'));
  if (!ev) { q('exp-ev-hint').textContent = ''; return; }
  const pl = calcEventPL(ev, D.cPays, D.expenses);
  let text = `Spent so far ${fmtCurrency(pl.expTotal)}`;
  if (pl.budget) text += ` of ${fmtCurrency(pl.budget)} budget (${pl.budgetUsed}%)`;
  if (pl.costPerPlate !== null) text += ` · ${fmtCurrency(pl.costPerPlate)}/plate`;
  q('exp-ev-hint').textContent = text;
  q('exp-ev-hint').className = 'meta' + (pl.budget && pl.overBudget > 0 ? ' neg' : '');
}

function setExpPay(pay) {
  q('exp-pay').dataset.value = pay;
  q('exp-pay').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pay === pay)));
  const credit = pay === 'credit';
  q('exp-mode-field').hidden = credit;
  q('exp-due-field').hidden = !credit;
  populateVendorSelect(qv('exp-vendor'));
}

// "Owed to" for credit, "Whose staff" for a vendor-staff tip, otherwise "Vendor"
function setVendorLabel() {
  const credit = q('exp-pay').dataset.value === 'credit';
  q('exp-vendor-lbl').innerHTML = credit ? 'Owed to – कोणाला देणे <span class="req">*</span>'
    : normal(qv('exp-head')) === 'vendor staff tips' ? 'Whose staff – कोणाचा स्टाफ'
    : 'Vendor – विक्रेता';
}

function populateVendorSelect(selected = '') {
  const selStr = String(selected ?? '').trim();
  const groups = rankVendors(qv('exp-cat'), qv('exp-head'));
  const labels = ['Usual for this item – नेहमीचे विक्रेते', 'Same category – त्याच प्रकारातील', 'Other vendors – इतर विक्रेते'];
  const option = vendor => `<option value="${esc(String(vendor.id))}">${esc(vendor.name)}</option>`;
  // Lenders only make sense for credit (or an entry already linked to one)
  const credit = q('exp-pay').dataset.value === 'credit';
  const people = D.vendors.filter(v => isPerson(v) && (credit || String(v.id) === selStr))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  q('exp-vendor').innerHTML = '<option value="">Choose vendor – विक्रेता निवडा</option>' +
    groups.map((vendors, i) => vendors.length ? `<optgroup label="${esc(labels[i])}">${vendors.map(option).join('')}</optgroup>` : '').join('') +
    (people.length ? `<optgroup label="${esc('Other people – इतर व्यक्ती')}">${people.map(option).join('')}</optgroup>` : '') +
    '<option value="__new">+ New vendor – नवीन विक्रेता</option>' +
    (credit ? '<option value="__newperson">+ Other person (lent / paid for you) – इतर व्यक्ती</option>' : '');
  setVendorLabel();
  // Reordering suggestions must not replace an edited or explicitly chosen vendor.
  q('exp-vendor').value = D.vendors.some(v => String(v.id) === selStr) ? selStr : '';
  q('exp-vendor').dataset.prev = q('exp-vendor').value;
  renderVendorQuick();
}

function openExpModal(arg) {
  if (!D.events.length) {
    showToast('Create an event first – आधी कार्यक्रम जोडा', 'error');
    return;
  }
  // { prefill } comes from the cost checklist: a new entry with item and vendor filled in
  const pre  = arg && typeof arg === 'object' && (arg.prefill || arg.resume) || null;
  const ex   = arg && typeof arg === 'object' && !pre ? arg : null;
  formBase.exp = snapshot(ex);   // an expense or bill draft being edited; null for a new entry
  expLogi = pre?.logi || '';
  expOrder = pre?.order || '';   // the delivered order this new bill is for (G-23)     // which venue reminder a new expense answers (one expense per reminder)
  expTouched = { item: !!(ex || pre?.head), pay: !!(ex || arg?.resume) };
  const evId = ex?.evId || pre?.evId || (typeof arg === 'string' && arg) || defaultEventId();
  const last = readPref('ffv2_lastexp', {});

  q('exp-id').value    = ex?.id || '';
  q('exp-amt').value   = ex?.amt || '';
  populateSelect('exp-ev', ex?.stock ? [{ v: '', l: 'Common stock (no event yet) – साठा' }] : eventOptions(), ex?.stock ? '' : evId);
  setExpCat(ex?.cat || pre?.cat || last.cat || Object.keys(EXPENSE_HEADS)[0], ex?.head || pre?.head || last.head || '');
  populateSelect('exp-mode', PAY_MODES, ex?.mode || pre?.mode || last.mode || '');
  populateVendorSelect(ex?.venId || pre?.venId || '');
  q('exp-amt').placeholder = arg?.prefill && pre.amt ? `Last time ${fmtCurrency(pre.amt)}` : '0';
  setExpPay(ex ? (isOnCredit(ex) ? 'credit' : 'paid') : pre?.pay || 'paid');
  if (pre?.venId) populateVendorSelect(pre.venId);
  q('exp-date').value  = ex?.date || pre?.date || today();
  setExpDue(ex?.dueDate || pre?.dueDate || '');
  if (arg?.resume) { q('exp-amt').value = pre.amt || ''; }
  updateExpEvHint();
  q('exp-notes').value = ex?.notes || pre?.notes || '';
  q('exp-billno').value = ex?.billNo || '';
  q('exp-mtitle').textContent = ex?.draft ? 'Fill in bill – बिल भरा'
                              : ex ? 'Edit expense – संपादित करा' : 'Record expense – खर्च नोंदवा';
  q('btn-del-exp').hidden       = !ex;
  // A part of a shared bill: its amount and event come from the split; change them with "Share bill"
  const part = ex?.split ? splitParts(D.expenses, ex.split.id) : null;
  q('exp-amt').disabled = !!part; q('exp-ev').disabled = !!part || !!ex?.stock;
  q('exp-split-note').hidden = !part && !ex?.stock;
  q('exp-split-note').innerHTML = part && ex.stock ? tr(`Shared bill: the common-stock part of ${fmtCurrency(ex.split.total)}, on no event yet. To use it for an event, move it with Share bill; the bill total stays the same.`,
    `वाटलेले बिल: ${fmtCurrency(ex.split.total)} पैकी साठ्याचा भाग.`)
    : part ? tr(`Shared bill: this event's part of ${fmtCurrency(ex.split.total)} across ${part.length} events. Changes to vendor, item, date or payment apply to every part.`,
    `वाटलेले बिल: ${fmtCurrency(ex.split.total)} पैकी या कार्यक्रमाचा वाटा (${part.length} कार्यक्रम).`)
    : ex?.stock ? tr('Common stock, on no event yet. To use it for an event, move it with Share bill.', 'साठा – अजून कोणत्याही कार्यक्रमावर नाही.') : '';
  q('btn-share-exp').hidden = !ex || !!ex.draft;
  q('btn-save-exp-next').hidden = !!ex;
  clearFieldErrors();
  startExpSession(ex);
  openSheet('exp-modal', endExpSession);
  // Keyboard opens straight onto the amount (focus must happen inside the tap)
  if (!ex || ex.draft) q('exp-amt').focus({ preventScroll: true });
}

// What the person has chosen by hand in this sheet; vendor habits never override those
let expTouched = { item: false, pay: false };

/* Picking a vendor first fills what you usually record with them: their most common item,
   and whether you usually pay them now (and how) or take credit. New entries only. */
function applyVendorHabits(venId) {
  if (qv('exp-id')) return;
  const mine = D.expenses.filter(x => x.venId === venId);
  if (!mine.length) return;
  const top = key => {
    const n = new Map();
    for (const x of mine) { const k = key(x); if (k) n.set(k, (n.get(k) || 0) + 1); }
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  if (!expTouched.item) {
    const item = top(x => x.cat && x.head ? x.cat + '\u0000' + x.head : '');
    if (item) { const [cat, head] = item.split('\u0000'); setExpCat(cat, head); }
  }
  if (!expTouched.pay) {
    setExpPay(top(x => isOnCredit(x) ? 'credit' : 'paid') || 'paid');
    const mode = top(x => !isOnCredit(x) ? x.mode : '');
    if (mode) q('exp-mode').value = mode;
  }
  q('exp-vendor').value = venId; q('exp-vendor').dataset.prev = venId;
  renderVendorQuick();
}

/* Bill photos inside the expense sheet */
function startExpSession(ex) {
  expWork = { id: ex?.id || uid('EX'), bills: [], added: [], removed: [], saved: false, ready: Promise.resolve(), pending: 0 };
  renderExpBills();
  if (ex && (ex.billIds || []).length) {
    const id = ex.id;
    const session = expWork;
    expWork.ready = getBillsForExpense(id).then(bills => {
      if (expWork !== session) return;            // sheet moved on meanwhile
      expWork.bills = bills.map(b => ({ id: b.id, data: b.data }));
      renderExpBills();
    });
    // Observe rejection while retaining it for Save, which must not discard bills.
    expWork.ready.catch(err => console.warn('Could not load bill attachments:', err));
  }
}

// Sheet closed: drop bills taken for an entry that was never saved
function endExpSession() {
  if (!expWork.saved) expWork.added.forEach(id => deletePhoto(id));
  try { localStorage.removeItem('ffv2_expdraft'); } catch {}   // closed on purpose: nothing to resume
  expWork = { id: '', bills: [], added: [], removed: [], saved: true };
}

function renderExpBills() {
  q('exp-bills').innerHTML =
    expWork.bills.map(b => `<img class="bill-thumb" src="${esc(b.data)}" alt="Bill photo" role="button" tabindex="0" data-action="bill-view" data-id="${esc(b.id)}">`).join('') +
    `<button type="button" class="bill-add" data-action="bill-cam">${icon('camera', 20)}<span class="t-en">Camera</span><span class="t-mr">कॅमेरा</span></button>` +
    `<button type="button" class="bill-add" data-action="bill-gal">${icon('image', 20)}<span class="t-en">Gallery</span><span class="t-mr">गॅलरी</span></button>`;
}

async function addBillsToSheet(files) {
  const session = expWork;
  session.pending++;
  try {
    await session.ready;
    for (const file of Array.from(files)) {
      const b = await saveBill(session.id, file);
      if (expWork !== session) { await deletePhoto(b.id); continue; }
      session.bills.push(b); session.added.push(b.id);
    }
  } catch (e) { showToast('Could not save that photo. Check storage and try again.', 'error'); }
  finally { session.pending--; if (expWork === session) renderExpBills(); }
}

function viewBill(billId) {
  const b = expWork.bills.find(x => x.id === billId); if (!b) return;
  openLightbox(b.data, async () => {
    const ok = await askSheet({
      title: 'Remove this bill photo? – बिल फोटो काढायचा?',
      actions: [{ label: 'Remove – काढा', value: true, style: 'btn-danger' }]
    });
    if (!ok) return;
    expWork.bills = expWork.bills.filter(x => x.id !== billId);
    expWork.removed.push(billId);
    await closeOverlay();     // the lightbox
    renderExpBills();
  });
}

/* "Snap now, fill later": each photo becomes a draft expense to complete later */
async function snapBills(files) {
  const made = [];
  for (const file of Array.from(files)) {
    const id = uid('EX');
    try {
      const b = await saveBill(id, file);
      const draft = { id, draft: true, createdAt: new Date().toISOString(), evId: defaultEventId(), date: today(),
                      amt: 0, cat: '', head: '', pay: 'paid', mode: '', venId: '', notes: '', billIds: [b.id] };
      await putOne('expenses', draft);
      D.drafts.unshift(draft);
      made.push(draft);
    } catch { showToast('Could not read that photo – फोटो वाचता आला नाही', 'error'); }
  }
  if (!made.length) return;
  refreshCurrent();
  showToast(made.length > 1 ? `${made.length} bills saved — fill in later – ${made.length} बिल जतन, नंतर भरा` : 'Bill saved — fill in later – नंतर भरा', 'success',
    { label: 'Fill now – आता भरा', run: () => openExpModal(made[0]) });
}

async function saveExpense({ next = false } = {}) {
  const session = expWork;
  await session.ready;
  if (expWork !== session) return;
  if (session.pending) { showToast('Please wait for the bill photo to finish saving.', 'error'); return; }
  const pay  = q('exp-pay').dataset.value || 'paid';
  const data = { evId: qv('exp-ev'), amt: qf('exp-amt'), date: qv('exp-date') };
  const base = formBase.exp && formBase.exp.id === expWork.id ? formBase.exp : null;
  if (base?.split) { data.amt = base.amt; data.evId = base.evId; }   // set by the split, not this form
  if (base?.stock) data.evId = '';                                   // common stock moves to an event only through the split
  const { errors } = validate(EXPENSE_RULES, data);
  if (base?.stock) delete errors.evId;
  const venId = qv('exp-vendor').startsWith('__new') ? '' : qv('exp-vendor');
  if (pay === 'credit' && !venId) errors['exp-vendor'] = 'Choose who you owe – कोणाला देणे ते निवडा';
  if (Object.keys(errors).length) {
    // validate() keys errors by field name; map them onto this sheet's inputs
    const map = { evId: 'exp-ev', amt: 'exp-amt', date: 'exp-date' };
    showFieldErrors(Object.fromEntries(Object.entries(errors).map(([k, v]) => [map[k] || k, v])));
    return;
  }

  // The same vendor's bill number already recorded: warn, never block (numbers can repeat across years)
  const billNo = qv('exp-billno').trim().slice(0, 60);
  const dup = billNo && billNo !== (base?.billNo || '') ? duplicateBill(D.expenses, { id: expWork.id, venId, billNo, date: data.date, splitId: base?.split?.id }) : null;
  if (dup) {
    const vn = D.vendors.find(v => v.id === venId)?.name || 'this vendor';
    const again = await askSheet({ title: 'Same bill number – तोच बिल क्रमांक',
      message: `${vn}: bill no. ${billNo} is already recorded on ${fmtDate(dup.date)} for ${fmtCurrency(dup.split?.total ?? dup.amt)}. If it is the same bill, saving it again counts it twice; to put it on more events, open that entry and use Share bill.`,
      actions: [{ label: 'Different bill, save – वेगळे बिल', value: true, style: 'btn-secondary' }] });
    if (!again) return;
  }
  // The event's labour sheet already includes this item (G-14): only save it if it is on top of the sheet
  let additional = !!base?.additional;
  const sheetLine = labourCovers(D.events.find(e => e.id === data.evId), D.expenses, qv('exp-cat'), qv('exp-head'), expWork.id);
  if (sheetLine && !additional) {
    const extra = await askSheet({ title: 'Already in the labour sheet – मजूर यादीत आहे',
      message: `This event's labour sheet already includes ${short(qv('exp-head'))}: ${fmtCurrency(sheetLine.amt)} (contractor's bill). Saving this too counts it twice unless it is on top of that bill.`,
      actions: [{ label: 'It is extra, on top – वेगळा खर्च', value: true, style: 'btn-secondary' }] });
    if (!extra) return;   // nothing saved; the form stays as it was
    additional = true;
  }
  if (!sheetLine) additional = false;
  const record = editedRecord(base, {
    ...(!base && expLogi ? { logi: expLogi } : {}),
    ...(!base && expOrder ? { order: expOrder } : {}),
    id:    expWork.id,
    evId:  data.evId,
    cat:   qv('exp-cat'),
    head:  qv('exp-head'),
    amt:   data.amt,
    date:  data.date,
    pay,
    mode:  pay === 'paid' ? qv('exp-mode') : '',
    venId,
    dueDate: pay === 'credit' ? qv('exp-due') : '',
    notes: qv('exp-notes'),
    ...(billNo ? { billNo } : {}),
    billIds: expWork.bills.map(b => b.id),
    ...(additional ? { additional: true } : {})
  }, ['draft', ...(additional ? [] : ['additional']), ...(billNo ? [] : ['billNo'])]);   // a filled-in bill draft becomes a normal expense

  // One shared bill: vendor, item, date and payment stay the same on every part
  const siblings = base?.split ? splitParts(D.expenses, base.split.id).filter(x => x.id !== record.id).map(s => {
    const { _rev, billNo: _no, ...r } = s;
    return { store: 'expenses', record: { ...r, cat: record.cat, head: record.head, date: record.date, pay: record.pay, mode: record.mode, venId: record.venId, dueDate: record.dueDate, notes: record.notes, ...(billNo ? { billNo } : {}) }, expected: s };
  }) : [];
  await commitChanges([{ store: 'expenses', record, expected: base }, ...siblings, ...expWork.removed.map(id => ({ store: 'photos', id, unchecked: true }))], { check: true, extraStores: ['events', 'vendors'] });
  for (const c of siblings) { const j = D.expenses.findIndex(x => x.id === c.record.id); if (j >= 0) D.expenses[j] = c.record; }
  // A filled-in draft becomes a real expense
  D.drafts = D.drafts.filter(d => d.id !== record.id);
  const i = D.expenses.findIndex(x => x.id === record.id);
  if (i >= 0) D.expenses[i] = record; else D.expenses.push(record);
  expWork.saved = true;
  expLogi = ''; expOrder = '';   // a "+Next" entry answers no reminder or order unless opened from one
  try { localStorage.removeItem('ffv2_expdraft'); } catch {}   // saved: nothing left to resume
  writePref('ffv2_lastexp', { cat: record.cat, head: record.head, mode: record.mode || readPref('ffv2_lastexp', {}).mode });

  refreshCurrent();

  // Say so the moment an entry pushes the event past its expected cost
  const ev = D.events.find(e => e.id === record.evId);
  const pl = ev ? calcEventPL(ev, D.cPays, D.expenses) : null;
  const over = pl && pl.budget && pl.overBudget > 0
    ? `${ev.name} is ${fmtCurrency(pl.overBudget)} over budget – बजेटपेक्षा जास्त` : '';

  if (next) {
    // Keep the event, date, category and payment; clear what changes per entry
    formBase.exp = null;
    q('exp-amt').value = '';
    q('exp-amt').placeholder = '0';
    q('exp-notes').value = '';
    clearFieldErrors();
    startExpSession(null);
    updateExpEvHint();
    q('exp-amt').focus({ preventScroll: true });
    showToast(over ? `Saved · ${over}` : `Saved ${fmtCurrency(record.amt)} · add the next – पुढील खर्च`, over ? 'error' : 'success');
    return;
  }
  closeModals();
  showToast(over ? `Saved · ${over}` : `Expense saved – खर्च नोंदवला`, over ? 'error' : 'success');
}

/* ── CLIENT PAYMENT SHEET ────────────────────────── */
function openCPayModal(evId, payId) {
  const p = payId ? D.cPays.find(x => x.id === payId) : null;
  formBase.cpay = snapshot(p);
  q('cpay-evid').value  = p?.evId || evId;
  q('cpay-id').value    = p?.id || '';
  q('cpay-amt').value   = p?.amt || '';
  q('cpay-date').value  = p?.date || today();
  q('cpay-notes').value = p?.notes || '';
  populateSelect('cpay-mode', PAY_MODES, p?.mode || '');
  q('cpay-mtitle').textContent = p ? 'Edit payment – संपादित करा' : 'Payment received – देयक मिळाले';
  q('btn-del-cpay').hidden = !p;
  clearFieldErrors();
  openSheet('cpay-modal');
  if (!p) q('cpay-amt').focus({ preventScroll: true });
}

async function saveCPay() {
  const evId = qv('cpay-evid');
  const data = { evId, amt: qf('cpay-amt'), date: qv('cpay-date') };
  const { valid, errors } = validate(PAYMENT_RULES, data);
  if (!valid) { showFieldErrors({ 'cpay-amt': errors.amt, 'cpay-date': errors.date }); return; }

  const id = qv('cpay-id');
  const base = id ? formBase.cpay : null;
  const record = editedRecord(base, { id: id || uid('CP'), evId, amt: data.amt, date: data.date, mode: qv('cpay-mode'), notes: qv('cpay-notes') });

  await putChecked('cPays', record, base);
  if (id) D.cPays = D.cPays.map(p => p.id === id ? record : p);
  else    D.cPays.push(record);

  closeModals();
  const ev = D.events.find(e => e.id === evId);
  showToast('Payment saved – देयक जोडले', 'success',
    phoneDigits(ev?.mobile) ? { label: 'Send receipt – पावती', run: () => window.open(receiptLink(ev, record), '_blank', 'noopener') } : null);
  if (phoneDigits(ev?.mobile)) setTimeout(hideToast, 8000);
  refreshCurrent();
}

/* ── VENDOR SHEET ────────────────────────────────── */
function setVenKind(kind) {
  const person = kind === 'person';
  q('ven-kind').dataset.value = kind;
  q('ven-kind').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
  q('ven-kind-hint').hidden = !person;
  q('ven-cat-row').hidden = person;
  q('ven-name-lbl').innerHTML = person ? 'Name – नाव <span class="req">*</span>' : 'Vendor name – विक्रेत्याचे नाव <span class="req">*</span>';
  q('ven-name').placeholder = person ? 'Friend, relative, financier…' : 'Business / supplier name';
  q('btn-save-ven').textContent = person ? 'Save – जतन करा' : 'Save vendor – जतन करा';
}

function openVenModal(id, kind = 'vendor') {
  const vn = id ? D.vendors.find(v => v.id === id) : null;
  formBase.ven = snapshot(vn);
  q('ven-id').value    = vn?.id    || '';
  q('ven-name').value  = vn?.name  || '';
  q('ven-phone').value = vn?.phone || '';
  q('ven-notes').value = vn?.notes || '';
  populateSelect('ven-cat', Object.keys(EXPENSE_HEADS), vn?.cat || (pickVendorForExpense ? qv('exp-cat') : pickVendorForEvent ? 'Operations' : ''));
  loadVenSpecialty(vn?.specialty || (pickVendorForExpense ? qv('exp-head') : pickVendorForEvent ? 'Outsourced Event – आउटसोर्स कार्यक्रम' : ''));
  setVenKind(vn ? (isPerson(vn) ? 'person' : 'vendor') : kind);
  q('ven-mtitle').textContent = vn ? 'Edit – संपादित करा' : kind === 'person' ? 'New person – नवीन व्यक्ती' : 'New vendor – नवीन विक्रेता';
  clearFieldErrors();
  openSheet('ven-modal', () => { pickVendorForExpense = null; pickVendorForEvent = false; });
  if (!vn) q('ven-name').focus({ preventScroll: true });
}

function loadVenSpecialty(selected = '') {
  populateSelect('ven-specialty', EXPENSE_HEADS[qv('ven-cat')] || [], selected);
}

async function saveVendor() {
  const data = { name: qv('ven-name'), phone: qv('ven-phone') };
  const { valid, errors } = validate(VENDOR_RULES, data);
  if (!valid) { showFieldErrors({ 'ven-name': errors.name, 'ven-phone': errors.phone }); return; }

  const id = qv('ven-id');
  const person = q('ven-kind').dataset.value === 'person';
  const base = id ? formBase.ven : null;
  const record = editedRecord(base, { id: id || uid('VN'), name: data.name, cat: person ? '' : qv('ven-cat'), specialty: person ? '' : qv('ven-specialty'),
                   phone: data.phone, notes: qv('ven-notes'), ...(person ? { kind: 'person' } : {}) }, person ? [] : ['kind']);

  await putChecked('vendors', record, base);
  if (id) D.vendors = D.vendors.map(v => v.id === id ? record : v);
  else    D.vendors.push(record);

  // Opened from the expense sheet's "+ New vendor": go back to it with this vendor picked
  const backToExpense = pickVendorForExpense, backToEvent = pickVendorForEvent;
  await closeModals();
  if (backToExpense) populateVendorSelect(record.id);
  if (backToEvent) { fillOutVendors(record.id); updateOutHint(); }
  const openIt = !id && !backToExpense && !backToEvent && CT !== 'vendetail';
  showToast(person ? 'Saved – जतन झाले' : 'Vendor saved – विक्रेता जतन झाला', 'success',
    openIt ? { label: 'Open – उघडा', run: () => showVenDetail(record.id) } : null);
  if (openIt) setTimeout(hideToast, 6000);
  refreshCurrent();
}

/* ── VENDOR PAYMENT SHEET ────────────────────────── */
function openVPayModal(venId, payId, billKey = '') {
  const p  = payId ? D.vPays.find(x => x.id === payId) : null;
  formBase.vpay = snapshot(p);
  const vid = p?.venId || venId;
  const bal = calcVendorBalance(vid, D.expenses, D.vPays).balance;
  // Which bill this pays: the vendor's unpaid bills (leaving this payment out), or oldest first
  const others = D.vPays.filter(x => x.id !== p?.id);
  const bills = unpaidBills(D.expenses, others).filter(b => b.venId === vid);
  const sel = p ? p.billKey || '' : billKey;
  const selBill = bills.find(b => b.key === sel);
  populateSelect('vpay-bill', [{ v: '', l: 'Oldest bills first – जुनी बिले आधी' }, ...bills.map(b => ({ v: b.key,
    l: `${short(b.x.head || b.x.cat)}${b.x.billNo ? ' #' + b.x.billNo : ''} · ${fmtDate(b.x.date)} · ${fmtCurrency(b.left)} left` }))], selBill ? sel : '');
  setVPayKind(p?.kind === 'credit' ? 'credit' : 'pay');
  q('vpay-venid').value = vid;
  q('vpay-id').value    = p?.id || '';
  q('vpay-amt').value   = p?.amt || (selBill ? selBill.left : bal > 0 ? bal : '');
  q('vpay-date').value  = p?.date || today();
  q('vpay-notes').value = p?.notes || '';
  q('vpay-due').textContent = bal > 0 ? `You owe ${fmtCurrency(bal)} – देणे ${fmtCurrency(bal)}` : '';
  populateSelect('vpay-ev', [{ v: '', l: 'No event – कार्यक्रम नाही' }, ...eventOptions()], p?.evId || '');
  populateSelect('vpay-mode', PAY_MODES, p?.mode || '');
  q('vpay-mtitle').textContent = p ? 'Edit payment – संपादित करा'
    : isPerson(D.vendors.find(v => v.id === vid)) ? 'Repay – परत करा' : 'Pay vendor – विक्रेता देयक';
  q('btn-del-vpay').hidden = !p;
  clearFieldErrors();
  openSheet('vpay-modal');
}

// Payment (money paid) or credit note (the vendor lowered what you owe; no money moved)
function setVPayKind(kind) {
  q('vpay-kind').dataset.value = kind;
  q('vpay-kind').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
  q('vpay-mode').closest('.field').hidden = kind === 'credit';
  q('vpay-notes').placeholder = kind === 'credit' ? 'Credit note no. / reason' : 'Reference';
}

async function saveVPay() {
  const venId = qv('vpay-venid');
  const data = { venId, amt: qf('vpay-amt'), date: qv('vpay-date') };
  const { valid, errors } = validate(VPAY_RULES, data);
  if (!valid) { showFieldErrors({ 'vpay-amt': errors.amt, 'vpay-date': errors.date }); return; }

  const id  = qv('vpay-id');
  const base = id ? formBase.vpay : null;
  const credit = q('vpay-kind').dataset.value === 'credit', billKey = qv('vpay-bill');
  if (credit && !qv('vpay-notes').trim()) { showFieldErrors({ 'vpay-notes': 'Write the credit note number or reason – क्रमांक / कारण लिहा' }); return; }
  const record = editedRecord(base, { id: id || uid('VP'), venId, evId: qv('vpay-ev'), cat: base?.cat || '', head: base?.head || '', amt: data.amt, date: data.date,
    mode: credit ? '' : qv('vpay-mode'), notes: qv('vpay-notes'), ...(billKey ? { billKey } : {}), ...(credit ? { kind: 'credit' } : {}) }, [...(billKey ? [] : ['billKey']), ...(credit ? [] : ['kind'])]);

  await putChecked('vPays', record, base);
  if (id) D.vPays = D.vPays.map(p => p.id === id ? record : p);
  else    D.vPays.push(record);

  closeModals();
  showToast(credit ? 'Credit note saved – क्रेडिट नोट जतन' : 'Vendor payment saved – विक्रेता देयक जतन');
  refreshCurrent();
}

/* ── DELETE (with Undo) ──────────────────────────── */
async function deleteRow(type, id) {
  const rec = D[type].find(x => x.id === id); if (!rec) return;
  if (type === 'vendors' && (D.expenses.some(x => x.venId === id) || D.vPays.some(x => x.venId === id))) {
    showToast('This vendor has accounting history. Keep the vendor to preserve balances.', 'error'); return;
  }
  if (type === 'events' && (D.cPays.some(x => x.evId === id) || D.expenses.some(x => x.evId === id) || D.vPays.some(x => x.evId === id))) {
    showToast('This event has accounting history. Remove its entries individually first.', 'error'); return;
  }
  const removed = { [type]: [rec] };
  let photos = [];
  if (type === 'expenses' && rec.split) {
    const parts = splitParts(D.expenses, rec.split.id);
    if (parts.length > 1) {
      const ok = await askSheet({ title: 'Delete shared bill? – वाटलेले बिल हटवायचे?',
        message: `This bill of ${fmtCurrency(rec.split.total)} is shared across ${parts.length} events. It is deleted from all of them (Undo brings it back).`,
        actions: [{ label: 'Delete from all – सर्वांतून हटवा', value: true, style: 'btn-danger' }] });
      if (!ok) return;
      removed.expenses = parts;
    }
  }

  // Events and vendors own other records — say what goes with them, and take it too
  if (type === 'events') {
    removed.cPays    = D.cPays.filter(p => p.evId === id);
    removed.expenses = D.expenses.filter(x => x.evId === id);
    removed.drafts = D.drafts.filter(x => x.evId === id);
    photos = await getPhotosForEvent(id);
  } else if (type === 'vendors') {
    removed.vPays = D.vPays.filter(p => p.venId === id);
  }
  if (type === 'events' || type === 'vendors') {
    const n = (len, w) => len ? `${len} ${w}${len > 1 ? 's' : ''}` : '';
    const billCount = (removed.expenses || []).reduce((s, x) => s + (x.billIds || []).length, 0);
    const extra = [n(removed.cPays?.length, 'payment'), n(removed.expenses?.length, 'expense'),
                   n(removed.vPays?.length, 'payment'), n(photos.length, 'photo'), n(billCount, 'bill photo')].filter(Boolean);
    const ok = await askSheet({
      title: `Delete ${rec.name}? – हटवायचे का?`,
      message: extra.length ? `This also deletes ${extra.join(', ')} recorded for it.` : '',
      actions: [{ label: 'Delete – हटवा', value: true, style: 'btn-danger' }]
    });
    if (!ok) return;
  }

  // Bill photos go with their expenses (and come back with Undo)
  for (const x of [...(removed.expenses || []), ...(removed.drafts || [])]) {
    if ((x.billIds || []).length) photos.push(...await getBillsForExpense(x.id));
  }

  const deletions = Object.entries(removed).flatMap(([store, recs]) => recs.map(r => ({ store: storeOf(store), id: r.id, expected: r })));
  deletions.push(...photos.map(p => ({ store: 'photos', id: p.id, expected: p })));
  await commitChanges(deletions, { check: true });
  for (const [store, recs] of Object.entries(removed)) {
    const ids = new Set(recs.map(r => r.id));
    D[store] = D[store].filter(x => !ids.has(x.id));
  }
  changesChannel?.postMessage('changed');

  // Deleting the record whose page is open → leave that page
  const leaving = (type === 'events' && CT === 'evdetail' && curRef === id) ||
                  (type === 'vendors' && CT === 'vendetail' && curRef === id);
  if (leaving) goBack(type === 'events' ? 'events' : 'vendors');
  else refreshCurrent();

  showToast('Deleted – हटवले', 'success', {
    label: 'Undo – परत',
    run: async () => {
      const restores = Object.entries(removed).flatMap(([store, recs]) => recs.map(record => ({ store: storeOf(store), record, expected: null })));
      restores.push(...photos.map(record => ({ store: 'photos', record, expected: null })));
      await commitChanges(restores, { check: true, extraStores: ['events', 'vendors'] });
      await loadAll(); changesChannel?.postMessage('changed');
      refreshCurrent();
      showToast('Restored – परत आणले');
    }
  });
}

// Delete from inside an edit sheet: close the sheet first, then delete with Undo
async function deleteFromSheet(type, idField) {
  const id = qv(idField);
  await closeOverlay();
  if (id) deleteRow(type, id);
}

/* ── PHOTOS ──────────────────────────────────────── */
function triggerPhoto(evId) {
  pendingPhotoEvId = evId;
  q('photo-input').click();
}

async function handlePhotoInput(files) {
  if (!files.length || !pendingPhotoEvId) return;
  const ev = D.events.find(e => e.id === pendingPhotoEvId); if (!ev) return;

  showLoading(true);
  try {
    const expected = { ...ev };
    const urls = [];
    for (const file of Array.from(files)) urls.push(await readFileAsDataUrl(file));
    const saved = await saveEventPhotos(expected, urls);
    D.events = D.events.map(e => e.id === saved.id ? saved : e);
    changesChannel?.postMessage('changed');
    showToast('Photo added – फोटो जोडला');
    showEvDetail(pendingPhotoEvId, { fromHistory: true });
  } finally {
    showLoading(false);
    q('photo-input').value = '';
  }
}

function readFileAsDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result);
    r.onerror = () => rej(new Error('Read failed'));
    r.readAsDataURL(file);
  });
}

// Full-screen photo; onDelete (optional) runs when its Delete button is tapped
function openLightbox(src, onDelete) {
  lbOnDelete = onDelete || null;
  q('lb-delete').hidden = !onDelete;
  q('lb-img').src = src;
  q('lightbox').style.display = 'flex';
  q('lightbox').classList.add('active');
  openOverlay(() => { q('lightbox').style.display = 'none'; q('lightbox').classList.remove('active'); lbOnDelete = null; });
}

function openEventPhoto(evId, photoId) {
  const photos = document.querySelectorAll(`[data-action="lightbox"][data-evid="${CSS.escape(evId)}"]`);
  const ids    = Array.from(photos).map(p => p.dataset.photoid);
  const idx    = ids.indexOf(photoId);
  lightboxState = { evId, photoIds: ids, idx: Math.max(0, idx) };
  const src = photos[lightboxState.idx]?.src;
  if (src) openLightbox(src, deleteCurrentPhoto);
}

async function deleteCurrentPhoto() {
  const { evId, photoIds, idx } = lightboxState;
  const photoId = photoIds[idx];
  const ok = await askSheet({
    title: 'Delete photo? – फोटो हटवायचा का?',
    message: 'This cannot be undone.',
    actions: [{ label: 'Delete – हटवा', value: true, style: 'btn-danger' }]
  });
  if (!ok) return;
  const ev = D.events.find(e => e.id === evId);
  if (!ev) throw new Error('Event was removed. Refresh before changing its photos.');
  const record = { ...ev, photoIds: (ev.photoIds || []).filter(id => id !== photoId) };
  await commitChanges([{ store: 'events', record, expected: ev }, { store: 'photos', id: photoId, unchecked: true }], { check: true });
  D.events = D.events.map(e => e.id === evId ? record : e);
  changesChannel?.postMessage('changed');
  await closeOverlay();
  showToast('Photo deleted – फोटो हटवला');
  showEvDetail(evId, { fromHistory: true });
}

/* ── LINK EXPENSES TO VENDOR ─────────────────────── */
function openLinkModal(venId) {
  const vn = D.vendors.find(v => v.id === venId); if (!vn) return;
  const unlinked = D.expenses.filter(x => !x.venId);
  if (!unlinked.length) { showToast('No unlinked expenses – न जोडलेले खर्च नाही'); return; }

  q('link-ven-id').value = venId;
  q('link-exp-list').innerHTML = unlinked.map(x => {
    const ev       = D.events.find(e => e.id === x.evId);
    const sameSpec = vn.specialty && x.head === vn.specialty;
    const sameCat  = x.cat === vn.cat;
    return `<label class="check-row">
      <input type="checkbox" value="${esc(x.id)}" ${sameSpec ? 'checked' : ''}>
      <div style="flex:1;min-width:0">
        <div class="title-sm">${esc(x.head)}</div>
        <div class="meta"><span data-nl>${esc(ev?.name || '—')}</span> · ${fmtDate(x.date)} · ${fmtCurrency(x.amt)}</div>
        <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap">
          <span class="chip ${sameCat ? 'info' : ''}">${esc(x.cat)}</span>
          ${sameSpec ? `<span class="chip pos">${tr('Matches', 'जुळते')}</span>` : ''}
        </div>
      </div>
    </label>`;
  }).join('');
  openSheet('link-modal');
}

async function saveLinkExpenses() {
  const venId   = qv('link-ven-id');
  const checked = [...document.querySelectorAll('#link-exp-list input[type=checkbox]:checked')].map(cb => cb.value);
  if (!checked.length) { showToast('Select an expense – खर्च निवडा', 'error'); return; }

  const edits = checked.map(id => D.expenses.find(e => e.id === id)).filter(Boolean).map(expected => ({
    store: 'expenses', expected, record: { ...expected, venId, pay: expected.pay || 'paid' }
  }));
  await commitChanges(edits, { check: true, extraStores: ['events', 'vendors'] });
  await loadAll();
  closeModals();
  showToast(`${checked.length} expense${checked.length > 1 ? 's' : ''} linked – जोडले`);
  refreshCurrent();
}

/* ── EXPORT / IMPORT ─────────────────────────────── */
// Opens the phone's share sheet (WhatsApp, Drive, email…) so the backup leaves the
// phone; where sharing files isn't supported (most desktops) it downloads instead.
const MAX_BACKUP_BYTES = 300 * 1024 * 1024;
// Settings that travel with a backup (G-15). Per-device choices (error-report consent, PIN, drafts) do not.
const BACKUP_PREFS = ['ffv2_theme', 'ffv2_lang', 'ffv2_period', 'ffv2_lastexp'];
function backupPrefs() {
  const prefs = {};
  for (const k of BACKUP_PREFS) { try { const v = localStorage.getItem(k); if (v !== null) prefs[k] = v; } catch {} }
  return prefs;
}
function restorePrefs(prefs) {
  if (!prefs || typeof prefs !== 'object') return;
  for (const k of BACKUP_PREFS) if (typeof prefs[k] === 'string' && prefs[k].length < 2000) { try { localStorage.setItem(k, prefs[k]); } catch {} }
  if (['light', 'dark'].includes(prefs.ffv2_theme)) applyTheme(prefs.ffv2_theme);
  if (typeof prefs.ffv2_lang === 'string') { try { setLang(prefs.ffv2_lang); } catch {} }
  period = readPref('ffv2_period', period);
  syncSettingsUI();
}

async function exportData() {
  if (!launched || q('pin-screen').classList.contains('active')) { showToast('Unlock the app before exporting.', 'error'); return; }
  let file, text;
  showLoading(true);
  try {
    const payload = { ...await exportAllData(), prefs: backupPrefs() };
    text = JSON.stringify(payload);
    file = new File([text], `caterdesk-backup-${today()}.json`, { type: 'application/json' });
  } finally { showLoading(false); }

  // The share menu always gets the .txt copy (same content; CaterDesk imports both). Android Chrome says it
  // can share a .json file (canShare is true) but then refuses it with "Permission denied", because .json is
  // not on its list of shareable file types; .txt is. Building a backup with photos takes longer than Android allows
  // between a tap and opening the share sheet, so the user picks where it goes with a fresh tap here.
  let how = 'download', refused = '';
  const asText = new File([text], `caterdesk-backup-${today()}.txt`, { type: 'text/plain' });
  const shareable = navigator.canShare?.({ files: [asText] }) ? asText : null;
  if (shareable) {
    const size = file.size > 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.ceil(file.size / 1024)} KB`;
    // The share menu is opened inside the Share tap itself; opening it after the sheet closes is refused on Android
    const why = e => ({ refused: `${e?.name || 'Error'}${e?.message ? ': ' + String(e.message).slice(0, 120) : ''}` });
    const share = () => {
      try { return navigator.share({ files: [shareable], title: 'CaterDesk backup', text: `CaterDesk backup ${fmtDate(today())}` }).then(() => 'shared', e => e?.name === 'AbortError' ? 'aborted' : why(e)); }
      catch (e) { return Promise.resolve(why(e)); }
    };
    const where = await askSheet({
      title: 'Backup ready – बॅकअप तयार',
      message: `${size}. Save it outside this phone too, e.g. in Google Drive.`,
      actions: [
        { label: 'Share – Drive, Files, WhatsApp – पाठवा', run: share, style: 'btn-primary' },
        { label: 'Save to phone (Downloads) – फोनवर जतन', value: 'download', style: 'btn-secondary' }
      ]
    });
    const outcome = await where;
    if (!outcome || outcome === 'aborted') return;   // cancelled or closed the share menu: nothing was saved
    if (outcome === 'shared') how = 'shared';
    else if (outcome.refused) refused = outcome.refused;   // phone refused: save to Downloads and say why
  }
  if (how === 'download') {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  lastExport = new Date().toISOString();
  await setMeta('last_export', lastExport);
  const size = file.size > 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.ceil(file.size / 1024)} KB`;
  showToast(how === 'shared' ? `Backup shared (${size}) – बॅकअप पाठवला`
    : refused ? `The phone did not open the share menu (${refused}). Backup saved to Downloads (${size}).` : `Backup saved to Downloads (${size}) – बॅकअप जतन`, refused ? 'error' : 'success');
  if (CT === 'home') rHome();
}

async function handleImport(file) {
  if (!launched || q('pin-screen').classList.contains('active')) return;
  if (!file) return;
  // Bounded read (G-28): a backup with many bill photos is a few hundred MB at most
  if (file.size > MAX_BACKUP_BYTES) { showToast('This file is too large to be a CaterDesk backup. Your data was not changed.', 'error'); q('import-input').value = ''; return; }
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      let payload;
      try { payload = JSON.parse(e.target.result); }
      catch { throw new Error('This file is not a CaterDesk backup, or it is cut off. Your data was not changed.'); }
      const info = await inspectBackup(payload);   // throws a plain-language reason; nothing is changed
      const c = info.counts;
      const made = info.exportedAt ? `Made ${fmtDate(info.exportedAt.slice(0, 10))}${info.appVersion ? ` · CaterDesk v${info.appVersion}` : ''}` : 'Older backup';
      const counts = `${c.events} events · ${c.expenses} expenses · ${c.cPays} client payments · ${c.vendors} vendors · ${c.vPays} vendor payments · ${c.photos} photos`;
      const check = info.verified ? '✓ Checked: complete and undamaged' : 'Made by an older version: it cannot be checked for damage, but every record is still validated before import.';
      const mode = await askSheet({
        title: 'Import backup – आयात',
        message: `${made}\n${counts}\n${check}\n\nMerge keeps your current data. Replace deletes it first.`,
        actions: [
          { label: 'Merge – जोडा', value: 'merge', style: 'btn-primary' },
          { label: 'Replace all data – सर्व बदला', value: 'replace', style: 'btn-danger' }
        ]
      });
      if (!mode) return;

      showLoading(true);
      await importAllData(payload, mode);
      if (mode === 'replace') restorePrefs(payload.prefs);   // merge keeps this phone's settings
      await loadAll();
      changesChannel?.postMessage('changed');
      go('home');
      renderPage('home');
      showToast('Imported – आयात झाली');
    } catch (err) {
      showToast(err.message || 'Import failed. Existing data was kept. – आयात अयशस्वी', 'error');
      console.error(err);
    } finally {
      showLoading(false);
      q('import-input').value = '';
    }
  };
  reader.readAsText(file);
}

/* ── SETTINGS PANEL ──────────────────────────────── */
function openDrawer() {
  const days = lastExport ? daysSince(lastExport.slice(0, 10)) : null;
  q('backup-meta').textContent = days === null ? '· never' : days === 0 ? '· today' : `· ${days}d ago`;
  q('drawer').classList.add('active');
  q('drawer-toggle').setAttribute('aria-expanded', 'true');
  openOverlay(() => {
    q('drawer').classList.remove('active');
    q('drawer-toggle').setAttribute('aria-expanded', 'false');
  });
}

/* ── EVENT BINDING ───────────────────────────────── */
function bindAllEvents() {
  // Delegated click handler for the entire body
  document.body.addEventListener('click', async e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    e.stopPropagation();
    const action = el.dataset.action;
    const id     = el.dataset.id;

    switch (action) {
      case 'go':           go(id); break;
      case 'quick':
        // All three open right here: cancelling leaves you where you were; saving offers "Open"
        if (id === 'event')   openEvModal();
        if (id === 'expense') openExpModal();
        if (id === 'vendor')  openVenModal();
        break;
      case 'close-modal':
      case 'close-lightbox': closeOverlay(); break;
      case 'evdetail':     showEvDetail(id); break;
      case 'vendetail':    showVenDetail(id); break;
      case 'open-cpay':    openCPayModal(id); break;
      case 'open-exp':     openExpModal(id); break;
      case 'open-vpay':    openVPayModal(id, null, el.dataset.bill || ''); break;
      case 'menu-edit':    openMenuModal(); break;
      case 'lab-edit':     openLabModal(); break;
      case 'dish-assign':  assignDish(Number(id)); break;
      case 'order-new':    openOrderModal({ head: id }); break;
      case 'order-status': orderAction(id); break;
      case 'recon-open':   openReconModal(); break;
      case 'plan-edit':    openPlanModal(); break;
      case 'count-open':   openCountModal(); break;
      case 'count-policy-save': saveCountPolicy(); break;
      case 'fs-open':  openFunctionSheet(); break;
      case 'settle-open': openSettle(); break;
      case 'settle-adjust': case 'settle-dispute': case 'settle-undispute': settleAction(action); break;
      case 'fs-save':  saveFunctionSheet(); break;
      case 'fs-share': shareFunctionSheet(); break;
      case 'fs-copy':  copyFunctionSheet(); break;
      case 'count-save': case 'count-request': case 'count-accept': case 'count-bill': countAction(action, id); break;
      case 'venue-fill':   useVenueOffer(); break;
      case 'logi-add': {
        const ev = D.events.find(e => e.id === curRef), p = ev && logisticsPrompts(ev, D.expenses)[Number(id)];
        if (p) openExpModal({ prefill: { evId: ev.id, cat: p.cat, head: p.head, logi: p.key } });
        break;
      }
      case 'recon-reopen': reopenRecon(); break;
      case 'check-add': {
        const it = CHECKLIST[Number(id)];
        if (it) openExpModal({ prefill: { evId: curRef, cat: it.cat, head: it.head, venId: it.venId, amt: it.amt } });
        break;
      }
      case 'open-link':    openLinkModal(id); break;
      case 'edit-exp':     openExpModal(D.expenses.find(x => x.id === id)); break;
      case 'edit-cpay':    openCPayModal(null, id); break;
      case 'edit-vpay':    openVPayModal(null, id); break;
      case 'add-photo':    triggerPhoto(id); break;
      case 'lightbox':     openEventPhoto(el.dataset.evid, el.dataset.photoid); break;
      // Bill photos: the file picker must open inside the tap itself
      case 'snap':         billTarget = 'snap';  q('bill-cam').click(); break;
      case 'bill-cam':     billTarget = 'sheet'; q('bill-cam').click(); break;
      case 'bill-gal':     billTarget = 'sheet'; q('bill-gal').click(); break;
      case 'bill-view':    viewBill(id); break;
      case 'fill-draft':   openExpModal(D.drafts.find(d => d.id === id)); break;
      case 'open-ev-edit': openEvModal(curRef); break;
      case 'open-ven-edit': openVenModal(id); break;
      case 'delete':       await deleteRow(el.dataset.type, id); break;
      case 'export':       exportData(); break;
      case 'period':       period = id; writePref('ffv2_period', id); renderPage(CT); break;
      case 'ev-filter':    F.ev = id; rEvents(); break;
      case 'exp-filter': expensePage = 1; F.exp = id; rExp(); break;
      case 'expense-prev': expensePage--; rExp(); window.scrollTo(0, 0); break;
      case 'expense-next': expensePage++; rExp(); window.scrollTo(0, 0); break;
    }
  });

  // Close sheets on backdrop tap
  document.querySelectorAll('.modal-ov').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) closeOverlay(); });
  });

  // Phone Back button / gesture


  // Keyboard: Enter/Space on role=button cards, Escape closes the top overlay
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlays.length) { closeOverlay(); return; }
    const el = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && el.getAttribute?.('role') === 'button') {
      e.preventDefault();
      el.click();
    }
  });

  // Header hairline once content scrolls under it…
  // …and, on detail pages, the name fades into the header once its card scrolls away
  const hdr = q('hdr');
  window.addEventListener('scroll', () => {
    hdr.classList.toggle('scrolled', window.scrollY > 4);
    hdr.classList.toggle('past', window.scrollY > 64);
  }, { passive: true });

  // Header actions
  q('hdr-back').addEventListener('click', () => goBack(CT === 'vendetail' ? 'vendors' : 'events'));
  q('hdr-edit').addEventListener('click', () => {
    if (CT === 'evdetail')  openEvModal(curRef);
    if (CT === 'vendetail') openVenModal(curRef);
  });
  q('hdr-delete').addEventListener('click', () => {
    if (CT === 'evdetail')  deleteRow('events', curRef);
    if (CT === 'vendetail') deleteRow('vendors', curRef);
  });

  // Search boxes filter as you type
  q('ev-q').addEventListener('input', e => { F.evQ = e.target.value.trim(); rEvents(); });
  q('exp-q').addEventListener('input', e => { expensePage = 1; F.expQ = e.target.value.trim(); rExp(); });
  q('ven-q').addEventListener('input', e => { F.venQ = e.target.value.trim(); rVen(); });

  ['fs-timings', 'fs-setup'].forEach(id => q(id).addEventListener('input', renderFunctionSheet));
  // Photo / import inputs
  q('photo-input').addEventListener('change', function () { handlePhotoInput(this.files); });
  ['bill-cam', 'bill-gal'].forEach(inputId => q(inputId).addEventListener('change', async function () {
    const files = [...this.files];
    this.value = '';
    if (!files.length) return;
    if (billTarget === 'snap') snapBills(files); else addBillsToSheet(files);
  }));
  q('import-input').addEventListener('change', function () { handleImport(this.files[0]); });

  // Expense sheet controls
  q('exp-cats').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]'); if (b) { expTouched.item = true; setExpCat(b.dataset.cat); }
  });
  q('exp-pay').addEventListener('click', e => {
    const b = e.target.closest('[data-pay]'); if (b) { expTouched.pay = true; setExpPay(b.dataset.pay); }
  });
  ['input', 'change', 'click'].forEach(t => q('exp-modal').addEventListener(t, () => setTimeout(saveExpSnapshot, 0)));
  q('exp-due-chips').addEventListener('click', e => {
    const b = e.target.closest('[data-due]'); if (!b) return;
    setExpDue(b.dataset.due === '' ? '' : addDays(today(), Number(b.dataset.due)));
  });
  q('exp-due').addEventListener('change', e => setExpDue(e.target.value));
  q('exp-ev').addEventListener('change', updateExpEvHint);
  q('exp-head').addEventListener('change', () => { expTouched.item = true; populateVendorSelect(qv('exp-vendor')); });
  // Tapping a usual-vendor button picks that vendor (tap again to clear)
  q('exp-ven-quick').addEventListener('click', e => {
    const b = e.target.closest('[data-ven]'); if (!b) return;
    const sel = q('exp-vendor');
    sel.value = sel.value === b.dataset.ven ? '' : b.dataset.ven;
    sel.dataset.prev = sel.value;
    renderVendorQuick();
  });
  q('exp-vendor').addEventListener('change', e => {
    const v = e.target.value;
    if (!v.startsWith('__new')) { e.target.dataset.prev = v; if (v) applyVendorHabits(v); renderVendorQuick(); return; }
    e.target.value = e.target.dataset.prev || '';
    pickVendorForExpense = true;
    openVenModal(null, v === '__newperson' ? 'person' : 'vendor');
  });

  // Sheet buttons
  q('btn-save-event').addEventListener('click', () => runSave('event', saveEvent));
  q('btn-save-menu').addEventListener('click', () => runSave('menu', saveMenu));
  q('btn-save-lab').addEventListener('click', () => runSave('labour', saveLabour));
  q('btn-lab-add').addEventListener('click', () => {
    labRows.push(newWorkerRow(LAB_ROLES().find(h => !labRows.some(r => r.role === h)) || LAB_ROLES()[0]));
    renderLabRows();
  });
  q('btn-lab-extra').addEventListener('click', () => {
    const extra = ['travel', 'fee', 'other'].find(x => !labRows.some(r => isExtra(r) && r.extra === x)) || 'other';
    labRows.push({ id: uid('LB'), kind: 'x', extra, label: '', count: 1, rate: lastLabourRate('', extra) });
    renderLabRows();
  });
  q('btn-lab-copy').addEventListener('click', e => {
    const from = D.events.find(x => x.id === e.currentTarget.dataset.from);
    labRows = (from?.labour?.rows || []).map(r => ({ ...labRow(r), id: uid('LB') }));
    if (from?.labour) { setLabPay(from.labour.pay || 'paid'); q('lab-mode').value = from.labour.mode || q('lab-mode').value; q('lab-ven').value = from.labour.venId || ''; }
    renderLabRows();
  });
  q('lab-bill').addEventListener('input', updateLabTotal);
  q('lab-pay').addEventListener('click', e => { const b = e.target.closest('[data-pay]'); if (b) setLabPay(b.dataset.pay); });
  // Row edits: picking a type or shift fills the rate you used last time (if the rate is empty)
  q('lab-rows').addEventListener('input', e => {
    const box = e.target.closest('[data-lab]'), k = e.target.dataset.k; if (!box || !k) return;
    const r = labRows[Number(box.dataset.lab)];
    const num = e.target.value === '' ? '' : Number(e.target.value);
    if (k.startsWith('c-')) r.counts = { ...r.counts, [k.slice(2)]: num };   // headcount for one shift
    else r[k] = ['role', 'extra', 'label'].includes(k) ? e.target.value : num;
    if (['role', 'extra'].includes(k) && !r.rate) {
      r.rate = isExtra(r) ? lastLabourRate('', r.extra) : lastLabourRate(r.role);
      box.querySelector('[data-k="rate"]').value = r.rate || '';
    }
    const filled = isExtra(r) ? r.count && r.rate : heads(r) && r.rate;
    q('lab-rows').querySelector(`[data-lab-line="${box.dataset.lab}"]`).textContent = filled ? lineText(r) : '';
    updateLabTotal();
  });
  q('lab-rows').addEventListener('click', e => {
    const b = e.target.closest('[data-lab-del]'); if (!b) return;
    labRows.splice(Number(b.dataset.labDel), 1); renderLabRows();
  });
  q('btn-send-ord').addEventListener('click', () => runSave('order', sendOrder));
  q('btn-cancel-ord').addEventListener('click', () => runSave('order', cancelOrderFromSheet));
  q('btn-save-exp').addEventListener('click', () => runSave('expense', () => saveExpense()));
  q('btn-save-exp-next').addEventListener('click', () => runSave('expense', () => saveExpense({ next: true })));
  q('btn-del-exp').addEventListener('click', () =>
    deleteFromSheet(D.drafts.some(d => d.id === qv('exp-id')) ? 'drafts' : 'expenses', 'exp-id'));
  q('btn-save-cpay').addEventListener('click', () => runSave('cpay', saveCPay));
  q('btn-del-cpay').addEventListener('click', () => deleteFromSheet('cPays', 'cpay-id'));
  q('btn-save-ven').addEventListener('click', () => runSave('vendor', saveVendor));
  q('btn-save-vpay').addEventListener('click', () => runSave('vpay', saveVPay));
  q('btn-del-vpay').addEventListener('click', () => deleteFromSheet('vPays', 'vpay-id'));
  q('vpay-kind').addEventListener('click', e => { const b = e.target.closest('[data-kind]'); if (b) setVPayKind(b.dataset.kind); });
  q('btn-save-link').addEventListener('click', () => runSave('link', saveLinkExpenses));

  // Settings panel / FAB
  q('drawer-toggle').addEventListener('click', openDrawer);
  q('drawer-bg').addEventListener('click', () => closeOverlay());
  q('fab').addEventListener('click', () => FAB[CT]?.run());

  // Bottom nav
  TOP_TABS.forEach(id => q('n-' + id).addEventListener('click', () => go(id)));

  // Dependent select
  q('ven-cat').addEventListener('change', () => loadVenSpecialty());
  q('ev-menu').addEventListener('change', updateMenuHint);
  q('ev-billing').addEventListener('input', updateQuote);
  q('ev-type').addEventListener('change', updateQuote);
  document.querySelectorAll('[data-contact]').forEach(b => {
    b.hidden = !canPickContact;
    b.addEventListener('click', () => b.dataset.contact === 'ev' ? pickContact('ev-name', 'ev-mobile') : pickContact('ven-name', 'ven-phone'));
  });
  // Meals toggle on and off; turning Lunch on also turns Breakfast on (banquet lunches include it)
  q('ev-meals').addEventListener('click', e => {
    const b = e.target.closest('[data-meal]'); if (!b) return;
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    if (on && b.dataset.meal === 'lunch') q('ev-meals').querySelector('[data-meal="breakfast"]').setAttribute('aria-pressed', 'true');
    renderMealPlan(readMealPlan());
  });
  q('ev-handling').addEventListener('click', e => { const b = e.target.closest('[data-h]'); if (b) setEvHandling(b.dataset.h); });
  q('ev-out-ven').addEventListener('change', e => {
    if (e.target.value !== '__new') { e.target.dataset.prev = e.target.value; return; }
    e.target.value = e.target.dataset.prev || '';
    pickVendorForEvent = true;
    openVenModal();
  });
  // 4. expenses of one event
  q('exp-ev-filter').addEventListener('change', e => { expensePage = 1; F.expEv = e.target.value; rExp(); });
  // 2. refresh: header button, and pull down at the top of a page
  q('hdr-refresh').addEventListener('click', () => refreshNow());
  initPullToRefresh();
  ['ev-billing', 'ev-out-charge'].forEach(id => q(id).addEventListener('input', updateOutHint));
  q('ev-guests').addEventListener('input', updateMenuHint);
  q('ven-kind').addEventListener('click', e => { const b = e.target.closest('[data-kind]'); if (b) setVenKind(b.dataset.kind); });

  // Settings
  document.querySelectorAll('[data-theme-set]').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.themeSet)));
  document.querySelectorAll('[data-lang-set]').forEach(b => b.addEventListener('click', () => { setLang(b.dataset.langSet); syncSettingsUI(); }));
  document.querySelectorAll('[data-diag-set]').forEach(b => b.addEventListener('click', () => { writePref('ffv2_diagnostics', b.dataset.diagSet === 'on'); syncSettingsUI(); }));
  // Sharing must start within the tap, so begin the backup first, then close the panel
  q('btn-export').addEventListener('click', () => { exportData(); closeOverlay(); });
  q('recon-checks').addEventListener('change', updateReconSave);
  let menuTimer;
  q('menu-text').addEventListener('input', () => { clearTimeout(menuTimer); menuTimer = setTimeout(readMenuText, 300); });
  q('menu-review').addEventListener('change', e => { const s = e.target.closest('[data-md]'); if (!s) return;
    const d = menuDraft[Number(s.dataset.md)]; if (!d) return; d[s.dataset.k] = s.value; if (s.dataset.k === 'head') d.manual = true; });
  q('menu-review').addEventListener('click', e => { const b = e.target.closest('[data-md-del]'); if (!b) return;
    menuDraft.splice(Number(b.dataset.mdDel), 1); q('menu-text').value = menuDraft.map(d => d.name).join('\n'); renderMenuReview(); });
  q('ev-mp-rows').addEventListener('input', updateMealPlan);
  q('plan-rows').addEventListener('input', e => { const row = e.target.closest('[data-pm]'), k = e.target.dataset.k; if (!row || !k) return;
    const m = planDraft[Number(row.dataset.pm)]; if (k === 'amt') m.amtRaw = e.target.value; else m[k] = e.target.value; updatePlanSum(); });
  q('plan-rows').addEventListener('change', e => { const row = e.target.closest('[data-pm]'); if (!row || e.target.dataset.k !== 'when') return;
    const m = planDraft[Number(row.dataset.pm)]; m.amtRaw = row.querySelector('[data-k="amt"]').value; m.when = e.target.value; renderPlanRows(); });
  q('plan-rows').addEventListener('click', e => { const b = e.target.closest('[data-pm-del]'); if (!b) return; planDraft.splice(Number(b.dataset.pmDel), 1); renderPlanRows(); });
  q('btn-plan-add').addEventListener('click', () => { planDraft.push({ id: uid('PM'), label: '', when: 'date', amt: '' }); renderPlanRows(); });
  q('btn-save-plan').addEventListener('click', savePlan);
  q('btn-share-exp').addEventListener('click', openSplitModal);
  q('count-meals').addEventListener('click', e => { const b = e.target.closest('[data-count-meal]'); if (!b) return; countMeal = b.dataset.countMeal; renderCount(); });
  q('split-rows').addEventListener('input', e => { const row = e.target.closest('[data-sp]'), k = e.target.dataset.k; if (!row || !k) return;
    splitDraft.rows[Number(row.dataset.sp)][k] = e.target.value; updateSplitSum(); });
  q('split-rows').addEventListener('change', e => { const row = e.target.closest('[data-sp]'); if (row && e.target.dataset.k === 'evId') splitDraft.rows[Number(row.dataset.sp)].evId = e.target.value; });
  q('split-rows').addEventListener('click', e => { const b = e.target.closest('[data-sp-del]'); if (!b) return; splitDraft.rows.splice(Number(b.dataset.spDel), 1); renderSplitRows(); });
  q('btn-split-add').addEventListener('click', () => { splitDraft.rows.push({ evId: '', amt: '' }); renderSplitRows(); });
  q('btn-split-equal').addEventListener('click', () => { const parts = equalSplit(splitDraft.total, splitDraft.rows.length); splitDraft.rows.forEach((r, i) => { r.amt = parts[i]; }); renderSplitRows(); });
  q('btn-save-split').addEventListener('click', saveSplit);
  for (const id of ['ord-takeup', 'ord-min', 'ord-plates']) q(id).addEventListener('input', updateCounterPlan);
  q('ev-type').addEventListener('change', syncEvTypeFields);
  q('ev-vtype').addEventListener('change', () => { syncEvTypeFields(); updateVenueHint(); });
  q('ev-venue').addEventListener('change', updateVenueHint);
  q('ev-locality').addEventListener('input', updateVenueHint);
  q('btn-save-recon').addEventListener('click', saveRecon);
  // File picker must open inside the tap itself, so click first, then close the panel
  q('btn-import').addEventListener('click', () => { q('import-input').click(); closeOverlay(); });
  q('btn-set-pin').addEventListener('click', async () => { await closeOverlay(); showPinScreen('set'); });
  q('btn-remove-pin').addEventListener('click', async () => { await closeOverlay(); removePin(); });

  // Lightbox
  q('lb-delete').addEventListener('click', () => lbOnDelete?.());
  q('lightbox').addEventListener('click', e => { if (e.target === q('lightbox')) closeOverlay(); });
}

// The PIN screen exists before launchApp() binds everything else
function bindPinScreen() {
  document.querySelectorAll('.pin-key').forEach(key => {
    key.addEventListener('click', () => pinKey(key.dataset.val));
  });
  q('pin-alt').addEventListener('click', async () => {
    await askSheet({ title: 'Forgot PIN? – पिन विसरलात?',
      message: 'For privacy, this screen cannot remove your PIN. Your records remain on this device. A previously exported backup can be imported in a separate browser profile. Do not clear this app or browser data.',
      actions: [{ label: 'Keep my data – माहिती सुरक्षित ठेवा', value: true, style: 'btn-primary' }] });
  });
}

window.FF = { exportData };
navigator.storage?.persist?.().then(granted => { if (!granted) console.info('Storage is best effort; keep an off-device backup.'); }).catch(() => {});

bindPinScreen();
boot();
