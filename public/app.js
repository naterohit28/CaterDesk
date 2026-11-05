/**
 * app.js — CaterDesk v2
 * UI logic: rendering, sheets, navigation, events
 * Imports from db.js, utils.js, icons.js and i18n.js
 */

import {
  getAll, putOne, putChecked, commitChanges, deleteOne, getMeta, setMeta,
  savePhoto, saveEventPhotos, getPhotosForEvent, deletePhoto, saveBill, getBillsForExpense,
  exportAllData, importAllData, checkAndMigrate
} from './db.js';

import {
  EXPENSE_HEADS, EVENT_TYPES, PAY_MODES, SEED_DATA, PERIODS, MENUS, menuById, menuRate, menuCostPerPlate, costChecklist,
  uid, today, daysSince, fmtDate, fmtCurrency, esc,
  validate, EVENT_RULES, EXPENSE_RULES, PAYMENT_RULES, VENDOR_RULES, VPAY_RULES,
  calcEventReceived, calcEventPL, calcVendorBalance, isOnCredit, isPerson, unpaidCredit, daysUntil, addDays,
  sliceByPeriod, eventsMissingCosts, costByCategory, costVsUsual, priceCreep, parseMenu, dishCounter, learnedDishes,
  generateInsights, isOverdue, hashPin, verifyPin, isLegacyPinHash
} from './utils.js';

import { icon, hydrateIcons, CAT_ICON } from './icons.js';
import { initLang, getLang, setLang } from './i18n.js';

// Shown in Settings; bump with each release so the phone can confirm which code it runs
const APP_BUILD = '4.0.0';

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
    await seedIfEmpty();
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

async function seedIfEmpty() {
  if (D.events.length > 0) return;
  const s = SEED_DATA;
  await Promise.all([
    ...s.events.map(r => putOne('events', r)),
    ...s.cPays.map(r => putOne('cPays', r)),
    ...s.expenses.map(r => putOne('expenses', r)),
    ...s.vendors.map(r => putOne('vendors', r)),
    ...s.vPays.map(r => putOne('vPays', r))
  ]);
  await loadAll();
}

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
function showToast(msg, type = 'success', action = null) {
  const t   = q('toast');
  const btn = q('toast-action');
  q('toast-ic').innerHTML = icon(type === 'error' ? 'alert' : 'check', 18);
  q('toast-msg').textContent = msg;
  t.className = 'show ' + type + (action ? ' has-action' : '');
  btn.textContent = action ? action.label : '';
  btn.onclick = action ? () => { hideToast(); action.run(); } : null;
  clearTimeout(t._t);
  t._t = action ? null : setTimeout(hideToast, type === 'error' ? 10000 : 4000);
}

function hideToast() {
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
  expenses:  { en: 'Add expense', mr: 'खर्च जोडा',      run: () => openExpModal(F.expEv || undefined) },
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
  const tb = P.events.reduce((s, e) => s + e.billing, 0);
  const te = P.expenses.reduce((s, x) => s + x.amt, 0);
  const rc = P.cPays.reduce((s, p) => s + p.amt, 0);
  const profit  = tb - te;
  const pending = Math.max(0, tb - rc);
  const margin  = tb > 0 ? Math.round(profit / tb * 100) : 0;
  const collected = tb > 0 ? Math.min(100, rc / tb * 100) : 0;
  const pl = periodLabel();

  q('kpi').innerHTML = `
    <div class="card hero">
      <div class="label">${tr(`Net profit · ${pl.en}`, `निव्वळ नफा · ${pl.mr}`)}</div>
      <div class="amt-xl ${profit < 0 ? 'neg' : ''}" style="margin-top:4px">${fmtCurrency(profit)}</div>
      <div class="hero-sub">${P.events.length ? tr(
        `${margin}% margin on ${fmtCurrency(tb)} billed · ${P.events.length} event${P.events.length > 1 ? 's' : ''}`,
        `${fmtCurrency(tb)} बिलावर ${margin}% मार्जिन · ${P.events.length} कार्यक्रम`)
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
          <div>${tr('These events have no expenses yet, so their profit is overstated.', 'या कार्यक्रमांचा खर्च नोंदवलेला नाही, त्यामुळे नफा जास्त दिसतो.')}</div></div>
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
    .map(e => ({ ...e, _p: e.billing - calcEventReceived(e.id, D.cPays), _late: isOverdue(e) }))
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
        ${e._late
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

// "4 vendors, 1 person" — who the unpaid credit is owed to
function payeeCount(items) {
  const ids = [...new Set(items.map(u => u.x.venId))];
  const people = ids.filter(id => isPerson(D.vendors.find(v => v.id === id))).length;
  const vendors = ids.length - people;
  return [vendors ? `${vendors} vendor${vendors > 1 ? 's' : ''}` : '', people ? `${people} ${people > 1 ? 'people' : 'person'}` : ''].filter(Boolean).join(', ');
}

// Expenses tab, top: everything still owed to vendors and lenders, each with a one-tap Pay
function toPayCard(evId = '') {
  const items = pendingCredit().filter(u => !evId || u.x.evId === evId);
  if (!items.length) return '';
  const total = items.reduce((s, u) => s + u.left, 0);
  return `
    <div class="sec"><span class="sec-title">To pay – देणे बाकी</span>
      <span class="meta">${tr(`${fmtCurrency(total)} · ${payeeCount(items)}`, `${fmtCurrency(total)} · ${new Set(items.map(u => u.x.venId)).size} जणांना`)}</span></div>
    <div class="card list" id="to-pay-list">${items.map(({ x, left }) => {
      const ven = D.vendors.find(v => v.id === x.venId);
      const ev  = D.events.find(e => e.id === x.evId);
      return `<div class="row" role="button" tabindex="0" data-action="edit-exp" data-id="${esc(x.id)}">
        <div class="avatar" data-nl style="width:36px;height:36px;font-size:13px">${esc(initials(ven?.name))}</div>
        <div class="row-body">
          <div class="title-sm trunc" data-nl>${esc(ven?.name || '—')}</div>
          <div class="meta trunc">${esc(x.head || x.cat)}${ev ? ` · <span data-nl>${esc(ev.name)}</span>` : ''} · ${fmtDate(x.date)}</div>
        </div>
        <div class="row-end"><div class="amt-sm">${fmtCurrency(left)}</div>${creditChip(x)}</div>
        <button type="button" class="btn-sm" data-action="open-vpay" data-id="${esc(x.venId)}">${tr('Pay', 'द्या')}</button>
      </div>`;
    }).join('')}</div>`;
}

// Home: credit due within a week (or overdue), plus a link to everything still owed
function payVendorsCard() {
  const all = pendingCredit();
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
  return { rec, pend, noCosts, overdue: pend > 0 && isOverdue(ev) };
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
      <div class="metric"><div class="label">Profit/plate – नफा/ताट</div><div class="amt-md ${noCosts ? 'muted' : pl.profitPerPlate >= 0 ? 'pos' : 'neg'}">${fmtCurrency(pl.profitPerPlate)}</div></div>
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

// Vendor page: items whose cost per plate has risen against this vendor's own past events
function priceCheckCard(vn) {
  const rises = priceCreep(D.expenses, D.events).filter(r => r.venId === vn.id);
  if (!rises.length) return '';
  const phone = phoneDigits(vn.phone);
  return `<div class="sec"><span class="sec-title">Price check – दर तपासणी</span></div>
    <div class="card list" id="price-check">${rises.map(r => {
      const item = short(r.head);
      const msg = `Namaste ${vn.name}! For ${item}, my recent bill (${r.ev.name}) came to ${fmtCurrency(r.latest)} per plate, against about ${fmtCurrency(r.avg)} per plate before. Can we keep the earlier rate? Thank you!`;
      return `<div class="row" style="min-height:52px">
        <div class="row-body"><div class="title-sm trunc">${esc(item)}</div>
          <div class="meta">${tr(`${fmtCurrency(r.latest)}/plate now · ${fmtCurrency(r.avg)} before (${r.n} event${r.n > 1 ? 's' : ''})`, `आता ${fmtCurrency(r.latest)}/ताट · आधी ${fmtCurrency(r.avg)}`)}</div></div>
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
    + `${isPerson(vn) ? 'Lent / paid for me' : 'Supplied'}: ${fmtCurrency(bal.supplied)}\nPaid: ${fmtCurrency(bal.paid)}\n`
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
  const msg = `Namaste! A gentle reminder from CaterDesk: ${fmtCurrency(pending)} is pending for ${ev.name} (${fmtDate(ev.date)}). Kindly arrange the payment. Thank you!\n\n`
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

  q('tab-evdetail').innerHTML = `
    <div class="card pad">
      <div class="detail-name" data-nl>${esc(ev.name)}</div>
      <div class="facts">
        <span class="fact">${icon('calendar', 16)}${fmtDate(ev.date)}</span>
        <span class="fact" data-nl>${icon('pin', 16)}${esc(ev.venue)}</span>
        <span class="chip">${esc(ev.type)}</span>
        ${ev.meals?.length ? `<span class="chip">${esc(mealLabel(ev))}</span>` : ''}
        ${menu ? `<span class="chip info">${esc(menu.name)}</span>` : ''}
        ${ev.outsourced ? `<span class="chip info">${tr('Outsourced', 'आउटसोर्स')}${outVen ? ` · <span data-nl>${esc(outVen.name)}</span>` : ''}</span>` : ''}
        ${phone ? `<a class="fact" href="tel:+${esc(phone)}">${icon('phone', 16)}${esc(ev.mobile)}</a>` : ''}
      </div>
    </div>

    ${noCosts ? `<div class="card">
      <div class="note alert"><span class="note-ic">${icon('receipt', 16)}</span>
        <div>${tr('No expenses recorded yet — the profit below is not real until you add them.', 'अजून खर्च नोंदवलेला नाही — खर्च जोडेपर्यंत खालील नफा खरा नाही.')}</div></div>
    </div>` : ''}

    <div class="card pad">
      <div class="metrics" style="margin:0;padding:0;border:0">
        <div class="metric"><div class="label">Bill – बिल</div><div class="amt-md">${fmtCurrency(ev.billing)}</div></div>
        <div class="metric"><div class="label">Received – मिळाले</div><div class="amt-md pos">${fmtCurrency(rec)}</div></div>
        <div class="metric"><div class="label">Pending – बाकी</div><div class="amt-md ${pend > 0 ? (isOverdue(ev) ? 'neg' : 'due') : 'muted'}">${fmtCurrency(Math.max(0, pend))}</div></div>
      </div>
      <div class="prog" style="margin-top:var(--s3)"><span style="width:${pct}%"></span></div>
      <div class="metrics">
        <div class="metric"><div class="label">Expenses – खर्च</div><div class="amt-md">${fmtCurrency(exTot)}</div></div>
        <div class="metric"><div class="label">${ev.outsourced ? 'Commission – कमिशन' : 'Profit – नफा'}</div><div class="amt-md ${noCosts ? 'muted' : profit >= 0 ? 'pos' : 'neg'}">${fmtCurrency(profit)}</div></div>
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
  const changes = [], expIds = {}, saved = [];
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
  const removed = Object.entries(oldIds).filter(([key, id]) => !byKey.has(key) && D.expenses.some(x => x.id === id)).map(([, id]) => id);
  for (const id of removed) changes.push({ store: 'expenses', id, expected: D.expenses.find(x => x.id === id) });
  const evRecord = { ...ev, labour: { rows, pay, mode: pay === 'paid' ? qv('lab-mode') : '', venId, expIds, ...(billTotal && rows.length ? { billTotal } : {}) } };
  await commitChanges([{ store: 'events', record: evRecord, expected: ev }, ...changes], { check: true, extraStores: ['vendors'] });
  D.events = D.events.map(e => e.id === ev.id ? evRecord : e);
  D.expenses = D.expenses.filter(x => !removed.includes(x.id) && !saved.some(r => r.id === x.id)).concat(saved);
  closeModals();
  showToast(rows.length ? `Labour ${fmtCurrency(saved.reduce((s, r) => s + r.amt, 0))} saved – मजूर खर्च जतन` : 'Labour sheet cleared – मजूर यादी काढली');
  refreshCurrent();
}

/* ── EVENT MENU & VENDOR ORDERS ──────────────────── */
const ORDER_STATUS = {
  sent:      { en: 'Sent', mr: 'पाठवले', tone: '' },
  confirmed: { en: 'Confirmed', mr: 'पक्के', tone: 'info' },
  delivered: { en: 'Delivered', mr: 'आले', tone: 'pos' },
  cancelled: { en: 'Cancelled', mr: 'रद्द', tone: 'neg' }
};
const short = head => String(head || '').split(' – ')[0];

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

function menuOrdersCard(ev) {
  const dishes = ev.dishes || [];
  if (!dishes.length) return `
    <div class="sec"><span class="sec-title">Menu & orders – मेनू व ऑर्डर</span></div>
    <div class="card pad"><div class="meta">${tr('Add the dishes agreed with the client. Counter items become vendor orders you can send on WhatsApp.', 'ग्राहकाशी ठरलेले पदार्थ जोडा. काउंटरचे पदार्थ विक्रेत्यांना ऑर्डर म्हणून WhatsApp वर पाठवता येतात.')}</div>
      <button type="button" class="btn-sm" style="margin-top:var(--s3)" data-action="menu-edit">${icon('plus', 16)}${tr('Add menu', 'मेनू जोडा')}</button></div>`;
  const groups = dishGroups(ev);
  const orders = ev.orders || [];
  const counters = [...groups].filter(([head]) => head).map(([head, names]) => {
    const o = [...orders].reverse().find(x => x.head === head && x.status !== 'cancelled');
    const ven = D.vendors.find(v => v.id === (o?.venId || (ev.outsourced ? ev.outVenId : counterVendor(head))));
    const st = o && ORDER_STATUS[o.status];
    return `<div class="row" style="min-height:56px">
      <div class="row-ic">${icon('utensils', 18)}</div>
      <div class="row-body"><div class="title-sm trunc">${ev.outsourced ? tr('Whole event', 'संपूर्ण कार्यक्रम') : esc(short(head))}${ven ? ` · <span data-nl>${esc(ven.name)}</span>` : ''}</div>
        <div class="meta trunc" data-nl>${esc(names.join(', '))}</div></div>
      ${o ? `<button type="button" class="chip ${st.tone}" data-action="order-status" data-id="${esc(o.id)}">${tr(st.en, st.mr)}${o.plates ? ' · ' + o.plates : ''}</button>`
          : `<button type="button" class="btn-sm" data-action="order-new" data-id="${esc(head)}">${icon('message', 16)}${tr('Order', 'ऑर्डर')}</button>`}
    </div>`;
  }).join('');
  const kitchen = groups.get('') || [];
  return `
    <div class="sec"><span class="sec-title">Menu & orders – मेनू व ऑर्डर</span>
      <button type="button" class="btn-sm" data-action="menu-edit">${icon('pencil', 16)}${tr('Edit', 'बदला')}</button></div>
    <div class="card list" id="menu-orders">
      ${counters || `<div class="list-empty">${tr('No counter items found. Tap a dish below to say which counter supplies it.', 'काउंटरचे पदार्थ सापडले नाहीत. खालील पदार्थावर टॅप करा.')}</div>`}
      ${kitchen.length ? `<div class="row" style="min-height:48px"><div class="row-ic">${icon('basket', 18)}</div>
        <div class="row-body"><div class="title-sm">${tr('Our kitchen', 'आपले किचन')}</div><div class="meta" data-nl>${esc(kitchen.join(', '))}</div></div></div>` : ''}
      ${ev.outsourced ? `<div class="meta" style="padding:var(--s3) var(--s4)">${tr('Outsourced event: the full menu goes to the caterer doing the event.', 'आउटसोर्स कार्यक्रम: संपूर्ण मेनू त्या केटररला जातो.')}</div>` : `<div style="padding:var(--s3) var(--s4)">
        <div class="meta" style="margin-bottom:var(--s2)">${tr('Tap a dish to change where it comes from', 'पदार्थ कुठून येतो ते बदलण्यासाठी टॅप करा')}</div>
        <div class="chips-row" style="margin:0;padding:0;flex-wrap:wrap">${dishes.map((d, i) =>
          `<button type="button" class="f-chip" data-action="dish-assign" data-id="${i}" data-nl style="max-width:100%;overflow:hidden;text-overflow:ellipsis">${esc(d.name)}${d.head ? ` · ${esc(short(d.head))}` : ''}</button>`).join('')}</div>
      </div>`}
    </div>`;
}

// Save changed menu/orders on the event currently open
async function patchEvent(id, patch) {
  const ev = D.events.find(e => e.id === id); if (!ev) return null;
  const record = { ...ev, ...patch };
  await putChecked('events', record, ev);
  D.events = D.events.map(e => e.id === id ? record : e);
  return record;
}

function openMenuModal() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  q('menu-text').value = (ev.dishes || []).map(d => d.name).join('\n');
  openSheet('menu-modal');
  q('menu-text').focus({ preventScroll: true });
}

async function saveMenu() {
  const ev = D.events.find(e => e.id === curRef); if (!ev) return;
  const learned = learnedDishes(D.events);
  const before = new Map((ev.dishes || []).map(d => [d.name.toLowerCase(), d]));
  // Keep your earlier choices for dishes that stay; match new ones to counters
  const dishes = parseMenu(qv('menu-text')).map(name => before.get(name.toLowerCase()) || { name, head: dishCounter(name, learned) });
  await patchEvent(ev.id, { dishes });
  closeModals();
  const n = ev.outsourced ? 1 : new Set(dishes.filter(d => d.head).map(d => d.head)).size;
  showToast(n ? `Menu saved · ${n} counter order${n > 1 ? 's' : ''} to send – ${n} ऑर्डर` : 'Menu saved – मेनू जतन झाला');
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
  q('ord-plates').value = o?.plates || ev.guests || '';
  q('ord-date').value = o?.date || ev.date;
  q('ord-time').value = o?.time || '';
  q('ord-notes').value = o?.notes || '';
  q('btn-cancel-ord').hidden = !o;
  clearFieldErrors();
  openSheet('ord-modal');
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
  const id = qv('ord-id') || uid('OR');
  const old = (ev.orders || []).find(x => x.id === id);
  const o = { id, head: qv('ord-head'), venId, plates: Number(qv('ord-plates')) || 0, date: qv('ord-date'), time: qv('ord-time'),
              notes: qv('ord-notes'), status: old && old.status !== 'cancelled' ? old.status : 'sent', at: new Date().toISOString() };
  const orders = old ? ev.orders.map(x => x.id === id ? o : x) : [...(ev.orders || []), o];
  const saved = await patchEvent(ev.id, { orders });
  closeModals();
  refreshCurrent();
  const phone = phoneDigits(ven?.phone);
  if (phone) window.open(`https://wa.me/${phone}?text=${encodeURIComponent(orderMessage(saved, o, ven))}`, '_blank', 'noopener');
  else showToast(`Order saved. ${ven?.name || 'This vendor'} has no phone number – add it to send on WhatsApp.`, 'error');
}

async function orderAction(orderId) {
  const ev = D.events.find(e => e.id === curRef); const o = ev?.orders?.find(x => x.id === orderId); if (!o) return;
  const ven = D.vendors.find(v => v.id === o.venId);
  const next = await askSheet({
    title: `${short(o.head)} · ${ven?.name || ''} – ${ORDER_STATUS[o.status].en}`,
    actions: [
      ...(o.status === 'sent' ? [{ label: 'Vendor confirmed – पक्के', value: 'confirmed', style: 'btn-secondary' }] : []),
      ...(o.status !== 'delivered' ? [{ label: 'Delivered · record bill – आले, बिल नोंदवा', value: 'delivered', style: 'btn-primary' }] : []),
      { label: 'Edit / send again – बदला', value: 'edit', style: 'btn-secondary' },
      ...(o.status !== 'delivered' ? [{ label: 'Cancel order – रद्द', value: 'cancelled', style: 'btn-danger' }] : [])
    ]
  });
  if (!next) return;
  if (next === 'edit') { openOrderModal({ orderId }); return; }
  await patchEvent(ev.id, { orders: ev.orders.map(x => x.id === orderId ? { ...x, status: next } : x) });
  refreshCurrent();
  if (next !== 'delivered') return;
  // Outsourced: their charge was recorded when the event was booked; don't count it twice
  if (ev.outsourced && D.expenses.some(x => x.evId === ev.id && x.venId === o.venId)) { showToast('Done. Their charge is already recorded for this event.'); return; }
  // Delivered: the bill goes in as an expense for this counter and vendor
  openExpModal({ prefill: { evId: ev.id, cat: ev.outsourced ? 'Operations' : 'Live Counter', head: o.head, venId: o.venId } });
}

async function cancelOrderFromSheet() {
  const id = qv('ord-id'); const ev = D.events.find(e => e.id === curRef); if (!ev || !id) return;
  await patchEvent(ev.id, { orders: ev.orders.map(x => x.id === id ? { ...x, status: 'cancelled' } : x) });
  closeModals(); refreshCurrent();
}

// Home: orders due today or tomorrow that haven't arrived yet
function deliveriesCard() {
  const t = today(), tm = addDays(t, 1);
  const due = D.events.flatMap(ev => (ev.orders || []).filter(o => ['sent', 'confirmed'].includes(o.status) && (o.date === t || o.date === tm)).map(o => ({ ev, o })))
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
function costVsUsualCard(ev) {
  const cmp = costVsUsual(ev, D.events, costByCategory(D.events, D.expenses));
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
    showEvent ? `<span data-nl>${esc(ev?.name || '—')}</span>` : '',
    fmtDate(x.date),
    ven ? `<span data-nl>${esc(ven.name)}</span>` : ''
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

  if (F.expEv && !D.events.some(e => e.id === F.expEv)) F.expEv = '';
  populateSelect('exp-ev-filter', [{ v: '', l: 'All events – सर्व कार्यक्रम' }, ...eventOptions()], F.expEv);
  q('exp-ev-filter').parentElement.hidden = !D.events.length;
  const list = D.expenses
    .filter(x => !F.expEv || x.evId === F.expEv)
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
      </div>`
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
        return `<div class="row" role="button" tabindex="0" data-action="edit-vpay" data-id="${esc(p.id)}">
          <div class="row-ic">${icon('wallet', 18)}</div>
          <div class="row-body">
            <div class="amt-sm">${fmtCurrency(p.amt)}</div>
            <div class="meta trunc">${fmtDate(p.date)} · ${esc(p.mode)}${ev ? ` · <span data-nl>${esc(ev.name)}</span>` : ''}${p.head ? ' · ' + esc(p.head) : ''}</div>
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
      <div class="row-end"><div class="amt-sm ${g.profit >= 0 ? 'pos' : 'neg'}">${fmtCurrency(g.profit)}</div><div class="meta">${tr(`profit/plate · ${g.margin}%`, `नफा/ताट · ${g.margin}%`)}</div></div>
    </div>`).join('');
}

// Reports: vendors whose cost per plate has gone up (all time), largest rise first
function priceCreepReport() {
  const list = priceCreep(D.expenses, D.events).slice(0, 6);
  if (!list.length) return '';
  return `<div class="card pad" style="padding-bottom:var(--s2)" id="price-creep">
    <div class="chart-title">${icon('store', 18)}Vendor price creep – दरवाढ</div>
    <div class="meta">${tr('Cost per plate at the latest event against the same vendor’s earlier events.', 'त्याच विक्रेत्याच्या आधीच्या कार्यक्रमांशी प्रति ताट तुलना.')}</div>
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
  const costs = costByCategory(D.events, D.expenses);
  const over = new Map();
  for (const ev of P.events) {
    const cmp = costVsUsual(ev, D.events, costs); if (!cmp) continue;
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
  const rows = P.events
    .map(ev => ({ ev, ...calcEventPL(ev, P.cPays, P.expenses) }))
    .filter(r => r.guests && !r.ev.outsourced && !missing.has(r.ev.id) && r.expTotal > 0);
  if (!rows.length) {
    return `<div class="card pad"><div class="chart-title">${icon('utensils', 18)}Per plate – प्रति ताट</div>
      <div class="meta">${tr('Add a guest count to your events to see cost and profit per plate here.', 'प्रति ताट खर्च पाहण्यासाठी कार्यक्रमात पाहुण्यांची संख्या जोडा.')}</div></div>`;
  }
  const group = keyOf => {
    const by = new Map();
    rows.forEach(r => {
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
  const menuRows = menuRanking(rows);
  const typeRows = group(ev => (ev.type || 'Other').split(' – ')[0]);
  const eventRows = rows.sort((a, b) => b.profitPerPlate - a.profitPerPlate).map(r => `
    <div class="row" role="button" tabindex="0" data-action="evdetail" data-id="${esc(r.ev.id)}" style="min-height:52px">
      <div class="row-body"><div class="title-sm trunc" data-nl>${esc(r.ev.name)}</div><div class="meta">${tr(`${r.guests} plates · cost ${fmtCurrency(r.costPerPlate)}/plate`, `${r.guests} ताट · खर्च ${fmtCurrency(r.costPerPlate)}/ताट`)}</div></div>
      <div class="row-end"><div class="amt-sm ${r.profitPerPlate >= 0 ? 'pos' : 'neg'}">${fmtCurrency(r.profitPerPlate)}</div><div class="meta">${tr('profit/plate', 'नफा/ताट')}</div></div>
    </div>`).join('');
  return `<div class="card pad" style="padding-bottom:var(--s2)">
    ${menuRows ? `<div class="chart-title">${icon('utensils', 18)}Menu profit ranking – मेनू नफा क्रम</div>${menuRows}
    <div class="chart-title" style="margin-top:var(--s4)">` : '<div class="chart-title">'}${icon('utensils', 18)}Per plate by type – प्रकारानुसार प्रति ताट</div>${typeRows}
    <div class="chart-title" style="margin-top:var(--s4)">${icon('calendar', 18)}Per plate by event – कार्यक्रमनिहाय</div>${eventRows}
  </div>`;
}

function rSummary() {
  renderPeriodSegs();
  const P = sliceByPeriod(D, period);
  const totalBill = P.events.reduce((s, e) => s + e.billing, 0);
  const totalExp  = P.expenses.reduce((s, x) => s + x.amt, 0);
  const profit    = totalBill - totalExp;
  const noData    = t => `<div class="list-empty">${t}</div>`;
  const missing   = new Set(eventsMissingCosts(P.events, P.expenses).map(e => e.id));

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
        <div class="meta">${missing.has(r.ev.id) ? `<span class="neg">${tr('no costs', 'खर्च नाही')}</span>` : fmtDate(r.ev.date)}</div></div>
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
      <div class="card"><div class="label">Net profit – निव्वळ नफा</div><div class="amt-lg ${profit >= 0 ? 'pos' : 'neg'}">${fmtCurrency(profit)}</div></div>
      <div class="card"><div class="label">Margin – मार्जिन</div><div class="amt-lg ${totalBill > 0 ? (profit >= 0 ? 'pos' : 'neg') : 'muted'}">${totalBill > 0 ? Math.round(profit / totalBill * 100) + '%' : '—'}</div></div>
      <div class="card"><div class="label">Billed – बिल</div><div class="amt-lg">${fmtCurrency(totalBill)}</div></div>
      <div class="card"><div class="label">Events – कार्यक्रम</div><div class="amt-lg">${P.events.length}</div></div>
    </div>
    ${missing.size ? `<div class="card" style="margin-top:var(--s3)"><div class="note alert"><span class="note-ic">${icon('receipt', 16)}</span>
      <div>${tr(`${missing.size} event${missing.size > 1 ? 's have' : ' has'} no expenses, so profit here is overstated.`, `${missing.size} कार्यक्रमांचा खर्च नोंदवलेला नाही, त्यामुळे नफा जास्त दिसतो.`)}</div></div></div>` : ''}
    <div class="sec"></div>
    ${perPlateReport(P, missing)}
    ${costsHigherReport(P)}
    ${priceCreepReport()}
    <div class="card pad"><div class="chart-title">${icon('calendar', 18)}Profit by event – कार्यक्रमनिहाय नफा</div>${plRows}</div>
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

// In-app replacement for confirm(): resolves to the chosen action's value, or null on Cancel / Back
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
      b.addEventListener('click', () => { result = a.value; closeOverlay(); });
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
  q('ev-id').value      = ev?.id      || '';
  q('ev-name').value    = ev?.name    || '';
  q('ev-date').value    = ev?.date    || '';
  q('ev-venue').value   = ev?.venue   || '';
  q('ev-billing').value = ev?.billing || '';
  q('ev-mobile').value  = ev?.mobile  || '';
  q('ev-guests').value  = ev?.guests  || '';
  q('ev-budget').value  = ev?.budget  || '';
  q('ev-notes').value   = ev?.notes   || '';
  populateSelect('ev-type', EVENT_TYPES, ev?.type || '');
  setEvMeals(ev?.meals || []);
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
  const costed = peers.filter(e => spent.get(e.id));
  const byMenu = menu ? costed.filter(e => e.menu === menu.id) : [];
  const basis = byMenu.length ? menu.name : (type || '').split(' – ')[0];
  const cost = avg(byMenu.length ? byMenu : costed.filter(e => e.type === type), e => spent.get(e.id));
  const billed = menu ? avg(peers.filter(e => e.menu === menu.id), e => e.billing) : null;
  const lines = [];
  if (cost) {
    lines.push(`${esc(basis)} usually costs you <b>${fmtCurrency(cost.perPlate)}/plate</b> (${cost.n} event${cost.n > 1 ? 's' : ''})`);
    if (bill && guests) {
      const pp = Math.round(bill / guests), m = Math.round((pp - cost.perPlate) / pp * 100);
      lines.push(`At ${fmtCurrency(pp)}/plate your margin is about <b class="${m < TARGET_MARGIN ? 'due' : 'pos'}">${m}%</b> · minimum ${TARGET_MARGIN}%`);
    }
    lines.push(`For a ${TARGET_MARGIN}% margin, quote at least <b>${fmtCurrency(Math.ceil(cost.perPlate / (1 - TARGET_MARGIN / 100)))}/plate</b>`);
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
    + (past ? ` · usually costs ${fmtCurrency(past.perPlate)}/plate (${past.n} event${past.n > 1 ? 's' : ''})` : ' · cost per plate shows after the first event on this menu');
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

  const record = {
    id:       id || uid('EV'),
    name:     data.name,
    date:     data.date,
    type:     qv('ev-type'),
    ...(evMeals().length ? { meals: Object.keys(MEALS).filter(m => evMeals().includes(m)) } : {}),
    venue:    data.venue,
    billing:  data.billing,
    mobile:   data.mobile,
    guests:   data.guests,
    budget:   data.budget,
    menu:     qv('ev-menu'),
    ...(out ? { outsourced: true, outVenId } : {}),
    notes:    qv('ev-notes'),
    photoIds: id ? (D.events.find(e => e.id === id)?.photoIds || []) : [],
    _v: 2
  };

  // The advance is saved with the event in one go, as its first payment received
  const advance = adv !== '' ? { id: uid('CP'), evId: record.id, amt: adv, date: today(), mode: qv('ev-adv-mode'), notes: 'Advance – अॅडव्हान्स' } : null;
  // An outsourced event's vendor charge is one credit expense to that vendor, saved with the event
  const vendorBill = charge !== '' ? { id: uid('EX'), evId: record.id, cat: 'Operations', head: 'Outsourced Event – आउटसोर्स कार्यक्रम', amt: charge,
    date: record.date, pay: 'credit', mode: '', venId: outVenId, dueDate: '', notes: '', billIds: [] } : null;
  if (advance || vendorBill) await commitChanges([{ store: 'events', record, expected: null },
      ...(advance ? [{ store: 'cPays', record: advance, expected: null }] : []),
      ...(vendorBill ? [{ store: 'expenses', record: vendorBill, expected: null }] : [])], { check: true, extraStores: ['vendors'] });
  else await putChecked('events', record, id ? D.events.find(r => r.id === id) : null);
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
  expTouched = { item: !!(ex || pre?.head), pay: !!(ex || arg?.resume) };
  const evId = ex?.evId || pre?.evId || (typeof arg === 'string' && arg) || defaultEventId();
  const last = readPref('ffv2_lastexp', {});

  q('exp-id').value    = ex?.id || '';
  q('exp-amt').value   = ex?.amt || '';
  populateSelect('exp-ev', eventOptions(), evId);
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
  q('exp-mtitle').textContent = ex?.draft ? 'Fill in bill – बिल भरा'
                              : ex ? 'Edit expense – संपादित करा' : 'Record expense – खर्च नोंदवा';
  q('btn-del-exp').hidden       = !ex;
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
  const { valid, errors } = validate(EXPENSE_RULES, data);
  const venId = qv('exp-vendor').startsWith('__new') ? '' : qv('exp-vendor');
  if (pay === 'credit' && !venId) errors['exp-vendor'] = 'Choose who you owe – कोणाला देणे ते निवडा';
  if (!valid || errors['exp-vendor']) {
    // validate() keys errors by field name; map them onto this sheet's inputs
    const map = { evId: 'exp-ev', amt: 'exp-amt', date: 'exp-date' };
    showFieldErrors(Object.fromEntries(Object.entries(errors).map(([k, v]) => [map[k] || k, v])));
    return;
  }

  const record = {
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
    billIds: expWork.bills.map(b => b.id)
  };

  await commitChanges([{ store: 'expenses', record, expected: D.expenses.find(r => r.id === record.id) || D.drafts.find(r => r.id === record.id) || null }, ...expWork.removed.map(id => ({ store: 'photos', id, unchecked: true }))], { check: true, extraStores: ['events', 'vendors'] });
  // A filled-in draft becomes a real expense
  D.drafts = D.drafts.filter(d => d.id !== record.id);
  const i = D.expenses.findIndex(x => x.id === record.id);
  if (i >= 0) D.expenses[i] = record; else D.expenses.push(record);
  expWork.saved = true;
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
  const record = { id: id || uid('CP'), evId, amt: data.amt, date: data.date, mode: qv('cpay-mode'), notes: qv('cpay-notes') };

  await putChecked('cPays', record, id ? D.cPays.find(r => r.id === id) : null);
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
  const record = { id: id || uid('VN'), name: data.name, cat: person ? '' : qv('ven-cat'), specialty: person ? '' : qv('ven-specialty'),
                   phone: data.phone, notes: qv('ven-notes'), ...(person ? { kind: 'person' } : {}) };

  await putChecked('vendors', record, id ? D.vendors.find(r => r.id === id) : null);
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
function openVPayModal(venId, payId) {
  const p  = payId ? D.vPays.find(x => x.id === payId) : null;
  const vid = p?.venId || venId;
  const bal = calcVendorBalance(vid, D.expenses, D.vPays).balance;
  q('vpay-venid').value = vid;
  q('vpay-id').value    = p?.id || '';
  q('vpay-amt').value   = p?.amt || (bal > 0 ? bal : '');
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

async function saveVPay() {
  const venId = qv('vpay-venid');
  const data = { venId, amt: qf('vpay-amt'), date: qv('vpay-date') };
  const { valid, errors } = validate(VPAY_RULES, data);
  if (!valid) { showFieldErrors({ 'vpay-amt': errors.amt, 'vpay-date': errors.date }); return; }

  const id  = qv('vpay-id');
  const old = id ? D.vPays.find(p => p.id === id) : null;
  const record = { id: id || uid('VP'), venId, evId: qv('vpay-ev'), cat: old?.cat || '', head: old?.head || '', amt: data.amt, date: data.date, mode: qv('vpay-mode'), notes: qv('vpay-notes') };

  await putChecked('vPays', record, id ? D.vPays.find(r => r.id === id) : null);
  if (id) D.vPays = D.vPays.map(p => p.id === id ? record : p);
  else    D.vPays.push(record);

  closeModals();
  showToast('Vendor payment saved – विक्रेता देयक जतन');
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
async function exportData() {
  if (!launched || q('pin-screen').classList.contains('active')) { showToast('Unlock the app before exporting.', 'error'); return; }
  let file;
  showLoading(true);
  try {
    const payload = await exportAllData();
    file = new File([JSON.stringify(payload)], `caterdesk-backup-${today()}.json`, { type: 'application/json' });
  } finally { showLoading(false); }

  let how = 'download';
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'CaterDesk backup', text: `CaterDesk backup ${fmtDate(today())}` });
      how = 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return;   // closed the share sheet: nothing was saved
    }
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
  showToast(how === 'shared' ? `Backup shared (${size}) – बॅकअप पाठवला` : `Backup saved to Downloads (${size}) – बॅकअप जतन`);
  if (CT === 'home') rHome();
}

async function handleImport(file) {
  if (!launched || q('pin-screen').classList.contains('active')) return;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const payload = JSON.parse(e.target.result);

      if (!payload.version || !['ffv5', 'ffv2'].includes(payload.version)) {
        showToast('Invalid backup file – चुकीची फाईल', 'error'); return;
      }
      const counts = `This backup has ${(payload.events||[]).length} events, ${(payload.expenses||[]).length} expenses, ${(payload.cPays||[]).length} payments and ${(payload.vendors||[]).length} vendors.`;
      const mode = await askSheet({
        title: 'Import backup – आयात',
        message: `${counts}\n\nMerge keeps your current data. Replace deletes it first.`,
        actions: [
          { label: 'Merge – जोडा', value: 'merge', style: 'btn-primary' },
          { label: 'Replace all data – सर्व बदला', value: 'replace', style: 'btn-danger' }
        ]
      });
      if (!mode) return;

      showLoading(true);
      await importAllData(payload, mode);
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
      case 'open-vpay':    openVPayModal(id); break;
      case 'menu-edit':    openMenuModal(); break;
      case 'lab-edit':     openLabModal(); break;
      case 'dish-assign':  assignDish(Number(id)); break;
      case 'order-new':    openOrderModal({ head: id }); break;
      case 'order-status': orderAction(id); break;
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
  // Sharing must start within the tap, so begin the backup first, then close the panel
  q('btn-export').addEventListener('click', () => { exportData(); closeOverlay(); });
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
