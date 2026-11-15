# CaterDesk – Encrypted Google Drive backup and recovery (design)

Status: **design for owner approval**. Nothing in this document is built, configured or deployed. No Google Cloud
project, OAuth client, scope or credential exists for CaterDesk yet, and none will be created or added to the code
without the owner's explicit approval in chat.

## 1. Goals and boundaries

- **IndexedDB stays the authoritative database.** The app keeps working fully offline. Drive holds encrypted copies
  only. Nothing is ever read back from Drive automatically.
- **Backup, not sync.** A backup is a point-in-time encrypted snapshot. There is no live multi-device synchronisation,
  no automatic merge and no background reconciliation. Restoring is a deliberate step on a device.
- **Everything is included.** The backup is the existing verified backup file (`exportAllData()` plus the backed-up
  preferences), which already holds:
  - events, with their quotations, approved menu versions, menus sent to clients, vendor orders and meal services
  - expenses, vendors, client and vendor payments
  - bill photos and other attachments
  - the menu library and business details
  - the record-count and SHA-256 manifest

  Restoring therefore goes through the same import checks that local backups already use.
- **Encrypted before it leaves the phone.** Google receives only ciphertext. File names and Drive properties carry no
  client names, amounts or menu content.
- **Owner-visible and narrowly scoped.** A `CaterDesk Backups` folder in the owner's own My Drive. The app's access
  is limited to the files it creates (`drive.file`).
- **No secrets in the frontend.**
  - The OAuth client ID is public by design: it identifies the app and grants nothing on its own. It is the only
    Google value in the code, and only after approval.
  - No client secret, API key, refresh token or recovery key is stored in the code, the repository, Vercel, CI or
    browser storage in readable form.
- **No AI services.** Backup content is never sent to any AI or analytics service. The only external destination is
  the owner's Google Drive.

## 2. Google Cloud setup (owner does this; about 15 minutes; free)

Use the owner's own Google account. No billing account is needed.

1. Open **console.cloud.google.com**. Create a project, for example `CaterDesk Backup`.
2. **APIs & Services → Library → Google Drive API → Enable.** No other API is needed.
3. **Google Auth Platform → Branding** (OAuth consent screen):
   - App name: `CaterDesk`. User support email and developer contact: the owner's email.
   - App domain / home page: `https://expense-calculator-kohl.vercel.app` (optional while in Testing).
4. **Audience:** User type **External**, publishing status **Testing**. Add the owner's Gmail (and any staff account
   that will restore) as **test users**.
5. **Data access → Add or remove scopes:** add **only**
   `https://www.googleapis.com/auth/drive.file`.
   - Do **not** add `drive`, `drive.readonly`, `drive.metadata` or `drive.appdata`.
   - `drive.file` is a non-sensitive scope: only files this app created or the user opened with it are reachable.
6. **Clients → Create client → Web application**, name `CaterDesk web`.
   - **Authorised JavaScript origins:** `https://expense-calculator-kohl.vercel.app`; `http://127.0.0.1:8790` for
     local testing only. Remove it after testing if preferred.
   - **Authorised redirect URIs:** `https://expense-calculator-kohl.vercel.app/oauth-return.html` and
     `http://127.0.0.1:8790/oauth-return.html`.
7. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and send it in chat when approving step 4 of the
   rollout. **Do not send or download the client secret**; CaterDesk never uses it.

Vercel preview deployments use changing domains and are deliberately **not** authorised. Drive backup works only on
the production address and the local test server.

## 3. OAuth architecture

**Recommended: browser-only OAuth 2.0 token flow, with no third-party script.**

1. The owner taps **Connect Google Drive** or **Back up now**.
2. CaterDesk opens a popup to `https://accounts.google.com/o/oauth2/v2/auth` with:
   - `client_id`, `redirect_uri=…/oauth-return.html`, `response_type=token`, `scope=…/drive.file`
   - `include_granted_scopes=false`, `prompt=` (consent only the first time)
   - a random `state` kept in memory
3. Google shows its own sign-in and consent screen. CaterDesk never sees the Google password.
4. `oauth-return.html` (served by CaterDesk, same origin):
   - reads the access token from the URL fragment
   - checks `state`
   - posts the token to the opener with `postMessage` restricted to the CaterDesk origin
   - clears the fragment and closes itself
5. The access token, valid for about 1 hour:
   - lives **in memory only**: never in localStorage, IndexedDB, logs or the error reporter
   - is dropped when the app closes
   - no refresh token exists in this flow
6. Drive calls go directly from the browser to `https://www.googleapis.com` with that token.

Why not Google's sign-in script (GIS)? CaterDesk's Content Security Policy allows only its own scripts
(`script-src 'self'`). GIS would need `https://accounts.google.com` added to `script-src` and frames, which loosens
the policy for the whole app. The token flow above needs only:

- `connect-src` + `https://www.googleapis.com` (API and uploads)
- the popup itself (a top-level window, not governed by this page's CSP)

The CSP change is reviewable on its own and limited to one origin.

Why not a server with refresh tokens? It would let backups run while the app is closed, but:

- the server would hold standing access to the owner's Drive and need the client secret in Vercel
- a breach of the server would expose that access
- the server would move from "static app" to "service holding credentials"

Not recommended unless the owner later decides unattended backups are worth that risk.

**Android check (must pass before relying on it):** Google blocks sign-in inside embedded WebViews. If the installed
Android wrapper is a Trusted Web Activity (Chrome), sign-in works. If it is a plain WebView, the **Connect** step must
open in Chrome, after which backups continue in the browser tab. Acceptance test M2 checks this on the owner's phone.

**Revoking:** the owner can remove CaterDesk at `myaccount.google.com/permissions` at any time. The app then shows
"Google Drive not connected" and keeps working offline.

## 4. Encryption and key recovery

**Algorithm:** AES-256-GCM via the browser's Web Crypto API. There is no custom cryptography.

**Recovery key (recommended):**

- When backup is first set up, the phone generates a random 256-bit key.
- It is shown **once** as 13 groups of 4 characters (Crockford base32 with a checksum), for example
  `CDRK-7Q2M-…-H4XD`.
- The owner writes it down or prints it and stores it away from the phone. A password manager or a sealed envelope
  both work.
- The app asks the owner to type the last two groups back before backups start, so a mis-copied key is caught on
  day one.

**On the phone:**

- The key is imported as a **non-extractable** `CryptoKey` and stored in IndexedDB (`meta`).
- The app can then encrypt automatic backups without asking each time, but no script can read the key's bytes out.
- A short key ID (first 8 bytes of SHA-256 of the key) is stored openly so restore can say "this backup needs a
  different recovery key".

**No recovery key, no restore.** Google cannot decrypt the backups, and neither can anyone else, including the owner
without the key. Losing the phone **and** the recovery key means the Drive backups are unrecoverable. This is the
price of the encryption and must be accepted explicitly at setup.

**Alternative (owner's choice):** a passphrase instead of a random key, stretched with PBKDF2-SHA-256 at 600,000
iterations and a random salt. It is easier to remember, but it is only as strong as the passphrase; a minimum of
5 random words is enforced. **The recommendation is the random recovery key.**

**Changing the key:** a new key encrypts future backups. Older backups still need the old key, so the app lists which
key ID each backup uses.

**File format (`.cdbk`):**

```
magic "CDBK" | format version (1) | header length | header JSON | ciphertext (with 16-byte GCM tag)
header = { keyId, iv (12 random bytes, base64), createdAt, appVersion, compressed: "gzip", plainSha256 }
```

- The header bytes are passed as GCM **additional authenticated data**, so any change to the header or the
  ciphertext makes decryption fail.
- `plainSha256` is the hash of the backup JSON before compression, checked after decryption.
- The plaintext is the existing backup JSON, compressed with `CompressionStream('gzip')` before encryption.

## 5. Backup behaviour

**Manual:** **Back up now** in Settings → Backup.

**Foreground-assisted automatic:**

- A browser app cannot run while closed, so backups happen while CaterDesk is open.
- A backup is **due** when the last *verified* Drive backup is older than 24 hours, or the data changed since it and
  it is older than 6 hours.
- When due, online and holding a valid token from a sign-in in the last hour, the backup starts on its own a few
  seconds after the app becomes idle. It never interrupts typing or an open sheet.
- When due but the token has expired, a quiet banner offers **Back up now (1 tap)**. The tap opens Google's popup.
  The app never claims a backup ran when it did not.

**Steps and honest status:**

| Step | Shown as |
|---|---|
| Export and self-check (manifest) | Preparing backup… |
| Encrypt and locally test-decrypt | Encrypting… |
| Upload (resumable for large files; real byte progress) | Uploading 2.1 MB of 3.4 MB… |
| Verify: Drive's `sha256Checksum` and `size` must equal the uploaded ciphertext | Checking upload… |
| Recorded | **Saved to Drive and verified** · time |

**Two separate records**, never merged:

- **Last backup attempt:** time, result, reason if failed (offline, sign-in needed, quota, mismatch).
- **Last verified backup:** time, file, size, key ID.

A failed attempt never changes "last verified".

**Weekly deep check:** once a week the app downloads the newest backup, decrypts it, and runs the full import check
without writing anything (dry run). Only then is it marked **restore-tested**.

**Versions kept:**

- the last 14 daily, 8 weekly and 12 monthly backups
- the 3 newest verified backups, never removed

Older ones are moved to **Drive's bin** (recoverable for 30 days), never deleted permanently by the app.

**Names and properties:**

- File name: `CaterDesk-backup-2026-11-15-2104-<random device tag>.cdbk`.
- Drive `appProperties` hold only: `caterdesk=1`, `format=1`, `keyId`, `createdAt`, `appVersion`.
- No business data appears in names or properties.

## 6. Restore on another device

1. Install or open CaterDesk on the new device and choose **Restore from Google Drive**.
2. Connect Google Drive (same Google account).
   - `drive.file` access belongs to the app, so the new device sees the backups this app created.
3. Pick a backup. The list shows date, size, app version and whether it is verified or restore-tested.
4. Type the recovery key. The key ID must match, otherwise the app says so before downloading.
5. Download, then check:
   - GCM authentication (any tampering fails here)
   - decompress and check `plainSha256`
   - the existing `prepareImport` checks: manifest counts, store hashes, field validation
6. Preview what will be restored: events, quotations, approved menus, orders, bills and photos counts.
7. **Empty device:** restore everything. **Device that already has data:** the owner must choose
   **Replace** (after a local safety backup is saved) or **Merge** (existing merge rules). There is no silent
   overwrite.
8. After restoring, re-count every store against the manifest and show **Restored and checked**.

## 7. Code changes (separate reviewable PRs, after approval)

| PR | Contents | Needs Google? |
|---|---|---|
| D1 | `.cdbk` format: key generation, recovery-key display and confirmation, encrypt/decrypt, local "Save encrypted backup file" and "Restore from encrypted file". | No: fully testable offline |
| D2 | Drive client: popup OAuth, `oauth-return.html`, folder, resumable upload, checksum verification, listing, retention to bin, restore from Drive. The client ID comes from a config value left **empty**, so the feature stays hidden. Tests use a mocked Drive API served locally. The CSP adds `connect-src https://www.googleapis.com`. | No: mocked |
| D3 | Owner adds the approved client ID; manual tests M1–M6 with the real account. | Yes, after approval |
| D4 | Due logic, banner, weekly deep check, status screen polish. | Mocked + manual |

## 8. Acceptance tests

**Automated** (Playwright on the local server, synthetic data, Drive mocked; no real Google account in CI):

1. **A1 Round trip:** encrypt the full synthetic backup (with photos, quotations, approved menus, orders), then
   decrypt and import into a fresh profile. Every store must be byte-identical after normalising `_rev`.
2. **A2 Wrong key:** a different recovery key fails with "This backup needs a different recovery key". Nothing is
   written.
3. **A3 Tamper:** flipping one byte in the ciphertext, the tag or the header makes decryption fail. Nothing is
   written.
4. **A4 Key confirmation:** setup refuses to start backups until the last two key groups are typed correctly.
5. **A5 No plaintext leaves:** the bytes sent to the mocked Drive contain no event, client, vendor or dish name.
   File names and `appProperties` contain only the allowed fields.
6. **A6 Token hygiene:** after a backup, localStorage, IndexedDB, the error reporter queue and the URL contain no
   access token. The popup's fragment is cleared.
7. **A7 Scope:** the authorisation URL requests exactly `https://www.googleapis.com/auth/drive.file`.
8. **A8 Upload verification:** if the mocked Drive returns a different `sha256Checksum` or size, the status is
   "Upload could not be verified". *Last verified* is unchanged and the attempt is recorded as failed.
9. **A9 Offline / expired token:** the attempt fails honestly and *last verified* is unchanged. When a backup is due,
   the banner offers one-tap backup.
10. **A10 Retention:** a pruning simulation over 120 days keeps 14/8/12 plus the 3 newest verified. Pruned files are
    only trashed (`trashed: true`), never deleted.
11. **A11 Restore safety:** restoring onto a device with data requires choosing Replace or Merge. Replace first saves
    a local safety backup. Manifest re-count must pass.
12. **A12 CSP:** the deployed CSP allows `connect-src https://www.googleapis.com` and nothing else new. No
    third-party scripts are added.
13. **A13 Old app versions:** a backup restored by this version, then opened by the released 4.21.1 app, still opens
    (the existing compatibility test is extended).

**Manual, by the owner on the real account** (after D3):

- **M1** First connect shows Google's consent with only "See, edit, create and delete only the specific Google
  Drive files that you use with this app".
- **M2** On the Android phone (installed app), connect works. If the wrapper blocks sign-in, the documented Chrome
  fallback works.
- **M3** `CaterDesk Backups` appears in My Drive with `.cdbk` files. Opening one shows unreadable content.
- **M4** Next day, opening the app triggers the backup, or the one-tap banner. The status shows separate *attempt*
  and *verified* times.
- **M5** On a second device or browser profile with no data, restore with the recovery key. Counts match; open a
  quotation, an approved menu and a bill photo.
- **M6** Revoke access at `myaccount.google.com/permissions`. The app shows "Google Drive not connected", keeps
  working, and local backups still work.

## 9. Decisions needed from the owner

1. **Approve the `drive.file` scope** and the owner-visible `CaterDesk Backups` folder.
2. **Recovery method:** random recovery key (recommended) or passphrase.
3. **OAuth approach:** browser-only token flow without third-party scripts (recommended), GIS script with a wider
   CSP, or a server with refresh tokens (not recommended).
4. **Do the Google Cloud setup in section 2**, then send the Client ID (not the secret) to be added in D3.
5. **Retention:** 14 daily / 8 weekly / 12 monthly, or different numbers.
6. **CSP change:** allow `connect-src https://www.googleapis.com` (needed for any Drive access).
