# CaterDesk — Catering & Event Expense Tracker

*Every event. Every expense. Clear profit.*

CaterDesk was previously named Flavor Fusion. This branding update preserves the Android package, signing certificate, IndexedDB database and desktop profile so existing records remain in place. Back up records before installing any update.

The icon uses a bold serving cloche above two ledger lines, with deep teal (`#123F40`), warm ivory (`#F8F4EA`) and a copper accent (`#BD805B`). Its artwork contains no lettering. The editable master is `public/icons/caterdesk.svg`.

An offline-first app for recording event expenses, client collections, vendor purchases and payments, with bill photographs and event profitability views.

**Current release: v3.2.1** · Android package: `com.flavorfusion.expenses`

[Open the live app](https://expense-calculator-kohl.vercel.app/) · [Download releases](https://github.com/naterohit28/Expense-Calculator/releases) · [Reliability notes](docs/RELIABILITY.md) · [Report a bug](https://github.com/naterohit28/Expense-Calculator/issues)

## Contents

- [Choose how to use the app](#choose-how-to-use-the-app)
- [Features](#features)
- [Where your records are stored](#where-your-records-are-stored)
- [Back up and restore](#back-up-and-restore)
- [Android installation and updates](#android-installation-and-updates)
- [Windows desktop test app](#windows-desktop-test-app)
- [Run the web source locally](#run-the-web-source-locally)
- [Run the tests](#run-the-tests)
- [Build the desktop app](#build-the-desktop-app)
- [Android build configuration](#android-build-configuration)
- [Repository structure](#repository-structure)
- [Organized local workspace](#organized-local-workspace)
- [Deployment and release checklist](#deployment-and-release-checklist)
- [Troubleshooting](#troubleshooting)
- [Security and current limits](#security-and-current-limits)

## Choose how to use the app

| Option | Best for | Requirements |
| --- | --- | --- |
| [Hosted web app](https://expense-calculator-kohl.vercel.app/) | Everyday browser use; install to the home screen where supported | A modern browser; internet for the first load |
| Android APK | An Android launcher experience for the hosted app | Android 7.0 / API 24 or newer and a suitable browser provider |
| Windows desktop test ZIP | Trying the packaged app on a computer with separate test records | Windows, Microsoft Edge and .NET Framework 4.x |
| Local web source | Development and browser testing | A local HTTP server; Node.js and Edge for the automated suite |

The Android app is a **Trusted Web Activity** wrapper around the hosted site. The Windows desktop package serves an included copy of the web app locally. Neither provides automatic phone-to-desktop record synchronization.

## Features

- Create and edit events with their date, venue, menu package, billed amount, guest count, expected cost, optional advance and notes; mark events outsourced to another caterer.
- Record expenses by event, category, expense head, vendor, payment state and date.
- Distinguish purchases paid immediately from purchases taken on vendor credit.
- Track client collections, vendor payments and outstanding balances.
- Attach compressed event photographs and bill/receipt images.
- Capture bill photographs as drafts and complete their expense details later.
- Search and filter events, expenses and vendors.
- Review recorded event costs, profit/margin, collections and per-plate figures.
- Switch between English, Marathi and bilingual display, and light/dark themes.
- Use cached app screens offline after the app has loaded and its service worker has installed.
- Export business records and attachments as a JSON backup; restore or merge compatible backups.
- Use an optional four-digit privacy PIN.

### Reliability safeguards

- Save success is reported after the IndexedDB transaction commits.
- Repeated Save taps are guarded, and stale edits are rejected rather than silently overwriting newer records.
- A blocked transaction times out and aborts before another save can be attempted.
- Import validates records and relationships; replacement writes are atomic.
- Conflicting merges keep current records and report the conflict.
- Events/vendors with linked accounting history cannot be silently deleted with their history left inconsistent.
- Expense lists display 100 rows per page while totals cover all matching expenses.
- Interrupted bill attachments are recovered as drafts at the next launch.
- Modal/history cleanup and background/PIN recovery preserve open form values in the tested scenarios.

See [reliability notes](docs/RELIABILITY.md) for the detailed release changes and validation scope.

## Where your records are stored

The app uses browser **IndexedDB**, named `FlavorFusionDB`, with schema version **4**. Its stores are:

| Store | Contents |
| --- | --- |
| `events` | Event records |
| `expenses` | Expenses and unfinished bill drafts |
| `vendors` | Vendor details |
| `cPays` | Client payments |
| `vPays` | Vendor payments |
| `photos` | Event and bill images |
| `meta` | Application metadata, privacy-PIN hash and backup timestamps |

Preferences such as theme, language and filters may use localStorage. The business-data export includes the six business stores; it does not export the PIN/settings metadata store.

**Hosting the app on GitHub or Vercel does not back up these records.** There is no account-based cloud database or automatic multi-device sync in this release.

Storage belongs to a browser origin/profile. Changing the host, HTTP/HTTPS scheme, port or browser profile can show a different database. Standard browser-backed Android operation can share the provider's site storage. Clearing site/browser data, losing the device or changing profiles can remove or hide access to records.

The app requests persistent storage when supported, but that request is not a substitute for an off-device backup.

## Back up and restore

### Create a backup

1. Unlock the app if a PIN is set.
2. Open **Settings → Share / save backup**.
3. Save or share the JSON file to a location outside the device.
4. Keep more than one dated backup, especially before an update or import.

Backups contain business records and images. Treat them as private documents. A completed download/share action does not prove that a particular cloud destination will retain the file indefinitely.

### Restore a backup

1. Keep a copy of the current database by exporting it first.
2. Choose **Settings → Import backup** and select the JSON file.
3. Choose the intended import mode:
   - **Merge:** retains current data; identical records can merge, while conflicting records with the same ID are rejected.
   - **Replace:** replaces business records only after validation, in one transaction. A failed replacement keeps the previous database.
4. Review event totals, payments, drafts and attachments after restoration.

Compatible `ffv2` and legacy `ffv5` payloads are supported subject to validation. Invalid IDs, duplicate IDs, malformed values, missing references or incompatible records can cause rejection. Do not “repair” a backup by deleting its only copy or stripping validation blindly.

For safe testing, import a **copy** into the desktop test app or a separate browser profile first. An export cannot reveal records that were never successfully entered, so reconcile important totals against receipts and payment records.

## Android installation and updates

1. Download the APK from the [release page](https://github.com/naterohit28/Expense-Calculator/releases).
2. Export a backup from the existing app.
3. Transfer the APK to the phone and install it **over the existing app**. Android may ask you to allow installation from the application used to open the file.
4. Close the APK and any browser tabs open to the same site, then reopen it.
5. Check the web build shown in **Settings**; the current expected value is **v3.2.1**.

Do not uninstall the old app or clear Chrome/site data just to force an update. If Android refuses an update because of a signing conflict, stop and check the package/signing identity first.

The v3.0.0 APK has versionCode **9** and uses the same signer as the supplied earlier APKs. Its v2/v3 signatures and ZIP alignment were verified during preparation. The public certificate association is in [`.well-known/assetlinks.json`](public/.well-known/assetlinks.json).

The **APK version and cached web build are separate**. Installing a new wrapper does not itself guarantee that an already-open browser client has activated the newest service worker. From v2.4.6, an update activates while older clients remain open, with each open page pinned to its complete release. Reload after saving to switch to the new build.

## Windows desktop test app

1. Download `CaterDesk-Desktop-v3.0.0.zip` from [Releases](https://github.com/naterohit28/Expense-Calculator/releases).
2. Extract the **entire ZIP** into a folder.
3. Keep the `app` directory beside `CaterDesk-Desktop.exe`.
4. Run `CaterDesk-Desktop.exe`.

The launcher opens Microsoft Edge in an app window. A system-tray icon offers **Open CaterDesk**, storage information and **Exit test server**.

No Node.js, Python or administrator installation is required to use the prepared desktop package. The launcher is an unsigned local Windows test executable, not a Microsoft Store installer.

- Fixed local address: `http://127.0.0.1:19891/`
- Dedicated profile: `%LOCALAPPDATA%\FlavorFusionDesktopTest\EdgeProfile`
- Included web build: v3.2.1

Desktop test records are separate from the phone and normal browser profiles. Import a backup copy if you want to test existing records. The desktop package does not automatically update from the website; download a new package for a newer packaged build. Replacing app assets does not require deleting the profile.

The fixed port is deliberate: selecting a different port would create a different storage origin. If port 19891 is occupied, close the other desktop test instance instead of silently changing the port.

See [`desktop/README.txt`](desktop/README.txt).

## Run the web source locally

The production app is plain HTML, CSS and JavaScript modules. It does not need a frontend bundling step or API credentials.

```sh
git clone https://github.com/naterohit28/Expense-Calculator.git
cd Expense-Calculator
python -m http.server 8790 --bind 127.0.0.1 --directory public
```

Open **http://127.0.0.1:8790/** in the browser. If your Python installation uses `python3`, use that command instead. Another static HTTP server is also suitable.

Use localhost/loopback HTTP for local development and HTTPS for deployment. Do not open `index.html` directly through `file://`; JavaScript module loading, service workers and browser storage do not behave like the hosted app there.

Use a consistent origin and port when you want to retain the same local records. The desktop test server uses its own fixed port/profile and is a separate environment.

## Run the tests

Install a supported Node.js release with npm and install Microsoft Edge, then run from the repository root:

```sh
npm ci
npm test
```

The test dependency is locked in `package-lock.json`. The suite uses Playwright with the installed **Microsoft Edge** channel; a Chromium-only Playwright download does not replace that requirement in the current runner.

The runner starts a temporary server on a random loopback port and uses fresh headless browser profiles with synthetic records. It does not point at the hosted site, the dedicated desktop profile or the phone database. Test scripts reject an external test URL.

| Suite | Coverage |
| --- | --- |
| `tests/regression.cjs` | Backup round trip/rollback, aborted writes, validation, merge conflicts, repeated taps, stale edits, save failures, PIN/focus behavior, 10,000 expenses, pagination and offline use |
| `tests/attachment-regression.cjs` | Real image upload/edit, delete/Undo, event images, interrupted-bill recovery, backup restoration and parent validation |
| `tests/idle-recovery.cjs` | Queued-write cancellation, foregrounding during saving, missed history events, delayed bill loading, closed connections, simulated long background/PIN interval and repeated entry/tab cycles |
| `tests/security-smoke.cjs` | Configured CSP applied to local responses, event saving, theme and language smoke checks |

Results and screenshots appear under ignored `test-artifacts/`. The v2.4.4 validation run passed **35 checks**. The new upgrade regression adds **8 checks**, including a v2.4.4 upgrade with open forms and database preservation. It uses Git history from commit `bdb6a5a`, so run it from a normal Git clone rather than a source ZIP. A separate real **181-second idle soak** against the compiled desktop server also passed; that soak is not part of `npm test`.

Mobile-sized browser tests and simulated time are not a certification of physical Android sleep, process killing, camera capture, native sharing or storage eviction. Test those on a phone with a retained backup.

## Build the desktop app

On Windows, from the repository root:

```powershell
.\desktop\build.ps1 -OutputDirectory C:\Temp\CaterDesk-Desktop
```

Choose a dedicated output directory. The script compiles the launcher using the Windows .NET Framework C# compiler and copies only the required web assets and instructions into the package.

The output contains `CaterDesk-Desktop.exe`, `README.txt` and `app/`. Distribute the whole directory as a ZIP. Do not include browser profile data or phone backups.

The launcher binds to loopback, serves allowed static app types, rejects non-local Host headers and traversal/dot-file paths, and supplies browser security headers. It does not expose a business-data API or upload records to a server.

## Android build configuration

The published APK is generated with Bubblewrap and signed with the owner's existing Android signing key. The working Android project and encrypted local signing credentials are retained outside this Git checkout in the organized local workspace.

For the owner's prepared workspace:

```powershell
cd ..\Android
.\build-apk.cmd
```

That local helper generates/compiles the Android project, signs through the Android SDK tooling and verifies the result. It requires the configured JDK, Android SDK, Node.js/Bubblewrap and access to the correct signing key. Local passwords are loaded from Windows-user-encrypted storage or requested interactively; they must not be pasted into source files.

A fresh Git clone does **not** contain the private signing key, credential file or the locally generated Android project. It can run/test the web source and build the desktop package. Creating a new Android wrapper requires a separately configured Bubblewrap project; updating the existing installed package requires the original signing identity.

Keep signing-key and password recovery backups protected. Windows-user-encrypted credentials cannot simply be copied to a different Windows account and expected to decrypt there.

## Repository structure

```text
Expense-Calculator/
├── README.md                 Usage, setup, backups and maintenance
├── package.json              Development/test commands
├── package-lock.json         Locked test dependencies
├── vercel.json               Deploy public/ and apply security/cache headers
├── api/client-error.js       Vercel function that logs error reports and sends alerts
├── .github/workflows/        Release tagging and uptime checks
├── public/                   Only the files served to app users
│   ├── index.html            Screens and forms
│   ├── app.js                UI, navigation, entry forms and reports
│   ├── db.js                 IndexedDB, transactions, attachments and backups
│   ├── utils.js              Validation, calculations and constants
│   ├── i18n.js               Language display
│   ├── icons.js              UI icon definitions
│   ├── styles.css            Responsive UI
│   ├── manifest.json         Web app installation metadata
│   ├── sw.js                 Offline release cache
│   ├── register-sw.js        Service-worker registration/update check
│   ├── error-reporter.js     Sends uncaught errors to api/client-error
│   ├── icons/                App icons
│   └── .well-known/assetlinks.json Android certificate association
├── desktop/                  Windows launcher source, build script and instructions
├── tests/                    Isolated browser regression suites
└── docs/
    └── RELIABILITY.md         Reliability changes and validation scope
```

`node_modules/` and `test-artifacts/` are local generated directories and are not committed.

## Organized local workspace

The owner's Downloads workspace is organized separately from the Git repository:

```text
Expense-Calculator-main/
├── START-HERE.txt
├── Apps/
│   ├── CaterDesk-v3.0.0.apk
│   └── Desktop/               Extracted Windows test app
├── Project/
│   ├── Web/                  This Git checkout
│   └── Android/              Local Android build/signing project
├── Backups/
│   ├── Business-Data/        Original starting-data JSON
│   ├── Old-App-Copies/       Older copies with their Git history preserved
│   ├── Older-APKs/
│   ├── Android-Build-Outputs/
│   ├── Legacy-Pages/
│   └── Test-Results-v2.4.4/
└── digivenue-platform/        Separate project; left untouched
```

**Commit from `Project/Web`, not from the outer workspace.** `Apps`, `Backups`, the private Android signing files and the unrelated project are not part of this repository. Public APK/desktop downloads belong in GitHub Releases rather than being mixed into the web source.

The source paths in the local launch configuration and Android signing manifest were updated after tidying. Git history, the current commit, original business JSON, signing key, encrypted credentials and current APK were preserved and checked.

## Deployment and release checklist

The current hosted site deploys from this repository's main branch on Vercel. Vercel's output directory is explicitly set to `public/`. Keep the Vercel project root at the repository root so `vercel.json` is read. Development files, tests and documentation are outside the public output. The outer local folder organization does not change the deployed app URLs.

1. Keep a phone backup before testing a new release.
2. Make the change on a branch and run the appropriate checks, including `npm test` for application changes and `git diff --check`.
3. For an application release, update the UI/export/package version together and use a new service-worker cache name. Do not change database schema version merely for a UI release.
4. Review migration compatibility, attachments and restore behavior if persistence changes.
5. Build and verify the Android APK with an increasing versionCode and the intended signer; confirm the site's certificate association.
6. Build the desktop package from the same source. Exclude credentials, browser profiles, backups and test data.
7. Merge the reviewed change, confirm deployment status and verify the live build/files.
8. Publish versioned APK/desktop assets and checksums through GitHub Releases.
9. Close old same-site clients and reopen; confirm the new web build in Settings without clearing data.

`node tests/check-version.cjs` confirms that `package.json`, `app.js`, `db.js`, `sw.js`, `error-reporter.js` and the desktop README carry the same release number. The **Release tag** workflow runs it on every pull request.

### Releases and rollback

When a release reaches `main`, the **Release tag** workflow tags that commit as `vX.Y.Z` (from `package.json`) unless the tag already exists. Every live release therefore has a tag to return to.

To roll back the website, open the Vercel project, go to **Deployments**, pick the last good deployment and choose **Instant Rollback**. The Android app loads the hosted site, so it follows. Then revert the bad change on `main` (or fix forward) so the next deploy does not bring the problem back. To inspect what any release contained, run `git checkout vX.Y.Z`.

### Error reporting and alerts

`public/error-reporter.js` sends uncaught errors from the hosted app to `api/client-error.js`, a Vercel function. Each report holds only the error text, stack, page path, release and browser; event, expense, vendor and client records are never sent. Reports are skipped on `localhost`, `127.0.0.1` and `file://`, so local tests and the desktop app send nothing. A phone sends at most 10 distinct errors per session, and errors raised while offline are sent when it reconnects.

- **Read errors:** Vercel project → **Logs**, filter for `[client-error]`.
- **Get alerts:** create an incoming webhook in Discord, Slack or Google Chat and add it in Vercel → **Settings** → **Environment Variables** as `ALERT_WEBHOOK_URL`, then redeploy. Each new error message is posted once per hour at most.
- **Uptime:** the **Uptime** workflow checks the live page, `app.js` and the error endpoint every 30 minutes. GitHub emails the repository owner when a run fails. GitHub pauses scheduled workflows after 60 days without repository activity; re-enable it from the **Actions** tab if that happens.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Save waits or reports busy storage | Let the operation finish/cancel. Close other app windows that may hold a transaction, then retry the retained form. Do not repeatedly clear browser data. |
| App looks frozen after returning | Check for a visible PIN/confirmation screen; finish it. If needed, retain a backup and reopen the app. Report the build, screen, action, idle duration and exact error text. |
| Settings shows an older build | Open online to download the update, save your entry, then reopen once more. In v2.4.6+, use Check for app updates and Reload saved app. Do not clear storage. |
| Records appear missing in another browser/desktop | Check the original origin and browser profile. Environments do not synchronize automatically. Import a backup copy into the intended test environment. |
| A backup is rejected | Keep the file, read the error and verify its format, IDs, dates, amounts and references. Do not delete current records to bypass validation. |
| “Changed in another window” | Close the stale form, refresh the records and enter the change again. |
| An event/vendor cannot be deleted | It has linked accounting entries. Resolve those individually; deletion guards preserve balances/history. |
| Forgotten PIN | The privacy-help screen cannot remove the PIN without verification. Keep original storage intact; a previous export can be restored in a separate profile. |
| Desktop EXE cannot find app files | Extract the whole ZIP and keep `app/` beside the EXE. |
| Desktop cannot bind port 19891 | Close the existing desktop test server through its tray menu; do not change ports casually. |
| APK update is refused | Verify package name, increasing versionCode and matching signing certificate. Avoid uninstalling before checking backups. |

When reporting a bug, include the app build, Android/browser or Windows/Edge version, reproduction steps and error text. Use synthetic/redacted examples; do not publish customer backups or private bills in a public issue.

## Security and current limits

- The optional PIN is a **privacy screen, not business-data encryption**. Export is blocked while locked, but a person with sufficient same-origin/local access is outside that protection model.
- There is no cloud account recovery, automatic cloud backup, tenant isolation or multi-user server authorization in this local-data release.
- Data retention depends on the device/browser profile; keep independent backups.
- Reports reflect records entered into the app. Missing costs, incorrect allocations or incomplete payments affect the figures. Event-level recorded profit is not automatically a complete company accounting statement.
- The desktop launcher is intended for local testing and uses an independent profile.
- No third-party AI, WhatsApp automation, bank reconciliation or payment-gateway integration is enabled in this version.
- Hosting headers improve defense in depth; they are not a security certification or a substitute for careful handling of exported records and signing material.

Private signing keys, passwords, encrypted credential files, environment secrets, business backups and generated executables are excluded from source control. Public release assets contain only the intended distributable binaries/package and verification material.

### Update troubleshooting (v2.4.7)

The Android APK wraps the hosted web app; its package version can differ from the web build shown in Settings. Updates now activate while other tabs remain open. Existing open entries keep their original release until navigation, while a reload loads the latest installed release without clearing IndexedDB. Settings offers **Check for app updates**, followed by an explicit **Reload saved app** action, blocked while a form or save is active.

If a previous desktop server is already running, the launcher now reports the conflict instead of silently opening the old build. Exit its tray server and launch the current executable. The data profile and local port remain unchanged.

### Expense entry improvements (v2.4.7)

Expense receipt icons now use the Indian rupee symbol. The vendor picker groups exact category/subcategory matches first, same-category suppliers next, then other vendors. Suggestions refresh with category and subcategory changes, preserving any explicit selection and existing expense vendor. No vendor is assigned automatically.

### Version 3.0.0

- **Pending first:** the Expenses tab opens with "To pay" (unpaid credit, overdue first, then by pay-by date, undated last), each with a one-tap Pay. Home's "Pay vendors" totals everything owed.
- **Usual vendors:** after choosing an item, one-tap buttons suggest the vendors who usually supply it (listed speciality or past entries). Nothing is chosen automatically. Most-recorded items appear first.
- **Other people:** credit can be owed to someone who is not a supplier (a lender, or someone who paid a bill for you). They are listed separately under Vendors and repaid like a vendor.
- **Booking advance:** the new-event form takes an optional advance, saved with the event as its first payment received.
- **Events newest first**, and **Staff Tips / Vendor Staff Tips** items under Labour.
- **Menus:** 6 buffet and 7 banana-leaf packages from the rate card. Menu + guests fill the bill from the guest slab and the expected cost from that menu's past cost per plate; both stay editable. Reports show cost per plate by menu.
- **Cost checklist:** each event lists usual costs from the latest similar event that are not recorded yet, one tap from a pre-filled form (the amount is never guessed). Home flags recent events with missing usual costs.
- **Outsourced events:** another caterer does the whole event; their charge is saved as a credit expense to them and the event shows your commission. Outsourced events stay out of cost-per-plate figures and missing-cost warnings.

### Version 3.0.1

When the app starts and finds a newer release, it switches to it straight away (within the first 20 seconds, only with no form, photo or save open, and at most once per release). Otherwise it waits for Settings › Reload saved app or the next start, as before. The Android APK is unchanged (v3.0.0, versionCode 9); it loads the hosted web app.

### Version 3.1.0

- **Picks up where you left off:** the installed app reopens the screen you last used (within 12 hours), and an expense being typed when the app closed is offered back ("Continue").
- **Vendor first:** choosing a vendor fills their usual item and how you usually pay them (now or credit, and mode). Anything picked by hand is kept.
- **Cost vs usual:** each event shows its cost per plate by category against the usual for its menu (or type), quietly as +/- percentages. Reports list "Where costs ran higher".
- **Menu profit ranking:** Reports rank menus by profit per plate with margin.
- **Next 30 days:** Home shows money to collect, to pay and the net for the coming 30 days.

### Version 3.1.1

Expense items added from the menu cards (no duplicates): Banana Leaves, Coconut, Papad / Fryums, Farsan / Namkeen (Raw Material); Soup Station, Barbeque / Tandoor, Kulfi / Ice Gola, Fruit Counter, Salad Counter, Fusion Counter (Live Counter); Nadaswaram / Music, Thamboolam / Return Gift Bags (Operations).

### Version 3.2.0

- **Error reporting:** uncaught errors from the hosted app now reach the Vercel logs, with optional Discord, Slack or Google Chat alerts. No business records are sent.
- **Uptime checks:** the live app is checked every 30 minutes; failures email the repository owner.
- **Release tags:** every release merged to `main` is tagged automatically, and pull requests fail if release numbers disagree.
### Version 3.2.1

Call and WhatsApp buttons for clients (event page; WhatsApp becomes a payment reminder while money is pending) and for vendors and other people. When you owe a vendor, "Share dues on WhatsApp" fills in their account and unpaid items. Nothing is sent until you press send in WhatsApp.

Also: **Contacts** buttons next to the client mobile and vendor phone fields fill the name and number from the phone contact list (Android; only the chosen contact is shared).
