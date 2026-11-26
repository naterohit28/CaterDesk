# CaterDesk — engineering rules for all coding agents

CaterDesk is the owner's catering operations and money app: a vanilla-JS PWA (IndexedDB, service worker), hosted on Vercel from `main`, installed on Android as a TWA. It holds a real business's records **on the owner's phone**. These rules apply to every agent (Claude, Codex, others). Product direction lives in [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md); Claude-specific notes in [CLAUDE.md](CLAUDE.md).

**The goal:** make recording a transaction easier than forgetting it. Capture once, reuse information, verify before saving. Every change must make a real task faster, simpler or safer for a non-technical operator aged 40–70. If it doesn't, simplify it or don't build it.

## 1. Before changing anything
- Check the current `main` (version in `package.json`) and the open PRs. Don't assume an older review still describes the code.
- Trace the existing feature first: its screens in `public/app.js` / `public/index.html`, its rules in `public/utils.js`, its storage and validation in `public/db.js`, and the tests in `tests/` that cover it.
- Reuse existing functions, components and business rules. Don't rewrite a working subsystem because another shape looks cleaner. Don't build a feature that already exists. Improve it.

## 2. Money is non-negotiable
- Amounts are summed in integer paise (`toPaise` / `fromPaise` in `utils.js`). Keep it that way.
- There is **one** financial engine. Never add a second one: voice, photos, imports and new screens all save through the existing validated operations (`commitChanges`, `putChecked`, the existing forms).
- Keep the distinctions:
  - **orders are commitments, bills are costs, payments are settlements;**
  - an order's price (`fromOrder`) is an estimate, not its bill;
  - a payment schedule is not money received;
  - quoted, negotiated and final amounts are different things.
- Preserve the safeguards:
  - transaction atomicity and revision checks (`_rev`, `expected`);
  - shared-bill splits (`split.id`, `split.total`);
  - bill↔order links (`order`, `alsoOrders`, `purchase`);
  - contractor-specific labour (`cat|head|venId` keys);
  - partial settlements and credit notes (`vPays`, `billKey`, `kind:'credit'`);
  - reconciliation and its history.
- Never hide a cost. A cost not tied to an event (common stock, unallocated) must stay visible in the business totals. A shared bill must never be counted twice.
- Never create a financial record from an unverified source (AI, speech, a photo) without the user confirming it. Never guess paid vs credit, an advance vs the bill, or an ambiguous vendor or event.

## 3. Data safety
- `DB_VERSION` stays 4. Never raise it: old open tabs break (see `tests/release-update.cjs`). New stores and fields must be additive and backward compatible; restores of older backups must keep working.
- Any storage or backup-format change needs an explanation first: why, migration, compatibility, rollback, risk. It also needs the **owner's approval** before it is built.
- Tests use **synthetic sample data only**. Never commit or send real business data, names, phone numbers, invoices, backups, tokens or signing material. Never test against the live site's data or the owner's phone app.
- Offline operation must keep working: records always save without internet.

## 4. Code style
- The smallest correct change, following existing conventions: plain JS modules, no build step, `esc()` for every value put into HTML.
- No new framework, database, service or dependency without a justified need and owner approval. The CSP allows only same-origin scripts.
- No large unrelated refactors. Keep bilingual labels (English – मराठी), accessibility and Android-first performance.
- Files use CRLF line endings. Keep them.

## 5. UX
- Few taps, little typing, large readable controls, familiar words, one obvious primary action, safe defaults from context, easy correction, advanced options tucked away.
- The app must not grow visually more complicated as features are added. Kitchen staff may stay on paper and suppliers on WhatsApp. CaterDesk reduces the owner's work.

## 6. Tests
- Add targeted tests for every new behaviour, including failure and interruption cases. Check that existing financial behaviour is unchanged (same records, same totals).
- The full suite is `npm test` (`tests/run.cjs`, about 25 minutes). GitHub Actions runs it on every PR to `main`; that run is the gate.
- Report real results only. Never claim a test passed unless it ran and passed. No broad stress or audit cycles unless the owner asks.

## 7. Releases
- One focused branch and PR per change. Never commit to `main` directly. Never overwrite unrelated work.
- Every PR states:
  - the exact head SHA and files changed;
  - the business behaviour affected;
  - money and storage implications;
  - tests run, with results;
  - known limits;
  - manual acceptance checks.
- **Never merge, tag or deploy without the owner's explicit approval.** Merge with `gh pr merge --merge --match-head-commit <tested sha>`. No force-push.
- A release that changes the app bumps the version everywhere it is pinned (see the list in [CLAUDE.md](CLAUDE.md)) and adds a README changelog row. Docs-only PRs don't bump the version.
