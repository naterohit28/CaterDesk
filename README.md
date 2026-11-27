# CaterDesk — Catering & Event Accounts

*Every event. Every expense. Clear profit.*

An offline-first app for catering events, expenses, vendor credit, client collections, menus and vendor orders. Business records stay in the device's browser storage; the hosted app also sends limited error diagnostics to its server.

**Current source and hosted web build: v5.4.0.** Documentation checked on **26 November 2026**.

**Development status: Active — focused improvements (from v5.2.0).** v5.0.0 was the stable internal release (the owner's full 25-check event test passed on their Android phone, the owner confirmed the installed app, and the money is checked against hand-worked figures); 5.1.x then fixed defects found in use. Since the owner's development directive of 26 Nov 2026, small recording-first improvements ship one at a time, each in its own reviewed PR with tests, following [AGENTS.md](AGENTS.md) and the [product roadmap](docs/PRODUCT_ROADMAP.md). Financial rules, stored data and backups stay compatible; nothing is merged or released without the owner's approval.

[Open the app](https://expense-calculator-kohl.vercel.app/) · [Download published packages](https://github.com/naterohit28/CaterDesk/releases) · [Historical reliability report](docs/RELIABILITY.md) · [Competitor/name research and Claude evaluation notes](docs/research/README.md) · [Report an issue](https://github.com/naterohit28/CaterDesk/issues)

CaterDesk was previously called Flavor Fusion. The existing Android package (`com.flavorfusion.expenses`), signing identity, database and desktop profile are retained for continuity. The cloche-and-ledger icon uses teal, ivory and copper; its editable master is [`public/icons/caterdesk.svg`](public/icons/caterdesk.svg). Naming research found existing CaterDesk use in this industry; the app has not been renamed again.

## Contents

- [Versions and available packages](#versions-and-available-packages)
- [Current features](#current-features)
- [Storage, privacy and backups](#storage-privacy-and-backups)
- [Android installation and updates](#android-installation-and-updates)
- [Windows desktop testing](#windows-desktop-testing)
- [Run locally](#run-locally)
- [Tests and validation](#tests-and-validation)
- [Build packages](#build-packages)
- [Deployment, diagnostics and maintenance](#deployment-diagnostics-and-maintenance)
- [Repository and local workspace](#repository-and-local-workspace)
- [Troubleshooting](#troubleshooting)
- [Deferred improvements](#deferred-improvements)
- [Release history](#release-history)

## Versions and available packages

Four things carry version numbers, and they are **independent**: the **hosted web app** (what the phone actually runs, updated from the website), the **Android wrapper** (the installed APK, which only opens the hosted app), the **downloadable binaries** on GitHub Releases, and the **Windows desktop bundle**. A web release never needs a new APK, and installing an APK does not change which web release is open. Check **Settings** in the app for the running web build.

| Component | State (checked 20 November 2026 unless noted) | Meaning |
| --- | --- | --- |
| Source and hosted web app | **5.4.0** | Current UI, data/export version, service worker and error reporter |
| Service-worker release cache | `flavor-fusion-v2-cache-v117` | Installed web assets; this number is not the database schema version |
| Android wrapper in the owner's local workspace | **3.0.0**, versionCode **9** (inspected 3 November 2026) | APK package inspected locally; launches the hosted app, which can run 4.31.16 |
| Android requirements for that local wrapper | min API **24**, target API **36** | Android 7.0+ and a compatible browser provider |
| Latest GitHub Release with downloadable binaries | **2.4.7** | APK and desktop ZIP; later source tags do not imply newer binaries were uploaded |
| Desktop package currently in the owner's `Apps/Desktop` folder | **2.4.7** | A static older bundle, not the current source build |
| Desktop launcher source/instructions | **5.4.0** | Build a new bundle to use the current source on desktop; see the packaging caveat below |
| IndexedDB schema | **4** | Kept separate from application version changes |

Do not relabel an older package as 5.4.0. Use the [release assets](https://github.com/naterohit28/CaterDesk/releases) and their verification files for the actual binary you distribute. Source tags and release downloads serve different purposes.

## Current features

### Events and collections

- Create/edit events with date, time, meals (any mix of breakfast, lunch, high tea and dinner; choosing lunch also ticks breakfast), venue, guest count, billed amount, expected cost, menu package and notes. Events are listed newest first.
- Record an optional booking advance as the event's first client payment; track subsequent collections and the remaining balance.
- Menu-package rates and guest slabs can suggest billing. Historical costs for that menu can suggest expected cost. Values remain editable; these are estimates based on recorded data.
- A **quote helper** under the bill shows what that menu (or event type) usually costs you per plate from your own events, the margin at the bill entered, the lowest per-plate price for a 30% margin, and the average you actually billed on that menu against the card rate.
- Mark whole events outsourced to another caterer. Their charge is recorded as vendor credit and the event shows commission; outsourced work is excluded from usual per-plate comparisons and missing-cost suggestions.
- Add a new outsourced caterer from **Done by → + New vendor**, then return to the event form with that caterer selected.

### Expenses, vendors and other people

- Record event-linked spending by category, item/subcategory, vendor, date, notes, payment mode and paid/credit status. Expense receipt icons use **₹**.
- **To pay** lists unpaid credit first, prioritizing overdue items and due dates, with a Pay action. Home summarizes money owed.
- Filter expenses by event; new expenses entered from that context use the selected event.
- Vendor suggestions use saved specialty and past purchases. Usual-vendor buttons offer quick choices; all vendors remain available and none is silently selected solely because it ranks first.
- Choosing a vendor on a new expense can suggest its usual item and payment habits. Fields already chosen manually and existing expense records are preserved.
- Track suppliers separately from **other people**, such as lenders or people who paid a bill on your behalf, and record repayments.
- **Labour sheet** per event: for each worker type, a rate per shift and how many came in each shift (morning, evening, night, full day, loading, late) — as on contractors' bills, where not every worker does every shift; sheets saved in v4.0.0 convert automatically. Plus the extras contractors add to their bills — travel / fare (गाडी भाडे / travel allowance, saved as Transport), the mukadam's fee (मुकादमगिरी) and other small jobs with a note. An optional **bill total** makes the saved amount match the contractor's final figure; any small difference goes on the biggest line. Rates are remembered per type and shift, the last sheet can be copied, and saving keeps one Labour expense per worker type in step (paid now, or credit to a labour contractor).
- Save event photographs and bill images; snap bills as drafts and complete their details later. Expense lists paginate at 100 rows while totals cover the matching records.

### Menus and vendor orders

- Paste the dishes agreed with a client. The app cleans numbering, bullets and duplicate lines, then groups recognized dishes into live counters or the in-house kitchen.
- Tap a dish to change its counter; the app remembers the choice. Matching is rule-based, not an AI/OCR service.
- Prepare vendor orders with items, plates, event date/time and venue. WhatsApp opens a prepared message; the user must send it.
- Track Sent, Confirmed, Delivered and Cancelled states. These are app-maintained states, not delivery/read acknowledgements from WhatsApp.
- Marking a normal counter order Delivered opens a prefilled expense form; saving the bill is still required.
- Outsourced menus become one whole-event order. The delivery path avoids adding another charge when that caterer's expense is already recorded.
- Home lists outstanding deliveries due today or tomorrow.

To extract text from a menu photograph, use an external tool such as Google Lens, then paste its text. The app itself does not perform image-to-text recognition.

### Reports and convenience

- Event costs, recorded profit/margin, per-plate figures, menu profit ranking and category costs versus usual costs.
- **Vendor price creep**: per vendor and item, cost per plate at the latest event against that vendor's earlier events (rises of 8% or more), on the vendor page and in Reports, with an optional prepared WhatsApp message to discuss the rate.
- A cost checklist uses a similar past event to flag usual items not yet recorded; it does not invent expense amounts. Home flags recent events with missing costs.
- Home's next-30-days view summarizes projected collections, payments and net cash from entered records; it is not a bank balance.
- Call/WhatsApp links for clients, vendors and other people; prepared client-payment reminders, client payment receipts and vendor-dues messages. Nothing is sent automatically.
- Contact selection on supported browsers can fill a chosen name and number. Availability depends on the browser/device; manual entry remains available.
- English, Marathi and bilingual display; light/dark themes; an optional four-digit privacy PIN.
- In installed standalone mode, reopen a last-used screen from within 12 hours. An eligible unsaved new-expense snapshot from within 24 hours can be offered with **Continue**. This is not a committed entry or a full backup.
- Header refresh and pull-down refresh at the top of a page reload local records and check for a newer web release, quietly unless an update is waiting.
- Frosted-glass look in the same teal/cream palette (solid where the browser lacks blur or reduced transparency is requested); **New event** is the full-width main action on Home.

Reports reflect what was entered. Missing spending, incorrect guest counts or incomplete payments affect the figures; recorded event profit is not a complete statutory/company accounting statement.

## Storage, privacy and backups

### Where records live

Browser IndexedDB **`FlavorFusionDB`**, schema **4**, contains:

| Store | Contents |
| --- | --- |
| `events` | Event details, dishes and order state |
| `expenses` | Paid/credit expenses and bill drafts |
| `vendors` | Suppliers and other payees |
| `cPays` | Client payments |
| `vPays` | Vendor/payee payments |
| `photos` | Event and bill images |
| `meta` | App metadata, PIN hash and backup timestamps |

Preferences, resume snapshots and remembered choices also use localStorage. A backup contains the six business stores plus the settings that travel with your data (theme, language, Home period and the last-used expense category). It never contains the PIN, the `meta` store, error-report consent or unsaved drafts, which stay with the device.

**There is no account-based business-data cloud sync and no automatic off-device backup.** Every backup is a deliberate tap in **Settings (☰) → Backup & Recovery**. GitHub/Vercel hosting does not back up event records. Phone, desktop and ordinary browser profiles can have separate data. Changing domain, scheme, port, browser provider or profile can show another database. Preserve a backup before moving to a custom domain or another device.

Five different things, often confused:

| What | What it is | Encrypted? |
| --- | --- | --- |
| **Backup to phone** | A `.cdbk` file in the phone's Downloads | Yes, with the recovery key |
| **Backup to Google Drive** | The same encrypted file handed to Android's share menu as `.cdbk.txt`; you pick Drive, the account and the folder. CaterDesk never signs in to Google and cannot see whether Drive kept the file | Yes, with the recovery key |
| **Readable backup (not encrypted)** | A plain backup file (`.json`, or `.txt` when shared) that anyone who opens it can read | No |
| **Recovery key** | 14 groups shown once on this phone and typed back before use. Every encrypted backup opens only with the key it was made with. This phone keeps it in a form it can use but not show again; it is never in a backup or sent anywhere. Lose the key and the phone, and the encrypted backups are gone | — |
| **Google Drive API backup (switched off)** | A direct Drive client was built (4.30.0) but ships switched off: no Google client ID is configured and no Google code loads. It stays off because Google's Drive API terms restrict app backups to Drive without Google's consent. It needs the owner's explicit decision before any change | — |

The app requests persistent storage where supported, but storage can still be lost through clearing data, device loss or profile changes. The PIN hides the screen; it does **not encrypt** the database. Encrypted backups use the recovery key, not the PIN; the readable backup is not encrypted. Backups are blocked while the app is locked.

### Back up

1. Unlock the app and open **Settings (☰) → Backup & Recovery**. The first time, choose **Recovery key**, write the key down exactly (or print it), keep it away from the phone, and type it back in full.
2. Choose **Backup to phone** (encrypted `.cdbk` in Downloads) or **Backup to Google Drive** (tap **Share to Google Drive**, then pick Drive, your account and folder, and tap Save). Android's share menu opens only straight after a tap and refuses `.cdbk` files, so the Drive copy is named `.cdbk.txt`; the bytes are the same encrypted file.
3. Check the file is really there (Downloads, or the Drive folder). CaterDesk says only that a download started or that the file was handed to the app you chose, never that it was saved. Keep more than one dated copy outside the phone.

Backups contain business records and images. Protect the readable backup as a private document.

### Restore

1. For testing, restore into a separate browser profile or a second phone, never over live records.
2. Choose **Settings (☰) → Backup & Recovery → Restore backup** and pick the file (`.cdbk`, `.cdbk.txt`, `.txt` or `.json`, from Downloads or from Drive through the phone's file picker). An encrypted backup made on another phone or with another key asks for its recovery key; a wrong key is refused and nothing changes.
3. Before anything changes, CaterDesk shows the backup's date, app version and record counts, whether it passed its integrity check, what is on this phone now, and what **Replace** would remove (naming up to three events).
4. **Merge** adds the backup's records and removes nothing; if the same record differs on the phone and in the backup, the whole merge is refused and the current data is kept. **Replace** makes the phone exactly like the backup. If the phone has any data, Replace first asks you to save a copy of it and to confirm the copy is saved; nothing is replaced until you do. With a recovery key set up, that copy is encrypted (`caterdesk-before-restore-….cdbk`, opened with the same key through Restore backup). Without a key it is a readable `.json`, with a warning; with a key, a readable copy is still available as a warned emergency option. If the encrypted copy cannot be made, nothing is replaced. Replace validates first and replaces the records in one step, so a failed replacement keeps the old data.
5. Check totals, client/vendor balances, drafts and images after restoring.

**Backup format v5 (manifest 1, from 4.1.0).** The file keeps the `ffv2` layout, so 4.0.x can still read it, and adds a `manifest` with a record count per store and a SHA-256 of all records. A file that was edited, cut off or damaged, a file from a newer CaterDesk, a non-backup file or a file over 300 MB is refused with a plain message, and existing data is not changed. Backups made before 4.1.0 have no manifest; they still import after the usual record validation, marked as not checkable. Restore (Replace) also restores the backed-up settings; Merge keeps this phone's settings. [`tests/backup-restore.cjs`](tests/backup-restore.cjs) runs the restore drill on a second simulated device.

Compatible `ffv2` and legacy `ffv5` payloads are supported subject to validation. Invalid IDs, duplicate IDs, amounts, dates or missing references can cause rejection. Never delete your only backup to work around a validation error.

### Hosted error diagnostics

[`public/error-reporter.js`](public/error-reporter.js) reports uncaught errors to [`api/client-error.js`](api/client-error.js) **only after the user turns on Settings → Error reports** (off by default; turning it off stops reports immediately), with **strict redaction**. A report holds only fixed technical fields: kind (error, unhandled rejection or handled), error type from a fixed list of standard JavaScript/browser types (e.g. `TypeError`; any other name is sent as `Other`, so a name can never pass as a type), the app script it came from (one of the app's own file names, otherwise `other`/`external`), line, column, release and a browser family (e.g. `android-webview`). Error messages, stacks, page paths, full browser strings, timestamps and business records are never sent. The endpoint applies the same allow-list itself, so free text from an older or forged client is dropped before anything is logged or forwarded. [`tests/diagnostics-redaction.cjs`](tests/diagnostics-redaction.cjs) checks this with canary names, numbers and notes.

The reporter skips `file:`, localhost and loopback hosts. It limits itself to ten distinct reports per page session. Offline reports are queued in memory and flushed when connectivity returns while the page remains alive; delivery is best-effort, not a durable error archive.

The endpoint logs to Vercel, processes the forwarded IP for best-effort rate limits, and can forward the same redacted fields to a configured webhook. This is diagnostics, not a business-data sync service or authenticated user API. See [deployment and alerts](#deployment-diagnostics-and-maintenance).

## Android installation and updates

The APK is a **Trusted Web Activity** wrapper around the hosted site. It does not embed every new web version in a new APK.

1. Keep a business-data backup.
2. Obtain the intended APK from its actual release assets or the owner's prepared local package. Install over the existing app with the same package/signing identity.
3. Open online to download updates. Check the **web build in Settings**, not just Android App info.
4. After saving/closing entries, choose **Check for app updates → Reload saved app**, or reopen the app. The current web build is **5.4.0**.

A newer web release may reload automatically during the first 20 seconds of startup when no active form/save/overlay prevents it, at most once per release per session. Otherwise it waits for a later start or explicit reload. Refresh can also switch versions when no form/save is open. Service-worker cache mappings preserve matching assets for older open pages until navigation.

Do not uninstall or clear browser/site storage to force an update. If Android rejects an APK, check package, versionCode and signing certificate before proceeding. The public certificate association is [`public/.well-known/assetlinks.json`](public/.well-known/assetlinks.json).

The local wrapper currently has package version **3.0.0**, versionCode **9**, while the hosted app is **5.4.0**. That distinction is expected. The latest downloadable GitHub APK is older still; consult the version table rather than assuming a source tag includes a binary.

## Windows desktop testing

Use a published ZIP if its older bundled version is suitable, or build from current source using the instructions below. Do not describe the v2.4.7 download as a v5.0.0 package.

1. Extract the entire ZIP; keep `app/` beside `CaterDesk-Desktop.exe`.
2. Run the EXE. Microsoft Edge opens an app window; a tray icon provides **Open CaterDesk**, storage information and **Exit test server**.
3. Before starting another version, exit the existing tray server. The current launcher checks for an older running server instead of silently opening it.

Requirements: Windows, Microsoft Edge and .NET Framework 4.x. Prepared packages do not require Node/Python or administrator installation. The launcher is unsigned and intended for local testing.

- Fixed origin: `http://127.0.0.1:19891/`.
- Dedicated data profile: `%LOCALAPPDATA%\FlavorFusionDesktopTest\EdgeProfile`.
- Phone/desktop records do not sync. Import a **copy** of a backup to compare records.
- The website cannot update the files bundled beside this EXE. Replace the app package to upgrade; preserve the profile and fixed origin. Refresh checks the local bundle only.

See [`desktop/README.txt`](desktop/README.txt) for packaging caveats and recovery guidance.

## Run locally

The browser app is plain HTML, CSS and JavaScript modules, with no frontend bundler or business-data backend credentials required.

```sh
git clone https://github.com/naterohit28/CaterDesk.git
cd CaterDesk
python -m http.server 8790 --bind 127.0.0.1 --directory public
```

Open **http://127.0.0.1:8790/**. Use `python3` if required by your installation. Keep the same origin/profile to use the same records. Do not open `index.html` using `file://`.

This static server does not run the Vercel error-report endpoint; reporting is skipped on loopback. Local operation and desktop use therefore differ from hosted diagnostics.

## Tests and validation

Install Node.js/npm and Microsoft Edge, then run in the repository root:

```sh
npm ci
node tests/check-version.cjs
npm test
```

Playwright uses the installed **Microsoft Edge** channel. The runner starts an isolated random-port loopback server and fresh browser contexts with synthetic records; it does not use the phone or dedicated desktop database.

| Suite | Current purpose |
| --- | --- |
| [`tests/check-version.cjs`](tests/check-version.cjs) | Compare package, UI, database/export, service-worker, reporter and desktop-README release numbers; separate from `npm test` |
| [`tests/regression.cjs`](tests/regression.cjs) | Data validation/rollback, stale and repeated saves, PIN/focus, pagination/offline behavior, vendor suggestions, advances/lenders, menus, outsourcing, resume/habits, contact/WhatsApp links, orders, v3.3.1 refresh/event filters and v4.0 quote helper, receipts, price creep and labour sheets checked against real contractor bills |
| [`tests/attachment-regression.cjs`](tests/attachment-regression.cjs) | Image editing, deletion/Undo, orphan recovery and backup/restore |
| [`tests/idle-recovery.cjs`](tests/idle-recovery.cjs) | Transaction cancellation, history fallback, delayed images, reconnection and simulated background/PIN recovery |
| [`tests/security-smoke.cjs`](tests/security-smoke.cjs) | Configured hosting CSP and basic save/theme/language flows |
| [`tests/release-update.cjs`](tests/release-update.cjs) | Upgrade from actual v2.4.4 files with old tabs/forms open, record preservation and offline reopening |
| [`tests/labour-audit.cjs`](tests/labour-audit.cjs) | Read-only labour audit tool finds orphaned/duplicated labour-sheet expenses, ignores hand-entered ones, leaves the backup file unchanged |
| [`tests/xss-canary.cjs`](tests/xss-canary.cjs) | User text containing HTML/script stays inert on 18 screens and forms and never widens the page; a fresh install has no records (G-19) |
| [`tests/diagnostics-redaction.cjs`](tests/diagnostics-redaction.cjs) | Error reports: off until consent, allow-listed fields and error types only, canary names never logged or forwarded |
| [`tests/backup-restore.cjs`](tests/backup-restore.cjs) | Backup v5: share-sheet save, restore drill on a second device with identical records and settings, damaged/cut-off/newer/foreign/oversized files refused with data intact, older backups still import (G-15, G-16, G-28) |
| [`tests/reconciliation.cjs`](tests/reconciliation.cjs) | Reconciliation: paise rounding, legacy events untouched, checklist and blockers, G-12 late bill reopens with history, bill/guest changes reopen, reconciled-only benchmarks (G-22), contribution labels, backup round trip |
| [`tests/venue-details.cjs`](tests/venue-details.cjs) | Venue details G-39–G-42: occasion vs venue type incl. custom, legacy event unchanged through edit and restore, logistics prompts without automatic expenses, repeat-venue suggestion, reconciled-only venue benchmarks |
| [`tests/menu-meals.cjs`](tests/menu-meals.cjs) | Margin vs markup (G-04), price by meal (G-03 / Q-01), menu review, menu change after confirmed order keeps the old version and flags the order without sending (G-11), import checks |
| [`tests/audit-441.cjs`](tests/audit-441.cjs) | One regression test per 4.4.1 audit finding (off-menu orders, order states, reconciled checklist reference, cost-detail changes, one expense per venue reminder, repeat-venue hint) |
| [`tests/toast-undo.cjs`](tests/toast-undo.cjs) | Undo message closes by itself after the undo window; Undo inside it restores; deletion stays after it closes |
| [`tests/counter-planning.cjs`](tests/counter-planning.cjs) | Counter planning C-01 (500 × 75% = 375, order 400, served unknown), C-02 (vendor minimum, note below it), independent take-ups, meal-specific guests, import checks |
| [`tests/payment-schedule.cjs`](tests/payment-schedule.cjs) | Payment schedule G-09 / P-01: outstanding vs due now vs overdue by date, part payments, reminder amount, %, validation, removal, import checks |
| [`tests/shared-bills.cjs`](tests/shared-bills.cjs) | Shared bills G-13: ₹8,000 + ₹5,000 shared by two events counted once, vendor owed once, edits apply to every part, sums and duplicates refused, delete/Undo as a whole, unshare, import checks |
| [`tests/labour-no-duplicates.cjs`](tests/labour-no-duplicates.cjs) | Mukadam bill G-14: staff + travel saved once at the negotiated total, hand entries of the same item ask first (Cancel / extra), sheet save over a hand entry asks first, nothing deleted |
| [`tests/shared-labour.cjs`](tests/shared-labour.cjs) | A shared labour-sheet bill saved again never exceeds the bill; growing it keeps other events' parts; shrinking below them is refused; the sheet's entry stays on its event |
| [`tests/order-versions.cjs`](tests/order-versions.cjs) | Order messages G-10 (WhatsApp opened never becomes sent by itself) and G-26 (revised message is a new version; earlier keeps its status; history), no-phone orders, import checks |
| [`tests/guest-counts.cjs`](tests/guest-counts.cjs) | Guest counts G-31 (500 vs 560, 60 requested, nothing billed), G-32 (30 accepted / 30 disputed), explicit bill change reopening reconciliation, G-33 (corrections kept with reason), G-37 (approval tied to its count), G-34 (meal-specific), import checks |
| [`tests/ui-audit.cjs`](tests/ui-audit.cjs) | Touch-phone audit in light and dark at 360px: aligned card edges and equal margins, equal-size buttons/segments/tiles, centred labels, aligned list icons and amounts; every tab, quick action, event/vendor action and dropdown option; sheets close by ✕, Back and outside tap; background stays still under sheets; pull-to-refresh; layout shift; console errors |

Use a normal Git clone with history: the upgrade test reads commit `bdb6a5a`. A source ZIP or shallow clone missing that commit is insufficient. Evidence/screenshots go into ignored `test-artifacts/`.

Suite coverage is not a claim that a fresh run passed. Historical v2.4.x counts and the separate 181-second desktop soak are documented in [the historical reliability report](docs/RELIABILITY.md); they do not certify v4.0.2. Browser simulations do not replace testing physical Android sleep/process death, camera capture, contact selection, sharing and storage eviction.

## Build packages

### Windows desktop

From Windows PowerShell in the repository root:

```powershell
.\desktop\build.ps1 -OutputDirectory C:\Temp\CaterDesk-Desktop
```

The build copies every file the app loads and the service worker caches (including `backup-crypto.js` and `error-reporter.js`); no manual copy is needed. [`tests/desktop-package.cjs`](tests/desktop-package.cjs) checks the copy list against the app's imports, `index.html` and the service-worker precache, and starts a package made from that list.

The helper uses the Windows .NET Framework compiler and the CaterDesk icon. Distribute the whole output directory (`CaterDesk-Desktop.exe`, `README.txt`, `app/`), preferably as a ZIP. Do not include Edge profiles, customer backups or credentials. Inspect the bundled app build before naming/publishing the ZIP.

The launcher binds to loopback, validates the Host and requested path, restricts static file types and supplies security headers. It has no business-data upload API and does not host `api/client-error.js`.

### Android

The generated Bubblewrap project and original signing material live outside this Git checkout. In the owner's prepared workspace:

```powershell
cd ..\Android
.\build-apk.cmd
```

The local helper generates/compiles the project, signs through Android SDK tooling and verifies the APK. It needs Node.js/Bubblewrap, JDK, Android SDK and the original signing identity. Passwords are loaded from Windows-user-encrypted local credentials or prompted interactively. Never commit credentials or print them in build instructions.

A fresh clone does not include this generated project, keystore or credentials. **Known reproducibility gap:** the wrapper's source (the Bubblewrap project) lives only in the owner's local workspace, so the installed APK cannot be rebuilt from this repository alone. Bringing its non-secret files into the repository is a future item; the keystore and passwords never belong here. To create another wrapper, configure Bubblewrap separately; an in-place update of the existing installed package requires the original signer and an increasing Android versionCode. Web-only releases do not require a newly numbered APK. Protect recovery copies of signing material; user-encrypted files are not portable to another Windows account by simple copying.

## Deployment, diagnostics and maintenance

The repository was renamed from `Expense-Calculator` to `CaterDesk` on 13 November 2026 (GitHub redirects old links). The web address `expense-calculator-kohl.vercel.app` deliberately keeps the original name: records are stored per web address, so a new address would open an empty app and the Android wrapper is built for this one.

Vercel deploys the repository with `public/` as its output directory and the root `vercel.json` for security/cache headers. The separate `api/client-error.js` is a Vercel function; a plain static host needs an equivalent endpoint or a deliberate reporting change. Documentation, tests, private build material and business backups do not belong in `public/`.

### Release process

1. Work on a branch, keep a phone backup and run checks appropriate to the change. Use `npm test` for application changes and `git diff --check` for all changes.
2. For a web release, update package/lockfile, UI, export/database app version, service-worker release, reporter and desktop version strings together; use a new release cache. Do not bump the IndexedDB schema merely for a UI version.
3. Run `node tests/check-version.cjs`; it does not validate every C# string, Android wrapper version or distributable binary, so inspect those separately.
4. Review persistence/import compatibility and external-service behavior, then merge and verify deployment and the running web build.
5. Build packages only when needed. Verify Android package/versionCode/signer/alignment and desktop file completeness. Upload intended binaries and checksums to GitHub Releases separately from tags.
6. Update version tables and instructions to match what actually exists. Never replace a historical research snapshot with unverified current claims.

The **Release tag** workflow checks version consistency on PRs and creates `vX.Y.Z` on pushes to `main` if that tag does not exist. It neither creates APK/desktop assets nor runs the full browser suite. Documentation-only commits with an unchanged app version do not create a new app release or move an existing tag.

For website rollback, restore an appropriate prior Vercel deployment, then revert/fix the bad source change so a subsequent deployment does not reintroduce it. Cached clients may still require an update check and safe reload. Check data compatibility before rolling back persistence changes. Use `git switch --detach vX.Y.Z` to inspect a source release.

### Error logs and optional alerts

- In Vercel Logs, look for **`[client-error]`**. Reports are diagnostics, not a ledger of saved transactions.
- `ALERT_WEBHOOK_URL`, when configured in the deployment environment, forwards error summaries to an incoming webhook. The payload includes `content` and `text` fields for Discord/Slack/Google Chat-style endpoints. No webhook is configured by this documentation update.
- The handler caps request bodies at 8 KiB, applies best-effort per-IP limits and suppresses repeated alert messages for an hour within an instance. Its in-memory state resets across instance restarts and is not a durable/global rate limiter. A matching Origin check is not user authentication.
- The **Uptime** workflow is scheduled for every 30 minutes and checks the page title, app script and error endpoint's expected GET response (405). It does not test saves or Android health. Actual runs and notifications depend on workflow state and GitHub notification settings; inspect Actions rather than assuming every failure generated an email.

Keep error/log retention and webhook recipients appropriate for any sensitive text that could reach an exception. The application has no bank integration, payment gateway, WhatsApp bot, in-app OCR or third-party AI inference feature in its current source. WhatsApp/call links, supported browser APIs, hosted diagnostics and web fonts still involve network/platform services.

## Repository and local workspace

```text
CaterDesk/
├── README.md
├── package.json / package-lock.json
├── vercel.json
├── api/client-error.js
├── .github/workflows/           Version tags and uptime checks
├── public/                     Browser assets, icons and Android asset links
├── desktop/                    C# launcher, build helper and package README
├── tests/                      Browser suites and version check
└── docs/
    ├── RELIABILITY.md           Historical v2.4.4 report
    └── research/               Dated findings, evidence and evaluation README
```

The owner's local workspace uses `Apps/` for binaries, `Project/Web/` for this checkout, `Project/Android/` for generated/private Android material and `Backups/` for retained data/older copies. A separate `digivenue-platform/` project is unrelated. This arrangement is an owner-specific convenience, not a fresh-clone requirement or a guarantee that local binaries match current source.

Commit from this Git checkout, not the outer Downloads folder. Generated `node_modules/`, `test-artifacts/`, executables, APKs, archives, signing files and secrets are excluded from source control. Treat all business exports—including renamed/custom backup files—as private, regardless of whether their name matches an ignore pattern.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Android App info and Settings show different versions | Wrapper and web versions differ by design. Settings identifies the running UI; use the version table above |
| Settings shows an older web build | Open online, save/close entries, then **Settings → Check for app updates** and reload. Do not clear data |
| Records look missing in another environment | Check original domain, scheme, port, browser provider and profile. Import a backup copy only into the intended environment |
| Save waits or reports busy storage | Let the transaction finish/cancel, then retry the retained form. Avoid repeated Save taps or storage clearing |
| App seems frozen after returning | Look for PIN/confirmation overlays; report build, action, duration and error text. Retain storage and backups |
| Expense/vendor choice looks unexpected | Check category, item and history-based suggestions. Manual choices win; edit the entry if it is wrong |
| Delivered order has no recorded expense | A normal delivery opens a form; save the actual bill. Whole-event outsourced charges may already be recorded |
| An order says Opened but nothing reached the vendor | Opening WhatsApp marks an order *opened*, never *sent*; CaterDesk cannot see WhatsApp. Mark it sent or confirmed yourself once the vendor has it |
| Contacts button is unavailable | Browser API support varies. Enter details manually; only an explicitly selected contact is requested where supported |
| Backup is rejected or stale edit is blocked | Keep the original file/records, read the validation error or reopen the current record; do not bypass checks blindly |
| Event/vendor cannot be deleted | Linked accounting history must be resolved individually; deletion guards preserve balances |
| Forgotten PIN | Keep storage intact. Privacy-help is not a PIN bypass; restore an existing export into a separate profile if needed |
| Desktop still shows an older build | Exit the old tray server and use a complete newly built package. Website updates do not replace desktop bundle files |
| Desktop missing-script/offline-install error | Rebuild with the current `desktop/build.ps1`; check every file listed in `sw.js` is in `app/` |
| Desktop cannot bind port 19891 | Exit the conflicting test server normally; changing the port changes the storage origin |
| APK update is refused | Check signer, package and increasing versionCode; do not uninstall before protecting records |
| No hosted error logs/alerts | Confirm the Vercel function/deployment and optional environment variable; local reporting is intentionally skipped |

Include the web build, wrapper/browser or desktop package version, steps and error text in bug reports. Use synthetic/redacted examples; never attach customer backups or private bills to public issues.

## Deferred improvements

Not part of v5.0.0. Each needs the owner's decision before any work starts.

| Item | Why it waits |
| --- | --- |
| Voice entry (5.1) | One "Quick voice entry" that fills the existing form for review before saving, expenses first; Indian English, Hindi and Marathi. Needs the owner's OK on sending speech to Google for recognition, and a test inside the installed app (it runs on the phone's default browser) |
| Dish list with suggestions while typing (5.1) | From the owner's menu card (dish names only), never limiting what can be typed; until then the "Card – …" section menus (loaded with Restore → Merge) serve the purpose |
| Interface polish from the phone run | About a dozen small items: the floating Add button over figures, notices over titles, wording and ₹ formatting; none changes a figure |
| Bill per plate after extra plates are billed; the temporary-change note in the reconciliation history | Display and history wording only; totals are correct |
| A purchase's bill pre-fills an unrelated item when the supplier has no counter or item set | Found in the detailed phone run; totals are correct, only the Reports category is affected until changed |
| Play Store listing and commercial use | Launch kit prepared (docs/PLAY_STORE.md); account, domain/email and launch date are the owner's decisions |
| Name and trademark check | CaterDesk is used by others in this industry; a decision, not a code change |
| Licence | None is granted; adding one is the owner's decision |
| Android wrapper source in the repository | Makes the APK rebuildable from a clone; keystore and passwords stay out |
| Direct Google Drive backup (API) | Built, switched off; Google's Drive API terms restrict app backups without Google's consent |
| GST on bills and principal-vs-commission accounting (O-01/O-02) | Accounting rules need the owner's and accountant's decisions |
| Making the GitHub "Tests" check required on `main` | Once the CI run has been reliable for a few more pull requests |

## Release history

This is a short source-feature history, not a list of available binary downloads.

| Version | Main changes |
| --- | --- |
| 5.4.0 | **Suppliers and labour contractors as two lists** (owner's priority). The Vendors tab opens with **Suppliers \| Contractors**: a contractor is a vendor saved under Labour. Each list has its own totals (supplier payable vs **labour payable**), filters, search and sort; contractors are grouped by the worker type they supply, so two contractors for the same type are listed together; the add button becomes **Add contractor** (Labour chosen). Other people stay with suppliers. New labour types from the owner's list: **Chinese Cook, Roti Cook (Puri / Phulka), Starter / Farsan Labour, Sweet Labour, House Keeping, Security, Valet, Manager**; every earlier type kept. No record changes. |
| 5.3.4 | **A bill already entered item by item is not counted twice** (owner's phone: a ₹2,490 bill photo was filled in after its two items, ₹1,140 + ₹1,350, were entered, so the event's costs counted it twice). Saving a new entry or filling in a bill photo now checks what is already recorded from the same vendor for the same event within 7 days: if one entry, or two to four added together, equal the amount, it asks **Already recorded?** and offers to **attach the bill photo to those entries** (no new entry), save it as a **different bill**, or go back. A warning only; the bill-number check is unchanged. |
| 5.3.3 | **Incomplete costs are flagged before an event is called final** (owner's request). An event we cater ourselves is flagged when usual costs from the last similar reconciled event are not recorded (listed by name), when no labour cost is recorded, or when labour lines have no rate. The event shows **Costs incomplete** with what is missing; reconciling lists the same and asks **Reconcile anyway?** (a warning, never a block: a cost may genuinely not have been spent); Home's **Check costs** now covers every past event not yet reconciled (most recent first, 5 shown), not only the last two weeks. No amount is added or changed. |
| 5.3.2 | **Breakfast and high-tea menus** (owner's rate card). Eight Breakfast / High Tea combinations are starter menus, listed first when choosing a menu for breakfast or high tea (e.g. Upma & Kande Pohe, Idli & Medu Vada, Sheera & Dosa, Jalebi & Fafda, a 4-item buffet; each with tea and coffee). Choosing one fills the meal's dishes, editable before Save; each dish then has the same choices as lunch and dinner: who makes it (our kitchen, at the venue, bought ready-made, bought and finished, a counter) and diet marks. The card price only fills a blank price per plate. |
| 5.3.1 | **Who supplies a dish is never guessed from its name** (owner's requirements, step 3). A new dish starts in our kitchen: "Paneer Tikka", "Kebab", "Soup" or "Idli" no longer go to a live counter by keyword. Confirmed choices are remembered and filled in next time (editable): dishes you assigned yourself, and dishes whose counter order was sent, confirmed or delivered. Every way is remembered: a vendor counter, cooked at the venue, bought ready-made, bought and finished, part bought, so one event can mix all of them. New labour type **Specialist Cook – स्पेशल आचारी** (starter, tandoor or Chinese cook is labour, not an outsourced counter). Saved dishes, orders and records are unchanged. |
| 5.3.0 | **Home opens on today's work** (owner-approved). A **Today** card lists today's and tomorrow's events (also a meal on another day of the event), each with guests, meals and venue and what is still open: vendor orders to confirm, no labour list yet, client balance to collect, or "Nothing pending". With none, it shows the next event. The quick actions and the to-do cards (deliveries, bills to finish, vendors to pay, costs to check, backup) follow it; **Money overview** (period, contribution, next 30 days) and insights move below them. Built from saved records only; no calculation changed. |
| 5.2.2 | Ice and Milk & Dairy as separate expense items (owner's requirements, step 2). New entries offer **Milk & Dairy – दूध व दुग्धजन्य पदार्थ** (milk, paneer, curd, cream, cheese, butter, mawa, khoya, basundi, buttermilk) and **Ice – बर्फ** (blocks, cubes, crushed, ladi) under Raw Material. The overlapping items **Ice + Milk**, **Paneer / Dairy** and **Ice Blocks** are retired for new entries only: old records keep their item exactly (readable, editable, in totals, reports and backups), and opening an old one no longer risks changing its item. Usual items, usual vendors and a vendor's speciality count Paneer / Dairy as Milk & Dairy and Ice Blocks as Ice; Ice + Milk is never split or mapped by guessing. The cost checklist treats an older event's Ice + Milk as covered by Milk & Dairy or Ice. Water, Water Tanker and Oil / Ghee stay separate. No money calculation change. |
| 5.2.1 | Meal headings in pasted menus (owner's requirements, step 1): English, Hindi and Marathi headings are recognised with short forms and extras, e.g. BF, "Breakfast - 100 pax", "High Tea 100 pax", "Evening Tea / Coffee", नाश्ता, दुपारचे जेवण, रात्रीचं जेवण, with guest counts, times, rates and words like "Platinum Menu". Before, only a bare "Breakfast"/"Lunch"… line was a heading, so dishes after "High Tea 100 pax" went to the lunch above. A line that looks like a heading but names no known meal now stops the meal above, and the menu sheet asks which meal it is. No data or money change. |
| 5.2.0 | Faster recording, first step (owner's development directive): the expense sheet shows **Usual items**, one-tap buttons for the 6 items you record most (ties go to the latest). One tap sets the category and the item together, exactly like choosing them below, and shows that item's usual vendors. Labour-sheet lines and order prices are not counted. Nothing is chosen until tapped; the category chips and item list stay for everything else. No data or money change. |
| 5.1.3 | Labour pay per contractor (owner): the labour sheet no longer has one Paid now / Contractor credit switch. A line with a contractor is owed to that contractor; the event's labour card lists each contractor with what this event owes them and a **Pay** button (amount and event filled in). A line with no contractor was paid to the workers directly and asks how (Paid directly by). Expenses already saved as paid stay paid: nothing is re-labelled. |
| 5.1.2 | Events list (owner): upcoming events are listed nearest date first, so today's and tomorrow's events are at the top; past events stay most recent first. (Since 3.0.0 upcoming events were listed furthest date first.) |
| 5.1.1 | Bill matching (due-diligence finding F-COM-01): a delivered order or purchase counts as billed only when a bill is linked to it. Another bill from the same vendor on the event (transport, an older bill entered before links) no longer clears it by itself: the order reads **Delivered · bill to link** and the reconciliation checklist says so until you link the bill or record it. One bill can be linked to several orders of its vendor and is still counted once; linking a bill to an order that has a price saved removes that price in the same step. Backups check the new links. |
| 5.1.0 | Labour contractors (owner): each labour line has its own contractor. A contractor whose specialty is that worker type is picked for you only when there is exactly one (otherwise the one you used last for it; with two you choose). Two contractors for the same worker type are two lines and two expenses, each owed to its own contractor. Each contractor can be sent their own list on WhatsApp (their worker types and heads per shift, date and venue; no client or event name). "+ New vendor" on a line adds a Labour contractor with that worker type. To pay, each priced line needs its contractor; one bill total is for one contractor only. Sheets saved before (one contractor) show it on every line and keep their expenses, bill photos and dues. The save message is no longer shown as an error when rates are still to come. Cache v105 |
| 5.0.0 | **Stable internal release.** Same app as 4.31.24, renumbered after the owner's Android acceptance (all 25 checks of the full-event test on the owner's phone, run twice, offline included; the owner confirmed the installed app) and the independent money check. Development moves to Maintenance Mode. Updating from 4.31.13, 4.31.14, 4.31.22, 4.31.23 and 4.31.24 keeps records (bill, payments and expenses compared exactly) and open entries, online and offline (tests/update-from-4313.cjs). |
| 4.31.24 | Owner's requests before v5.0.0: a labour line with workers but no rate is kept on the sheet (it was dropped on save) and says "Rate not set"; only priced lines become expenses, a contractor's bill with no rates is saved as the expense, and a blank rate never deletes an earlier amount. Labour is ordered by heads per shift: the sheet never fills in a rate (last time's rate shows only as a hint), so nothing is counted before the contractor's bill. A vendor order can have a price: it is saved, in the same step as the order, as an expense to pay that vendor, marked as the order's price and not its bill (the order still reads "bill not in" and the event cannot be closed on it). Recording the bill confirms it; a recorded, paid or numbered bill is never changed or removed by its order, and cancelling removes only an unconfirmed price. Prices take whole paise only. Without a price the order says its cost comes with the bill (independent audit of #102, F-01 to F-03, F-07). Part of a dish can come from a vendor or be bought, with the rest made by us (shown under Our kitchen as "(rest)"); a dish can be marked as cooked at the venue, in the event page or the meal editor; a dish on a sent order becoming only part from that counter flags the order for review (F-04, F-06). A cleared labour rate keeps its earlier amount, shown and counted on the labour card (F-05). Coming back to the app after a call, the field being typed in keeps the cursor. Messages to vendors (order, purchase, reminder) no longer name the client or event, the guest count or the client's approval: what, how many, date, time and venue only. Cache v103 |
| 4.31.23 | From the detailed phone run before v5.0.0: a purchase still sent for an earlier date showed display code in the To-buy list (now a plain warning line, as on order rows); a purchase's status sheet shows its time as 6:30 PM, not 18:30; the order and purchase reminders use the same fixed lines as the orders (counter or item, quantity, date, ready-by / deliver-by time, venue). |
| 4.31.22 | Times are typed in one box (7:30, 7.05, 730 or 7) with an AM / PM switch; minutes after : or . need two digits, so 7:5 is never read as 7:50 or 7:05 by guess, instead of hour, minute and AM/PM lists. Owner's request: when ordering or buying from an event, the vendor box offers + New vendor (the vendor sheet opens over the order with its counter filled in, and the new vendor comes back picked) and + One-time vendor (kept for its bills, payments and dues, labelled one-time, never suggested for other orders). The sheet opened last is now always the one on top and in use. |
| 4.31.21 | From the owner's phone review: vendor orders and purchases always list counter/item, items, quantity, date, ready-by (or deliver-by) time and venue, one per line, and cannot be saved without the time; times are picked as Hour / Minute / AM-PM instead of the clock dial; one Save saves a typed menu; the field being typed scrolls above the keyboard; button labels stay centred when they wrap. |
| 4.31.20 | The new-date notice added in 4.31.19 showed display code instead of its words on the phone; it is plain English – Marathi text now, and the test checks that no code appears. |
| 4.31.19 | From Claude's run of the full checklist on the owner's phone: the reconcile sheet shows what is still to pay to vendors after payments (it showed every credit bill even when paid); moving an event lists the orders and purchases sent for the old date, and each such row says so; a new vendor's specialty starts as Not set instead of the first in the list. |
| 4.31.18 | Found in the owner's phone test: an event first saved for 10 guests and then given dinner for 300 showed bill and contribution per plate divided by 10. Per-plate figures and past-event comparisons now use the meals' own guest numbers when set (the largest meal), and the event's number otherwise. |
| 4.31.17 | Owner's rule on payment milestones: when the bill changes, a % milestone the client has already paid in full keeps the amount it had (shown "kept as paid"); the open milestones follow the new bill and the difference is the balance after the event. Before, a paid 25% booking milestone showed a few rupees "due" again after the bill grew. |
| 4.31.16 | Fixes from the independent pre-v5 audit: a vendor order saves only with a whole number of plates (1 or more) and a real delivery date; a delivered purchase without its bill now stops reconciliation and shows in the Books check, like a delivered order; two delivered orders from one vendor need two bills (each bill counts for one order, linked or not), so one vendor bill no longer hides another order's missing bill (`tests/order-recon-fixes.cjs`). Cache v95 |
| 4.31.15 | Encrypted safety copy before a restore: when Replace would remove this phone's data, the copy it first asks for is now encrypted with the recovery key (.cdbk; the key is never inside) instead of a readable file. No key set up: a readable copy, with the warning, as before. With a key: a readable copy only through a warned emergency option. A cancelled, failed or interrupted restore changes nothing, and the encrypted copy restores the phone exactly (`tests/encrypted-safety-copy.cjs`). Cache v94 |
| 4.31.14 | Full-event test fixes: payment plan ₹ / % choice (a chosen % stays a % through every edit) and labelled date/days; meal dishes typed but not added are kept on Save; vendor and purchase orders are saved first and sent second (WhatsApp opens from a tap on the saved order, a failed save sends nothing, a blocked window leaves it not sent), Save order keeps it unsent, typed plates are never refilled; Split bill is offered on a new expense; a cash one-off purchase needs no vendor; settlement can record a payment; the restore sheet shows this phone's records, what Replace would remove, and that Merge removes nothing; purchase orders add venue notes and your contact; the guest-count sheet highlights the next step |
| 4.31.13 | **Security fix:** the meal-menu editor shows a library menu's name and the every-meal dish names as text. A name containing page code could add elements to the editor (found by the reviewer after 4.31.8). A quote option label on the event page is escaped too. |
| 4.31.12 | Dropdown text stays at the readable size: a long event or vendor name is no longer shrunk to fit. When the chosen name doesn't fit, it is written out in full on a line under the dropdown (English or Marathi); short names look as before. **Fix:** the meal and menu dropdowns in quote and meal rows now get the narrower padding they were meant to have, so their names fit at full size on a small phone. |
| 4.31.11 | Housekeeping: old app caches that no open tab uses are deleted when an update activates (records untouched), a long *usual vendor* name wraps inside its chip instead of running off the screen, and the desktop test launcher source now says 4.31.11 instead of 4.29.0. |
| 4.31.10 | **Fix:** *From your past events* learns the selling price only from events sold at their price: a bill lowered at settlement by a waiver, an agreed discount or a write-off no longer pulls the suggestion down (its costs still count). A counter paid in two or more bills on one event now gives its true rate per plate, not a fraction of it. |
| 4.31.9 | **Fix:** a menu price message now stays until the price box itself is changed. Editing *From guests* while the price is still 0 used to clear the message and its marking, although Save would refuse it again. |
| 4.31.8 | **Fix:** a library menu's name is always shown as text. Five places on the event page (the meal card's *From … menu* and *Started from … menu*, the older single-menu summary, the past-events comparison and *Cost vs usual*) put the name into the page as code, so a name containing `<…>` could change the page instead of showing as typed. |
| 4.31.7 | **Fix:** a menu price of 0 is refused as before, and the cursor and the message now go to that price box, not to the *From guests* box beside it. |
| 4.31.6 | Form errors work with screen readers: after a failed save, focus moves to the first field to fix, each message is read with its field, and a message goes away as soon as that field is edited. Required fields (including those required only in some cases, such as a note on a credit payment) are announced as required. **Fix:** a new menu saved without a price now shows *Add a price per plate* instead of doing nothing. The rules and what is saved are unchanged. |
| 4.31.4 | **Fix:** *This month*, *3 months* and *This FY* on Home and Reports now end where they say: an event booked for a later month or year (with its payments and costs) no longer counts in this period's billed, collected, cost and margin figures. The period also starts on the right month on the 1st in time zones behind UTC. *All time* is unchanged. |
| 4.31.3 | **Fix:** the menu approval line on an event (*Approved v1 · date · written*) showed raw code with both English and Marathi (`<span class="t-en">…`) instead of the chosen language. It now shows only the chosen language; the name of whoever approved is still shown exactly as typed. |
| 4.31.2 | A new or edited event with unsaved changes asks **Keep editing / Discard changes** before it closes, whether by Back, the close button, a tap outside the sheet or Escape. An unchanged form closes as before; Save closes normally, and a failed save keeps what was typed. |
| 4.31.1 | Dates and times shown in the phone's own time everywhere: entries saved between midnight and 05:30 in India no longer show the previous day or a UTC clock time (order messages and reminders, payment and settlement history, reconciliation, quotes, backup age, restore preview, backup file names). Nothing saved changes. |
| 4.31.0 | Backup & Recovery in Settings: **Backup to phone** (encrypted .cdbk download), **Backup to Google Drive** (the same encrypted file handed to Android's share menu as .cdbk.txt, because Android refuses unknown file types; the owner picks Drive, the account and the folder; no Google sign-in), **Restore backup** (any file the phone's picker offers, local or cloud; recognised by content), **Recovery key**, and the readable backup kept as a last option. A share is reported as handed over, never as saved; a refused share no longer downloads silently instead. Restore with Replace on a phone with data asks for a confirmed copy first. The Drive API client stays off. |
| 4.30.0 | Google Drive backup client (D2), switched off: with no Google client ID configured (as shipped) nothing changes for users and no Google code loads. When enabled after owner approval (D3), Settings → Google Drive backup encrypts on the phone, uploads to a CaterDesk Backups folder (drive.file scope only), checks size and SHA-256, keeps 14 daily / 8 weekly / 12 monthly copies (older ones go to Drive's bin, never deleted), and restores on another device with the recovery key. The production CSP allows only the Google sign-in file and Drive/Google token addresses. Tested against a mocked Google only. |
| 4.29.0 | Encrypted backup file (D1): Settings can save an encrypted .cdbk backup (AES-256-GCM, compressed, in pieces) protected by a 14-group recovery key; restore asks for the key and refuses a wrong key or a changed file. The plain .txt backup is unchanged. |
| 4.28.2 | Owner feedback: a first quote starts from the event's meals and booked guests; total bill optional (shows Not set); meal choice no longer scrolls; Save timings & setup is a visible button; event photos from the camera as well as the gallery |
| 4.28.1 | Hotfix: a purchase's bill stays on the purchase's event (its event is locked in the expense sheet and refused on save). A backup from 4.28.0 with a moved bill restores in full: the bill is kept, only the impossible link is removed. |
| 4.28.0 | **Guests first:** a new or upcoming event needs its guest count before it is saved (one box, or one per meal; a meal's guests are kept before it is priced). The Guest count sheet starts with **Booked guests**; a day-of count waits for them; the event page shows the guests or *Guest count not entered*. **Menu sourcing:** each dish is made in our kitchen, bought ready-made, bought and finished by us, or served by a vendor's counter (old dishes unchanged). Bought items get **purchase orders** (supplier, quantity and unit, delivery, instructions, optional estimate) with WhatsApp history; a delivered purchase's bill is recorded or linked once; nothing becomes an expense by itself. Sourcing changes are internal (no new client approval); a sent purchase whose item changes is flagged, never resent. |
| 4.27.0 | **Vendors tab:** a summary of what you owe suppliers (total payable), the advances you gave them, and how many vendors you have; people who lent you money are kept apart. Search by name, category, speciality, phone, GSTIN or registered name; filters To pay, Advances, Settled, No activity; sort by highest payable, name or recently used; 30 at a time with Show more. **Vendor GSTIN:** optional, checked (15 characters and check character) before saving, never for a person; registered business name; shown on the vendor page with Copy and a link to the official GST search. No bill, payment or tax figure changes. |
| 4.26.1 | **Menu dates in local time:** a menu sent to the client keeps the date printed on it (printed before midnight, marked sent after: still the printed date), and reprints with it; older copies and approvals use the local day, not the UTC one (before 05:30 IST that was the day before). Codex review of #60. |
| 4.26.0 | **Vendor orders per meal:** when two meals (or two dinners) use the same counter, each gets its own row and order with that meal's dishes; the order sheet starts from the meal's date, time and guests. The WhatsApp message adds the meal, guests, the venue details a vendor needs (cooking, electricity, water, parking) and the client-approved menu version when the menu is unchanged since approval. A menu change flags only the orders whose own dishes changed; nothing is sent. Orders saved before have *all meals* when their counter serves more than one meal. The order status shows its steps: Prepared → WhatsApp opened → Sent → Confirmed → Delivered → Billed. On Home, *Pending collections* shows the total still to collect beside its heading, like *Pay vendors*. In Settings, tapping *CaterDesk* at the top goes to Home. **Vendor reminders:** Deliveries on Home also lists orders not yet confirmed for the next 2 days, with **Remind** (WhatsApp opens a prefilled request to confirm, with the date, time, venue, plates, items and guests; you send it) and **Confirmed** for when the vendor replies; an order never sent offers **Send order**. The order status sheet offers *Remind to confirm* for a sent order. |
| 4.25.0 | **Client documents from an approved menu:** a quotation can add a **menu annexure** (pages after the quotation) from a chosen approved version, or the current menu marked as a draft; a new quote version takes the latest approved menu. **Send menu** on the event page sends the menu on its own, as a PDF or WhatsApp text, from a chosen version. Client documents show meals, dishes and diet marks only, never kitchens, counters, vendors, rates or costs. **I have sent it** keeps the exact menu sent, and printing it again later shows the same menu even after changes. A quotation sent before copies were kept prints with a note that it was rebuilt from current data. |
| 4.24.0 | **Client-approved menu versions:** **Mark approved** on the event page keeps a copy of every meal's menu as it is, numbered (version 1, 2, …), with how it was approved (written or verbal) and by whom. A kept version is never changed; when the menu changes afterwards, the page says *Changed since approved v1 · N changes*, and approving again shows what changed meal by meal (dishes added or removed, a dish's kitchen/counter or diet marks, date, time, guests, rate) and keeps it as the next version. **Versions** lists them newest first with the changes from the one before. A library menu shown for a meal but not used is left out of the copy and named. Nothing is sent to anyone. |
| 4.23.1 | **Home always opens Home:** tapping Home now always lands on Home and is remembered as the last screen. On a slow phone, closing a sheet could leave its Back still on the way; tapping Home in that moment showed Home and then jumped back to Events (and the app reopened on Events). Home now shows at once, a late Back changes nothing, and a miscounted history is reset to Home. |
| 4.23.0 | **Menu by meal:** the event page shows each meal with its own dishes (grouped by course where one was set), with its date, time, guests and rate, and who prepares each dish; dishes served at every meal are listed once. A library menu chosen for a meal shows as *not confirmed yet* until **Use these dishes** makes them that meal's dishes, so counters and vendor orders see them. **Add menu** (or **Edit** on a meal) opens one sheet in four steps: choose the meal (a repeated meal shows its date), choose a library menu (menus for that meal first, each with its dish count) or *Create new menu*, type or paste the dishes (for example *Poha, Upma, Idli, Medu Vada, Fruit Bowl, Tea and Coffee*) and choose for each our kitchen or a counter, with diet marks such as Jain under a small *Diet* button, and save for this event only or also as a new library menu. Dishes a meal already has stay unless you choose to add to or replace them; existing library menus are never changed; switching meals with unsaved changes asks first. The page points out dishes of a removed meal and a menu changed in an older app version. |
| 4.22.1 | **Opens on Home:** the installed app now always opens on Home. It goes back to the screen you were on only when reopened within 10 minutes, for example after Android closed it while the camera was open for a bill photo (it used to return to the last screen for up to 12 hours, so it often opened on Events). |
| 4.22.0 | **Groundwork for meal-by-meal menus:** each meal served at an event (a *service*) can keep its own time and a different date, and a meal can have more than one service, such as a second lunch on the next day with its own guests, rate and dishes. Dishes can carry a course (soup, salad, snacks/chaat, accompaniment, your own), one food type (veg, egg or non-veg) and diet marks (Jain, no onion-garlic, vegan, gluten-free, nut-free); nothing is guessed, and Jain, no onion-garlic or vegan on a non-veg dish is refused. A library menu chosen for a meal keeps showing its dishes after saving and reloading. Dishes of a meal you remove are kept as they were, are not served or ordered at other meals, and are marked until you choose a meal for them. Existing fields are still saved as before, so older backups and the 4.21.1 app keep working; events not edited meal by meal are saved exactly as before. *Business details* gain an optional *Contact person*, printed on quotations. |
| 4.21.1 | **Menus by meal and clearer order history:** a menu pasted with meal headings (*Lunch:*, *Dinner*, *Hi-tea –*) puts each dish under its meal, and the same dish can now be listed for two meals instead of being dropped. The menu box shows dishes under their meal headings, and counter choices stay with the dish at that meal. The order button *Messages sent* is now *Message history*, since it also lists messages that were only prepared or opened. |
| 4.21.0 | **Issued quotes are frozen; honest messages:** a sent quote keeps a copy of the event name, date, venue and each menu's name and dishes, so reprinting it gives the same document after later changes (quotes sent earlier print from current data). A draft prints with a *DRAFT* banner. *Print / Save as PDF* asks for your business details first instead of printing a nameless page. Backup messages say what happened (*handed to the app you chose* / *download started*), not that a copy is safely stored. A later notice no longer removes an *Undo* that is still on offer. |
| 4.20.1 | **Booking advance rule (owner decision F4):** an unpaid booking advance shows as *due* before the event and becomes *overdue* only after the event date. |
| 4.20.0 | **Business details and printable quote (v5 Phase 2):** ☰ → *Business details* (name, tagline, address, phone, email, GSTIN checked for format, payment details, footer – only what you enter; kept in backups). A quote's *Print / Save as PDF* makes an A4 quotation with your letterhead, the event, meals with menus (and dishes if chosen), items, discounts, subtotal / GST / total, terms and payment details – no costs or margins. A sent quote keeps the business details it went out with (G-27). On Android choose *Save as PDF* in the print screen (D-3: confirm on your phone). |
| 4.19.0 | **Learning from your past events (v5 Phase 5):** on events not yet final, *From your past events* suggests expected cost per plate (with *Use as budget*), what similar events billed and contributed, the usual vendor per counter and its rate per plate ordered, labour rates last paid by role, and charges at the same venue – only from **reconciled** events, each showing which events, how many and the date range; with fewer than 2 comparable events it says *not enough history*. *Ignore* hides a suggestion for that event (kept in backups). |
| 4.18.1 | **Database compatibility fix:** the menu library no longer raises the database version (that refused saves from an older app version still open in another tab). Menus live in the existing settings store; a database v4.18.0 moved to version 5 still opens and its menus move across once; backups unchanged. |
| 4.18.0 | **Menu library:** ☰ → *Menus* lists your menus – the starter menus (editable; *Back to the starter menu* undoes edits), your own new menus and copies – each with the meals it suits, price per plate by guest count, banana-leaf flag and dishes. Hide a menu you don't use (events that use it keep it). In the event form each meal picks from menus suited to it first and the rate fills from its price; with meals ticked there is one menu per meal instead of a second event-wide picker. The event page folds each meal's dishes; a quote can list them for the client. Menus are stored in their own place and included in backups (backup check v2; older backups still verify). |
| 4.17.1 | **Quote options:** *+ Another option* sends Option A, B… side by side (one doesn't replace another); accepting one marks the rest *Not chosen*. |
| 4.17.0 | **Quotations with optional GST (v5 Phase 2):** a *Quote* on each event – meal lines (guests × rate, each meal with its own menu), items such as counter setup, clearly marked discounts, and optional **GST** (your rate % on the amount you choose, with Subtotal · GST · **Total incl. GST**). Drafts are editable; *I have sent it* locks a version and changes make a new one. The client gets WhatsApp text without costs (per-plate rates optional; when hidden, each line shows its amount). *Client accepted* needs written/verbal evidence and a confirm: the bill becomes the quote total **before GST** (your income); GST is recorded on the event and added to what the client owes. Also: **Late night** as a fifth meal, a **menu per meal** in the event form (rate filled from the menu's slab), meals shown as a **table**, events without a bill show *Quote sent* / *No bill yet* (never *Paid*), bold section totals, 4–5 digit number boxes. No client PDF yet (D-3). |
| 4.16.3 | **Payment and count fixes from the owner's audit:** with a payment plan, *Remind* asks only for what is due now (no reminder when nothing is due); *Pending* turns red only when something is overdue by the plan; % instalments add up to the bill to the paisa; changing an agreed counting term needs the client's agreement again; an extra-plate request is saved before WhatsApp opens; a failed bill change never shows a success message. |
| 4.16.2 | **Alignment pass:** tab icons centred, even period switch (Month · 3 months · FY · All time), no floating button over Home's quick actions, captioned *collected* bar, tool buttons on one line. |
| 4.16.1 | Long vendor and event names fit their pickers (full-width, text shrinks to no less than 13px). |
| 4.16.0 | **UI polish (Phase 4, P4-E):** event tools in an even grid, clearer secondary buttons, simpler Reports, update notice with an *Update* button instead of a refresh button, paise shown as ₹x.50, *Split bill*. |
| 4.15.0 | **Books check (P4-D):** bills = event costs + common stock, shared bills add up, vendor payables/advances, client receivables/disputes; a delivered order with no bill blocks reconciliation. |
| 4.14.0 | **Final settlement (P4-C):** a short payment stays owed (optionally disputed) until the owner records a discount, waiver or write-off with a reason; flagged for tax review. |
| 4.13.0 | **Bill payments (P4-B):** pay a chosen bill, credit notes, one *To pay* row per bill, delivered orders linked to their bill. |
| 4.12.0 | **Supplier bills (P4-A):** common stock, bill numbers with duplicate warning, allocation history. |
| 4.11.0 | **Function sheet and count method (P3-G):** team sheet without prices, count method agreed before the event, written/verbal approval evidence. |
| 4.10.0 | **Guest count / extra plates (v5 Phase 3, P3-F):** one *Guest count / Extra plates* action on the event, per meal: **contracted** (the guarantee when counting began, kept), **counted** (every tally and correction kept, a correction needs a reason), **approved** (what the client accepted for each extra-plate request; the rest shown as disputed) and **billed** (approved plates added to the bill only when you tap *Add to the bill*, which logs the change and makes a reconciled event provisional again). An extra over the contract is a proposal, never an automatic charge. A request belongs to the count it was made for; after a new count it is marked as for an earlier count and a new extra needs a new request. Breakfast and dinner are counted and charged separately. |
| 4.9.0 | **Vendor order message versions (v5 Phase 3, P3-E):** every different WhatsApp message sent for an order is kept as a version with its own status: *Not sent yet*, *WhatsApp opened*, *Sent* (you confirmed) or *Vendor confirmed*. Opening the same message again adds no version. A revised message (e.g. 250 → 280 plates) is a new version marked *WhatsApp opened* until you confirm it; the earlier version keeps its real status (e.g. *Vendor confirmed*). **Messages sent (n)** in the order's sheet shows them all, newest first. Orders from before 4.9.0 have no recorded messages, so resending one is treated as a new instruction. |
| 4.8.1 | **Fix:** a labour-sheet entry shared with other events (Share bill) and then saved again from the labour sheet counted the shared part twice (e.g. ₹6,000 became ₹8,000 across two events). The sheet line is now the whole bill: other events keep their parts, this event takes the rest, and a sheet smaller than the other events' parts is refused with nothing changed. Share bill also keeps a labour-sheet entry on its own event. |
| 4.8.0 | **Labour bills without double counting (v5 Phase 3, P3-D):** when an event's labour sheet already includes an item (a worker role, or transport when the sheet has travel), typing the same item by hand asks first: it is saved only if it is extra, on top of the contractor's bill, and is then marked *extra to labour sheet*. Saving a sheet that includes an item already typed by hand asks the same; nothing is ever deleted automatically. The negotiated bill total stays exact, with the adjustment explained on the entry. |
| 4.7.0 | **Shared bills (v5 Phase 3, P3-C):** a saved expense has **Share bill**: split one bill (e.g. ₹8,000 transport for two events) into parts per event, by amount or **Split equally** (to the paisa). The parts always add up to the bill, so it is counted once in every total and the vendor is owed it once. Vendor, item, date and payment are the same on every part (editing one updates all); amount and event are changed only through Share bill. Deleting removes every part (Undo restores every part); removing the other events puts the whole bill back on one event. The bill photo stays with the original entry. |
| 4.6.0 | **Client payment schedule (v5 Phase 3, P3-B):** an event can have a **Payment schedule**: milestones on booking, on a date, or a number of days before/after the event, each in ₹ or % of the bill. The event shows **due now** and **overdue** separately from the outstanding balance (e.g. ₹4,00,000 contract, ₹1,00,000 received: ₹3,00,000 outstanding, ₹0 due until the second payment's date, then ₹2,00,000 due, and overdue only after that date). Payments received are applied to milestones in order; any part of the bill not on the schedule is due after the event, as before. Home collections show *Due now*, *Overdue* or *On schedule*, and the WhatsApp reminder asks only for what is due now. Events without a schedule work as before. Also: the event-type chip follows the language setting again (4.3.0 showed both languages). |
| 4.5.0 | **Counter planning (v5 Phase 3, P3-A):** a counter's order form has an optional **Take-up %** (share of guests expected at that counter) and **Vendor minimum**. Plates are suggested from the guests of the meal that counter serves × take-up (e.g. 500 × 75% = 375), raised to the vendor minimum if needed (forecast 221, minimum 250 → 250); the number stays yours to change, and one you typed is never replaced. Ordering below the minimum needs a note. Counters' take-ups are independent (they need not add up to 100%). The plan is kept per counter, offered as a starting point next time, and shown on the menu card with what was ordered; what was actually served is never taken from the order. |
| 4.4.2 | **Fix:** the *Deleted · Undo* message (and *Event saved · Open*) stayed on screen until tapped. It now closes by itself after 8 seconds; Undo within that time restores, and the deletion simply stays once it closes. |
| 4.4.1 | **Audit fixes:** vendor orders stay visible (with their status or warning) even when their counter or every dish leaves the menu. Orders now show **WhatsApp opened** (or **Not sent yet** without a phone) until you tap **I have sent it** or **Vendor confirmed**; opening WhatsApp no longer counts as sent or clears a *Menu changed* warning (older orders keep *Sent*). The cost checklist compares only with a reconciled event. A reconciled event reopens when a cost moves to another vendor, category or item even if the amount is the same. Each venue reminder needs its own expense (one rented-material bill no longer ticks both the temporary kitchen and hired equipment). Tapping **Use** on a repeat-venue suggestion straight after typing the venue now works. |
| 4.4.0 | **Menus and meals (v5 Phase 2, P2-B):** the event menu sheet shows every pasted dish for review before saving: where it comes from (a counter or our kitchen) and, for events with several meals, which meal; dishes can be removed there. Changing a menu keeps the previous version, and vendor orders already sent or confirmed whose counter's dishes changed are marked **Menu changed · resend** (nothing is sent by itself; sending again clears the mark). The event form has an optional **Price by meal**: guests and rate for each ticked meal (e.g. dinner 900 × ₹800 + breakfast 35 × ₹150 = ₹7,25,250 before tax); the total fills an empty bill, never one you typed, and the event page shows the breakdown and any difference from the bill. The quote helper shows the price for the 30% margin target and, labelled separately, what a 30% markup would give. Editing an older event no longer adds empty notes or menu fields. |
| 4.3.0 | **Venue details (v5 Phase 2, CD5-VEN-01):** the occasion (event type) and the place (new optional **venue type**: hall, lawn, open ground, residence, society, hotel, office, school, community hall, terrace, restaurant or your own) are separate, plus an optional **area** and a collapsed **venue logistics** section (kitchen, cooking, electricity, water, equipment, parking/loading, setting; every answer can stay unknown). Logistics such as a required generator show **Venue costs to check** on the event, with a button to add the cost yourself; nothing is added automatically. A venue used before offers its earlier details with **Use**, without changing past events. Reports add per-plate figures by venue type from reconciled events, with sample sizes. Event types add Anniversary and Pooja; **Other** takes your own wording. Editing an older event no longer adds blank fields or changes a type that is not in today's list. |
| 4.2.2 | **Fix:** on the owner's phone, Share showed *NotAllowedError: Permission denied*. Android Chrome reports that it can share a `.json` file but then refuses it because `.json` is not on its list of shareable types. Share now always sends the `.txt` copy (same content; CaterDesk imports it); Save to phone still downloads `.json`. |
| 4.2.1 | **Fix:** on the owner's phone, tapping **Share** in the Backup ready sheet still saved to Downloads: the share menu was opened after the sheet closed, which Android does not count as coming from a tap. It now opens inside the tap itself. If the phone still refuses, the backup is saved to Downloads and the reason is shown. |
| 4.2.0 | **Event reconciliation (v5 P1-B):** an event's contribution (bill − its recorded costs, before overheads) is *provisional* until you reconcile it. On a held event, **Reconcile** shows recorded costs (unpaid bills included), bill, guests and contribution, and asks you to confirm three checks: all supplier/vendor bills, shared-purchase shares, and final guest count and client adjustments. It is refused while the event has no costs or has bill photos still to fill in. If any cost, the bill or the guest count changes afterwards, the event shows what changed and is provisional again; every reconcile and reopen is kept in its history. Home and Reports say *Event contribution* (not net profit) with the number of provisional events. Cost-per-plate averages, the quote helper, cost-vs-usual and vendor spend-per-plate use reconciled events only, and the latter is labelled as spend per guest, not the vendor's rate. Totals are added in whole paise. Existing events are unchanged and show as costs pending. |
| 4.1.1 | **Fix:** on Android, Share / save backup downloaded the file instead of opening the share menu when building the backup took longer than Android allows after a tap. Once the backup is ready, a sheet now offers **Share (Drive, Files, WhatsApp)** or **Save to phone**; if the phone still refuses to share, the backup is saved to Downloads. |
| 4.1.0 | **Backup format v5 (v5 P1-C):** Share / save backup opens the phone's share menu (Drive, Files, WhatsApp, email) on Android by offering the backup as `.txt`; backups carry a manifest (counts + SHA-256) and the settings that travel with your data; import shows date, version, counts and an integrity check before anything changes; damaged, cut-off, newer-format, foreign and oversized files are refused with existing data intact; older backups still import. New restore-drill test. |
| 4.0.3 | **Security hygiene (v5 P1-D):** error reports are off until turned on in Settings, and strictly redacted to a recognised error type, app file, line, column, release and browser family; no error text, stack, page path, full browser string or business data is sent, logged or forwarded (older clients' reports are reduced the same way on the server). Long free text (event type, vendor speciality) no longer widens the page and hides header buttons. Unused demo-seeding code removed. New tests: XSS canaries on 18 screens and forms, and diagnostics redaction. |
| 4.0.2 | **Hotfix:** editing an event no longer drops its menu, vendor orders, labour sheet or any other stored field (versions 3.3.0–4.0.1 did, which could also duplicate labour-sheet expenses on re-entry). All edit forms save onto the record they opened with and refuse to overwrite a record changed elsewhere. Read-only `tools/audit-labour.cjs` reports orphaned or duplicated labour-sheet expenses in a backup without changing it |
| 4.0.1 | Labour sheet: headcount per shift for each worker type, as on contractors' bills (not every worker does every shift); bill adjustment shown as its own line so the total adds up; margin targets — own events at least 30%, commission work 10–20% |
| 4.0.0 | Glass design and full-width New event; quiet refresh; quote helper with actually-billed rates; client payment receipts; vendor price creep; meals (breakfast, lunch, high tea, dinner in any mix); labour sheet with shifts per person, remembered rates, contractor extras (travel, mukadam fee, other work) and bill total |
| 3.3.1 | Add outsourced caterer inline; header/pull refresh; whole-event outsourced menu orders without repeat charges; event-filtered expenses |
| 3.3.0 | Paste/clean dishes, remember counter mapping, prepare vendor WhatsApp orders and track delivery |
| 3.2.1 | Client/vendor calls and WhatsApp messages, dues summaries and supported contact picking |
| 3.2.0 | Hosted error reporting, optional alerts, scheduled uptime and version/tag automation |
| 3.1.1 | Additional expense heads from menu cards |
| 3.1.0 | Last-screen resume, unfinished expense continuation, vendor habits, usual-cost comparison, menu profit ranking and 30-day cash view |
| 3.0.1 | Guarded early-start automatic web updates |
| 3.0.0 | Pending-first credit, usual vendors, other payees, booking advance, menus, cost checklist and outsourced-event commission |
| 2.4.7 | ₹ receipt icon and category/subcategory vendor priority |
| 2.4.6 | Stale-release update fix, safe reload controls and old desktop server detection |
| 2.4.5 | CaterDesk branding |
| 2.4.4 | Idle/save and attachment recovery; desktop test package; see historical reliability report |
