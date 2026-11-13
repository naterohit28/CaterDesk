CATERDESK DESKTOP TEST v4.0.3

Current source/package-template version: 4.0.3. Checked 13 November 2026.
This header is not proof that an older downloaded ZIP includes the same build.
The latest GitHub binary release verified on that date is v2.4.7; the owner's
existing Apps/Desktop bundle also contains v2.4.7. Build current source for the
new features. Check Settings inside the running app for its actual web build.

RUN
1. Extract the ENTIRE ZIP; keep app/ beside CaterDesk-Desktop.exe.
2. Before switching versions, choose Exit test server from the older copy's
   Windows tray icon. Merely closing the Edge window leaves that server running.
3. Open CaterDesk-Desktop.exe. It starts a local server and an Edge app window.
4. The tray menu offers Open CaterDesk, About test storage and Exit test server.
   The current launcher warns if an older server is still running.

Requires Windows, Microsoft Edge and .NET Framework 4.x. Prepared packages do
not require Node/Python or administrator installation. This is an unsigned local
test launcher, not a Store installer.

DATA AND UPDATES
URL: http://127.0.0.1:19891/
Data profile: %LOCALAPPDATA%\FlavorFusionDesktopTest\EdgeProfile

The app uses local IndexedDB (FlavorFusionDB, schema 4) in this Edge profile.
Its records are separate from phone and ordinary browser records. Changing the
port/profile creates another storage environment; do not do that to fix updates.

Export a backup from the phone and import a COPY to test existing records here.
Keep the original. Export any desktop records you need before changing packages.
No automatic phone/desktop sync or off-device backup is provided. The privacy
PIN hides the UI; it does not encrypt the records or exported JSON.

The desktop app serves its bundled files. Website updates do not replace them.
Refresh reloads local records and checks the LOCAL bundle's worker. To upgrade,
exit the tray server and replace the complete package, retaining the same Edge
profile and origin. Never clear browser storage or delete the profile to update.

CURRENT FEATURES
Current source includes event expenses/collections, vendor and lender balances,
pending-first credit, usual-vendor suggestions, receipt drafts, menu costing,
outsourced events, pasted dishes/counter orders, WhatsApp/call links and reports.
WhatsApp messages require the user to send them. Contact picking, phone camera
and native sharing depend on the device/browser and may be unavailable here.
See the repository README for full workflows and current limitations.

BUILD / PACKAGING CAVEAT
From the repository root in Windows PowerShell:
  .\desktop\build.ps1 -OutputDirectory C:\Temp\CaterDesk-Desktop
  Copy-Item -LiteralPath .\public\error-reporter.js -Destination C:\Temp\CaterDesk-Desktop\app\error-reporter.js

The current build helper omits error-reporter.js from its copy list, although
index.html references it and sw.js precaches it. Include it with the command
above: otherwise a missing-script response can prevent offline precaching.
This is a documented workaround; the helper is unchanged by this README update.

Distribute the complete output folder (EXE, README.txt and app/) as one ZIP.
Inspect the actual bundled version; do not relabel an old package as 4.0.3.
Never distribute the Edge profile, customer backups or signing credentials.

LOCAL LIMITS
The server accepts local static-file requests; it has no business-data API and
does not run the Vercel /api/client-error endpoint. Hosted diagnostic reporting
skips loopback hosts even when its script is included. Test physical Android
camera, contact selection, sharing, sleep and recovery on a phone separately.

If port 19891 is occupied, exit the conflicting test server normally and retry.
For missing records, check the original profile/origin and backups first.
