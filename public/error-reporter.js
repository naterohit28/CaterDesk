// Sends uncaught errors to /api/client-error so failures on users' phones reach the Vercel logs.
// Only the error text, stack, page path, release and browser are sent; business records never are.
(function () {
  const RELEASE = '3.4.0';
  const ENDPOINT = '/api/client-error';
  const MAX_PER_SESSION = 10;
  const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (local || window.caterDeskErrorReporter) return;

  const seen = new Set();
  const queue = [];
  let sent = 0;

  function clip(value, max) {
    return String(value ?? '').slice(0, max);
  }

  function send(report) {
    const body = JSON.stringify(report);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) return true;
    } catch (e) { /* fall through to fetch */ }
    fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    return true;
  }

  function flush() {
    while (queue.length && navigator.onLine !== false) send(queue.shift());
  }

  function report(kind, error, extra) {
    if (sent >= MAX_PER_SESSION) return;
    const message = clip(error?.message || error || 'Unknown error', 500);
    const key = kind + '|' + message;
    if (seen.has(key)) return;
    seen.add(key);
    sent++;
    const entry = {
      kind,
      message,
      stack: clip(error?.stack, 2000).replaceAll(location.origin, ''),
      source: clip(extra?.source?.replace(location.origin, ''), 200),
      line: extra?.line || null,
      column: extra?.column || null,
      path: location.pathname,
      release: RELEASE,
      userAgent: clip(navigator.userAgent, 300),
      at: new Date().toISOString()
    };
    if (navigator.onLine === false) queue.push(entry);
    else send(entry);
  }

  window.addEventListener('error', e => {
    // Resource load failures (an image or script) have no message and are not app errors.
    if (!e.message && !e.error) return;
    report('error', e.error || e.message, { source: e.filename, line: e.lineno, column: e.colno });
  });
  window.addEventListener('unhandledrejection', e => report('unhandledrejection', e.reason));
  window.addEventListener('online', flush);

  window.caterDeskErrorReporter = { report: (error, kind = 'handled') => report(kind, error) };
})();
