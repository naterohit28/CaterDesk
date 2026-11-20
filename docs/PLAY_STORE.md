# CaterDesk on Google Play — launch kit

Prepared 20 November 2026 for the owner's decision. **Nothing here has been submitted.** Creating the developer account, paying the fee, signing, uploading and publishing are the owner's steps (or need the owner's explicit go-ahead for each).

Play rules checked on 20 Nov 2026 (re-check in Play Console before submitting; they change):
- New apps and updates must target **Android 16 (API 36)**. The wrapper already does (`targetSdkVersion 36`, min 24).
- New uploads must be an **Android App Bundle (.aab)**, not an APK.
- A **personal** developer account created after 13 Nov 2023 must run a **closed test with at least 12 testers for 14 days in a row** before it can apply for production. Organization accounts are exempt but need a D-U-N-S number.
- Every app must file the **Financial features** declaration, even to say it offers none.
- Android developer verification (identity + package registration) is rolling out; it is part of Play Console sign-up.

---

## 1. Decisions only the owner can make

| # | Decision | Recommendation |
| --- | --- | --- |
| P-1 | Developer account: **personal** or **organization** | Organization if the business has (or can get) a free D-U-N-S number: no 12-tester wait, and the listing shows the business name. Personal is faster to open but needs the 14-day closed test |
| P-2 | Public contact email for the listing and privacy policy | A business address, not a personal one. It is shown publicly |
| P-3 | App name on Play | Keep **CaterDesk** (other businesses use the name; a trademark check is still open) |
| P-4 | Price and countries | Free, India first |
| P-5 | Signing: keep the current key (recommended) or let Google make a new one | See §3 |
| P-6 | Who may install: public listing, or unlisted / private only | Start with internal testing either way |

## 2. Technical readiness

| Item | State | Action |
| --- | --- | --- |
| Package name | `com.flavorfusion.expenses` | Keep. It can never change after the first Play upload |
| Target / min SDK | 36 / 24 | Ready |
| Build type | Local Bubblewrap project, builds a signed APK | Build an **.aab**: `bubblewrap build` writes `app-release-bundle.aab` next to the APK |
| Version | versionName 3.0.0, versionCode 9 | Set versionName **5.0.0**, versionCode **10** in `twa-manifest.json` before the Play build |
| Digital Asset Links | `/.well-known/assetlinks.json` lists the current signing key | Must also list Play's app-signing key if it differs (§3), or the app opens with a browser address bar |
| Offline use | Works (service worker, tested) | Ready: this matters for Play's "web wrapper" quality review |
| Notifications, location, microphone | Not used | Nothing to declare |
| Wrapper source | Lives outside the repository | Keep a private copy with the keystore; never commit the keystore or `signing-secrets.xml` |
| Privacy policy URL | `public/privacy.html` (this PR) → `https://expense-calculator-kohl.vercel.app/privacy.html` | Fill in the contact email (P-2), then merge |

## 3. Signing plan (P-5)

Play signs every app it delivers with an **app signing key**; you upload with an **upload key**.

**Recommended: give Play the existing key** (Play Console → *Use a different app signing key* → export it with Google's PEPK tool). Then:
- Play's copy has the same signature as the APK already on the owner's phone, so it installs as an update over it.
- `assetlinks.json` stays as it is.
- Create a **new upload key** for future uploads, so the original key is used only once.

Alternative: let Google generate a new app signing key. Then the Play app cannot update the sideloaded one (uninstall the old wrapper first; records live in Chrome's storage for the website, not in the wrapper, but take a backup anyway), and Play's SHA-256 fingerprint (Play Console → *App integrity*) must be **added** to `assetlinks.json` before release.

## 4. Store listing (English)

**App name (30 max):** CaterDesk: Catering Accounts

**Short description (80 max):**
Catering events, expenses, vendor bills and client payments. Works offline.

**Full description:**

> CaterDesk is a simple accounts book for caterers. Plan each event, record what it costs, and see what you really earned, even without internet.
>
> EVENTS AND CLIENTS
> • Each event with its date, venue, guests and meals
> • Quotes with options, your GST rate and a printable copy
> • Payment plans, advances received and what is still due
> • Guest counts and extra plates kept separate from the agreed bill
>
> MENUS AND VENDOR ORDERS
> • Menus for each meal, from your own saved menus
> • Orders to counters and suppliers, sent on WhatsApp in one tap
> • Plates per counter suggested from the guest count
>
> EXPENSES AND VENDORS
> • Bills with photos, paid now or on credit
> • One bill shared across several events
> • Labour sheets, supplier credit notes and what you owe each vendor
>
> CLEAR PROFIT
> • What each event earned after every cost
> • A final settlement that shows anything still open
> • Reports for any month or year
>
> YOUR DATA STAYS WITH YOU
> • No account and no sign-in. Records stay on your phone
> • Encrypted backups locked with your own recovery key
> • Save backups to your phone or to Google Drive
> • English and Marathi
>
> CaterDesk has no ads and no tracking.

**Category:** Business · **Tags:** Business, Productivity · **Contact:** P-2 email · **Website:** https://expense-calculator-kohl.vercel.app · **Privacy policy:** …/privacy.html

## 5. Graphics (in `docs/play/`)

| Asset | Play requirement | File |
| --- | --- | --- |
| App icon | 512 × 512 PNG, ≤ 1 MB | `docs/play/icon-512.png` |
| Feature graphic | 1024 × 500 PNG/JPG | `docs/play/feature-graphic.png` |
| Phone screenshots | 2–8, 9:16, 1080 × 1920 | `docs/play/screenshot-1…6.png` (Sample data only) |

All screenshots use made-up **Sample** names and amounts. Never use real client data in store images.

## 6. App content answers (Play Console → Policy → App content)

| Section | Answer |
| --- | --- |
| Privacy policy | The URL above |
| Ads | No ads |
| App access | All features available without login (an optional PIN is set by the user; nothing to give reviewers) |
| Content rating (IARC) | Category *Utility, productivity, communication or other*; answer **No** to violence, sexuality, language, controlled substances, gambling, user-to-user chat, sharing location, purchases. Expected: Everyone / 3+ |
| Target audience | 18 and over (business tool); not designed for children |
| News app | No |
| Health apps | No |
| Government app | No |
| Financial features | "My app doesn't provide any financial features" (it records the owner's own business amounts; no lending, banking, payments, trading or advice). Re-read the form's list before choosing |
| Account deletion | Not applicable: the app has no accounts |
| Data safety | See §7 |

## 7. Data safety form

Data that stays on the device and is never sent off it is **not "collected"** under Play's definitions.

- **Does the app collect or share user data?** Yes, one optional type:
  - **App info and performance → Crash logs / Diagnostics:** *collected*, **optional** (off until the user turns on Error reports), purpose **App functionality / analytics of crashes**, **not shared**, not linked to identity, sent over HTTPS.
- **Not collected:** personal info, contacts (the picked contact is stored only on the phone), photos (stored only on the phone), financial info (stored only on the phone), location, messages, app activity, device IDs.
- **Encrypted in transit:** Yes (HTTPS only).
- **Users can request deletion:** No server-side personal data exists; records are deleted in the app or by uninstalling.

The answers must match `public/privacy.html`. If anything is added that sends data (sync, Drive API, analytics), update both before release.

## 8. Release path

1. Owner: create the Play developer account (P-1), pay the one-time fee, complete identity verification.
2. Create the app *CaterDesk*, default language English (India), free.
3. Fill §4–§7 and upload graphics.
4. Signing (§3), then upload the 5.0.0 `.aab` to **Internal testing**; install from Play on the owner's phone and repeat the short phone checklist.
5. Personal account: **Closed testing** with ≥ 12 testers for 14 continuous days (staff, family, fellow caterers; each needs a Google account and must stay opted in). Collect their feedback.
6. Apply for production. Review is usually up to about a week.
7. Production with a **staged rollout** (e.g. 20% → 100%).
8. After release: web updates keep reaching users through the website; a new `.aab` (higher versionCode) is needed only when the wrapper itself changes.

## 9. Known risks

- **Web-wrapper review:** Play rejects wrappers that are just a website. CaterDesk works offline, stores data on the phone and behaves like an app, which is the right case, but the reviewer decides.
- **Asset links:** if verification fails, the app shows a browser bar. Check on the internal-testing build before going further.
- **Name:** another "CaterDesk" exists in this industry; a complaint could force a rename after launch.
- **Support load:** a public listing brings reviews and emails; decide who answers them.
- **Data loss reports:** records live in Chrome's storage. Clearing Chrome's data removes them. The listing and in-app text already tell users to keep a backup.
