# CaterDesk progress report: v4.0.1 → v4.31.12

**As of 19 November 2026.** This report describes source version **v4.31.12**. Releases go live one at a time after
the owner approves each one, so the live web app at expense-calculator-kohl.vercel.app may still be on an earlier
4.31.x version. The installed Android app (wrapper 3.0.0, versionCode 9) loads the live web app, so it always runs
whatever version is live.

This report covers what has been released, what has been accepted on the owner's phone, and what is still open. It is
built from the merged pull requests and the release table in the README. That table has a line for every version; this
report groups them. It gives no "percent ready" figure. Readiness is stated as criteria that have passed or are still open.

## Status at a glance

**Completed:** built, covered by automated tests, and accepted on the owner's phone where that applies.
- event, collection, expense, vendor and payment records, with edits that keep every stored field
- encrypted backup to the phone, backup to Google Drive through the share menu, and restore with the recovery key:
  all accepted on the owner's phone on 17 Nov
- the recovery key: a wrong key is refused, and cancelling a replacement keeps the old key (accepted 16 Nov)
- dates and times in India time
- the fixes from the independent audit of 19 Nov (section 3)
- the automated suite: 467 passed, 0 failed on v4.31.8. **Not yet run on v4.31.9–4.31.12**: only each fix's own new checks were run (they fail on the old code and pass on the fix)

**Pending phone verification:** built and covered by automated tests, but not yet recorded as checked on a physical
Android phone.
- the unsaved-changes question when leaving a new or edited event (v4.31.2)
- form errors: the cursor goes to the first field to fix, and the keyboard does not cover it (v4.31.6)
- a menu price of 0: the cursor goes to the price box, and the message stays until the price is changed (v4.31.7, v4.31.9)
- long names in dropdowns shown in full under the dropdown (v4.31.12)
- the menu approval line in English only (v4.31.3)
- bill photos from the camera and gallery, including when permission is denied
- a quote's Print / Save as PDF
- one full event through guest counts, shared bills, final settlement and the Books check

**Deferred:** not built, by decision.
- automatic Google Drive backup (D3/D4), paused under Google's Drive API terms
- cloud sync between phones, or any server copy of the records
- app-update improvements
- Complimentary (free) events, which need the owner's approval

**Commercial readiness:** not started. The criteria are in section 1B. They include a setup and support process per
customer, a privacy notice and terms, the GST decisions, an independent finance review, testing on more phones, and a
licence and price.

## 1. Readiness

### A. Ready for the owner's own business

| Criterion | Status | Evidence |
|---|---|---|
| Events, collections, expenses, vendors, payments | ✅ Built and in daily use | Releases since v4.0.1 |
| Edits never lose stored data | ✅ Fixed | v4.0.2 (#19) |
| Backup to the phone (encrypted `.cdbk`) | ✅ Accepted on the phone, 17 Nov | #71 acceptance comment |
| Backup to Google Drive (share menu, no Google login) | ✅ Accepted on the phone, 17 Nov | #71 acceptance comment |
| Restore with the recovery key | ✅ Accepted on the phone, 17 Nov: all counts matched | #71 acceptance comment |
| Wrong key refused; cancelling a key replacement keeps the old key | ✅ Accepted on the phone, 16 Nov | #69 |
| Dates and times in India time | ✅ Fixed | v4.31.1 (#72) |
| Automated tests | ✅ Full suite on every release up to v4.31.8 (467 passed, 0 failed). ⏳ Not yet run on v4.31.9–4.31.12 | #72–#77 |
| Fixes from the independent audit of 19 Nov | ✅ Fixed in v4.31.4–v4.31.11 | Section 3 |
| Phase 3/4 features (counts, shared bills, settlement, Books check) used on the phone | ⏳ Not recorded as phone-tested | — |
| Camera and gallery bill photos, including permission denial (v4.28.2) | ⏳ Not recorded as phone-tested | — |
| Quote "Print / Save as PDF" on the Android phone (decision D-3) | ⏳ Not recorded as phone-tested | — |

**Data recovery** is accepted on the owner's phone. On 17 November, a backup was saved to Google Drive through the share
menu and restored with the recovery key with all counts matching, and the phone backup appeared in Downloads. On
19 November the owner confirmed again that backup and restore both work, so the proposed "is the file saved?" prompt
was dropped.

### B. Ready to sell to other caterers

None of these are built or decided yet. They are listed so the gap is visible, not as planned work.

| Criterion | Status |
|---|---|
| Each customer's records stay on their own phone; nothing is kept on a server | By design. Customers must be told this clearly |
| Backups are manual: the owner taps Backup; there is no automatic daily backup | By design, since the Drive API path is paused (see section 4) |
| A setup process per customer: install, business details, recovery key, first backup | ⏳ Not written |
| A support process for lost phones, lost recovery keys and failed restores | ⏳ Not written. A lost recovery key cannot be recovered by anyone |
| Privacy notice and terms of use | ⏳ Not written |
| GST treatment on quotes, and principal vs commission work (decisions O-01, O-02) | ⏳ Open owner decisions. Quotes apply the owner's chosen GST rate to a chosen amount |
| An independent finance review of settlement, Books check and reconciliation (the Phase 4 exit gate) | ⏳ Not done |
| Testing on a range of phones, not only the owner's | ⏳ Not done |
| The Marathi and bilingual layouts | ⏳ The owner chose English first. Marathi labels exist, but layout is not tuned |
| A licence and price, plus distribution beyond the owner's APK | ⏳ Not decided |

## 2. What changed, by stage

Each line lists versions and pull requests. The README's release table has the detail for every version.

**Data safety and security (12–13 Nov)**
- v4.0.2 (#19): editing an event no longer drops menus, orders, labour sheets or unknown fields. A read-only labour audit tool was added.
- v4.0.3 (#20): error reports are off by default and strictly redacted, and XSS canary tests were added.
- v4.1.0–4.2.2 (#21, #22, #24, #25): backup format v5 with a manifest and SHA-256 check. Share to Drive was fixed on Android in three steps (open inside the tap, share as `.txt`). The owner confirmed Share → Drive on the phone on 13 Nov, and a backup restored identically on a fresh profile.

**Reconciliation and venue (Phase 1–2, 13 Nov)**
- v4.2.0 (#23): an event's contribution stays provisional until reconciled, and benchmarks use reconciled events only.
- v4.3.0 (#26): venue type, area and logistics prompts.
- v4.4.0–4.4.2 (#27–#29): menu review, price by meal, menu versions, fixes from an audit, and an Undo message that closes by itself.

**Planning and counting (Phase 3, 13 Nov)**
- v4.5.0 (#30): counter take-up % and vendor minimums.
- v4.6.0 (#31): client payment schedules, keeping due, outstanding and overdue separate.
- v4.7.0 (#32): shared bills across events, counted once.
- v4.8.0–4.8.1 (#33, #34): labour-contractor bills without double counting.
- v4.9.0 (#35): vendor order message versions with their real status. Opening WhatsApp is not "sent".
- v4.10.0 (#36): guest counts and extra plates, keeping contracted, counted, approved and billed separate.
- v4.11.0 (#37): function sheet, count method, and written or verbal approval evidence.

**Money and books (Phase 4, 13 Nov)**
- v4.12.0–4.15.0 (#38–#41): supplier bills and common stock, bill numbers with a duplicate warning, paying a chosen bill, credit notes, final settlement with a recorded discount, waiver or write-off, and the Books check.
- v4.16.0–4.16.3 (#42–#45): UI polish, long names, alignment, and payment and count fixes from the owner's audit.

**Quotes, menus and learning (Phase 2 and 5, 13–15 Nov)**
- v4.17.0–4.17.1 (#46, #47): quotations with optional GST, and quote options A/B.
- v4.18.0–4.18.1 (#48, #49): the menu library. The database version stays at 4.
- v4.19.0 (#50): suggestions from past reconciled events.
- v4.20.0–4.21.0 (#51–#53): business details and a printable quote. The booking advance is overdue only after the event. Issued quotes are frozen.
- v4.21.1–4.26.1 (#54–#57, #59–#61, #63, #64):
  - menus by meal and meal services
  - a guided menu sheet
  - opens on Home
  - client-approved menu versions and client documents
  - vendor orders per meal
  - local menu dates

**Vendors, guests and purchases (15–16 Nov)**
- v4.27.0 (#65): the Vendors tab redesign and vendor GSTIN.
- v4.28.0–4.28.2 (#66–#68): guests first, dish sourcing, purchase orders, a purchase-link hotfix, and owner feedback (an optional bill, camera photos).

**Backup and recovery (16–17 Nov)**
- v4.29.0 (#69): the encrypted `.cdbk` backup and a 14-group recovery key. Accepted on the phone.
- v4.30.0 (#70): the Google Drive API client, shipped switched off.
- v4.31.0 (#71): Settings → Backup & Recovery (phone, Google Drive through the share menu, restore, recovery key). Accepted on the phone on 17 Nov.
- v4.31.1 (#72): dates and times in the phone's own time.
- #62: test-only diagnostics for a one-off update test failure.

**Defect fixes and the independent audit (18–19 Nov)**

Each line says how far it has got: *built and tested* (the full suite, or only the fix's own checks, as stated), *reviewed*
(Codex reviewed the exact commit), *merged and live*, and *phone-verified* (checked by the owner on the phone). Passing
tests alone does not make a change ready for use.

| Version | Built and tested | Reviewed | Merged and live | Phone-verified |
|---|---|---|---|---|
| 4.31.2 (#74) | ✅ | ✅ | ✅ | ⏳ |
| 4.31.3 (#75) | ✅ | ✅ | ✅ | ⏳ |
| 4.31.4 (#76) | ✅ | ✅ | ✅ | not needed |
| 4.31.6 (#78) | ✅ | ✅ | ✅ | ⏳ |
| 4.31.7 (#79) | ✅ | ✅ | ✅ | ⏳ |
| 4.31.8 (#77) | ✅ full suite | ✅ | ✅ | not needed |
| 4.31.9 (#80), 4.31.10 (#81) | own checks only; full suite ⏳ | ✅ no major findings | ⏳ | ⏳ (4.31.9) |
| 4.31.11 (#82), 4.31.12 (#83) | own checks only; full suite ⏳ | Codex findings fixed; re-review ⏳ | ⏳ | ⏳ (4.31.12) |

- v4.31.2 (#74): leaving a new or edited event with unsaved changes asks *Keep editing / Discard changes*.
- v4.31.3 (#75): the menu approval line showed raw page code in both languages. It now shows the chosen language.
- v4.31.4 (#76): *This month*, *3 months* and *This FY* end where they say, so a booking for a later month no longer
  counts this month. Also correct on the 1st of a month in time zones behind UTC.
- v4.31.5 was not released under that number: the menu-name fix waited and became v4.31.8.
- v4.31.6 (#78): form errors work with screen readers, and focus goes to the first field to fix.
- v4.31.7 (#79): a menu price of 0 points at the price box, not at *From guests*.
- v4.31.8 (#77): menu names are always shown as text, in five places that could turn them into page code.
- v4.31.9: the price message stays until the price itself is changed.
- v4.31.10: past-event price suggestions leave out waived, discounted or written-off events (owner's rule), and a counter paid in
  several bills gives its true rate per plate.
- v4.31.11: old app caches are cleaned up, long vendor names stay inside their chips, and the desktop launcher
  source shows the current version.
- v4.31.12: dropdown text stays at the readable size, with a long chosen name shown in full under the dropdown.

## 3. Defects found and fixed after release

- **Edits dropped stored fields** (versions 3.3.0–4.0.1), which could also duplicate labour expenses. Fixed in v4.0.2.
- **Android refused shares:**
  - The share menu didn't open because it was opened after the tap. Fixed in v4.1.1 and v4.2.1.
  - `.json` files were refused. Fixed in v4.2.2.
  - `.cdbk` files were refused, and the app silently downloaded instead. Fixed in v4.31.0.
- **A shared labour bill counted twice.** Fixed in v4.8.1.
- **The menu library raised the database version,** which broke older open tabs. Fixed in v4.18.1.
- **A purchase's bill could move to another event.** Fixed in v4.28.1.
- **Opening an event could fill its bill.** Fixed in v4.28.2.
- **Dates showed the previous day** for anything saved between midnight and 05:30 IST. Fixed in v4.26.1 for menus, and in v4.31.1 everywhere else.
- **The menu approval line showed raw page code** in both languages. Found on the phone, fixed in v4.31.3.

Found by the independent audit of 19 November, with Codex reviews:
- **Report periods had no end,** so later bookings counted in this month or this year. Fixed in v4.31.4.
- **A menu name could become page code** in five places on the event page. Fixed in v4.31.8. The reviewer then found the same
  problem in the meal-menu editor (`renderServiceSheet`: menu, "from" and shared dish names). Not fixed yet: a separate
  security fix is planned.
- **A waived, discounted or written-off event pulled the suggested selling price down.** Fixed in v4.31.10.
- **A counter paid in several bills showed a fraction of its real rate per plate.** Fixed in v4.31.10.
- **Old app caches were never deleted** from the phone. Fixed in v4.31.11.

Still open from the audit, waiting for an owner decision:
- the safety copy saved before a restore replaces the data is a plain `.json` file, not encrypted (the owner is warned when saving it)
- GitHub does not run the browser test suite; it runs before every push on the developer's computer

## 4. Current limitations

- **Records live only on the phone.** Clearing browser data, or losing the phone without a backup, loses them.
- **Backups are manual.** A web app cannot run while it is closed, and the automatic Drive path is paused. The app shows how long it has been since the last backup.
- **The direct Google Drive connection (D3/D4) is paused.** Google's Drive APIs Terms of Service do not allow app-content backup to Drive without Google's written consent. The D2 client stays off, with an empty client ID. See `docs/DRIVE_BACKUP_DESIGN.md`, which is marked superseded.
- **There is no persistent "save to this Drive folder" option.** The Android app is a Trusted Web Activity without native code, so the folder is chosen at each share.
- **The recovery key cannot be recovered.** Without it, encrypted backups cannot be opened.
- **The quote is printed through the phone's print dialog** (Save as PDF). This is not yet recorded as tested on the phone.

## 5. How releases are checked

- One branch and one pull request per change.
- The full automated suite runs before every push. Tests use synthetic "Sample" data only, never real customer data.
- An independent code review (Codex) of the exact commit, plus the owner's reviewer. Fixes are made only for confirmed findings.
- Merged only on the owner's explicit approval of the exact commit, then the live version is checked.
- Phone acceptance by the owner, where a change needs a real device.

## 6. Recommended next steps

1. **Release v4.31.8 to v4.31.12 one at a time,** each after its own review and the owner's approval. Then fix only
   genuine defects.
2. **Phone checks still not recorded:**
   - the unsaved-changes question, form-error focus and the keyboard, and the menu price focus
   - long names in dropdowns (after v4.31.12)
   - the menu approval line
   - camera and gallery photos, including permission denial
   - Print / Save as PDF for a quote
   - one full event through counts, shared bills, settlement and the Books check
3. **Owner decisions before any commercial plan:**
   - GST treatment (O-01, O-02)
   - an independent finance review
   - whether to sell at all, and to whom
   - whether to encrypt the pre-restore safety copies, and whether GitHub should run the browser tests
