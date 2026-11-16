/* Google Drive backup settings (design: docs/DRIVE_BACKUP_DESIGN.md, sections 3 and 8).
   The OAuth client ID is public by design: it names the app and grants nothing on its own. It stays EMPTY until the
   owner approves step D3 and sends it. While it is empty, Drive backup is hidden and no Google code is ever loaded.
   No client secret, API key or token belongs in this file or anywhere else in the app. */
export const DRIVE_CLIENT_ID = '';
// Only these addresses are registered with Google; anywhere else (previews, the desktop package) Drive stays hidden
export const DRIVE_ORIGINS = ['https://expense-calculator-kohl.vercel.app', 'http://localhost:8790'];
