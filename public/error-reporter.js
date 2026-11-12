// Sends a redacted note of uncaught errors to /api/client-error so failures on users' phones reach the Vercel logs.
// Only fixed technical fields are sent: error type, app file name, line, column, release and a browser family.
// Never sent: error messages, stacks, page paths, full browser strings, times or any business record (D-2).
(function () {
  const RELEASE = '4.0.3';
  const ENDPOINT = '/api/client-error';
  const MAX_PER_SESSION = 10;
  if (window.caterDeskErrorReporter) return;
  const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  const KINDS = ['error', 'unhandledrejection', 'handled'];
  const FILES = ['app.js', 'db.js', 'utils.js', 'i18n.js', 'icons.js', 'sw.js', 'register-sw.js', 'error-reporter.js'];
  const int = n => Number.isInteger(n) && n >= 0 && n < 1e7 ? n : null;

  // One of the app's own script names (e.g. "app.js"); anything else becomes "other" or "external".
  function scriptFile(url) {
    if (typeof url !== 'string' || !url) return null;
    let u; try { u = new URL(url, location.href); } catch { return 'other'; }
    if (u.origin !== location.origin) return 'external';
    const name = u.pathname.split('/').pop();
    return FILES.includes(name) ? name : 'other';
  }

  // First frame of the stack that points to a script: file, line and column only; the stack itself is never kept.
  function firstFrame(stack) {
    if (typeof stack !== 'string') return {};
    const m = stack.match(/(https?:\/\/[^\s)]+?):(\d+):(\d+)/);
    return m ? { file: scriptFile(m[1]), line: +m[2], column: +m[3] } : {};
  }

  function browserFamily() {
    const ua = navigator.userAgent || '';
    if (/; wv\)/.test(ua)) return 'android-webview';
    if (/Edg\//.test(ua)) return 'edge';
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Chrome\//.test(ua)) return /Android/.test(ua) ? 'chrome-android' : 'chrome';
    if (/Safari\//.test(ua)) return 'safari';
    return 'other';
  }

  function build(kind, error, extra) {
    const frame = firstFrame(error && error.stack);
    const name = error && typeof error === 'object' ? error.name : null;
    return {
      kind: KINDS.includes(kind) ? kind : 'error',
      code: typeof name === 'string' && /^[A-Za-z]{1,40}$/.test(name) ? name : (error instanceof Error ? 'Error' : 'NonError'),
      file: scriptFile(extra && extra.source) || frame.file || 'other',
      line: int(extra && extra.line) ?? int(frame.line),
      column: int(extra && extra.column) ?? int(frame.column),
      release: RELEASE,
      browser: browserFamily()
    };
  }

  if (local) {   // never send from a development machine; build() stays available for tests
    window.caterDeskErrorReporter = { report: () => {}, build };
    return;
  }

  const seen = new Set();
  const queue = [];
  let sent = 0;

  function send(report) {
    const body = JSON.stringify(report);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) return;
    } catch (e) { /* fall through to fetch */ }
    fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }

  function flush() {
    while (queue.length && navigator.onLine !== false) send(queue.shift());
  }

  function report(kind, error, extra) {
    if (sent >= MAX_PER_SESSION) return;
    const entry = build(kind, error, extra);
    const key = [entry.kind, entry.code, entry.file, entry.line, entry.column].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    sent++;
    if (navigator.onLine === false) queue.push(entry);
    else send(entry);
  }

  window.addEventListener('error', e => {
    // Resource load failures (an image or script) have no message and are not app errors.
    if (!e.message && !e.error) return;
    report('error', e.error, { source: e.filename, line: e.lineno, column: e.colno });
  });
  window.addEventListener('unhandledrejection', e => report('unhandledrejection', e.reason));
  window.addEventListener('online', flush);

  window.caterDeskErrorReporter = { report: (error, kind = 'handled') => report(kind, error), build };
})();
