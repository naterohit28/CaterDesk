# CaterDesk – Encrypted Google Drive backup and recovery (design, revision 2)

**Status:** design for owner approval. Nothing in this document is built, configured or deployed. No Google Cloud
project, OAuth client, scope or credential exists for CaterDesk yet. None will be created, requested or added to the
code, and no live Drive access will be enabled, until the owner approves this revised implementation design in chat.

**Owner decisions already given (15 Nov 2026):**

- an owner-visible CaterDesk backup folder
- the least-privilege `drive.file` scope
- a random 256-bit recovery key
- retention of 14 daily, 8 weekly and 12 monthly backups
- narrowly scoped Google connections
- an owner-controlled Google Cloud project and credentials

**Revision 2 changes:**

- Google Identity Services (GIS) token client instead of a hand-made `response_type=token` flow, with the minimal CSP
  changes
- full recovery-key verification before setup completes
- accurate Drive bin limits
- chunked encryption and tests for large backups with bill photos
- foreground-assisted backup clearly separated from unattended backup
- historical intelligence kept separate from cloud backup
- Android verification as a gate

## 1. Goals and boundaries

- **IndexedDB stays the authoritative database.** The app works fully offline. Drive holds encrypted copies only, and
  nothing is ever read back from Drive automatically.
- **Backup, not sync.** A backup is a point-in-time encrypted snapshot: no live multi-device synchronisation, no
  automatic merge, no background reconciliation. Restoring is a deliberate step on one device.
- **Everything is included.** The backup is the existing verified backup file (`exportAllData()` plus backed-up
  preferences). It contains:
  - events, with quotations, approved menu versions, menus sent to clients, vendor orders and reminders, and meal
    services
  - expenses, vendors, client and vendor payments
  - bill photos and other attachments
  - the menu library and business details
  - the record-count and SHA-256 manifest

  Restore uses the same import checks as local backups.
- **Encrypted before it leaves the phone.** Google receives only ciphertext. File names and Drive properties carry no
  client names, amounts or menu content.
- **Owner-visible and narrowly scoped.** A `CaterDesk Backups` folder in the owner's My Drive, with
  `https://www.googleapis.com/auth/drive.file` only: the app can reach only the files it created.
- **No secrets in the frontend.**
  - The OAuth client ID is public by design; it identifies the app and grants nothing alone. It is the only Google
    value in the code, added only after approval.
  - No client secret, API key, refresh token, access token or recovery key is kept in readable form in the code,
    repository, Vercel, CI, logs, the error reporter or browser storage.
- **No AI or analytics services.** Backup content and business data are never sent to an AI or analytics service.
  The only external destination is the owner's Google Drive, and only as ciphertext.

## 2. Historical intelligence stays separate from cloud backup

- CaterDesk's learning features (price suggestions, counter take-up, dish-to-counter learning, cost vs usual) read
  **only the local IndexedDB**. They never read Drive, never run on Google's servers, and never upload derived
  figures.
- Backups do not contain separate "intelligence" files. Any learned values are recomputed locally from the restored
  records.
- A restore puts records into the local database through the existing import, merging by record ID and revision. A
  backup restored twice does not duplicate records, so history is not double-counted. There is no second database.
- Drive is never used as a data source for reports, suggestions or comparisons.

## 3. Google Cloud setup (owner; about 15 minutes; free; after approval of this revision)

Use the owner's Google account. No billing account is needed.

1. **console.cloud.google.com**: create a project, e.g. `CaterDesk Backup`.
2. **APIs & Services → Library → Google Drive API → Enable.** No other API.
3. **Google Auth Platform → Branding:**
   - App name `CaterDesk`.
   - Support email and developer contact: the owner's email.
   - Home page `https://expense-calculator-kohl.vercel.app` (optional while in Testing).
4. **Audience:**
   - User type **External**, publishing status **Testing**.
   - Add the owner's Gmail, and any staff account that will restore, as **test users**.
5. **Data access:** add **only** `https://www.googleapis.com/auth/drive.file`. Do not add `drive`, `drive.readonly`,
   `drive.metadata` or `drive.appdata`. `drive.file` is classed by Google as a non-sensitive scope.
6. **Clients → Create client → Web application**, `CaterDesk web`:
   - **Authorised JavaScript origins:** `https://expense-calculator-kohl.vercel.app`, plus `http://localhost:8790` for
     local testing. Remove the local origin later if preferred.
   - **Redirect URIs:** none. The GIS token client uses a popup and does not need them.
7. Copy the **Client ID** (`….apps.googleusercontent.com`) and send it in chat when D3 is approved. **Never send or
   download the client secret**; CaterDesk does not use it.

Vercel preview domains change on every deploy and are deliberately **not** authorised. Drive backup works only on the
production address and the local test server.

## 4. Sign-in: Google Identity Services token client (browser-only)

**Flow:**

1. CaterDesk loads `https://accounts.google.com/gsi/client` **only when the owner opens Backup or taps Connect**, not
   on every app start. Day-to-day use loads no Google code.
2. `google.accounts.oauth2.initTokenClient({ client_id, scope: 'https://www.googleapis.com/auth/drive.file', callback })`.
3. `requestAccessToken()` is called **inside the owner's tap** (Connect, Back up now), so the popup is not blocked.
   - First time: Google's consent screen shows the `drive.file` permission only.
   - Later, while signed in to Google: `prompt: ''` gives a token without showing consent again.
4. GIS returns an access token, valid for about 1 hour:
   - kept **in memory only**: never in localStorage, IndexedDB, logs or the error reporter
   - dropped when the app closes
   - no refresh token in this flow, so no long-lived Google access exists anywhere
5. Drive calls go from the browser to `https://www.googleapis.com` with that token.
6. **Disconnect** in CaterDesk calls `google.accounts.oauth2.revoke(token)`. The owner can also revoke at
   `myaccount.google.com/permissions`, after which the app shows "Google Drive not connected" and keeps working
   offline.

**Minimal CSP changes** (from the current `vercel.json` policy; nothing else changes):

| Directive | Current | Add | Why |
|---|---|---|---|
| `script-src` | `'self'` | `https://accounts.google.com/gsi/client` | the GIS library (exact file, not the whole host) |
| `connect-src` | `'self'` | `https://www.googleapis.com` | Drive API and uploads |
| `connect-src` | | `https://accounts.google.com/gsi/` | GIS token-client calls |
| `frame-src` | (inherits `'self'`) | `https://accounts.google.com/gsi/` only **if** the D2 CSP violation report shows the token client needs it | Google lists it for GIS; the button and One Tap use it, but CaterDesk does not |
| `style-src` | unchanged | `https://accounts.google.com/gsi/style` only **if** needed | not expected (no Google button is rendered) |

- In D2 the policy first ships as **`Content-Security-Policy-Report-Only`** on the local test server to capture
  exactly what GIS needs. Only the confirmed entries go into the enforced policy, and that change is a separate,
  reviewable commit.
- No `Cross-Origin-Opener-Policy` header is set today. If one is added later it must be
  `same-origin-allow-popups`, or the GIS popup cannot return the token.
- The service worker never caches Google responses; requests to other origins pass through untouched.

**Android (gate before relying on it):**

- Google blocks sign-in inside embedded WebViews (`disallowed_useragent`).
- If the installed wrapper is a Trusted Web Activity (Chrome), GIS works.
- If it is a WebView, **Connect** must open CaterDesk in Chrome. Backups then run in the Chrome tab, which shares no
  database with the WebView, so the wrapper must be a TWA for Drive backup of the installed app's data.
- Acceptance test M2 must pass on the owner's phone with the installed app before D3 is accepted.

## 5. Encryption and key recovery

- **Algorithm:** AES-256-GCM via the browser's Web Crypto API. No custom cryptography.
- **Recovery key (approved):**
  - At setup the phone generates a random 256-bit key.
  - It is shown **once** as 13 groups of 4 characters (Crockford base32 plus a checksum group), e.g. `CDRK-7Q2M-…-H4XD`.
  - The owner writes or prints it and stores it away from the phone (password manager or sealed envelope).
- **Full verification before setup completes:**
  - The owner types the **entire** recovery key back.
  - The checksum group catches typing slips and says which group is wrong.
  - The app derives the key ID from what was typed and must match the generated key exactly.
  - Only then is setup marked complete and backups allowed. A partial match never completes setup.
- **On the phone:**
  - The key is imported as a **non-extractable** `CryptoKey` in IndexedDB (`meta`), so backups run without asking
    for it, and no script can read its bytes.
  - A key ID (first 8 bytes of SHA-256 of the key) is stored openly, so restore can say "this backup needs a
    different recovery key".
- **No recovery key, no restore.** Google cannot decrypt the backups, and nor can the owner without the key. Losing
  the phone **and** the key makes the Drive backups unrecoverable. This is stated plainly at setup and accepted with
  a tap.
- **Changing the key:**
  - A new key encrypts future backups. Older backups still need the old key; each backup lists its key ID.
  - Changing the key requires the full verification again.

**File format `.cdbk` (chunked, so large backups with many bill photos fit in phone memory):**

```
"CDBK" | format 1 | header length | header JSON | chunk 1 | chunk 2 | … | chunk N
header = { keyId, baseIv (12 random bytes), chunkSize: 4 MiB, chunks: N, createdAt, appVersion,
           compressed: "gzip", plainSha256 }
chunk i = AES-256-GCM( key, iv = baseIv XOR i, aad = SHA-256(header bytes) || i || (i === N ? "last" : "more"),
                       data = 4 MiB of gzip-compressed backup JSON )  → ciphertext + 16-byte tag
```

- Each chunk is authenticated separately. Its index and the "last" flag in the AAD stop chunks being reordered,
  dropped or truncated.
- Changing the header breaks every chunk.
- `plainSha256` is checked after decryption and decompression.
- Encryption and upload work chunk by chunk, so only a few chunks are in memory at once.

## 6. Backup behaviour

### 6.1 What "automatic" means here (foreground-assisted, not unattended)

A web app on a phone **cannot run while it is closed**. CaterDesk will **not** promise a guaranteed daily backup at a
fixed time. What it does:

- **Foreground-assisted automatic backup.**
  - A backup is *due* when the last **verified** backup is older than 24 hours, or the data changed since it and it
    is older than 6 hours.
  - When CaterDesk is open, online, idle and holds a Google token from the last hour, a due backup starts on its own.
    It never interrupts typing or an open sheet.
- **One-tap backup** when due but no token is held: a quiet banner, **Back up now**. The tap is needed because Google
  requires a user action to open sign-in.
- **Manual backup:** Settings → Backup → **Back up now**, any time.
- **Honest wording:**
  - The status never says "daily backup is on". It shows the last verified backup and whether one is due.
  - If no verified backup exists for 3 days, Home shows a clear warning.
- **Unattended backups** (while the app is closed) would need a server holding standing access to the owner's Drive
  (refresh token plus client secret). That is out of scope and not recommended. It would be a separate decision.

### 6.2 Steps, verification and status

| Step | Shown as |
|---|---|
| Export and self-check (manifest) | Preparing backup… |
| Encrypt chunk by chunk, and test-decrypt chunk 1 and the last chunk locally | Encrypting… |
| Resumable upload with real byte progress; resumes after a dropped connection | Uploading 21 MB of 63 MB… |
| Verify: Drive's `sha256Checksum` and `size` equal the uploaded ciphertext | Checking upload… |
| Recorded | **Saved to Drive and verified** · time |

**Two separate records, never merged:**

- **Last backup attempt:** time, result, reason if failed (offline, sign-in needed, storage full, checksum mismatch,
  cancelled).
- **Last verified backup:** time, file, size, key ID. A failed attempt never changes it.

**Weekly deep check:** the app downloads the newest backup, decrypts it, and runs the full import check as a dry run
that writes nothing. Only then is it marked **restore-tested**.

### 6.3 Versions kept, and the Drive bin (accurate limits)

- **Keep:** the last 14 daily, 8 weekly and 12 monthly backups, plus the 3 newest verified ones, which are never
  pruned.
- **Prune:** older backups are moved to **Drive's bin** (`trashed: true`). The app never deletes a file permanently.
- **Limits of the bin:**
  - Google permanently deletes items in the bin **after 30 days**.
  - The owner (or anyone with access to the account) can **empty the bin sooner**.
  - Items in the bin **still count against the owner's Drive storage** until they are gone.
  - So a pruned backup is recoverable for **at most** 30 days, and possibly less. The 14/8/12 backups kept outside
    the bin are the real retention.
- **Storage:**
  - Before uploading, the app checks the owner's free Drive storage (`about.get` → `storageQuota`, allowed under
    `drive.file`).
  - If the backup does not fit, it reports "Drive storage full". It never deletes or trashes anything to make room.
- **Names and properties:**
  - File name: `CaterDesk-backup-2026-11-15-2104-<random device tag>.cdbk`.
  - `appProperties`: `caterdesk=1`, `format=1`, `keyId`, `createdAt`, `appVersion` only. No business data appears in
    names or properties.

## 7. Restore on another device

1. Open CaterDesk on the new device and choose **Restore from Google Drive**.
2. Connect Google Drive with the same account. `drive.file` access belongs to the app, so the new device sees the
   backups CaterDesk created.
3. Pick a backup: date, size, app version, verified or restore-tested.
4. Type the full recovery key. The key ID must match before anything is downloaded.
5. Download chunk by chunk, checking each GCM tag. Then decompress, check `plainSha256`, and run the existing
   `prepareImport` checks (manifest counts, store hashes, field validation).
6. Preview the restore: counts of events, quotations, approved menus, orders, bills and photos.
7. **Empty device:** restore everything. **Device with data:** the owner chooses **Replace** (a local safety backup
   is saved first) or **Merge** (existing merge rules). There is no silent overwrite.
8. Re-count every store against the manifest and show **Restored and checked**.

## 8. Implementation in separate reviewable PRs

| PR | Contents | Google? |
|---|---|---|
| **D1** (may start now) | `.cdbk` chunked format, key generation, recovery-key display and full verification, encrypt/decrypt, local **Save encrypted backup** and **Restore encrypted backup** (file on the phone). Tests with synthetic data, including large backups with bill photos. | No |
| D2 | GIS token client loaded on demand, Drive client (folder, resumable upload, checksum verification, listing, retention to bin, storage check, restore from Drive). Client ID config left **empty**, so the feature stays hidden. Tests against a **mocked** Drive and GIS served locally. CSP report-only first, then the minimal enforced change in its own commit. | Mocked only |
| D3 | Owner adds the approved client ID; manual tests M1–M7 with the real account and the installed Android app. | After approval |
| D4 | Due logic, banner, weekly deep check, status screen. | Mocked + manual |

## 9. Acceptance tests

**Automated** (Playwright, local server, synthetic data, Drive and GIS mocked; no real Google account anywhere in
tests or CI):

1. **A1 Round trip:** encrypt the full synthetic backup (photos, quotations, approved menus, orders, reminders), then
   decrypt and import into a fresh profile. Every store must be identical after normalising `_rev`.
2. **A2 Large backup:**
   - Synthetic events with **300 bill photos totalling about 120 MB**: encrypt, decrypt and import round trip.
   - Peak memory is measured (`performance.measureUserAgentSpecificMemory` where available, else the chunks held at
     once) and must stay within a set ceiling.
   - The upload must resume after a simulated drop mid-file.
3. **A3 Wrong key:** "This backup needs a different recovery key". Nothing is written.
4. **A4 Tamper:**
   - flipping one byte in any chunk, its tag, or the header
   - dropping, reordering or truncating chunks

   Each makes restore fail with nothing written.
5. **A5 Full key verification:** setup refuses completion on any wrong, missing or swapped group, and says which group
   is wrong. Only the full, exact key completes setup.
6. **A6 No plaintext leaves:** bytes sent to the mocked Drive contain no event, client, vendor or dish name. File
   names and `appProperties` contain only the allowed fields.
7. **A7 Token hygiene:** after a backup, nothing in localStorage, IndexedDB, the error-reporter queue, URLs or logs
   contains an access token.
8. **A8 Scope:** the token client is created with exactly `https://www.googleapis.com/auth/drive.file`.
9. **A9 GIS on demand:** opening the app, events, expenses and reports loads nothing from `accounts.google.com`.
   Only opening Backup does.
10. **A10 Upload verification:** a mismatched `sha256Checksum` or size shows "Upload could not be verified". *Last
    verified* is unchanged and the attempt is recorded as failed.
11. **A11 Offline / expired token / storage full:** each attempt fails honestly, *last verified* is unchanged, and
    the due banner offers one-tap backup.
12. **A12 Retention:** a 120-day pruning simulation keeps 14/8/12 plus the 3 newest verified. Pruned files are only
    trashed, never deleted.
13. **A13 Restore safety:** onto a device with data, Replace or Merge must be chosen, and Replace saves a local safety
    backup first. The manifest re-count must pass.
14. **A14 CSP:** the enforced policy differs from today's only by the entries confirmed in section 4. No other
    third-party origins are added.
15. **A15 Old app versions:** data restored by this version still opens in the released 4.21.1 app (the existing
    compatibility test is extended).
16. **A16 Intelligence stays local:** with Drive mocked and connected, opening reports and suggestions makes no
    request to Google.

**Manual, by the owner** (after D3):

- **M1** First Connect shows Google's consent with only the specific-files permission (`drive.file`).
- **M2** **Installed Android app:** Connect works (TWA). If the wrapper turns out to be a WebView, the result is
  recorded and Drive backup is not accepted for the installed app until fixed.
- **M3** `CaterDesk Backups` appears in My Drive with `.cdbk` files. Downloading one shows unreadable content.
- **M4** A backup with real bill photos completes on the phone over mobile data. Progress and size are shown, and a
  network drop resumes.
- **M5** Next day, opening the app runs the due backup, or offers the one-tap banner. *Last attempt* and *last
  verified* are shown separately.
- **M6** On a second device or browser profile with no data, restore with the recovery key. Counts match. Open a
  quotation, an approved menu, a vendor order and a bill photo.
- **M7** Revoke access at `myaccount.google.com/permissions`. The app shows "Google Drive not connected", keeps
  working, and local backups still work.

## 10. Owner decisions still needed

1. **Approve this revised design**, in particular GIS loaded on demand and the minimal CSP additions in section 4.
2. **After D1 and D2 are reviewed:** do the Google Cloud setup in section 3 and send the Client ID (never the secret)
   for D3.
