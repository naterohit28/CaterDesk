CATERDESK DESKTOP TEST v3.3.0

1. Extract the ENTIRE ZIP into a folder.
2. Open CaterDesk-Desktop.exe. Microsoft Edge opens in an app window.
3. The server stays in the Windows system tray. Right-click its icon to open the
   app again, view storage information, or exit the test server.

Requires Windows with .NET Framework 4.x and Microsoft Edge. No Node/Python or
administrator installation is needed. This is an unsigned local test launcher.

The test app serves its included v3.3.0 files locally. It does not automatically
update from the website. Its dedicated Edge profile and records are separate
from normal browser profiles and from your phone. It opens at the same fixed
loopback address on every launch so records persist between sessions.

Data profile: %LOCALAPPDATA%\FlavorFusionDesktopTest\EdgeProfile
URL: http://127.0.0.1:19891/

To test existing data, export a backup from the phone and import a COPY here.
No automatic desktop/phone sync is provided. Keep the original backup.
Use Share/save backup to export any desktop test records you wish to retain.
Do not clear browser data to update or recover the app.

If port 19891 is occupied, close the other desktop test copy and retry. The
launcher deliberately does not change ports, since that would change the app's
storage origin and make existing test records appear missing.
