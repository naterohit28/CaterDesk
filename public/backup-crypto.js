/* CaterDesk encrypted backup file (.cdbk) and recovery key (design: docs/DRIVE_BACKUP_DESIGN.md, section 5).
   Browser Web Crypto only: AES-256-GCM, SHA-256, gzip. No custom cryptography, no network, no secrets in code.

   Recovery key: 256 random bits, written as 13 groups of 4 Crockford base32 characters plus a 4-character check
   group (14 groups). Typing slips are caught by the check group; at setup the typed key is also compared group by
   group with the one shown, so the app can say which group is wrong.

   File: "CDBK" | format (1 byte) | header length (4 bytes, big-endian) | header JSON | chunk 0 | chunk 1 | …
   The backup JSON is gzip-compressed and cut into 4 MiB pieces; each piece is encrypted on its own:
     iv  = header.baseIv with its last 4 bytes XOR the chunk number
     aad = SHA-256(header bytes) | chunk number (4 bytes) | 1 if it is the last chunk, else 0
   so a changed header, a changed, reordered or dropped chunk, or a file cut short all fail to decrypt.
   After decrypting and decompressing, the SHA-256 of the backup JSON must equal header.plainSha256. */

export const CHUNK = 4 * 1024 * 1024;
const MAGIC = [0x43, 0x44, 0x42, 0x4b];   // "CDBK"
const FORMAT = 1, TAG = 16;
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford: no I, L, O, U
const enc = new TextEncoder(), dec = new TextDecoder();

export class BackupError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const sha256 = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

function toBase32(bytes, chars) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } value &= (1 << bits) - 1; }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out.slice(0, chars);
}
function fromBase32(text) {
  let bits = 0, value = 0; const out = [];
  for (const c of text) { const v = B32.indexOf(c); if (v < 0) throw new BackupError('chars', 'The recovery key has a character that is not used in recovery keys.');
    value = (value << 5) | v; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; value &= (1 << bits) - 1; } }
  return { bytes: new Uint8Array(out), rest: value, restBits: bits };
}
async function checkGroup(raw) { return toBase32((await sha256(raw)).slice(0, 3), 4); }

// A new random recovery key: its bytes and how it is shown (14 groups of 4)
export async function newRecoveryKey() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return { raw, text: await recoveryKeyText(raw) };
}
export async function recoveryKeyText(raw) {
  const s = toBase32(raw, 52) + await checkGroup(raw);
  return s.match(/.{4}/g).join('-');
}
// What was typed → the key's bytes. Spaces, dashes and lower case are fine; O reads as 0, I and L as 1.
export async function parseRecoveryKey(typed) {
  const s = String(typed || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 56) throw new BackupError('length', `A recovery key has 56 letters and numbers (14 groups of 4); this has ${s.length}.`);
  const { bytes, rest } = fromBase32(s.slice(0, 52));
  const raw = bytes.slice(0, 32);
  if (bytes.length !== 32 || rest !== 0) throw new BackupError('checksum', 'This recovery key is not right. Check each group against the written key.');
  const check = await checkGroup(raw);
  if (check !== s.slice(52)) throw new BackupError('checksum', 'This recovery key is not right. Check each group against the written key.');
  return raw;
}
// At setup: which groups (1–14) of the typed key differ from the key shown
export function differingGroups(shownText, typed) {
  const norm = t => String(t || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  const a = norm(shownText), b = norm(typed), out = [];
  for (let g = 0; g < 14; g++) if (a.slice(g * 4, g * 4 + 4) !== b.slice(g * 4, g * 4 + 4)) out.push(g + 1);
  return out;
}
export const keyIdOf = async raw => hex((await sha256(raw)).slice(0, 8));
// The key for encrypting on this phone: usable, but its bytes cannot be read back out (non-extractable)
export const importBackupKey = raw => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

const ivFor = (base, i) => { const iv = base.slice(); const v = new DataView(iv.buffer); v.setUint32(8, v.getUint32(8) ^ i); return iv; };
const aadFor = (hh, i, last) => { const a = new Uint8Array(37); a.set(hh); new DataView(a.buffer).setUint32(32, i); a[36] = last ? 1 : 0; return a; };

/* The backup JSON (string) → .cdbk bytes, as Blob parts. Compression and encryption run piece by piece, so a large
   backup with many bill photos never needs a second full copy in memory. */
export async function encryptBackup(key, keyId, json, { appVersion = '', createdAt = new Date().toISOString() } = {}) {
  const plain = enc.encode(json);
  const header = { keyId, baseIv: b64(crypto.getRandomValues(new Uint8Array(12))), chunkSize: CHUNK, createdAt, appVersion, compressed: 'gzip', plainSha256: hex(await sha256(plain)) };
  const headerBytes = enc.encode(JSON.stringify(header)), hh = await sha256(headerBytes), base = unb64(header.baseIv);
  const pre = new Uint8Array(9 + headerBytes.length);
  pre.set(MAGIC); pre[4] = FORMAT; new DataView(pre.buffer).setUint32(5, headerBytes.length); pre.set(headerBytes, 9);
  const parts = [pre];
  const reader = new Blob([plain]).stream().pipeThrough(new CompressionStream('gzip')).getReader();
  // Compressed bytes wait in a queue until a full piece is ready (each byte is copied once)
  const held = []; let heldLen = 0, pending = null, i = 0;
  const take = n => { const out = new Uint8Array(n); let o = 0;
    while (o < n) { const h = held[0], k = Math.min(h.length, n - o); out.set(h.subarray(0, k), o); o += k; if (k === h.length) held.shift(); else held[0] = h.subarray(k); }
    heldLen -= n; return out; };
  const seal = async (piece, last) => { parts.push(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivFor(base, i), additionalData: aadFor(hh, i, last) }, key, piece))); i++; };
  for (;;) {
    const { value, done } = await reader.read();
    if (value?.length) { held.push(value); heldLen += value.length; }
    // The last piece is sealed with the "last" mark, so one is always held back until the next arrives or input ends
    while (heldLen > CHUNK || (done && heldLen)) {
      const piece = take(Math.min(CHUNK, heldLen));
      if (pending) await seal(pending, false);
      pending = piece;
    }
    if (done) break;
  }
  await seal(pending || new Uint8Array(0), true);
  return { parts, header, size: parts.reduce((n, p) => n + p.length, 0) };
}

// What a .cdbk file says about itself, without decrypting (key ID, date, app version)
export function readHeader(bytes) {
  if (bytes.length < 9 || MAGIC.some((m, k) => bytes[k] !== m)) throw new BackupError('format', 'This is not an encrypted CaterDesk backup.');
  if (bytes[4] !== FORMAT) throw new BackupError('format', 'This encrypted backup was made by a newer version of CaterDesk. Update the app first.');
  const len = new DataView(bytes.buffer, bytes.byteOffset).getUint32(5);
  if (9 + len > bytes.length) throw new BackupError('format', 'This encrypted backup is cut off.');
  const headerBytes = bytes.slice(9, 9 + len);
  let header; try { header = JSON.parse(dec.decode(headerBytes)); } catch { throw new BackupError('format', 'This encrypted backup is damaged.'); }
  if (typeof header.keyId !== 'string' || typeof header.baseIv !== 'string' || header.chunkSize !== CHUNK || typeof header.plainSha256 !== 'string')
    throw new BackupError('format', 'This encrypted backup is damaged.');
  return { header, headerBytes, body: bytes.subarray(9 + len) };
}

// .cdbk bytes + key → the backup JSON (string). Any change to the file, or the wrong key, fails before anything is used.
export async function decryptBackup(key, keyId, bytes) {
  const { header, headerBytes, body } = readHeader(bytes);
  if (header.keyId !== keyId) throw new BackupError('key', 'This backup was made with a different recovery key.');
  const hh = await sha256(headerBytes), base = unb64(header.baseIv), size = CHUNK + TAG, pieces = [];
  const count = Math.max(1, Math.ceil(body.length / size));
  if (body.length < TAG) throw new BackupError('tampered', 'This encrypted backup is damaged or incomplete. Nothing was changed.');
  for (let i = 0; i < count; i++) {
    const part = body.subarray(i * size, Math.min(body.length, (i + 1) * size));
    try { pieces.push(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivFor(base, i), additionalData: aadFor(hh, i, i === count - 1) }, key, part))); }
    catch { throw new BackupError('tampered', 'This encrypted backup is damaged, incomplete or not made with this key. Nothing was changed.'); }
  }
  let plain;
  try { plain = new Uint8Array(await new Response(new Blob(pieces).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); }
  catch { throw new BackupError('tampered', 'This encrypted backup is damaged. Nothing was changed.'); }
  if (hex(await sha256(plain)) !== header.plainSha256) throw new BackupError('tampered', 'This encrypted backup is damaged. Nothing was changed.');
  return dec.decode(plain);
}
