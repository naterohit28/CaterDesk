/**
 * db.js — CaterDesk v2
 * IndexedDB data layer with localStorage migration
 * Stores: events, expenses, vendors, cPays, vPays
 * Images stored separately in 'photos' store (blob/base64)
 */

const DB_NAME    = 'FlavorFusionDB';
const DB_VERSION = 4;   // v3: photos indexed by eventId · v4: bill photos indexed by expenseId
const STORES     = ['events','expenses','vendors','cPays','vPays','photos','meta'];

let _db = null;
let _opening = null;
let _openGeneration = 0;
const STORAGE_TIMEOUT_MS = 8000;

export function resetDB() {
  const old = _db;
  _db = null; _opening = null; _openGeneration++;
  try { old?.close(); } catch {}
}

export function openDB(force = false) {
  if (force) resetDB();
  if (_db) {
    try { _db.transaction('meta', 'readonly'); return Promise.resolve(_db); }
    catch { resetDB(); }
  }
  if (_opening) return _opening;
  const generation = ++_openGeneration;
  _opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (generation === _openGeneration) { _opening = null; _openGeneration++; }
      reject(new Error('Storage did not open. Your entries were kept. Close other app windows and retry.'));
    }, STORAGE_TIMEOUT_MS);
    req.onblocked = () => window.dispatchEvent(new CustomEvent('ffdb-blocked'));
    req.onupgradeneeded = e => {
      const db = e.target.result;
      STORES.forEach(name => { if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' }); });
      const photos = e.target.transaction.objectStore('photos');
      if (!photos.indexNames.contains('eventId')) photos.createIndex('eventId', 'eventId');
      if (!photos.indexNames.contains('expenseId')) photos.createIndex('expenseId', 'expenseId');
    };
    req.onsuccess = () => {
      const connection = req.result;
      if (settled || generation !== _openGeneration) { connection.close(); return; }
      settled = true; clearTimeout(timer);
      _db = connection; _opening = null;
      connection.onclose = () => { if (_db === connection) resetDB(); };
      connection.onversionchange = () => {
        if (_db === connection) resetDB(); else connection.close();
        window.dispatchEvent(new CustomEvent('ffdb-update-needed'));
      };
      resolve(connection);
    };
    req.onerror = () => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (generation === _openGeneration) _opening = null;
      reject(req.error || new Error('Failed to open storage'));
    };
  });
  return _opening;
}

// Bound the transaction itself, not just the UI promise. A timed-out write must
// actually abort before Save can be retried, so it cannot commit unexpectedly later.
function transaction(db, names, mode) {
  const tx = db.transaction(names, mode);
  const timer = setTimeout(() => {
    const error = new Error('Storage was busy. The operation was cancelled; your entry is still here. Retry after closing other app windows.');
    error.name = 'TimeoutError';
    try { tx.abort(); tx.ffError = error; } catch { /* Already completed. */ }
  }, STORAGE_TIMEOUT_MS);
  const cleanup = () => clearTimeout(timer);
  tx.addEventListener('complete', cleanup, { once: true });
  tx.addEventListener('abort', cleanup, { once: true });
  return tx;
}

// Resilient transaction executor: catches InvalidStateError / connection dropped and retries once
async function withTx(run) {
  try {
    const db = await openDB();
    return await run(db);
  } catch (err) {
    // Only retry a definite closed-connection error, not messages such as
    // "close other app windows" from a cancelled transaction.
    const isConnLoss = err?.name === 'InvalidStateError';
    if (isConnLoss) {
      console.warn('IDB connection closed or invalid. Reopening and retrying...', err);
      const freshDb = await openDB(true);
      return await run(freshDb);
    }
    throw err;
  }
}

/* ── GENERIC CRUD ────────────────────────────────── */
export async function getAll(store) {
  return withTx(db => new Promise((resolve, reject) => {
    const tx  = transaction(db, store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(tx.ffError || req.error);
    tx.onabort = () => reject(tx.ffError || tx.error || new Error('Storage read aborted'));
  }));
}

export async function getOne(store, id) {
  return withTx(db => new Promise((resolve, reject) => {
    const tx  = transaction(db, store, 'readonly');
    const req = tx.objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror   = () => reject(tx.ffError || req.error);
    tx.onabort = () => reject(tx.ffError || tx.error || new Error('Storage read aborted'));
  }));
}

// Every write resolves only after the entire transaction commits.
export async function commitChanges(changes, { clear = [], check = false, extraStores = [] } = {}) {
  const guardedDelete = check && changes.some(c => !c.record && ['events', 'vendors'].includes(c.store));
  const names = [...new Set([...clear, ...extraStores, ...(guardedDelete ? STORES : []), ...changes.map(c => c.store)])];
  if (!names.length) return;
  return withTx(db => new Promise((resolve, reject) => {
    const tx = transaction(db, names, 'readwrite');
    let failure;
    tx.oncomplete = () => {
      changes.forEach(c => { if (c.record && c.nextRev) c.record._rev = c.nextRev; });
      resolve();
    };
    tx.onerror = tx.onabort = () => reject(failure || tx.ffError || tx.error || new Error('Storage transaction aborted. Nothing was saved.'));
    try {
      clear.forEach(name => tx.objectStore(name).clear());
      for (const c of changes) {
        const os = tx.objectStore(c.store);
        const id = c.record ? c.record.id : c.id;
        const req = os.get(id);
        req.onsuccess = () => {
          try {
            const current = req.result;
            const canonicalObj = o => o ? JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => k !== '_rev').sort(([a],[b]) => a.localeCompare(b)))) : '';
            const revMismatch = current && c.expected && current._rev !== undefined && c.expected._rev !== undefined && current._rev !== c.expected._rev;
            if (check && !c.unchecked && (c.expected === null ? !!current : (!current ||
                revMismatch || canonicalObj(current) !== canonicalObj(c.expected)))) {
              throw new Error('This record changed in another window. Close this form, refresh, and try again.');
            }
            const write = () => {
              if (c.record) {
                c.nextRev = (Number(current?._rev) || 0) + 1;
                os.put({ ...c.record, _rev: c.nextRev });
              } else os.delete(id);
            };
            const refs = check && c.record ? [
              ...(c.record.evId ? [['events', c.record.evId]] : []),
              ...(c.record.venId ? [['vendors', c.record.venId]] : []),
              ...(c.record.eventId ? [['events', c.record.eventId]] : []),
              ...(c.record.expenseId ? [['expenses', c.record.expenseId]] : [])
            ].filter(([parent, parentId]) => !changes.some(op => op.store === parent && op.record?.id === parentId)) : [];
            if (check && !c.record && ['events', 'vendors'].includes(c.store)) {
              const dependencies = c.store === 'events' ? ['expenses', 'cPays', 'vPays'] : ['expenses', 'vPays'];
              let pending = dependencies.length;
              for (const store of dependencies) {
                const children = tx.objectStore(store).getAll();
                children.onsuccess = () => {
                  const linked = children.result.some(r => r[c.store === 'events' ? 'evId' : 'venId'] === id && !changes.some(op => op.store === store && !op.record && op.id === r.id));
                  if (linked) { failure = new Error('This record has linked entries. Refresh before deleting.'); tx.abort(); return; }
                  if (!--pending) write();
                };
              }
            } else if (!refs.length) write();
            else {
              let waiting = refs.length;
              for (const [parent, parentId] of refs) {
                const parentStore = tx.objectStore(parent);
                const checkKey = (key, onMiss) => {
                  try {
                    const r = parentStore.get(key);
                    r.onsuccess = () => {
                      if (r.result) {
                        if (parent === 'vendors' && c.record.venId && c.record.venId !== r.result.id) c.record.venId = r.result.id;
                        if (parent === 'events' && c.record.evId && c.record.evId !== r.result.id) c.record.evId = r.result.id;
                        if (!--waiting) write();
                      } else onMiss();
                    };
                    r.onerror = e => { e.preventDefault?.(); onMiss(); };
                  } catch { onMiss(); }
                };

                checkKey(parentId, () => {
                  const altKey = typeof parentId === 'string' && /^\d+$/.test(parentId.trim()) ? Number(parentId.trim())
                               : typeof parentId === 'number' ? String(parentId) : null;
                  const tryScan = () => {
                    try {
                      const allReq = parentStore.getAll();
                      allReq.onsuccess = () => {
                        const rows = allReq.result || [];
                        const match = rows.find(row => row && String(row.id).trim() === String(parentId).trim());
                        if (match) {
                          if (parent === 'vendors' && c.record.venId) c.record.venId = match.id;
                          if (parent === 'events' && c.record.evId) c.record.evId = match.id;
                          if (!--waiting) write();
                          return;
                        }
                        failure = new Error('The linked event or vendor was removed. Close this form and refresh.');
                        tx.abort();
                      };
                      allReq.onerror = () => { failure = new Error('Could not verify the linked record. Nothing was saved.'); tx.abort(); };
                    } catch (e) { failure = e; tx.abort(); }
                  };
                  if (altKey !== null) checkKey(altKey, tryScan);
                  else tryScan();
                });
              }
            }
          } catch (e) { failure = e; tx.abort(); }
        };
      }
    } catch (e) { failure = e; tx.abort(); }
  }));
}
export async function putOne(store, record) { await commitChanges([{ store, record }]); return record.id; }
export async function putChecked(store, record, expected = null) {
  await commitChanges([{ store, record, expected }], { check: true, extraStores: ['events', 'vendors'] });
  return record.id;
}
export async function putMany(store, records) { await commitChanges(records.map(record => ({ store, record }))); }
export async function deleteOne(store, id) { await commitChanges([{ store, id }]); }
export async function clearStore(store) { await commitChanges([], { clear: [store] }); }

/* ── META (app version, PIN, etc.) ──────────────── */
export async function getMeta(key) {
  const row = await getOne('meta', key);
  return row ? row.value : null;
}

export async function setMeta(key, value) {
  await putOne('meta', { id: key, value });
}

/* ── PHOTO STORAGE (compressed) ─────────────────── */
export async function savePhoto(eventId, dataUrl) {
  const compressed = await compressImage(dataUrl, 800, 0.72);
  const id = `photo_${eventId}_${crypto.randomUUID()}`;
  await putOne('photos', { id, eventId, data: compressed, createdAt: new Date().toISOString() });
  return id;
}

export async function getPhotosForEvent(eventId) {
  return withTx(db => new Promise((resolve, reject) => {
    const tx = transaction(db, 'photos', 'readonly');
    const req = tx.objectStore('photos').index('eventId').getAll(eventId);
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')));
    req.onerror   = () => reject(tx.ffError || req.error);
    tx.onabort = () => reject(tx.ffError || tx.error || new Error('Storage read aborted'));
  }));
}

export async function deletePhoto(photoId) {
  await deleteOne('photos', photoId);
}

export async function saveEventPhotos(event, dataUrls) {
  const photos = [];
  for (const raw of dataUrls) photos.push({ id: 'photo_' + crypto.randomUUID(), eventId: event.id,
    data: await compressImage(raw, 800, .72), createdAt: new Date().toISOString() });
  const record = { ...event, photoIds: [...(event.photoIds || []), ...photos.map(p => p.id)] };
  await commitChanges([{ store: 'events', record, expected: event }, ...photos.map(record => ({ store: 'photos', record, expected: null }))],
    { check: true, extraStores: ['events', 'expenses'] });
  return record;
}

// If the OS stopped the app after a bill image committed but before its form was
// saved, preserve the attachment as a draft instead of leaving an invisible orphan.
export async function recoverUnlinkedBills() {
  return withTx(db => new Promise((resolve, reject) => {
    const tx = transaction(db, ['photos', 'expenses'], 'readwrite');
    const index = tx.objectStore('photos').index('expenseId');
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.ffError || tx.error || new Error('Bill recovery aborted'));
    const req = index.openKeyCursor();
    const groups = new Map();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const expenseId = cursor.key;
        const photoId = cursor.primaryKey;
        if (expenseId) {
          if (!groups.has(expenseId)) groups.set(expenseId, []);
          groups.get(expenseId).push(photoId);
        }
        cursor.continue();
      } else {
        if (!groups.size) return;
        for (const [id, ids] of groups) {
          const get = tx.objectStore('expenses').get(id);
          get.onsuccess = () => {
            const old = get.result;
            const missing = ids.filter(bid => !(old?.billIds || []).includes(bid));
            if (old && !missing.length) return;
            const d = new Date(); const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            const record = old || { id, draft: true, amt: 0, evId: '', date, createdAt: d.toISOString(), notes: 'Recovered bill attachment', billIds: [] };
            tx.objectStore('expenses').put({ ...record, billIds: [...(record.billIds || []), ...missing], _rev: (record._rev || 0) + 1 });
          };
        }
      }
    };
  }));
}

/* ── BILL / INVOICE PHOTOS ───────────────────────── */
// Bills keep more detail than event photos so amounts stay readable (~150–300 KB each)
export async function saveBill(expenseId, file) {
  const data = await compressFile(file, 1400, 0.7);
  const id = `bill_${expenseId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await putOne('photos', { id, expenseId, data, createdAt: new Date().toISOString() });
  return { id, data };
}

export async function getBillsForExpense(expenseId) {
  return withTx(db => new Promise((resolve, reject) => {
    const tx = transaction(db, 'photos', 'readonly');
    const req = tx.objectStore('photos').index('expenseId').getAll(expenseId);
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')));
    req.onerror   = () => reject(tx.ffError || req.error);
    tx.onabort = () => reject(tx.ffError || tx.error || new Error('Storage read aborted'));
  }));
}

// Decode straight from the File (no full-size data URL in memory), longest side capped
function compressFile(file, maxSide, quality) {
  const url = URL.createObjectURL(file);
  return compressImage(url, maxSide, quality).finally(() => URL.revokeObjectURL(url));
}

function compressImage(dataUrl, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; reject(new Error('Image decoding timed out')); }, 15000);
    img.onerror = () => { clearTimeout(timer); reject(new Error('Invalid image')); };
    img.onload = () => {
      clearTimeout(timer);
      try {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e) { reject(e); }
    };
    img.src = dataUrl;
  });
}

/* ── MIGRATION: localStorage → IndexedDB ────────── */
const LS_KEYS = { EV:'ffv5_ev', CP:'ffv5_cp', EX:'ffv5_ex', VN:'ffv5_vn', VP:'ffv5_vp' };
const STORE_MAP = { EV:'events', CP:'cPays', EX:'expenses', VN:'vendors', VP:'vPays' };

export async function migrateFromLocalStorage() {
  if (await getMeta('ls_migrated')) return false;
  const payload = { version: 'ffv5', photos: [] };
  let any = false;
  for (const [key, store] of Object.entries(STORE_MAP)) {
    const raw = localStorage.getItem(LS_KEYS[key]);
    payload[store] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(payload[store])) throw new Error('Invalid legacy data: ' + store);
    any ||= payload[store].length > 0;
  }
  if (!any) return false;
  // No writes, including photos, occur before the entire migration is valid.
  await importAllData(payload, 'merge', { migration: true });
  return true;
}

/* ── FULL EXPORT (all stores) ────────────────────── */
export async function exportAllData() {
  const names = STORES.filter(s => s !== 'meta');
  return withTx(db => new Promise((resolve, reject) => {
    const tx = transaction(db, names, 'readonly');
    const result = { version: 'ffv2', exportedAt: new Date().toISOString(), appVersion: APP_VERSION };
    names.forEach(name => { const req = tx.objectStore(name).getAll(); req.onsuccess = () => { result[name] = req.result; }; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.ffError || tx.error || new Error('Backup read aborted'));
  }));
}

const DATA_STORES = ['events', 'expenses', 'vendors', 'cPays', 'vPays', 'photos'];
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function amount(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12 || Math.abs(value * 100 - Math.round(value * 100)) > .001)
    throw new Error('Invalid money amount: ' + field + '. Use a finite number with at most two decimal places.');
}
export async function prepareImport(payload) {
  if (!payload || !['ffv2', 'ffv5'].includes(payload.version)) throw new Error('Unsupported backup version');
  const copy = structuredClone(payload);
  for (const name of DATA_STORES) {
    if (name === 'photos' && copy[name] === undefined) copy[name] = [];
    if (!Array.isArray(copy[name])) throw new Error('Missing or invalid field: ' + name);
    const seen = new Set();
    for (const row of copy[name]) {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id.trim() || row.id.length > 256 || seen.has(row.id))
        throw new Error('Missing or duplicate ID in ' + name);
      seen.add(row.id);
      if (row._rev !== undefined && (!Number.isSafeInteger(row._rev) || row._rev < 0)) throw new Error('Invalid record revision');
      for (const field of ['venue', 'mobile', 'type', 'notes', 'cat', 'head', 'mode', 'phone', 'specialty', 'dueDate', 'evId', 'venId', 'eventId', 'expenseId', 'createdAt', 'kind', 'menu', 'outVenId']) {
        if (row[field] === null) row[field] = '';
        if (row[field] !== undefined && typeof row[field] !== 'string') throw new Error('Invalid text field: ' + field);
      }
      if (row.guests !== undefined && (!Number.isSafeInteger(row.guests) || row.guests < 0)) throw new Error('Invalid guest count');
      if (['events', 'vendors'].includes(name) && (typeof row.name !== 'string' || !row.name.trim())) throw new Error('Missing name in ' + name);
      if (name === 'events') { amount(row.billing, 'billing'); if (row.budget !== undefined) amount(row.budget, 'budget'); }
      if (['expenses', 'cPays', 'vPays'].includes(name)) amount(row.amt ?? (row.draft ? 0 : undefined), name);
      if (['events', 'expenses', 'cPays', 'vPays'].includes(name) && !row.draft && !validDate(row.date)) throw new Error('Invalid date in ' + name);
      for (const field of ['photoIds', 'billIds', 'photos', 'dishes', 'orders']) if (row[field] !== undefined && !Array.isArray(row[field])) throw new Error('Invalid ' + field);
      for (const field of ['photoIds', 'billIds']) if (row[field]?.some(id => typeof id !== 'string' || !id)) throw new Error('Invalid attachment ID');
      if (name === 'photos' && (typeof row.data !== 'string' || !/^data:image\/(jpeg|png|webp|gif);base64,/.test(row.data))) throw new Error('Invalid photo data');
      if (row.pay && !['paid', 'credit'].includes(row.pay)) throw new Error('Invalid payment state');
      if (row.outsourced !== undefined && typeof row.outsourced !== 'boolean') throw new Error('Invalid outsourced flag');
      if (row.meals !== undefined && (!Array.isArray(row.meals) || row.meals.some(m => !['breakfast', 'lunch', 'hightea', 'dinner'].includes(m)))) throw new Error('Invalid meals');
      if (row.labour !== undefined && (typeof row.labour !== 'object' || !Array.isArray(row.labour?.rows))) throw new Error('Invalid labour sheet');
      if (row.kind && !['vendor', 'person'].includes(row.kind)) throw new Error('Invalid vendor kind');
    }
  }
  for (const ev of copy.events) {
    if (!ev.photos?.length) continue;
    ev.photoIds = [...(ev.photoIds || [])];
    for (const raw of ev.photos) {
      const data = await compressImage(raw, 800, .72);
      const id = 'photo_' + crypto.randomUUID();
      copy.photos.push({ id, eventId: ev.id, data, createdAt: new Date().toISOString() });
      ev.photoIds.push(id);
    }
    delete ev.photos;
  }
  return copy;
}
export async function importAllData(payload, mode = 'replace', { migration = false } = {}) {
  if (!['replace', 'merge'].includes(mode)) throw new Error('Invalid import mode');
  const data = await prepareImport(payload);
  return withTx(db => new Promise((resolve, reject) => {
    const tx = transaction(db, [...DATA_STORES, 'meta'], 'readwrite');
    let failure;
    const current = {}; let pending = DATA_STORES.length;
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(failure || tx.ffError || tx.error || new Error('Import aborted; previous data retained'));
    DATA_STORES.forEach(name => {
      const req = tx.objectStore(name).getAll();
      req.onsuccess = () => {
        current[name] = req.result;
        if (--pending) return;
        try {
          const final = {};
          for (const store of DATA_STORES) {
            const rows = new Map((mode === 'merge' ? current[store] : []).map(r => [r.id, r]));
            for (const row of data[store]) {
              const prior = rows.get(row.id);
              const canonical = r => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => k !== '_rev').sort(([a],[b]) => a.localeCompare(b))));
              if (prior && canonical(prior) !== canonical(row)) throw new Error('Merge conflict in ' + store + ': ' + row.id + '. Current data was kept.');
              rows.set(row.id, { ...row, _rev: (prior?._rev || row._rev || 0) + 1 });
            }
            final[store] = rows;
          }
          for (const [store, rows] of Object.entries(final)) for (const row of rows.values()) {
            const ref = (field, target, required = false) => {
              if ((required || row[field]) && !final[target].has(row[field])) throw new Error('Missing ' + target + ' reference in ' + store + ': ' + row.id);
            };
            if (store === 'expenses') { ref('evId', 'events', !row.draft); ref('venId', 'vendors'); }
            if (store === 'cPays') ref('evId', 'events', true);
            if (store === 'vPays') { ref('venId', 'vendors', true); ref('evId', 'events'); }
            if (store === 'photos') { ref('eventId', 'events'); ref('expenseId', 'expenses'); }
            for (const id of [...(row.photoIds || []), ...(row.billIds || [])]) if (!final.photos.has(id)) throw new Error('Missing attachment: ' + id);
          }
          for (const store of DATA_STORES) {
            const os = tx.objectStore(store);
            if (mode === 'replace') os.clear();
            for (const row of final[store].values()) os.put(row);
          }
          if (migration) tx.objectStore('meta').put({ id: 'ls_migrated', value: new Date().toISOString() });
        } catch (e) { failure = e; tx.abort(); }
      };
    });
  }));
}
export const APP_VERSION = '4.0.1';
export async function checkAndMigrate() {
  await openDB();
  const storedVer = await getMeta('app_version');
  try { await migrateFromLocalStorage(); } catch (e) {
    console.error('Legacy migration left unchanged:', e);
    setTimeout(() => window.dispatchEvent(new CustomEvent('ff-migration-error', { detail: e.message })), 500);
  }
  await setMeta('app_version', APP_VERSION);
  await recoverUnlinkedBills();
  return storedVer;
}
