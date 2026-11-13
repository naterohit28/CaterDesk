// Uses a fresh browser profile and synthetic data; never visits the live site.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const webRoot = path.join(root, 'public');
fs.mkdirSync('test-artifacts', { recursive: true });
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(webRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(webRoot + path.sep) || pathname.split('/').some(p => p.startsWith('.') && p !== '.well-known')) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(body);
  });
});
server.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  let failed = false;
  try {
    for (const script of ['regression.cjs', 'attachment-regression.cjs', 'security-smoke.cjs', 'idle-recovery.cjs', 'release-update.cjs', 'ui-audit.cjs', 'labour-audit.cjs', 'xss-canary.cjs', 'diagnostics-redaction.cjs', 'backup-restore.cjs', 'reconciliation.cjs', 'venue-details.cjs', 'menu-meals.cjs', 'audit-441.cjs', 'toast-undo.cjs', 'counter-planning.cjs', 'payment-schedule.cjs', 'shared-bills.cjs', 'labour-no-duplicates.cjs', 'shared-labour.cjs', 'order-versions.cjs', 'guest-counts.cjs', 'function-sheet.cjs', 'supplier-bills.cjs', 'bill-payments.cjs']) {
      const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, script)], { cwd: root,
          env: { ...process.env, TEST_BASE_URL: base }, stdio: 'inherit', windowsHide: true });
        child.once('error', reject); child.once('exit', resolve);
      });
      if (code !== 0) failed = true;
    }
  } catch (e) { console.error(e); failed = true; }
  finally { server.close(); process.exitCode = failed ? 1 : 0; }
});
