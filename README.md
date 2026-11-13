# CaterDesk — Catering & Event Accounts

*Every event. Every expense. Clear profit.*

An offline-first app for catering events, expenses, vendor credit, client collections, menus and vendor orders. Business records stay in the device's browser storage; the hosted app also sends limited error diagnostics to its server.

**Current source and hosted web build: v4.7.0.** Documentation checked on **13 November 2026**.

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
- [Release history](#release-history)

## Versions and available packages

The **APK wrapper version, hosted web version and bundled desktop version are independent**. Installing an APK does not establish which cached web release is currently open. Check the app's Settings panel for the running web build.

| Component | Verified state on 3 November 2026 | Meaning |
| --- | --- | --- |
| Source and hosted web app | **4.7.0** | Current UI, data/export version, service worker and error reporter |
| Service-worker release cache | `flavor-fusion-v2-cache-v25` | Installed web assets; this number is not the database schema version |
| Android wrapper in the owner's local workspace | **3.0.0**, versionCode **9** | APK package inspected locally; launches the hosted app, which can run 4.7.0 |
| Android requirements for that local wrapper | min API **24**, target API **36** | Android 7.0+ and a compatible browser provider |
| Latest GitHub Release with downloadable binaries | **2.4.7** | APK and desktop ZIP; later source tags do not imply newer binaries were uploaded |
| Desktop package currently in the owner's `Apps/Desktop` folder | **2.4.7** | A static older bundle, not the current source build |
| Desktop launcher source/instructions | **4.7.0** | Build a new bundle to use the current source on desktop; see the packaging caveat below |
| IndexedDB schema | **4** | Kept separate from application version changes |

Do not relabel an older package as 4.7.0. Use the [release assets](https://github.com/naterohit28/CaterDesk/releases) and their verification files for the actual binary you distribute. Source tags and release downloads serve different purposes.

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

**There is no account-based business-data cloud sync or automatic off-device backup.** Saving to Google Drive is manual: **Share / save backup → Drive** in the share menu. Automatic, encrypted Drive backup is a later v5 step (P1-E) and is not implemented. GitHub/Vercel hosting does not back up event records. Phone, desktop and ordinary browser profiles can have separate data. Changing domain, scheme, port, browser provider or profile can show another database. Preserve an export before moving to a custom domain or another device.

The app requests persistent storage where supported, but storage can still be lost through clearing data, device loss or profile changes. The PIN hides the UI; it does **not encrypt** the database or exported files. Export is blocked while the app is locked.

### Back up

1. Unlock the app and choose **Settings → Share / save backup**.
2. When the backup is ready, choose **Share** (the phone's share menu: **Drive**, **Files**, WhatsApp or email) or **Save to phone (Downloads)**. The choice is a fresh tap because Android opens the share menu only shortly after a tap, and building a backup with photos can take longer. Android Chrome refuses to share `.json` files, so the backup is always shared as `caterdesk-backup-YYYY-MM-DD.txt` (same content; CaterDesk imports `.txt` and `.json`). Where no share menu exists the file downloads as `.json`. Keep more than one dated copy outside the device.
3. Before updates, migration or imports, confirm that the file is actually saved and keep the previous backup.

Backups contain business records and images. Protect them as private documents. Sending a file to a share sheet does not prove a chosen destination retained it.

### Restore

1. Export current records first. For testing, import a copy into a separate profile.
2. Choose **Settings → Import backup** and select the backup (`.txt` or `.json`). Before anything changes, CaterDesk shows the backup's date, app version and record counts, and whether it passed its integrity check.
3. **Merge** retains current records and rejects conflicts for the same ID. **Replace** validates first, then replaces business records atomically; a failed replacement preserves the old database.
4. Reconcile totals, client/vendor balances, drafts and images after restoration.

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
4. After saving/closing entries, choose **Check for app updates → Reload saved app**, or reopen the app. The current web build is **4.7.0**.

A newer web release may reload automatically during the first 20 seconds of startup when no active form/save/overlay prevents it, at most once per release per session. Otherwise it waits for a later start or explicit reload. Refresh can also switch versions when no form/save is open. Service-worker cache mappings preserve matching assets for older open pages until navigation.

Do not uninstall or clear browser/site storage to force an update. If Android rejects an APK, check package, versionCode and signing certificate before proceeding. The public certificate association is [`public/.well-known/assetlinks.json`](public/.well-known/assetlinks.json).

The local wrapper currently has package version **3.0.0**, versionCode **9**, while the hosted app is **4.7.0**. That distinction is expected. The latest downloadable GitHub APK is older still; consult the version table rather than assuming a source tag includes a binary.

## Windows desktop testing

Use a published ZIP if its older bundled version is suitable, or build from current source using the instructions below. Do not describe the v2.4.7 download as a v4.7.0 package.

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
| [`tests/ui-audit.cjs`](tests/ui-audit.cjs) | Touch-phone audit in light and dark at 360px: aligned card edges and equal margins, equal-size buttons/segments/tiles, centred labels, aligned list icons and amounts; every tab, quick action, event/vendor action and dropdown option; sheets close by ✕, Back and outside tap; background stays still under sheets; pull-to-refresh; layout shift; console errors |

Use a normal Git clone with history: the upgrade test reads commit `bdb6a5a`. A source ZIP or shallow clone missing that commit is insufficient. Evidence/screenshots go into ignored `test-artifacts/`.

Suite coverage is not a claim that a fresh run passed. Historical v2.4.x counts and the separate 181-second desktop soak are documented in [the historical reliability report](docs/RELIABILITY.md); they do not certify v4.0.2. Browser simulations do not replace testing physical Android sleep/process death, camera capture, contact selection, sharing and storage eviction.

## Build packages

### Windows desktop

From Windows PowerShell in the repository root:

```powershell
.\desktop\build.ps1 -OutputDirectory C:\Temp\CaterDesk-Desktop
# Required with the current helper: index.html and sw.js reference this asset,
# but build.ps1 does not yet include it in its copy list.
Copy-Item -LiteralPath .\public\error-reporter.js -Destination C:\Temp\CaterDesk-Desktop\app\error-reporter.js
```

**Current packaging limitation:** omitting `error-reporter.js` causes a missing-script response and can prevent the service worker from completing its precache. Include the file even though the reporter itself skips local hosts. This README documents the workaround; the helper has not been changed as part of this documentation update.

The helper uses the Windows .NET Framework compiler and the CaterDesk icon. Distribute the whole output directory (`CaterDesk-Desktop.exe`, `README.txt`, `app/`), preferably as a ZIP. Do not include Edge profiles, customer backups or credentials. Inspect the bundled app build before naming/publishing the ZIP.

The launcher binds to loopback, validates the Host and requested path, restricts static file types and supplies security headers. It has no business-data upload API and does not host `api/client-error.js`.

### Android

The generated Bubblewrap project and original signing material live outside this Git checkout. In the owner's prepared workspace:

```powershell
cd ..\Android
.\build-apk.cmd
```

The local helper generates/compiles the project, signs through Android SDK tooling and verifies the APK. It needs Node.js/Bubblewrap, JDK, Android SDK and the original signing identity. Passwords are loaded from Windows-user-encrypted local credentials or prompted interactively. Never commit credentials or print them in build instructions.

A fresh clone does not include this generated project, keystore or credentials. To create another wrapper, configure Bubblewrap separately; an in-place update of the existing installed package requires the original signer and an increasing Android versionCode. Web-only releases do not require a newly numbered APK. Protect recovery copies of signing material; user-encrypted files are not portable to another Windows account by simple copying.

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
| Settings shows an older web build | Open online, save/close entries, check updates and reload; or use header refresh when idle. Do not clear data |
| Records look missing in another environment | Check original domain, scheme, port, browser provider and profile. Import a backup copy only into the intended environment |
| Save waits or reports busy storage | Let the transaction finish/cancel, then retry the retained form. Avoid repeated Save taps or storage clearing |
| App seems frozen after returning | Look for PIN/confirmation overlays; report build, action, duration and error text. Retain storage and backups |
| Expense/vendor choice looks unexpected | Check category, item and history-based suggestions. Manual choices win; edit the entry if it is wrong |
| Delivered order has no recorded expense | A normal delivery opens a form; save the actual bill. Whole-event outsourced charges may already be recorded |
| An order says Sent but WhatsApp was cancelled | Status is locally maintained, not a WhatsApp delivery acknowledgement; review/update it |
| Contacts button is unavailable | Browser API support varies. Enter details manually; only an explicitly selected contact is requested where supported |
| Backup is rejected or stale edit is blocked | Keep the original file/records, read the validation error or reopen the current record; do not bypass checks blindly |
| Event/vendor cannot be deleted | Linked accounting history must be resolved individually; deletion guards preserve balances |
| Forgotten PIN | Keep storage intact. Privacy-help is not a PIN bypass; restore an existing export into a separate profile if needed |
| Desktop still shows an older build | Exit the old tray server and use a complete newly built package. Website updates do not replace desktop bundle files |
| Desktop missing-script/offline-install error | Check `app/error-reporter.js` exists; use the documented build workaround |
| Desktop cannot bind port 19891 | Exit the conflicting test server normally; changing the port changes the storage origin |
| APK update is refused | Check signer, package and increasing versionCode; do not uninstall before protecting records |
| No hosted error logs/alerts | Confirm the Vercel function/deployment and optional environment variable; local reporting is intentionally skipped |

Include the web build, wrapper/browser or desktop package version, steps and error text in bug reports. Use synthetic/redacted examples; never attach customer backups or private bills to public issues.

## Release history

This is a short source-feature history, not a list of available binary downloads.

| Version | Main changes |
| --- | --- |
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
