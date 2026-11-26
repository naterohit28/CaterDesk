# Claude Code notes for CaterDesk

Follow [AGENTS.md](AGENTS.md) (shared rules) and [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md) (what to build next). This file adds only what is specific to Claude Code sessions.

## Working setup
- Work in a git worktree on its own branch; never on `main`.
- Run single tests against an isolated local server: `npm test` runs everything; for one file, serve `public/` on `127.0.0.1` and set `TEST_BASE_URL` (tests refuse any other URL). Tests use Playwright with Edge (`channel: 'msedge'`).
- Don't run the full suite locally unless asked. GitHub runs it (about 25 min). Run the tests related to your change locally.
- Stacked PRs: after the lower one merges, retarget the next to `main` and merge `main` into it (a new commit starts its CI).

## Version bump (app releases only)
Update every pinned version:
- `public/app.js` (`APP_BUILD`), `public/db.js` (`APP_VERSION`);
- `public/error-reporter.js` (`RELEASE`), `public/sw.js` (`RELEASE` and `CACHE_NAME` cache number +1);
- `package.json`, `package-lock.json` (2 places);
- `desktop/FlavorFusionDesktop.cs` (4), `desktop/README.txt` (3);
- `tests/diagnostics-redaction.cjs`, `tests/release-update.cjs` (3, including the `'vX.Y.Z'` app-build check on line 14);
- README version lines, plus a changelog row.
After a release, add the previous version's tag to `tests/update-from-4313.cjs`.

## The owner's phone
- The installed app runs in **Brave** and holds the real records: never drive or test in Brave.
- Phone checks use **Chrome** with synthetic sample data, or a local server reached through `adb reverse`.
- Change phone settings only with the owner's OK.

## Privacy
- The owner's name, contact details, client names, real invoices and backups never go into the repo, tests, CI artifacts or external services.
- Dish names from the owner's menu card may be used as examples.
