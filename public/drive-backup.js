/* CaterDesk encrypted backups on the owner's Google Drive (design: docs/DRIVE_BACKUP_DESIGN.md, sections 4–7).
   Google receives only .cdbk ciphertext made by backup-crypto.js; file names and properties hold no business data.

   - Sign-in: the Google Identity Services token client, loaded only when the owner opens Drive backup, asked inside a
     tap, scope drive.file only (CaterDesk can reach only the files it made). The access token lives in this module's
     memory for about an hour: never stored, logged, put in a URL or a message, and gone when the app closes.
   - Drive: a "CaterDesk Backups" folder, resumable upload that picks up after a dropped connection, a check that
     Drive holds exactly the bytes sent (size and SHA-256), listing, download for restore, and old copies moved to
     Drive's bin by the 14 daily / 8 weekly / 12 monthly rule. Nothing is ever deleted outright. */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3', UP = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_NAME = 'CaterDesk Backups';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const UPLOAD_CHUNK = 4 * 1024 * 1024;   // a multiple of 256 KiB, as Drive requires for all but the last piece
const DROPS = 5;   // connection drops survived in one upload before it is reported as failed
const safeId = id => typeof id === 'string' && /^[\w-]{1,200}$/.test(id);

export class DriveError extends Error {
  // code: offline, signin, scope, full, unverified, failed, cancelled. Messages never contain a token.
  constructor(code, message) { super(message); this.code = code; }
}
const offline = () => new DriveError('offline', 'No internet connection, or Google Drive could not be reached.');

export function driveAvailable(clientId, origins, origin = location.origin) {
  return typeof clientId === 'string' && /^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId) && origins.includes(origin);
}

// The Google sign-in library, added to the page the first time Drive backup is opened (never on app start)
let gis = null;
export function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gis) gis = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC; s.async = true;
    s.onload = () => window.google?.accounts?.oauth2 ? resolve() : (gis = null, reject(new DriveError('signin', 'Google sign-in could not start.')));
    s.onerror = () => { gis = null; s.remove(); reject(offline()); };
    document.head.appendChild(s);
  });
  return gis;
}

let token = null, tokenUntil = 0;
export const connected = () => !!token && Date.now() < tokenUntil;
export function dropToken() { token = null; tokenUntil = 0; }

/* Ask Google for access. Call it straight from the owner's tap (Google opens a popup, which phones allow only then).
   The first time Google shows its consent screen; later it can answer without asking again. */
export function signIn(clientId) {
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) return Promise.reject(new DriveError('signin', 'Google sign-in is still loading. Try again in a moment.'));
  return new Promise((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId, scope: DRIVE_SCOPE,
      callback: r => {
        if (!r || r.error || !r.access_token) { reject(new DriveError('signin', r?.error === 'access_denied' ? 'Google Drive access was not allowed.' : 'Google sign-in did not finish.')); return; }
        if (!oauth.hasGrantedAllScopes(r, DRIVE_SCOPE)) { reject(new DriveError('scope', 'Google Drive access was not allowed (the "files CaterDesk makes" permission is needed).')); return; }
        token = r.access_token; tokenUntil = Date.now() + Math.max(60, Number(r.expires_in) || 3600) * 1000 - 60000;
        resolve();
      },
      error_callback: e => reject(new DriveError(e?.type === 'popup_closed' ? 'cancelled' : 'signin', e?.type === 'popup_closed' ? 'Google sign-in was closed.' : 'Google sign-in did not open. Allow pop-ups for CaterDesk and try again.'))
    });
    client.requestAccessToken({ prompt: '' });
  });
}

// Disconnect: Google is told to forget the access, and this phone forgets the token
export function signOut() {
  const t = token; dropToken();
  if (t && window.google?.accounts?.oauth2?.revoke) { try { window.google.accounts.oauth2.revoke(t, () => {}); } catch { /* the token is already forgotten here */ } }
}

async function call(url, opts = {}) {
  if (!connected()) { dropToken(); throw new DriveError('signin', 'Google Drive is not connected. Connect it and try again.'); }
  let res;
  try { res = await fetch(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }); }
  catch { throw offline(); }
  if (res.status === 401) { dropToken(); throw new DriveError('signin', 'Google sign-in has expired. Connect again and retry.'); }
  if (res.status === 403 || res.status === 429) {
    let reason = ''; try { const j = await res.clone().json(); reason = j?.error?.errors?.[0]?.reason || j?.error?.status || ''; } catch { /* no details */ }
    if (/storageQuotaExceeded|quotaExceeded/i.test(reason)) throw new DriveError('full', 'Google Drive storage is full. Free some space in Drive; nothing was deleted.');
    if (/insufficient|scope|PERMISSION/i.test(reason)) throw new DriveError('scope', 'Google Drive access was not allowed.');
  }
  return res;
}
async function json(res, what) {
  if (!res.ok) throw new DriveError('failed', `Google Drive could not ${what} (error ${res.status}).`);
  return res.json();
}

// The owner's "CaterDesk Backups" folder: found by its CaterDesk mark (the oldest if two devices both made one), else
// made (for a backup) or null (for a restore: nothing is created just to look)
export async function ensureFolder({ create = true } = {}) {
  const q = `mimeType='${FOLDER_MIME}' and appProperties has { key='caterdesk' and value='folder' } and trashed=false`;
  const found = await json(await call(`${API}/files?q=${encodeURIComponent(q)}&spaces=drive&orderBy=createdTime&fields=files(id)`), 'look for the backup folder');
  if (found.files?.length && safeId(found.files[0].id)) return found.files[0].id;
  if (!create) return null;
  const made = await json(await call(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME, appProperties: { caterdesk: 'folder' } }) }), 'make the backup folder');
  if (!safeId(made.id)) throw new DriveError('failed', 'Google Drive could not make the backup folder.');
  return made.id;
}

// Free space on the owner's Drive in bytes (Infinity if the account has no limit)
export async function freeSpace() {
  const r = await json(await call(`${API}/about?fields=storageQuota`), 'read the free space');
  const limit = Number(r?.storageQuota?.limit), usage = Number(r?.storageQuota?.usage) || 0;
  return Number.isFinite(limit) && limit > 0 ? Math.max(0, limit - usage) : Infinity;
}

const wait = ms => new Promise(r => setTimeout(r, ms));
// Where an interrupted upload stands: how many bytes Drive has, or the finished file
async function uploadStatus(session, total) {
  const res = await call(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${total}` } });
  if (res.status === 200 || res.status === 201) return { file: await res.json() };
  if (res.status === 308) { const m = /bytes=0-(\d+)/.exec(res.headers.get('Range') || ''); return { offset: m ? Number(m[1]) + 1 : 0 }; }
  throw new DriveError('failed', `The upload could not be resumed (error ${res.status}). Your last verified backup is unchanged.`);
}

/* Upload one encrypted backup (a Blob) into the folder, piece by piece with real progress, resuming after a dropped
   connection. Then check Drive holds exactly these bytes. A copy that does not check out is moved to Drive's bin.
   Resolves with { id, name, size }. */
export async function uploadBackup(folderId, blob, { name, appProperties, sha256, onProgress = () => {} }) {
  if (!safeId(folderId)) throw new DriveError('failed', 'The backup folder on Google Drive was not found.');
  const total = blob.size;
  const start = await call(`${UP}/files?uploadType=resumable&fields=id,name,size,sha256Checksum`, { method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(total) },
    body: JSON.stringify({ name, parents: [folderId], mimeType: 'application/octet-stream', appProperties }) });
  const session = start.ok && start.headers.get('Location');
  if (!session || !session.startsWith(UP + '/')) throw new DriveError('failed', `Google Drive did not accept the upload (error ${start.status}).`);
  let offset = 0, drops = 0, file = null;
  onProgress(0, total);
  while (!file) {
    const end = Math.min(total, offset + UPLOAD_CHUNK);
    let res = null;
    // One piece at a time in memory (a plain buffer, which every phone browser can send)
    const piece = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    try { res = await call(session, { method: 'PUT', headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${total}` }, body: piece }); }
    catch (e) { if (e.code !== 'offline') throw e; }
    if (res && (res.status === 200 || res.status === 201)) { file = await res.json(); break; }
    if (res && res.status === 308) {
      const m = /bytes=0-(\d+)/.exec(res.headers.get('Range') || ''); offset = m ? Number(m[1]) + 1 : 0; drops = 0;
      onProgress(offset, total); continue;
    }
    if (res && res.status < 500) throw new DriveError('failed', `The upload stopped (error ${res.status}). Your last verified backup is unchanged.`);
    // Dropped connection or a Google server hiccup: wait, ask Drive how far it got, and carry on from there
    if (++drops > DROPS) throw new DriveError('offline', 'The connection kept dropping, so the upload stopped. Your last verified backup is unchanged.');
    await wait(Math.min(8000, 500 * 2 ** drops));
    try { const s = await uploadStatus(session, total); if (s.file) file = s.file; else { offset = s.offset; onProgress(offset, total); } }
    catch (e) { if (e.code !== 'offline') throw e; }
  }
  onProgress(total, total);
  if (!safeId(file?.id)) throw new DriveError('failed', 'Google Drive did not confirm the upload. Your last verified backup is unchanged.');
  if (!file.sha256Checksum) file = await json(await call(`${API}/files/${file.id}?fields=id,name,size,sha256Checksum`), 'check the upload');
  if (String(file.size) !== String(total) || file.sha256Checksum !== sha256) {
    try { await trash(file.id); } catch { /* reported below either way */ }
    throw new DriveError('unverified', 'Upload could not be verified: Drive does not hold exactly what was sent. That copy was moved to Drive\'s bin. Your last verified backup is unchanged.');
  }
  return { id: file.id, name: file.name || name, size: total };
}

// CaterDesk backups in the folder, newest first: { id, name, size, createdAt, keyId, appVersion }
export async function listBackups(folderId) {
  if (!safeId(folderId)) return [];
  const q = `'${folderId}' in parents and trashed=false`;
  const r = await json(await call(`${API}/files?q=${encodeURIComponent(q)}&spaces=drive&pageSize=1000&orderBy=createdTime desc&fields=files(id,name,size,createdTime,appProperties)`), 'list the backups');
  return (r.files || []).filter(f => safeId(f.id) && f.appProperties?.caterdesk === '1')
    .map(f => ({ id: f.id, name: String(f.name || ''), size: Number(f.size) || 0, createdAt: f.appProperties.createdAt || f.createdTime || '', keyId: String(f.appProperties.keyId || ''), appVersion: String(f.appProperties.appVersion || '') }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function downloadBackup(id, maxBytes) {
  if (!safeId(id)) throw new DriveError('failed', 'That backup was not found on Google Drive.');
  const res = await call(`${API}/files/${id}?alt=media`);
  if (!res.ok) throw new DriveError('failed', `The backup could not be downloaded (error ${res.status}). Nothing was changed.`);
  if (Number(res.headers.get('Content-Length')) > maxBytes) throw new DriveError('failed', 'This file is too large to be a CaterDesk backup. Nothing was changed.');
  return new Uint8Array(await res.arrayBuffer());
}

// Move a file to Drive's bin (Google empties the bin after 30 days, or sooner if the owner does). Never deletes.
export async function trash(id) {
  if (!safeId(id)) return;
  await json(await call(`${API}/files/${id}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ trashed: true }) }), 'tidy old backups');
}

/* Which backups to move to the bin: keep the 3 newest, the newest of each of the last 14 days that have one, of the
   last 8 weeks and of the last 12 months (by this phone's calendar). Everything else goes to the bin. */
export function toPrune(files) {
  const sorted = [...files].filter(f => f.createdAt).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const keep = new Set(sorted.slice(0, 3).map(f => f.id));
  const pad = n => String(n).padStart(2, '0');
  const day = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const week = d => { const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7); return day(m); };   // the Monday
  const month = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  for (const [bucket, n] of [[day, 14], [week, 8], [month, 12]]) {
    const seen = new Set();
    for (const f of sorted) { const k = bucket(new Date(f.createdAt)); if (seen.has(k)) continue; if (seen.size >= n) break; seen.add(k); keep.add(f.id); }
  }
  return sorted.filter(f => !keep.has(f.id)).map(f => f.id);
}
